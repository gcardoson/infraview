import { useEffect, useRef, useState } from "react";
import type { Site } from "../api";
import { type Medium, type NodeKind, type SiteTopology, TOPOLOGIES, type TopoLink, type TopoNode } from "../topology/data";

/*
 * What the map shows at each plant: one CPD (core equipment, telecom and link hand-off, servers,
 * backup, storage) and several access racks, where the network is distributed. Both come from the
 * plant's Layer 2 drawing (Topologia); room sensors and power stay simulated until they are collected.
 */

export type RoomKind = "cpd" | "rack";
export type Health = "ok" | "warn" | "crit";
export type UnitKind = "firewall" | "switch" | "server" | "storage" | "patch" | "ups" | "other";

export interface RackUnit {
  start: number;
  size: number;
  label: string;
  kind: UnitKind;
}

export interface Rack {
  id: string;
  name: string;
  heightU: number;
  units: RackUnit[];
  powerKw: number;
}

export interface Room {
  id: string;
  siteId: number;
  code: string;
  name: string;
  kind: RoomKind;
  building: string;
  lat: number;
  lng: number;
  temperatureC: number;
  humidity: number;
  powerKw: number;
  powerCapacityKw: number;
  upsMinutes: number;
  cooling: string;
  access: string;
  cameras: number;
  racks: Rack[];
  /* Topology node of the room's switch. */
  nodeId?: string;
  /* Code of the Topologia drawing the room's devices come from. */
  topology?: string;
  devices: RoomDevice[];
  links: RoomLink[];
}

export const KIND_LABEL: Record<RoomKind, string> = { cpd: "CPD", rack: "Rack" };

export const KIND_SHORT: Record<RoomKind, string> = { cpd: "CPD", rack: "RK" };

export const UNIT_LABEL: Record<UnitKind, string> = {
  firewall: "Firewall",
  switch: "Switch",
  server: "Servidor",
  storage: "Storage",
  patch: "Patch panel",
  ups: "Nobreak",
  other: "Outro",
};

export const usedU = (rack: Rack) => rack.units.reduce((s, u) => s + u.size, 0);

export function roomIssues(room: Room): { level: Health; text: string }[] {
  const issues: { level: Health; text: string }[] = [];
  // Access racks sit in industrial areas without precision cooling, so they tolerate more heat than the CPD.
  const [warnC, critC] = room.kind === "cpd" ? [27, 30] : [32, 35];
  if (room.temperatureC >= critC) issues.push({ level: "crit", text: `Temperatura crítica: ${room.temperatureC.toFixed(1)} °C` });
  else if (room.temperatureC >= warnC)
    issues.push({ level: "warn", text: `Temperatura alta: ${room.temperatureC.toFixed(1)} °C` });
  const load = room.powerKw / room.powerCapacityKw;
  if (load >= 0.9) issues.push({ level: "crit", text: `Carga elétrica em ${Math.round(load * 100)}%` });
  else if (load >= 0.8) issues.push({ level: "warn", text: `Carga elétrica em ${Math.round(load * 100)}%` });
  if (room.humidity >= 70) issues.push({ level: "warn", text: `Umidade alta: ${Math.round(room.humidity)}%` });
  if (room.upsMinutes < 10)
    issues.push({ level: "warn", text: `Autonomia do nobreak baixa: ${Math.round(room.upsMinutes)} min` });
  return issues;
}

export function roomHealth(room: Room): Health {
  const issues = roomIssues(room);
  if (issues.some((i) => i.level === "crit")) return "crit";
  return issues.length ? "warn" : "ok";
}

export function worstHealth(values: Health[]): Health {
  return values.includes("crit") ? "crit" : values.includes("warn") ? "warn" : "ok";
}

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type RackPlan = [label: string, kind: UnitKind, size: number][];

function buildRack(id: string, name: string, heightU: number, plan: RackPlan): Rack {
  // Mounted from the top, like the drawings' faceplates: fibre first, then the switch stack.
  let u = heightU - 1;
  const units: RackUnit[] = [];
  for (const [label, kind, size] of plan) {
    units.push({ start: u - size + 1, size, label, kind });
    u -= size + 1;
  }
  return { id, name, heightU, units, powerKw: units.reduce((s, x) => s + (x.kind === "switch" ? 0.09 : 0) * x.size, 0) };
}

/* A device documented in the plant's Layer 2 drawing, and the room that holds it. */
export interface RoomDevice {
  nodeId: string;
  hostname: string;
  ip?: string;
  model?: string;
  kind: NodeKind;
  nok?: string;
}

