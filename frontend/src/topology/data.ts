/*
 * Layer 2 topology of each plant, transcribed from the Visio drawings (BR-MAT rev. 2, Mar 2024;
 * BR-ACS rev. 2, Jun 2023, by Gustavo Cardoso). Coordinates are the drawing's own, in its pixel
 * space, so the layout matches the document the team already knows. Ports, fibre counts and
 * remarks are copied as drawn; device status is simulated until LibreNMS/PRTG are connected.
 */

export type Medium = "sm" | "mm" | "utp" | "wireless";
export type NodeKind = "core" | "switch" | "passive" | "ap";
export type Point = [number, number];

export interface TopoNode {
  id: string;
  kind: NodeKind;
  /* Location in Portuguese / English, as in the drawing's frame header. */
  location?: string;
  locationEn?: string;
  hostname?: string;
  ip?: string;
  model?: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /* The cable passes through the frame without terminating (optical cable bypass). */
  bypass?: "diagonal" | "vertical";
  /* Red text in the drawing: an open item on this asset. */
  nok?: string;
}

export interface Endpoint {
  node: string;
  port?: string;
  /* Cisco SFP (square), non-Cisco fibre converter (circle) or PoE injector (arrow). */
  connector?: "sfp" | "converter" | "injector";
}

export interface TopoLink {
  id: string;
  a: Endpoint;
  b: Endpoint;
  medium: Medium;
  fibers?: number;
  /* Orthogonal route from a to b. */
  points: Point[];
  /* Where the fibre count is written. */
  labelAt?: Point;
  /* Red crosses: interrupted connection. */
  breaks?: Point[];
  /* Segments (by index) drawn dotted, where the cable only passes by an asset. */
  dotted?: number[];
  ring?: string;
  note?: string;
}

export interface Annotation {
  text: string;
  at: Point;
  tone?: "note" | "nok";
}

export interface SiteTopology {
  code: string;
  name: string;
  city: string;
  revision: string;
  date: string;
  author: string;
  view: [number, number, number, number];
  /* Drawings with a larger canvas get proportionally larger link labels. */
  textScale?: number;
  nodes: TopoNode[];
  links: TopoLink[];
  annotations: Annotation[];
  groups?: { label: string; x: number; y: number; w: number; h: number }[];
}

export const MEDIUM_LABEL: Record<Medium, string> = {
  sm: "Fibra monomodo (SM)",
  mm: "Fibra multimodo (MM)",
  utp: "Cabo UTP",
  wireless: "Rádio",
};

export const MEDIUM_SHORT: Record<Medium, string> = { sm: "SM", mm: "MM", utp: "UTP", wireless: "Rádio" };

const ap = (id: string, x: number, y: number): TopoNode => ({ id, kind: "ap", hostname: id, x: x - 17, y: y - 11, w: 34, h: 22 });

