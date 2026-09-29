import { type Rack, UNIT_LABEL, usedU } from "./data";

const dec = (value: number, digits = 1) => value.toFixed(digits).replace(".", ",");

export function RackElevation({ rack }: { rack: Rack }) {
  const occupied = usedU(rack);
  const rows = Array.from({ length: rack.heightU }, (_, i) => rack.heightU - i);
  return (
    <div className="ex-rack">
      <div className="ex-rack-head">
        <span className="mono">{rack.name}</span>
        <span className="muted">
          {occupied}/{rack.heightU}U
        </span>
      </div>
      <div className="ex-rack-body" style={{ gridTemplateRows: `repeat(${rack.heightU}, 1fr)` }}>
        {rows.map((u) => (
          <span key={`slot-${u}`} className="ex-rack-slot" style={{ gridRow: rack.heightU - u + 1 }} />
        ))}
        {rack.units.map((unit) => (
          <span
            key={`${unit.start}-${unit.label}`}
            className={`ex-rack-unit ${unit.kind}`}
            style={{ gridRow: `${rack.heightU - (unit.start + unit.size - 1) + 1} / span ${unit.size}` }}
            title={`U${unit.start}${unit.size > 1 ? `–U${unit.start + unit.size - 1}` : ""} · ${UNIT_LABEL[unit.kind]}\n${unit.label}`}
          />
        ))}
      </div>
      <div className="ex-rack-foot muted mono">{dec(rack.powerKw, 2)} kW</div>
    </div>
  );
}
