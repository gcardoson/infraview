import { useEffect, useRef, useState } from "react";
import { type Medium, type NodeKind, type Point, type SiteTopology, type TopoLink, type TopoNode } from "./data";
import { LinkShape, NodeShape, fibersAt } from "./Diagram";
import { type Ref, autoRoute, boundsOf, cleanRoute, dragSegment, fitView, freeId, midpoint, moveSelection, prepareSegment, rerouteLink, resizeNode } from "./edit";
import { linkState } from "./status";

/*
 * The Visio-style drawing surface of the topology editor: shapes are dragged in from the stencil,
 * moved with alignment guides, resized from their corner and wired by pulling a cable from one
 * device's connection point to another. Cables bend by dragging their segments.
 */

export type Tool = "select" | "connect" | "pan";
export type Shape = NodeKind | "text" | "area";
type Cam = [number, number, number, number];

export interface CanvasApi {
  center: () => Point;
  fit: () => void;
  frame: (refs: Ref[]) => void;
  zoomBy: (factor: number) => void;
}

interface Props {
  topo: SiteTopology;
  selection: Ref[];
  onSelect: (refs: Ref[]) => void;
  /* Show a change while dragging; `commit` then records the drag as one undo step. */
  preview: (t: SiteTopology) => void;
  commit: (finish?: (t: SiteTopology) => SiteTopology) => void;
  set: (t: SiteTopology) => void;
  tool: Tool;
  medium: Medium;
  grid: boolean;
  guides: boolean;
  onDropShape: (shape: Shape, at: Point) => void;
  onEdit: (ref: Ref) => void;
  onZoom: (percent: number) => void;
  apiRef: React.RefObject<CanvasApi | null>;
}

type Drag =
  | { kind: "move"; start: Point; base: SiteTopology; refs: Ref[]; moved: boolean; click?: Ref }
  | { kind: "resize"; start: Point; base: SiteTopology; id: string; w: number; h: number }
  | { kind: "segment"; start: Point; base: SiteTopology; id: string; points: Point[]; index: number; moved: boolean }
  | { kind: "end"; id: string; end: "a" | "b"; fixed: Point; other: string }
  | { kind: "label"; start: Point; base: SiteTopology; id: string; origin: Point }
  | { kind: "connect"; from: string; origin: Point }
  | { kind: "pan"; client: [number, number]; cam: Cam }
  | { kind: "marquee"; start: Point; keep: Ref[] }
  | { kind: "area"; start: Point; base: SiteTopology; index: number; w: number; h: number };

interface Guide {
  x?: number;
  y?: number;
}

const snap2 = (v: number) => Math.round(v / 2) * 2;
const centre = (n: TopoNode): Point => [n.x + n.w / 2, n.y + n.h / 2];
const SHAPE_MIME = "application/x-topo-shape";

/* Connection points in the middle of each side, where Visio shows its blue crosses. */
const portsOf = (n: TopoNode): Point[] => [
  [n.x + n.w / 2, n.y],
  [n.x + n.w, n.y + n.h / 2],
  [n.x + n.w / 2, n.y + n.h],
  [n.x, n.y + n.h / 2],
];

function nodeAt(topo: SiteTopology, p: Point, except?: string): TopoNode | undefined {
  const m = 4;
  for (let i = topo.nodes.length - 1; i >= 0; i--) {
    const n = topo.nodes[i];
    if (n.id !== except && p[0] >= n.x - m && p[0] <= n.x + n.w + m && p[1] >= n.y - m && p[1] <= n.y + n.h + m) return n;
  }
  return undefined;
}

function nearestSegment(points: Point[], p: Point): number {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < points.length - 1; i++) {
    const [a, b] = [points[i], points[i + 1]];
    const len2 = (b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2;
    const t = len2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * (b[0] - a[0]) + (p[1] - a[1]) * (b[1] - a[1])) / len2)) : 0;
    const d = Math.hypot(p[0] - a[0] - t * (b[0] - a[0]), p[1] - a[1] - t * (b[1] - a[1]));
    if (d < bestD) [best, bestD] = [i, d];
  }
  return best;
}

