import { useLayoutEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { MEDIUM_LABEL, MEDIUM_SHORT, type SiteTopology, TOPOLOGIES, type TopoLink, type TopoNode, nodeLabel } from "./data";
import { Diagram, type Selection } from "./Diagram";
import { LINK_LABEL, type LinkState, type NodeHealth, STATUS_LABEL, hasDevice, linkState, useTopologyStatus } from "./status";

const ZOOMS = [1, 1.25, 1.5, 2];
const ago = (d: Date) => {
  const min = Math.max(1, Math.round((Date.now() - d.getTime()) / 60_000));
  return min < 60 ? `há ${min} min` : `há ${Math.floor(min / 60)} h ${min % 60} min`;
};

function endText(topology: SiteTopology, end: TopoLink["a"]) {
  const node = topology.nodes.find((n) => n.id === end.node);
  return { node, name: node ? nodeLabel(node) : end.node, port: end.port };
}

function EndCell({ topology, end }: { topology: SiteTopology; end: TopoLink["a"] }) {
  const { node, name, port } = endText(topology, end);
  return (
    <span className="topo-end">
      <span className="mono">{name}</span>
      {port && <span className="topo-end-port mono">{port}</span>}
      {node?.hostname && node.location && <span className="muted">{node.location}</span>}
    </span>
  );
}

function StatusPill({ status }: { status: NodeHealth["status"] | LinkState | "none" }) {
  const label = status === "none" ? "Sem ativo" : status in STATUS_LABEL ? STATUS_LABEL[status as NodeHealth["status"]] : LINK_LABEL[status as LinkState];
  return <span className={`topo-pill ${status}`}>{label}</span>;
}

/* Tooltip that follows the cursor, reusing the port tooltip look from the Switches screen. */
function useFollow() {
  const box = useRef<HTMLDivElement>(null);
  const pos = useRef({ x: 0, y: 0 });
  const place = () => {
    const el = box.current;
    if (!el) return;
    const { x, y } = pos.current;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const left = x + 16 + w > window.innerWidth - 8 ? x - 16 - w : x + 16;
    const top = y + 16 + h > window.innerHeight - 8 ? y - 16 - h : y + 16;
    el.style.transform = `translate3d(${Math.max(8, left)}px, ${Math.max(8, top)}px, 0)`;
  };
  return { box, pos, place };
}

export function TopologyPage() {
  const [params, setParams] = useSearchParams();
  const topology = TOPOLOGIES.find((t) => t.code === params.get("site")) ?? TOPOLOGIES[0];
  const health = useTopologyStatus(topology);
  const [selected, setSelected] = useState<Selection>(null);
  const [hovered, setHovered] = useState<Selection>(null);
  const [zoom, setZoom] = useState(0);
  const [onlyProblems, setOnlyProblems] = useState(false);
  const follow = useFollow();

  useLayoutEffect(follow.place);

  const switchSite = (code: string) => {
    setSelected(null);
    setParams({ site: code });
  };

  const devices = topology.nodes.filter(hasDevice);
  const count = (s: NodeHealth["status"]) => devices.filter((n) => health[n.id]?.status === s).length;
  const states = new Map(topology.links.map((l) => [l.id, linkState(l, health)]));
  const linksUp = topology.links.filter((l) => states.get(l.id) !== "down").length;
  const broken = topology.links.filter((l) => l.breaks?.length).length;

  const nodeOf = (id: string) => topology.nodes.find((n) => n.id === id);
  const linkOf = (id: string) => topology.links.find((l) => l.id === id);
  const linksOf = (node: TopoNode) => topology.links.filter((l) => l.a.node === node.id || l.b.node === node.id);

  const rows = topology.links.filter((l) => !onlyProblems || states.get(l.id) !== "up" || l.note);
  const tip = hovered?.kind === "node" ? nodeOf(hovered.id) : null;
  const tipLink = hovered?.kind === "link" ? linkOf(hovered.id) : null;
  const tipLevel = tip ? (health[tip.id]?.status ?? "none") : tipLink ? states.get(tipLink.id) : "none";

  const selNode = selected?.kind === "node" ? nodeOf(selected.id) : null;
  const selLink = selected?.kind === "link" ? linkOf(selected.id) : null;

  return (
    <div className="topo-page">
      <header className="topo-head">
        <div>
          <div className="eyebrow">Topologia · camada 2</div>
          <h1>
            {topology.name} <span className="muted mono">{topology.code}</span>
          </h1>
          <div className="muted topo-meta">
            {topology.city} · desenho {topology.revision}, {topology.date}, por {topology.author}
          </div>
        </div>
        <div className="topo-head-right">
          <div className="topo-tabs" role="tablist" aria-label="Planta">
            {TOPOLOGIES.map((t) => (
              <button key={t.code} role="tab" aria-selected={t.code === topology.code} className={t.code === topology.code ? "active" : ""} onClick={() => switchSite(t.code)}>
                {t.code}
              </button>
            ))}
          </div>
          <span className="badge sim" title="Enlaces e portas vêm do desenho oficial; o status dos ativos é simulado">
            Status simulado
          </span>
        </div>
      </header>

      <div className="topo-kpis">
        <div className="kpi">
          <span className="kpi-label">Online</span>
          <span className="kpi-value ok">{count("online")}</span>
        </div>
        <div className="kpi">
          <span className="kpi-label">Degradados</span>
          <span className="kpi-value warn">{count("degraded")}</span>
        </div>
        <div className="kpi">
          <span className="kpi-label">Offline</span>
          <span className={`kpi-value ${count("offline") ? "crit" : ""}`}>{count("offline")}</span>
        </div>
        <div className="kpi">
          <span className="kpi-label">Enlaces ativos</span>
          <span className="kpi-value">
            {linksUp}
            <small>/{topology.links.length}</small>
          </span>
        </div>
        <div className="kpi">
          <span className="kpi-label">Interrompidos no desenho</span>
          <span className={`kpi-value ${broken ? "crit" : ""}`}>{broken}</span>
        </div>
      </div>

      <div className="topo-main">
        <section className="panel topo-canvas">
          <div className="topo-toolbar">
            <span className="muted">Passe o mouse para ver os detalhes; clique para fixar.</span>
            <div className="topo-zoom">
              <button className="btn small" onClick={() => setZoom((z) => Math.max(0, z - 1))} disabled={zoom === 0} aria-label="Diminuir zoom">
                −
              </button>
              <span className="mono">{Math.round(ZOOMS[zoom] * 100)}%</span>
              <button className="btn small" onClick={() => setZoom((z) => Math.min(ZOOMS.length - 1, z + 1))} disabled={zoom === ZOOMS.length - 1} aria-label="Aumentar zoom">
                +
              </button>
            </div>
          </div>
          <div className="topo-scroll">
            <div className="topo-stage" style={{ width: `${ZOOMS[zoom] * 100}%` }}>
              <Diagram
                topology={topology}
                health={health}
                selected={selected}
                hovered={hovered}
                onSelect={setSelected}
                onHover={(s, e) => {
                  if (e) follow.pos.current = { x: e.clientX, y: e.clientY };
                  setHovered(s);
                  follow.place();
                }}
              />
            </div>
          </div>
          <Legend />
        </section>

        <aside className="panel topo-side">
          {selNode ? (
            <NodeDetails topology={topology} node={selNode} health={health[selNode.id]} links={linksOf(selNode)} states={states} onPick={setSelected} />
          ) : selLink ? (
            <LinkDetails topology={topology} link={selLink} state={states.get(selLink.id)!} onPick={setSelected} />
          ) : (
            <Overview topology={topology} health={health} onPick={setSelected} />
          )}
        </aside>
      </div>

      <section className="panel topo-table-panel">
        <div className="topo-table-head">
          <div className="room-section-title">
            Documentação dos enlaces
            <span className="muted">{topology.links.length} enlaces</span>
          </div>
          <label className="topo-filter">
            <input type="checkbox" checked={onlyProblems} onChange={(e) => setOnlyProblems(e.target.checked)} /> Somente com problema ou observação
          </label>
        </div>
        <div className="topo-table-wrap">
          <table className="topo-table">
            <thead>
              <tr>
                <th>Origem</th>
                <th>Destino</th>
                <th>Meio</th>
                <th>Fibras</th>
                <th>Anel</th>
                <th>Estado</th>
                <th>Observação</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((l) => (
                <tr
                  key={l.id}
                  className={selected?.kind === "link" && selected.id === l.id ? "selected" : ""}
                  onClick={() => setSelected({ kind: "link", id: l.id })}
                  onMouseEnter={() => setHovered({ kind: "link", id: l.id })}
                  onMouseLeave={() => setHovered(null)}
                >
                  <td>
                    <EndCell topology={topology} end={l.a} />
                  </td>
                  <td>
                    <EndCell topology={topology} end={l.b} />
                  </td>
                  <td>
                    <span className={`topo-medium ${l.medium}`}>{MEDIUM_SHORT[l.medium]}</span>
                  </td>
                  <td className="mono">{l.fibers ? `${l.fibers} FO` : "—"}</td>
                  <td className="muted">{l.ring ?? "—"}</td>
                  <td>
                    <StatusPill status={states.get(l.id)!} />
                  </td>
                  <td className={l.breaks?.length ? "crit-text" : "muted"}>{l.note ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div ref={follow.box} className={`port-tooltip ${tipLevel === "offline" || tipLevel === "down" ? "crit" : tipLevel === "degraded" ? "warn" : tipLevel === "none" ? "off" : ""}${hovered ? " visible" : ""}`} role="tooltip">
        {tip && (
          <div className="tt-card">
            <div className="tt-head">
              <span className="tt-title mono">{nodeLabel(tip)}</span>
              <StatusPill status={health[tip.id]?.status ?? "none"} />
            </div>
            <div className="tt-grid">
              <span className="tt-label">Local</span>
              <span className="tt-value">
                {tip.location}
                {tip.locationEn ? ` / ${tip.locationEn}` : ""}
              </span>
              {tip.ip && (
                <>
                  <span className="tt-label">IP</span>
                  <span className="tt-value mono">{tip.ip}</span>
                </>
              )}
              {tip.model && (
                <>
                  <span className="tt-label">Modelo</span>
                  <span className="tt-value mono">{tip.model}</span>
                </>
              )}
              <span className="tt-label">Enlaces</span>
              <span className="tt-value">{linksOf(tip).length}</span>
            </div>
            {health[tip.id]?.reason && <div className={`tt-problem ${health[tip.id].status === "offline" ? "crit" : "warn"}`}>{health[tip.id].reason}</div>}
            {tip.nok && <div className="tt-problem crit">{tip.nok}</div>}
          </div>
        )}
        {tipLink && (
          <div className="tt-card">
            <div className="tt-head">
              <span className="tt-title mono">
                {endText(topology, tipLink.a).name} ↔ {endText(topology, tipLink.b).name}
              </span>
              <StatusPill status={states.get(tipLink.id)!} />
            </div>
            <div className="tt-grid">
              <span className="tt-label">Portas</span>
              <span className="tt-value mono">
                {tipLink.a.port ?? "—"} ↔ {tipLink.b.port ?? "—"}
              </span>
              <span className="tt-label">Meio</span>
              <span className="tt-value">{MEDIUM_LABEL[tipLink.medium]}</span>
              {tipLink.fibers && (
                <>
                  <span className="tt-label">Fibras</span>
                  <span className="tt-value mono">{tipLink.fibers} FO</span>
                </>
              )}
              {tipLink.ring && (
                <>
                  <span className="tt-label">Anel</span>
                  <span className="tt-value">{tipLink.ring}</span>
                </>
              )}
            </div>
            {tipLink.note && <div className={`tt-problem ${tipLink.breaks?.length ? "crit" : "warn"}`}>{tipLink.note}</div>}
          </div>
        )}
      </div>
    </div>
  );
}

function Legend() {
  return (
    <div className="topo-legend">
      <span>
        <i className="ln sm" /> Fibra SM
      </span>
      <span>
        <i className="ln mm" /> Fibra MM
      </span>
      <span>
        <i className="ln utp" /> UTP
      </span>
      <span>
        <i className="ln wireless" /> Rádio
      </span>
      <span>
        <i className="ln bypass" /> Passagem (bypass)
      </span>
      <span>
        <i className="sq" /> SFP Cisco
      </span>
      <span>
        <i className="ci" /> Conversor de fibra
      </span>
      <span className="crit-text">✕ Conexão interrompida</span>
      <span>
        <i className="dot online" /> Online
      </span>
      <span>
        <i className="dot degraded" /> Degradado
      </span>
      <span>
        <i className="dot offline" /> Offline
      </span>
      <span>
        <i className="fr core" /> Sala de servidores / distribuição
      </span>
      <span>
        <i className="fr switch" /> Ponta / switch de borda
      </span>
    </div>
  );
}

function Overview({ topology, health, onPick }: { topology: SiteTopology; health: Record<string, NodeHealth>; onPick: (s: Selection) => void }) {
  const attention = topology.nodes.filter((n) => health[n.id] && health[n.id].status !== "online");
  const noks = topology.nodes.filter((n) => n.nok);
  return (
    <>
      <div className="room-section-title">Atenção</div>
      {attention.length === 0 && noks.length === 0 && <p className="muted">Todos os ativos estão online.</p>}
      <ul className="topo-list">
        {attention.map((n) => (
          <li key={n.id}>
            <button onClick={() => onPick({ kind: "node", id: n.id })}>
              <span className={`topo-dot ${health[n.id].status}`} />
              <span>
                <b className="mono">{nodeLabel(n)}</b>
                <span className="muted">{health[n.id].reason}</span>
              </span>
            </button>
          </li>
        ))}
        {noks.map((n) => (
          <li key={`nok-${n.id}`}>
            <button onClick={() => onPick({ kind: "node", id: n.id })}>
              <span className="topo-dot nok" />
              <span>
                <b className="mono">{nodeLabel(n)}</b>
                <span className="crit-text">{n.nok}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      <p className="muted topo-hint">Clique em um equipamento ou enlace no desenho para ver as portas, o meio e as observações.</p>
    </>
  );
}

function NodeDetails({
  topology,
  node,
  health,
  links,
  states,
  onPick,
}: {
  topology: SiteTopology;
  node: TopoNode;
  health?: NodeHealth;
  links: TopoLink[];
  states: Map<string, LinkState>;
  onPick: (s: Selection) => void;
}) {
  return (
    <>
      <div className="topo-side-head">
        <div>
          <div className="eyebrow">{node.kind === "ap" ? "Access point" : node.kind === "passive" ? "Ponto sem ativo" : "Switch"}</div>
          <h2 className="mono">{nodeLabel(node)}</h2>
        </div>
        <button className="ex-close" onClick={() => onPick(null)} aria-label="Fechar">
          ×
        </button>
      </div>
      <StatusPill status={health?.status ?? "none"} />
      {health && <span className="muted topo-since"> {ago(health.since)}</span>}
      {health?.reason && <p className={`topo-reason ${health.status}`}>{health.reason}</p>}
      {node.nok && <p className="topo-reason offline">{node.nok}</p>}
      <dl className="room-facts topo-facts">
        {node.location && (
          <>
            <dt>Local</dt>
            <dd>
              {node.location}
              {node.locationEn ? ` / ${node.locationEn}` : ""}
            </dd>
          </>
        )}
        {node.ip && (
          <>
            <dt>IP</dt>
            <dd className="mono">{node.ip}</dd>
          </>
        )}
        {node.model && (
          <>
            <dt>Modelo</dt>
            <dd className="mono">{node.model}</dd>
          </>
        )}
        {node.bypass && (
          <>
            <dt>Passagem</dt>
            <dd>Cabo óptico passa sem terminar (bypass)</dd>
          </>
        )}
      </dl>
      <div className="room-section-title">
        Enlaces <span className="muted">{links.length}</span>
      </div>
      <ul className="topo-list">
        {links.map((l) => {
          const mine = l.a.node === node.id ? l.a : l.b;
          const other = l.a.node === node.id ? l.b : l.a;
          const o = endText(topology, other);
          return (
            <li key={l.id}>
              <button onClick={() => onPick({ kind: "link", id: l.id })}>
                <span className={`topo-dot ${states.get(l.id) === "up" ? "online" : states.get(l.id) === "degraded" ? "degraded" : "offline"}`} />
                <span>
                  <b className="mono">
                    {mine.port ?? "—"} → {o.name} {o.port ?? ""}
                  </b>
                  <span className="muted">
                    {MEDIUM_SHORT[l.medium]}
                    {l.fibers ? ` · ${l.fibers} FO` : ""}
                    {l.note ? ` · ${l.note}` : ""}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </>
  );
}

function LinkDetails({ topology, link, state, onPick }: { topology: SiteTopology; link: TopoLink; state: LinkState; onPick: (s: Selection) => void }) {
  const a = endText(topology, link.a);
  const b = endText(topology, link.b);
  return (
    <>
      <div className="topo-side-head">
        <div>
          <div className="eyebrow">Enlace</div>
          <h2 className="mono">
            {a.name} ↔ {b.name}
          </h2>
        </div>
        <button className="ex-close" onClick={() => onPick(null)} aria-label="Fechar">
          ×
        </button>
      </div>
      <StatusPill status={state} />
      {link.note && <p className={`topo-reason ${link.breaks?.length ? "offline" : "degraded"}`}>{link.note}</p>}
      <dl className="room-facts topo-facts">
        <dt>Ponta A</dt>
        <dd>
          <button className="topo-link-btn mono" onClick={() => onPick({ kind: "node", id: link.a.node })}>
            {a.name}
          </button>{" "}
          <span className="mono">{a.port ?? "porta não documentada"}</span>
        </dd>
        <dt>Ponta B</dt>
        <dd>
          <button className="topo-link-btn mono" onClick={() => onPick({ kind: "node", id: link.b.node })}>
            {b.name}
          </button>{" "}
          <span className="mono">{b.port ?? "porta não documentada"}</span>
        </dd>
        <dt>Meio</dt>
        <dd>{MEDIUM_LABEL[link.medium]}</dd>
        <dt>Fibras</dt>
        <dd className="mono">{link.fibers ? `${link.fibers} FO` : "—"}</dd>
        {link.ring && (
          <>
            <dt>Anel</dt>
            <dd>{link.ring}</dd>
          </>
        )}
        <dt>Conectores</dt>
        <dd>
          {[link.a.connector, link.b.connector]
            .map((c) => (c === "sfp" ? "SFP Cisco" : c === "converter" ? "Conversor" : c === "injector" ? "Injetor PoE" : "—"))
            .join(" ↔ ")}
        </dd>
      </dl>
    </>
  );
}