const BR_MAT: SiteTopology = {
  code: "BR-MAT",
  name: "Planta Matozinhos",
  city: "Matozinhos/MG",
  revision: "Rev. 2",
  date: "mar/2024",
  author: "Gustavo Cardoso",
  view: [20, 70, 1030, 575],
  nodes: [
    {
      id: "BRNMATIB00",
      kind: "core",
      location: "CPD",
      locationEn: "Server room",
      hostname: "BRNMATIB00",
      ip: "10.127.228.1",
      model: "C9200L-24T & C9200L-24P",
      x: 478,
      y: 80,
      w: 142,
      h: 140,
    },
    { id: "BRNMATIB04", kind: "switch", location: "Expedição", locationEn: "Shipping", hostname: "BRNMATIB04", ip: "10.127.228.4", model: "C9200L-24P-4G", x: 76, y: 313, w: 96, h: 92 },
    { id: "BRNMATIB06", kind: "switch", location: "Britagem", locationEn: "Mining", hostname: "BRNMATIB06", ip: "10.127.228.6", model: "WS-C2960-24TC-L", x: 220, y: 313, w: 98, h: 92 },
    { id: "TERCIARIA", kind: "passive", location: "Terciária", locationEn: "Mining", x: 358, y: 313, w: 97, h: 92, bypass: "diagonal" },
    { id: "BRNMATIB10", kind: "switch", location: "Autos", locationEn: "Truck maintenance", hostname: "BRNMATIB10", ip: "10.127.228.10", model: "WS-C2960-24TC-L", x: 502, y: 313, w: 98, h: 92 },
    { id: "BRNMATIB03", kind: "switch", location: "ADM", locationEn: "Administrative", hostname: "BRNMATIB03", ip: "10.127.228.3", model: "WS-C2960-24TT-L", x: 637, y: 313, w: 99, h: 92 },
    {
      id: "BRNMATIB09",
      kind: "core",
      location: "Painel central",
      locationEn: "Industrial panel",
      hostname: "BRNMATIB09",
      ip: "10.127.228.9",
      model: "C9200L-24P-4G",
      x: 770,
      y: 313,
      w: 135,
      h: 92,
      nok: "Baseline pendente",
    },
    { id: "BRNMATIB08", kind: "switch", location: "Portaria", locationEn: "Reception", hostname: "BRNMATIB08", ip: "10.127.226.8", model: "WS-C2960-24TC-L", x: 933, y: 316, w: 97, h: 92 },
    { id: "SUBSTACAO", kind: "passive", location: "Substação", locationEn: "Power meter", x: 76, y: 500, w: 98, h: 92 },
    { id: "BRNMATIB12", kind: "switch", location: "Almox.", locationEn: "Warehouse", hostname: "BRNMATIB12", ip: "10.127.228.12", model: "WS-C2960-24TC-L", x: 247, y: 500, w: 98, h: 92 },
    { id: "BRNMATIB05", kind: "switch", location: "Carregamento", locationEn: "Load", hostname: "BRNMATIB05", ip: "10.127.228.05", model: "WS-C2960-24TC-L", x: 416, y: 500, w: 109, h: 92 },
    { id: "BRNMATIB16", kind: "switch", location: "Projeto", locationEn: "Project", hostname: "BRNMATIB16", ip: "10.127.228.16", model: "C9200L-24P-4G", x: 550, y: 507, w: 97, h: 91 },
    { id: "BRNMATIB13", kind: "switch", location: "Manut.", locationEn: "Maintenance", hostname: "BRNMATIB13", ip: "10.127.228.13", model: "WS-C2960-24TC-L", x: 653, y: 507, w: 97, h: 91 },
    { id: "BRNMATIB11", kind: "switch", location: "Laboratório", locationEn: "Lab.", hostname: "BRNMATIB11", ip: "10.127.228.11", model: "WS-C2960-24TC-L", x: 758, y: 506, w: 97, h: 91 },
    { id: "BRNSJIJB07", kind: "switch", location: "Sup. britagem", locationEn: "Mining", hostname: "BRNSJIJB07", ip: "10.127.228.7", model: "WS-C2960-24TC-L", x: 937, y: 505, w: 98, h: 92 },
    ap("BR-SJL-OFI-A002", 232, 272),
    ap("BR-MAT-ADM-A002", 470, 242),
    ap("BR-MAT-ADM-A001", 638, 242),
    ap("BR-MAT-TEC-A201", 918, 256),
  ],
  links: [
    {
      id: "mat-01",
      a: { node: "BRNMATIB00", port: "Gi2/0/24", connector: "converter" },
      b: { node: "BRNMATIB04", port: "Gi1/1/1", connector: "sfp" },
      medium: "sm",
      fibers: 12,
      points: [[478, 124], [128, 124], [128, 313]],
      labelAt: [310, 118],
      ring: "Anel óptico 1",
    },
    { id: "mat-02", a: { node: "BRNMATIB04" }, b: { node: "BRNMATIB06" }, medium: "sm", fibers: 6, points: [[172, 350], [220, 350]], labelAt: [197, 336], ring: "Anel óptico 1" },
    { id: "mat-03", a: { node: "BRNMATIB06" }, b: { node: "TERCIARIA" }, medium: "sm", fibers: 6, points: [[318, 350], [358, 350]], labelAt: [339, 336], ring: "Anel óptico 1" },
    {
      id: "mat-04",
      a: { node: "TERCIARIA" },
      b: { node: "BRNMATIB10", port: "Gi0/2", connector: "sfp" },
      medium: "sm",
      fibers: 12,
      points: [[455, 350], [502, 350]],
      labelAt: [479, 336],
    },
    { id: "mat-05", a: { node: "BRNMATIB00" }, b: { node: "TERCIARIA" }, medium: "sm", fibers: 6, points: [[478, 176], [386, 176], [386, 313]], labelAt: [405, 170], ring: "Anel óptico 1" },
    {
      id: "mat-06",
      a: { node: "TERCIARIA" },
      b: { node: "BRNMATIB12" },
      medium: "sm",
      fibers: 6,
      points: [[434, 405], [434, 418], [284, 418], [284, 500]],
      labelAt: [345, 412],
      dotted: [2],
      note: "Passagem pela Terciária e pelo Almox. (bypass óptico)",
    },
    {
      id: "mat-07",
      a: { node: "BRNMATIB06", port: "Fas0/1", connector: "converter" },
      b: { node: "BRNMATIB09", port: "Gi1/0/20", connector: "converter" },
      medium: "mm",
      fibers: 8,
      points: [[260, 405], [260, 424], [60, 424], [60, 602], [385, 602], [385, 476], [835, 476], [835, 405]],
      labelAt: [200, 418],
      ring: "Anel óptico 2",
    },
    {
      id: "mat-08",
      a: { node: "BRNMATIB04", port: "Gi1/1/1", connector: "sfp" },
      b: { node: "BRNMATIB05", port: "Gi0/1", connector: "sfp" },
      medium: "sm",
      fibers: 12,
      points: [[76, 350], [38, 350], [38, 623], [470, 623], [470, 592]],
      labelAt: [205, 617],
      breaks: [[38, 492], [280, 623]],
      ring: "Anel óptico 3",
      note: "Conexão interrompida",
    },
    { id: "mat-09", a: { node: "SUBSTACAO" }, b: { node: "BRNMATIB12" }, medium: "sm", fibers: 6, points: [[174, 546], [247, 546]], labelAt: [210, 540] },
    {
      id: "mat-10",
      a: { node: "BRNMATIB00", port: "Gi2/1/2", connector: "sfp" },
      b: { node: "BRNMATIB08", port: "Gi0/1", connector: "sfp" },
      medium: "sm",
      fibers: 6,
      points: [[620, 116], [985, 116], [985, 316]],
      labelAt: [767, 110],
    },
    {
      id: "mat-11",
      a: { node: "BRNMATIB00", port: "Gi2/1/4", connector: "sfp" },
      b: { node: "BRNMATIB09", port: "Gi1/0/21", connector: "converter" },
      medium: "sm",
      points: [[620, 150], [838, 150], [838, 313]],
    },
    {
      id: "mat-12",
      a: { node: "BRNMATIB00", port: "Gi2/1/3", connector: "sfp" },
      b: { node: "BRNMATIB12" },
      medium: "sm",
      fibers: 12,
      points: [[620, 168], [755, 168], [755, 364], [770, 364], [788, 405], [788, 444], [297, 444], [297, 470], [290, 500]],
      labelAt: [712, 162],
      dotted: [3, 7],
      note: "Passa pelo Painel central e termina no Almox. em bypass óptico",
    },
    { id: "mat-13", a: { node: "BRNMATIB00" }, b: { node: "BRNMATIB03" }, medium: "utp", points: [[620, 205], [686, 205], [686, 313]] },
    { id: "mat-14", a: { node: "BRNMATIB00", port: "Gi1/0/24" }, b: { node: "BR-MAT-ADM-A002" }, medium: "utp", points: [[505, 220], [505, 238], [487, 238]] },
    { id: "mat-15", a: { node: "BRNMATIB00", port: "Gi1/0/22" }, b: { node: "BR-MAT-ADM-A001" }, medium: "utp", points: [[566, 220], [566, 238], [621, 238]] },
    { id: "mat-16", a: { node: "BRNMATIB06", port: "F0/23" }, b: { node: "BR-SJL-OFI-A002" }, medium: "utp", points: [[262, 313], [262, 290], [245, 283]] },
    {
      id: "mat-17",
      a: { node: "BRNMATIB09", port: "Gi1/0/xx", connector: "injector" },
      b: { node: "BR-MAT-TEC-A201" },
      medium: "utp",
      points: [[872, 313], [872, 256], [901, 256]],
    },
    {
      id: "mat-18",
      a: { node: "BRNMATIB09", port: "Gi1/1/xx", connector: "sfp" },
      b: { node: "BRNMATIB12", port: "Gi0/xx", connector: "sfp" },
      medium: "sm",
      points: [[804, 405], [804, 453], [318, 453], [318, 500]],
    },
    {
      id: "mat-19",
      a: { node: "BRNMATIB09", port: "Gi1/1/1", connector: "sfp" },
      b: { node: "BRNMATIB12", port: "Gi0/2", connector: "sfp" },
      medium: "mm",
      fibers: 4,
      points: [[819, 405], [819, 462], [331, 462], [331, 500]],
      labelAt: [512, 457],
    },
    {
      id: "mat-20",
      a: { node: "BRNMATIB09", port: "Gi1/1/2", connector: "sfp" },
      b: { node: "BRNMATIB05", port: "Gi0/2", connector: "sfp" },
      medium: "sm",
      fibers: 12,
      points: [[852, 405], [852, 489], [468, 489], [468, 500]],
      labelAt: [653, 484],
    },
    {
      id: "mat-21",
      a: { node: "BRNMATIB09", port: "Gi1/0/2", connector: "converter" },
      b: { node: "BRNMATIB11", port: "Gi0/2", connector: "sfp" },
      medium: "sm",
      fibers: 4,
      points: [[871, 405], [871, 542], [855, 542]],
      labelAt: [877, 520],
    },
    {
      id: "mat-22",
      a: { node: "BRNMATIB09", port: "Gi1/0/23", connector: "converter" },
      b: { node: "BRNMATIB13", port: "Gi0/1", connector: "sfp" },
      medium: "sm",
      fibers: 6,
      points: [[887, 405], [887, 626], [700, 626], [700, 598]],
      labelAt: [895, 560],
    },
    {
      id: "mat-23",
      a: { node: "BRNMATIB09", port: "Gi1/0/22", connector: "converter" },
      b: { node: "BRNSJIJB07", port: "Gi0/1", connector: "sfp" },
      medium: "mm",
      fibers: 4,
      points: [[903, 405], [903, 424], [953, 424], [953, 505]],
      labelAt: [940, 418],
    },
    {
      id: "mat-24",
      a: { node: "BRNMATIB05", port: "Gi0/2", connector: "sfp" },
      b: { node: "BRNMATIB16", port: "Gi1/1/1", connector: "sfp" },
      medium: "sm",
      points: [[502, 592], [502, 614], [608, 614], [608, 598]],
    },
  ],
  annotations: [
    { text: "Anel óptico 1", at: [265, 228] },
    { text: "Anel óptico 2", at: [180, 460] },
    { text: "Anel óptico 3", at: [410, 638] },
  ],
};

