/*
 * Layer 2 topology of a plant. The drawings are stored per site (the first two were transcribed from
 * the Visio drawings BR-MAT rev. 2 and BR-ACS rev. 2 and loaded by migration 0005). Coordinates are
 * the drawing's own pixel space, so the layout matches the document the team already knows. Device
 * status is simulated until LibreNMS/PRTG are connected.
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
  /* The site and stored record it belongs to (absent while a drawing is being created). */
  siteId?: number;
  recordId?: number;
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

export const nodeLabel = (n: TopoNode) => n.hostname ?? `${n.location}${n.locationEn ? ` / ${n.locationEn}` : ""}`;
