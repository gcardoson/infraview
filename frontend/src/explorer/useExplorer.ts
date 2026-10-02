import { useMemo } from "react";
import { useInventory } from "../inventory";
import { buildExplorer, useExplorerSimulation } from "./data";

/* Registered sites with their rooms and drawings, turned into the explorer model with live sensors. */
export function useExplorer() {
  const inventory = useInventory();
  const base = useMemo(
    () => (inventory.loading ? [] : buildExplorer(inventory.sites, inventory.rooms, inventory.topologies)),
    [inventory.loading, inventory.sites, inventory.rooms, inventory.topologies],
  );
  const explorer = useExplorerSimulation(base);
  return { inventory, explorer };
}
