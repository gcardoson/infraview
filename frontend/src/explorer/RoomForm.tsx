import { type FormEvent, useState } from "react";
import { type RackSpec, type RoomKind, type RoomPayload, type RoomRecord, type Site, api } from "../api";
import { Modal } from "../components/Modal";
import { type SiteTopology, nodeLabel } from "../topology/data";
import { roomNodes } from "./data";

interface Draft {
  site_id: string;
  kind: RoomKind;
  code: string;
  name: string;
  building: string;
  node_id: string;
  latitude: string;
  longitude: string;
  cameras: string;
  cooling: string;
  access: string;
  power_capacity_kw: string;
  racks: { name: string; heightU: string }[];
  notes: string;
}

const text = (v: string | null | undefined) => v ?? "";
const decimal = (v: number | null) => (v === null ? "" : String(v).replace(".", ","));
const number = (v: string) => (v.trim() === "" ? null : Number(v.replace(",", ".")));

function draftOf(room: RoomRecord | null, siteId: number | null, kind: RoomKind): Draft {
  return {
    site_id: String(room?.site_id ?? siteId ?? ""),
    kind: room?.kind ?? kind,
    code: text(room?.code),
    name: text(room?.name),
    building: text(room?.building),
    node_id: text(room?.node_id),
    latitude: decimal(room?.latitude ?? null),
    longitude: decimal(room?.longitude ?? null),
    cameras: String(room?.cameras ?? (kind === "cpd" ? 1 : 0)),
    cooling: text(room?.cooling),
    access: text(room?.access),
    power_capacity_kw: decimal(room?.power_capacity_kw ?? null),
    racks: (room?.racks ?? (kind === "cpd" ? [{ name: "RK-01 · Rede", heightU: 42 }] : [{ name: "", heightU: 12 }])).map(
      (r: RackSpec) => ({ name: r.name, heightU: String(r.heightU) }),
    ),
    notes: text(room?.notes),
  };
}

interface Props {
  room: RoomRecord | null;
  siteId: number | null;
  sites: Site[];
  topologies: SiteTopology[];
  onClose: () => void;
  onSaved: (room: RoomRecord) => void;
  onDeleted?: () => void;
}

