import type { InternetLink, Vlan } from "../api";
import { EDGE_MODEL, type EdgeHa, HA_LABEL, type LinkHealth, type LinkTelemetry } from "./simulation";

const W = 1000;
const H = 560;
const EDGE = { x: W / 2, y: 300 };
const CORE = { x: W / 2, y: 460 };
const ISP_Y = 96;
const MAX_CHIPS = 6;

export const HEALTH_COLOR: Record<LinkHealth, string> = {
  up: "var(--ok)",
  degraded: "var(--warn)",
  down: "var(--crit)",
  standby: "var(--idle)",
};

interface Props {
  links: InternetLink[];
  telemetry: Map<number, LinkTelemetry>;
  ha: EdgeHa;
  selectedId: number | null;
  onSelect: (id: number | null) => void;
}

function Plate({ x, y, w, h, depth, active }: { x: number; y: number; w: number; h: number; depth: number; active: boolean }) {
  const top = `${x},${y - h} ${x + w},${y} ${x},${y + h} ${x - w},${y}`;
  const left = `${x - w},${y} ${x},${y + h} ${x},${y + h + depth} ${x - w},${y + depth}`;
  const right = `${x + w},${y} ${x},${y + h} ${x},${y + h + depth} ${x + w},${y + depth}`;
  return (
    <g className={`plate${active ? " active" : ""}`}>
      <polygon points={left} className="plate-side" />
      <polygon points={right} className="plate-side dark" />
      <polygon points={top} className="plate-top" />
    </g>
  );
}

/*
 * Starlink terminal, drawn in the same isometric plates as the other nodes: a tilted rectangular dish
 * on a mast with a four-leg base, like the Starlink Business kit.
 */
function StarlinkDish({ x, y, active }: { x: number; y: number; active: boolean }) {
  return (
    <g className={`dish${active ? " active" : ""}`} transform={`translate(${x} ${y})`}>
      <g className="dish-base">
        <line x1={2} y1={41} x2={27} y2={38} />
        <line x1={2} y1={41} x2={-40} y2={52} />
        <line x1={2} y1={41} x2={50} y2={47} />
        <line x1={2} y1={41} x2={18} y2={54} />
        <circle cx={-40} cy={52} r={1.8} />
        <circle cx={50} cy={47} r={1.8} />
        <circle cx={18} cy={54} r={1.8} />
      </g>
      <rect x={-1.5} y={14} width={7} height={28} rx={1.5} className="plate-side dark" />
      <polygon points="-40,14 4,18 34,-15 34,-11 4,22 -40,18" className="plate-side" />
      <polygon points="-40,14 2,-18 34,-15 4,18" className="plate-top" />
      <polygon points="-29,11 3,-12 24,-10 2,13" className="dish-inner" />
    </g>
  );
}

// Quantize usage so particle timing only changes on meaningful steps; changing
// SVG animation timing on every tick would make the particles jump.
function flow(t: LinkTelemetry | undefined, capacity: number | null) {
  if (!t || t.health === "down") return { count: 0, dur: 0 };
  if (t.health === "standby") return { count: 1, dur: 6 };
  const ratio = t.usageMbps / (capacity || 100);
  const level = ratio > 0.66 ? 3 : ratio > 0.33 ? 2 : 1;
  return { count: level + 1, dur: [0, 3.6, 2.6, 1.8][level] };
}

function Particles({ pathId, count, dur, color, reverse }: { pathId: string; count: number; dur: number; color: string; reverse?: boolean }) {
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <circle key={`${pathId}-${reverse ? "r" : "f"}-${count}-${dur}-${i}`} r={reverse ? 2 : 2.8} fill={color} className="particle" opacity={reverse ? 0.55 : 1}>
          <animateMotion
            dur={`${dur}s`}
            begin={`${(-dur * i) / count}s`}
            repeatCount="indefinite"
            keyPoints={reverse ? "1;0" : "0;1"}
            keyTimes="0;1"
            calcMode="linear"
          >
            <mpath href={`#${pathId}`} />
          </animateMotion>
        </circle>
      ))}
    </>
  );
}

const isStarlink = (link: InternetLink) => /starlink/i.test(`${link.provider} ${link.technology ?? ""}`);

function uniqueVlans(links: InternetLink[]): Vlan[] {
  const seen = new Map<number, Vlan>();
  for (const link of links) for (const vlan of link.vlans) if (!seen.has(vlan.vlan_id)) seen.set(vlan.vlan_id, vlan);
  return [...seen.values()].sort((a, b) => a.vlan_id - b.vlan_id);
}