const BR_ACS: SiteTopology = {
  code: "BR-ACS",
  name: "Planta Arcos",
  city: "Arcos/MG",
  revision: "Rev. 2",
  date: "jun/2023",
  author: "Gustavo Cardoso",
  view: [15, 90, 1300, 705],
  textScale: 1.25,
  groups: [{ label: "Lhoist Limeira · BR-LIM", x: 25, y: 105, w: 230, h: 650 }],
  nodes: [
    {
      id: "BRLIMIB00",
      kind: "core",
      location: "CPD Limeira",
      locationEn: "BR-LIM server room",
      hostname: "BRLIMIB00",
      ip: "10.127.229.1",
      model: "C9200L-48T & C9200L-48P",
      x: 52,
      y: 137,
      w: 156,
      h: 189,
    },
    { id: "CVMP1", kind: "core", location: "CVMP1", locationEn: "Sales", hostname: "BRNSJLIB09", ip: "10.127.226.9", model: "WS-C2960-24TC-L", x: 52, y: 387, w: 118, h: 113 },
    {
      id: "CVMP2",
      kind: "switch",
      location: "CVMP2",
      locationEn: "Sales",
      hostname: "BRNSJLIB09",
      ip: "10.127.226.9",
      model: "WS-C2960-24TC-L",
      x: 50,
      y: 622,
      w: 120,
      h: 115,
      nok: "Hostname e IP iguais aos do CVMP1",
    },
    { id: "BRNACSIB01", kind: "core", location: "ADM", locationEn: "Administrative", hostname: "BRNACSIB01", ip: "10.127.229.101", model: "C9200L-48T", x: 608, y: 102, w: 174, h: 173 },
    { id: "BRNACSIB05", kind: "switch", location: "Balança", locationEn: "Shipping", hostname: "BRNACSIB05", ip: "10.127.229.105", model: "WS-C2960-24TC-L", x: 315, y: 392, w: 122, h: 114 },
    { id: "BRNACSIB04", kind: "switch", location: "Oficina", locationEn: "Maintenance", hostname: "BRNACSIB04", ip: "10.127.226.104", model: "WS-C2960-24TC-L", x: 529, y: 392, w: 121, h: 114 },
    { id: "BRNACSIB03", kind: "switch", location: "Comercial", locationEn: "Sales", hostname: "BRNACSIB03", ip: "10.127.226.103", model: "WS-C2960-24TC-L", x: 746, y: 392, w: 120, h: 114 },
    { id: "SUBSTACAO", kind: "passive", location: "Substação", locationEn: "Power station", x: 958, y: 395, w: 122, h: 113 },
    { id: "REFEITORIO", kind: "passive", location: "Refeitório", locationEn: "Kitchen", x: 1170, y: 390, w: 123, h: 113 },
    { id: "HIDRATACAO", kind: "passive", location: "Hidratação", locationEn: "Loading", x: 316, y: 628, w: 123, h: 114, bypass: "vertical" },
    { id: "BRNACSIB06", kind: "switch", location: "Lab", locationEn: "Laboratório", hostname: "BRNACSIB06", ip: "10.127.229.26", model: "C9200L-24P-4G", x: 538, y: 628, w: 120, h: 114 },
    { id: "CCM", kind: "passive", location: "CCM", locationEn: "Power station", x: 750, y: 628, w: 122, h: 114, bypass: "vertical" },
    { id: "PAINEL", kind: "passive", location: "Painel", locationEn: "Panel", x: 962, y: 628, w: 123, h: 114 },
    ap("BR-ACS-OFI-A001", 866, 334),
  ],
  links: [
    {
      id: "acs-01",
      a: { node: "BRLIMIB00", port: "Gi1/1/2", connector: "sfp" },
      b: { node: "BRNACSIB01", port: "Gi1/1/1", connector: "sfp" },
      medium: "sm",
      points: [[208, 148], [608, 148]],
    },
    { id: "acs-02", a: { node: "BRLIMIB00" }, b: { node: "BRNACSIB01" }, medium: "sm", fibers: 2, points: [[208, 165], [608, 165]], labelAt: [426, 159], breaks: [[486, 165]], note: "Conexão interrompida" },
    {
      id: "acs-03",
      a: { node: "CVMP1" },
      b: { node: "BRNACSIB01" },
      medium: "wireless",
      points: [[170, 442], [220, 442], [220, 183], [608, 183]],
      breaks: [[486, 183]],
      note: "Conexão interrompida",
    },
    {
      id: "acs-04",
      a: { node: "CVMP2" },
      b: { node: "BRNACSIB01" },
      medium: "wireless",
      points: [[170, 672], [238, 672], [238, 199], [608, 199]],
      breaks: [[486, 199]],
      note: "Conexão interrompida",
    },
    {
      id: "acs-05",
      a: { node: "BRNACSIB01" },
      b: { node: "BRNACSIB05", port: "Gi1/0/49", connector: "sfp" },
      medium: "mm",
      fibers: 6,
      points: [[608, 234], [373, 234], [373, 392]],
      labelAt: [422, 228],
      breaks: [[486, 234]],
      note: "Conexão interrompida · STP a ser ativado",
    },
    {
      id: "acs-06",
      a: { node: "BRNACSIB01", port: "Gi1/1/2", connector: "converter" },
      b: { node: "BRNACSIB04", port: "Gi0/1", connector: "sfp" },
      medium: "mm",
      fibers: 4,
      points: [[633, 275], [633, 392]],
      labelAt: [612, 330],
    },
    {
      id: "acs-07",
      a: { node: "BRNACSIB01", port: "Gi1/1/3", connector: "converter" },
      b: { node: "BRNACSIB03", port: "Gi0/1", connector: "sfp" },
      medium: "sm",
      fibers: 4,
      points: [[765, 275], [765, 392]],
      labelAt: [744, 332],
    },
    { id: "acs-08", a: { node: "BRNACSIB01" }, b: { node: "REFEITORIO" }, medium: "sm", fibers: 6, points: [[782, 140], [1245, 140], [1245, 390]], labelAt: [991, 134] },
    { id: "acs-09", a: { node: "BRNACSIB01" }, b: { node: "REFEITORIO" }, medium: "sm", fibers: 6, points: [[782, 184], [1208, 184], [1208, 390]], labelAt: [991, 178] },
    { id: "acs-10", a: { node: "BRNACSIB01" }, b: { node: "SUBSTACAO" }, medium: "mm", fibers: 6, points: [[782, 232], [1011, 232], [1011, 395]], labelAt: [991, 226] },
    { id: "acs-11", a: { node: "BRNACSIB04" }, b: { node: "SUBSTACAO" }, medium: "mm", fibers: 4, points: [[633, 506], [633, 540], [1024, 540], [1024, 508]], labelAt: [828, 534] },
    {
      id: "acs-12",
      a: { node: "BRNACSIB05", port: "Gi0/1", connector: "converter" },
      b: { node: "HIDRATACAO" },
      medium: "sm",
      fibers: 6,
      points: [[333, 506], [333, 628]],
      labelAt: [311, 572],
    },
    { id: "acs-13", a: { node: "HIDRATACAO" }, b: { node: "CCM" }, medium: "sm", fibers: 6, points: [[333, 742], [333, 773], [767, 773], [767, 742]], labelAt: [595, 767] },
    {
      id: "acs-14",
      a: { node: "CCM" },
      b: { node: "BRNACSIB04", port: "Gi0/1", connector: "converter" },
      medium: "sm",
      fibers: 6,
      points: [[767, 628], [767, 580], [607, 580], [607, 506]],
      labelAt: [709, 574],
    },
    {
      id: "acs-15",
      a: { node: "BRNACSIB05" },
      b: { node: "BRNACSIB06" },
      medium: "sm",
      fibers: 4,
      points: [[397, 506], [397, 578], [552, 578], [552, 628]],
      labelAt: [460, 572],
      note: "STP a ser ativado",
    },
    { id: "acs-16", a: { node: "BRNACSIB04" }, b: { node: "BRNACSIB06" }, medium: "mm", fibers: 2, points: [[578, 506], [578, 628]], labelAt: [566, 572] },
    { id: "acs-17", a: { node: "CCM" }, b: { node: "PAINEL" }, medium: "sm", fibers: 4, points: [[872, 685], [962, 685]], labelAt: [918, 678] },
    {
      id: "acs-18",
      a: { node: "BRNACSIB03", port: "Fa0/20", connector: "injector" },
      b: { node: "BR-ACS-OFI-A001" },
      medium: "utp",
      points: [[806, 392], [806, 357], [849, 357], [849, 345]],
    },
  ],
  annotations: [
    { text: "STP a ser ativado", at: [491, 330], tone: "nok" },
    { text: "STP a ser ativado", at: [492, 628], tone: "nok" },
  ],
};

export const TOPOLOGIES: SiteTopology[] = [BR_MAT, BR_ACS];

export const nodeLabel = (n: TopoNode) => n.hostname ?? `${n.location}${n.locationEn ? ` / ${n.locationEn}` : ""}`;