/* Snap a move so the moved frames line up with another device's edge or centre; returns the guides. */
function alignGuides(base: SiteTopology, refs: Ref[], dx: number, dy: number, tol: number) {
  const ids = new Set(refs.filter((r) => r.startsWith("n:")).map((r) => r.slice(2)));
  const moving = base.nodes.filter((n) => ids.has(n.id));
  if (!moving.length) return { dx, dy, lines: [] as Guide[] };
  const x0 = Math.min(...moving.map((n) => n.x)) + dx;
  const x1 = Math.max(...moving.map((n) => n.x + n.w)) + dx;
  const y0 = Math.min(...moving.map((n) => n.y)) + dy;
  const y1 = Math.max(...moving.map((n) => n.y + n.h)) + dy;
  const others = base.nodes.filter((n) => !ids.has(n.id));
  const pick = (edges: number[], cands: number[]) => {
    let best: { shift: number; at: number } | null = null;
    for (const e of edges)
      for (const c of cands) if (Math.abs(c - e) <= tol && (!best || Math.abs(c - e) < Math.abs(best.shift))) best = { shift: c - e, at: c };
    return best;
  };
  const bx = pick([x0, (x0 + x1) / 2, x1], others.flatMap((n) => [n.x, n.x + n.w / 2, n.x + n.w]));
  const by = pick([y0, (y0 + y1) / 2, y1], others.flatMap((n) => [n.y, n.y + n.h / 2, n.y + n.h]));
  const lines: Guide[] = [];
  if (bx) lines.push({ x: bx.at });
  if (by) lines.push({ y: by.at });
  return { dx: Math.round(dx + (bx?.shift ?? 0)), dy: Math.round(dy + (by?.shift ?? 0)), lines };
}

const replaceLink = (topo: SiteTopology, id: string, patch: (l: TopoLink) => TopoLink): SiteTopology => ({
  ...topo,
  links: topo.links.map((l) => (l.id === id ? patch(l) : l)),
});

