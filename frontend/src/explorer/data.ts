import { useEffect, useRef, useState } from "react";
import type { Site } from "../api";
import { TOPOLOGIES } from "../topology/data";

/*
 * What the map shows at each plant: one CPD (core equipment, telecom and link hand-off, servers,
 * backup, storage) and several access racks, where the network is distributed. Plants with a
 * documented Layer 2 drawing (Topologia) take their racks from it; the rest get a fictitious set.
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
  else if (room.temperatureC >= warnC) issues.push({ level: "warn", text: `Temperatura alta: ${room.temperatureC.toFixed(1)} °C` });
  const load = room.powerKw / room.powerCapacityKw;
  if (load >= 0.9) issues.push({ level: "crit", text: `Carga elétrica em ${Math.round(load * 100)}%` });
  else if (load >= 0.8) issues.push({ level: "warn", text: `Carga elétrica em ${Math.round(load * 100)}%` });
  if (room.humidity >= 70) issues.push({ level: "warn", text: `Umidade alta: ${Math.round(room.humidity)}%` });
  if (room.upsMinutes < 10) issues.push({ level: "warn", text: `Autonomia do nobreak baixa: ${Math.round(room.upsMinutes)} min` });
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

/* CPD: two or three 42U racks. Network core and telecom, servers, then storage and backup. */
const CPD_RACKS: RackPlan[] = [
  [
    ["DIO 48 fibras", "patch", 2],
    ["Roteador operadora A", "other", 1],
    ["Roteador operadora B", "other", 1],
    ["FW-{S}-01 FortiGate 200F", "firewall", 1],
    ["FW-{S}-02 FortiGate 200F", "firewall", 1],
    ["SW-{S}-CORE-01 C9200L-24T", "switch", 1],
    ["SW-{S}-CORE-02 C9200L-24P", "switch", 1],
    ["Patch panel 24p", "patch", 1],
    ["Organizador de cabos", "other", 1],
    ["Nobreak APC SRT 6kVA", "ups", 4],
  ],
  [
    ["Patch panel 24p", "patch", 1],
    ["ESX01 PowerEdge R750", "server", 2],
    ["ESX02 PowerEdge R750", "server", 2],
    ["ESX03 ProLiant DL380", "server", 2],
    ["Console KVM", "other", 1],
    ["Nobreak APC SRT 10kVA", "ups", 6],
  ],
  [
    ["Storage PowerStore 500T", "storage", 2],
    ["NAS Synology RS3621", "storage", 2],
    ["Backup Veeam PowerEdge R650", "server", 1],
    ["Fita LTO-8 TL1000", "storage", 2],
  ],
];

/* Access racks: 12U or 16U wall-mount cabinets with fibre, a switch and a small nobreak. */
function accessPlan(heightU: 12 | 16, switchLabel: string): RackPlan {
  return heightU === 16
    ? [
        ["DIO 24 fibras", "patch", 1],
        ["Patch panel 24p", "patch", 1],
        [switchLabel, "switch", 1],
        ["Organizador de cabos", "other", 1],
        ["Nobreak 2kVA", "ups", 2],
      ]
    : [
        ["DIO 12 fibras", "patch", 1],
        [switchLabel, "switch", 1],
        ["Nobreak 1kVA", "ups", 2],
      ];
}

function buildRack(id: string, name: string, heightU: number, plan: RackPlan, code: string, rand: () => number): Rack {
  let u = 1;
  const units: RackUnit[] = [];
  // Mount from the bottom, heavy gear (nobreak) first, leaving occasional gaps like a real rack.
  for (const [label, kind, size] of [...plan].reverse()) {
    units.push({ start: u, size, label: label.replace("{S}", code), kind });
    u += size + (rand() < 0.3 && u + size < heightU - 2 ? 1 : 0);
  }
  return {
    id,
    name,
    heightU,
    units,
    powerKw: units.reduce((s, x) => s + (x.kind === "server" ? 0.55 : x.kind === "storage" ? 0.7 : 0.12) * x.size, 0),
  };
}

interface RackSpot {
  code: string;
  name: string;
  building: string;
  switchLabel: string;
}

const GENERIC_RACKS: RackSpot[] = [
  { code: "RK-ADM", name: "Administrativo", building: "Prédio administrativo", switchLabel: "SW-{S}-ADM-01 C2960-24TC-L" },
  { code: "RK-BRIT", name: "Britagem", building: "Britagem primária", switchLabel: "SW-{S}-BRIT-01 C2960-24TC-L" },
  { code: "RK-FORNO", name: "Fornos", building: "Área de calcinação", switchLabel: "SW-{S}-FORNO-01 C9200L-24P-4G" },
  { code: "RK-EXPED", name: "Expedição", building: "Balança e expedição", switchLabel: "SW-{S}-EXP-01 C2960-24TC-L" },
  { code: "RK-OFIC", name: "Oficina", building: "Oficina mecânica", switchLabel: "SW-{S}-OFI-01 C2960-24TC-L" },
  { code: "RK-PORT", name: "Portaria", building: "Portaria principal", switchLabel: "SW-{S}-PORT-01 C2960-24TC-L" },
];

