# Wave 2 — Estimation Core (IMM + Association + Track Lifecycle)

> **STATUS: BLOCKED / DEFERRED for the `crystal-ball` repository.**
>
> This spec is captured for reference and for a future target where a kinematic
> tracker exists. It is **not** implemented here, by deliberate decision.

---

## ⛔ Why this is not implemented in this repo

This Wave 2 spec assumes a Rust real-time multi-target tracking codebase. A scan
of `crystal-ball` (2026-06-19) found **none of its prerequisites**:

| Wave 2 prerequisite | State in `crystal-ball` |
| --- | --- |
| Existing single Kalman filter to reuse as the CV mode | **Absent** — the only "kalman" string in `src/` is a doc comment in `intelligence/proper-scoring.ts` |
| Rust tracking crate (`crystal_ball::tracking`) | **Absent** — only Rust is the Tauri shell (`src-tauri/src/main.rs` keychain/secrets, `corelocation.rs`) |
| `nalgebra` (linear algebra) | **Absent** from every `Cargo.toml` / `.rs` |
| Detection feed (measurements over time) | **Absent** — this app ingests domain feeds (weather, seismic, ADS-B aggregates, markets…), not raw kinematic detections |
| Ground-truth tracks for OSPA/GOSPA/RMSE, or detections for NIS/NEES | **Absent** — no track fixtures exist |

It also contradicts the decision recorded in
`docs/CRYSTAL_BALL_OVERHAUL_ROADMAP.md` §7.1:

> **Tracking altitude → DEFERRED / N/A.** This app has no radar-style real-time
> kinematic target tracker, so Wave 2's IMM / GNN / JPDA / GLMB math does not map
> onto the current architecture.

Implementing it here would mean inventing the tracker, its detection feed, and
its truth data from scratch — large net-new scope with no baseline to beat,
which is precisely the "premature research-grade tracking / overconfidence
theater" the roadmap's anti-patterns section warns against.

## ✅ What would unblock it

One of:

1. **A different target repo** — the "World Monitor"-style Rust app the roadmap
   modeled (single Kalman + Valhalla + detections). Re-scope this spec there.
2. **An explicit, scoped decision** to first build, in this repo, (a) a detection
   ingestion path, (b) a baseline single-Kalman tracker, and (c) replay fixtures
   with either ground-truth tracks (OSPA path) or raw detections (NIS path) —
   *then* this wave has something to replace and a scoreboard to beat.

Until then, the in-repo analogue of "make estimates better and prove it" is the
forecast/alert **calibration** spine that already exists and that this session
extended (`intelligence/proper-scoring.ts`: Brier + CRPS + reliability/ECE).

---

## Original spec (verbatim, for the future target)

**Acceptance gate:** the new tracker must beat the single-Kalman baseline on the
spine's scoreboard, or it doesn't ship.

### A. Refinement to the roadmap

Start with a fully-linear IMM bank — no UKF yet. A coordinated-turn model with a
*known, fixed* turn rate ω is linear in the state, so the whole bank stays
linear-Gaussian and runs as plain Kalman filters. v1 bank =
`{CV-low-noise, CT(+ω₀), CT(−ω₀)}`, optionally a high-noise CV "maneuver" mode.
Estimated-ω CT (UKF) is a deferred upgrade. Trackers cannot be tuned on
prediction scores alone — extend the spine with direct tracking metrics
(Agent E), choosing the truth-available (OSPA/GOSPA/RMSE) or truth-free
(NIS/NEES consistency) path depending on whether replay data has labeled truth.

### B. Design rules

1. Reuse the existing Kalman filter as the CV mode (continuity, not a rewrite).
2. Filter in a local ENU frame, in meters (project lat/lon → tangent plane).
3. Same code path, live and replay.
4. Bump `model_version` (how the spine proves IMM beats single-Kalman).
5. GNN before JPDA.

### C. Shared contracts (Wave 2-0 micro-pass, lands first)

