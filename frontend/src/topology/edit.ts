import type { NodeKind, Point, SiteTopology, TopoLink, TopoNode } from "./data";

/* Editing helpers for the Layer 2 drawing: moving devices with their cables, routing new cables, framing. */

export const NODE_SIZE: Record<NodeKind, [number, number]> = {
  core: [142, 140],
  switch: [96, 92],
  passive: [97, 92],
  ap: [34, 22],
};

const centre = (n: TopoNode): Point => [n.x + n.w / 2, n.y + n.h / 2];

/*
 * An orthogonal route between two frames, like the drawings: down from the upper device, across, and
 * into the lower one; side to side when they sit on the same row.
 */
export function autoRoute(a: TopoNode, b: TopoNode): Point[] {
  const [ax, ay] = centre(a);
  const [bx, by] = centre(b);
  const sameRow = Math.abs(ay - by) < (a.h + b.h) / 2;
  if (sameRow) {
    const [left, right] = ax <= bx ? [a, b] : [b, a];
    const y = Math.round(Math.max(left.y, right.y) + Math.min(left.h, right.h) / 2);
    const route: Point[] = [
      [left.x + left.w, y],
      [right.x, y],
    ];
    return left === a ? route : route.reverse();
  }
  const [top, bottom] = ay <= by ? [a, b] : [b, a];
  const [tx] = centre(top);
  const [bxc] = centre(bottom);
  const start: Point = [Math.round(tx), top.y + top.h];
  const end: Point = [Math.round(bxc), bottom.y];
  const mid = Math.round((start[1] + end[1]) / 2);
  const route: Point[] = start[0] === end[0] ? [start, end] : [start, [start[0], mid], [end[0], mid], end];
  return top === a ? route : route.reverse();
}

/* Shift the end of a cable that touches a moved frame, keeping its first segment straight. */
function shiftEnd(points: Point[], atStart: boolean, dx: number, dy: number): Point[] {
  const pts = points.map((p) => [...p] as Point);
  const [i, j] = atStart ? [0, 1] : [pts.length - 1, pts.length - 2];
  const end = pts[i];
  const next = pts[j];
  if (next && pts.length > 2) {
    if (end[0] === next[0]) next[0] += dx;
    else if (end[1] === next[1]) next[1] += dy;
  }
  end[0] += dx;
  end[1] += dy;
  if (next && pts.length === 2) {
    // A single straight segment: keep it straight by sliding the far end along its own frame side.
    if (end[0] - dx === next[0]) next[0] = end[0];
    else if (end[1] - dy === next[1]) next[1] = end[1];
  }
  return pts;
}

export function moveNode(topo: SiteTopology, id: string, x: number, y: number): SiteTopology {
  const node = topo.nodes.find((n) => n.id === id);
  if (!node) return topo;
  return moveSelection(topo, [`n:${id}`], x - node.x, y - node.y);
}

/*
 * What the editor can select, as "n:<node id>", "l:<link id>", "a:<annotation index>" or
 * "g:<area index>".
 */
export type Ref = string;

const refsOf = (refs: Ref[], kind: string) => refs.filter((r) => r.startsWith(`${kind}:`)).map((r) => r.slice(2));

/* Move a selection; cables between two moved devices move whole, cables to a fixed one stretch. */
export function moveSelection(topo: SiteTopology, refs: Ref[], dx: number, dy: number): SiteTopology {
  if (!dx && !dy) return topo;
  const nodes = new Set(refsOf(refs, "n"));
  const anns = new Set(refsOf(refs, "a").map(Number));
  const groups = new Set(refsOf(refs, "g").map(Number));
  const shift = (p: Point): Point => [p[0] + dx, p[1] + dy];
  return {
    ...topo,
    nodes: topo.nodes.map((n) => (nodes.has(n.id) ? { ...n, x: n.x + dx, y: n.y + dy } : n)),
    links: topo.links.map((l): TopoLink => {
      const a = nodes.has(l.a.node);
      const b = nodes.has(l.b.node);
      if (a && b) {
        return { ...l, points: l.points.map(shift), labelAt: l.labelAt && shift(l.labelAt), breaks: l.breaks?.map(shift) };
      }
      if (!a && !b) return l;
      const points = shiftEnd(l.points, a, dx, dy);
      return { ...l, points, labelAt: undefined, breaks: l.breaks?.length ? [midpoint(points)] : l.breaks };
    }),
    annotations: topo.annotations.map((x, i) => (anns.has(i) ? { ...x, at: shift(x.at) } : x)),
    groups: topo.groups?.map((g, i) => (groups.has(i) ? { ...g, x: g.x + dx, y: g.y + dy } : g)),
  };
}

