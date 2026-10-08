import { useEffect, useRef, useState } from "react";
import type { ClusterRecord, Site } from "../api";

/*
 * Virtualization inventory (clusters, hosts, memory slots, datastores), registered per site. Usage
 * (CPU, memory, datastore occupancy, disk rebuilds) is simulated until vCenter is collected.
 */

export interface CpuInfo {
  vendor: "Intel" | "AMD";
  model: string;
  sockets: number;
  coresPerSocket: number;
  threadsPerCore: number;
  baseGhz: number;
  turboGhz: number;
  cacheMb: number;
}

export interface DimmSlot {
  name: string;
  socket: number;
  sizeGb: number | null;
}

export interface MemoryInfo {
  type: "DDR3" | "DDR4" | "DDR5";
  speedMts: number;
  form: "RDIMM" | "LRDIMM";
  maxModuleGb: number;
  slots: DimmSlot[];
}

export interface Host {
  id: string;
  name: string;
  vendor: string;
  model: string;
  serial: string;
  hypervisor: string;
  state: "connected" | "maintenance";
  vms: number;
  cpu: CpuInfo;
  memory: MemoryInfo;
  cpuUsage: number;
  memUsage: number;
  cpuHistory: number[];
}

export type DatastoreType = "VMFS 6" | "VMFS 5" | "NFS 4.1" | "NFS 3" | "vSAN";

export interface Datastore {
  id: string;
  name: string;
  type: DatastoreType;
  backing: string;
  capacityTb: number;
  usedTb: number;
  provisionedTb: number;
  hosts: number;
  local: boolean;
}

export type BayState = "ok" | "rebuild" | "failed" | "empty";

export interface StorageArray {
  name: string;
  model: string;
  raid: string;
  bays: { slot: number; state: BayState; sizeTb: number | null; kind: "NVMe" | "SSD" | "HDD" }[];
}

export interface Cluster {
  id: string;
  record: ClusterRecord;
  siteId: number;
  siteCode: string;
  siteName: string;
  name: string;
  vcenter: string;
  hosts: Host[];
  datastores: Datastore[];
  array: StorageArray;
  vcpus: number;
  haEnabled: boolean;
  drs: "Automático" | "Manual";
}

/* ---------- derived numbers ---------- */

export const cores = (c: CpuInfo) => c.sockets * c.coresPerSocket;
export const threads = (c: CpuInfo) => cores(c) * c.threadsPerCore;
export const ghzTotal = (c: CpuInfo) => cores(c) * c.baseGhz;
export const installedGb = (m: MemoryInfo) => m.slots.reduce((s, d) => s + (d.sizeGb ?? 0), 0);
export const maxGb = (m: MemoryInfo) => m.slots.length * m.maxModuleGb;
export const emptySlots = (m: MemoryInfo) => m.slots.filter((d) => d.sizeGb === null).length;

export function clusterTotals(cluster: Cluster) {
  const hosts = cluster.hosts;
  const ghz = hosts.reduce((s, h) => s + ghzTotal(h.cpu), 0);
  const ghzUsed = hosts.reduce((s, h) => s + (ghzTotal(h.cpu) * h.cpuUsage) / 100, 0);
  const ram = hosts.reduce((s, h) => s + installedGb(h.memory), 0);
  const ramUsed = hosts.reduce((s, h) => s + (installedGb(h.memory) * h.memUsage) / 100, 0);
  const shared = cluster.datastores.filter((d) => !d.local);
  return {
    sockets: hosts.reduce((s, h) => s + h.cpu.sockets, 0),
    cores: hosts.reduce((s, h) => s + cores(h.cpu), 0),
    threads: hosts.reduce((s, h) => s + threads(h.cpu), 0),
    ghz,
    ghzUsed,
    ram,
    ramUsed,
    ramMax: hosts.reduce((s, h) => s + maxGb(h.memory), 0),
    slots: hosts.reduce((s, h) => s + h.memory.slots.length, 0),
    slotsEmpty: hosts.reduce((s, h) => s + emptySlots(h.memory), 0),
    vms: hosts.reduce((s, h) => s + h.vms, 0),
    storage: shared.reduce((s, d) => s + d.capacityTb, 0),
    storageUsed: shared.reduce((s, d) => s + d.usedTb, 0),
    provisioned: shared.reduce((s, d) => s + d.provisionedTb, 0),
  };
}

