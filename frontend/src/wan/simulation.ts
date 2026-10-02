// Fictitious telemetry and log events, used until the LibreNMS/PRTG integration
// provides real data. Everything here is random, but loosely coherent: backup links
// stay in standby until a primary link fails, and every state change is logged.
import { useEffect, useRef, useState } from "react";
import type { InternetLink } from "../api";

export type LinkHealth = "up" | "degraded" | "down" | "standby";

export interface LinkTelemetry {
  health: LinkHealth;
  latencyMs: number;
  lossPct: number;
  usageMbps: number;
  history: number[];
  // One bucket per hour of the last 24h: 1 = ok, 0.5 = degraded, 0 = down.
  availability: number[];
  // Ticks left in the current incident, if any.
  incident: number;
}

export type LogLevel = "info" | "warn" | "error";

/* The site's SD-WAN edge: two VMware VeloCloud Edge 620 in high availability (active/standby). */
export const EDGE_MODEL = "VMware VeloCloud Edge 620";
export type HaState = "synced" | "syncing" | "lost";

export interface EdgeHa {
  state: HaState;
  /* Which of the pair (1 or 2) is forwarding traffic. */
  active: 1 | 2;
  since: Date;
  // Ticks left in the current loss or resync, if any.
  incident: number;
}

export const HA_LABEL: Record<HaState, string> = {
  synced: "HA sincronizado",
  syncing: "HA ressincronizando",
  lost: "HA sem sincronismo",
};

export interface LogEntry {
  id: number;
  time: Date;
  tag: string;
  message: string;
  level: LogLevel;
}

const HISTORY = 48;
const TICK_MS = 1600;
const MAX_LOG = 200;

const rand = (min: number, max: number) => min + Math.random() * (max - min);
const pick = <T>(items: T[]): T => items[Math.floor(Math.random() * items.length)];
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const baseLatency = (link: InternetLink) =>
  link.technology?.toLowerCase().includes("sat") ? 38 : link.technology?.includes("4G") ? 45 : 12;

function initialTelemetry(link: InternetLink): LinkTelemetry {
  const capacity = link.bandwidth_mbps ?? 100;
  const standby = link.role === "backup";
  const level = standby ? 0.03 : link.role === "primary" ? 0.55 : 0.3;
  return {
    health: standby ? "standby" : "up",
    latencyMs: baseLatency(link) + rand(0, 6),
    lossPct: 0,
    usageMbps: capacity * level,
    history: Array.from({ length: HISTORY }, () => capacity * clamp(level + rand(-0.1, 0.1), 0, 1)),
    availability: Array.from({ length: 24 }, () => {
      const roll = Math.random();
      return roll < 0.01 ? 0 : roll < 0.05 ? 0.5 : 1;
    }),
    incident: 0,
  };
}

function genericEvent(link: InternetLink, t: LinkTelemetry): Omit<LogEntry, "id" | "time"> {
  const port = link.sdwan_port ?? "wan";
  const device = link.sdwan_device ?? "SD-WAN";
  const vlan = link.vlans.length ? pick(link.vlans) : null;
  const options: Omit<LogEntry, "id" | "time">[] = [
    {
      tag: "SDWAN",
      level: "info",
      message: `Health-check ${port} (${link.provider}): latência ${t.latencyMs.toFixed(0)} ms, perda ${t.lossPct.toFixed(1)}%.`,
    },
    {
      tag: "TRAFFIC",
      level: "info",
      message: `${device}/${port} em ${t.usageMbps.toFixed(0)} de ${link.bandwidth_mbps ?? "?"} Mbps.`,
    },
    {
      tag: "SNMP",
      level: "info",
      message: `Coleta de interfaces em ${device} concluída.`,
    },
  ];
  if (link.nat_enabled) {
    options.push({
      tag: "NAT",
      level: "info",
      message: `Mascaramento ativo em ${port}: ${Math.floor(rand(800, 5200))} sessões traduzidas.`,
    });
  }
  if (link.public_ip) {
    options.push({ tag: "PING", level: "info", message: `${link.public_ip.split("/")[0]} respondeu ICMP.` });
  }
  if (vlan) {
    options.push({
      tag: "VLAN",
      level: "info",
      message: `VLAN ${vlan.vlan_id}${vlan.name ? ` (${vlan.name})` : ""} roteada via ${port}.`,
    });
  }
  return pick(options);
}

const initialHa = (): EdgeHa => ({ state: "synced", active: 1, since: new Date(), incident: 0 });

