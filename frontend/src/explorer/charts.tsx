import { useId } from "react";
import { HISTORY_POINTS, type Level, type MetricSpec, levelOf } from "./telemetry";

const LEVEL_COLOR: Record<Level, string> = { ok: "var(--ok)", warn: "var(--warn)", crit: "var(--crit)" };
const fmt = (value: number, digits: number) => value.toFixed(digits).replace(".", ",");

/* Arc gauge: 240° sweep, threshold bands drawn faintly, value arc in the level colour. */
const START = -210;
const SWEEP = 240;

function polar(cx: number, cy: number, r: number, deg: number) {
  const rad = (deg * Math.PI) / 180;
  return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)];
}

function arc(cx: number, cy: number, r: number, from: number, to: number) {
  const [x1, y1] = polar(cx, cy, r, from);
  const [x2, y2] = polar(cx, cy, r, to);
  return `M ${x1} ${y1} A ${r} ${r} 0 ${to - from > 180 ? 1 : 0} 1 ${x2} ${y2}`;
}

export function ArcGauge({ spec, value, max }: { spec: MetricSpec; value: number; max?: number }) {
  const top = max ?? spec.max;
  const frac = (v: number) => Math.max(0, Math.min(1, (v - spec.min) / (top - spec.min)));
  const angle = (v: number) => START + frac(v) * SWEEP;
  const level = levelOf(spec, value);
  const bands: [number, number, Level][] = [];
  const lowWarn = spec.low?.[0] ?? spec.min;
  const lowCrit = spec.low?.[1] ?? spec.min;
  const highWarn = spec.high?.[0] ?? top;
  const highCrit = spec.high?.[1] ?? top;
  if (spec.low) bands.push([spec.min, lowCrit, "crit"], [lowCrit, lowWarn, "warn"]);
  bands.push([lowWarn, highWarn, "ok"]);
  if (spec.high) bands.push([highWarn, highCrit, "warn"], [highCrit, top, "crit"]);
  const [nx, ny] = polar(60, 60, 46, angle(value));
  return (
    <div className={`gauge ${level}`}>
      <svg viewBox="0 0 120 92" role="img" aria-label={`${spec.label}: ${fmt(value, spec.digits)} ${spec.unit}`}>
        {bands.map(([a, b, l]) =>
          frac(b) > frac(a) ? <path key={`${a}-${l}`} d={arc(60, 60, 50, angle(a), angle(b))} className={`gauge-band ${l}`} /> : null,
        )}
        <path d={arc(60, 60, 42, START, START + SWEEP)} className="gauge-track" />
        <path d={arc(60, 60, 42, START, Math.max(START + 0.5, angle(value)))} className="gauge-value" style={{ stroke: LEVEL_COLOR[level] }} />
        <circle cx={nx} cy={ny} r={3} className="gauge-tip" style={{ fill: LEVEL_COLOR[level] }} />
        <text x="60" y="62" className="gauge-number">
          {fmt(value, spec.digits)}
        </text>
        <text x="60" y="76" className="gauge-unit">
          {spec.unit}
        </text>
        <text x="16" y="90" className="gauge-scale">
          {spec.min}
        </text>
        <text x="104" y="90" className="gauge-scale end">
          {String(top).replace(".", ",")}
        </text>
      </svg>
      <span className="gauge-label">{spec.label}</span>
    </div>
  );
}

/* 24h area chart with min / average / max. */
export function AreaChart({ title, spec, values, icon }: { title: string; spec: MetricSpec; values: number[]; icon: string }) {
  const id = useId().replace(/:/g, "");
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const avg = values.reduce((s, v) => s + v, 0) / values.length;
  const pad = (hi - lo || 1) * 0.12;
  const y0 = lo - pad;
  const y1 = hi + pad;
  const W = 300;
  const H = 90;
  const pts = values.map((v, i) => [(i / (HISTORY_POINTS - 1)) * W, H - ((v - y0) / (y1 - y0)) * H]);
  const line = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = `${line} L${W},${H} L0,${H} Z`;
  const current = values[values.length - 1];
  const level = levelOf(spec, current);
  const avgY = H - ((avg - y0) / (y1 - y0)) * H;
  return (
    <div className="panel room-chart">
      <div className="room-chart-head">
        <span>{title}</span>
        <span className="room-chart-icon" aria-hidden>
          {icon}
        </span>
      </div>
      <div className={`room-chart-value mono ${level}`}>
        {fmt(current, spec.digits)} <small>{spec.unit}</small>
      </div>
      <div className="room-chart-legend">
        <span>
          <i className="min" /> mín {fmt(lo, spec.digits)}
        </span>
        <span>
          <i className="avg" /> méd {fmt(avg, spec.digits)}
        </span>
        <span>
          <i className="max" /> máx {fmt(hi, spec.digits)}
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="room-chart-svg" aria-hidden>
        <defs>
          <linearGradient id={`g${id}`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" style={{ stopColor: spec.color }} stopOpacity="0.35" />
            <stop offset="100%" style={{ stopColor: spec.color }} stopOpacity="0" />
          </linearGradient>
        </defs>
        <line x1="0" x2={W} y1={avgY} y2={avgY} className="room-chart-avg" />
        <path d={area} fill={`url(#g${id})`} />
        <path d={line} fill="none" style={{ stroke: spec.color }} strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="room-chart-axis mono">
        <span>-24h</span>
        <span>-12h</span>
        <span>agora</span>
      </div>
    </div>
  );
}
