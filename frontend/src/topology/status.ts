import { useEffect, useMemo, useRef, useState } from "react";
import type { SiteTopology, TopoLink, TopoNode } from "./data";

/* Simulated device status, until the LibreNMS/PRTG collection feeds real reachability. */

export type DeviceStatus = "online" | "degraded" | "offline";
export type LinkState = "up" | "degraded" | "down";

export interface NodeHealth {
  status: DeviceStatus;
  reason?: string;
  since: Date;
}

export const STATUS_LABEL: Record<DeviceStatus, string> = { online: "Online", degraded: "Degradado", offline: "Offline" };
export const LINK_LABEL: Record<LinkState, string> = { up: "Ativo", degraded: "Degradado", down: "Inativo" };

const DEGRADED_REASONS = [
  "Perda de pacotes de 3% no último minuto",
  "Latência de 48 ms, acima do normal",
  "Erros CRC crescendo no uplink",
  "CPU em 88%",
  "Temperatura interna alta (61 °C)",
];

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

const hash = (text: string) => [...text].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) | 0, 17);

export const hasDevice = (n: TopoNode) => n.kind !== "passive";

/* A device whose every documented link is interrupted can't be reached. */
function isolated(node: TopoNode, links: TopoLink[]) {
  const own = links.filter((l) => l.a.node === node.id || l.b.node === node.id);
  return own.length > 0 && own.every((l) => l.breaks?.length);
}

function initial(topology: SiteTopology): Record<string, NodeHealth> {
  const rand = rng(hash(topology.code));
  const now = Date.now();
  const out: Record<string, NodeHealth> = {};
  for (const node of topology.nodes.filter(hasDevice)) {
    const r = rand();
    const since = new Date(now - (5 + rand() * 600) * 60_000);
    if (isolated(node, topology.links))
      out[node.id] = { status: "offline", reason: "Sem resposta: todos os enlaces documentados estão interrompidos", since };
    else if (node.kind !== "core" && r < 0.05) out[node.id] = { status: "offline", reason: "Sem resposta ao ping", since };
    else if (r < 0.14)
      out[node.id] = { status: "degraded", reason: DEGRADED_REASONS[Math.floor(rand() * DEGRADED_REASONS.length)], since };
    else out[node.id] = { status: "online", since };
  }
  return out;
}

/* Status of several plants at once (the Explorer map shows every plant's links). */
export function useTopologiesStatus(topologies: SiteTopology[], tickMs = 6000) {
  const [health, setHealth] = useState(() => Object.fromEntries(topologies.map((t) => [t.code, initial(t)])));
  const current = useRef(health);

  useEffect(() => {
    const next = Object.fromEntries(topologies.map((t) => [t.code, initial(t)]));
    current.current = next;
    setHealth(next);
  }, [topologies]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (!topologies.length || Math.random() > 0.45) return;
      const topology = topologies[Math.floor(Math.random() * topologies.length)];
      const plant = current.current[topology.code] ?? {};
      const ids = Object.keys(plant).filter((id) => {
        const node = topology.nodes.find((n) => n.id === id);
        return node && !isolated(node, topology.links);
      });
      if (!ids.length) return;
      const id = ids[Math.floor(Math.random() * ids.length)];
      const prev = plant[id];
      const r = Math.random();
      // Mostly recover; now and then something degrades or drops.
      const status: DeviceStatus =
        prev.status !== "online" ? (r < 0.7 ? "online" : prev.status) : r < 0.8 ? "degraded" : "offline";
      if (status === prev.status) return;
      const reason =
        status === "degraded"
          ? DEGRADED_REASONS[Math.floor(Math.random() * DEGRADED_REASONS.length)]
          : status === "offline"
            ? "Sem resposta ao ping"
            : undefined;
      const next = { ...current.current, [topology.code]: { ...plant, [id]: { status, reason, since: new Date() } } };
      current.current = next;
      setHealth(next);
    }, tickMs);
    return () => window.clearInterval(timer);
  }, [topologies, tickMs]);

  return health;
}

export function useTopologyStatus(topology: SiteTopology, tickMs = 6000) {
  const list = useMemo(() => [topology], [topology]);
  // Right after a plant switch the state still holds the previous plant for one render.
  const fallback = useMemo(() => initial(topology), [topology]);
  return useTopologiesStatus(list, tickMs)[topology.code] ?? fallback;
}

export function linkState(link: TopoLink, health: Record<string, NodeHealth>): LinkState {
  if (link.breaks?.length) return "down";
  const ends = [health[link.a.node]?.status, health[link.b.node]?.status];
  if (ends.includes("offline")) return "down";
  if (ends.includes("degraded")) return "degraded";
  return "up";
}
