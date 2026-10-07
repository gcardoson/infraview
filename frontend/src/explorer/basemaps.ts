import L from "leaflet";
import type { Theme } from "../theme";
import type { GeometryCollection, Topology } from "topojson-specification";
import southAmericaUrl from "sane-topojson/dist/south-america_50m.json?url";

/*
 * Free, public tile services that need no API key. CARTO was dropped: its basemaps now answer with an
 * "API KEY REQUIRED" image, which loads fine and so can't be detected as a failure. They are tried in order: if one can't be reached
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
  /* Optional transparent layer with place names drawn over the base. */
  labels?: string;
  /* OpenStreetMap only has a light style; a CSS filter darkens it to match the dark interface. */
  darken?: boolean;
  /* The same service's light style, used with the light theme. */
  light?: { label: string; url: string; labels?: string };
}

const OSM = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';
const ESRI_URL = "https://server.arcgisonline.com/ArcGIS/rest/services";
const ESRI = 'Tiles &copy; <a href="https://www.esri.com/">Esri</a>';

export const BASEMAPS: Basemap[] = [
  {
    id: "esri-dark",
    label: "Escuro (Esri)",
    url: `${ESRI_URL}/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}`,
    labels: `${ESRI_URL}/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}`,
    light: {
      label: "Claro (Esri)",
      url: `${ESRI_URL}/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}`,
      labels: `${ESRI_URL}/Canvas/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}`,
    },
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
    url: `${ESRI_URL}/World_Imagery/MapServer/tile/{z}/{y}/{x}`,
    labels: `${ESRI_URL}/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}`,
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

/* The basemap as the current theme shows it. */
export const themed = (b: Basemap, theme: Theme): Basemap => (theme === "light" && b.light ? { ...b, ...b.light } : b);

export function tileLayer(b: Basemap) {
  return L.tileLayer(b.url, {
    maxZoom: 19,
    maxNativeZoom: b.maxZoom,
    subdomains: b.subdomains ?? "abc",
    attribution: b.attribution,
    className: b.darken ? "tiles-darken" : "",
  });
}

export function labelsLayer(b: Basemap) {
  return b.labels ? L.tileLayer(b.labels, { maxZoom: 19, maxNativeZoom: b.maxZoom, zIndex: 2 }) : null;
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
  // Colours come from the stylesheet (.offline-*), so they follow the theme.
  const layer = (name: Layers, style: L.PathOptions) =>
    L.geoJSON(feature(data, data.objects[name]), { interactive: false, pane: "offline", style: () => ({ ...style, className: `offline-${name}` }) });
  const group = L.layerGroup([
    layer("countries", { weight: 0.9, fillOpacity: 1 }),
    layer("subunits", { weight: 0.8, fillOpacity: 1 }),
    layer("lakes", { stroke: false, fillOpacity: 1 }),
    layer("rivers", { weight: 0.9, fill: false }),
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
