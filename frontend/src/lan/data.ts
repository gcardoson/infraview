import { useEffect, useRef, useState } from "react";
import type { Site } from "../api";

/* Fictitious switch inventory and port telemetry, used until the LibreNMS/PRTG collection exists. */

export type PortLink = "up" | "down";
export type PortColor = "ok" | "warn" | "crit" | "off";

export interface SwitchPort {
  index: number;
  name: string;
  uplink: boolean;
  adminUp: boolean;
  link: PortLink;
  speedMbps: number | null;
  vlan: number | null;
  description: string | null;
  poeWatts: number | null;
  errors: number;
  utilization: number;
}

export interface NetworkSwitch {
  id: string;
  siteId: number;
  siteCode: string;
  siteName: string;
  hostname: string;
  role: "Core" | "Distribuição" | "Acesso";
  model: string;
  managementIp: string;
  firmware: string;
  uptimeDays: number;
  ports: SwitchPort[];
}

export interface LanLogEntry {
  id: number;
  time: Date;
  level: "info" | "warn" | "error";
  tag: string;
  message: string;
}

export const COLOR_LABEL: Record<PortColor, string> = {
  ok: "Conectada",
  warn: "Alerta / 100 Mbps",
  crit: "Desconectada / erro / 10 Mbps",
  off: "Desabilitada",
};

/* The rule the user asked for: gray disabled, red down/error/10 Mbps, amber alert/100 Mbps, green connected. */
export function portColor(port: SwitchPort): PortColor {
  if (!port.adminUp) return "off";
  if (port.link === "down" || port.errors >= 100 || port.speedMbps === 10) return "crit";
  if (port.errors > 0 || port.speedMbps === 100 || port.utilization >= 85) return "warn";
  return "ok";
}

export function portProblem(port: SwitchPort): string | null {
  if (!port.adminUp) return "Desabilitada administrativamente";
  if (port.link === "down") return "Sem link";
  if (port.errors >= 100) return `${port.errors} erros CRC`;
  if (port.speedMbps === 10) return "Negociada em 10 Mbps";
  if (port.errors > 0) return `${port.errors} erros CRC`;
  if (port.speedMbps === 100) return "Negociada em 100 Mbps";
  if (port.utilization >= 85) return `Utilização alta (${port.utilization}%)`;
  return null;
}

export function switchHealth(sw: NetworkSwitch): number {
  const enabled = sw.ports.filter((p) => p.adminUp);
  if (!enabled.length) return 100;
  const score = enabled.reduce((sum, p) => sum + { ok: 1, warn: 0.5, crit: 0, off: 1 }[portColor(p)], 0);
  return (score / enabled.length) * 100;
}

export const speedLabel = (mbps: number | null) =>
  mbps === null ? "—" : mbps >= 1000 ? `${mbps / 1000} Gbps` : `${mbps} Mbps`;

/* Small deterministic PRNG so every browser shows the same fictitious network for the same sites. */
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

const VLANS = [
  { id: 10, name: "Corporativo", devices: ["PC", "NB", "PRN"] },
  { id: 20, name: "Voz", devices: ["TEL"] },
  { id: 30, name: "Automação", devices: ["CLP", "IHM", "SCADA"] },
  { id: 40, name: "CFTV", devices: ["CAM"] },
  { id: 50, name: "Wi-Fi", devices: ["AP"] },
];

interface Blueprint {
  role: NetworkSwitch["role"];
  suffix: string;
  model: string;
  access: number;
  uplinks: number;
}

const BLUEPRINTS: Blueprint[] = [
  { role: "Core", suffix: "CORE-01", model: "Aruba 6300M", access: 24, uplinks: 4 },
  { role: "Distribuição", suffix: "DIST-01", model: "Aruba 6200F", access: 24, uplinks: 4 },
  { role: "Acesso", suffix: "ADM-01", model: "Aruba 2930F", access: 48, uplinks: 4 },
  { role: "Acesso", suffix: "PROD-01", model: "Aruba 2930F", access: 48, uplinks: 4 },
  { role: "Acesso", suffix: "PROD-02", model: "Aruba 2930F", access: 24, uplinks: 2 },
  { role: "Acesso", suffix: "BAL-01", model: "HPE 1920S", access: 24, uplinks: 2 },
  { role: "Acesso", suffix: "PORT-01", model: "HPE 1920S", access: 8, uplinks: 2 },
];

export const MAX_PORTS = Math.max(...BLUEPRINTS.map((b) => b.access + b.uplinks));

