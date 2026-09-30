import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useEffect, useRef, useState } from "react";
import { BASEMAPS, labelsLayer, OFFLINE_ID, offlineLayer, saveBasemap, savedBasemap, tileLayer } from "./basemaps";
import { type ExplorerSite, KIND_SHORT, roomHealth, worstHealth } from "./data";

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
}

function fitAll(map: L.Map, sites: ExplorerSite[]) {
  if (!sites.length) {
    map.setView([-15.8, -47.9], 4);
    return;
  }
  const bounds = L.latLngBounds(sites.map((s) => [s.lat, s.lng]));
  map.flyToBounds(bounds.pad(0.6), { maxZoom: 7, duration: 1.2 });
}

export function SiteMap({ sites, selectedSite, selectedRoom, onSelectSite, onSelectRoom, resetKey }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);
  const handlers = useRef({ onSelectSite, onSelectRoom });
  handlers.current = { onSelectSite, onSelectRoom };
  const fitted = useRef(false);
  const [base, setBase] = useState<BaseStatus>({ id: BASEMAPS[0].id, state: "loading" });
  const selectBase = useRef<(id: string, auto: boolean) => void>(() => {});

  useEffect(() => {
    if (!container.current) return;
    const m = L.map(container.current, { zoomControl: false, attributionControl: true, worldCopyJump: true });
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
                <span class="room-marker-label">${escape(room.name)}</span>
              </div>`,
            iconSize: [0, 0],
          }),
          title: room.name,
        });
        roomMarker.on("click", () => handlers.current.onSelectRoom(room.id));
        group.addLayer(roomMarker);
      }
    }
    if (!fitted.current && sites.length && map.current) {
      fitted.current = true;
      fitAll(map.current, sites);
    }
  }, [sites, selectedSite, selectedRoom]);

  // Fly to the selection. Only ids are dependencies, so live sensor updates don't move the camera.
  const target = (() => {
    const site = sites.find((s) => s.site.id === selectedSite);
    const room = site?.rooms.find((r) => r.id === selectedRoom);
    return room ? { lat: room.lat, lng: room.lng, zoom: 17 } : site ? { lat: site.lat, lng: site.lng, zoom: 15 } : null;
  })();
  const targetKey = target ? `${selectedSite}-${selectedRoom}` : null;
  const targetRef = useRef(target);
  targetRef.current = target;
  useEffect(() => {
    const m = map.current;
    const t = targetRef.current;
    if (!m || !t) return;
    m.flyTo([t.lat, t.lng], t.zoom, { duration: 1.1 });
  }, [targetKey]);

  const sitesRef = useRef(sites);
  sitesRef.current = sites;
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