`MotionModel` (transition `F(dt)` + `process_noise Q(dt)`), `ModeFilter`
(`predict` / `update`→Λ / `state` / `set_state`), `ImmEstimator`
(`step(z, dt)` / `combined` / `mode_probs`), `TrackStatus`
(Tentative{hits,misses} / Confirmed / Coasting{since}), `Track`
(id, estimator, status, model_version), `Associator`
(`associate(tracks, meas) -> Assignment`). Spine extension:
`TrackingMetricRow { model_version, kind: ospa|gospa|rmse_pos|rmse_vel|nis,
value, scored_at }` + `tracking_metrics` table.

### D. IMM cycle (Agent B)

Per step over `r` modes with TPM Π:
1. **Mixing:** `c̄_j = Σ_i π_ij μ_i`; `μ_{i|j} = π_ij μ_i / c̄_j`; mixed IC
   `x̂_0j = Σ_i x̂_i μ_{i|j}`, `P_0j = Σ_i μ_{i|j}[P_i + (x̂_i−x̂_0j)(…)ᵀ]`.
2. **Mode-matched filtering:** each filter predict+update from mixed IC → `x̂_j,
   P_j, Λ_j`.
3. **Mode update:** `μ_j = c̄_j Λ_j / Σ_l c̄_l Λ_l`.
4. **Combination (output only):** `x̂ = Σ_j μ_j x̂_j`, `P = Σ_j μ_j[P_j +
   (x̂_j−x̂)(…)ᵀ]`.

Gotchas: TPM diagonal ~0.90–0.95; spread the per-mode process noise (CV low, CT
moderate, maneuver/CA high); floor mode probabilities away from 0; work in
log-likelihood; coast on missed detection (predict-only, inflate covariance, no
mode update).

### E. Association / gating / lifecycle (Agents C & D)

- **Gating (C):** χ² ellipsoidal gate on innovation via `S`; gate prob ≈ 0.99,
  DOF = measurement dim.
- **GNN (C):** cost matrix of gated Mahalanobis distances → Hungarian/auction,
  hard one-to-one. Document the crossing-target identity-swap failure as the
  future JPDA trigger.
- **Lifecycle (D):** unassociated meas seed tentative tracks (2/3-point init for
  velocity); M-of-N confirmation; coast (predict-only, inflate) on miss; delete
  after K consecutive coasts. (Track-score / SPRT / IPDA deferred.)

### F. Subagent briefs

- **A — Motion-model bank + ENU frame** 🟢 *(foundational)*: CV, CT(±ω₀),
  optional high-noise CV/CA, lat/lon↔ENU projection. Existing Kalman → CV mode.
- **B — IMM estimator** 🟢 *(after A)*: the 4-step cycle, TPM, mode-prob
  tracking, coast handling.
- **C — Gating + GNN association** 🟢: χ² gating + Hungarian/auction.
- **D — Track lifecycle manager** 🟢 *(integrates with C)*: init → M-of-N
  confirm → coast → coast-count delete.
- **E — Spine tracking-metrics extension** 🟢: `model_version`-aware OSPA/GOSPA +
  RMSE (truth path) or NIS/NEES consistency + prediction-score proxy (truth-free).

### G. Definition of done

IMM + GNN + lifecycle replaces single-Kalman on one code path (live + replay);
spine shows the new `model_version` beats single-Kalman on RMSE/OSPA (truth) or
NIS-consistency + prediction scores (truth-free); mode probs behave on maneuver
onset; tracks initiate/confirm/coast/delete correctly. If the gate isn't
cleared, it doesn't ship.

### H. Deferred

JPDA (when GNN identity-swaps hurt) · UKF estimated-ω CT (when fixed-ω too
coarse) · track-score/SPRT/IPDA lifecycle · GLMB (skip unless association is
provably the bottleneck).

### I. Dispatch order

1. Contracts micro-pass (§C) — compile clean.
2. Parallel: A, C, E.
3. B after A; D alongside C against the `Associator` contract.
4. Integration → spine comparison → if green, proceed to Wave 3 (intent-aware +
   multimodal prediction).
