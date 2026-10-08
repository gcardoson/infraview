import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignHorizontalDistributeCenter,
  AlignStartHorizontal,
  AlignStartVertical,
  AlignVerticalDistributeCenter,
  Copy,
  Grid3x3,
  Hand,
  Magnet,
  Maximize,
  MousePointer2,
  Redo2,
  Route,
  Spline,
  Trash2,
  Undo2,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { type FormEvent, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { type TopologyPayload, api } from "../api";
import { useInventory } from "../inventory";
import { MEDIUM_LABEL, MEDIUM_SHORT, type Medium, type NodeKind, type Point, type SiteTopology, type TopoLink, type TopoNode, nodeLabel } from "./data";
import { type CanvasApi, EditorCanvas, SHAPE_MIME, type Shape, type Tool } from "./EditorCanvas";
import {
  type AlignMode,
  type Clip,
  NODE_SIZE,
  type Ref,
  alignNodes,
  copySelection,
  deleteSelection,
  distributeNodes,
  emptyTopology,
  fitView,
  midpoint,
  moveSelection,
  newNode,
  pasteClip,
  rerouteLink,
} from "./edit";
import { useHistory } from "./history";

const KIND_LABEL: Record<NodeKind, string> = {
  core: "Switch central / core",
  switch: "Switch de acesso",
  passive: "Ponto passivo (passagem)",
  ap: "Access point",
};

const CONNECTORS = { "": "—", sfp: "SFP Cisco", converter: "Conversor de mídia", injector: "Injetor PoE" } as const;

/* The stencil: what can be dragged onto the drawing. */
const STENCIL: { shape: Shape; label: string }[] = [
  { shape: "core", label: "Switch central" },
  { shape: "switch", label: "Switch de acesso" },
  { shape: "ap", label: "Access point" },
  { shape: "passive", label: "Ponto passivo" },
  { shape: "text", label: "Texto" },
  { shape: "area", label: "Área" },
];

function StencilIcon({ shape }: { shape: Shape }) {
  return (
    <svg viewBox="0 0 48 32" className={`ve-stencil-icon ${shape}`} aria-hidden>
      {shape === "core" && (
        <>
          <rect x={7} y={2} width={34} height={28} rx={2} className="frame" />
          <rect x={11} y={20} width={26} height={4} className="face" />
          <rect x={11} y={25} width={26} height={3} className="face" />
        </>
      )}
      {shape === "switch" && (
        <>
          <rect x={10} y={4} width={28} height={24} rx={2} className="frame" />
          <rect x={13} y={21} width={22} height={4} className="face" />
        </>
      )}
      {shape === "ap" && <rect x={12} y={11} width={24} height={11} rx={5.5} className="frame" />}
      {shape === "passive" && <rect x={10} y={4} width={28} height={24} rx={2} className="frame passive" />}
      {shape === "text" && (
        <text x={24} y={22} textAnchor="middle" className="label">
          Abc
        </text>
      )}
      {shape === "area" && <rect x={4} y={4} width={40} height={24} rx={3} className="area" />}
    </svg>
  );
}

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
  return <TopologyEditor key={existing?.code ?? "new"} initial={existing ?? null} freeSites={free} onSaved={inventory.reload} />;
}

interface EditorProps {
  initial: SiteTopology | null;
  freeSites: { id: number; code: string; name: string; city: string | null }[];
  onSaved: () => void;
}

function IconButton({ label, onClick, disabled, active, children }: { label: string; onClick: () => void; disabled?: boolean; active?: boolean; children: ReactNode }) {
  return (
    <button type="button" className={`ve-tool${active ? " active" : ""}`} title={label} aria-label={label} aria-pressed={active} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  );
}

const typing = (e: KeyboardEvent) => !!(e.target as HTMLElement).closest?.("input, textarea, select");

