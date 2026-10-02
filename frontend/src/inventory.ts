import { useCallback, useEffect, useMemo, useState } from "react";
import { type ClusterRecord, type RoomRecord, type Site, type TopologyRecord, api } from "./api";
import { useResource } from "./components/useResource";
import type { SiteTopology } from "./topology/data";

/* A stored topology as the drawing code uses it: the site gives the code, the record the header. */
export function toSiteTopology(record: TopologyRecord, site: Site): SiteTopology {
  return {
    ...record.document,
    siteId: site.id,
    recordId: record.id,
    code: site.code,
    name: record.name,
    city: record.city ?? site.city ?? "",
    revision: record.revision ?? "",
    date: record.date ?? "",
    author: record.author ?? "",
    annotations: record.document.annotations ?? [],
  };
}

/* Sites with their rooms, topologies and clusters, loaded together for the screens that combine them. */
export function useInventory() {
  const sites = useResource(useCallback(() => api.sites.list(), []));
  const rooms = useResource(useCallback(() => api.rooms.list(), []));
  const topologyRecords = useResource(useCallback(() => api.topologies.list(), []));
  const clusters = useResource(useCallback(() => api.clusters.list(), []));

  const topologies = useMemo(
    () =>
      topologyRecords.items.flatMap((record) => {
        const site = sites.items.find((s) => s.id === record.site_id);
        return site ? [toSiteTopology(record, site)] : [];
      }),
    [topologyRecords.items, sites.items],
  );
  const reload = useCallback(() => {
    sites.reload();
    rooms.reload();
    topologyRecords.reload();
    clusters.reload();
  }, [sites.reload, rooms.reload, topologyRecords.reload, clusters.reload]);

  const loading = sites.loading || rooms.loading || topologyRecords.loading || clusters.loading;
  // After the first load, reloads keep showing the current data instead of flashing "loading".
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!loading) setReady(true);
  }, [loading]);

  return {
    sites: sites.items,
    rooms: rooms.items as RoomRecord[],
    topologyRecords: topologyRecords.items as TopologyRecord[],
    topologies,
    clusters: clusters.items as ClusterRecord[],
    loading: !ready,
    error: sites.error ?? rooms.error ?? topologyRecords.error ?? clusters.error,
    reload,
  };
}
