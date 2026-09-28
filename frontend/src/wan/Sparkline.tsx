import { useState } from "react";

interface Props {
  values: number[];
  max: number;
  format: (value: number) => string;
  label: string;
  height?: number;
}

// Single-series area chart with a hover readout. Values are one sample per tick.
export function Sparkline({ values, max, format, label, height = 64 }: Props) {
  const [hover, setHover] = useState<number | null>(null);
  const w = 260;
  const top = max || 1;
  const x = (i: number) => (i / Math.max(1, values.length - 1)) * w;
  const y = (v: number) => height - 2 - (Math.min(v, top) / top) * (height - 6);
  const line = values.map((v, i) => `${i ? "L" : "M"} ${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(" ");
  const shown = hover ?? values.length - 1;

  return (
    <div className="spark">
      <div className="spark-readout">
        <span className="big-number">{values.length ? format(values[shown]) : "—"}</span>
        <span className="muted">{hover === null ? "agora" : `${values.length - 1 - hover} amostras atrás`}</span>
      </div>
      <svg
        viewBox={`0 0 ${w} ${height}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={label}
        onMouseMove={(e) => {
          const box = e.currentTarget.getBoundingClientRect();
          const i = Math.round(((e.clientX - box.left) / box.width) * (values.length - 1));
          setHover(Math.max(0, Math.min(values.length - 1, i)));
        }}
        onMouseLeave={() => setHover(null)}
      >
        {values.length > 1 && (
          <>
            <path d={`${line} L ${w} ${height} L 0 ${height} Z`} className="spark-area" />
            <path d={line} className="spark-line" vectorEffect="non-scaling-stroke" />
            {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={0} y2={height} className="spark-cursor" vectorEffect="non-scaling-stroke" />}
          </>
        )}
      </svg>
    </div>
  );
}
