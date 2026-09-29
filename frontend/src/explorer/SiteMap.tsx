import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useEffect, useRef } from "react";
import { type ExplorerSite, KIND_SHORT, roomHealth, worstHealth } from "./data";

/* Dark Leaflet map with one marker per site and, once zoomed in, one per technical room. */

const TILES = "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png";
const ROOM_ZOOM = 13;

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
  map.flyToBounds(bounds.pad(0.6), { maxZoom: 9, duration: 1.2 });
}

export function SiteMap({ sites, selectedSite, selectedRoom, onSelectSite, onSelectRoom, resetKey }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);
  const handlers = useRef({ onSelectSite, onSelectRoom });
  handlers.current = { onSelectSite, onSelectRoom };
  const fitted = useRef(false);

  useEffect(() => {
    if (!container.current) return;
    const m = L.map(container.current, { zoomControl: false, attributionControl: true, worldCopyJump: true });
    L.control.zoom({ position: "bottomleft" }).addTo(m);
    L.tileLayer(TILES, {
      subdomains: "abcd",
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a>',
    }).addTo(m);
    m.setView([-15.8, -47.9], 4);
    layer.current = L.layerGroup().addTo(m);
    m.on("zoomend", () => container.current?.classList.toggle("show-rooms", m.getZoom() >= ROOM_ZOOM));
    map.current = m;
    return () => {
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
      const racks = s.rooms.reduce((n, r) => n + r.racks.length, 0);
      const marker = L.marker([s.lat, s.lng], {
        icon: L.divIcon({
          className: "",
          html: `<div class="site-marker ${health}${selectedSite === s.site.id ? " selected" : ""}">
              <span class="pulse"></span><span class="core"></span>
              <span class="site-marker-label"><b>${escape(s.site.code)}</b> ${s.rooms.length} salas · ${racks} racks</span>
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
            html: `<div class="room-marker ${roomHealth(room)}${selectedRoom === room.id ? " selected" : ""}">
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

  return <div ref={container} className="site-map" />;
}
