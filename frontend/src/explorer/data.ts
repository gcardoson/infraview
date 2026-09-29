import { useEffect, useRef, useState } from "react";
import type { Site } from "../api";

/* Fictitious technical rooms, datacenters and racks per site, placed around the site's coordinates. */

export type RoomKind = "datacenter" | "sala" | "armario";
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
  racks: Rack[];
}

export const KIND_LABEL: Record<RoomKind, string> = {
  datacenter: "Datacenter",
  sala: "Sala técnica",
  armario: "Armário de rede",
};

export const KIND_SHORT: Record<RoomKind, string> = { datacenter: "DC", sala: "ST", armario: "AR" };

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
  if (room.temperatureC >= 30) issues.push({ level: "crit", text: `Temperatura crítica: ${room.temperatureC.toFixed(1)} °C` });
  else if (room.temperatureC >= 27) issues.push({ level: "warn", text: `Temperatura alta: ${room.temperatureC.toFixed(1)} °C` });
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

const DC_RACKS: RackPlan[] = [
  [
    ["Patch panel 48p", "patch", 2],
    ["FW-{S}-01 FortiGate 200F", "firewall", 1],
    ["FW-{S}-02 FortiGate 200F", "firewall", 1],
    ["SW-{S}-CORE-01 Aruba 6300M", "switch", 1],
    ["SW-{S}-DIST-01 Aruba 6300F", "switch", 1],
    ["Organizador de cabos", "other", 1],
    ["Nobreak APC SRT 6kVA", "ups", 4],
  ],
  [
    ["Patch panel 24p", "patch", 1],
    ["ESX01 PowerEdge R750", "server", 2],
    ["ESX02 PowerEdge R750", "server", 2],
    ["ESX03 ProLiant DL380", "server", 2],
    ["ESX04 PowerEdge R740", "server", 2],
    ["Nobreak APC SRT 10kVA", "ups", 6],
  ],
  [
    ["Storage PowerStore 500T", "storage", 2],
    ["NAS Synology RS3621", "storage", 2],
    ["Switch SAN Brocade G620", "switch", 1],
    ["Switch SAN Brocade G620", "switch", 1],
    ["Backup Veeam PowerEdge R650", "server", 1],
    ["Fita LTO-8 TL1000", "storage", 2],
  ],
  [
    ["Patch panel 48p", "patch", 2],
    ["Servidor legado R630", "server", 1],
    ["Servidor legado R620", "server", 1],
    ["Console KVM", "other", 1],
  ],
];

const ROOM_RACKS: RackPlan[] = [
  [
    ["Patch panel 48p", "patch", 2],
    ["SW-{S}-ADM-01 Aruba 2930F-48G", "switch", 1],
    ["SW-{S}-ADM-02 Aruba 2930F-24G", "switch", 1],
    ["Organizador de cabos", "other", 1],
    ["Nobreak APC SMT 3kVA", "ups", 2],
  ],
  [
    ["DIO 24 fibras", "patch", 1],
    ["SW-{S}-PROD-01 Aruba 2930F-48G", "switch", 1],
    ["Switch industrial Hirschmann", "switch", 1],
    ["Nobreak APC SMT 1,5kVA", "ups", 2],
  ],
];

const CABINET_RACK: RackPlan = [
  ["DIO 12 fibras", "patch", 1],
  ["SW-{S}-PORT-01 HPE 1920S-8G", "switch", 1],
  ["Nobreak 1kVA", "ups", 2],
];

function buildRack(id: string, name: string, heightU: number, plan: RackPlan, code: string, rand: () => number): Rack {
  let u = 1;
  const units: RackUnit[] = [];
  // Mount from the bottom, heavy gear (nobreak) first, leaving occasional gaps like a real rack.
  for (const [label, kind, size] of [...plan].reverse()) {
    units.push({ start: u, size, label: label.replace("{S}", code), kind });
    u += size + (rand() < 0.35 ? 1 : 0);
  }
  return {
    id,
    name,
    heightU,
    units,
    powerKw: units.reduce((s, x) => s + (x.kind === "server" ? 0.55 : x.kind === "storage" ? 0.7 : 0.12) * x.size, 0),
  };
}