export interface RoomLink {
  id: string;
  peer: string;
  medium: Medium;
  fibers?: number;
  ports: string;
  broken: boolean;
  note?: string;
}

/* "C9200L-24T & C9200L-24P" is a stack of two switches, one rack unit each. */
const stackOf = (model?: string) => (model ? model.split("&").map((m) => m.trim()) : [""]);

const fibre = (m: Medium) => m === "sm" || m === "mm";

interface Spot {
  node: TopoNode;
  devices: RoomDevice[];
  links: RoomLink[];
  heightU: number;
  plan: RackPlan;
}

/*
 * Rooms of a plant from its Layer 2 drawing: the central switch sits in the CPD and every other
 * switch is an access rack. APs belong to the room of the switch they hang from.
 */
function fromTopology(topo: SiteTopology) {
  // Nodes drawn inside a group belong to another site (BR-ACS shows Limeira's CPD for context).
  const elsewhere = (n: TopoNode) => topo.groups?.some((g) => n.x >= g.x && n.x <= g.x + g.w && n.y >= g.y && n.y <= g.y + g.h);
  const switches = topo.nodes.filter((n) => (n.kind === "switch" || n.kind === "core") && n.hostname && !elsewhere(n));
  // The central switch: the one the drawing places in the CPD, otherwise the plant's first core switch.
  const core = switches.find((n) => n.location?.toUpperCase().startsWith("CPD")) ?? switches.find((n) => n.kind === "core");
  if (!core) return null;
  const byId = new Map(topo.nodes.map((n) => [n.id, n]));
  const name = (n?: TopoNode) => (n ? (n.hostname ?? n.location ?? n.id) : "?");
  const peersOf = (n: TopoNode) =>
    topo.links
      .filter((l) => l.a.node === n.id || l.b.node === n.id)
      .map((l) => {
        const [own, other] = l.a.node === n.id ? [l.a, l.b] : [l.b, l.a];
        return { link: l, own, end: other, other: byId.get(other.node) };
      });

  const spot = (node: TopoNode, cpd: boolean): Spot => {
    const peers = peersOf(node);
    const aps = peers.filter((p) => p.other?.kind === "ap").map((p) => p.other!);
    const uplinks = peers.filter((p) => p.other?.kind !== "ap");
    const stack = stackOf(node.model);
    const fibres = uplinks.filter((p) => fibre(p.link.medium));
    const fibreCount = fibres.reduce((s, p) => s + (p.link.fibers ?? 0), 0);
    const plan: RackPlan = [];
    if (fibres.length)
      plan.push([
        fibreCount ? `DIO · ${fibreCount} fibras documentadas` : `DIO · ${fibres.length} cabo(s) óptico(s)`,
        "patch",
        1,
      ]);
    stack.forEach((m, i) => plan.push([`${node.hostname}${stack.length > 1 ? ` #${i + 1}` : ""} ${m}`.trim(), "switch", 1]));
    return {
      node,
      heightU: cpd ? 42 : stack.length > 1 || /-48/.test(node.model ?? "") ? 16 : 12,
      plan,
      devices: [node, ...aps].map((n) => ({
        nodeId: n.id,
        hostname: name(n),
        ip: n.ip,
        model: n.model,
        kind: n.kind,
        nok: n.nok,
      })),
      links: uplinks.map(({ link, own, end, other }) => ({
        id: link.id,
        peer: other?.hostname
          ? `${other.hostname}${other.location ? ` · ${other.location}` : ""}`
          : (other?.location ?? other?.id ?? "?"),
        medium: link.medium,
        fibers: link.fibers,
        ports: [own.port, end.port].filter(Boolean).join(" ↔ "),
        broken: !!link.breaks?.length,
        note: link.note,
      })),
    };
  };

  // The drawings carry no geography, so the map keeps the drawing's layout around the CPD, scaled so
  // the plant spans about 2 km. Passive points (substations, bypasses) stay as waypoints of the links.
  const placed = [...switches, ...topo.nodes.filter((n) => n.kind === "passive" && !elsewhere(n))];
  const centre = (n: TopoNode) => [n.x + n.w / 2, n.y + n.h / 2];
  const [cx, cy] = centre(core);
  const span = Math.max(1, ...placed.map((n) => centre(n)[0])) - Math.min(...placed.map((n) => centre(n)[0]));
  const metres = 2000 / span;
  // The drawings are wide and short; stretching the rows apart keeps labels readable on the map.
  const layout = new Map(
    placed.map((n) => [n.id, [(centre(n)[0] - cx) * metres, -(centre(n)[1] - cy) * metres * 1.6] as [number, number]]),
  );

  // One line per pair of places; parallel cables (two fibres to the same building) share it.
  const connections = new Map<string, PlantConnection>();
  for (const link of topo.links) {
    if (!layout.has(link.a.node) || !layout.has(link.b.node)) continue;
    const [a, b] = [link.a.node, link.b.node].sort();
    const key = `${a}~${b}`;
    const entry = connections.get(key) ?? {
      id: key,
      a,
      b,
      links: [],
      path: route(layout.get(a)!, layout.get(b)!, [...layout.values()]),
    };
    entry.links.push(link);
    connections.set(key, entry);
  }

  return {
    topology: topo.code,
    cpd: spot(core, true),
    racks: switches.filter((n) => n !== core).map((n) => spot(n, false)),
    passives: placed.filter((n) => n.kind === "passive"),
    layout,
    connections: [...connections.values()],
  };
}

/* A line on the map between two places of a plant, carrying every documented cable between them. */
export interface PlantConnection {
  id: string;
  a: string;
  b: string;
  links: TopoLink[];
  /* Metres east/north of the CPD inside fromTopology; latitude/longitude once placed on the map. */
  path: [number, number][];
}

type Xy = [number, number];

/*
 * A straight line, unless it would run over another place (a ring along a row of racks): then it arcs
 * away from that place, so the map never suggests a connection the drawing doesn't have.
 */
function route(a: Xy, b: Xy, places: Xy[]): Xy[] {
  const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
  const length = Math.hypot(dx, dy) || 1;
  const blocking = places.filter((p) => {
    if (p === a || p === b) return false;
    const t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (length * length);
    if (t <= 0.02 || t >= 0.98) return false;
    return Math.abs((p[0] - a[0]) * dy - (p[1] - a[1]) * dx) / length < 45;
  });
  if (!blocking.length) return [a, b];
  // Bend to the side away from the places in the way (upwards for a horizontal row).
  const [nx, ny] = [-dy / length, dx / length];
  const side = blocking.reduce((s, p) => s + (p[0] - a[0]) * nx + (p[1] - a[1]) * ny, 0) > 0 ? -1 : 1;
  const bend = Math.min(220, 0.18 * length) * side;
  const control: Xy = [(a[0] + b[0]) / 2 + nx * bend * 2, (a[1] + b[1]) / 2 + ny * bend * 2];
  return Array.from({ length: 21 }, (_, i) => {
    const t = i / 20;
    const u = 1 - t;
    return [u * u * a[0] + 2 * u * t * control[0] + t * t * b[0], u * u * a[1] + 2 * u * t * control[1] + t * t * b[1]] as Xy;
  });
}

/* A passive point of the drawing: a building the cable passes through, with no switch. */
export interface Waypoint {
  nodeId: string;
  name: string;
  bypass: boolean;
  lat: number;
  lng: number;
}

const toLatLng = (lat: number, lng: number, [east, north]: [number, number]): [number, number] => [
  lat + north / 111_320,
  lng + east / (111_320 * Math.cos((lat * Math.PI) / 180)),
];

export function topologyOf(site: Site): SiteTopology | undefined {
  return TOPOLOGIES.find(
    (t) => t.code === site.code || (!!site.city && t.city.toLowerCase().startsWith(site.city.toLowerCase())),
  );
}

export interface ExplorerSite {
  site: Site;
  lat: number;
  lng: number;
  topology?: string;
  rooms: Room[];
  waypoints: Waypoint[];
  /* Positions of every placed node (rooms and waypoints) by topology node id. */
  positions: Record<string, [number, number]>;
  connections: PlantConnection[];
}

export function buildExplorer(sites: Site[]): ExplorerSite[] {
  return sites
    .map((site): ExplorerSite | null => {
      if (site.latitude === null || site.longitude === null) return null;
      const rand = rng(Math.abs(site.id) * 7349 + 3);
      const topo = topologyOf(site);
      const plant = topo ? fromTopology(topo) : null;
      // Only the network rack is documented; the servers and storage rack stays empty until it is.
      const cpdRacks = [
        buildRack(`${site.id}-CPD-0`, "RK-01 · Rede", 42, plant?.cpd.plan ?? []),
        buildRack(`${site.id}-CPD-1`, "RK-02 · Servidores", 42, []),
      ];
      const core = plant?.cpd.node;
      const cpd: Room = {
        id: `${site.id}-CPD`,
        siteId: site.id,
        code: "CPD",
        name: "CPD",
        kind: "cpd",
        building: core ? `Switch central ${core.hostname}` : "Sem topologia documentada",
        lat: site.latitude,
        lng: site.longitude,
        temperatureC: 21 + rand() * 2.5,
        humidity: 40 + rand() * 15,
        powerKw: 3 + rand() * 3,
        powerCapacityKw: 16,
        upsMinutes: 25 + rand() * 25,
        cooling: "2× ar-condicionado de precisão 12 kW (N+1)",
        access: "Biometria + cartão",
        cameras: rand() < 0.5 ? 1 : 2,
        racks: cpdRacks,
        nodeId: core?.id,
        topology: plant?.topology,
        devices: plant?.cpd.devices ?? [],
        links: plant?.cpd.links ?? [],
      };
      const racks = (plant?.racks ?? []).map((spot, i): Room => {
        const code = spot.node.hostname!;
        const rack = buildRack(`${site.id}-${code}-0`, code, spot.heightU, spot.plan);
        const [lat, lng] = toLatLng(site.latitude!, site.longitude!, plant!.layout.get(spot.node.id)!);
        return {
          id: `${site.id}-${code}`,
          siteId: site.id,
          code,
          name: `Rack ${spot.node.location ?? code}`,
          kind: "rack",
          building: spot.node.locationEn ? `${spot.node.location} / ${spot.node.locationEn}` : (spot.node.location ?? ""),
          lat,
          lng,
          temperatureC: 25 + rand() * 4 + (i === 1 ? 4 : 0),
          humidity: 42 + rand() * 18,
          powerKw: 0.25 + rand() * 0.5,
          powerCapacityKw: 1.5,
          upsMinutes: 12 + rand() * 18,
          cooling: rand() < 0.6 ? "Ventilação forçada" : "Ventilação natural",
          access: rand() < 0.5 ? "Chave" : "Cadeado",
          cameras: 0,
          racks: [rack],
          nodeId: spot.node.id,
          topology: plant?.topology,
          devices: spot.devices,
          links: spot.links,
        };
      });
      const positions = Object.fromEntries(
        [...(plant?.layout ?? [])].map(([id, offset]) => [id, toLatLng(site.latitude!, site.longitude!, offset)]),
      );
      return {
        site,
        lat: site.latitude,
        lng: site.longitude,
        topology: plant?.topology,
        rooms: [cpd, ...racks],
        waypoints: (plant?.passives ?? []).map((n) => ({
          nodeId: n.id,
          name: n.location ?? n.id,
          bypass: !!n.bypass,
          lat: positions[n.id][0],
          lng: positions[n.id][1],
        })),
        positions,
        connections: (plant?.connections ?? []).map((c) => ({
          ...c,
          path: c.path.map((offset) => toLatLng(site.latitude!, site.longitude!, offset)),
        })),
      };
    })
    .filter((s): s is ExplorerSite => s !== null);
}

/* Room sensors drift a little; now and then a room overheats and recovers. */
export function useExplorerSimulation(initial: ExplorerSite[], tickMs = 2500) {
  const [sites, setSites] = useState(initial);
  const state = useRef(initial);

  useEffect(() => {
    state.current = initial;
    setSites(initial);
  }, [initial]);

  useEffect(() => {
    if (!initial.length) return;
    const timer = window.setInterval(() => {
      const next = state.current.map((s) => ({
        ...s,
        rooms: s.rooms.map((room) => {
          const target = room.kind === "cpd" ? 22 : 27;
          const spike = Math.random() < 0.02 ? 4 + Math.random() * 3 : 0;
          const temperatureC = Math.max(
            18,
            Math.min(38, room.temperatureC + (target - room.temperatureC) * 0.08 + (Math.random() - 0.5) * 0.6 + spike),
          );
          return {
            ...room,
            temperatureC,
            humidity: Math.max(30, Math.min(75, room.humidity + (Math.random() - 0.5) * 1.5)),
            powerKw: Math.max(0.2, room.powerKw * (1 + (Math.random() - 0.5) * 0.02)),
          };
        }),
      }));
      state.current = next;
      setSites(next);
    }, tickMs);
    return () => window.clearInterval(timer);
  }, [initial, tickMs]);

  return sites;
}