export function EditorCanvas(props: Props) {
  const { topo, selection, tool, grid, onZoom, apiRef } = props;
  const wrap = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const live = useRef(props);
  live.current = props;
  const drag = useRef<Drag | null>(null);
  const [size, setSize] = useState<[number, number] | null>(null);
  const [cam, setCam] = useState<Cam | null>(null);
  const camRef = useRef(cam);
  camRef.current = cam;
  const [hover, setHover] = useState<string | null>(null);
  const [cursor, setCursor] = useState<Point | null>(null);
  const [target, setTarget] = useState<string | null>(null);
  const [marquee, setMarquee] = useState<[number, number, number, number] | null>(null);
  const [guides, setGuides] = useState<Guide[]>([]);
  const [dragging, setDragging] = useState<Drag["kind"] | null>(null);
  const [space, setSpace] = useState(false);

  // Keep the camera's aspect ratio equal to the canvas, so one drawing unit is square on screen.
  const frameCam = (b: [number, number, number, number], s: [number, number], margin = 30): Cam => {
    const ar = s[1] / s[0];
    let w = b[2] + 2 * margin;
    let h = b[3] + 2 * margin;
    if (h / w > ar) w = h / ar;
    else h = w * ar;
    return [b[0] + b[2] / 2 - w / 2, b[1] + b[3] / 2 - h / 2, w, h];
  };

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (width > 0 && height > 0) setSize([width, height]);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!size) return;
    setCam((c) => {
      if (!c) return frameCam(fitView(live.current.topo, 0), size, 10);
      return [c[0], c[1], c[2], (c[2] * size[1]) / size[0]];
    });
  }, [size]);

  const scale = size && cam ? size[0] / cam[2] : 1;
  useEffect(() => onZoom(Math.round(scale * 100)), [scale, onZoom]);

  const zoomAt = (factor: number, at?: Point) => {
    setCam((c) => {
      if (!c || !size) return c;
      const s = size[0] / c[2];
      const f = Math.max(0.08 / s, Math.min(6 / s, factor));
      const [px, py] = at ?? [c[0] + c[2] / 2, c[1] + c[3] / 2];
      return [px - (px - c[0]) / f, py - (py - c[1]) / f, c[2] / f, c[3] / f];
    });
  };

  useEffect(() => {
    apiRef.current = {
      center: () => {
        const c = camRef.current;
        return c ? [c[0] + c[2] / 2, c[1] + c[3] / 2] : [500, 280];
      },
      fit: () => size && setCam(frameCam(fitView(live.current.topo, 0), size, 10)),
      frame: (refs) => {
        const b = boundsOf(live.current.topo, refs);
        if (!b || !size) return;
        const c = camRef.current;
        // Only scroll when the item is off screen; zoom out if it doesn't fit.
        if (c && b[0] >= c[0] && b[1] >= c[1] && b[0] + b[2] <= c[0] + c[2] && b[1] + b[3] <= c[1] + c[3]) return;
        const next = frameCam(b, size, 120);
        setCam(c && next[2] < c[2] ? [b[0] + b[2] / 2 - c[2] / 2, b[1] + b[3] / 2 - c[3] / 2, c[2], c[3]] : next);
      },
      zoomBy: (f) => zoomAt(f),
    };
  });

  const toSvg = (e: { clientX: number; clientY: number }): Point => {
    const m = svg.current?.getScreenCTM();
    if (!m) return [0, 0];
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    return [p.x, p.y];
  };

  // Ctrl + wheel zooms at the pointer; the wheel alone scrolls, as in Visio.
  useEffect(() => {
    const el = svg.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        zoomAt(Math.exp(-e.deltaY * 0.0018), toSvg(e));
        return;
      }
      setCam((c) => {
        if (!c || !size) return c;
        const k = c[2] / size[0];
        const [dx, dy] = e.shiftKey ? [e.deltaY, 0] : [e.deltaX, e.deltaY];
        return [c[0] + dx * k, c[1] + dy * k, c[2], c[3]];
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  });

  // Hold the space bar to pan with the pointer.
  useEffect(() => {
    const typing = (e: KeyboardEvent) => (e.target as HTMLElement).closest("input, textarea, select");
    const down = (e: KeyboardEvent) => {
      if (e.code === "Space" && !typing(e)) {
        e.preventDefault();
        setSpace(true);
      }
    };
    const up = (e: KeyboardEvent) => e.code === "Space" && setSpace(false);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);

  const begin = (d: Drag) => {
    drag.current = d;
    setDragging(d.kind);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  function onMove(ev: PointerEvent) {
    const d = drag.current;
    const { preview, guides: useGuides } = live.current;
    if (!d) return;
    const p = toSvg(ev);
    const k = camRef.current && size ? size[0] / camRef.current[2] : 1;
    switch (d.kind) {
      case "move": {
        let dx = p[0] - d.start[0];
        let dy = p[1] - d.start[1];
        if (!d.moved && Math.hypot(dx, dy) * k < 3) return;
        d.moved = true;
        dx = snap2(dx);
        dy = snap2(dy);
        if (useGuides && !ev.altKey) {
          const g = alignGuides(d.base, d.refs, dx, dy, 6 / k);
          dx = g.dx;
          dy = g.dy;
          setGuides(g.lines);
        }
        preview(moveSelection(d.base, d.refs, dx, dy));
        break;
      }
      case "resize": {
        const w = Math.max(24, snap2(d.w + p[0] - d.start[0]));
        const h = Math.max(18, snap2(d.h + p[1] - d.start[1]));
        preview(resizeNode(d.base, d.id, w, h));
        break;
      }
      case "area": {
        const w = Math.max(60, snap2(d.w + p[0] - d.start[0]));
        const h = Math.max(40, snap2(d.h + p[1] - d.start[1]));
        preview({ ...d.base, groups: d.base.groups?.map((g, i) => (i === d.index ? { ...g, w, h } : g)) });
        break;
      }
      case "segment": {
        const dx = p[0] - d.start[0];
        const dy = p[1] - d.start[1];
        if (!d.moved && Math.hypot(dx, dy) * k < 3) return;
        d.moved = true;
        const points = dragSegment(d.points, d.index, snap2(dx), snap2(dy));
        preview(
          replaceLink(d.base, d.id, (l) => ({
            ...l,
            points,
            labelAt: undefined,
            dotted: points.length === l.points.length ? l.dotted : undefined,
            breaks: l.breaks?.length ? [midpoint(points)] : l.breaks,
          })),
        );
        break;
      }
      case "label":
        preview(replaceLink(d.base, d.id, (l) => ({ ...l, labelAt: [snap2(d.origin[0] + p[0] - d.start[0]), snap2(d.origin[1] + p[1] - d.start[1])] })));
        break;
      case "end":
      case "connect":
        setCursor(p);
        setTarget(nodeAt(live.current.topo, p, d.kind === "connect" ? d.from : d.other)?.id ?? null);
        break;
      case "pan": {
        const c = d.cam;
        const kk = size ? c[2] / size[0] : 1;
        setCam([c[0] - (ev.clientX - d.client[0]) * kk, c[1] - (ev.clientY - d.client[1]) * kk, c[2], c[3]]);
        break;
      }
      case "marquee":
        setMarquee([Math.min(d.start[0], p[0]), Math.min(d.start[1], p[1]), Math.abs(p[0] - d.start[0]), Math.abs(p[1] - d.start[1])]);
        break;
    }
  }

  function onUp(ev: PointerEvent) {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    const d = drag.current;
    drag.current = null;
    setDragging(null);
    setGuides([]);
    setCursor(null);
    setTarget(null);
    if (!d) return;
    const { topo: t, commit, set, onSelect, medium } = live.current;
    const p = toSvg(ev);
    switch (d.kind) {
      case "move":
        commit();
        if (!d.moved && d.click) onSelect([d.click]);
        break;
      case "resize":
      case "area":
      case "label":
        commit();
        break;
      case "segment":
        commit((cur) =>
          replaceLink(cur, d.id, (l) => {
            const points = cleanRoute(l.points);
            return points.length === l.points.length ? l : { ...l, points, dotted: undefined };
          }),
        );
        break;
      case "end": {
        const node = nodeAt(t, p, d.other);
        const link = t.links.find((l) => l.id === d.id);
        if (!node || !link || link[d.end].node === node.id) break;
        set({ ...t, links: t.links.map((l) => (l.id === d.id ? rerouteLink(t, { ...l, [d.end]: { node: node.id } }) : l)) });
        break;
      }
      case "connect": {
        const from = t.nodes.find((n) => n.id === d.from);
        const to = nodeAt(t, p, d.from);
        if (!from || !to) break;
        const id = freeId("L", t.links.map((l) => l.id));
        const fibre = medium === "sm" || medium === "mm";
        const link: TopoLink = { id, a: { node: from.id }, b: { node: to.id }, medium, fibers: fibre ? 2 : undefined, points: autoRoute(from, to) };
        set({ ...t, links: [...t.links, link] });
        onSelect([`l:${id}`]);
        break;
      }
      case "marquee": {
        setMarquee(null);
        const [x, y, w, h] = [Math.min(d.start[0], p[0]), Math.min(d.start[1], p[1]), Math.abs(p[0] - d.start[0]), Math.abs(p[1] - d.start[1])];
        if (w < 2 && h < 2) break;
        const inside = (px: number, py: number) => px >= x && px <= x + w && py >= y && py <= y + h;
        const found: Ref[] = [
          ...t.nodes.filter((n) => inside(n.x, n.y) && inside(n.x + n.w, n.y + n.h)).map((n) => `n:${n.id}`),
          ...t.links.filter((l) => l.points.every(([px, py]) => inside(px, py))).map((l) => `l:${l.id}`),
          ...t.annotations.flatMap((a, i) => (inside(a.at[0], a.at[1]) ? [`a:${i}`] : [])),
          ...(t.groups ?? []).flatMap((g, i) => (inside(g.x, g.y) && inside(g.x + g.w, g.y + g.h) ? [`g:${i}`] : [])),
        ];
        onSelect([...new Set([...d.keep, ...found])]);
        break;
      }
    }
  }

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    const el = e.target as Element;
    const p = toSvg(e);
    if (e.button === 1 || tool === "pan" || space) {
      e.preventDefault();
      if (cam) begin({ kind: "pan", client: [e.clientX, e.clientY], cam });
      return;
    }
    if (e.button !== 0) return;
    const handle = el.closest("[data-handle]")?.getAttribute("data-handle");
    if (handle) {
      const [kind, id, extra] = handle.split("|");
      const link = topo.links.find((l) => l.id === id);
      if (kind === "port") {
        const n = topo.nodes.find((x) => x.id === id);
        if (n) begin({ kind: "connect", from: id, origin: portsOf(n)[Number(extra)] });
      } else if (kind === "resize") {
        const n = topo.nodes.find((x) => x.id === id);
        if (n) begin({ kind: "resize", start: p, base: topo, id, w: n.w, h: n.h });
      } else if (kind === "area") {
        const g = topo.groups?.[Number(id)];
        if (g) begin({ kind: "area", start: p, base: topo, index: Number(id), w: g.w, h: g.h });
      } else if (kind === "seg" && link) {
        const prep = prepareSegment(link.points, Number(extra));
        begin({ kind: "segment", start: p, base: topo, id, points: prep.points, index: prep.index, moved: false });
      } else if (kind === "end" && link) {
        const end = extra as "a" | "b";
        const fixed = end === "a" ? link.points[link.points.length - 1] : link.points[0];
        begin({ kind: "end", id, end, fixed, other: link[end === "a" ? "b" : "a"].node });
      } else if (kind === "label" && link) {
        begin({ kind: "label", start: p, base: topo, id, origin: fibersAt(link) });
      }
      return;
    }
    const ref = el.closest("[data-ref]")?.getAttribute("data-ref");
    const additive = e.shiftKey || e.ctrlKey || e.metaKey;
    if (!ref) {
      if (!additive) props.onSelect([]);
      begin({ kind: "marquee", start: p, keep: additive ? selection : [] });
      return;
    }
    if (ref.startsWith("n:") && tool === "connect") {
      const n = topo.nodes.find((x) => x.id === ref.slice(2));
      if (n) begin({ kind: "connect", from: n.id, origin: centre(n) });
      return;
    }
    let sel = selection;
    if (additive) sel = selection.includes(ref) ? selection.filter((r) => r !== ref) : [...selection, ref];
    else if (!selection.includes(ref)) sel = [ref];
    props.onSelect(sel);
    if (ref.startsWith("l:")) {
      // Dragging a cable bends it, segment by segment.
      const link = topo.links.find((l) => l.id === ref.slice(2));
      if (!link || additive) return;
      const prep = prepareSegment(link.points, nearestSegment(link.points, p));
      begin({ kind: "segment", start: p, base: topo, id: link.id, points: prep.points, index: prep.index, moved: false });
      return;
    }
    if (!sel.includes(ref)) return;
    begin({ kind: "move", start: p, base: topo, refs: sel, moved: false, click: !additive && sel.length > 1 ? ref : undefined });
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (drag.current) return;
    const el = e.target as Element;
    const handle = el.closest("[data-handle]")?.getAttribute("data-handle");
    if (handle?.startsWith("port|")) return;
    const ref = el.closest("[data-ref]")?.getAttribute("data-ref");
    const id = ref?.startsWith("n:") ? ref.slice(2) : null;
    if (id !== hover) setHover(id);
  };

  if (!cam || !size) return <div className="ve-canvas" ref={wrap} />;

  const hs = 7 / scale;
  const sel = new Set(selection);
  const selNodes = topo.nodes.filter((n) => sel.has(`n:${n.id}`));
  const selLinks = topo.links.filter((l) => sel.has(`l:${l.id}`));
  const portNodes = tool === "connect" ? topo.nodes : topo.nodes.filter((n) => n.id === hover && !dragging);
  const dragFrom = drag.current;
  const lineFrom = dragFrom?.kind === "connect" ? dragFrom.origin : dragFrom?.kind === "end" ? dragFrom.fixed : null;
  const targetNode = target ? topo.nodes.find((n) => n.id === target) : undefined;

  return (
    <div className="ve-canvas" ref={wrap}>
      <svg
        ref={svg}
        className={`topo-svg ve-svg tool-${space ? "pan" : tool}${dragging ? ` dragging-${dragging}` : ""}`}
        style={{ "--ts": topo.textScale ?? 1, "--hs": `${1 / scale}px` } as React.CSSProperties}
        viewBox={cam.join(" ")}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerLeave={() => !drag.current && setHover(null)}
        onDoubleClick={(e) => {
          const ref = (e.target as Element).closest("[data-ref]")?.getAttribute("data-ref");
          if (ref) props.onEdit(ref);
        }}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes(SHAPE_MIME)) {
            e.preventDefault();
            e.dataTransfer.dropEffect = "copy";
          }
        }}
        onDrop={(e) => {
          const shape = e.dataTransfer.getData(SHAPE_MIME) as Shape;
          if (!shape) return;
          e.preventDefault();
          props.onDropShape(shape, toSvg(e));
        }}
        onContextMenu={(e) => e.preventDefault()}
      >
        <defs>
          <pattern id="ve-grid-minor" width={10} height={10} patternUnits="userSpaceOnUse">
            <path d="M10 0 L0 0 0 10" className="ve-grid-minor" />
          </pattern>
          <pattern id="ve-grid" width={50} height={50} patternUnits="userSpaceOnUse">
            <rect width={50} height={50} fill="url(#ve-grid-minor)" />
            <path d="M50 0 L0 0 0 50" className="ve-grid-major" />
          </pattern>
        </defs>
        <rect className="ve-bg" x={cam[0]} y={cam[1]} width={cam[2]} height={cam[3]} fill={grid ? "url(#ve-grid)" : undefined} />

        {topo.groups?.map((g, i) => (
          <g key={i} data-ref={`g:${i}`} className="topo-group ve-area">
            <rect className="ve-area-hit" x={g.x} y={g.y} width={g.w} height={g.h} rx={4} />
            <rect x={g.x} y={g.y} width={g.w} height={g.h} rx={4} />
            <text x={g.x + g.w / 2} y={g.y + 18} textAnchor="middle">
              {g.label}
            </text>
          </g>
        ))}
        {topo.annotations.map((a, i) => (
          <text key={i} data-ref={`a:${i}`} className={`topo-annotation ${a.tone ?? "note"}`} x={a.at[0]} y={a.at[1]} textAnchor="middle">
            {a.text}
          </text>
        ))}
        {topo.links.map((l) => (
          <g key={l.id} data-ref={`l:${l.id}`}>
            <LinkShape link={l} state={linkState(l, {})} active={sel.has(`l:${l.id}`)} onSelect={() => {}} onHover={() => {}} />
          </g>
        ))}
        {topo.nodes.map((n) => (
          <g key={n.id} data-ref={`n:${n.id}`}>
            <NodeShape node={n} active={sel.has(`n:${n.id}`) || n.id === target} onSelect={() => {}} onHover={() => {}} />
          </g>
        ))}

        <g className="ve-overlay">
          {guides.map((g, i) =>
            g.x !== undefined ? (
              <line key={i} className="ve-guide" x1={g.x} x2={g.x} y1={cam[1]} y2={cam[1] + cam[3]} />
            ) : (
              <line key={i} className="ve-guide" x1={cam[0]} x2={cam[0] + cam[2]} y1={g.y} y2={g.y} />
            ),
          )}
          {selNodes.map((n) => (
            <rect key={n.id} className="ve-sel" x={n.x - 3} y={n.y - 3} width={n.w + 6} height={n.h + 6} />
          ))}
          {selection.flatMap((r) => {
            if (r.startsWith("a:")) {
              const a = topo.annotations[Number(r.slice(2))];
              if (!a) return [];
              const w = a.text.length * 3.7 * (topo.textScale ?? 1);
              const h = 9 * (topo.textScale ?? 1);
              return [<rect key={r} className="ve-sel" x={a.at[0] - w / 2 - 3} y={a.at[1] - h} width={w + 6} height={h + 4} />];
            }
            if (r.startsWith("g:")) {
              const i = Number(r.slice(2));
              const g = topo.groups?.[i];
              if (!g) return [];
              return [
                <rect key={r} className="ve-sel" x={g.x - 3} y={g.y - 3} width={g.w + 6} height={g.h + 6} />,
                <rect
                  key={`${r}-h`}
                  data-handle={`area|${i}`}
                  className="ve-handle resize"
                  x={g.x + g.w - hs / 2}
                  y={g.y + g.h - hs / 2}
                  width={hs}
                  height={hs}
                />,
              ];
            }
            return [];
          })}
          {selNodes.length === 1 && selection.length === 1 && (
            <rect
              data-handle={`resize|${selNodes[0].id}`}
              className="ve-handle resize"
              x={selNodes[0].x + selNodes[0].w + 3 - hs / 2}
              y={selNodes[0].y + selNodes[0].h + 3 - hs / 2}
              width={hs}
              height={hs}
            >
              <title>Arraste para redimensionar</title>
            </rect>
          )}
          {selLinks.map((l) => (
            <g key={l.id}>
              {l.points.slice(1).map((q, i) => {
                const pt = l.points[i];
                if (Math.hypot(q[0] - pt[0], q[1] - pt[1]) * scale < 14) return null;
                const [mx, my] = [(pt[0] + q[0]) / 2, (pt[1] + q[1]) / 2];
                const cls = pt[1] === q[1] ? "ns" : pt[0] === q[0] ? "ew" : "move";
                return (
                  <rect key={i} data-handle={`seg|${l.id}|${i}`} className={`ve-handle seg ${cls}`} x={mx - hs / 2} y={my - hs / 2} width={hs} height={hs}>
                    <title>Arraste para dobrar o cabo</title>
                  </rect>
                );
              })}
              {(["a", "b"] as const).map((end) => {
                const [x, y] = end === "a" ? l.points[0] : l.points[l.points.length - 1];
                return (
                  <circle key={end} data-handle={`end|${l.id}|${end}`} className="ve-handle end" cx={x} cy={y} r={hs * 0.65}>
                    <title>Arraste até outro ativo para religar esta ponta</title>
                  </circle>
                );
              })}
              {l.fibers && (
                <path
                  data-handle={`label|${l.id}`}
                  className="ve-handle label"
                  d={`M${fibersAt(l)[0]} ${fibersAt(l)[1] - 6 - hs * 0.6} l${hs * 0.6} ${hs * 0.6} l${-hs * 0.6} ${hs * 0.6} l${-hs * 0.6} ${-hs * 0.6}Z`}
                >
                  <title>Arraste para mover a etiqueta de fibras</title>
                </path>
              )}
            </g>
          ))}
          {portNodes.flatMap((n) =>
            portsOf(n).map(([x, y], i) => (
              <g key={`${n.id}-${i}`} data-handle={`port|${n.id}|${i}`} className="ve-port">
                <circle cx={x} cy={y} r={hs} className="ve-port-hit" />
                <path d={`M${x - hs * 0.45} ${y - hs * 0.45} L${x + hs * 0.45} ${y + hs * 0.45} M${x + hs * 0.45} ${y - hs * 0.45} L${x - hs * 0.45} ${y + hs * 0.45}`} />
                <title>Puxe até outro ativo para criar um enlace</title>
              </g>
            )),
          )}
          {targetNode && <rect className="ve-target" x={targetNode.x - 4} y={targetNode.y - 4} width={targetNode.w + 8} height={targetNode.h + 8} />}
          {lineFrom && cursor && (
            <path
              className={`ve-wire ${dragFrom?.kind === "connect" ? live.current.medium : ""}`}
              d={`M${lineFrom[0]} ${lineFrom[1]} L${targetNode ? centre(targetNode).join(" ") : cursor.join(" ")}`}
            />
          )}
          {marquee && <rect className="ve-marquee" x={marquee[0]} y={marquee[1]} width={marquee[2]} height={marquee[3]} />}
        </g>
      </svg>
    </div>
  );
}

export { SHAPE_MIME };
