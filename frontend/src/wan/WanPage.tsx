import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { type InternetLink, ROLE_LABEL, api } from "../api";
import { useResource } from "../components/useResource";
import { EditActions } from "../components/EditActions";
import { PlantTabs } from "../components/PlantTabs";
import { LinkForm } from "./LinkForm";
import { HA_LABEL, type LinkHealth, type LogEntry, useWanSimulation } from "./simulation";
import { Sparkline } from "./Sparkline";
import { HEALTH_COLOR, Topology } from "./Topology";

const HEALTH_LABEL: Record<LinkHealth, string> = {
  up: "Operacional",
  degraded: "Degradado",
  down: "Fora",
  standby: "Standby",
};

const timeFormat = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
const mbps = (value: number) => `${value.toFixed(0)} Mbps`;

function StatusDot({ health }: { health: LinkHealth }) {
  return <span className={`dot ${health}`} style={{ background: HEALTH_COLOR[health] }} aria-hidden />;
}

function Detail({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="detail">
      <span className="detail-label">{label}</span>
      <span className={`detail-value${mono ? " mono" : ""}`}>{value ?? "—"}</span>
    </div>
  );
}

function LogTerminal({ entries }: { entries: LogEntry[] }) {
  return (
    <section className="panel terminal">
      <div className="panel-title">
        Log de eventos <span className="badge sim">Simulado</span>
      </div>
      <div className="terminal-body" aria-live="polite">
        {entries.length === 0 && <div className="log-line muted">Aguardando eventos…</div>}
        {entries.map((entry) => (
          <div key={entry.id} className={`log-line ${entry.level}`}>
            <span className="log-time">{timeFormat.format(entry.time)}</span>
            <span className="log-tag">[{entry.tag}]</span>
            <span className="log-msg">{entry.message}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

export function WanPage() {
  const [params, setParams] = useSearchParams();
  const sites = useResource(useCallback(() => api.sites.list(), []));
  const links = useResource(useCallback(() => api.links.list(), []));
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [editing, setEditing] = useState<InternetLink | "new" | null>(null);

  const siteId = Number(params.get("site")) || sites.items[0]?.id || null;
  const site = sites.items.find((s) => s.id === siteId) ?? null;
  const siteLinks = useMemo(
    () =>
      links.items
        .filter((l) => l.site_id === siteId && l.status !== "decommissioned")
        .sort((a, b) => ["primary", "secondary", "backup"].indexOf(a.role) - ["primary", "secondary", "backup"].indexOf(b.role)),
    [links.items, siteId],
  );
  const { telemetry, ha, log } = useWanSimulation(siteLinks);
  const selected = siteLinks.find((l) => l.id === selectedId) ?? null;

  const siteRef = useRef(siteId);
  useEffect(() => {
    if (siteRef.current !== siteId) setSelectedId(null);
    siteRef.current = siteId;
  }, [siteId]);

  const health = (link: InternetLink) => telemetry.get(link.id)?.health ?? "standby";
  const active = siteLinks.filter((l) => l.role !== "backup");
  const availability = active.length
    ? (active.flatMap((l) => telemetry.get(l.id)?.availability ?? []).reduce((a, b) => a + b, 0) /
        Math.max(1, active.flatMap((l) => telemetry.get(l.id)?.availability ?? []).length)) *
      100
    : 0;
  const incidents =
    siteLinks.filter((l) => ["down", "degraded"].includes(health(l))).length + (siteLinks.length && ha.state === "lost" ? 1 : 0);
  const capacity = siteLinks.reduce((sum, l) => sum + (l.bandwidth_mbps ?? 0), 0);
  const historyLength = Math.max(0, ...siteLinks.map((l) => telemetry.get(l.id)?.history.length ?? 0));
  const aggregate = Array.from({ length: historyLength }, (_, i) =>
    siteLinks.reduce((sum, l) => sum + (telemetry.get(l.id)?.history[i] ?? 0), 0),
  );
  const alerts = log.filter((e) => e.level !== "info").slice(0, 6);

  const remove = async (link: InternetLink) => {
    if (!confirm(`Excluir o link ${link.provider}${link.circuit_id ? ` (${link.circuit_id})` : ""}?`)) return;
    await api.links.remove(link.id);
    setSelectedId(null);
    links.reload();
  };

  return (
    <div className="wan">
      <div className="page-head">
        <div>
          <div className="eyebrow">Internet</div>
          <h1>Links de internet</h1>
        </div>
        <PlantTabs
          plants={sites.items.map((s) => ({ key: String(s.id), code: s.code, name: s.name }))}
          value={siteId === null ? null : String(siteId)}
          onChange={(id) => setParams({ site: id })}
        />
        <span className="badge sim" title="Status, tráfego e log são fictícios até a integração com LibreNMS e PRTG">
          Telemetria simulada
        </span>
        <EditActions
          addLabel={site ? `Novo link em ${site.code}` : "Novo link"}
          onAdd={sites.items.length ? () => setEditing("new") : undefined}
          editLabel={selected ? `Editar o link ${selected.provider}` : "Selecione um link na topologia para editar"}
          onEdit={selected ? () => setEditing(selected) : undefined}
        />
      </div>

      {(sites.error || links.error) && <div className="banner error">Erro ao carregar dados: {sites.error ?? links.error}</div>}

      <div className="wan-grid">
        <aside className="col">
          <section className="panel kpis">
            <div>
              <span className="kpi-label">Disponibilidade 24h</span>
              <span className="kpi-value ok">{active.length ? `${availability.toFixed(1)}%` : "—"}</span>
            </div>
            <div>
              <span className="kpi-label">Incidentes</span>
              <span className={`kpi-value ${incidents ? "crit" : ""}`}>{String(incidents).padStart(2, "0")}</span>
            </div>
            {siteLinks.length > 0 && (
              <div className={`kpi-ha ha-${ha.state}`} title="Par VMware VeloCloud Edge 620 em alta disponibilidade (simulado)">
                <span className="kpi-label">SD-WAN Edge · HA</span>
                <span className="kpi-ha-value">
                  <i />
                  {HA_LABEL[ha.state]} · #{ha.active} ativo
                </span>
              </div>
            )}
          </section>

          <section className="panel grow">
            <div className="panel-title">
              Links WAN <span className="muted">{siteLinks.length} links</span>
            </div>
            <ul className="link-list">
              {siteLinks.map((link) => {
                const t = telemetry.get(link.id);
                const h = health(link);
                const pct = t && link.bandwidth_mbps ? Math.round((t.usageMbps / link.bandwidth_mbps) * 100) : null;
                return (
                  <li key={link.id}>
                    <button className={`link-item${selectedId === link.id ? " selected" : ""}`} onClick={() => setSelectedId(link.id)}>
                      <span className="link-main">
                        <span className="link-name">{link.provider}</span>
                        <span className="link-pct">{pct === null ? "" : `${pct}%`}</span>
                        <StatusDot health={h} />
                      </span>
                      <span className="link-sub">
                        <span className={`tag role-${link.role}`}>{ROLE_LABEL[link.role]}</span>
                        <span className="muted mono">{link.sdwan_port ?? "—"}</span>
                        <span className="muted">{HEALTH_LABEL[h]}</span>
                      </span>
                      <span className="usage-bar">
                        <span style={{ width: `${Math.min(100, pct ?? 0)}%`, background: HEALTH_COLOR[h] }} />
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
            {!siteLinks.length && !links.loading && <p className="muted empty">Nenhum link cadastrado para este site.</p>}
            <button className="btn primary block" onClick={() => setEditing("new")} disabled={!sites.items.length}>
              + Novo link
            </button>
            {!sites.items.length && !sites.loading && <p className="muted empty">Cadastre um site primeiro, na aba Sites.</p>}
          </section>
          <section className="panel">
            <div className="panel-title">
              Tráfego agregado <span className="muted">de {mbps(capacity)}</span>
            </div>
            <Sparkline values={aggregate} max={capacity} format={mbps} label="Tráfego agregado do site" />
          </section>

          <section className="panel">
            <div className="panel-title">Latência por link</div>
            <ul className="bars">
              {siteLinks.map((link) => {
                const t = telemetry.get(link.id);
                const h = health(link);
                const value = t && h !== "down" && h !== "standby" ? t.latencyMs : null;
                return (
                  <li key={link.id} title={`${link.provider}: ${value === null ? HEALTH_LABEL[h] : `${value.toFixed(0)} ms`}`}>
                    <span className="bar-label">{link.provider}</span>
                    <span className="bar-track">
                      <span style={{ width: `${Math.min(100, ((value ?? 0) / 150) * 100)}%`, background: HEALTH_COLOR[h] }} />
                    </span>
                    <span className="bar-value mono">{value === null ? HEALTH_LABEL[h] : `${value.toFixed(0)} ms`}</span>
                  </li>
                );
              })}
            </ul>
          </section>

          <section className="panel">
            <div className="panel-title">Disponibilidade 24h</div>
            <div className="heatmap">
              {siteLinks.map((link) => (
                <div key={link.id} className="heat-row">
                  <span className="heat-label">{link.provider}</span>
                  <span className="heat-cells">
                    {(telemetry.get(link.id)?.availability ?? []).map((v, i) => (
                      <span
                        key={i}
                        className={`heat-cell ${v === 1 ? "ok" : v === 0 ? "crit" : "warn"}`}
                        title={`${link.provider} · ${23 - i === 0 ? "hora atual" : `${23 - i}h atrás`}: ${v === 1 ? "ok" : v === 0 ? "fora" : "degradado"}`}
                      />
                    ))}
                  </span>
                </div>
              ))}
            </div>
            <div className="heat-legend muted">
              <span className="heat-cell ok" /> ok <span className="heat-cell warn" /> degradado <span className="heat-cell crit" /> fora
            </div>
          </section>
        </aside>

        <main className="col center">
          <section className="panel topo-panel">
            <div className="panel-title">
              Topologia {site ? `· ${site.name}` : ""}
              <span className="legend">
                {(["up", "degraded", "down", "standby"] as LinkHealth[]).map((h) => (
                  <span key={h}>
                    <StatusDot health={h} /> {HEALTH_LABEL[h]}
                  </span>
                ))}
              </span>
            </div>
            {siteLinks.length ? (
              <Topology links={siteLinks} telemetry={telemetry} ha={ha} selectedId={selectedId} onSelect={setSelectedId} />
            ) : (
              <div className="topo-empty muted">Cadastre links para ver a topologia.</div>
            )}
          </section>

          {selected && (
            <section className="panel details">
              <div className="panel-title">
                {selected.provider}
                <span className="actions">
                  <button className="btn ghost small" onClick={() => setEditing(selected)}>
                    Editar
                  </button>
                  <button className="btn danger small" onClick={() => remove(selected)}>
                    Excluir
                  </button>
                </span>
              </div>
              <div className="details-grid">
                <Detail label="Circuito" value={selected.circuit_id} mono />
                <Detail label="Tecnologia" value={selected.technology} />
                <Detail label="Banda contratada" value={selected.bandwidth_mbps ? mbps(selected.bandwidth_mbps) : null} />
                <Detail label="Papel" value={ROLE_LABEL[selected.role]} />
                <Detail label="IP fixo" value={selected.public_ip ?? "Dinâmico"} mono />
                <Detail label="Máscara" value={selected.netmask} mono />
                <Detail label="Gateway" value={selected.gateway_ip} mono />
                <Detail label="Mascaramento (NAT)" value={selected.nat_enabled ? "Ativo" : "Desativado"} />
                <Detail label="SD-WAN" value={selected.sdwan_device} mono />
                <Detail label="Porta SD-WAN" value={selected.sdwan_port} mono />
                <Detail
                  label="Latência / perda"
                  value={(() => {
                    const t = telemetry.get(selected.id);
                    return t && t.health !== "down" && t.health !== "standby" ? `${t.latencyMs.toFixed(0)} ms / ${t.lossPct.toFixed(1)}%` : "—";
                  })()}
                />
                <Detail label="Status" value={HEALTH_LABEL[health(selected)]} />
              </div>
              <div className="vlan-table">
                <span className="detail-label">VLANs internas</span>
                {selected.vlans.length ? (
                  <table>
                    <thead>
                      <tr>
                        <th>ID</th>
                        <th>Nome</th>
                        <th>Sub-rede</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selected.vlans.map((v) => (
                        <tr key={v.vlan_id}>
                          <td className="mono">{v.vlan_id}</td>
                          <td>{v.name ?? "—"}</td>
                          <td className="mono">{v.subnet ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <span className="muted">Nenhuma VLAN associada.</span>
                )}
              </div>
            </section>
          )}

        </main>

        <aside className="col wan-side">
          <LogTerminal entries={log} />
          <section className="panel">
            <div className="panel-title">Alertas recentes</div>
            {alerts.length ? (
              <ul className="alerts">
                {alerts.map((a) => (
                  <li key={a.id} className={a.level}>
                    <span className="alert-icon" aria-hidden>
                      {a.level === "error" ? "✕" : "!"}
                    </span>
                    <span>
                      <span className="alert-msg">{a.message}</span>
                      <span className="muted mono">{timeFormat.format(a.time)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted empty">Nenhum alerta nesta sessão.</p>
            )}
          </section>

        </aside>
      </div>

      {editing && (
        <LinkForm
          sites={sites.items}
          siteId={siteId}
          link={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={(saved) => {
            setEditing(null);
            links.reload();
            if (saved.site_id !== siteId) setParams({ site: String(saved.site_id) });
            setSelectedId(saved.id);
          }}
        />
      )}
    </div>
  );
}