/* Racks from the plant's Layer 2 drawing: every switch outside the CPD is an access rack. */
function documentedRacks(site: Site): { spots: RackSpot[]; cpdHost?: string } | null {
  const topo = TOPOLOGIES.find(
    (t) => t.code === site.code || (site.city && t.city.toLowerCase().startsWith(site.city.toLowerCase())),
  );
  if (!topo) return null;
  // Nodes drawn inside a group belong to another site (BR-ACS shows Limeira's CPD for context).
  const elsewhere = (n: (typeof topo.nodes)[number]) =>
    topo.groups?.some((g) => n.x >= g.x && n.x <= g.x + g.w && n.y >= g.y && n.y <= g.y + g.h);
  const switches = topo.nodes.filter((n) => (n.kind === "switch" || n.kind === "core") && n.hostname && n.ip && !elsewhere(n));
  // The CPD is the node whose location says so; a plant drawn without one keeps its first core node there.
  const cpd = switches.find((n) => n.location?.toUpperCase().startsWith("CPD")) ?? switches.find((n) => n.kind === "core");
  return {
    cpdHost: cpd?.hostname,
    spots: switches
      .filter((n) => n !== cpd && !n.location?.toUpperCase().startsWith("CPD") && !n.locationEn?.toLowerCase().includes("server room"))
      .map((n) => ({
        code: n.hostname!,
        name: n.location ?? n.hostname!,
        building: n.locationEn ? `${n.location} / ${n.locationEn}` : (n.location ?? ""),
        switchLabel: `${n.hostname} ${n.model ?? ""}`.trim(),
      })),
  };
}

/* Racks spread around the CPD on a loose spiral, a few hundred metres apart like a plant's buildings. */
function offset(i: number, rand: () => number): [number, number] {
  const angle = i * 2.4 + rand() * 0.5;
  const dist = 0.0035 + i * 0.0011 + rand() * 0.0012;
  return [Math.sin(angle) * dist, Math.cos(angle) * dist * 1.1];
}

export interface ExplorerSite {
  site: Site;
  lat: number;
  lng: number;
  rooms: Room[];
}

export function buildExplorer(sites: Site[]): ExplorerSite[] {
  return sites
    .map((site, siteIndex) => {
      if (site.latitude === null || site.longitude === null) return null;
      const rand = rng(Math.abs(site.id) * 7349 + 3);
      const code = site.code.replace(/^BR-/, "");
      const documented = documentedRacks(site);
      const cpdRacks = CPD_RACKS.slice(0, siteIndex % 2 === 0 ? 3 : 2).map((plan, j) =>
        buildRack(`${site.id}-CPD-${j}`, `RK-0${j + 1}`, 42, plan, code, rand),
      );
      const cpd: Room = {
        id: `${site.id}-CPD`,
        siteId: site.id,
        code: "CPD",
        name: "CPD",
        kind: "cpd",
        building: documented?.cpdHost ? `Prédio administrativo · switch core ${documented.cpdHost}` : "Prédio administrativo · térreo",
        lat: site.latitude,
        lng: site.longitude,
        temperatureC: 21 + rand() * 2.5,
        humidity: 40 + rand() * 15,
        powerKw: cpdRacks.reduce((s, r) => s + r.powerKw, 0) * (1.1 + rand() * 0.2),
        powerCapacityKw: 16,
        upsMinutes: 25 + rand() * 25,
        cooling: "2× ar-condicionado de precisão 12 kW (N+1)",
        access: "Biometria + cartão",
        cameras: rand() < 0.5 ? 1 : 2,
        racks: cpdRacks,
      };
      const spots = documented?.spots ?? GENERIC_RACKS.slice(0, siteIndex % 2 === 0 ? 6 : 5);
      const racks = spots.map((spot, i): Room => {
        const heightU = rand() < 0.5 ? 16 : 12;
        const rack = buildRack(`${site.id}-${spot.code}-0`, spot.code, heightU, accessPlan(heightU, spot.switchLabel), code, rand);
        const [dLat, dLng] = offset(i, rand);
        return {
          id: `${site.id}-${spot.code}`,
          siteId: site.id,
          code: spot.code,
          name: `Rack ${spot.name}`,
          kind: "rack",
          building: spot.building,
          lat: site.latitude! + dLat,
          lng: site.longitude! + dLng,
          temperatureC: 25 + rand() * 4 + (i === 1 ? 4 : 0),
          humidity: 42 + rand() * 18,
          powerKw: rack.powerKw * (1.1 + rand() * 0.3),
          powerCapacityKw: 1.5,
          upsMinutes: 12 + rand() * 18,
          cooling: rand() < 0.6 ? "Ventilação forçada" : "Ventilação natural",
          access: rand() < 0.5 ? "Chave" : "Cadeado",
          cameras: 0,
          racks: [rack],
        };
      });
      return { site, lat: site.latitude, lng: site.longitude, rooms: [cpd, ...racks] };
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
          const temperatureC = Math.max(18, Math.min(38, room.temperatureC + (target - room.temperatureC) * 0.08 + (Math.random() - 0.5) * 0.6 + spike));
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
