import { useEffect, useRef, useState } from "react";

/* Switch ports and their simulated telemetry, used until the LibreNMS/PRTG collection exists. */

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
  /* Nominal speed: FastEthernet access ports top out at 100 Mbps, which is normal for them. */
  maxMbps: number;
  /* Documented as interrupted in the drawing: the simulation never brings it up. */
  locked?: boolean;
  /* The link comes from the Topologia drawing (peer, medium, fibres). */
  documented?: boolean;
}

export interface NetworkSwitch {
  id: string;
  /* Topology node the switch belongs to; stack members share it. */
  nodeId: string;
  /* Position in a stack (1, 2…), or null for a standalone switch. */
  member: number | null;
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
  if (port.errors > 0 || (port.speedMbps === 100 && port.maxMbps > 100) || port.utilization >= 85) return "warn";
  return "ok";
}

export function portProblem(port: SwitchPort): string | null {
  if (!port.adminUp) return "Desabilitada administrativamente";
  if (port.link === "down") return "Sem link";
  if (port.errors >= 100) return `${port.errors} erros CRC`;
  if (port.speedMbps === 10) return "Negociada em 10 Mbps";
  if (port.errors > 0) return `${port.errors} erros CRC`;
  if (port.speedMbps === 100 && port.maxMbps > 100) return "Negociada em 100 Mbps";
  if (port.utilization >= 85) return `Utilização alta (${port.utilization}%)`;
  return null;
}

export function switchHealth(sw: NetworkSwitch): number {
  const enabled = sw.ports.filter((p) => p.adminUp);
  if (!enabled.length) return 100;
  const score = enabled.reduce((sum, p) => sum + { ok: 1, warn: 0.5, crit: 0, off: 1 }[portColor(p)], 0);
  return (score / enabled.length) * 100;
}

export const speedLabel = (mbps: number | null) => (mbps === null ? "—" : mbps >= 1000 ? `${mbps / 1000} Gbps` : `${mbps} Mbps`);

/* The grid draws ports in blocks of 24 (48-port models show two blocks) and up to 4 uplinks. */
export const PORTS_PER_BLOCK = 24;
export const MAX_UPLINKS = 4;

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
          const candidates = sw.ports.filter((p) => p.adminUp && p.description && !p.locked);
          const port = candidates[Math.floor(Math.random() * candidates.length)];
          if (!port) continue;
          const where = `${sw.hostname} ${port.name}`;
          const roll = Math.random();
          if (port.link === "down") {
            port.link = "up";
            port.speedMbps = port.maxMbps;
            port.errors = 0;
            push("info", "LINK", `${where} link UP ${speedLabel(port.speedMbps)} (${port.description})`);
          } else if (roll < 0.2 && !port.uplink) {
            port.link = "down";
            port.speedMbps = null;
            port.utilization = 0;
            push("error", "LINK", `${where} link DOWN (${port.description})`);
          } else if (roll < 0.32 && !port.uplink) {
            port.speedMbps = Math.random() < 0.4 || port.maxMbps <= 100 ? 10 : 100;
            push(
              port.speedMbps === 10 ? "error" : "warn",
              "SPEED",
              `${where} renegociou em ${speedLabel(port.speedMbps)} half/full`,
            );
          } else if (roll < 0.42) {
            port.errors += Math.floor(Math.random() * 60) + 5;
            push(port.errors >= 100 ? "error" : "warn", "CRC", `${where} acumulou ${port.errors} erros de entrada`);
          } else {
            const wasProblem = portColor(port) !== "ok";
            port.errors = 0;
            if (port.speedMbps !== null && port.speedMbps < port.maxMbps) port.speedMbps = port.maxMbps;
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
