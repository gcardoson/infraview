import { useEffect, useMemo, useState } from "react";
import {
  COLOR_LABEL,
  MAX_UPLINKS,
  type NetworkSwitch,
  PORTS_PER_BLOCK,
  type PortColor,
  type SwitchPort,
  portColor,
  portProblem,
  speedLabel,
  switchHealth,
  useLanSimulation,
} from "../lan/data";
import { PortTooltip, usePortTooltip } from "../lan/PortTooltip";
import type { SiteTopology } from "./data";
import { type NodeHealth, STATUS_LABEL } from "./status";
import { buildTopologySwitches } from "./switches";

/*
 * The switches of the plant, port by port (formerly the L3 · Switches screen), under the drawing.
 * Clicking switches or a link in the drawing narrows it to those switches.
 */

const timeFormat = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
const COLORS: PortColor[] = ["ok", "warn", "crit", "off"];
/* Faceplate layout: blocks of 24 ports as 12 columns, odd ports on top and even below (01/02, 03/04 … 23/24).
   A 48-port switch shows two blocks side by side; uplinks follow in their own pair of columns. */
const BLOCK_COLUMNS = PORTS_PER_BLOCK / 2;
const BLOCKS = [0, 1];
const BLOCK_CELLS = Array.from({ length: BLOCK_COLUMNS }, (_, i) => i);
const UPLINK_CELLS = Array.from({ length: Math.ceil(MAX_UPLINKS / 2) }, (_, i) => i);
const pad = (n: number) => String(n).padStart(2, "0");

/* 1-based access port number shown at a given block, column and row (0 = top/odd, 1 = bottom/even). */
const accessNumber = (block: number, column: number, row: number) => block * PORTS_PER_BLOCK + column * 2 + row + 1;

