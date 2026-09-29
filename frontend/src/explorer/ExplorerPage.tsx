import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { type ExplorerSite, type Health, KIND_SHORT, roomHealth, usedU, worstHealth } from "./data";
import { SiteMap } from "./SiteMap";
import { useExplorer } from "./useExplorer";

const HEALTH_LABEL: Record<Health, string> = { ok: "Normal", warn: "Atenção", crit: "Crítico" };
const dec = (value: number, digits = 1) => value.toFixed(digits).replace(".", ",");
const level = (value: number) => (value >= 90 ? "crit" : value >= 80 ? "warn" : "ok");
const siteHealth = (s: ExplorerSite) => worstHealth(s.rooms.map(roomHealth));

export function ExplorerPage() {
  const [params, setParams] = useSearchParams();
  const { sites, source, explorer } = useExplorer();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [resetKey, setResetKey] = useState(0);

  const siteId = Number(params.get("site")) || null;
  const select = (next: { site?: number | null; room?: string | null }) => {
    if (next.room) {
      navigate(`/explorer/sala/${encodeURIComponent(next.room)}`);
      return;
    }
    setParams(next.site ? { site: String(next.site) } : {});
  };

  const selected = explorer.find((s) => s.site.id === siteId) ?? null;
  const unplaced = source.filter((s) => s.latitude === null || s.longitude === null);

  const q = query.trim().toLowerCase();
  const matches = (text: string) => text.toLowerCase().includes(q);
  const visible = explorer.filter(
    (s) =>
      !q ||
      matches(s.site.code) ||
      matches(s.site.name) ||
      matches(s.site.city ?? "") ||
      s.rooms.some((r) => matches(r.name) || matches(r.code) || r.racks.some((k) => k.units.some((u) => matches(u.label)))),
  );

  const rooms = explorer.flatMap((s) => s.rooms);
  const racks = rooms.reduce((n, r) => n + r.racks.length, 0);
  const alerts = rooms.filter((r) => roomHealth(r) !== "ok").length;

  return (
    <div className="explorer">
      <aside className="ex-side">
        <div className="ex-side-head">
          <div className="eyebrow">Explorer</div>
          <h1>Sites e salas técnicas</h1>
        </div>
        <label className="ex-search">
          <span aria-hidden>⌕</span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar site, sala ou ativo…"
            aria-label="Buscar site, sala ou ativo"
          />
        </label>
        <div className="ex-kpis">
          <div>
            <span className="kpi-label">Sites</span>
            <span className="mono">{String(explorer.length).padStart(2, "0")}</span>
          </div>
          <div>
            <span className="kpi-label">Salas</span>
            <span className="mono">{String(rooms.length).padStart(2, "0")}</span>
          </div>
          <div>
            <span className="kpi-label">Racks</span>
            <span className="mono">{String(racks).padStart(2, "0")}</span>
          </div>
          <div>
            <span className="kpi-label">Alertas</span>
            <span className={`mono ${alerts ? "crit-text" : ""}`}>{String(alerts).padStart(2, "0")}</span>
          </div>
        </div>

        <ul className="ex-list">
          {visible.map((s) => {
            const open = s.site.id === siteId;
            const health = siteHealth(s);
            return (
              <li key={s.site.id}>
                <button className={`ex-site${open ? " selected" : ""}`} onClick={() => select({ site: open ? null : s.site.id })}>
                  <span className="ex-site-name">
                    <b>{s.site.name}</b>
                    <span className="muted">
                      {s.site.code}
                      {s.site.city ? ` · ${s.site.city}${s.site.state ? `/${s.site.state}` : ""}` : ""}
                    </span>
                  </span>
                  <span className={`dot-lg ${health}`} title={HEALTH_LABEL[health]} />
                </button>
                {open && (
                  <ul className="ex-rooms">
                    {s.rooms.map((r) => (
                      <li key={r.id}>
                        <button className="ex-room-item" onClick={() => select({ site: s.site.id, room: r.id })}>
                          <span className={`ex-kind ${r.kind}`}>{KIND_SHORT[r.kind]}</span>
                          <span className="ex-room-name">{r.name}</span>
                          <span className="muted mono">{r.racks.length}R</span>
                          <span className={`dot-lg ${roomHealth(r)}`} />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
        {!visible.length && !sites.loading && <p className="muted empty">Nada encontrado.</p>}
        {unplaced.length > 0 && (
          <p className="ex-unplaced muted">
            {unplaced.length === 1 ? "1 site sem coordenadas" : `${unplaced.length} sites sem coordenadas`} (
            {unplaced.map((s) => s.code).join(", ")}). <Link to="/sites">Cadastrar posição</Link>
          </p>
        )}
      </aside>

      <main className="ex-main">
        <SiteMap
          sites={explorer}
          selectedSite={siteId}
          selectedRoom={null}
          onSelectSite={(id) => select({ site: id })}
          onSelectRoom={(id) => select({ site: explorer.find((x) => x.rooms.some((r) => r.id === id))?.site.id, room: id })}
          resetKey={resetKey}
        />
        <div className="ex-toolbar">
          <span className="badge sim" title="Salas, racks e sensores são fictícios; a posição dos sites vem do cadastro">
            Salas e racks fictícios
          </span>
          <button
            className="btn ex-reset"
            onClick={() => {
              select({});
              setResetKey((k) => k + 1);
            }}
          >
            Visão geral
          </button>
        </div>

        {selected && (
          <section className="ex-card ex-site-card">
            <div className="ex-card-eyebrow">
              Site · {selected.site.code}
              <Link to="/sites" className="ex-edit">
                Editar
              </Link>
            </div>
            <h2>{selected.site.name}</h2>
            <div className="ex-room-sub muted mono">
              {dec(selected.lat, 4)}, {dec(selected.lng, 4)}
            </div>
            <ul className="ex-node-list">
              {selected.rooms.map((r) => {
                const h = roomHealth(r);
                const occupancy = (r.racks.reduce((n, k) => n + usedU(k), 0) / r.racks.reduce((n, k) => n + k.heightU, 0)) * 100;
                return (
                  <li key={r.id}>
                    <button className="ex-node" onClick={() => select({ site: selected.site.id, room: r.id })}>
                      <span className={`dot-lg ${h}`} />
                      <span className="ex-node-name mono">{r.code}</span>
                      <span className="ex-node-meta muted">
                        {r.racks.length} rack{r.racks.length > 1 ? "s" : ""} · {dec(r.temperatureC)} °C
                      </span>
                      <span className={`ex-node-pct mono ${level(occupancy)}`} title="Ocupação dos racks">
                        {Math.round(occupancy)}%
                      </span>
                      <span className="ex-node-go" aria-hidden>
                        ›
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

      </main>
    </div>
  );
}
