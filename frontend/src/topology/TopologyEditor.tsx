import { type FormEvent, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { type TopologyPayload, api } from "../api";
import { useInventory } from "../inventory";
import { MEDIUM_LABEL, type Medium, type NodeKind, type SiteTopology, type TopoLink, type TopoNode, nodeLabel } from "./data";
import { Diagram, type Selection } from "./Diagram";
import { NODE_SIZE, autoRoute, emptyTopology, fitView, freeId, midpoint, moveNode, newNode } from "./edit";

const KIND_LABEL: Record<NodeKind, string> = {
  core: "Switch central / core",
  switch: "Switch de acesso",
  passive: "Ponto passivo (passagem)",
  ap: "Access point",
};

const CONNECTORS = { "": "—", sfp: "SFP Cisco", converter: "Conversor de mídia", injector: "Injetor PoE" } as const;

/* Page for creating a site's drawing (/topologia/nova) or editing it (/topologia/editar?site=CODE). */
export function TopologyEditorPage() {
  const [params] = useSearchParams();
  const inventory = useInventory();
  const code = params.get("site");
  const existing = code ? inventory.topologies.find((t) => t.code === code) : undefined;
  if (inventory.loading) return <p className="muted page">Carregando…</p>;
  if (code && !existing)
    return (
      <div className="page">
        <p className="muted">Topologia de {code} não encontrada.</p>
        <Link to="/topologia" className="btn">
          Voltar
        </Link>
      </div>
    );
  const free = inventory.sites.filter((s) => !inventory.topologies.some((t) => t.siteId === s.id));
  return (
    <TopologyEditor
      key={existing?.code ?? "new"}
      initial={existing ?? null}
      freeSites={free}
      onSaved={inventory.reload}
    />
  );
}

interface EditorProps {
  initial: SiteTopology | null;
  freeSites: { id: number; code: string; name: string; city: string | null }[];
  onSaved: () => void;
}

function TopologyEditor({ initial, freeSites, onSaved }: EditorProps) {
  const navigate = useNavigate();
  const [siteId, setSiteId] = useState<number | null>(initial?.siteId ?? freeSites[0]?.id ?? null);
  const site = freeSites.find((s) => s.id === siteId);
  const [topo, setTopo] = useState<SiteTopology>(
    () => initial ?? emptyTopology(site?.code ?? "", site?.name ?? "", site?.city ?? ""),
  );
  const [selected, setSelected] = useState<Selection>(null);
  const [tab, setTab] = useState<"nodes" | "links">("nodes");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  const edit = (next: SiteTopology) => {
    setTopo(next);
    setDirty(true);
  };
  const node = selected?.kind === "node" ? topo.nodes.find((n) => n.id === selected.id) : undefined;
  const link = selected?.kind === "link" ? topo.links.find((l) => l.id === selected.id) : undefined;
  const byId = useMemo(() => new Map(topo.nodes.map((n) => [n.id, n])), [topo.nodes]);
  const linkName = (l: TopoLink) => `${byId.get(l.a.node) ? nodeLabel(byId.get(l.a.node)!) : l.a.node} ↔ ${byId.get(l.b.node) ? nodeLabel(byId.get(l.b.node)!) : l.b.node}`;

  const setNode = (patch: Partial<TopoNode>) =>
    node && edit({ ...topo, nodes: topo.nodes.map((n) => (n.id === node.id ? { ...n, ...patch } : n)) });
  const setLink = (patch: Partial<TopoLink>) =>
    link && edit({ ...topo, links: topo.links.map((l) => (l.id === link.id ? { ...l, ...patch } : l)) });
  const reroute = (l: TopoLink, patch: Partial<TopoLink> = {}) => {
    const next = { ...l, ...patch };
    const a = byId.get(next.a.node);
    const b = byId.get(next.b.node);
    if (!a || !b) return next;
    const points = autoRoute(a, b);
    return { ...next, points, labelAt: undefined, dotted: undefined, breaks: next.breaks?.length ? [midpoint(points)] : undefined };
  };

  const addNode = (kind: NodeKind) => {
    const n = newNode(topo, kind);
    edit({ ...topo, nodes: [...topo.nodes, n], view: fitView({ ...topo, nodes: [...topo.nodes, n] }) });
    setSelected({ kind: "node", id: n.id });
    setTab("nodes");
  };
  const removeNode = (id: string) => {
    if (!confirm(`Excluir ${id} e os enlaces dele?`)) return;
    edit({ ...topo, nodes: topo.nodes.filter((n) => n.id !== id), links: topo.links.filter((l) => l.a.node !== id && l.b.node !== id) });
    setSelected(null);
  };
  const addLink = () => {
    const from = node ?? topo.nodes[0];
    const to = topo.nodes.find((n) => n !== from && n.kind !== "ap") ?? topo.nodes.find((n) => n !== from);
    if (!from || !to) return;
    const l = reroute({ id: freeId("L", topo.links.map((x) => x.id)), a: { node: from.id }, b: { node: to.id }, medium: "utp", points: [] });
    edit({ ...topo, links: [...topo.links, l] });
    setSelected({ kind: "link", id: l.id });
    setTab("links");
  };
  const removeLink = (id: string) => {
    edit({ ...topo, links: topo.links.filter((l) => l.id !== id) });
    setSelected(null);
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!siteId) return;
    // Grow the frame when something was dragged or added outside it; never crop the original.
    const fit = fitView(topo);
    const [vx, vy, vw, vh] = topo.view;
    const x0 = Math.min(vx, fit[0]);
    const y0 = Math.min(vy, fit[1]);
    const view: [number, number, number, number] = initial
      ? [x0, y0, Math.max(vx + vw, fit[0] + fit[2]) - x0, Math.max(vy + vh, fit[1] + fit[3]) - y0]
      : fit;
    const payload: TopologyPayload = {
      site_id: siteId,
      name: topo.name.trim(),
      city: topo.city.trim() || null,
      revision: topo.revision.trim() || null,
      date: topo.date.trim() || null,
      author: topo.author.trim() || null,
      document: {
        view,
        textScale: topo.textScale,
        nodes: topo.nodes,
        links: topo.links,
        annotations: topo.annotations,
        groups: topo.groups,
      },
    };
    setSaving(true);
    try {
      if (initial?.recordId) await api.topologies.update(initial.recordId, payload);
      else await api.topologies.create(payload);
      const code = initial?.code ?? site?.code ?? "";
      onSaved();
      setDirty(false);
      navigate(`/topologia?site=${encodeURIComponent(code)}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const cancel = () => {
    if (dirty && !confirm("Descartar as alterações?")) return;
    navigate(initial ? `/topologia?site=${encodeURIComponent(initial.code)}` : "/topologia");
  };

  return (
    <form className="topo-page topo-editor" onSubmit={save}>
      <header className="topo-head">
        <div>
          <div className="eyebrow">Topologia · {initial ? "edição" : "nova"}</div>
          <h1>
            {topo.name || "Nova topologia"} <span className="muted mono">{initial?.code ?? site?.code ?? ""}</span>
          </h1>
          <div className="muted topo-meta">Arraste os ativos no desenho; os cabos acompanham. Cabos novos são traçados automaticamente.</div>
        </div>
        <div className="topo-head-right">
          {error && <span className="form-error">{error}</span>}
          <button type="button" className="btn ghost" onClick={cancel}>
            Cancelar
          </button>
          <button type="submit" className="btn primary" disabled={saving || !siteId}>
            {saving ? "Salvando…" : "Salvar topologia"}
          </button>
        </div>
      </header>

      <fieldset className="topo-editor-head">
        <legend>Desenho</legend>
        {!initial && (
          <label>
            Site
            <select
              value={siteId ?? ""}
              required
              onChange={(e) => {
                const next = freeSites.find((s) => s.id === Number(e.target.value));
                setSiteId(next?.id ?? null);
                if (next) setTopo({ ...topo, code: next.code, name: topo.name || next.name, city: topo.city || (next.city ?? "") });
              }}
            >
              {!freeSites.length && <option value="">Todos os sites já têm topologia</option>}
              {freeSites.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.code} · {s.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label>
          Nome
          <input value={topo.name} required maxLength={200} onChange={(e) => edit({ ...topo, name: e.target.value })} />
        </label>
        <label>
          Cidade
          <input value={topo.city} maxLength={120} onChange={(e) => edit({ ...topo, city: e.target.value })} placeholder="Arcos/MG" />
        </label>
        <label>
          Revisão
          <input value={topo.revision} maxLength={32} onChange={(e) => edit({ ...topo, revision: e.target.value })} placeholder="Rev. 3" />
        </label>
        <label>
          Data
          <input value={topo.date} maxLength={32} onChange={(e) => edit({ ...topo, date: e.target.value })} placeholder="out/2026" />
        </label>
        <label>
          Autor
          <input value={topo.author} maxLength={120} onChange={(e) => edit({ ...topo, author: e.target.value })} />
        </label>
      </fieldset>

      <div className="topo-editor-main">
        <section className="panel topo-editor-canvas">
          <div className="topo-toolbar">
            <span className="room-section-title">Desenho</span>
            <span className="muted">
              {topo.nodes.length} ativos · {topo.links.length} enlaces
            </span>
          </div>
          {topo.nodes.length ? (
            <Diagram
              topology={topo}
              health={{}}
              selected={selected}
              hovered={null}
              onSelect={(s) => {
                setSelected(s);
                if (s) setTab(s.kind === "node" ? "nodes" : "links");
              }}
              onHover={() => {}}
              onMoveNode={(id, x, y) => {
                setTopo((t) => moveNode(t, id, x, y));
                setDirty(true);
              }}
            />
          ) : (
            <p className="muted empty">Comece adicionando o switch central.</p>
          )}
        </section>

        <aside className="panel topo-editor-side">
          <div className="topo-editor-tabs" role="tablist">
            <button type="button" role="tab" aria-selected={tab === "nodes"} className={tab === "nodes" ? "active" : ""} onClick={() => setTab("nodes")}>
              Ativos · {topo.nodes.length}
            </button>
            <button type="button" role="tab" aria-selected={tab === "links"} className={tab === "links" ? "active" : ""} onClick={() => setTab("links")}>
              Enlaces · {topo.links.length}
            </button>
          </div>

          {tab === "nodes" && (
            <>
              <div className="topo-editor-add">
                {(Object.keys(KIND_LABEL) as NodeKind[]).map((k) => (
                  <button key={k} type="button" className="btn ghost small" onClick={() => addNode(k)}>
                    + {k === "core" ? "Core" : k === "switch" ? "Switch" : k === "ap" ? "AP" : "Passivo"}
                  </button>
                ))}
              </div>
              <ul className="topo-editor-list">
                {topo.nodes.map((n) => (
                  <li key={n.id}>
                    <button type="button" className={node?.id === n.id ? "active" : ""} onClick={() => setSelected({ kind: "node", id: n.id })}>
                      <span className="mono">{nodeLabel(n)}</span>
                      <span className="muted">{n.kind === "passive" ? "passivo" : n.kind}</span>
                    </button>
                  </li>
                ))}
              </ul>
              {node && (
                <fieldset className="topo-editor-form">
                  <legend>{node.id}</legend>
                  <label>
                    Tipo
                    <select
                      value={node.kind}
                      onChange={(e) => {
                        const kind = e.target.value as NodeKind;
                        const [w, h] = NODE_SIZE[kind];
                        setNode({ kind, w, h });
                      }}
                    >
                      {Object.entries(KIND_LABEL).map(([k, label]) => (
                        <option key={k} value={k}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Hostname
                    <input value={node.hostname ?? ""} onChange={(e) => setNode({ hostname: e.target.value || undefined })} placeholder="BRNMATIB12" />
                  </label>
                  <label>
                    IP
                    <input value={node.ip ?? ""} onChange={(e) => setNode({ ip: e.target.value || undefined })} placeholder="10.127.228.12" />
                  </label>
                  <label>
                    Modelo
                    <input value={node.model ?? ""} onChange={(e) => setNode({ model: e.target.value || undefined })} placeholder="C9200L-24P-4G" />
                  </label>
                  <label>
                    Local
                    <input value={node.location ?? ""} onChange={(e) => setNode({ location: e.target.value || undefined })} placeholder="Expedição" />
                  </label>
                  <label>
                    Local (inglês)
                    <input value={node.locationEn ?? ""} onChange={(e) => setNode({ locationEn: e.target.value || undefined })} placeholder="Shipping" />
                  </label>
                  <label className="span">
                    Pendência (texto em vermelho)
                    <input value={node.nok ?? ""} onChange={(e) => setNode({ nok: e.target.value || undefined })} />
                  </label>
                  <p className="hint">Pilha de switches: separe os modelos com &amp; (C9200L-24T &amp; C9200L-24P).</p>
                  <button type="button" className="btn danger small" onClick={() => removeNode(node.id)}>
                    Excluir ativo
                  </button>
                </fieldset>
              )}
            </>
          )}

          {tab === "links" && (
            <>
              <div className="topo-editor-add">
                <button type="button" className="btn ghost small" onClick={addLink} disabled={topo.nodes.length < 2}>
                  + Enlace{node ? ` a partir de ${nodeLabel(node)}` : ""}
                </button>
              </div>
              <ul className="topo-editor-list">
                {topo.links.map((l) => (
                  <li key={l.id}>
                    <button type="button" className={link?.id === l.id ? "active" : ""} onClick={() => setSelected({ kind: "link", id: l.id })}>
                      <span>{linkName(l)}</span>
                      <span className="muted mono">{l.medium.toUpperCase()}</span>
                    </button>
                  </li>
                ))}
              </ul>
              {link && (
                <fieldset className="topo-editor-form">
                  <legend>{link.id}</legend>
                  {(["a", "b"] as const).map((end) => (
                    <div key={end} className="topo-editor-end">
                      <label>
                        Ponta {end.toUpperCase()}
                        <select
                          value={link[end].node}
                          onChange={(e) => setLink(reroute(link, { [end]: { ...link[end], node: e.target.value } }))}
                        >
                          {topo.nodes.map((n) => (
                            <option key={n.id} value={n.id}>
                              {nodeLabel(n)}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Porta
                        <input
                          value={link[end].port ?? ""}
                          onChange={(e) => setLink({ [end]: { ...link[end], port: e.target.value || undefined } })}
                          placeholder="Gi1/0/24"
                        />
                      </label>
                      <label>
                        Conector
                        <select
                          value={link[end].connector ?? ""}
                          onChange={(e) =>
                            setLink({ [end]: { ...link[end], connector: (e.target.value || undefined) as TopoLink["a"]["connector"] } })
                          }
                        >
                          {Object.entries(CONNECTORS).map(([v, label]) => (
                            <option key={v} value={v}>
                              {label}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                  ))}
                  <label>
                    Meio
                    <select value={link.medium} onChange={(e) => setLink({ medium: e.target.value as Medium })}>
                      {Object.entries(MEDIUM_LABEL).map(([v, label]) => (
                        <option key={v} value={v}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Fibras
                    <input
                      type="number"
                      min={0}
                      value={link.fibers ?? ""}
                      disabled={link.medium !== "sm" && link.medium !== "mm"}
                      onChange={(e) => setLink({ fibers: e.target.value ? Number(e.target.value) : undefined })}
                    />
                  </label>
                  <label>
                    Anel
                    <input value={link.ring ?? ""} onChange={(e) => setLink({ ring: e.target.value || undefined })} placeholder="Anel 1" />
                  </label>
                  <label>
                    Observação
                    <input value={link.note ?? ""} onChange={(e) => setLink({ note: e.target.value || undefined })} />
                  </label>
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={!!link.breaks?.length}
                      onChange={(e) => setLink({ breaks: e.target.checked ? [midpoint(link.points)] : undefined })}
                    />
                    Enlace interrompido
                  </label>
                  <div className="topo-editor-row">
                    <button type="button" className="btn ghost small" onClick={() => setLink(reroute(link))}>
                      Retraçar cabo
                    </button>
                    <button type="button" className="btn danger small" onClick={() => removeLink(link.id)}>
                      Excluir enlace
                    </button>
                  </div>
                </fieldset>
              )}
            </>
          )}
        </aside>
      </div>
    </form>
  );
}
