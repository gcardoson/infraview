import { type Endpoint, type Point, type SiteTopology, type TopoLink, type TopoNode } from "./data";
import { midpoint } from "./edit";
import { type LinkState, type NodeHealth, hasDevice, linkState } from "./status";

/* SVG rendering of a plant's Layer 2 drawing, in the InfraView dark style. */

export type Selection = { kind: "node"; id: string } | { kind: "link"; id: string } | null;

interface Props {
  topology: SiteTopology;
  health: Record<string, NodeHealth>;
  selected: Selection;
  hovered: Selection;
  /* The event lets the page tell a plain click from Ctrl/Shift+click (add to the selection). */
  onSelect: (s: Selection, e?: React.MouseEvent) => void;
  onHover: (s: Selection, e?: React.MouseEvent) => void;
}

/* Squeeze a label that would overflow its frame (SVG text doesn't wrap). */
const fit = (text: string, charWidth: number, max: number) =>
  text.length * charWidth > max ? { textLength: max, lengthAdjust: "spacingAndGlyphs" as const } : {};

const path = (points: Point[]) => points.map(([x, y], i) => `${i ? "L" : "M"}${x} ${y}`).join(" ");

/* Port name next to where the cable meets the frame: rotated along vertical cables, like the drawing. */
function PortLabel({ end, from, to }: { end: Endpoint; from: Point; to: Point }) {
  if (!end.port) return null;
  const vertical = from[0] === to[0];
  const dir = vertical ? Math.sign(to[1] - from[1]) : Math.sign(to[0] - from[0]);
  if (vertical) {
    const x = from[0] + 4;
    const y = from[1] + dir * 5;
    return (
      <text className="topo-port" x={x} y={y} transform={`rotate(90 ${x} ${y})`} textAnchor={dir > 0 ? "start" : "end"} dominantBaseline="hanging">
        {end.port}
      </text>
    );
  }
  return (
    <text className="topo-port" x={from[0] + dir * 5} y={from[1] - 3} textAnchor={dir > 0 ? "start" : "end"}>
      {end.port}
    </text>
  );
}

function Connector({ end, at, toward }: { end: Endpoint; at: Point; toward: Point }) {
  if (end.connector === "sfp") return <rect className="topo-sfp" x={at[0] - 2.4} y={at[1] - 2.4} width={4.8} height={4.8} />;
  if (end.connector === "converter") return <circle className="topo-converter" cx={at[0]} cy={at[1]} r={2.6} />;
  if (end.connector === "injector") {
    // Arrow pointing into the switch, as the power injector symbol in the legend.
    const dx = Math.sign(at[0] - toward[0]);
    const dy = Math.sign(at[1] - toward[1]);
    const [x, y] = at;
    const d = dy ? `M${x - 3} ${y - dy * 4} L${x} ${y} L${x + 3} ${y - dy * 4}` : `M${x - dx * 4} ${y - 3} L${x} ${y} L${x - dx * 4} ${y + 3}`;
    return <path className="topo-injector" d={d} />;
  }
  return null;
}

function Break({ at }: { at: Point }) {
  const [x, y] = at;
  return <path className="topo-break" d={`M${x - 4} ${y - 4} L${x + 4} ${y + 4} M${x + 4} ${y - 4} L${x - 4} ${y + 4}`} />;
}

/* Where the fibre count is written: the drawing's own spot, or just above the middle of the cable. */
export const fibersAt = (link: TopoLink): Point => {
  if (link.labelAt) return link.labelAt;
  const [x, y] = midpoint(link.points);
  return [x, y - 4];
};

