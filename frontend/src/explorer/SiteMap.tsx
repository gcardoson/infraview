import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useEffect, useRef, useState } from "react";
import { BASEMAPS, labelsLayer, OFFLINE_ID, offlineLayer, saveBasemap, savedBasemap, tileLayer } from "./basemaps";
import { MEDIUM_LABEL, type Medium } from "../topology/data";
import { LINK_LABEL, type LinkState, linkState, type NodeHealth } from "../topology/status";
import { type ExplorerSite, KIND_SHORT, type PlantConnection, roomHealth, worstHealth } from "./data";

/* Dark Leaflet map with one marker per site and, once zoomed in, one per technical room. */

const ROOM_ZOOM = 13;
/* A provider that loads no tile after this many errors, or within this time, is considered blocked. */
const MAX_ERRORS = 4;
const LOAD_TIMEOUT_MS = 8000;

type BaseStatus = { id: string; state: "loading" | "ok" | "failed" };

const escape = (text: string) =>
  text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

interface Props {
  sites: ExplorerSite[];
  selectedSite: number | null;
  selectedRoom: string | null;
  onSelectSite: (id: number) => void;
  onSelectRoom: (id: string) => void;
  resetKey: number;
  /* Simulated device status per topology code, shared with Topologia. */
  health: Record<string, Record<string, NodeHealth>>;
}

/* The line takes the best medium it carries: a fibre pair beside a copper cable reads as fibre. */
const MEDIUM_ORDER: Medium[] = ["sm", "mm", "wireless", "utp"];

function connectionState(c: PlantConnection, health: Record<string, NodeHealth>): LinkState {
  const states = c.links.map((l) => linkState(l, health));
  // A line is down only when every cable on it is; one working cable keeps the pair connected.
  if (states.every((x) => x === "down")) return "down";
  return states.includes("degraded") || states.includes("down") ? "degraded" : "up";
}

interface Drawn {
  line: L.Polyline;
  flow: L.Polyline;
  connection: PlantConnection;
  topology: string;
}

function fitAll(map: L.Map, sites: ExplorerSite[]) {
  if (!sites.length) {
    map.setView([-15.8, -47.9], 4);
    return;
  }
  const bounds = L.latLngBounds(sites.map((s) => [s.lat, s.lng]));
  map.flyToBounds(bounds.pad(0.6), { maxZoom: 7, duration: 1.2 });
}