const comma = (text: string) => text.replace(".", ",");
export const formatGb = (gb: number) =>
  gb >= 1024 ? `${comma((gb / 1024).toFixed(gb % 1024 ? 1 : 0))} TB` : `${Math.round(gb)} GB`;
export const formatTb = (tb: number) => (tb >= 1 ? `${comma(tb.toFixed(1))} TB` : `${Math.round(tb * 1024)} GB`);

/* ---------- fictitious inventory ---------- */

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

export interface HostTemplate {
  vendor: string;
  model: string;
  cpu: CpuInfo;
  memory: { type: MemoryInfo["type"]; speedMts: number; form: MemoryInfo["form"]; perSocket: number; maxModuleGb: number };
  filledPerSocket: number;
  moduleGb: number;
}

/* Common server models, offered when adding a host. */
export const TEMPLATES: Record<string, HostTemplate> = {
  r750: {
    vendor: "Dell",
    model: "PowerEdge R750",
    cpu: { vendor: "Intel", model: "Xeon Gold 6338", sockets: 2, coresPerSocket: 32, threadsPerCore: 2, baseGhz: 2.0, turboGhz: 3.2, cacheMb: 48 },
    memory: { type: "DDR4", speedMts: 3200, form: "RDIMM", perSocket: 16, maxModuleGb: 256 },
    filledPerSocket: 8,
    moduleGb: 64,
  },
  r740: {
    vendor: "Dell",
    model: "PowerEdge R740",
    cpu: { vendor: "Intel", model: "Xeon Gold 6248R", sockets: 2, coresPerSocket: 24, threadsPerCore: 2, baseGhz: 3.0, turboGhz: 4.0, cacheMb: 35.75 },
    memory: { type: "DDR4", speedMts: 2933, form: "RDIMM", perSocket: 12, maxModuleGb: 128 },
    filledPerSocket: 6,
    moduleGb: 32,
  },
  dl380g11: {
    vendor: "HPE",
    model: "ProLiant DL380 Gen11",
    cpu: { vendor: "Intel", model: "Xeon Gold 6430", sockets: 2, coresPerSocket: 32, threadsPerCore: 2, baseGhz: 2.1, turboGhz: 3.4, cacheMb: 60 },
    memory: { type: "DDR5", speedMts: 4400, form: "RDIMM", perSocket: 16, maxModuleGb: 256 },
    filledPerSocket: 8,
    moduleGb: 64,
  },
  dl385: {
    vendor: "HPE",
    model: "ProLiant DL385 Gen10 Plus",
    cpu: { vendor: "AMD", model: "EPYC 7443", sockets: 2, coresPerSocket: 24, threadsPerCore: 2, baseGhz: 2.85, turboGhz: 4.0, cacheMb: 128 },
    memory: { type: "DDR4", speedMts: 3200, form: "RDIMM", perSocket: 16, maxModuleGb: 256 },
    filledPerSocket: 4,
    moduleGb: 64,
  },
  r630: {
    vendor: "Dell",
    model: "PowerEdge R630",
    cpu: { vendor: "Intel", model: "Xeon E5-2680 v4", sockets: 2, coresPerSocket: 14, threadsPerCore: 2, baseGhz: 2.4, turboGhz: 3.3, cacheMb: 35 },
    memory: { type: "DDR4", speedMts: 2400, form: "RDIMM", perSocket: 12, maxModuleGb: 64 },
    filledPerSocket: 8,
    moduleGb: 32,
  },
  r620: {
    vendor: "Dell",
    model: "PowerEdge R620",
    cpu: { vendor: "Intel", model: "Xeon E5-2660 v2", sockets: 2, coresPerSocket: 10, threadsPerCore: 2, baseGhz: 2.2, turboGhz: 3.0, cacheMb: 25 },
    memory: { type: "DDR3", speedMts: 1600, form: "RDIMM", perSocket: 12, maxModuleGb: 32 },
    filledPerSocket: 6,
    moduleGb: 16,
  },
};