export function LinkShape({ link, state, active, onSelect, onHover }: { link: TopoLink; state: LinkState; active: boolean } & Pick<Props, "onSelect" | "onHover">) {
  const pts = link.points;
  const segments = pts.slice(1).map((p, i) => [pts[i], p] as [Point, Point]);
  const solid = segments.filter((_, i) => !link.dotted?.includes(i));
  const dotted = segments.filter((_, i) => link.dotted?.includes(i));
  const segPath = (list: [Point, Point][]) => list.map(([a, b]) => `M${a[0]} ${a[1]} L${b[0]} ${b[1]}`).join(" ");
  const d = path(pts);
  const select = { kind: "link", id: link.id } as const;
  return (
    <g
      className={`topo-link ${link.medium} ${state}${active ? " active" : ""}`}
      onClick={(e) => {
        e.stopPropagation();
        onSelect(select, e);
      }}
      onMouseMove={(e) => onHover(select, e)}
      onMouseLeave={() => onHover(null)}
    >
      <path className="topo-link-hit" d={d} />
      {solid.length > 0 && <path className="topo-link-line" d={segPath(solid)} />}
      {dotted.length > 0 && <path className="topo-link-line bypass" d={segPath(dotted)} />}
      {state !== "down" && link.medium !== "wireless" && <path className="topo-link-flow" d={d} />}
      <Connector end={link.a} at={pts[0]} toward={pts[1]} />
      <Connector end={link.b} at={pts[pts.length - 1]} toward={pts[pts.length - 2]} />
      <PortLabel end={link.a} from={pts[0]} to={pts[1]} />
      <PortLabel end={link.b} from={pts[pts.length - 1]} to={pts[pts.length - 2]} />
      {link.fibers && (
        <text className="topo-fibers" x={fibersAt(link)[0]} y={fibersAt(link)[1]} textAnchor="middle">
          {link.fibers}FO
        </text>
      )}
      {link.breaks?.map((b) => <Break key={`${b[0]}-${b[1]}`} at={b} />)}
    </g>
  );
}

/* A tiny faceplate: a strip of port squares, suggesting the switch model like the drawing's photo. */
function Faceplate({ x, y, w, ports }: { x: number; y: number; w: number; ports: number }) {
  const cols = ports / 2;
  const cell = Math.min(3.1, (w - 16) / cols);
  const start = x + (w - cols * cell) / 2 - 4;
  return (
    <g className="topo-face">
      <rect x={x} y={y} width={w} height={9} rx={1} />
      {Array.from({ length: cols }, (_, i) => (
        <g key={i}>
          <rect className="port" x={start + i * cell} y={y + 1.6} width={cell - 0.8} height={2.4} />
          <rect className="port" x={start + i * cell} y={y + 4.8} width={cell - 0.8} height={2.4} />
        </g>
      ))}
      <rect className="uplink" x={x + w - 10} y={y + 2} width={7} height={5} />
    </g>
  );
}

export function NodeShape({
  node,
  health,
  active,
  onSelect,
  onHover,
}: { node: TopoNode; health?: NodeHealth; active: boolean } & Pick<
  Props,
  "onSelect" | "onHover"
>) {
  const status = health?.status ?? "none";
  const select = { kind: "node", id: node.id } as const;
  const events = {
    onClick: (e: React.MouseEvent) => {
      e.stopPropagation();
      onSelect(select, e);
    },
    onMouseMove: (e: React.MouseEvent) => onHover(select, e),
    onMouseLeave: () => onHover(null),
  };

  if (node.kind === "ap") {
    return (
      <g className={`topo-node ap ${status}${active ? " active" : ""}`} transform={`translate(${node.x} ${node.y})`} {...events}>
        <rect className="topo-frame" width={node.w} height={node.h} rx={11} />
        <circle className="ap-led" cx={node.w / 2} cy={node.h / 2} r={1.6} />
        <circle className="topo-status" cx={node.w - 3} cy={3} r={3} />
        <text className="topo-ap-name" x={node.w / 2} y={node.h + 9} textAnchor="middle">
          {node.hostname}
        </text>
      </g>
    );
  }

  // Larger frames scale their content up, so text keeps its proportion to the box.
  const k = Math.max(1, Math.min(1.3, node.w / 98, node.h / 92));
  const w = node.w / k;
  const h = node.h / k;
  const cx = w / 2;
  const line = 10;
  const top = 14;
  const passive = !hasDevice(node);
  const hostWidth = (node.hostname?.length ?? 0) * 4.6;
  const stack = node.model?.includes("&");
  return (
    <g className={`topo-node ${node.kind} ${status}${active ? " active" : ""}`} transform={`translate(${node.x} ${node.y})`} {...events}>
      <rect className="topo-frame" width={node.w} height={node.h} rx={3} />
      <g transform={`scale(${k})`}>
        {node.bypass === "diagonal" && (
          <path className="topo-bypass" d={`M${w * 0.29} 0 L0 ${h * 0.55} M${w} ${h * 0.45} L${w * 0.8} ${h}`} />
        )}
        {node.bypass === "vertical" && <path className="topo-bypass" d={`M17 0 L17 ${h}`} />}
        <text className="topo-loc" x={cx} y={top} textAnchor="middle" {...fit(`${node.location ?? ""} / ${node.locationEn ?? ""}`, 3.35, w - 10)}>
          <tspan className="pt">{node.location}</tspan>
          {node.locationEn && <tspan className="en"> / {node.locationEn}</tspan>}
        </text>
        {passive ? (
          <>
            <text className="topo-host" x={cx} y={h / 2 + 4} textAnchor="middle">
              Sem ativo
            </text>
            {node.bypass && (
              <text className="topo-model" x={cx} y={h / 2 + 4 + line} textAnchor="middle">
                somente passagem
              </text>
            )}
          </>
        ) : (
          <>
            {/* Status bullet sits right before the hostname, so it reads as that device's state. */}
            <circle className="topo-status-halo" cx={cx - hostWidth / 2 - 7} cy={top + line + 3.4} r={6} />
            <circle className="topo-status" cx={cx - hostWidth / 2 - 7} cy={top + line + 3.4} r={3.2} />
            <text className="topo-host" x={cx} y={top + line + 6} textAnchor="middle">
              {node.hostname}
            </text>
            <text className="topo-ip" x={cx} y={top + 2 * line + 5} textAnchor="middle">
              {node.ip}
            </text>
            {node.nok && (
              <text className="topo-nok" x={cx} y={top + 3 * line + 4} textAnchor="middle" {...fit(node.nok, 3.3, w - 10)}>
                {node.nok}
              </text>
            )}
            <text className="topo-model" x={cx} y={stack ? h - 42 : h - 18} textAnchor="middle" {...fit(node.model ?? "", 3.75, w - 10)}>
              {node.model}
            </text>
            {stack ? (
              <>
                <Faceplate x={12} y={h - 34} w={w - 24} ports={node.model?.includes("48") ? 48 : 24} />
                <path className="topo-stack" d={`M18 ${h - 23} L18 ${h - 16} M16 ${h - 21} L18 ${h - 23} L20 ${h - 21} M16 ${h - 18} L18 ${h - 16} L20 ${h - 18}`} />
                <text className="topo-stack-label" x={24} y={h - 17.5}>
                  stack
                </text>
                <Faceplate x={12} y={h - 14} w={w - 24} ports={node.model?.includes("48") ? 48 : 24} />
              </>
            ) : (
              <Faceplate x={8} y={h - 13} w={w - 16} ports={node.model?.includes("48") ? 48 : 24} />
            )}
          </>
        )}
      </g>
    </g>
  );
}