/* Creates or edits a CPD or access rack: identification, the switch it holds, racks and facilities. */
export function RoomForm({ room, siteId, sites, topologies, onClose, onSaved, onDeleted }: Props) {
  const [draft, setDraft] = useState<Draft>(() => draftOf(room, siteId, "rack"));
  const [error, setError] = useState<string | null>(null);
  const set = (key: keyof Draft) => (e: { target: { value: string } }) => setDraft({ ...draft, [key]: e.target.value });
  const topology = topologies.find((t) => t.siteId === Number(draft.site_id));
  const switches = topology ? roomNodes(topology) : [];
  const site = sites.find((s) => s.id === Number(draft.site_id));
  const heights = draft.kind === "cpd" ? ["42", "44", "47"] : ["12", "16"];

  const setKind = (kind: RoomKind) => {
    const fresh = draftOf(null, Number(draft.site_id), kind);
    setDraft({ ...draft, kind, racks: fresh.racks, cameras: fresh.cameras });
  };
  const setRack = (i: number, patch: Partial<Draft["racks"][number]>) =>
    setDraft({ ...draft, racks: draft.racks.map((r, j) => (j === i ? { ...r, ...patch } : r)) });

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const code = draft.code.trim();
    const payload: RoomPayload = {
      site_id: Number(draft.site_id),
      kind: draft.kind,
      code,
      name: draft.name.trim() || code,
      building: draft.building.trim() || null,
      node_id: draft.node_id || null,
      latitude: number(draft.latitude),
      longitude: number(draft.longitude),
      cameras: Number(draft.cameras) || 0,
      cooling: draft.cooling.trim() || null,
      access: draft.access.trim() || null,
      power_capacity_kw: number(draft.power_capacity_kw),
      racks: draft.racks.map((r, i) => ({ name: r.name.trim() || (i === 0 ? code : `${code}-${i + 1}`), heightU: Number(r.heightU) })),
      notes: draft.notes.trim() || null,
    };
    try {
      onSaved(room ? await api.rooms.update(room.id, payload) : await api.rooms.create(payload));
    } catch (e) {
      const message = (e as Error).message;
      setError(/conflict/i.test(message) ? `Já existe ${code} neste site.` : message);
    }
  };

  const remove = async () => {
    if (!room || !confirm(`Excluir ${room.kind === "cpd" ? "o CPD" : "o rack"} ${room.code}?`)) return;
    try {
      await api.rooms.remove(room.id);
      onDeleted?.();
    } catch (e) {
      const message = (e as Error).message;
      setError(/at least one/i.test(message) ? "Este é o único CPD/rack do site; todo site precisa de pelo menos um." : message);
    }
  };

  const label = draft.kind === "cpd" ? "CPD" : "rack";
  return (
    <Modal
      title={room ? `Editar ${label} · ${room.code}` : `Novo CPD ou rack${site ? ` · ${site.code}` : ""}`}
      onClose={onClose}
      footer={
        <>
          {room && onDeleted && (
            <button type="button" className="btn danger" onClick={remove}>
              Excluir
            </button>
          )}
          {error && <span className="form-error">{error}</span>}
          <button type="button" className="btn ghost" onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" form="room-form" className="btn primary">
            Salvar
          </button>
        </>
      }
    >
      <form id="room-form" className="form-grid" onSubmit={submit}>
        <fieldset>
          <legend>Identificação</legend>
          {!room && (
            <label>
              Site
              <select value={draft.site_id} onChange={set("site_id")} required>
                <option value="">Selecione…</option>
                {sites.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.code} · {s.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label>
            Tipo
            <select value={draft.kind} onChange={(e) => setKind(e.target.value as RoomKind)}>
              <option value="cpd">CPD</option>
              <option value="rack">Rack</option>
            </select>
          </label>
          <label>
            Código
            <input value={draft.code} onChange={set("code")} required maxLength={64} placeholder={draft.kind === "cpd" ? "CPD" : "RK-ADM"} />
          </label>
          <label>
            Nome
            <input value={draft.name} onChange={set("name")} maxLength={200} placeholder={draft.kind === "cpd" ? "CPD" : "Rack Administrativo"} />
          </label>
          <label>
            Prédio / local
            <input value={draft.building} onChange={set("building")} maxLength={200} placeholder="ADM / Administrative" />
          </label>
          <label>
            Switch (Topologia)
            <select value={draft.node_id} onChange={set("node_id")} disabled={!switches.length}>
              <option value="">{switches.length ? "Nenhum" : "Site sem topologia"}</option>
              {switches.map((n) => (
                <option key={n.id} value={n.id}>
                  {nodeLabel(n)}
                  {n.location ? ` · ${n.location}` : ""}
                </option>
              ))}
            </select>
          </label>
        </fieldset>

        <fieldset>
          <legend>Instalações</legend>
          <label>
            Climatização
            <input value={draft.cooling} onChange={set("cooling")} placeholder="Ventilação forçada" />
          </label>
          <label>
            Acesso
            <input value={draft.access} onChange={set("access")} placeholder="Chave" />
          </label>
          <label>
            Câmeras
            <input type="number" min={0} max={64} value={draft.cameras} onChange={set("cameras")} />
          </label>
          <label>
            Capacidade elétrica (kW)
            <input value={draft.power_capacity_kw} onChange={set("power_capacity_kw")} inputMode="decimal" placeholder={draft.kind === "cpd" ? "16" : "1,5"} />
          </label>
          <label>
            Latitude
            <input value={draft.latitude} onChange={set("latitude")} inputMode="decimal" pattern="-?[0-9]+([.,][0-9]+)?" placeholder="Pelo desenho" />
          </label>
          <label>
            Longitude
            <input value={draft.longitude} onChange={set("longitude")} inputMode="decimal" pattern="-?[0-9]+([.,][0-9]+)?" placeholder="Pelo desenho" />
          </label>
          <p className="hint">Sem coordenadas, o mapa posiciona pelo desenho da Topologia (ou ao redor do site).</p>
        </fieldset>

        <fieldset className="wide">
          <legend>Racks</legend>
          <p className="hint">
            {draft.kind === "cpd"
              ? "Racks de 42U em diante; o primeiro recebe os equipamentos de rede do switch."
              : "Rack de acesso: 12U ou 16U."}
          </p>
          {draft.racks.map((rack, i) => (
            <div key={i} className="row-edit" style={{ gridTemplateColumns: "1fr 90px 28px" }}>
              <input value={rack.name} onChange={(e) => setRack(i, { name: e.target.value })} placeholder={i === 0 ? draft.code || "Nome" : `RK-0${i + 1}`} aria-label="Nome do rack" />
              <select value={rack.heightU} onChange={(e) => setRack(i, { heightU: e.target.value })} aria-label="Altura">
                {[...new Set([...heights, rack.heightU])].map((u) => (
                  <option key={u} value={u}>
                    {u}U
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="icon-btn"
                aria-label="Remover rack"
                disabled={draft.racks.length === 1}
                onClick={() => setDraft({ ...draft, racks: draft.racks.filter((_, j) => j !== i) })}
              >
                ×
              </button>
            </div>
          ))}
          {draft.kind === "cpd" && (
            <button
              type="button"
              className="btn ghost small"
              onClick={() => setDraft({ ...draft, racks: [...draft.racks, { name: `RK-0${draft.racks.length + 1}`, heightU: "42" }] })}
            >
              + Adicionar rack
            </button>
          )}
        </fieldset>

        <fieldset className="wide">
          <legend>Observações</legend>
          <textarea rows={2} value={draft.notes} onChange={set("notes")} />
        </fieldset>
      </form>
    </Modal>
  );
}