/* A stored cluster with simulated usage, seeded by its id so the numbers stay put between visits. */
export function toCluster(record: ClusterRecord, site: Site): Cluster {
  const rand = rng(record.id * 3571 + 17);
  const hosts: Host[] = record.document.hosts.map((h, i) => {
    const cpuUsage = 25 + rand() * 45;
    return {
      ...h,
      id: `${record.id}-h${i}`,
      cpuUsage,
      memUsage: 55 + rand() * 30,
      cpuHistory: Array.from({ length: 24 }, () => Math.max(5, Math.min(98, cpuUsage + (rand() - 0.5) * 30))),
    };
  });
  const datastores: Datastore[] = record.document.datastores.map((d, i) => {
    const used = d.capacityTb * (d.local ? 0.1 + rand() * 0.25 : 0.45 + rand() * 0.42);
    return {
      ...d,
      id: `${record.id}-ds${i}`,
      usedTb: used,
      provisionedTb: d.local ? used * 1.5 : used * (1.1 + rand() * 0.6),
      hosts: d.local ? 1 : hosts.length,
    };
  });
  return {
    id: String(record.id),
    record,
    siteId: site.id,
    siteCode: site.code,
    siteName: site.name,
    name: record.name,
    vcenter: record.vcenter ?? "—",
    hosts,
    datastores,
    array: record.document.array ?? { name: "—", model: "Sem storage compartilhado", raid: "—", bays: [] },
    vcpus: record.document.vcpus ?? Math.round(hosts.reduce((s, h) => s + threads(h.cpu), 0) * 1.6),
    haEnabled: record.ha_enabled,
    drs: record.drs === "Automático" ? "Automático" : "Manual",
  };
}

/* ---------- live simulation ---------- */

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export function useClusterSimulation(initial: Cluster | null, tickMs = 2000) {
  const [cluster, setCluster] = useState(initial);
  const state = useRef(initial);

  useEffect(() => {
    state.current = initial;
    setCluster(initial);
  }, [initial]);

  useEffect(() => {
    if (!initial) return;
    const timer = window.setInterval(() => {
      const current = state.current;
      if (!current) return;
      const hosts = current.hosts.map((h) => {
        const cpuUsage = clamp(h.cpuUsage + (Math.random() - 0.5) * 9 + (45 - h.cpuUsage) * 0.04, 4, 97);
        return {
          ...h,
          cpuUsage,
          memUsage: clamp(h.memUsage + (Math.random() - 0.5) * 2.2, 35, 94),
          cpuHistory: [...h.cpuHistory.slice(1), cpuUsage],
        };
      });
      const datastores = current.datastores.map((d) =>
        d.local ? d : { ...d, usedTb: clamp(d.usedTb + (Math.random() - 0.45) * d.capacityTb * 0.0015, 0, d.capacityTb * 0.98) },
      );
      // Now and then a disk goes into rebuild and later comes back, to show the bay grid alive.
      const bays = current.array.bays.map((b) => ({ ...b }));
      const rebuilding = bays.find((b) => b.state === "rebuild");
      if (rebuilding && Math.random() < 0.15) rebuilding.state = "ok";
      else if (!rebuilding && Math.random() < 0.04) {
        const filled = bays.filter((b) => b.state === "ok");
        filled[Math.floor(Math.random() * filled.length)].state = "rebuild";
      }
      const next = { ...current, hosts, datastores, array: { ...current.array, bays } };
      state.current = next;
      setCluster(next);
    }, tickMs);
    return () => window.clearInterval(timer);
  }, [initial, tickMs]);

  return cluster;
}
