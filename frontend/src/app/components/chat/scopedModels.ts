import type { AIModel } from "@/types";
import type { KeyModelsEntry } from "@/hooks/useChatKeys";

/**
 * Scope-correct model union shared by the composer label/validation and the
 * Intelligence panel: personal registry rows plus every key's eligible models
 * (full ModelRead rows, same shape). Org models never appear in the personal
 * registry listing, so every id lookup must use this union — never the
 * registry alone. On id clashes the key row wins (fresher eligibility data
 * for the same backend model read).
 */
export function buildScopedModels(registry: AIModel[], keyEntries: KeyModelsEntry[]): AIModel[] {
  const byId = new Map(registry.map((m) => [m.id, m]));
  for (const entry of keyEntries) {
    for (const km of entry.models ?? []) byId.set(km.id, km);
  }
  return [...byId.values()];
}

/** The persisted/selected model resolved through the same union the label shows. */
export function findScopedModel(scopedModels: AIModel[], modelId: string | null): AIModel | null {
  if (!modelId) return null;
  return scopedModels.find((m) => m.id === modelId) ?? null;
}

/**
 * The key that can serve the model — the persisted/current key when it
 * serves it, else the first serving key. Skips disabled keys, errored
 * entries, and entries whose models are still loading (undefined): while any
 * of those hold there is no serving key *yet*, which is distinct from "no key
 * serves this model". Never clears anything; callers set, never reset.
 */
export function findServingKeyEntry(
  keyEntries: KeyModelsEntry[],
  modelId: string,
  preferredKeyId: string | null = null,
): KeyModelsEntry | null {
  const serves = (e: KeyModelsEntry) =>
    e.key.enabled && !e.error && (e.models ?? []).some((m) => m.id === modelId);
  if (preferredKeyId) {
    const preferred = keyEntries.find((e) => e.key.id === preferredKeyId);
    if (preferred && serves(preferred)) return preferred;
  }
  return keyEntries.find(serves) ?? null;
}
