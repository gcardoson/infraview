import { type FormEvent, useState } from "react";
import { type InternetLink, type LinkPayload, type Site, type Vlan, ROLE_LABEL, api } from "../api";
import { Modal } from "../components/Modal";

interface Props {
  sites: Site[];
  siteId: number | null;
  link: InternetLink | null;
  onClose: () => void;
  onSaved: (link: InternetLink) => void;
}

type Draft = Record<keyof Omit<LinkPayload, "vlans" | "nat_enabled">, string> & {
  nat_enabled: boolean;
  vlans: { vlan_id: string; name: string; subnet: string }[];
};

function toDraft(link: InternetLink | null, siteId: number | null): Draft {
  const text = (value: string | number | null | undefined) => (value == null ? "" : String(value));
  return {
    site_id: text(link?.site_id ?? siteId),
    provider: text(link?.provider),
    circuit_id: text(link?.circuit_id),
    technology: text(link?.technology),
    bandwidth_mbps: text(link?.bandwidth_mbps),
    role: link?.role ?? "primary",
    public_ip: text(link?.public_ip),
    netmask: text(link?.netmask),
    gateway_ip: text(link?.gateway_ip),
    nat_enabled: link?.nat_enabled ?? true,
    sdwan_device: text(link?.sdwan_device),
    sdwan_port: text(link?.sdwan_port),
    vlans: (link?.vlans ?? []).map((v) => ({ vlan_id: String(v.vlan_id), name: text(v.name), subnet: text(v.subnet) })),
    status: link?.status ?? "active",
    notes: text(link?.notes),
  };
}

function toPayload(draft: Draft): LinkPayload {
  const opt = (value: string) => (value.trim() === "" ? null : value.trim());
  const vlans: Vlan[] = draft.vlans
    .filter((v) => v.vlan_id.trim() !== "")
    .map((v) => ({ vlan_id: Number(v.vlan_id), name: opt(v.name), subnet: opt(v.subnet) }));
  return {
    site_id: Number(draft.site_id),
    provider: draft.provider.trim(),
    circuit_id: opt(draft.circuit_id),
    technology: opt(draft.technology),
    bandwidth_mbps: draft.bandwidth_mbps ? Number(draft.bandwidth_mbps) : null,
    role: draft.role as LinkPayload["role"],
    public_ip: opt(draft.public_ip),
    netmask: opt(draft.netmask),
    gateway_ip: opt(draft.gateway_ip),
    nat_enabled: draft.nat_enabled,
    sdwan_device: opt(draft.sdwan_device),
    sdwan_port: opt(draft.sdwan_port),
    vlans,
    status: draft.status as LinkPayload["status"],
    notes: opt(draft.notes),
  };
}

export function LinkForm({ sites, siteId, link, onClose, onSaved }: Props) {
  const [draft, setDraft] = useState(() => toDraft(link, siteId));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const set = (key: keyof Draft) => (e: { target: { value: string } }) => setDraft({ ...draft, [key]: e.target.value });
  const setVlan = (i: number, key: "vlan_id" | "name" | "subnet", value: string) =>
    setDraft({ ...draft, vlans: draft.vlans.map((v, j) => (j === i ? { ...v, [key]: value } : v)) });

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      const payload = toPayload(draft);
      const saved = link ? await api.links.update(link.id, payload) : await api.links.create(payload);
      onSaved(saved);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title={link ? `Editar link · ${link.provider}` : "Novo link WAN"}
      onClose={onClose}
      footer={
        <>
          {error && <span className="form-error">{error}</span>}
          <button type="button" className="btn ghost" onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" form="link-form" className="btn primary" disabled={saving}>
            {saving ? "Salvando…" : "Salvar"}
          </button>
        </>
      }
    >
      <form id="link-form" onSubmit={submit} className="form-grid">
        <fieldset>
          <legend>Contrato</legend>
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
            Operadora
            <input value={draft.provider} onChange={set("provider")} required />
          </label>
          <label>
            Circuito / designação
            <input value={draft.circuit_id} onChange={set("circuit_id")} />
          </label>
          <label>
            Tecnologia
            <input value={draft.technology} onChange={set("technology")} placeholder="Fibra, MPLS, 4G…" />
          </label>
          <label>
            Banda (Mbps)
            <input type="number" min={0} value={draft.bandwidth_mbps} onChange={set("bandwidth_mbps")} />
          </label>
          <label>
            Papel
            <select value={draft.role} onChange={set("role")}>
              {Object.entries(ROLE_LABEL).map(([value, label]) => (
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
            IP fixo / bloco
            <input value={draft.public_ip} onChange={set("public_ip")} placeholder="200.160.12.40/29" />
          </label>
          <label>
            Máscara
            <input value={draft.netmask} onChange={set("netmask")} placeholder="255.255.255.248" />
          </label>
          <label>
            Gateway
            <input value={draft.gateway_ip} onChange={set("gateway_ip")} placeholder="200.160.12.41" />
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={draft.nat_enabled}
              onChange={(e) => setDraft({ ...draft, nat_enabled: e.target.checked })}
            />
            Mascaramento (NAT de saída)
          </label>
        </fieldset>

        <fieldset>
          <legend>SD-WAN</legend>
          <label>
            Equipamento
            <input value={draft.sdwan_device} onChange={set("sdwan_device")} placeholder="FGT-ARC-01" />
          </label>
          <label>
            Porta
            <input value={draft.sdwan_port} onChange={set("sdwan_port")} placeholder="wan1" />
          </label>
        </fieldset>

        <fieldset className="wide">
          <legend>VLANs internas</legend>
          {draft.vlans.map((vlan, i) => (
            <div key={i} className="vlan-edit">
              <input type="number" min={1} max={4094} placeholder="ID" value={vlan.vlan_id} onChange={(e) => setVlan(i, "vlan_id", e.target.value)} />
              <input placeholder="Nome" value={vlan.name} onChange={(e) => setVlan(i, "name", e.target.value)} />
              <input placeholder="Sub-rede (10.0.10.0/24)" value={vlan.subnet} onChange={(e) => setVlan(i, "subnet", e.target.value)} />
              <button
                type="button"
                className="icon-btn"
                aria-label="Remover VLAN"
                onClick={() => setDraft({ ...draft, vlans: draft.vlans.filter((_, j) => j !== i) })}
              >
                ×
              </button>
            </div>
          ))}
          <button
            type="button"
            className="btn ghost small"
            onClick={() => setDraft({ ...draft, vlans: [...draft.vlans, { vlan_id: "", name: "", subnet: "" }] })}
          >
            + Adicionar VLAN
          </button>
        </fieldset>

        <fieldset className="wide">
          <legend>Observações</legend>
          <textarea rows={2} value={draft.notes} onChange={set("notes")} />
        </fieldset>
      </form>
    </Modal>
  );
}
