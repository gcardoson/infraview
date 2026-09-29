import { useCallback, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../api";
import { useResource } from "../components/useResource";
import {
  COLOR_LABEL,
  MAX_UPLINKS,
  type NetworkSwitch,
  PORTS_PER_ROW,
  type PortColor,
  type SwitchPort,
  buildNetwork,
  portColor,
  portProblem,
  speedLabel,
  switchHealth,
  useLanSimulation,
} from "./data";

const timeFormat = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
const COLORS: PortColor[] = ["ok", "warn", "crit", "off"];
const NO_SWITCHES: NetworkSwitch[] = [];
const COLUMNS = Array.from({ length: PORTS_PER_ROW }, (_, i) => i + 1);
const UPLINK_COLUMNS = Array.from({ length: MAX_UPLINKS }, (_, i) => i + 1);
const TOTAL_COLUMNS = 3 + PORTS_PER_ROW + 1 + MAX_UPLINKS;

/* Access ports in blocks of 24 (a 48-port switch gets two rows); uplinks sit in their own columns on the first row. */
function portRows(sw: NetworkSwitch) {
  const access = sw.ports.filter((p) => !p.uplink);
  const rows: SwitchPort[][] = [];
  for (let i = 0; i < access.length; i += PORTS_PER_ROW) rows.push(access.slice(i, i + PORTS_PER_ROW));
  return { rows: rows.length ? rows : [[]], uplinks: sw.ports.filter((p) => p.uplink) };
}

interface Selection {
  switchId: string;
  port: number | null;
}

function portTitle(sw: NetworkSwitch, port: SwitchPort) {
  return [
    `${sw.hostname} · porta ${port.name}${port.uplink ? " (uplink)" : ""}`,
    COLOR_LABEL[portColor(port)],
    port.description ?? "Sem descrição",
    port.link === "up" ? `${speedLabel(port.speedMbps)} · ${port.utilization}% de uso` : null,
    port.vlan ? `VLAN ${port.vlan}` : null,
    portProblem(port),
  ]
    .filter(Boolean)
    .join("\n");
}

function counts(switches: NetworkSwitch[]) {
  const result: Record<PortColor, number> = { ok: 0, warn: 0, crit: 0, off: 0 };
  for (const sw of switches) for (const p of sw.ports) result[portColor(p)]++;
  return result;
}

function healthClass(value: number) {
  return value >= 95 ? "ok" : value >= 80 ? "warn" : "crit";
}

function Detail({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="detail">
      <span className="detail-label">{label}</span>
      <span className={`detail-value${mono ? " mono" : ""}`}>{value ?? "—"}</span>
    </div>
  );
}

export function LanPage() {
  const [params, setParams] = useSearchParams();
  const sites = useResource(useCallback(() => api.sites.list(), []));
  const network = useMemo(() => buildNetwork(sites.items), [sites.items]);
  const { switches, log } = useLanSimulation(sites.loading ? NO_SWITCHES : network);
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());
  const [onlyProblems, setOnlyProblems] = useState(false);
  const [selection, setSelection] = useState<Selection | null>(null);

  const siteFilter = Number(params.get("site")) || null;
  const visible = switches.filter((sw) => siteFilter === null || sw.siteId === siteFilter);
  const shown = onlyProblems ? visible.filter((sw) => sw.ports.some((p) => ["warn", "crit"].includes(portColor(p)))) : visible;
  const groups = useMemo(() => {
    const map = new Map<number, NetworkSwitch[]>();
    for (const sw of shown) map.set(sw.siteId, [...(map.get(sw.siteId) ?? []), sw]);
    return [...map.values()];
  }, [shown]);

  const total = counts(visible);
  const enabled = total.ok + total.warn + total.crit;
  const health = visible.length ? visible.reduce((s, sw) => s + switchHealth(sw), 0) / visible.length : 0;
  const selectedSwitch = switches.find((sw) => sw.id === selection?.switchId) ?? null;
  const selectedPort = selectedSwitch?.ports.find((p) => p.index === selection?.port) ?? null;
  const alerts = log.filter((e) => e.level !== "info").slice(0, 8);

  const toggle = (siteId: number) =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(siteId)) next.delete(siteId);
      else next.add(siteId);
      return next;
    });

  return (
    <div className="page lan">
      <div className="page-head">
        <div>
          <div className="eyebrow">Layer 3</div>
          <h1>Switches e rede local</h1>
        </div>
        <label className="site-picker">
          <span>Site</span>
          <select value={siteFilter ?? ""} onChange={(e) => setParams(e.target.value ? { site: e.target.value } : {})}>
            <option value="">Todos os sites</option>
            {sites.items.map((s) => (
              <option key={s.id} value={s.id}>
                {s.code} · {s.name}
              </option>
            ))}
          </select>
        </label>
        <span className="badge sim" title="Switches, portas e eventos são fictícios até a integração com LibreNMS e PRTG">
          Dados fictícios
        </span>
      </div>

      {sites.error && <div className="banner error">Erro ao carregar sites: {sites.error}</div>}

      <section className="lan-kpis">
        <div className="panel kpi">
          <span className="kpi-label">Saúde das portas</span>
          <span className={`kpi-value ${healthClass(health)}`}>{visible.length ? `${health.toFixed(1)}%` : "—"}</span>
        </div>
        <div className="panel kpi">
          <span className="kpi-label">Switches</span>
          <span className="kpi-value">{String(visible.length).padStart(2, "0")}</span>
        </div>
        <div className="panel kpi">
          <span className="kpi-label">Portas conectadas</span>
          <span className="kpi-value ok">
            {total.ok}
            <small> / {enabled}</small>
          </span>
        </div>
        <div className="panel kpi">
          <span className="kpi-label">Em alerta</span>
          <span className={`kpi-value ${total.warn ? "warn" : ""}`}>{String(total.warn).padStart(2, "0")}</span>
        </div>
        <div className="panel kpi">
          <span className="kpi-label">Falhas</span>
          <span className={`kpi-value ${total.crit ? "crit" : ""}`}>{String(total.crit).padStart(2, "0")}</span>
        </div>
        <div className="panel kpi">
          <span className="kpi-label">Desabilitadas</span>
          <span className="kpi-value idle">{String(total.off).padStart(2, "0")}</span>
        </div>
      </section>

      <div className="lan-grid">
        <section className="panel port-panel">
          <div className="panel-title">
            <span className="port-legend">
              {COLORS.map((c) => (
                <span key={c}>
                  <span className={`port-sq ${c}`} aria-hidden /> {COLOR_LABEL[c]}
                </span>
              ))}
            </span>
            <label className="toggle">
              <input type="checkbox" checked={onlyProblems} onChange={(e) => setOnlyProblems(e.target.checked)} />
              Somente com problemas
            </label>
          </div>

          <div className="port-scroll">
            <table className="port-table">
              <thead>
                <tr>
                  <th className="col-name">Switch / ativo</th>
                  <th className="col-health">Saúde</th>
                  <th className="col-range">Portas</th>
                  {COLUMNS.map((n) => (
                    <th key={n} className="col-port">
                      {String(n).padStart(2, "0")}
                    </th>
                  ))}
                  <th className="col-gap" />
                  {UPLINK_COLUMNS.map((n) => (
                    <th key={n} className="col-port" title={`Uplink ${n}`}>
                      U{n}
                    </th>
                  ))}
                </tr>
              </thead>
              {groups.map((group) => {
                const first = group[0];
                const isCollapsed = collapsed.has(first.siteId);
                const c = counts(group);
                return (
                  <tbody key={first.siteId}>
                    <tr className="group-row">
                      <td colSpan={TOTAL_COLUMNS}>
                        <button className="group-toggle" onClick={() => toggle(first.siteId)} aria-expanded={!isCollapsed}>
                          <span className="chevron">{isCollapsed ? "▸" : "▾"}</span>
                          <span className="group-name">
                            {first.siteCode} · {first.siteName}
                          </span>
                          {c.crit > 0 && <span className="count-badge crit">{c.crit}</span>}
                          {c.warn > 0 && <span className="count-badge warn">{c.warn}</span>}
                          <span className="group-stats">
                            {group.length} switches · {c.ok} conectadas · {c.off} desabilitadas
                          </span>
                        </button>
                      </td>
                    </tr>
                    {!isCollapsed &&
                      group.flatMap((sw) => {
                        const h = switchHealth(sw);
                        const { rows, uplinks } = portRows(sw);
                        const selectedRow = selection?.switchId === sw.id ? " selected" : "";
                        const square = (port: SwitchPort | undefined, key: number) => {
                          if (!port) return <td key={key} className="col-port" />;
                          const color = portColor(port);
                          const selected = selection?.switchId === sw.id && selection.port === port.index;
                          return (
                            <td key={key} className="col-port">
                              <button
                                className={`port-sq ${color}${port.uplink ? " uplink" : ""}${selected ? " selected" : ""}`}
                                title={portTitle(sw, port)}
                                aria-label={`${sw.hostname} porta ${port.name}: ${COLOR_LABEL[color]}`}
                                onClick={() => setSelection({ switchId: sw.id, port: port.index })}
                              />
                            </td>
                          );
                        };
                        return rows.map((row, r) => {
                          const first = row[0]?.index ?? 1;
                          const last = r * PORTS_PER_ROW + Math.max(row.length, 1);
                          return (
                            <tr
                              key={`${sw.id}-${r}`}
                              className={`switch-row${selectedRow}${r < rows.length - 1 ? " continues" : ""}`}
                            >
                              {r === 0 && (
                                <>
                                  <td className="col-name" rowSpan={rows.length}>
                                    <button className="switch-name" onClick={() => setSelection({ switchId: sw.id, port: null })}>
                                      <span className="mono">{sw.hostname}</span>
                                      <span className="tag">{sw.role}</span>
                                    </button>
                                    <span className="switch-model muted">
                                      {sw.model} · {sw.ports.filter((p) => !p.uplink).length} portas
                                    </span>
                                  </td>
                                  <td className={`col-health mono ${healthClass(h)}`} rowSpan={rows.length}>
                                    {h.toFixed(1)}%
                                  </td>
                                </>
                              )}
                              <td className="col-range mono muted">
                                {String(first).padStart(2, "0")}–{String(last).padStart(2, "0")}
                              </td>
                              {COLUMNS.map((n) => square(row[n - 1], n))}
                              <td className="col-gap" />
                              {UPLINK_COLUMNS.map((n) => square(r === 0 ? uplinks[n - 1] : undefined, 100 + n))}
                            </tr>
                          );
                        });
                      })}
                  </tbody>
                );
              })}
            </table>
            {!groups.length && !sites.loading && (
              <p className="muted empty">{onlyProblems ? "Nenhum switch com problemas." : "Nenhum switch encontrado."}</p>
            )}
          </div>
          <p className="port-hint muted">
            Cada linha tem 24 portas; switches de 48 portas ocupam duas linhas. As colunas U1–U4 são os uplinks. Passe o mouse sobre uma porta para ver os detalhes, clique para fixá-la no painel.
          </p>
        </section>

        <aside className="col">
          <section className="panel">
            {selectedSwitch ? (
              <>
                <div className="panel-title">
                  {selectedSwitch.hostname}
                  <button className="icon-btn" onClick={() => setSelection(null)} aria-label="Fechar detalhes">
                    ×
                  </button>
                </div>
                {selectedPort ? (
                  <div className="details-grid one">
                    <Detail label="Porta" value={`${selectedPort.name}${selectedPort.uplink ? " · uplink" : ""}`} mono />
                    <Detail
                      label="Estado"
                      value={
                        <span className="state">
                          <span className={`port-sq ${portColor(selectedPort)}`} aria-hidden /> {COLOR_LABEL[portColor(selectedPort)]}
                        </span>
                      }
                    />
                    <Detail label="Diagnóstico" value={portProblem(selectedPort) ?? "Sem problemas"} />
                    <Detail label="Descrição" value={selectedPort.description} mono />
                    <Detail label="Velocidade" value={speedLabel(selectedPort.speedMbps)} />
                    <Detail label="Utilização" value={selectedPort.link === "up" ? `${selectedPort.utilization}%` : null} />
                    <Detail label="VLAN" value={selectedPort.vlan ?? (selectedPort.uplink ? "Trunk" : null)} mono />
                    <Detail label="PoE" value={selectedPort.poeWatts ? `${selectedPort.poeWatts.toFixed(1)} W` : null} />
                    <Detail label="Erros CRC" value={selectedPort.errors} mono />
                  </div>
                ) : null}
                <div className={`details-grid one${selectedPort ? " secondary" : ""}`}>
                  <Detail label="Site" value={`${selectedSwitch.siteCode} · ${selectedSwitch.siteName}`} />
                  <Detail label="Modelo" value={`${selectedSwitch.model} · ${selectedSwitch.role}`} />
                  <Detail label="IP de gerência" value={selectedSwitch.managementIp} mono />
                  <Detail label="Firmware" value={selectedSwitch.firmware} mono />
                  <Detail label="Uptime" value={`${selectedSwitch.uptimeDays} dias`} />
                  <Detail
                    label="Portas"
                    value={(() => {
                      const c = counts([selectedSwitch]);
                      return `${c.ok} ok · ${c.warn} alerta · ${c.crit} falha · ${c.off} desab.`;
                    })()}
                  />
                </div>
              </>
            ) : (
              <>
                <div className="panel-title">Detalhes</div>
                <p className="muted empty">Clique em um switch ou em uma porta para ver os detalhes.</p>
              </>
            )}
          </section>

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
              <p className="muted empty">Aguardando eventos…</p>
            )}
          </section>
        </aside>
      </div>

      <section className="panel terminal lan-log">
        <div className="panel-title">
          Log de eventos <span className="badge sim">Simulado</span>
        </div>
        <div className="terminal-body" aria-live="polite">
          {log.length === 0 && <div className="log-line muted">Aguardando eventos…</div>}
          {log.map((entry) => (
            <div key={entry.id} className={`log-line ${entry.level}`}>
              <span className="log-time">{timeFormat.format(entry.time)}</span>
              <span className="log-tag">[{entry.tag}]</span>
              <span className="log-msg">{entry.message}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
