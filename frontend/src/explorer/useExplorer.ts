import { useCallback, useMemo } from "react";
import { api } from "../api";
import { useResource } from "../components/useResource";
import { FALLBACK_SITES } from "../fictitious";
import { buildExplorer, useExplorerSimulation } from "./data";

/* Registered sites (or the fallback ones) turned into the fictitious explorer model, with live sensors. */
export function useExplorer() {
  const sites = useResource(useCallback(() => api.sites.list(), []));
  const source = useMemo(
    () => (sites.loading ? [] : sites.items.length ? sites.items : FALLBACK_SITES),
    [sites.loading, sites.items],
  );
  const base = useMemo(() => buildExplorer(source), [source]);
  const explorer = useExplorerSimulation(base);
  return { sites, source, explorer };
}
