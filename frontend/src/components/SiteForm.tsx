import { type FormEvent, useState } from "react";
import { type RoomKind, type Site, type SiteCreatePayload, type SitePayload, api } from "../api";
import { Modal } from "./Modal";

const FIELDS: { key: keyof SitePayload; label: string; required?: boolean; numeric?: boolean; hint?: string }[] = [
  { key: "code", label: "Código", required: true },
  { key: "name", label: "Nome", required: true },
  { key: "city", label: "Cidade" },
  { key: "state", label: "UF" },
  { key: "country", label: "País" },
  { key: "latitude", label: "Latitude", numeric: true, hint: "-20,2863" },
  { key: "longitude", label: "Longitude", numeric: true, hint: "-45,5402" },
  { key: "notes", label: "Observações" },
];

interface RoomDraft {
  kind: RoomKind;
  code: string;
  name: string;
  heightU: string;
}

/* A new rack is 12U unless told otherwise (16U at most); a CPD starts with one 42U network rack. */
const roomDefaults = (kind: RoomKind): RoomDraft =>
  kind === "cpd" ? { kind, code: "CPD", name: "CPD", heightU: "42" } : { kind, code: "", name: "", heightU: "12" };

/* Creates a site (with at least one CPD or rack) or edits an existing site's fields. */
export function SiteForm({ site, onClose, onSaved }: { site: Site | null; onClose: () => void; onSaved: (site: Site) => void }) {
  const [draft, setDraft] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      FIELDS.map((f) => {
        const value = String(site?.[f.key] ?? "");
        return [f.key, f.numeric ? value.replace(".", ",") : value];
      }),
    ),
  );
  const [rooms, setRooms] = useState<RoomDraft[]>([roomDefaults("cpd")]);
  const [error, setError] = useState<string | null>(null);
  const setRoom = (i: number, patch: Partial<RoomDraft>) => setRooms(rooms.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const payload = Object.fromEntries(
      FIELDS.map((f) => {
        const value = draft[f.key].trim();
        if (value === "") return [f.key, null];
        return [f.key, f.numeric ? Number(value.replace(",", ".")) : value];
      }),
    ) as unknown as SitePayload;
    try {
      if (site) {
        onSaved(await api.sites.update(site.id, payload));
        return;
      }
      const create: SiteCreatePayload = {
        ...payload,
        rooms: rooms.map((r) => ({
          kind: r.kind,
          code: r.code.trim(),
          name: r.name.trim() || r.code.trim(),
          building: null,
          node_id: null,
          latitude: null,
          longitude: null,
          cameras: 0,
          cooling: null,
          access: null,
          power_capacity_kw: null,
          racks: [{ name: r.kind === "cpd" ? "RK-01 · Rede" : r.code.trim(), heightU: Number(r.heightU) }],
          notes: null,
        })),
      };
      onSaved(await api.sites.create(create));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <Modal
      title={site ? `Editar site · ${site.code}` : "Novo site"}
      onClose={onClose}
      footer={
        <>
          {error && <span className="form-error">{error}</span>}
          <button type="button" className="btn ghost" onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" form="site-form" className="btn primary">
            Salvar
          </button>
        </>
      }
    >
      <form id="site-form" className="form-grid" onSubmit={submit}>
        <fieldset className="wide">
          <legend>Site</legend>
          {FIELDS.map((f) => (
            <label key={f.key}>
              {f.label}
              <input
                value={draft[f.key]}
                required={f.required}
                placeholder={f.hint}
                inputMode={f.numeric ? "decimal" : undefined}
                pattern={f.numeric ? "-?[0-9]+([.,][0-9]+)?" : undefined}
                onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })}
              />
            </label>
          ))}
        </fieldset>
        {!site && (
          <fieldset className="wide">
            <legend>CPD e racks</legend>
            <p className="hint">Todo site precisa de pelo menos um CPD ou rack. Os detalhes (switch, climatização, câmeras) são editados depois, na página de cada um.</p>
            <div className="row-edit row-edit-head" style={{ gridTemplateColumns: "110px 1fr 1.4fr 90px 28px" }}>
              <span>Tipo</span>
              <span>Código</span>
              <span>Nome</span>
              <span>Altura</span>
              <span />
            </div>
            {rooms.map((room, i) => (
              <div key={i} className="row-edit" style={{ gridTemplateColumns: "110px 1fr 1.4fr 90px 28px" }}>
                <select
                  value={room.kind}
                  onChange={(e) => setRoom(i, roomDefaults(e.target.value as RoomKind))}
                  aria-label="Tipo"
                >
                  <option value="cpd">CPD</option>
                  <option value="rack">Rack</option>
                </select>
                <input value={room.code} onChange={(e) => setRoom(i, { code: e.target.value })} required placeholder="RK-ADM" aria-label="Código" />
                <input value={room.name} onChange={(e) => setRoom(i, { name: e.target.value })} placeholder="Rack Administrativo" aria-label="Nome" />
                <select value={room.heightU} onChange={(e) => setRoom(i, { heightU: e.target.value })} aria-label="Altura">
                  {(room.kind === "cpd" ? ["42"] : ["12", "16"]).map((u) => (
                    <option key={u} value={u}>
                      {u}U
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="icon-btn"
                  aria-label="Remover"
                  disabled={rooms.length === 1}
                  title={rooms.length === 1 ? "O site precisa de pelo menos um CPD ou rack" : "Remover"}
                  onClick={() => setRooms(rooms.filter((_, j) => j !== i))}
                >
                  ×
                </button>
              </div>
            ))}
            <button type="button" className="btn ghost small" onClick={() => setRooms([...rooms, roomDefaults("rack")])}>
              + Adicionar rack ou CPD
            </button>
          </fieldset>
        )}
      </form>
    </Modal>
  );
}
