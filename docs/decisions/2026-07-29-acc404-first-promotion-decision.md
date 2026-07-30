<!-- markdownlint-disable MD013 -- evidence table rows and the machine-record summary line cannot wrap -->

# ACC-404 — First production promotion decision

Date: 2026-07-29
Slot: `forecast-primary`
Outcome: **MONITOR** (no promotion — evidence floors unmet)

## What was decided

The ACC-402 promotion gate was run against the installed app's real
shadow-ledger and calibration evidence (extracted read-only from the
production WKWebView localStorage) for all four challenger runs. No
challenger meets the 200-joined-pair evidence floor, so per the roadmap
("otherwise record REJECTED or continue MONITOR with the exact missing
evidence; a no-promotion result can complete this task") the first
evidence-backed decision is **MONITOR** for every challenger. Nothing
was promoted; the production forecast path is unchanged.

## Exact missing evidence

| Challenger | Run | Joined pairs | Floor | Gap |
|---|---|---|---|---|
| superforecast | superforecast-vs-baseline | 0 | 200 | comparisons carry no join keys yet — its producer must emit ShadowJoinKey (ACC-401 fields) before any evidence can accrue |
| hierarchical-base-rate | production-vs-hierarchical-base-rate | 14 | 200 | 87 raw comparisons, only 14 carry join keys (pre-ACC-401 rows never join); needs 186+ more joined resolved pairs |
| persistence-baseline | production-vs-persistence-baseline | 0 | 200 | zero comparisons recorded — the installed build predates/has not yet exercised the ACC-302/303 emission path |
| momentum-baseline | production-vs-momentum-baseline | 0 | 200 | zero comparisons recorded — same as persistence |

Safety evidence (no-new-regressions vs the committed replay baseline):
5/5 safety-critical fixtures match the accepted baseline — no new
safety regressions. (The catalog fixtures are intentionally-failing
historical-miss cases; the promotion gate consumes baseline-regression
evidence, never their raw pass rate — see
`safetyEvidenceFromBaselineRegression` in promotion-gate.ts.)

## Rollback tested against the installed app

The `champion_rollback` self-test probe (SystemDiagnostic → Self-Test)
runs `runChampionRollbackSelfTestFixture()` inside the shipped bundle:
setInitial → promote (fixture decision) → rollback on a fully isolated
in-memory ChampionRegistry, asserting the previous champion + version
are restored. It exercises the real registry code path in the installed
app without touching production state.

## Re-running this decision

```bash
npx tsx scripts/acc404-first-decision.mts <localstorage-export.json>
```

The export is a JSON map of localStorage keys to raw values (the script
header documents both the DevTools one-liner and the read-only sqlite
extraction). The gate thresholds, joins, and safety evidence all come
from the live modules — nothing is reimplemented.

## Full machine record

```json
{
  "record": {
    "schemaVersion": 1,
    "slot": "forecast-primary",
    "decidedAt": 1785382429048,
    "outcome": "MONITOR",
    "verdicts": [
      {
        "runId": "superforecast-vs-baseline",
        "challengerId": "superforecast",
        "verdict": "MONITOR",
        "evidenceCount": 0,
        "missingEvidence": [
          "0 joined resolved pairs (need \u2265 200)."
        ],
        "failingGates": []
      },
      {
        "runId": "production-vs-hierarchical-base-rate",
        "challengerId": "hierarchical-base-rate",
        "verdict": "MONITOR",
        "evidenceCount": 14,
        "missingEvidence": [
          "14 joined resolved pairs (need \u2265 200)."
        ],
        "failingGates": []
      },
      {
        "runId": "production-vs-persistence-baseline",
        "challengerId": "persistence-baseline",
        "verdict": "MONITOR",
        "evidenceCount": 0,
        "missingEvidence": [
          "0 joined resolved pairs (need \u2265 200)."
        ],
        "failingGates": []
      },
      {
        "runId": "production-vs-momentum-baseline",
        "challengerId": "momentum-baseline",
        "verdict": "MONITOR",
        "evidenceCount": 0,
        "missingEvidence": [
          "0 joined resolved pairs (need \u2265 200)."
        ],
        "failingGates": []
      }
    ],
    "summary": "No promotion into slot 'forecast-primary' \u2014 no challenger has met the evidence floors yet; continue monitoring. superforecast: MONITOR (0 pairs); hierarchical-base-rate: MONITOR (14 pairs); persistence-baseline: MONITOR (0 pairs); momentum-baseline: MONITOR (0 pairs)."
  },
  "safetyEvidence": {
    "safetyCriticalTotal": 5,
    "safetyCriticalPassed": 5
  },
  "rawCounts": [
    {
      "runId": "superforecast-vs-baseline",
      "comparisons": 0,
      "withJoinKey": 0
    },
    {
      "runId": "production-vs-hierarchical-base-rate",
      "comparisons": 87,
      "withJoinKey": 14
    },
    {
      "runId": "production-vs-persistence-baseline",
      "comparisons": 0,
      "withJoinKey": 0
    },
    {
      "runId": "production-vs-momentum-baseline",
      "comparisons": 0,
      "withJoinKey": 0
    }
  ],
  "resolvedCalibrationRecords": 356
}
```