/* The VeloCloud pair, one plate per unit stacked like the hardware; the dot marks the active unit. */
function EdgePair({ ha, active, devices }: { ha: EdgeHa; active: boolean; devices: string[] }) {
  const units = [
    { n: 2 as const, y: EDGE.y + 10 },
    { n: 1 as const, y: EDGE.y - 14 },
  ];
  const label = `#${ha.active} ativo · #${ha.active === 1 ? 2 : 1} ${ha.state === "lost" ? "sem resposta" : "standby"}`;
  return (
    <g className={`edge-node ha-${ha.state}`}>
      <title>{`${EDGE_MODEL} ×2 em alta disponibilidade · ${HA_LABEL[ha.state]}`}</title>
      {units.map(({ n, y }) => {
        const on = n === ha.active;
        const unitDown = ha.state === "lost" && !on;
        return (
          <g key={n} className={`edge-unit${on ? " on" : ""}${unitDown ? " unit-lost" : ""}`}>
            <Plate x={EDGE.x} y={y} w={52} h={20} depth={9} active={active && !unitDown} />
            <polygon points={`${EDGE.x},${y - 11} ${EDGE.x + 24},${y} ${EDGE.x},${y + 11} ${EDGE.x - 24},${y}`} className="edge-inner" />
            <circle cx={EDGE.x} cy={y} r={on ? 4.5 : 3} className={`edge-core${on ? " pulse" : ""}`} />
            <text x={EDGE.x - 64} y={y + 4} className="edge-unit-tag">
              #{n}
            </text>
          </g>
        );
      })}
      {/* Heartbeat between the two units, on the left edge of the stack. */}
      <path d={`M ${EDGE.x - 52} ${EDGE.y - 14} L ${EDGE.x - 52} ${EDGE.y + 10}`} className="ha-heartbeat" />
      {ha.state === "lost" && (
        <text x={EDGE.x - 82} y={EDGE.y + 2} className="ha-mark">
          ⚠
        </text>
      )}
      <text x={EDGE.x + 80} y={EDGE.y - 12} className="node-label left">
        SD-WAN EDGE · HA
      </text>
      <text x={EDGE.x + 80} y={EDGE.y + 5} className="node-meta left">
        {EDGE_MODEL} ×2{devices.length ? ` · ${devices.join(" · ")}` : ""}
      </text>
      <g className="ha-status">
        <circle cx={EDGE.x + 85} cy={EDGE.y + 18} r={4} />
        <text x={EDGE.x + 95} y={EDGE.y + 22}>
          {HA_LABEL[ha.state].toUpperCase()} · {label}
        </text>
      </g>
    </g>
  );
}

