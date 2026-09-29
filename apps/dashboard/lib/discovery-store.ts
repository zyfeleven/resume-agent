import { createJsonStore } from "./local-store";
import { defaultDiscoveryConfig, DiscoveryStoreSchema, type DiscoveryStore } from "./discovery-model";

export function emptyDiscoveryStore(): DiscoveryStore {
  return { version: 1, config: structuredClone(defaultDiscoveryConfig), jobs: [], tasks: [], runs: [], decisions: [], assessments: [], sourceSearch: null };
}
const store = createJsonStore({ fileName: "discovery-store.json", schema: DiscoveryStoreSchema, empty: emptyDiscoveryStore });
export const readDiscoveryStore = store.read;
export const updateDiscoveryStore = store.update;
