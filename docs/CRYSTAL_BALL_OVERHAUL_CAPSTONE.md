# Crystal Ball Overhaul — Capstone Index

> Master index for the overhaul program. Authored in Opus 4.8. This copy is
> **reconciled against what actually exists in the `crystal-ball` repo** — the
> program was specced against a smaller Rust/React entity-tracking app, and only
> the waves that fit this TypeScript/DeckGL intelligence dashboard are
> implemented here.

---

## 0. Status in this repo (read first)

| Wave | Program intent | Status in `crystal-ball` | Where |
| --- | --- | --- | --- |
| **1** | Fusion / POL / kinematic prediction / agentic LLM | Pre-existing analogues across `src/services/` (fusion, pattern-of-life, providers, claude-agent) | — |
| **1.5** | Measurement spine: replay + Brier/CRPS | ✅ **Shipped** — scoring math `proper-scoring.ts`; replay harness already existed (`ops/replay-harness.ts`) | this branch |
| **2** | IMM tracker + GNN + lifecycle | ⛔ **Deferred / N/A** — no Rust tracker, `nalgebra`, Kalman baseline, detections, or track-truth here | `CRYSTAL_BALL_WAVE_2_ESTIMATION_CORE.md` |
| **3** | Goal-conditioned multimodal prediction (Valhalla) | ⛔ **Deferred / N/A** — no Valhalla / entity trajectories here; `crpsEnsemble` exists to score mixtures if it ever lands | — |
| **4** | Full calibration + self-eval | ✅ **4a shipped** — Wilson bands, equal-mass bins, PIT, `buildCalibrationReport`; 4b surface = existing `MetaConfidenceCalibrationPanel`; energy-score/censored/recalibration deferred | this branch |
| **5** | Decision-theoretic alert prioritization | ✅ **Shipped** — `alert-prioritization.ts` (expected-impact × calibrated-prob × time-criticality) + `alert-whatif.ts` (counterfactual queue mutation + act-by clock advance); dedup/fatigue already existed | this branch |
| **6** | LLM reasons over verified state | ✅ **Kernel shipped** — `kent-hedging.ts` (enforced estimative-probability scale + calibration meta-hedge + mechanical hedge-verification gate). Tool layer / local-model sidecar / claim-grounding extend the existing reasoning layer (`analyst-loop`, `hypothesis-*`, `llm-adapter`) and are deferred | this branch |
| **7** | Honest uncertainty viz + temporal scrubbing | ◻️ Pre-existing globe/timeline surfaces (`playback/`, globe overlays); net-new GPU path only if measured need | — |

**Net shipped on this branch (PR #1233):** the calibration-and-decision spine —
Waves **1.5 + 4a + 5** — as pure, fixture-tested `src/services/intelligence/`
modules (~83 unit tests), each building on the prior: Wave 5 consumes Wave 4's
calibration to de-bias overconfident sources before they compete for attention.

The original capstone follows.

---

## 1. The vision, restated

"The most high-tech predictive dashboard that exists" — reframed: **high-tech is
a side effect of trust.** The goal is the most *trustworthy and self-validating*
predictive system in its class, fully local. The sentence that is the whole
program: *"my 24h CPA calls have been 73% accurate over the last 200 events, and
here's where I'm unreliable."*

## 2. Dependency graph & critical path

```
Wave 1 ──► Wave 1.5 (spine) ──► Wave 2 (tracker) ──► Wave 3 (prediction)
              │                     │                    │
              └─────────────────────┴────────────────────┴──► Wave 4 (calibration)
                                                                  │
                                                                  ▼
                                                            Wave 5 (alerts)
                                                                  │
                                                                  ▼
                                                            Wave 6 (reasoning)
                                                                  │
                                                                  ▼
                                                            Wave 7 (visualization)
```

Non-obvious ordering: **spine before everything** (no upgrade is "better"
without it); **tracker before prediction** (GIGO); **calibration before
decisions** (expected-utility math is wrong on miscalibrated probabilities —
Wave 4 gates Wave 5); **everything before reasoning and viz** (they render the
rest). In this repo the tracker/prediction legs (2, 3) are N/A, so the realized
path is 1.5 → 4 → 5.

## 3. The through-lines

1. **The measurement spine is the backbone, not a feature** — every wave gated
   by the scoreboard; "better" is a measured claim or it doesn't ship.
2. **Calibration is the through-line** — 70% means 70%, and the system knows
   where it isn't.
3. **Show the failures** — every surface earns trust by being honest about its
   limits; overconfidence theater is the enemy at every layer.
4. **Persistent objects, not events** — tracks (2) and alerts (5) are objects
   with identity and a lifecycle that update, not fresh events each tick.
5. **Physics/Bayesian first, learned second** — no learned component before the
   spine has data to train and validate it, and it must beat the model-based
   baseline on the scoreboard.
6. **The truth-availability fork** — learn where ground truth/corroboration
   exists; fall back to consistency checks and static priors where it doesn't.
   Be explicit about which world each component is in.
7. **Fully local is the identity** — no cloud prediction, no remote inference.

## 4. Cross-cutting systems & performance

Rust hot path; per-layer latency budgets (ingest → estimate → predict → score →
alert → render); Valhalla call budgeting (Wave 3); unified-memory coexistence
for the local LLM (Wave 6); GPU compute only on measured need (Waves 4/7);
SQLite/SQLCipher tuning for spine volume. *(These target the native tracking
app; the pure-TS services shipped here are allocation-light and DOM/fetch-free
by construction.)*

## 5. Workflow (model split)

Opus plans, Sonnet implements. Per wave: Opus specs → contracts micro-pass →
parallel subagents → integrate → the spine scores it → if green, the next wave.

## 6. Program-level definition of done

For any watched situation, an operator can on one honest, fully-local surface:
**see** maneuver-aware multi-target tracks and genuinely different weighted
futures; **know** how uncertain each prediction is, rendered honestly; **trust
calibrated** track-record per type and version, with failures flagged; **attend**
to only the few prioritized, deduplicated, fatigue-controlled things that matter,
each with an act-by deadline and a traceable why; **ask** the reasoning layer and
get fluent *and* faithful, calibration-hedged answers; **scrub** the timeline to
see prediction-vs-reality including the misses. Underneath: every layer measured,
"better" always a number.

## 7. Recommended against (the discipline)

GLMB / research-grade multi-target tracking (skip until the scoreboard proves
association is the bottleneck); premature learned models (physics first);
UKF up front (only when fixed-ω IMM proves too coarse); alert maximalism (fewer
calibrated alerts beat a firehose); overconfidence theater anywhere.

## 8. Where to start

Land Wave 1 → build the spine (1.5) → down the critical path, each gated by the
scoreboard. In this repo the buildable remainder is: round out Wave 5
(counterfactual what-if on `counterfactual-replay.ts`), and Wave 6 grounding-gate
work over the existing reasoning layer. Waves 2–3 require the separate tracking
app.

---

*Nine documents, one spine, one discipline: measure everything, show the
failures, and let "better" always be a number.*