function buildSwitch(site: Site, siteIndex: number, bp: Blueprint, swIndex: number): NetworkSwitch {
  const rand = rng(site.id * 7919 + swIndex * 104729);
  const pick = <T,>(items: T[]) => items[Math.floor(rand() * items.length)];
  const ports: SwitchPort[] = [];
  const total = bp.access + bp.uplinks;
  for (let i = 1; i <= total; i++) {
    const uplink = i > bp.access;
    const used = uplink ? i <= bp.access + 2 : rand() < (bp.role === "Acesso" ? 0.72 : 0.85);
    const adminUp = used || rand() < 0.08;
    const up = used && rand() > 0.015;
    const vlan = uplink ? null : bp.role === "Acesso" ? pick(VLANS) : null;
    let speed: number | null = null;
    if (up) {
      if (uplink) speed = bp.role === "Acesso" ? 1000 : 10000;
      else {
        const r = rand();
        speed = r < 0.015 ? 10 : r < 0.07 ? 100 : bp.role === "Acesso" ? 1000 : pick([1000, 10000]);
      }
    }
    const peer = uplink
      ? i === bp.access + 1
        ? `${site.code}-${swIndex === 0 ? "FW-01" : "CORE-01"}`
        : `${site.code}-${swIndex === 0 ? "FW-02" : "DIST-01"}`
      : vlan
        ? `${pick(vlan.devices)}-${site.code}-${String(Math.floor(rand() * 900) + 100)}`
        : `${site.code}-SW-${String(Math.floor(rand() * 20) + 2).padStart(2, "0")}`;
    const errorRoll = rand();
    ports.push({
      index: i,
      name: uplink ? `1/1/${i - bp.access}` : `1/0/${i}`,
      uplink,
      adminUp,
      link: up ? "up" : "down",
      speedMbps: speed,
      vlan: vlan?.id ?? null,
      description: used ? (uplink ? `Uplink ${peer}` : peer) : null,
      poeWatts: up && vlan && ["TEL", "AP", "CAM"].some((d) => peer.startsWith(d)) ? Math.round(rand() * 120) / 10 + 3 : null,
      errors: up ? (errorRoll < 0.008 ? 150 + Math.floor(rand() * 900) : errorRoll < 0.03 ? 1 + Math.floor(rand() * 40) : 0) : 0,
      utilization: up ? Math.floor(rand() * (uplink ? 70 : 45)) + (uplink ? 20 : 1) : 0,
    });
  }
  const octet = 10 + siteIndex;
  return {
    id: `${site.id}-${swIndex}`,
    siteId: site.id,
    siteCode: site.code,
    siteName: site.name,
    hostname: `${site.code}-${bp.suffix}`,
    role: bp.role,
    model: bp.model,
    managementIp: `10.${octet}.99.${swIndex + 2}`,
    firmware: bp.model.startsWith("HPE") ? "PD.02.14" : "10.13.1010",
    uptimeDays: Math.floor(rand() * 400) + 3,
    ports,
  };
}

const FALLBACK_SITES: Site[] = [
  { id: -1, code: "BR-ARC", name: "Planta Arcos", city: null, state: null, country: null, notes: null },
  { id: -2, code: "BR-MAT", name: "Planta Matozinhos", city: null, state: null, country: null, notes: null },
];

export function buildNetwork(sites: Site[]): NetworkSwitch[] {
  const source = sites.length ? sites : FALLBACK_SITES;
  return source.flatMap((site, siteIndex) => {
    // Larger sites get the full stack; the rest get a trimmed one so groups vary in size.
    const blueprints = siteIndex % 2 === 0 ? BLUEPRINTS : BLUEPRINTS.filter((_, i) => i !== 3 && i !== 5);
    return blueprints.map((bp, i) => buildSwitch(site, siteIndex, bp, i));
  });
}

/* Drifts the fictitious ports so the screen looks alive: links drop and return, speeds renegotiate, CRC errors appear. */
export function useLanSimulation(initial: NetworkSwitch[], tickMs = 1800) {
  const [switches, setSwitches] = useState(initial);
  const [log, setLog] = useState<LanLogEntry[]>([]);
  const seq = useRef(0);
  const state = useRef(initial);

  useEffect(() => {
    state.current = initial;
    setSwitches(initial);
    setLog([]);
  }, [initial]);

  useEffect(() => {
    if (!initial.length) return;
    const timer = window.setInterval(() => {
      const entries: LanLogEntry[] = [];
      const push = (level: LanLogEntry["level"], tag: string, message: string) =>
        entries.push({ id: ++seq.current, time: new Date(), level, tag, message });

      {
        const next = state.current.map((sw) => ({ ...sw, ports: sw.ports.map((p) => ({ ...p })) }));
        const events = Math.random() < 0.35 ? 2 : 1;
        for (let n = 0; n < events; n++) {
          const sw = next[Math.floor(Math.random() * next.length)];
          const candidates = sw.ports.filter((p) => p.adminUp && p.description);
          const port = candidates[Math.floor(Math.random() * candidates.length)];
          if (!port) continue;
          const where = `${sw.hostname} ${port.name}`;
          const roll = Math.random();
          if (port.link === "down") {
            port.link = "up";
            port.speedMbps = port.uplink ? (sw.role === "Acesso" ? 1000 : 10000) : 1000;
            port.errors = 0;
            push("info", "LINK", `${where} link UP ${speedLabel(port.speedMbps)} (${port.description})`);
          } else if (roll < 0.2 && !port.uplink) {
            port.link = "down";
            port.speedMbps = null;
            port.utilization = 0;
            push("error", "LINK", `${where} link DOWN (${port.description})`);
          } else if (roll < 0.32 && !port.uplink) {
            port.speedMbps = Math.random() < 0.4 ? 10 : 100;
            push(port.speedMbps === 10 ? "error" : "warn", "SPEED", `${where} renegociou em ${speedLabel(port.speedMbps)} half/full`);
          } else if (roll < 0.42) {
            port.errors += Math.floor(Math.random() * 60) + 5;
            push(port.errors >= 100 ? "error" : "warn", "CRC", `${where} acumulou ${port.errors} erros de entrada`);
          } else {
            const wasProblem = portColor(port) !== "ok";
            port.errors = 0;
            if (port.speedMbps !== null && port.speedMbps < 1000) port.speedMbps = 1000;
            port.utilization = Math.min(99, Math.max(1, port.utilization + Math.round((Math.random() - 0.5) * 30)));
            if (wasProblem && portColor(port) === "ok") push("info", "OK", `${where} normalizada`);
            else if (port.utilization >= 85) push("warn", "UTIL", `${where} com utilização de ${port.utilization}%`);
          }
        }
        state.current = next;
        setSwitches(next);
      }
      if (entries.length) setLog((current) => [...entries.reverse(), ...current].slice(0, 200));
    }, tickMs);
    return () => window.clearInterval(timer);
  }, [initial, tickMs]);

  return { switches, log };
}
