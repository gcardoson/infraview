import { useEffect, useRef, useState } from "react";
import type { Site } from "../api";
import { FALLBACK_SITES } from "../fictitious";

/* Fictitious virtualization inventory (clusters, hosts, memory slots, datastores) until the real collection exists. */

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

interface HostTemplate {
  vendor: string;
  model: string;
  cpu: CpuInfo;
  memory: { type: MemoryInfo["type"]; speedMts: number; form: MemoryInfo["form"]; perSocket: number; maxModuleGb: number };
  filledPerSocket: number;
  moduleGb: number;
}

const TEMPLATES: Record<string, HostTemplate> = {
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

interface ClusterPlan {
  suffix: string;
  hosts: string[];
  vcenter: string;
  array: { name: string; model: string; raid: string; bays: number; filled: number; kind: "NVMe" | "SSD" | "HDD"; sizeTb: number };
  datastores: Omit<Datastore, "id" | "usedTb" | "provisionedTb" | "hosts" | "local">[];
  nfs: Omit<Datastore, "id" | "usedTb" | "provisionedTb" | "hosts" | "local">[];
}

const PLANS: ClusterPlan[] = [
  {
    suffix: "PROD",
    hosts: ["r750", "r750", "dl380g11", "r740"],
    vcenter: "vcsa01",
    array: { name: "SAN-01", model: "Dell PowerStore 500T", raid: "RAID 6 (DRE)", bays: 25, filled: 21, kind: "NVMe", sizeTb: 3.84 },
    datastores: [
      { name: "DS-{S}-VMFS-01", type: "VMFS 6", backing: "PowerStore · LUN 01 · FC 32G", capacityTb: 16 },
      { name: "DS-{S}-VMFS-02", type: "VMFS 6", backing: "PowerStore · LUN 02 · FC 32G", capacityTb: 16 },
      { name: "DS-{S}-SQL", type: "VMFS 6", backing: "PowerStore · LUN 03 · FC 32G", capacityTb: 8 },
    ],
    nfs: [
      { name: "NFS-{S}-BACKUP", type: "NFS 4.1", backing: "Synology RS3621 · /volume1/vmware", capacityTb: 48 },
      { name: "NFS-{S}-ISO", type: "NFS 3", backing: "Synology RS3621 · /volume2/iso", capacityTb: 4 },
    ],
  },
  {
    suffix: "PLANTA",
    hosts: ["dl385", "r630", "r620"],
    vcenter: "vcsa02",
    array: { name: "VSAN-01", model: "vSAN ESA (discos locais)", raid: "RAID 5 · FTT=1", bays: 18, filled: 15, kind: "SSD", sizeTb: 1.92 },
    datastores: [
      { name: "vsanDatastore-{S}", type: "vSAN", backing: "vSAN · 3 hosts · SSD 1,92 TB", capacityTb: 26 },
      { name: "DS-{S}-LEGADO", type: "VMFS 5", backing: "Dell ME4024 · LUN 07 · iSCSI 10G", capacityTb: 6 },
    ],
    nfs: [{ name: "NFS-{S}-BACKUP", type: "NFS 4.1", backing: "QNAP TS-h1886 · /vmware", capacityTb: 32 }],
  },
];

function buildCluster(site: Site, siteIndex: number): Cluster {
  const plan = PLANS[siteIndex % PLANS.length];
  const rand = rng(site.id * 3571 + 17);
  const code = site.code.replace(/^BR-/, "");
  const hosts: Host[] = plan.hosts.map((key, i) => {
    const t = TEMPLATES[key];
    const slots: DimmSlot[] = [];
    for (let socket = 1; socket <= t.cpu.sockets; socket++) {
      const letter = socket === 1 ? "A" : "B";
      for (let n = 1; n <= t.memory.perSocket; n++) {
        slots.push({ name: `${letter}${n}`, socket, sizeGb: n <= t.filledPerSocket ? t.moduleGb : null });
      }
    }
    const cpuUsage = 25 + rand() * 45;
    return {
      id: `${site.id}-h${i + 1}`,
      name: `esx${String(i + 1).padStart(2, "0")}-${code.toLowerCase()}.lhoist.local`,
      vendor: t.vendor,
      model: t.model,
      serial: `${t.vendor === "Dell" ? "" : "CZ"}${Math.floor(rand() * 36 ** 6).toString(36).toUpperCase().padStart(7, "7")}`,
      hypervisor: key === "r620" ? "ESXi 7.0 U3" : "ESXi 8.0 U3",
      state: "connected",
      vms: 8 + Math.floor(rand() * 18),
      cpu: t.cpu,
      memory: { type: t.memory.type, speedMts: t.memory.speedMts, form: t.memory.form, maxModuleGb: t.memory.maxModuleGb, slots },
      cpuUsage,
      memUsage: 55 + rand() * 30,
      cpuHistory: Array.from({ length: 24 }, () => Math.max(5, Math.min(98, cpuUsage + (rand() - 0.5) * 30))),
    };
  });

  const shared = [...plan.datastores, ...plan.nfs].map((d, i) => {
    const used = d.capacityTb * (0.45 + rand() * 0.42);
    return {
      ...d,
      id: `${site.id}-ds${i}`,
      name: d.name.replace("{S}", code),
      usedTb: used,
      provisionedTb: used * (1.1 + rand() * 0.6),
      hosts: hosts.length,
      local: false,
    };
  });
  const local = hosts.map((h, i) => ({
    id: `${site.id}-local${i}`,
    name: `local-${h.name.split(".")[0]}`,
    type: "VMFS 6" as const,
    backing: "BOSS / RAID 1 · 2× SSD 480 GB",
    capacityTb: 0.44,
    usedTb: 0.05 + rand() * 0.1,
    provisionedTb: 0.1,
    hosts: 1,
    local: true,
  }));

  const bays: StorageArray["bays"] = Array.from({ length: plan.array.bays }, (_, i) => ({
    slot: i,
    state: i < plan.array.filled ? "ok" : "empty",
    sizeTb: i < plan.array.filled ? plan.array.sizeTb : null,
    kind: plan.array.kind,
  }));

  return {
    id: `cl-${site.id}`,
    siteId: site.id,
    siteCode: site.code,
    siteName: site.name,
    name: `CL-${code}-${plan.suffix}`,
    vcenter: `${plan.vcenter}-${code.toLowerCase()}.lhoist.local`,
    hosts,
    datastores: [...shared, ...local],
    array: { name: plan.array.name, model: plan.array.model, raid: plan.array.raid, bays },
    vcpus: Math.round(hosts.reduce((s, h) => s + threads(h.cpu), 0) * (1.3 + rand() * 0.8)),
    haEnabled: true,
    drs: siteIndex % 2 === 0 ? "Automático" : "Manual",
  };
}

export function buildClusters(sites: Site[]): Cluster[] {
  return (sites.length ? sites : FALLBACK_SITES).map(buildCluster);
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
