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
  if (!node || (node.x === x && node.y === y)) return topo;
  const [dx, dy] = [x - node.x, y - node.y];
  const shiftPoint = (p: Point): Point => [p[0] + dx, p[1] + dy];
  return {
    ...topo,
    nodes: topo.nodes.map((n) => (n.id === id ? { ...n, x, y } : n)),
    links: topo.links.map((l): TopoLink => {
      const a = l.a.node === id;
      const b = l.b.node === id;
      if (!a && !b) return l;
      if (a && b) return { ...l, points: l.points.map(shiftPoint) };
      return {
        ...l,
        points: shiftEnd(l.points, a, dx, dy),
        labelAt: undefined,
        breaks: l.breaks?.length ? [midpoint(shiftEnd(l.points, a, dx, dy))] : l.breaks,
      };
    }),
  };
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

export function newNode(topo: SiteTopology, kind: NodeKind): TopoNode {
  const [w, h] = NODE_SIZE[kind];
  const [vx, vy, vw, vh] = topo.view;
  // Next to the others, in the free strip under the drawing.
  const bottom = Math.max(vy + 40, ...topo.nodes.map((n) => n.y + n.h));
  const x = Math.round(vx + vw / 2 - w / 2);
  const y = Math.round(Math.min(bottom + 40, vy + vh - h - 10));
  const prefix = kind === "ap" ? "AP" : kind === "passive" ? "PASS" : "SW";
  return { id: freeId(prefix, topo.nodes.map((n) => n.id)), kind, x, y, w, h };
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