export function SiteMap({ sites, selectedSite, selectedRoom, onSelectSite, onSelectRoom, resetKey, health }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);
  const links = useRef<L.LayerGroup | null>(null);
  const drawn = useRef<Drawn[]>([]);
  const handlers = useRef({ onSelectSite, onSelectRoom });
  handlers.current = { onSelectSite, onSelectRoom };
  const fitted = useRef(false);
  const [base, setBase] = useState<BaseStatus>({ id: BASEMAPS[0].id, state: "loading" });
  const selectBase = useRef<(id: string, auto: boolean) => void>(() => {});

  useEffect(() => {
    if (!container.current) return;
    const m = L.map(container.current, { zoomSnap: 0.25, zoomControl: false, attributionControl: true, worldCopyJump: true });
    L.control.zoom({ position: "bottomleft" }).addTo(m);
    m.createPane("offline").style.zIndex = "150";
    let disposed = false;
    offlineLayer()
      .then((layer) => !disposed && layer.addTo(m))
      .catch(() => {});

    // Tile providers: start with the saved one (or the first) and fall back down the list when blocked.
    let tiles: L.TileLayer | null = null;
    let labels: L.TileLayer | null = null;
    let timer = 0;
    const select = (id: string, auto: boolean) => {
      window.clearTimeout(timer);
      if (tiles) m.removeLayer(tiles);
      if (labels) m.removeLayer(labels);
      tiles = null;
      labels = null;
      const index = BASEMAPS.findIndex((b) => b.id === id);
      if (index < 0) {
        setBase({ id: OFFLINE_ID, state: "ok" });
        return;
      }
      const layer = tileLayer(BASEMAPS[index]);
      let loaded = 0;
      let errors = 0;
      const giveUp = () => {
        if (loaded || tiles !== layer) return;
        if (labels) m.removeLayer(labels);
        if (auto) select(BASEMAPS[index + 1]?.id ?? OFFLINE_ID, true);
        else setBase({ id, state: "failed" });
      };
      layer.on("tileload", () => {
        if (!loaded++) setBase({ id, state: "ok" });
      });
      layer.on("tileerror", () => {
        if (++errors >= MAX_ERRORS) giveUp();
      });
      timer = window.setTimeout(giveUp, LOAD_TIMEOUT_MS);
      tiles = layer.addTo(m);
      labels = labelsLayer(BASEMAPS[index])?.addTo(m) ?? null;
      setBase({ id, state: "loading" });
    };
    selectBase.current = select;
    const saved = savedBasemap();
    select(saved && (saved === OFFLINE_ID || BASEMAPS.some((b) => b.id === saved)) ? saved : BASEMAPS[0].id, true);

    m.setView([-15.8, -47.9], 4);
    // Links sit under the markers and, like the rooms, only show once zoomed into a plant.
    m.createPane("links").style.zIndex = "450";
    links.current = L.layerGroup().addTo(m);
    layer.current = L.layerGroup().addTo(m);
    m.on("zoomend", () => container.current?.classList.toggle("show-rooms", m.getZoom() >= ROOM_ZOOM));
    map.current = m;
    return () => {
      disposed = true;
      window.clearTimeout(timer);
      m.remove();
      map.current = null;
    };
  }, []);

  // Markers are cheap, so they are redrawn whenever the data or the selection changes.
  useEffect(() => {
    const group = layer.current;
    if (!group) return;
    group.clearLayers();
    for (const s of sites) {
      const health = worstHealth(s.rooms.map(roomHealth));
      const marker = L.marker([s.lat, s.lng], {
        icon: L.divIcon({
          className: "",
          html: `<div class="site-marker ${health}${selectedSite === s.site.id ? " selected" : ""}">
              <span class="pulse"></span><span class="core"></span>
              <span class="site-marker-label"><b>${escape(s.site.code)}</b> CPD · ${s.rooms.length - 1} racks</span>
            </div>`,
          iconSize: [0, 0],
        }),
        zIndexOffset: 1000,
        keyboard: true,
        title: s.site.name,
      });
      marker.on("click", () => handlers.current.onSelectSite(s.site.id));
      group.addLayer(marker);
      for (const room of s.rooms) {
        const roomMarker = L.marker([room.lat, room.lng], {
          icon: L.divIcon({
            className: "",
            html: `<div class="room-marker ${room.kind} ${roomHealth(room)}${selectedRoom === room.id ? " selected" : ""}">
                <span class="room-kind">${KIND_SHORT[room.kind]}</span>
                <span class="room-marker-label">${escape(room.kind === "rack" ? room.name.replace(/^Rack /, "") : room.name)}</span>
              </div>`,
            iconSize: [0, 0],
          }),
          title: room.name,
        });
        roomMarker.on("click", () => handlers.current.onSelectRoom(room.id));
        group.addLayer(roomMarker);
      }
      for (const w of s.waypoints) {
        group.addLayer(
          L.marker([w.lat, w.lng], {
            icon: L.divIcon({
              className: "",
              html: `<div class="pass-marker"><span class="pass-kind"></span><span class="room-marker-label">${escape(w.name)}${w.bypass ? " · passagem" : ""}</span></div>`,
              iconSize: [0, 0],
            }),
            title: `${w.name}: ponto passivo, sem switch`,
            interactive: false,
          }),
        );
      }
    }
    if (!fitted.current && sites.length && map.current) {
      fitted.current = true;
      fitAll(map.current, sites);
    }
  }, [sites, selectedSite, selectedRoom]);

  // Links are rebuilt only when the plants change (not on every sensor tick), so an open tooltip stays put.
  const sitesRef = useRef(sites);
  sitesRef.current = sites;
  const [drawnAt, setDrawnAt] = useState(0);
  const structure = sites.map((s) => `${s.site.id}:${s.lat},${s.lng}:${s.connections.length}`).join("|");
  useEffect(() => {
    const group = links.current;
    if (!group) return;
    group.clearLayers();
    drawn.current = [];
    for (const s of sitesRef.current) {
      if (!s.topology) continue;
      const names: Record<string, string> = {};
      for (const r of s.rooms)
        if (r.nodeId) names[r.nodeId] = r.kind === "cpd" ? `CPD (${r.devices[0]?.hostname})` : `${r.name} (${r.code})`;
      for (const w of s.waypoints) names[w.nodeId] = `${w.name} (passivo)`;
      for (const c of s.connections) {
        const path = c.path;
        const medium = MEDIUM_ORDER.find((m) => c.links.some((l) => l.medium === m)) ?? "utp";
        const line = L.polyline(path, { pane: "links", className: `ex-link ${medium}`, weight: c.links.length > 1 ? 4 : 2.5 });
        const flow = L.polyline(path, { pane: "links", className: "ex-link-flow", interactive: false, weight: 1.5 });
        const rows = c.links
          .map((l) => {
            const ports = [l.a.port, l.b.port].filter(Boolean).join(" ↔ ");
            return `<li><b>${MEDIUM_LABEL[l.medium]}${l.fibers ? ` · ${l.fibers} fibras` : ""}</b>${ports ? `<span class="mono">${escape(ports)}</span>` : ""}${l.ring ? `<span>${escape(l.ring)}</span>` : ""}${l.note ? `<span class="${l.breaks?.length ? "crit" : ""}">${escape(l.note)}</span>` : ""}</li>`;
          })
          .join("");
        line.bindTooltip(
          `<div class="ex-link-tip"><div class="ex-link-tip-head">${escape(names[c.a] ?? c.a)} ↔ ${escape(names[c.b] ?? c.b)}</div><div class="ex-link-tip-state"></div><ul>${rows}</ul></div>`,
          { sticky: true, direction: "top", offset: [0, -8], className: "ex-link-tooltip" },
        );
        group.addLayer(line);
        group.addLayer(flow);
        drawn.current.push({ line, flow, connection: c, topology: s.topology });
      }
    }
    setDrawnAt(Date.now());
  }, [structure]);

  // Status only restyles the existing lines.
  useEffect(() => {
    for (const d of drawn.current) {
      const state = connectionState(d.connection, health[d.topology] ?? {});
      const medium = d.line.options.className!.split(" ")[1];
      d.line.getElement()?.setAttribute("class", `leaflet-interactive ex-link ${medium} ${state}`);
      d.flow.getElement()?.setAttribute("class", `ex-link-flow ${state}`);
      const tip = d.line.getTooltip();
      const html = tip?.getContent();
      if (tip && typeof html === "string")
        tip.setContent(
          html.replace(
            /<div class="ex-link-tip-state[^"]*">[^<]*<\/div>/,
            `<div class="ex-link-tip-state ${state}">${LINK_LABEL[state]}</div>`,
          ),
        );
    }
  }, [health, drawnAt]);

  // Fly to the selection. Only ids are dependencies, so live sensor updates don't move the camera.
  const target = (() => {
    const site = sites.find((s) => s.site.id === selectedSite);
    const room = site?.rooms.find((r) => r.id === selectedRoom);
    return room ? { lat: room.lat, lng: room.lng, zoom: 17 } : site ? { lat: site.lat, lng: site.lng, zoom: 15, site } : null;
  })();
  const targetKey = target ? `${selectedSite}-${selectedRoom}` : null;
  const targetRef = useRef(target);
  targetRef.current = target;
  useEffect(() => {
    const m = map.current;
    const t = targetRef.current;
    if (!m || !t) return;
    // A plant frames all its rooms and waypoints; a room zooms onto it.
    const points = t.site ? Object.values(t.site.positions) : [];
    if (points.length > 1)
      m.flyToBounds(L.latLngBounds(points), {
        maxZoom: 17,
        duration: 1.1,
        paddingTopLeft: [360, 60],
        paddingBottomRight: [60, 60],
      });
    else m.flyTo([t.lat, t.lng], t.zoom, { duration: 1.1 });
  }, [targetKey]);

  useEffect(() => {
    if (resetKey && map.current) fitAll(map.current, sitesRef.current);
  }, [resetKey]);

  const current = BASEMAPS.find((b) => b.id === base.id);
  const status =
    base.id === OFFLINE_ID
      ? "Sem mapa online: exibindo contornos offline"
      : base.state === "loading"
        ? `Carregando ${current?.label}…`
        : base.state === "failed"
          ? `${current?.label} indisponível nesta rede`
          : null;

  return (
    <>
      <div ref={container} className="site-map" />
      <div className="ex-map-legend" aria-label="Legenda dos enlaces">
        <span className="muted">Enlaces da Topologia</span>
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
          <i className="ln down" /> Interrompido
        </span>
        <span>
          <i className="pk" /> Ponto passivo
        </span>
      </div>
      <div className="map-base">
        {status && <span className={`map-base-status ${base.state}`}>{status}</span>}
        <label>
          <span className="muted">Mapa</span>
          <select
            value={base.id}
            onChange={(e) => {
              saveBasemap(e.target.value);
              selectBase.current(e.target.value, false);
            }}
            aria-label="Mapa base"
          >
            {BASEMAPS.map((b) => (
              <option key={b.id} value={b.id}>
                {b.label}
              </option>
            ))}
            <option value={OFFLINE_ID}>Somente contornos (offline)</option>
          </select>
        </label>
      </div>
    </>
  );
}
