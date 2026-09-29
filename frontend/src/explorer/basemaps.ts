import L from "leaflet";
import type { GeometryCollection, Topology } from "topojson-specification";
import southAmericaUrl from "sane-topojson/dist/south-america_50m.json?url";

/*
 * Free, public tile services that need no API key. They are tried in order: if one can't be reached
 * (corporate proxy, firewall, outage), the map switches to the next. Under all of them sits an
 * offline layer with the outlines of South America and the Brazilian states bundled in the app, so the map is never blank.
 */

export interface Basemap {
  id: string;
  label: string;
  url: string;
  maxZoom: number;
  attribution: string;
  subdomains?: string;
  /* OpenStreetMap only has a light style; a CSS filter darkens it to match the interface. */
  darken?: boolean;
}

const OSM = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';
const ESRI = 'Tiles &copy; <a href="https://www.esri.com/">Esri</a>';

export const BASEMAPS: Basemap[] = [
  {
    id: "carto-dark",
    label: "Escuro (CARTO)",
    url: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
    subdomains: "abcd",
    maxZoom: 19,
    attribution: `${OSM} &copy; <a href="https://carto.com/attributions">CARTO</a>`,
  },
  {
    id: "esri-dark",
    label: "Escuro (Esri)",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}",
    maxZoom: 16,
    attribution: `${ESRI} &mdash; Esri, HERE, Garmin, ${OSM}`,
  },
  {
    id: "osm",
    label: "OpenStreetMap",
    url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    maxZoom: 19,
    attribution: OSM,
    darken: true,
  },
  {
    id: "esri-imagery",
    label: "Satélite (Esri)",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    maxZoom: 19,
    attribution: `${ESRI} &mdash; Esri, Maxar, Earthstar Geographics`,
  },
];

export const OFFLINE_ID = "offline";
const STORAGE_KEY = "infraview.basemap";

export function savedBasemap(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function saveBasemap(id: string) {
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // Private mode or blocked storage: the choice just isn't remembered.
  }
}

export function tileLayer(b: Basemap) {
  return L.tileLayer(b.url, {
    maxZoom: 19,
    maxNativeZoom: b.maxZoom,
    subdomains: b.subdomains ?? "abc",
    attribution: b.attribution,
    className: b.darken ? "tiles-darken" : "",
  });
}

/*
 * Offline base: countries, Brazilian states (UF), rivers and lakes of South America from Natural Earth
 * 1:50m (sane-topojson, MIT). The file is served by InfraView itself, so it works without internet.
 */
type Layers = "countries" | "subunits" | "rivers" | "lakes";

export async function offlineLayer(): Promise<L.LayerGroup> {
  const [{ feature }, data] = await Promise.all([
    import("topojson-client"),
    fetch(southAmericaUrl).then((r) => r.json() as Promise<Topology<Record<Layers, GeometryCollection>>>),
  ]);
  const layer = (name: Layers, style: L.PathOptions) =>
    L.geoJSON(feature(data, data.objects[name]), { interactive: false, pane: "offline", style: () => style });
  const group = L.layerGroup([
    layer("countries", { color: "#26323a", weight: 0.9, fillColor: "#10171b", fillOpacity: 1 }),
    layer("subunits", { color: "#24463d", weight: 0.8, fillColor: "#121c1c", fillOpacity: 1 }),
    layer("lakes", { stroke: false, fillColor: "#0a1116", fillOpacity: 1 }),
    layer("rivers", { color: "#1b3140", weight: 0.9, fill: false }),
  ]);
  // State codes at each state's centre, as a light reference when there are no tiles.
  L.geoJSON(feature(data, data.objects.subunits)).eachLayer((l) => {
    const f = (l as L.GeoJSON).feature as GeoJSON.Feature | undefined;
    const id = f?.id;
    if (typeof id !== "string") return;
    const center = (l as L.Polygon).getBounds().getCenter();
    group.addLayer(
      L.marker(center, {
        pane: "offline",
        interactive: false,
        keyboard: false,
        icon: L.divIcon({ className: "", html: `<span class="uf-label">${id.replace(/[^A-Z]/g, "")}</span>`, iconSize: [0, 0] }),
      }),
    );
  });
  return group;
}
