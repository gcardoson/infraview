import { useEffect, useRef, useState } from "react";
import type { RoomKind, RoomRecord, Site } from "../api";
import type { Medium, NodeKind, SiteTopology, TopoLink, TopoNode } from "../topology/data";

/*
 * What the map shows at each plant: one CPD (core equipment, telecom and link hand-off, servers,
 * backup, storage) and several access racks, where the network is distributed. Rooms are registered per
 * site; the switch a room holds (its node in the plant's Layer 2 drawing) gives its equipment and links.
 * Room sensors and power stay simulated until they are collected.
 */

export type { RoomKind };
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
  record: RoomRecord;
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

/* Equipment and links of the room that holds `node`, from the plant's Layer 2 drawing. */
function spotOf(topo: SiteTopology, node: TopoNode, cpd: boolean): Spot {
  const byId = new Map(topo.nodes.map((n) => [n.id, n]));
  const name = (n?: TopoNode) => (n ? (n.hostname ?? n.location ?? n.id) : "?");
  const peers = topo.links
    .filter((l) => l.a.node === node.id || l.b.node === node.id)
    .map((l) => {
      const [own, other] = l.a.node === node.id ? [l.a, l.b] : [l.b, l.a];
      return { link: l, own, end: other, other: byId.get(other.node) };
    });
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
  stack.forEach((m, i) => plan.push([`${node.hostname ?? node.id}${stack.length > 1 ? ` #${i + 1}` : ""} ${m}`.trim(), "switch", 1]));
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
}

// Nodes drawn inside a group belong to another site (BR-ACS shows Limeira's CPD for context).
const elsewhere = (topo: SiteTopology, n: TopoNode) =>
  !!topo.groups?.some((g) => n.x >= g.x && n.x <= g.x + g.w && n.y >= g.y && n.y <= g.y + g.h);

/* Switches of a drawing that can sit in a room: the ones with a hostname, outside context groups. */
export const roomNodes = (topo: SiteTopology) =>
  topo.nodes.filter((n) => (n.kind === "switch" || n.kind === "core") && n.hostname && !elsewhere(topo, n));

/*
 * The drawings carry no geography, so the map keeps the drawing's layout around the CPD's switch,
 * scaled so the plant spans about 2 km (metres east/north of it). Passive points stay as waypoints.
 */
function drawingLayout(topo: SiteTopology, centreNode: TopoNode | undefined) {
  const placed = [...roomNodes(topo), ...topo.nodes.filter((n) => n.kind === "passive" && !elsewhere(topo, n))];
  if (!placed.length) return { layout: new Map<string, Xy>(), passives: [] as TopoNode[] };
  const centre = (n: TopoNode) => [n.x + n.w / 2, n.y + n.h / 2];
  const [cx, cy] = centre(centreNode ?? placed[0]);
  const span = Math.max(1, Math.max(...placed.map((n) => centre(n)[0])) - Math.min(...placed.map((n) => centre(n)[0])));
  const metres = 2000 / span;
  // The drawings are wide and short; stretching the rows apart keeps labels readable on the map.
  const layout = new Map(placed.map((n) => [n.id, [(centre(n)[0] - cx) * metres, -(centre(n)[1] - cy) * metres * 1.6] as Xy]));
  return { layout, passives: placed.filter((n) => n.kind === "passive") };
}

/* One line per pair of placed nodes; parallel cables (two fibres to the same building) share it. */
function plantConnections(topo: SiteTopology, layout: Map<string, Xy>) {
  const connections = new Map<string, PlantConnection>();
  for (const link of topo.links) {
    if (!layout.has(link.a.node) || !layout.has(link.b.node)) continue;
    const [a, b] = [link.a.node, link.b.node].sort();
    const key = `${a}~${b}`;
    const entry = connections.get(key) ?? { id: key, a, b, links: [], path: route(layout.get(a)!, layout.get(b)!, [...layout.values()]) };
    entry.links.push(link);
    connections.set(key, entry);
  }
  return [...connections.values()];
}

/* A line on the map between two places of a plant, carrying every documented cable between them. */
export interface PlantConnection {
  id: string;
  a: string;
  b: string;
  links: TopoLink[];
  /* Metres east/north of the CPD while laid out; latitude/longitude once placed on the map. */
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

const METRES_PER_DEGREE = 111_320;
const toLatLng = (lat: number, lng: number, [east, north]: Xy): [number, number] => [
  lat + north / METRES_PER_DEGREE,
  lng + east / (METRES_PER_DEGREE * Math.cos((lat * Math.PI) / 180)),
];
const toOffset = (lat: number, lng: number, at: [number, number]): Xy => [
  (at[1] - lng) * METRES_PER_DEGREE * Math.cos((lat * Math.PI) / 180),
  (at[0] - lat) * METRES_PER_DEGREE,
];

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

export function buildExplorer(sites: Site[], records: RoomRecord[], topologies: SiteTopology[]): ExplorerSite[] {
  return sites
    .map((site): ExplorerSite | null => {
      if (site.latitude === null || site.longitude === null) return null;
      const [lat0, lng0] = [site.latitude, site.longitude];
      const topo = topologies.find((t) => t.siteId === site.id);
      const own = records
        .filter((r) => r.site_id === site.id)
        .sort((a, b) => (a.kind === b.kind ? a.id - b.id : a.kind === "cpd" ? -1 : 1));
      const nodeOf = (r: RoomRecord) => (topo && r.node_id ? topo.nodes.find((n) => n.id === r.node_id) : undefined);
      const cpdRecord = own.find((r) => r.kind === "cpd");
      const { layout, passives } = topo ? drawingLayout(topo, cpdRecord && nodeOf(cpdRecord)) : { layout: new Map<string, Xy>(), passives: [] };

      // Where each room goes: its own coordinates, else its switch's place in the drawing, else the site
      // (the CPD) or a ring around it (racks with neither).
      const unplaced = own.filter((r) => r.latitude === null && !(nodeOf(r) && layout.has(nodeOf(r)!.id)) && r.kind !== "cpd");
      const offsetOf = (r: RoomRecord): Xy => {
        if (r.latitude !== null && r.longitude !== null) return toOffset(lat0, lng0, [r.latitude, r.longitude]);
        const node = nodeOf(r);
        if (node && layout.has(node.id)) return layout.get(node.id)!;
        if (r.kind === "cpd") return [0, 0];
        const angle = (unplaced.indexOf(r) / Math.max(1, unplaced.length)) * 2 * Math.PI;
        return [Math.cos(angle) * 350, Math.sin(angle) * 350];
      };
      for (const r of own) {
        const node = nodeOf(r);
        if (node) layout.set(node.id, offsetOf(r));
      }

      const rooms = own.map((record, i): Room => {
        const node = nodeOf(record);
        const cpd = record.kind === "cpd";
        const spot = node && topo ? spotOf(topo, node, cpd) : null;
        // The first rack holds the network equipment of the room's switch.
        const racks = record.racks.map((spec, k) =>
          buildRack(`${record.id}-${k}`, spec.name, spec.heightU, k === 0 ? (spot?.plan ?? []) : []),
        );
        const [lat, lng] = toLatLng(lat0, lng0, offsetOf(record));
        const r = rng(record.id * 7919 + 11);
        return {
          id: String(record.id),
          record,
          siteId: site.id,
          code: record.code,
          name: record.name,
          kind: record.kind,
          building: record.building ?? (cpd && node ? `Switch central ${node.hostname}` : ""),
          lat,
          lng,
          temperatureC: cpd ? 21 + r() * 2.5 : 25 + r() * 4 + (i === 2 ? 4 : 0),
          humidity: cpd ? 40 + r() * 15 : 42 + r() * 18,
          powerKw: cpd ? 3 + r() * 3 : 0.25 + r() * 0.5,
          powerCapacityKw: record.power_capacity_kw ?? (cpd ? 16 : 1.5),
          upsMinutes: cpd ? 25 + r() * 25 : 12 + r() * 18,
          cooling: record.cooling ?? "—",
          access: record.access ?? "—",
          cameras: record.cameras,
          racks,
          nodeId: node?.id,
          topology: topo?.code,
          devices: spot?.devices ?? [],
          links: spot?.links ?? [],
        };
      });

      const connections = topo ? plantConnections(topo, layout) : [];
      const positions = Object.fromEntries([...layout].map(([id, offset]) => [id, toLatLng(lat0, lng0, offset)]));
      return {
        site,
        lat: lat0,
        lng: lng0,
        topology: topo?.code,
        rooms,
        waypoints: passives.map((n) => ({
          nodeId: n.id,
          name: n.location ?? n.id,
          bypass: !!n.bypass,
          lat: positions[n.id][0],
          lng: positions[n.id][1],
        })),
        positions,
        connections: connections.map((c) => ({ ...c, path: c.path.map((offset) => toLatLng(lat0, lng0, offset)) })),
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
