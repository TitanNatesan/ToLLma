// Syncs the provider roster + logos from models.dev.
// API catalog:  https://models.dev/api.json  (keyed by provider id)
// Logo per provider: https://raw.githubusercontent.com/sst/models.dev/main/providers/<id>/logo.svg
//
// Writes:
//   src/data/models-dev.json      — [{ mdId, tollmaId, name, models, api, logo }]
//   public/models-dev/<id>.svg    — provider logos (vendored, so the static
//                                   export serves them locally — no runtime
//                                   dependency on GitHub, no 6MB download).
//
// Usage: npm run sync:providers
// On fetch failure the existing snapshot is left untouched (exit 1).
import { mkdirSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const API_URL = process.env.MODELS_DEV_URL || "https://models.dev/api.json";
const LOGO_URL = (id) =>
  `https://raw.githubusercontent.com/sst/models.dev/dev/providers/${id}/logo.svg`;
// models.dev provider id -> our gateway adapter id (site.ts PROVIDERS).
// Mapped adapters show our API-surface label in the wall ("as like now").
const MAP = {
  openai: "openai",
  anthropic: "anthropic",
  google: "gemini",
  "google-vertex": "vertex",
  "amazon-bedrock": "bedrock",
};

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const logoDir = join(root, "public", "models-dev");
mkdirSync(logoDir, { recursive: true });

const res = await fetch(API_URL);
if (!res.ok) {
  console.error(`sync-models-dev: catalog fetch failed (${res.status}); snapshot untouched.`);
  process.exit(1);
}
const catalog = await res.json();
const ids = Object.keys(catalog);

// Logos in batches (polite concurrency). Skips files already vendored.
const BATCH = 25;
const haveLogo = new Set();
for (let i = 0; i < ids.length; i += BATCH) {
  const batch = ids.slice(i, i + BATCH);
  const results = await Promise.allSettled(
    batch.map(async (id) => {
      const dest = join(logoDir, `${id}.svg`);
      try {
        await readFile(dest, "utf8");
        return { id, cached: true };
      } catch {}
      const r = await fetch(LOGO_URL(id));
      if (!r.ok) throw new Error(`${id}: ${r.status}`);
      const svg = await r.text();
      if (!svg.includes("<svg")) throw new Error(`${id}: not SVG`);
      writeFileSync(dest, svg);
      return { id, cached: false };
    })
  );
  for (const r of results) {
    if (r.status === "fulfilled") {
      haveLogo.add(r.value.id);
    } else console.error(`sync-models-dev: logo miss — ${r.reason.message}`);
  }
}

const shortApi = (api) => {
  if (!api || api.includes("${")) return null;
  return api.replace(/^https?:\/\//, "").slice(0, 30);
};
const providers = ids.map((mdId) => {
  const entry = catalog[mdId];
  return {
    mdId,
    tollmaId: MAP[mdId] ?? null,
    name: entry.name,
    models: Object.keys(entry.models ?? {}).length,
    api: shortApi(entry.api),
    // null when models.dev ships no logo for the provider (tile renders
    // a lettermark fallback instead of a broken image).
    logo: haveLogo.has(mdId) ? `/models-dev/${mdId}.svg` : null,
  };
});
const snapshot = {
  source: "https://models.dev/api.json",
  logos: "https://github.com/sst/models.dev/tree/dev/providers",
  syncedAt: new Date().toISOString().slice(0, 10),
  providers,
};
writeFileSync(join(root, "src", "data", "models-dev.json"), JSON.stringify(snapshot, null, 2) + "\n");
console.log(`sync-models-dev: ${providers.length} providers, ${haveLogo.size} logos vendored -> src/data/models-dev.json`);