/* Resize a frame from its top-left corner; cable ends keep their relative spot on the frame. */
export function resizeNode(topo: SiteTopology, id: string, w: number, h: number): SiteTopology {
  const node = topo.nodes.find((n) => n.id === id);
  if (!node || (node.w === w && node.h === h)) return topo;
  const follow = (p: Point): [number, number] => {
    const rx = node.w ? (p[0] - node.x) / node.w : 0;
    const ry = node.h ? (p[1] - node.y) / node.h : 0;
    return [Math.round(node.x + rx * w - p[0]), Math.round(node.y + ry * h - p[1])];
  };
  return {
    ...topo,
    nodes: topo.nodes.map((n) => (n.id === id ? { ...n, w, h } : n)),
    links: topo.links.map((l) => {
      let points = l.points;
      if (l.a.node === id) points = shiftEnd(points, true, ...follow(points[0]));
      if (l.b.node === id) points = shiftEnd(points, false, ...follow(points[points.length - 1]));
      return points === l.points ? l : { ...l, points, labelAt: undefined };
    }),
  };
}

/*
 * Visio-style segment drag. Returns the route to drag from and the index of the segment in it: an
 * end segment gets a stub at the frame so the cable stays attached and orthogonal while it moves.
 */
export function prepareSegment(points: Point[], i: number): { points: Point[]; index: number } {
  const pts = points.map((p) => [...p] as Point);
  let index = i;
  if (index === pts.length - 2 && pts.length > 1) pts.push([...pts[pts.length - 1]] as Point);
  if (index === 0) {
    pts.unshift([...pts[0]] as Point);
    index = 1;
  }
  return { points: pts, index };
}

/* Move segment `index` across itself (along both axes when it is diagonal). */
export function dragSegment(points: Point[], index: number, dx: number, dy: number): Point[] {
  const [p, q] = [points[index], points[index + 1]];
  const horizontal = p[1] === q[1];
  const vertical = p[0] === q[0];
  const mx = horizontal && !vertical ? 0 : dx;
  const my = vertical && !horizontal ? 0 : dy;
  return points.map((pt, k) => (k === index || k === index + 1 ? ([pt[0] + mx, pt[1] + my] as Point) : pt));
}

/* Drop repeated points and bends that no longer turn. */
export function cleanRoute(points: Point[]): Point[] {
  const out: Point[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (last && last[0] === p[0] && last[1] === p[1]) continue;
    const prev = out[out.length - 2];
    if (prev && last && ((prev[0] === last[0] && last[0] === p[0]) || (prev[1] === last[1] && last[1] === p[1]))) out.pop();
    out.push(p);
  }
  if (out.length === 1) out.push([...out[0]] as Point);
  return out;
}

/* A new route for one cable (bends are lost; the drawing's interrupted mark goes to its middle). */
export function rerouteLink(topo: SiteTopology, link: TopoLink): TopoLink {
  const a = topo.nodes.find((n) => n.id === link.a.node);
  const b = topo.nodes.find((n) => n.id === link.b.node);
  if (!a || !b) return link;
  const points = autoRoute(a, b);
  return { ...link, points, labelAt: undefined, dotted: undefined, breaks: link.breaks?.length ? [midpoint(points)] : undefined };
}

export type AlignMode = "left" | "center" | "right" | "top" | "middle" | "bottom";

/* Align devices to the first one selected, like Visio's Align command. */
export function alignNodes(topo: SiteTopology, ids: string[], mode: AlignMode): SiteTopology {
  const nodes = ids.map((id) => topo.nodes.find((n) => n.id === id)).filter((n): n is TopoNode => !!n);
  if (nodes.length < 2) return topo;
  const [ref] = nodes;
  let next = topo;
  for (const n of nodes.slice(1)) {
    const dx =
      mode === "left" ? ref.x - n.x : mode === "right" ? ref.x + ref.w - n.x - n.w : mode === "center" ? ref.x + ref.w / 2 - n.x - n.w / 2 : 0;
    const dy =
      mode === "top" ? ref.y - n.y : mode === "bottom" ? ref.y + ref.h - n.y - n.h : mode === "middle" ? ref.y + ref.h / 2 - n.y - n.h / 2 : 0;
    next = moveSelection(next, [`n:${n.id}`], Math.round(dx), Math.round(dy));
  }
  return next;
}