export function Diagram({ topology, health, selected, hovered, onSelect, onHover }: Props) {
  const focus = hovered ?? selected;
  // What stays lit when something is focused: the item, and for a device its links and neighbours.
  const lit = new Set<string>();
  if (focus?.kind === "node") {
    lit.add(`n:${focus.id}`);
    for (const l of topology.links) {
      if (l.a.node === focus.id || l.b.node === focus.id) {
        lit.add(`l:${l.id}`);
        lit.add(`n:${l.a.node}`);
        lit.add(`n:${l.b.node}`);
      }
    }
  } else if (focus?.kind === "link") {
    const l = topology.links.find((x) => x.id === focus.id);
    if (l) {
      lit.add(`l:${l.id}`);
      lit.add(`n:${l.a.node}`);
      lit.add(`n:${l.b.node}`);
    }
  }
  const [vx, vy, vw, vh] = topology.view;

  return (
    <svg
      className={`topo-svg${focus ? " focused" : ""}`}
      style={{ "--ts": topology.textScale ?? 1 } as React.CSSProperties}
      viewBox={`${vx} ${vy} ${vw} ${vh}`}
      role="img"
      aria-label={`Topologia de camada 2 de ${topology.code}`}
      onClick={() => onSelect(null)}
    >
      {topology.groups?.map((g) => (
        <g key={g.label} className="topo-group">
          <rect x={g.x} y={g.y} width={g.w} height={g.h} rx={4} />
          <text x={g.x + g.w / 2} y={g.y + 18} textAnchor="middle">
            {g.label}
          </text>
        </g>
      ))}
      {topology.annotations.map((a) => (
        <text key={`${a.text}-${a.at[0]}`} className={`topo-annotation ${a.tone ?? "note"}`} x={a.at[0]} y={a.at[1]} textAnchor="middle">
          {a.text}
        </text>
      ))}
      {topology.links.map((l) => (
        <LinkShape key={l.id} link={l} state={linkState(l, health)} active={lit.has(`l:${l.id}`)} onSelect={onSelect} onHover={onHover} />
      ))}
      {topology.nodes.map((n) => (
        <NodeShape
          key={n.id}
          node={n}
          health={health[n.id]}
          active={lit.has(`n:${n.id}`)}
          onSelect={onSelect}
          onHover={onHover}
        />
      ))}
    </svg>
  );
}
