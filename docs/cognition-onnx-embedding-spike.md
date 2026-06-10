# ONNX Embedding Middle Tier — Feasibility Spike

> PR 14 deliverable — spike only, no runtime code.
> Status: SPIKE_COMPLETE — recommendation: defer until bundle-size gate evidence
> Last updated: 2026-06-10

## What this is

PR 14 calls for evaluating an ONNX-hosted embedding model (e.g. all-MiniLM-L6-v2
quantised to int8, ~25 MB) as a middle tier between the Ollama neural path and the
hashed bag-of-words fallback. This doc records the findings from that evaluation.

## The existing tiers

| Tier | Path | Quality | Offline? | Dim |
|------|------|---------|----------|-----|
| neural | POST /api/intel-embed → Ollama nomic-embed-text | High | No (sidecar required) | 768 |
| **onnx (proposed)** | **ml-worker.ts → ONNX runtime → model from public/** | **Medium-High** | **Yes** | **384** |
| hashed | embedHashed() djb2 bag-of-words | Low | Yes | 256 |

## Feasibility

**Runtime infrastructure: already present.** `ml-worker.ts` runs `@xenova/transformers`
pipelines via ONNX Runtime Web in a Web Worker. `MODEL_CONFIGS` in
`@/config/ml-config` lists models by `hfModel` string (e.g. `Xenova/all-MiniLM-L6-v2`).
Adding a new entry would expose the model to the same load/embed pipeline already
wired for summarization and NER.

**Bundle-size constraint: CI-enforced.** The bundle-size check script
(`scripts/check-bundle-size.mjs`) enforces limits per chunk. The model itself
must NOT be bundled — it must load from `public/models/` at runtime (same pattern
as `env.allowLocalModels`-style model caching). The JS for the inference pipeline
is already in the `onnxruntime` and `transformers` chunks; no new chunk is needed.

**Model size: 25 MB at int8.** `all-MiniLM-L6-v2` int8 from Hugging Face is
~24 MB. Downloaded once by `@xenova/transformers` and cached in the browser's
OPFS / Cache Storage. The workbox service worker config in `vite.config.ts` already
`globIgnores: ['**/onnx*.wasm']`, so WASM binaries are excluded from SW precache —
the same exclusion would apply to the model files. On first use there is a 24 MB
network fetch; subsequent uses are served from browser cache.

**Vector dimension mismatch.** The hashed tier is 256-dim; Ollama nomic-embed-text
is 768-dim; all-MiniLM-L6-v2 is 384-dim. All three are incompatible with each other.
`vector-index.ts` already partitions by tier (hashed vs neural). Adding a third
tier requires extending the `IndexedVector.tier` union to include `'onnx'` and
adding a third partition bucket. This is mechanically straightforward but means
three separate vector spaces in the episode store — episodes cannot be cross-compared
across tiers, which limits cluster formation when the three tiers are mixed over time.

**Migration concern.** Existing episodes are stored with `tier: 'hashed'` or
`tier: 'neural'`. Introducing `'onnx'` creates a third incompatible space. The
lazy re-embed-on-access pattern (max 20 per session, see `maybeUpgradeEmbedding`)
would need to grow to handle hashed→onnx upgrades. A two-stage migration
(hashed→onnx, onnx→neural if Ollama ever appears) adds complexity and state.

## Recommendation

**Defer.** The ONNX middle tier is technically feasible with no new runtime
dependencies, but the cost/benefit is unfavourable at this stage:

1. **The hashed fallback already works offline.** Cosine similarity over hashed
   bag-of-words vectors correctly routes Black Sea / wheat / escalation episodes
   to similar queries in the test suite. Recall@5 precision on hashed vectors is
   adequate for the ±20% analog score influence on forecasts.

2. **The 24 MB first-load penalty hurts web users.** Crystal Ball's web build
   is designed for fast first paint. A 24 MB deferred fetch on the first embed
   call degrades the experience for users who don't have Ollama running.

3. **Three vector spaces in one store is operationally risky.** Clusters formed
   in the hashed space cannot merge with onnx-tier episodes. The episode store
   after a tier upgrade would contain three incompatible populations. Clean
   migration is deferred until a future plan with a versioned store format.

4. **Bundle-size CI gate must be validated first.** The gate is real but the
   exact headroom above the current limit is not measured in this spike. Doing
   so requires running `npm run bundle:check` after adding the model config and
   verifying no chunk exceeds its limit.

## Estimated effort if approved

- `@/config/ml-config`: add entry `{ id: 'cognition-embed', hfModel: 'Xenova/all-MiniLM-L6-v2', task: 'feature-extraction', ... }` — 1 h.
- `ml-worker.ts`: add `embed-cognition` message type, 384-dim result path — 2 h.
- `embedding-provider.ts`: add `tryOnnxEmbedding()` between neural and hashed; extend `EmbeddingResult.tier` to `'neural' | 'onnx' | 'hashed'` — 2 h.
- `vector-index.ts`: extend tier partition to `'onnx'` — 30 min.
- Migration: extend `maybeUpgradeEmbedding()` to handle hashed→onnx — 2 h.
- Tests: add onnx-tier fixtures (mock the worker result) — 2 h.
- Bundle-size validation + service-worker exclusion check — 1 h.
- **Total: ~10–11 h engineering + PR review.** Gated on: (a) bundle-size headroom confirmed, (b) decision that 24 MB first-load cost is acceptable for the target use case.

## Revisit trigger

Re-evaluate when: (a) Ollama adoption among desktop users is measured and found
to be < 30% (i.e., most users are on hashed tier and recall quality is a real
gap), OR (b) the embedding store gets a versioned migration path (store-v2),
OR (c) the bundle-size limit is raised or the model is served from a CDN with
range-request support so it can be streamed in the background.