/* Even spacing between the centres of three or more devices, keeping the outer two in place. */
export function distributeNodes(topo: SiteTopology, ids: string[], axis: "x" | "y"): SiteTopology {
  const nodes = ids.map((id) => topo.nodes.find((n) => n.id === id)).filter((n): n is TopoNode => !!n);
  if (nodes.length < 3) return topo;
  const c = (n: TopoNode) => (axis === "x" ? n.x + n.w / 2 : n.y + n.h / 2);
  const sorted = [...nodes].sort((p, q) => c(p) - c(q));
  const first = c(sorted[0]);
  const step = (c(sorted[sorted.length - 1]) - first) / (sorted.length - 1);
  let next = topo;
  sorted.forEach((n, i) => {
    const d = Math.round(first + i * step - c(n));
    next = moveSelection(next, [`n:${n.id}`], axis === "x" ? d : 0, axis === "y" ? d : 0);
  });
  return next;
}

/* Remove a selection; removing a device removes its cables too. */
export function deleteSelection(topo: SiteTopology, refs: Ref[]): SiteTopology {
  const nodes = new Set(refsOf(refs, "n"));
  const links = new Set(refsOf(refs, "l"));
  const anns = new Set(refsOf(refs, "a").map(Number));
  const groups = new Set(refsOf(refs, "g").map(Number));
  return {
    ...topo,
    nodes: topo.nodes.filter((n) => !nodes.has(n.id)),
    links: topo.links.filter((l) => !links.has(l.id) && !nodes.has(l.a.node) && !nodes.has(l.b.node)),
    annotations: topo.annotations.filter((_, i) => !anns.has(i)),
    groups: topo.groups?.filter((_, i) => !groups.has(i)),
  };
}

export interface Clip {
  nodes: TopoNode[];
  links: TopoLink[];
  annotations: SiteTopology["annotations"];
  groups: NonNullable<SiteTopology["groups"]>;
}

/* Copy a selection, with the cables between the copied devices. */
export function copySelection(topo: SiteTopology, refs: Ref[]): Clip {
  const nodes = new Set(refsOf(refs, "n"));
  const anns = new Set(refsOf(refs, "a").map(Number));
  const groups = new Set(refsOf(refs, "g").map(Number));
  return {
    nodes: topo.nodes.filter((n) => nodes.has(n.id)),
    links: topo.links.filter((l) => nodes.has(l.a.node) && nodes.has(l.b.node)),
    annotations: topo.annotations.filter((_, i) => anns.has(i)),
    groups: (topo.groups ?? []).filter((_, i) => groups.has(i)),
  };
}

const prefixOf = (kind: NodeKind) => (kind === "ap" ? "AP" : kind === "passive" ? "PASS" : "SW");

/* Paste a copy shifted by (dx, dy), with fresh ids; returns the drawing and what to select. */
export function pasteClip(topo: SiteTopology, clip: Clip, dx: number, dy: number): { topo: SiteTopology; refs: Ref[] } {
  const ids = new Map<string, string>();
  const taken = topo.nodes.map((n) => n.id);
  const nodes = clip.nodes.map((n) => {
    const id = freeId(prefixOf(n.kind), taken);
    taken.push(id);
    ids.set(n.id, id);
    // Hostnames and IPs belong to one device, so the copy starts without them.
    return { ...n, id, hostname: undefined, ip: undefined, x: n.x + dx, y: n.y + dy };
  });
  const linkIds = topo.links.map((l) => l.id);
  const shift = (p: Point): Point => [p[0] + dx, p[1] + dy];
  const links = clip.links.map((l) => {
    const id = freeId("L", linkIds);
    linkIds.push(id);
    return {
      ...l,
      id,
      a: { ...l.a, node: ids.get(l.a.node)! },
      b: { ...l.b, node: ids.get(l.b.node)! },
      points: l.points.map(shift),
      labelAt: l.labelAt && shift(l.labelAt),
      breaks: l.breaks?.map(shift),
    };
  });
  const annotations = clip.annotations.map((a) => ({ ...a, at: shift(a.at) }));
  const groups = clip.groups.map((g) => ({ ...g, x: g.x + dx, y: g.y + dy }));
  const next: SiteTopology = {
    ...topo,
    nodes: [...topo.nodes, ...nodes],
    links: [...topo.links, ...links],
    annotations: [...topo.annotations, ...annotations],
    groups: [...(topo.groups ?? []), ...groups],
  };
  const refs = [
    ...nodes.map((n) => `n:${n.id}`),
    ...links.map((l) => `l:${l.id}`),
    ...annotations.map((_, i) => `a:${topo.annotations.length + i}`),
    ...groups.map((_, i) => `g:${(topo.groups ?? []).length + i}`),
  ];
  return { topo: next, refs };
}