function TopologyEditor({ initial, freeSites, onSaved }: EditorProps) {
  const navigate = useNavigate();
  const [siteId, setSiteId] = useState<number | null>(initial?.siteId ?? freeSites[0]?.id ?? null);
  const site = freeSites.find((s) => s.id === siteId);
  const history = useHistory<SiteTopology>(() => initial ?? emptyTopology(site?.code ?? "", site?.name ?? "", site?.city ?? ""));
  const topo = history.value;
  const start = useRef(topo);
  const [selection, setSelection] = useState<Ref[]>([]);
  const [tool, setTool] = useState<Tool>("select");
  const [medium, setMedium] = useState<Medium>("sm");
  const [grid, setGrid] = useState(true);
  const [guides, setGuides] = useState(true);
  const [zoom, setZoom] = useState(100);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [focusToken, setFocusToken] = useState(0);
  const focusField = useRef<string | undefined>(undefined);
  const canvas = useRef<CanvasApi | null>(null);
  const clip = useRef<Clip | null>(null);
  const props = useRef<HTMLElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const dirty = topo !== start.current;

  // Drop selected refs that no longer exist (after undo, delete or paste).
  const valid = useMemo(
    () =>
      selection.filter((r) => {
        const key = r.slice(2);
        if (r.startsWith("n:")) return topo.nodes.some((n) => n.id === key);
        if (r.startsWith("l:")) return topo.links.some((l) => l.id === key);
        if (r.startsWith("a:")) return Number(key) < topo.annotations.length;
        return Number(key) < (topo.groups?.length ?? 0);
      }),
    [selection, topo],
  );
  const selNodes = valid.filter((r) => r.startsWith("n:")).map((r) => r.slice(2));
  const single = valid.length === 1 ? valid[0] : null;
  const node = single?.startsWith("n:") ? topo.nodes.find((n) => n.id === single.slice(2)) : undefined;
  const link = single?.startsWith("l:") ? topo.links.find((l) => l.id === single.slice(2)) : undefined;
  const annIndex = single?.startsWith("a:") ? Number(single.slice(2)) : -1;
  const groupIndex = single?.startsWith("g:") ? Number(single.slice(2)) : -1;
  const byId = useMemo(() => new Map(topo.nodes.map((n) => [n.id, n])), [topo.nodes]);
  const nameOf = (id: string) => (byId.get(id) ? nodeLabel(byId.get(id)!) || id : id);

  // Text fields change the drawing live and become one undo step when the field loses focus.
  const typed = (fn: (t: SiteTopology) => SiteTopology) => history.preview(fn);
  const done = () => history.commit();
  const setNode = (patch: Partial<TopoNode>, live = false) =>
    node && (live ? typed : history.set)((t) => ({ ...t, nodes: t.nodes.map((n) => (n.id === node.id ? { ...n, ...patch } : n)) }));
  const setLink = (patch: Partial<TopoLink> | ((l: TopoLink) => TopoLink), live = false) =>
    link &&
    (live ? typed : history.set)((t) => ({
      ...t,
      links: t.links.map((l) => (l.id === link.id ? (typeof patch === "function" ? patch(l) : { ...l, ...patch }) : l)),
    }));
  const setMeta = (patch: Partial<SiteTopology>) => typed((t) => ({ ...t, ...patch }));

  const select = (refs: Ref[]) => setSelection(refs);
  const remove = useCallback(() => {
    if (!valid.length) return;
    history.set((t) => deleteSelection(t, valid));
    setSelection([]);
  }, [valid, history]);
  const paste = useCallback(
    (source: Clip | null, offset = 20) => {
      if (!source) return;
      const res = pasteClip(topo, source, offset, offset);
      history.set(res.topo);
      setSelection(res.refs);
    },
    [topo, history],
  );
  const duplicate = useCallback(() => paste(copySelection(topo, valid)), [paste, topo, valid]);

  const dropShape = useCallback(
    (shape: Shape, at: Point) => {
      const snap = (v: number) => Math.round(v / 2) * 2;
      if (shape === "text") {
        history.set((t) => ({ ...t, annotations: [...t.annotations, { text: "Texto", at: [snap(at[0]), snap(at[1])], tone: "note" }] }));
        setSelection([`a:${topo.annotations.length}`]);
      } else if (shape === "area") {
        const g = { label: "Área", x: snap(at[0] - 160), y: snap(at[1] - 100), w: 320, h: 200 };
        history.set((t) => ({ ...t, groups: [...(t.groups ?? []), g] }));
        setSelection([`g:${topo.groups?.length ?? 0}`]);
      } else {
        const n = newNode(topo, shape, at[0], at[1]);
        history.set((t) => ({ ...t, nodes: [...t.nodes, n] }));
        setSelection([`n:${n.id}`]);
      }
      setTool("select");
      setFocusToken((k) => k + 1);
    },
    [topo, history],
  );

  // Double-click on a shape, or a new shape: jump to its first field.
  useEffect(() => {
    if (!focusToken) return;
    const field = focusField.current;
    focusField.current = undefined;
    const el = props.current?.querySelector<HTMLInputElement>(
      field ? `[data-field="${field}"]` : "fieldset input:not([type=checkbox]), fieldset textarea",
    );
    el?.focus();
    el?.select();
  }, [focusToken]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "s") {
        e.preventDefault();
        form.current?.requestSubmit();
        return;
      }
      if (typing(e)) return;
      const key = e.key.toLowerCase();
      if (mod && key === "z") {
        e.preventDefault();
        if (e.shiftKey) history.redo();
        else history.undo();
      } else if (mod && key === "y") {
        e.preventDefault();
        history.redo();
      } else if (mod && key === "c") {
        clip.current = copySelection(topo, valid);
      } else if (mod && key === "x") {
        clip.current = copySelection(topo, valid);
        remove();
      } else if (mod && key === "v") {
        e.preventDefault();
        paste(clip.current);
      } else if (mod && key === "d") {
        e.preventDefault();
        duplicate();
      } else if (mod && key === "a") {
        e.preventDefault();
        setSelection([
          ...topo.nodes.map((n) => `n:${n.id}`),
          ...topo.links.map((l) => `l:${l.id}`),
          ...topo.annotations.map((_, i) => `a:${i}`),
          ...(topo.groups ?? []).map((_, i) => `g:${i}`),
        ]);
      } else if (key === "delete" || key === "backspace") {
        e.preventDefault();
        remove();
      } else if (key === "escape") {
        setSelection([]);
        setTool("select");
      } else if (key.startsWith("arrow") && valid.length) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 2;
        const [dx, dy] = { arrowleft: [-step, 0], arrowright: [step, 0], arrowup: [0, -step], arrowdown: [0, step] }[key] ?? [0, 0];
        history.set((t) => moveSelection(t, valid, dx, dy));
      } else if (!mod && key === "v") setTool("select");
      else if (!mod && key === "c") setTool("connect");
      else if (!mod && key === "h") setTool("pan");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [history, topo, valid, remove, paste, duplicate]);

  const align = (mode: AlignMode) => history.set((t) => alignNodes(t, selNodes, mode));
  const distribute = (axis: "x" | "y") => history.set((t) => distributeNodes(t, selNodes, axis));
  const selLinks = valid.filter((r) => r.startsWith("l:")).map((r) => r.slice(2));
  const reroute = () => history.set((t) => ({ ...t, links: t.links.map((l) => (selLinks.includes(l.id) ? rerouteLink(t, l) : l)) }));

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!siteId) return;
    // The saved frame is what the Topologia page shows: grow it to hold everything drawn, but never
    // crop the original drawing's page.
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
      start.current = topo;
      onSaved();
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

  const focusOn = (ref: Ref) => {
    setSelection([ref]);
    canvas.current?.frame([ref]);
  };

  return (
    <form className="ve-page" onSubmit={save} ref={form}>
      <header className="topo-head ve-head">
        <div>
          <div className="eyebrow">Topologia · {initial ? "edição" : "nova"}</div>
          <h1>
            {topo.name || "Nova topologia"} <span className="muted mono">{initial?.code ?? site?.code ?? ""}</span>
          </h1>
        </div>
        <div className="topo-head-right">
          {error && <span className="form-error">{error}</span>}
          {dirty && <span className="muted ve-dirty">Alterações não salvas</span>}
          <button type="button" className="btn ghost" onClick={cancel}>
            Cancelar
          </button>
          <button type="submit" className="btn primary" disabled={saving || !siteId}>
            {saving ? "Salvando…" : "Salvar topologia"}
          </button>
        </div>
      </header>

      <div className="ve-ribbon" role="toolbar" aria-label="Ferramentas do desenho">
        <div className="ve-group">
          <IconButton label="Ponteiro (V)" active={tool === "select"} onClick={() => setTool("select")}>
            <MousePointer2 size={16} />
          </IconButton>
          <IconButton label="Conector: puxe de um ativo a outro (C)" active={tool === "connect"} onClick={() => setTool("connect")}>
            <Spline size={16} />
          </IconButton>
          <IconButton label="Mão: arrastar o desenho (H ou segure espaço)" active={tool === "pan"} onClick={() => setTool("pan")}>
            <Hand size={16} />
          </IconButton>
        </div>
        <div className="ve-group ve-media" role="radiogroup" aria-label="Meio dos enlaces novos">
          <span className="ve-group-label">Enlace novo</span>
          {(Object.keys(MEDIUM_SHORT) as Medium[]).map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={medium === m}
              className={`ve-medium ${m}${medium === m ? " active" : ""}`}
              title={MEDIUM_LABEL[m]}
              onClick={() => setMedium(m)}
            >
              <i />
              {MEDIUM_SHORT[m]}
            </button>
          ))}
        </div>
        <div className="ve-group">
          <IconButton label="Desfazer (Ctrl+Z)" onClick={history.undo} disabled={!history.canUndo}>
            <Undo2 size={16} />
          </IconButton>
          <IconButton label="Refazer (Ctrl+Y)" onClick={history.redo} disabled={!history.canRedo}>
            <Redo2 size={16} />
          </IconButton>
        </div>
        <div className="ve-group">
          <IconButton label="Duplicar (Ctrl+D)" onClick={duplicate} disabled={!valid.some((r) => !r.startsWith("l:"))}>
            <Copy size={16} />
          </IconButton>
          <IconButton label="Excluir (Delete)" onClick={remove} disabled={!valid.length}>
            <Trash2 size={16} />
          </IconButton>
          <IconButton label="Retraçar os cabos selecionados" onClick={reroute} disabled={!selLinks.length}>
            <Route size={16} />
          </IconButton>
        </div>
        <div className="ve-group">
          <IconButton label="Alinhar à esquerda" onClick={() => align("left")} disabled={selNodes.length < 2}>
            <AlignStartVertical size={16} />
          </IconButton>
          <IconButton label="Centralizar na vertical" onClick={() => align("center")} disabled={selNodes.length < 2}>
            <AlignCenterVertical size={16} />
          </IconButton>
          <IconButton label="Alinhar à direita" onClick={() => align("right")} disabled={selNodes.length < 2}>
            <AlignEndVertical size={16} />
          </IconButton>
          <IconButton label="Alinhar em cima" onClick={() => align("top")} disabled={selNodes.length < 2}>
            <AlignStartHorizontal size={16} />
          </IconButton>
          <IconButton label="Centralizar na horizontal" onClick={() => align("middle")} disabled={selNodes.length < 2}>
            <AlignCenterHorizontal size={16} />
          </IconButton>
          <IconButton label="Alinhar embaixo" onClick={() => align("bottom")} disabled={selNodes.length < 2}>
            <AlignEndHorizontal size={16} />
          </IconButton>
          <IconButton label="Distribuir na horizontal" onClick={() => distribute("x")} disabled={selNodes.length < 3}>
            <AlignHorizontalDistributeCenter size={16} />
          </IconButton>
          <IconButton label="Distribuir na vertical" onClick={() => distribute("y")} disabled={selNodes.length < 3}>
            <AlignVerticalDistributeCenter size={16} />
          </IconButton>
        </div>
        <div className="ve-group">
          <IconButton label="Grade" active={grid} onClick={() => setGrid(!grid)}>
            <Grid3x3 size={16} />
          </IconButton>
          <IconButton label="Guias de alinhamento (segure Alt para soltar livre)" active={guides} onClick={() => setGuides(!guides)}>
            <Magnet size={16} />
          </IconButton>
        </div>
      </div>

      <div className="ve-body">
        <aside className="ve-stencil" aria-label="Formas">
          <div className="ve-panel-title">Formas</div>
          {STENCIL.map((s) => (
            <button
              key={s.shape}
              type="button"
              className="ve-stencil-item"
              draggable
              title={`Arraste para o desenho ou clique para adicionar: ${s.label}`}
              onDragStart={(e) => {
                e.dataTransfer.setData(SHAPE_MIME, s.shape);
                e.dataTransfer.effectAllowed = "copy";
              }}
              onClick={() => dropShape(s.shape, canvas.current?.center() ?? [500, 280])}
            >
              <StencilIcon shape={s.shape} />
              <span>{s.label}</span>
            </button>
          ))}
          <div className="ve-keys">
            <div className="ve-panel-title">Atalhos</div>
            <p>
              <kbd>Ctrl</kbd>+roda: zoom
            </p>
            <p>
              <kbd>Espaço</kbd>+arrastar: mover a vista
            </p>
            <p>
              <kbd>Shift</kbd>+clique: somar à seleção
            </p>
            <p>
              <kbd>Ctrl</kbd>+<kbd>D</kbd>: duplicar
            </p>
            <p>
              <kbd>Ctrl</kbd>+<kbd>Z</kbd> / <kbd>Y</kbd>: desfazer, refazer
            </p>
            <p>Setas: mover 2 (Shift: 10)</p>
          </div>
        </aside>

        <section className="ve-stage">
          {topo.nodes.length === 0 && (
            <div className="ve-empty">Arraste o switch central da paleta Formas para o desenho para começar.</div>
          )}
          <EditorCanvas
            topo={topo}
            selection={valid}
            onSelect={select}
            preview={history.preview}
            commit={history.commit}
            set={history.set}
            tool={tool}
            medium={medium}
            grid={grid}
            guides={guides}
            onDropShape={dropShape}
            onEdit={(ref, field) => {
              focusField.current = field;
              setSelection([ref]);
              setFocusToken((k) => k + 1);
            }}
            onZoom={setZoom}
            apiRef={canvas}
          />
          <footer className="ve-statusbar">
            <span>
              {topo.nodes.length} ativos · {topo.links.length} enlaces
              {valid.length > 0 && ` · ${valid.length} selecionado${valid.length > 1 ? "s" : ""}`}
            </span>
            <span className="ve-hint muted">
              {tool === "connect"
                ? "Puxe de um ativo até outro para criar o enlace."
                : "Passe o mouse num ativo e puxe um dos × para criar um enlace. Arraste um cabo para dobrá-lo."}
            </span>
            <span className="ve-zoom">
              <IconButton label="Diminuir zoom" onClick={() => canvas.current?.zoomBy(1 / 1.25)}>
                <ZoomOut size={14} />
              </IconButton>
              <span className="mono">{zoom}%</span>
              <IconButton label="Aumentar zoom" onClick={() => canvas.current?.zoomBy(1.25)}>
                <ZoomIn size={14} />
              </IconButton>
              <IconButton label="Ajustar à janela" onClick={() => canvas.current?.fit()}>
                <Maximize size={14} />
              </IconButton>
            </span>
          </footer>
        </section>

        <aside className="ve-props" ref={props} aria-label="Dados da forma">
          {!valid.length && (
            <>
              <fieldset className="topo-editor-form">
                <legend>Documento</legend>
                {!initial && (
                  <label className="span">
                    Site
                    <select
                      value={siteId ?? ""}
                      required
                      onChange={(e) => {
                        const next = freeSites.find((s) => s.id === Number(e.target.value));
                        setSiteId(next?.id ?? null);
                        if (next) history.set((t) => ({ ...t, code: next.code, name: t.name || next.name, city: t.city || (next.city ?? "") }));
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
                <label className="span">
                  Nome
                  <input value={topo.name} required maxLength={200} onChange={(e) => setMeta({ name: e.target.value })} onBlur={done} />
                </label>
                <label className="span">
                  Cidade
                  <input value={topo.city} maxLength={120} onChange={(e) => setMeta({ city: e.target.value })} onBlur={done} placeholder="Arcos/MG" />
                </label>
                <label>
                  Revisão
                  <input value={topo.revision} maxLength={32} onChange={(e) => setMeta({ revision: e.target.value })} onBlur={done} placeholder="Rev. 3" />
                </label>
                <label>
                  Data
                  <input value={topo.date} maxLength={32} onChange={(e) => setMeta({ date: e.target.value })} onBlur={done} placeholder="out/2026" />
                </label>
                <label className="span">
                  Autor
                  <input value={topo.author} maxLength={120} onChange={(e) => setMeta({ author: e.target.value })} onBlur={done} />
                </label>
              </fieldset>
              <div className="ve-panel-title">Ativos no desenho</div>
              <ul className="topo-editor-list">
                {topo.nodes.map((n) => (
                  <li key={n.id}>
                    <button type="button" onClick={() => focusOn(`n:${n.id}`)}>
                      <span className="mono">{nodeLabel(n) || n.id}</span>
                      <span className="muted">{n.kind === "passive" ? "passivo" : n.kind}</span>
                    </button>
                  </li>
                ))}
                {!topo.nodes.length && <li className="muted ve-list-empty">Nenhum ativo ainda.</li>}
              </ul>
            </>
          )}

          {node && (
            <fieldset className="topo-editor-form">
              <legend>{node.id}</legend>
              <label className="span">
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
                <input value={node.hostname ?? ""} onChange={(e) => setNode({ hostname: e.target.value || undefined }, true)} onBlur={done} placeholder="BRNMATIB12" />
              </label>
              <label>
                IP
                <input value={node.ip ?? ""} onChange={(e) => setNode({ ip: e.target.value || undefined }, true)} onBlur={done} placeholder="10.127.228.12" />
              </label>
              <label className="span">
                Modelo
                <input value={node.model ?? ""} onChange={(e) => setNode({ model: e.target.value || undefined }, true)} onBlur={done} placeholder="C9200L-24P-4G" />
              </label>
              <label>
                Local
                <input value={node.location ?? ""} onChange={(e) => setNode({ location: e.target.value || undefined }, true)} onBlur={done} placeholder="Expedição" />
              </label>
              <label>
                Local (inglês)
                <input value={node.locationEn ?? ""} onChange={(e) => setNode({ locationEn: e.target.value || undefined }, true)} onBlur={done} placeholder="Shipping" />
              </label>
              <label className="span">
                Pendência (texto em vermelho)
                <input value={node.nok ?? ""} onChange={(e) => setNode({ nok: e.target.value || undefined }, true)} onBlur={done} />
              </label>
              <label>
                Largura
                <input type="number" min={24} step={2} value={node.w} onChange={(e) => setNode({ w: Math.max(24, Number(e.target.value) || node.w) })} />
              </label>
              <label>
                Altura
                <input type="number" min={18} step={2} value={node.h} onChange={(e) => setNode({ h: Math.max(18, Number(e.target.value) || node.h) })} />
              </label>
              <p className="hint">Pilha de switches: separe os modelos com &amp; (C9200L-24T &amp; C9200L-24P).</p>
              <ul className="ve-node-links">
                {topo.links
                  .filter((l) => l.a.node === node.id || l.b.node === node.id)
                  .map((l) => (
                    <li key={l.id}>
                      <button type="button" onClick={() => focusOn(`l:${l.id}`)}>
                        <span>{nameOf(l.a.node === node.id ? l.b.node : l.a.node)}</span>
                        <span className="muted mono">{MEDIUM_SHORT[l.medium]}</span>
                      </button>
                    </li>
                  ))}
              </ul>
            </fieldset>
          )}

          {link && (
            <fieldset className="topo-editor-form">
              <legend>
                {link.id} · {nameOf(link.a.node)} ↔ {nameOf(link.b.node)}
              </legend>
              {(["a", "b"] as const).map((end) => (
                <div key={end} className="topo-editor-end">
                  <label>
                    Ponta {end.toUpperCase()}
                    <select
                      value={link[end].node}
                      onChange={(e) => history.set((t) => ({ ...t, links: t.links.map((l) => (l.id === link.id ? rerouteLink(t, { ...l, [end]: { node: e.target.value } }) : l)) }))}
                    >
                      {topo.nodes.map((n) => (
                        <option key={n.id} value={n.id}>
                          {nodeLabel(n) || n.id}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Porta
                    <input
                      data-field={`port-${end}`}
                      value={link[end].port ?? ""}
                      onChange={(e) => setLink((l) => ({ ...l, [end]: { ...l[end], port: e.target.value || undefined } }), true)}
                      onBlur={done}
                      placeholder="Gi1/0/24"
                    />
                  </label>
                  <label>
                    Conector
                    <select
                      value={link[end].connector ?? ""}
                      onChange={(e) => setLink((l) => ({ ...l, [end]: { ...l[end], connector: (e.target.value || undefined) as TopoLink["a"]["connector"] } }))}
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
                <select
                  value={link.medium}
                  onChange={(e) => {
                    const m = e.target.value as Medium;
                    setLink({ medium: m, fibers: m === "sm" || m === "mm" ? (link.fibers ?? 2) : undefined });
                  }}
                >
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
                  onChange={(e) => setLink({ fibers: e.target.value ? Number(e.target.value) : undefined }, true)}
                  onBlur={done}
                />
              </label>
              <label>
                Anel
                <input value={link.ring ?? ""} onChange={(e) => setLink({ ring: e.target.value || undefined }, true)} onBlur={done} placeholder="Anel 1" />
              </label>
              <label>
                Observação
                <input value={link.note ?? ""} onChange={(e) => setLink({ note: e.target.value || undefined }, true)} onBlur={done} />
              </label>
              <label className="check span">
                <input type="checkbox" checked={!!link.breaks?.length} onChange={(e) => setLink({ breaks: e.target.checked ? [midpoint(link.points)] : undefined })} />
                Enlace interrompido
              </label>
              <p className="hint">
                Arraste os quadrados do cabo para dobrá-lo e as bolinhas das pontas até outro ativo para religá-lo. O nome da porta
                pode ser arrastado para longe da linha; dois cliques nele editam o texto.
              </p>
              {(link.a.labelOffset || link.b.labelOffset) && (
                <button
                  type="button"
                  className="btn ghost small span"
                  onClick={() => setLink((l) => ({ ...l, a: { ...l.a, labelOffset: undefined }, b: { ...l.b, labelOffset: undefined } }))}
                >
                  Voltar as portas à posição padrão
                </button>
              )}
            </fieldset>
          )}

          {annIndex >= 0 && topo.annotations[annIndex] && (
            <fieldset className="topo-editor-form">
              <legend>Texto</legend>
              <label className="span">
                Texto
                <input
                  value={topo.annotations[annIndex].text}
                  onChange={(e) => typed((t) => ({ ...t, annotations: t.annotations.map((a, i) => (i === annIndex ? { ...a, text: e.target.value } : a)) }))}
                  onBlur={done}
                />
              </label>
              <label className="span">
                Estilo
                <select
                  value={topo.annotations[annIndex].tone ?? "note"}
                  onChange={(e) =>
                    history.set((t) => ({ ...t, annotations: t.annotations.map((a, i) => (i === annIndex ? { ...a, tone: e.target.value as "note" | "nok" } : a)) }))
                  }
                >
                  <option value="note">Observação</option>
                  <option value="nok">Pendência (vermelho)</option>
                </select>
              </label>
            </fieldset>
          )}

          {groupIndex >= 0 && topo.groups?.[groupIndex] && (
            <fieldset className="topo-editor-form">
              <legend>Área</legend>
              <label className="span">
                Rótulo
                <input
                  value={topo.groups[groupIndex].label}
                  onChange={(e) => typed((t) => ({ ...t, groups: t.groups?.map((g, i) => (i === groupIndex ? { ...g, label: e.target.value } : g)) }))}
                  onBlur={done}
                />
              </label>
              <p className="hint">Arraste o canto inferior direito para redimensionar.</p>
            </fieldset>
          )}

          {valid.length > 1 && (
            <div className="ve-multi">
              <div className="ve-panel-title">{valid.length} itens selecionados</div>
              <p className="muted">
                {selNodes.length} ativos. Use a barra para alinhar ou distribuir; o primeiro ativo selecionado é a referência do alinhamento.
              </p>
            </div>
          )}

          {valid.length > 0 && (
            <button type="button" className="btn danger small ve-delete" onClick={remove}>
              Excluir {valid.length > 1 ? "seleção" : node ? "ativo e enlaces dele" : link ? "enlace" : annIndex >= 0 ? "texto" : "área"}
            </button>
          )}
        </aside>
      </div>
    </form>
  );
}
