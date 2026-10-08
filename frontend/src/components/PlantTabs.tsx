/* The plant picker shared by every screen: one tab per plant code, as on Topologia. */
export interface PlantTab {
  key: string;
  code: string;
  name?: string;
}

interface Props {
  plants: PlantTab[];
  value: string | null;
  onChange: (key: string) => void;
}

export function PlantTabs({ plants, value, onChange }: Props) {
  return (
    <div className="plant-tabs" role="tablist" aria-label="Planta">
      {plants.map((p) => (
        <button
          key={p.key}
          role="tab"
          aria-selected={p.key === value}
          className={p.key === value ? "active" : ""}
          title={p.name}
          onClick={() => onChange(p.key)}
        >
          {p.code}
        </button>
      ))}
    </div>
  );
}