interface PortPick {
  switchId: string;
  port: number | null;
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

const nameOf = (sw: NetworkSwitch) => `${sw.hostname}${sw.member ? ` #${sw.member}` : ""}`;

interface Props {
  topology: SiteTopology;
  health: Record<string, NodeHealth>;
  /* Topology node ids picked in the drawing; empty shows every switch of the plant. */
  focus: string[];
  onClearFocus: () => void;
  onRemoveFocus: (nodeId: string) => void;
  onPickNode: (nodeId: string) => void;
}

export function SwitchView({ topology, health, focus, onClearFocus, onRemoveFocus, onPickNode }: Props) {
  const network = useMemo(() => buildTopologySwitches(topology), [topology]);
  const { switches, log } = useLanSimulation(network);
  const [onlyProblems, setOnlyProblems] = useState(false);
  const [pick, setPick] = useState<PortPick | null>(null);
  const tooltip = usePortTooltip();

  useEffect(() => setPick(null), [topology]);

  const focused = focus.length ? switches.filter((sw) => focus.includes(sw.nodeId)) : switches;
  const shown = onlyProblems ? focused.filter((sw) => sw.ports.some((p) => ["warn", "crit"].includes(portColor(p)))) : focused;
  const total = counts(focused);
  const enabled = total.ok + total.warn + total.crit;
  const selectedSwitch = switches.find((sw) => sw.id === pick?.switchId) ?? null;
  const selectedPort = selectedSwitch?.ports.find((p) => p.index === pick?.port) ?? null;
  const hosts = new Set(focused.map((sw) => sw.hostname));
  const alerts = log
    .filter((e) => e.level !== "info" && (!focus.length || [...hosts].some((h) => e.message.startsWith(h))))
    .slice(0, 8);
  const focusNodes = focus.map((id) => topology.nodes.find((n) => n.id === id)).filter((n) => !!n);

  return (
    <section className="topo-switches" aria-label="Switches">
      <div className="topo-switches-head">
        <div className="room-section-title">
          Switches
          <span className="muted">
            {focus.length
              ? `${focusNodes.length} de ${new Set(switches.map((s) => s.nodeId)).size} selecionado(s) no desenho`
              : "todos da planta · clique em switches ou num enlace do desenho para filtrar; Ctrl+clique soma"}
          </span>
        </div>
        {focus.length > 0 && (
          <div className="topo-chips">
            {focusNodes.map((n) => (
              <span key={n.id} className="topo-chip">
                <span className={`topo-dot ${health[n.id]?.status ?? "online"}`} />
                <button className="mono" onClick={() => onPickNode(n.id)}>
                  {n.hostname}
                </button>
                <button className="topo-chip-x" onClick={() => onRemoveFocus(n.id)} aria-label={`Remover ${n.hostname}`}>
                  ×
                </button>
              </span>
            ))}
            <button className="btn small" onClick={onClearFocus}>
              Mostrar todos
            </button>
          </div>
        )}
        <div className="topo-switch-kpis mono">
          <span className="ok">{total.ok}</span>
          <span className="muted">/ {enabled} conectadas</span>
          <span className={total.warn ? "warn" : "muted"}>{total.warn} alerta</span>
          <span className={total.crit ? "crit" : "muted"}>{total.crit} falha</span>
          <span className="muted">{total.off} desab.</span>
        </div>
      </div>

      <div className="lan-grid">
        <section className="panel port-panel">
          <div className="panel-title">
            <span className="port-legend">
              {COLORS.map((c) => (
                <span key={c}>
                  <span className={`port-sq ${c}`} aria-hidden /> {COLOR_LABEL[c]}
                </span>
              ))}
              <span>
                <span className="port-sq ok documented" aria-hidden /> Enlace do desenho
              </span>
            </span>
            <label className="toggle">
              <input type="checkbox" checked={onlyProblems} onChange={(e) => setOnlyProblems(e.target.checked)} />
              Somente com problemas
            </label>
          </div>

          <div className="port-scroll" {...tooltip.handlers}>
            <table className="port-table">
              <thead>
                <tr>
                  <th className="col-name">Switch</th>
                  <th className="col-health">Saúde</th>
                  {BLOCKS.map((b) => [
                    <th key={`gap-${b}`} className={`col-gap${b ? " wide" : ""}`} />,
                    <th key={`block-${b}`} className="col-block" colSpan={BLOCK_COLUMNS}>
                      Portas {pad(b * PORTS_PER_BLOCK + 1)}–{pad((b + 1) * PORTS_PER_BLOCK)}
                    </th>,
                  ])}
                  <th className="col-gap" />
                  <th className="col-block" colSpan={UPLINK_CELLS.length}>
                    Uplinks
                  </th>
                </tr>
              </thead>
              <tbody>
                {shown.flatMap((sw) => {
                  const h = switchHealth(sw);
                  const status = health[sw.nodeId]?.status ?? "online";
                  const access = sw.ports.filter((p) => !p.uplink);
                  const uplinks = sw.ports.filter((p) => p.uplink);
                  const selectedRow = pick?.switchId === sw.id ? " selected" : "";
                  const square = (port: SwitchPort | undefined, key: string, label?: "left" | "right") => {
                    if (!port) return <td key={key} className="col-port" />;
                    const color = portColor(port);
                    const selected = pick?.switchId === sw.id && pick.port === port.index;
                    return (
                      <td key={key} className="col-port">
                        {label && <span className={`port-num ${label}`}>{pad(port.index)}</span>}
                        <button
                          className={`port-sq ${color}${port.uplink ? " uplink" : ""}${port.documented ? " documented" : ""}${selected ? " selected" : ""}`}
                          data-switch={sw.id}
                          data-port={port.index}
                          aria-label={`${nameOf(sw)} porta ${port.name}: ${COLOR_LABEL[color]}`}
                          onClick={() => setPick({ switchId: sw.id, port: port.index })}
                        />
                      </td>
                    );
                  };
                  // Only the first and last column of each block this switch actually has get a label.
                  const lastColumn = (b: number) =>
                    Math.ceil(Math.min(PORTS_PER_BLOCK, Math.max(0, access.length - b * PORTS_PER_BLOCK)) / 2) - 1;
                  const labelFor = (b: number, c: number) => (c === 0 ? "left" : c === lastColumn(b) ? "right" : undefined);
                  return [0, 1].map((row) => (
                    <tr
                      key={`${sw.id}-${row}`}
                      className={`switch-row${selectedRow}${row === 0 ? " continues" : ""}${status === "offline" ? " offline" : ""}`}
                    >
                      {row === 0 && (
                        <>
                          <td className="col-name" rowSpan={2}>
                            <button className="switch-name" onClick={() => setPick({ switchId: sw.id, port: null })}>
                              <span className={`topo-dot ${status}`} title={STATUS_LABEL[status]} />
                              <span className="mono">{nameOf(sw)}</span>
                              <span className="tag">{sw.role}</span>
                            </button>
                            <span className="switch-model muted">
                              {sw.model} · {topology.nodes.find((n) => n.id === sw.nodeId)?.location ?? ""}
                            </span>
                          </td>
                          <td className={`col-health mono ${healthClass(h)}`} rowSpan={2}>
                            {h.toFixed(1)}%
                          </td>
                        </>
                      )}
                      {BLOCKS.map((b) => [
                        <td key={`gap-${b}`} className={`col-gap${b ? " wide" : ""}`} />,
                        ...BLOCK_CELLS.map((c) => square(access[accessNumber(b, c, row) - 1], `${b}-${c}`, labelFor(b, c))),
                      ])}
                      <td className="col-gap" />
                      {UPLINK_CELLS.map((c) => square(uplinks[c * 2 + row], `u-${c}`))}
                    </tr>
                  ));
                })}
              </tbody>
            </table>
            {!shown.length && (
              <p className="muted empty">{onlyProblems ? "Nenhum switch com problemas." : "Nenhum switch na seleção."}</p>
            )}
          </div>
          <p className="port-hint muted">
            As portas seguem o painel do switch: ímpares em cima, pares embaixo; switches de 48 portas mostram dois blocos de 24,
            e os uplinks vêm à direita. Portas com contorno azul são os enlaces documentados no desenho; as demais são simuladas.
          </p>
        </section>

        <aside className="col">
          <section className="panel">
            {selectedSwitch ? (
              <>
                <div className="panel-title">
                  {nameOf(selectedSwitch)}
                  <button className="icon-btn" onClick={() => setPick(null)} aria-label="Fechar detalhes">
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
                          <span className={`port-sq ${portColor(selectedPort)}`} aria-hidden />{" "}
                          {COLOR_LABEL[portColor(selectedPort)]}
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
                  <Detail label="Status" value={STATUS_LABEL[health[selectedSwitch.nodeId]?.status ?? "online"]} />
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
                <div className="panel-title">Detalhes da porta</div>
                <p className="muted empty">Clique em uma porta ou no nome de um switch para ver os detalhes.</p>
              </>
            )}
          </section>

          <section className="panel">
            <div className="panel-title">
              Alertas recentes <span className="badge sim">Simulado</span>
            </div>
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
      <PortTooltip switches={switches} target={tooltip.target} visible={tooltip.visible} box={tooltip.box} />
    </section>
  );
}