/* Bounding box of a selection, for the selection frame and for framing it on screen. */
export function boundsOf(topo: SiteTopology, refs: Ref[]): [number, number, number, number] | null {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const r of refs) {
    const key = r.slice(2);
    if (r.startsWith("n:")) {
      const n = topo.nodes.find((x) => x.id === key);
      if (n) xs.push(n.x, n.x + n.w), ys.push(n.y, n.y + n.h);
    } else if (r.startsWith("l:")) {
      const l = topo.links.find((x) => x.id === key);
      for (const [x, y] of l?.points ?? []) xs.push(x), ys.push(y);
    } else if (r.startsWith("a:")) {
      const a = topo.annotations[Number(key)];
      if (a) xs.push(a.at[0] - 40, a.at[0] + 40), ys.push(a.at[1] - 8, a.at[1] + 2);
    } else if (r.startsWith("g:")) {
      const g = topo.groups?.[Number(key)];
      if (g) xs.push(g.x, g.x + g.w), ys.push(g.y, g.y + g.h);
    }
  }
  if (!xs.length) return null;
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)];
}

/* Middle of a polyline, where a "cable interrupted" cross goes. */
export function midpoint(points: Point[]): Point {
  const lengths = points.slice(1).map((p, i) => Math.hypot(p[0] - points[i][0], p[1] - points[i][1]));
  let half = lengths.reduce((s, l) => s + l, 0) / 2;
  for (let i = 0; i < lengths.length; i++) {
    if (half <= lengths[i]) {
      const t = lengths[i] ? half / lengths[i] : 0;
      return [points[i][0] + (points[i + 1][0] - points[i][0]) * t, points[i][1] + (points[i + 1][1] - points[i][1]) * t];
    }
    half -= lengths[i];
  }
  return points[0];
}

/* The smallest frame holding everything drawn, with a margin, and at least page-sized. */
export function fitView(topo: SiteTopology, margin = 30): [number, number, number, number] {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const n of topo.nodes) xs.push(n.x, n.x + n.w), ys.push(n.y, n.y + n.h + 12);
  for (const l of topo.links) for (const [x, y] of l.points) xs.push(x), ys.push(y);
  for (const a of topo.annotations) xs.push(a.at[0] - 80, a.at[0] + 80), ys.push(a.at[1] - 12, a.at[1] + 6);
  for (const g of topo.groups ?? []) xs.push(g.x, g.x + g.w), ys.push(g.y, g.y + g.h);
  if (!xs.length) return [0, 0, 1000, 560];
  // A drawing with a handful of devices keeps a page-sized frame, so they don't fill the screen.
  const [minW, minH] = [1000, 560];
  const [cx, cy] = [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
  const w = Math.max(minW, Math.max(...xs) - Math.min(...xs) + 2 * margin);
  const h = Math.max(minH, Math.max(...ys) - Math.min(...ys) + 2 * margin);
  return [Math.floor(cx - w / 2), Math.floor(cy - h / 2), Math.ceil(w), Math.ceil(h)];
}

/* A free id like "SW-03" or "L12" that no other node or link uses. */
export function freeId(prefix: string, taken: string[]): string {
  for (let i = 1; ; i++) {
    const id = `${prefix}${String(i).padStart(2, "0")}`;
    if (!taken.includes(id)) return id;
  }
}

/* A new device centred on (cx, cy), on the drawing's 2-unit grid. */
export function newNode(topo: SiteTopology, kind: NodeKind, cx: number, cy: number): TopoNode {
  const [w, h] = NODE_SIZE[kind];
  const snap = (v: number) => Math.round(v / 2) * 2;
  return { id: freeId(prefixOf(kind), topo.nodes.map((n) => n.id)), kind, x: snap(cx - w / 2), y: snap(cy - h / 2), w, h };
}

export function emptyTopology(code: string, name: string, city: string): SiteTopology {
  return {
    code,
    name,
    city,
    revision: "Rev. 1",
    date: new Date().toLocaleDateString("pt-BR", { month: "short", year: "numeric" }).replace(". de ", "/").replace(" de ", "/"),
    author: "",
    view: [0, 0, 1000, 560],
    nodes: [],
    links: [],
    annotations: [],
  };
}