interface RoomPlan {
  code: string;
  name: string;
  kind: RoomKind;
  building: string;
  offset: [number, number];
  racks: { name: string; heightU: number; plan: RackPlan }[];
  capacityKw: number;
  cooling: string;
}

function plansFor(siteIndex: number): RoomPlan[] {
  const plans: RoomPlan[] = [
    {
      code: "DC-01",
      name: "Datacenter principal",
      kind: "datacenter",
      building: "Prédio administrativo · térreo",
      offset: [0, 0],
      racks: DC_RACKS.slice(0, siteIndex % 2 === 0 ? 4 : 3).map((plan, i) => ({ name: `RK-0${i + 1}`, heightU: 42, plan })),
      capacityKw: 24,
      cooling: "2× ar-condicionado de precisão 12 kW (N+1)",
    },
    {
      code: "ST-ADM",
      name: "Sala técnica administrativa",
      kind: "sala",
      building: "Prédio administrativo · 1º andar",
      offset: [0.0009, 0.0011],
      racks: [{ name: "RK-01", heightU: 24, plan: ROOM_RACKS[0] }],
      capacityKw: 4,
      cooling: "Split 18.000 BTU",
    },
    {
      code: "ST-BRIT",
      name: "Sala técnica britagem",
      kind: "sala",
      building: "Britagem primária",
      offset: [-0.0062, 0.0071],
      racks: [{ name: "RK-01", heightU: 24, plan: ROOM_RACKS[1] }],
      capacityKw: 3,
      cooling: "Split 12.000 BTU",
    },
    {
      code: "ST-FORNO",
      name: "Sala técnica fornos",
      kind: "sala",
      building: "Área de calcinação",
      offset: [0.0048, -0.0083],
      racks: [{ name: "RK-01", heightU: 24, plan: ROOM_RACKS[1] }],
      capacityKw: 3,
      cooling: "Split 12.000 BTU com filtro",
    },
    {
      code: "AR-PORT",
      name: "Armário da portaria",
      kind: "armario",
      building: "Portaria principal",
      offset: [-0.0101, -0.0034],
      racks: [{ name: "RK-01", heightU: 12, plan: CABINET_RACK }],
      capacityKw: 1,
      cooling: "Ventilação forçada",
    },
  ];
  return siteIndex % 2 === 0 ? plans : plans.filter((p) => p.code !== "ST-FORNO");
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
      const rooms = plansFor(siteIndex).map((p, i): Room => {
        const racks = p.racks.map((r, j) => buildRack(`${site.id}-${p.code}-${j}`, r.name, r.heightU, r.plan, code, rand));
        const powerKw = racks.reduce((s, r) => s + r.powerKw, 0) * (1.1 + rand() * 0.25);
        return {
          id: `${site.id}-${p.code}`,
          siteId: site.id,
          code: p.code,
          name: p.name,
          kind: p.kind,
          building: p.building,
          lat: site.latitude! + p.offset[0],
          lng: site.longitude! + p.offset[1],
          temperatureC: p.kind === "datacenter" ? 21 + rand() * 2.5 : 23 + rand() * 4 + (i === 2 ? 2.5 : 0),
          humidity: 40 + rand() * 18,
          powerKw,
          powerCapacityKw: p.capacityKw,
          upsMinutes: p.kind === "armario" ? 12 + rand() * 10 : 18 + rand() * 30,
          cooling: p.cooling,
          access: p.kind === "datacenter" ? "Biometria + cartão" : p.kind === "sala" ? "Cartão" : "Chave",
          racks,
        };
      });
      return { site, lat: site.latitude!, lng: site.longitude!, rooms };
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
          const target = room.kind === "datacenter" ? 22 : 25;
          const spike = Math.random() < 0.02 ? 4 + Math.random() * 3 : 0;
          const temperatureC = Math.max(18, Math.min(34, room.temperatureC + (target - room.temperatureC) * 0.08 + (Math.random() - 0.5) * 0.6 + spike));
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