export function Topology({ links, telemetry, ha, selectedId, onSelect }: Props) {
  const n = links.length;
  const span = Math.min(W - 180, Math.max(260, n * 220));
  const xs = links.map((_, i) => (n === 1 ? W / 2 : W / 2 - span / 2 + (span * i) / (n - 1)));
  const selected = links.find((l) => l.id === selectedId);
  const selectedVlans = new Set(selected?.vlans.map((v) => v.vlan_id));
  const allVlans = uniqueVlans(links);
  const vlans = allVlans.slice(0, MAX_CHIPS);
  const hiddenVlans = allVlans.length - vlans.length;
  const anyUp = links.some((l) => telemetry.get(l.id)?.health === "up");
  const devices = [...new Set(links.map((l) => l.sdwan_device).filter((d): d is string => !!d))];

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="topology" role="img" aria-label="Topologia WAN" onClick={() => onSelect(null)}>
      <defs>
        <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="4" />
        </filter>
        <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
          <path d="M 40 0 L 0 0 0 40" className="grid-line" />
        </pattern>
      </defs>
      <rect width={W} height={H} fill="url(#grid)" />

      {links.map((link, i) => {
        const x = xs[i];
        const t = telemetry.get(link.id);
        const health = t?.health ?? "standby";
        const color = HEALTH_COLOR[health];
        const d = `M ${x} ${ISP_Y + 34} C ${x} ${ISP_Y + 150}, ${EDGE.x} ${EDGE.y - 130}, ${EDGE.x} ${EDGE.y - 26}`;
        const pathId = `wan-path-${link.id}`;
        const { count, dur } = flow(t, link.bandwidth_mbps);
        const dim = selectedId !== null && selectedId !== link.id;
        return (
          <g
            key={link.id}
            className={`wan-link health-${health}${dim ? " dim" : ""}${selectedId === link.id ? " selected" : ""}`}
            onClick={(e) => {
              e.stopPropagation();
              onSelect(link.id);
            }}
          >
            <path d={d} className="link-hit" />
            {health !== "down" && health !== "standby" && (
              <path d={d} stroke={color} className="link-glow" filter="url(#glow)" />
            )}
            <path id={pathId} d={d} stroke={color} className="link-line" />
            <Particles pathId={pathId} count={count} dur={dur} color={color} />
            {health === "up" && <Particles pathId={pathId} count={Math.max(1, count - 1)} dur={dur * 1.4} color={color} reverse />}

            {isStarlink(link) ? (
              <StarlinkDish x={x} y={ISP_Y - 8} active={health === "up"} />
            ) : (
              <Plate x={x} y={ISP_Y} w={62} h={20} depth={9} active={health === "up"} />
            )}
            <circle cx={x} cy={isStarlink(link) ? ISP_Y - 8 : ISP_Y} r={4} fill={color} className={health === "up" ? "pulse" : undefined} />
            <text x={x} y={ISP_Y - 48} className="node-label">
              {link.provider.toUpperCase()}
            </text>
            <text x={x} y={ISP_Y - 31} className="node-meta">
              {link.bandwidth_mbps ? `${link.bandwidth_mbps} Mbps` : "—"}
              {link.sdwan_port ? ` · ${link.sdwan_port}` : ""}
            </text>
            {health === "down" && (
              <text x={(x + EDGE.x) / 2} y={(ISP_Y + EDGE.y) / 2 + 10} className="down-mark">
                ✕
              </text>
            )}
          </g>
        );
      })}

      <g className="trunk">
        <path id="trunk-path" d={`M ${EDGE.x} ${EDGE.y + 30} L ${CORE.x} ${CORE.y - 30}`} className="link-line" stroke={anyUp ? "var(--ok)" : "var(--idle)"} />
        <path d={`M ${EDGE.x - 5} ${EDGE.y + 30} L ${CORE.x - 5} ${CORE.y - 30}`} className="link-line thin" stroke={anyUp ? "var(--ok)" : "var(--idle)"} />
        <path d={`M ${EDGE.x + 5} ${EDGE.y + 30} L ${CORE.x + 5} ${CORE.y - 30}`} className="link-line thin" stroke={anyUp ? "var(--ok)" : "var(--idle)"} />
        {anyUp && <Particles pathId="trunk-path" count={3} dur={1.6} color="var(--ok)" />}
        {anyUp && <Particles pathId="trunk-path" count={2} dur={2.2} color="var(--ok)" reverse />}
      </g>

      <EdgePair ha={ha} active={anyUp} devices={devices} />

      <g className="core-node">
        <ellipse cx={CORE.x} cy={CORE.y + 18} rx={92} ry={24} className="core-side" />
        <rect x={CORE.x - 92} y={CORE.y - 6} width={184} height={24} className="core-side" />
        <ellipse cx={CORE.x} cy={CORE.y - 6} rx={92} ry={24} className="core-top" />
        <text x={CORE.x + 116} y={CORE.y} className="node-label left">
          CORE · LAN
        </text>
        <text x={CORE.x + 116} y={CORE.y + 18} className="node-meta left">
          {allVlans.length} VLAN{allVlans.length === 1 ? "" : "s"} interna{allVlans.length === 1 ? "" : "s"}
          {hiddenVlans > 0 ? ` (+${hiddenVlans} não exibidas)` : ""}
        </text>
      </g>

      <g className="vlan-row">
        {vlans.map((vlan, i) => {
          const chipW = 118;
          const total = vlans.length * chipW + (vlans.length - 1) * 10;
          const x = W / 2 - total / 2 + i * (chipW + 10);
          const on = selected ? selectedVlans.has(vlan.vlan_id) : true;
          return (
            <g key={vlan.vlan_id} className={`vlan-chip${on ? "" : " off"}`}>
              <rect x={x} y={CORE.y + 58} width={chipW} height={32} rx={4} />
              <text x={x + 10} y={CORE.y + 72} className="vlan-id">
                VLAN {vlan.vlan_id}
              </text>
              <text x={x + 10} y={CORE.y + 84} className="vlan-name">
                {vlan.name ?? vlan.subnet ?? ""}
              </text>
            </g>
          );
        })}
      </g>
    </svg>
  );
}
