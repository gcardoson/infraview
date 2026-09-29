import type { Site } from "./api";

/* Sites used by the fictitious screens when the API has none registered yet. */
export const FALLBACK_SITES: Site[] = [
  {
    id: -1,
    code: "BR-ARC",
    name: "Planta Arcos",
    city: "Arcos",
    state: "MG",
    country: "Brasil",
    latitude: -20.2863,
    longitude: -45.5402,
    notes: null,
  },
  {
    id: -2,
    code: "BR-MAT",
    name: "Planta Matozinhos",
    city: "Matozinhos",
    state: "MG",
    country: "Brasil",
    latitude: -19.5543,
    longitude: -44.0868,
    notes: null,
  },
];