/* The pair mostly stays in sync; now and then the heartbeat is lost, the pair resyncs, or it fails over. */
function stepHa(ha: EdgeHa, device: string, events: Omit<LogEntry, "id" | "time">[]): EdgeHa {
  const next = { ...ha };
  const unit = (n: 1 | 2) => `${device} #${n}`;
  const standby = (ha.active === 1 ? 2 : 1) as 1 | 2;
  if (next.incident > 0) {
    next.incident -= 1;
    if (next.incident > 0) return next;
    if (ha.state === "lost") {
      next.state = "syncing";
      next.incident = 3;
      next.since = new Date();
      events.push({ tag: "HA", level: "warn", message: `Heartbeat entre ${unit(1)} e ${unit(2)} restabelecido; ressincronizando configuração e sessões.` });
    } else {
      next.state = "synced";
      next.since = new Date();
      events.push({ tag: "HA", level: "info", message: `Sincronismo HA restabelecido: ${unit(next.active)} ativo, ${unit(next.active === 1 ? 2 : 1)} em standby.` });
    }
    return next;
  }
  const roll = Math.random();
  if (roll < 0.008) {
    next.state = "lost";
    next.incident = Math.floor(rand(5, 11));
    next.since = new Date();
    events.push({ tag: "HA", level: "error", message: `Sincronismo HA perdido: ${unit(standby)} não responde ao heartbeat de ${unit(ha.active)}.` });
  } else if (roll < 0.011) {
    next.active = standby;
    next.state = "syncing";
    next.incident = 3;
    next.since = new Date();
    events.push({ tag: "HA", level: "warn", message: `Failover HA: ${unit(standby)} assumiu como ativo; ${unit(ha.active)} passou a standby.` });
  } else if (roll < 0.05) {
    events.push({ tag: "HA", level: "info", message: `Heartbeat HA ok: ${unit(ha.active)} ativo, ${unit(standby)} em standby e sincronizado.` });
  }
  return next;
}

function step(
  links: InternetLink[],
  state: Map<number, LinkTelemetry>,
): { next: Map<number, LinkTelemetry>; events: Omit<LogEntry, "id" | "time">[] } {
  const next = new Map<number, LinkTelemetry>();
  const events: Omit<LogEntry, "id" | "time">[] = [];

  for (const link of links) {
    const prev = state.get(link.id) ?? initialTelemetry(link);
    const t: LinkTelemetry = { ...prev };
    const name = `${link.provider}${link.sdwan_port ? ` (${link.sdwan_port})` : ""}`;

    if (t.incident > 0) {
      t.incident -= 1;
      if (t.incident === 0) {
        t.health = link.role === "backup" ? "standby" : "up";
        events.push({ tag: "RECOVERY", level: "info", message: `${name} normalizado.` });
      }
    } else if (link.role !== "backup" && Math.random() < 0.012) {
      const down = Math.random() < 0.35;
      t.health = down ? "down" : "degraded";
      t.incident = Math.floor(rand(4, 10));
      events.push(
        down
          ? { tag: "LINK", level: "error", message: `${name} sem resposta. Tráfego redirecionado.` }
          : { tag: "SLA", level: "warn", message: `${name} fora do SLA: latência e perda elevadas.` },
      );
    }
    next.set(link.id, t);
  }

  const primaryDown = links.some((l) => l.role !== "backup" && next.get(l.id)?.health === "down");
  for (const link of links) {
    const t = next.get(link.id)!;
    if (link.role === "backup" && t.incident === 0) {
      const wasActive = t.health === "up";
      t.health = primaryDown ? "up" : "standby";
      if (primaryDown && !wasActive) {
        events.push({ tag: "FAILOVER", level: "warn", message: `Backup ${link.provider} assumiu o tráfego.` });
      }
    }

    const capacity = link.bandwidth_mbps ?? 100;
    const target =
      t.health === "down" ? 0 : t.health === "standby" ? 0.02 : link.role === "backup" ? 0.7 : link.role === "primary" ? 0.55 : 0.3;
    const usage = t.health === "down" ? 0 : capacity * clamp(target + rand(-0.12, 0.12), 0, 0.98);
    t.usageMbps = t.usageMbps * 0.5 + usage * 0.5;
    t.latencyMs =
      t.health === "down" ? 0 : baseLatency(link) * (t.health === "degraded" ? rand(4, 8) : 1) + rand(0, 6);
    t.lossPct = t.health === "down" ? 100 : t.health === "degraded" ? rand(3, 12) : Math.random() < 0.1 ? rand(0, 0.5) : 0;
    t.history = [...t.history.slice(1), t.usageMbps];
    if (t.health === "down") t.availability = [...t.availability.slice(0, 23), 0];
    else if (t.health === "degraded") t.availability = [...t.availability.slice(0, 23), Math.min(t.availability[23], 0.5)];
  }

  if (links.length && Math.random() < 0.85) {
    const link = pick(links);
    events.push(genericEvent(link, next.get(link.id)!));
  }
  return { next, events };
}

export function useWanSimulation(links: InternetLink[]) {
  const [telemetry, setTelemetry] = useState<Map<number, LinkTelemetry>>(new Map());
  const [ha, setHa] = useState<EdgeHa>(initialHa);
  const [log, setLog] = useState<LogEntry[]>([]);
  const counter = useRef(0);
  const state = useRef(telemetry);
  const haState = useRef(ha);

  useEffect(() => {
    const seeded = new Map(links.map((link) => [link.id, state.current.get(link.id) ?? initialTelemetry(link)]));
    state.current = seeded;
    setTelemetry(seeded);

    const device = links.find((l) => l.sdwan_device)?.sdwan_device ?? "Edge";
    // Each site has its own pair; start it in sync.
    haState.current = initialHa();
    setHa(haState.current);
    const timer = setInterval(() => {
      const { next, events } = step(links, state.current);
      state.current = next;
      setTelemetry(next);
      if (links.length) {
        haState.current = stepHa(haState.current, device, events);
        setHa(haState.current);
      }
      if (events.length) {
        const now = new Date();
        const entries = events.map((event) => ({ ...event, id: ++counter.current, time: now }));
        setLog((current) => [...entries.reverse(), ...current].slice(0, MAX_LOG));
      }
    }, TICK_MS);
    return () => clearInterval(timer);
  }, [links]);

  return { telemetry, ha, log };
}
