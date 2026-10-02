import { type FormEvent, useCallback, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { LIFECYCLE_LABEL, type LifecycleStatus, type Site, type SiteVlan, type VlanPayload, api } from "../api";
import { Modal } from "../components/Modal";
import { PlantTabs } from "../components/PlantTabs";
import { useResource } from "../components/useResource";

interface Draft {
  site_id: string;
  vlan_id: string;
  name: string;
  subnet: string;
  gateway_ip: string;
  dhcp: boolean;
  status: LifecycleStatus;
  notes: string;
}

function VlanForm({
  vlan,
  sites,
  siteId,
  onClose,
  onSaved,
}: {
  vlan: SiteVlan | null;
  sites: Site[];
  siteId: number | null;
  onClose: () => void;
  onSaved: (siteId: number) => void;
}) {
  const [draft, setDraft] = useState<Draft>(() => ({
    site_id: String(vlan?.site_id ?? siteId ?? ""),
    vlan_id: vlan ? String(vlan.vlan_id) : "",
    name: vlan?.name ?? "",
    subnet: vlan?.subnet ?? "",
    gateway_ip: vlan?.gateway_ip ?? "",
    dhcp: vlan?.dhcp ?? false,
    status: vlan?.status ?? "active",
    notes: vlan?.notes ?? "",
  }));
  const [error, setError] = useState<string | null>(null);
  const set = (key: keyof Draft) => (e: { target: { value: string } }) => setDraft({ ...draft, [key]: e.target.value });

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const payload: VlanPayload = {
      site_id: Number(draft.site_id),
      vlan_id: Number(draft.vlan_id),
      name: draft.name.trim(),
      subnet: draft.subnet.trim() || null,
      gateway_ip: draft.gateway_ip.trim() || null,
      dhcp: draft.dhcp,
      status: draft.status,
      notes: draft.notes.trim() || null,
    };
    try {
      if (vlan) await api.vlans.update(vlan.id, payload);
      else await api.vlans.create(payload);
      onSaved(payload.site_id);
    } catch (e) {
      const message = (e as Error).message;
      setError(/conflict/i.test(message) ? `A VLAN ${draft.vlan_id} já existe neste site.` : message);
    }
  };

  const site = sites.find((s) => s.id === vlan?.site_id);
  return (
    <Modal
      title={vlan ? `Editar VLAN ${vlan.vlan_id}${site ? ` · ${site.code}` : ""}` : "Nova VLAN"}
      onClose={onClose}
      footer={
        <>
          {error && <span className="form-error">{error}</span>}
          <button type="button" className="btn ghost" onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" form="vlan-form" className="btn primary">
            Salvar
          </button>
        </>
      }
    >
      <form id="vlan-form" className="form-grid" onSubmit={submit}>
        <fieldset>
          <legend>Identificação</legend>
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
          <label>
            VLAN ID
            <input
              type="number"
              min={1}
              max={4094}
              value={draft.vlan_id}
              onChange={set("vlan_id")}
              required
              placeholder="10"
            />
          </label>
          <label>
            Nome
            <input value={draft.name} onChange={set("name")} required maxLength={120} placeholder="Corporativa" />
          </label>
          <label>
            Status
            <select value={draft.status} onChange={set("status")}>
              {Object.entries(LIFECYCLE_LABEL).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </fieldset>

        <fieldset>
          <legend>Endereçamento</legend>
          <label>
            Sub-rede
            <input value={draft.subnet} onChange={set("subnet")} placeholder="10.20.10.0/24" />
          </label>
          <label>
            Gateway
            <input value={draft.gateway_ip} onChange={set("gateway_ip")} placeholder="10.20.10.1" />
          </label>
          <label className="check">
            <input type="checkbox" checked={draft.dhcp} onChange={(e) => setDraft({ ...draft, dhcp: e.target.checked })} />
            DHCP ativo nesta VLAN
          </label>
        </fieldset>

        <fieldset className="wide">
          <legend>Observações</legend>
          <textarea rows={2} value={draft.notes} onChange={set("notes")} />
        </fieldset>
      </form>
    </Modal>
  );
}

export function VlansPage() {
  const [params, setParams] = useSearchParams();
  const sites = useResource(useCallback(() => api.sites.list(), []));
  const vlans = useResource(useCallback(() => api.vlans.list(), []));
  const [editing, setEditing] = useState<SiteVlan | "new" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const siteId = Number(params.get("site")) || sites.items[0]?.id || null;
  const site = sites.items.find((s) => s.id === siteId) ?? null;
  const rows = useMemo(() => vlans.items.filter((v) => v.site_id === siteId), [vlans.items, siteId]);
  const count = (id: number) => vlans.items.filter((v) => v.site_id === id).length;

  const remove = async (vlan: SiteVlan) => {
    if (!confirm(`Excluir a VLAN ${vlan.vlan_id} (${vlan.name})?`)) return;
    try {
      await api.vlans.remove(vlan.id);
      vlans.reload();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="eyebrow">Cadastros</div>
          <h1>VLANs</h1>
        </div>
        <PlantTabs
          plants={sites.items.map((s) => ({ key: String(s.id), code: s.code, name: `${s.name} · ${count(s.id)} VLANs` }))}
          value={siteId === null ? null : String(siteId)}
          onChange={(id) => setParams({ site: id })}
        />
        <button className="btn primary" onClick={() => setEditing("new")} disabled={!sites.items.length}>
          + Nova VLAN
        </button>
      </div>
      {(error || sites.error || vlans.error) && <div className="banner error">{error ?? sites.error ?? vlans.error}</div>}
      <section className="panel">
        <div className="panel-title">
          <span>{site ? `${site.code} · ${site.name}` : "VLANs"}</span>
          <span className="muted">
            {rows.length} VLAN{rows.length === 1 ? "" : "s"}
          </span>
        </div>
        <table className="data-table">
          <thead>
            <tr>
              <th>VLAN</th>
              <th>Nome</th>
              <th>Sub-rede</th>
              <th>Gateway</th>
              <th>DHCP</th>
              <th>Status</th>
              <th>Observações</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((vlan) => (
              <tr key={vlan.id}>
                <td className="mono">{vlan.vlan_id}</td>
                <td>{vlan.name}</td>
                <td className="mono">{vlan.subnet ?? "—"}</td>
                <td className="mono">{vlan.gateway_ip ?? "—"}</td>
                <td>{vlan.dhcp ? "Sim" : "Não"}</td>
                <td>{LIFECYCLE_LABEL[vlan.status]}</td>
                <td className="muted">{vlan.notes ?? "—"}</td>
                <td className="row-actions">
                  <button className="btn ghost small" onClick={() => setEditing(vlan)}>
                    Editar
                  </button>
                  <button className="btn danger small" onClick={() => remove(vlan)}>
                    Excluir
                  </button>
                </td>
              </tr>
            ))}
            {!rows.length && !vlans.loading && (
              <tr>
                <td colSpan={8} className="muted empty">
                  Nenhuma VLAN cadastrada neste site.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
      {editing && (
        <VlanForm
          vlan={editing === "new" ? null : editing}
          sites={sites.items}
          siteId={siteId}
          onClose={() => setEditing(null)}
          onSaved={(savedSite) => {
            setEditing(null);
            setError(null);
            vlans.reload();
            if (savedSite !== siteId) setParams({ site: String(savedSite) });
          }}
        />
      )}
    </div>
  );
}
