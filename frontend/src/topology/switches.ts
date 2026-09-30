import type { NetworkSwitch, SwitchPort } from "../lan/data";
import { MEDIUM_SHORT, type SiteTopology, type TopoNode, nodeLabel } from "./data";

/*
 * The switches of a plant's Layer 2 drawing, port by port. Every documented link lands on its port
 * (or, when the drawing has no port, on the first free uplink for fibre and access port for copper);
 * the remaining ports are simulated until LibreNMS/PRTG feed them.
 */

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

const hash = (text: string) => [...text].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) | 0, 7);

interface Layout {
  access: number;
  uplinks: number;
  accessName: (member: number, i: number) => string;
  uplinkName: (member: number, i: number) => string;
  accessMbps: number;
}

/* Port naming and counts by model family, as IOS shows them. */
function layoutOf(model: string): Layout {
  const access = /-48/.test(model) ? 48 : /-12/.test(model) ? 12 : /-8/.test(model) ? 8 : 24;
  if (/^WS-C2960/.test(model))
    return { access, uplinks: 2, accessName: (_, i) => `Fa0/${i}`, uplinkName: (_, i) => `Gi0/${i}`, accessMbps: 100 };
  return { access, uplinks: 4, accessName: (m, i) => `Gi${m}/0/${i}`, uplinkName: (m, i) => `Gi${m}/1/${i}`, accessMbps: 1000 };
}

/* "Gi1/0/24", "Fas0/1", "F0/23" and "Fa0/20" all name ports the same way once normalised. */
function normalise(port: string) {
  const m = port.trim().match(/^([a-z]+)\s*([\dx/]+)$/i);
  if (!m) return port.toLowerCase();
  const kind = m[1].toLowerCase().startsWith("f") ? "fa" : m[1].toLowerCase().startsWith("t") ? "te" : "gi";
  return `${kind}${m[2].toLowerCase()}`;
}

const DEVICES = ["PC", "NB", "PRN", "TEL", "CLP", "IHM", "CAM"];

export function buildTopologySwitches(topology: SiteTopology): NetworkSwitch[] {
  const byId = new Map(topology.nodes.map((n) => [n.id, n]));
  const switches = topology.nodes.filter((n) => (n.kind === "switch" || n.kind === "core") && n.hostname);
  return switches.flatMap((node, nodeIndex) => {
    const models = (node.model ?? "C9200L-24T").split("&").map((m) => m.trim());
    const stacked = models.length > 1;
    const rand = rng(hash(`${topology.code}:${node.id}`));
    const members = models.map((model, k) => {
      const member = k + 1;
      const layout = layoutOf(model);
      const ports: SwitchPort[] = [];
      for (let i = 1; i <= layout.access + layout.uplinks; i++) {
        const uplink = i > layout.access;
        const n = uplink ? i - layout.access : i;
        ports.push({
          index: i,
          name: uplink ? layout.uplinkName(member, n) : layout.accessName(member, n),
          uplink,
          adminUp: false,
          link: "down",
          speedMbps: null,
          vlan: null,
          description: null,
          poeWatts: null,
          errors: 0,
          utilization: 0,
          maxMbps: uplink ? 1000 : layout.accessMbps,
        });
      }
      return { member, model, ports };
    });

    // Documented links first, so simulated endpoints never take their ports.
    const all = members.flatMap((m) => m.ports);
    const own = topology.links.filter((l) => l.a.node === node.id || l.b.node === node.id);
    for (const link of own) {
      const [mine, other] = link.a.node === node.id ? [link.a, link.b] : [link.b, link.a];
      const peer = byId.get(other.node);
      const fibre = link.medium === "sm" || link.medium === "mm";
      let port: SwitchPort | undefined;
      if (mine.port && !/x/i.test(mine.port))
        port = all.find((p) => normalise(p.name) === normalise(mine.port!) && !p.documented);
      if (!port && mine.port) {
        // "Gi1/0/xx": the drawing names the port group but not the number.
        const prefix = normalise(mine.port).replace(/x+$/, "");
        port = all.find((p) => normalise(p.name).startsWith(prefix) && !p.documented);
      }
      port ??= all.find((p) => p.uplink === fibre && !p.documented) ?? all.find((p) => !p.documented);
      if (!port) continue;
      const down = !!link.breaks?.length;
      port.documented = true;
      port.locked = down;
      port.adminUp = true;
      port.link = down ? "down" : "up";
      port.speedMbps = down ? null : port.maxMbps;
      port.utilization = down ? 0 : Math.floor(rand() * 45) + 15;
      port.description = [
        `→ ${peer ? nodeLabel(peer) : other.node}${peer?.location && peer.hostname ? ` (${peer.location})` : ""}`,
        `${MEDIUM_SHORT[link.medium]}${link.fibers ? ` ${link.fibers}FO` : ""}`,
        mine.port ? "" : "porta não documentada",
        link.note ?? "",
      ]
        .filter(Boolean)
        .join(" · ");
      port.poeWatts = peer?.kind === "ap" && !down ? Math.round(rand() * 80) / 10 + 8 : null;
    }

    // The rest: most access ports in use by simulated endpoints, spare uplinks disabled.
    for (const port of all) {
      if (port.documented) continue;
      const used = !port.uplink && rand() < (node.kind === "core" ? 0.55 : 0.7);
      port.adminUp = used || (!port.uplink && rand() < 0.08);
      const up = used && rand() > 0.02;
      port.link = up ? "up" : "down";
      if (up) {
        const r = rand();
        port.speedMbps = r < 0.015 ? 10 : r < 0.06 && port.maxMbps > 100 ? 100 : port.maxMbps;
        port.utilization = Math.floor(rand() * 45) + 1;
        const roll = rand();
        port.errors = roll < 0.008 ? 150 + Math.floor(rand() * 900) : roll < 0.03 ? 1 + Math.floor(rand() * 40) : 0;
      }
      if (used) {
        const device = DEVICES[Math.floor(rand() * DEVICES.length)];
        port.vlan = { PC: 10, NB: 10, PRN: 10, TEL: 20, CLP: 30, IHM: 30, CAM: 40 }[device]!;
        port.description = `${device}-${topology.code}-${String(Math.floor(rand() * 900) + 100)}`;
        port.poeWatts = up && (device === "TEL" || device === "CAM") ? Math.round(rand() * 120) / 10 + 3 : null;
      }
    }

    return members.map(
      ({ member, model, ports }): NetworkSwitch => ({
        id: stacked ? `${node.id}#${member}` : node.id,
        nodeId: node.id,
        member: stacked ? member : null,
        siteId: nodeIndex,
        siteCode: topology.code,
        siteName: topology.name,
        hostname: node.hostname!,
        role: node.kind === "core" ? "Core" : "Acesso",
        model,
        managementIp: node.ip ?? "—",
        firmware: /^WS-C2960/.test(model) ? "15.2(7)E8" : "17.9.4a",
        uptimeDays: Math.floor(rand() * 400) + 3,
        ports,
      }),
    );
  });
}

export const isSwitchNode = (n: TopoNode) => (n.kind === "switch" || n.kind === "core") && !!n.hostname;
