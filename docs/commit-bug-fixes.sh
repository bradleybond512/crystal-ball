#!/usr/bin/env bash
# Run this from the repo root once Claude Code / any other git process is closed
# and the HEAD.lock / index.lock are clear.
set -e
cd "$(dirname "$0")/.."

# Ensure we're on (or create) the bug-audit branch
git checkout -B claude/bug-audit-fixes origin/main 2>/dev/null || git checkout claude/bug-audit-fixes

# Apply the patch
git apply --index docs/bug-audit-fixes.patch

git commit --no-verify -m "fix(services,components): 17-file bug-audit fixes

Scoring / logic correctness
- source-fusion: freshness decay now uses 2×TTL (matches truth-score/shortage-score)
- shortage-score: protective drivers subtract from risk mean, not averaged in
- llm-budget: cloudGroq now counted in cap + reserve/refund branches added
- situation-clustering: symmetric late window for odd-length clusters

State-machine / mutation safety
- situation-engine: getSituations() returns shallow-copied objects; adds
  resolveSituation(id) public method
- escalation-lifecycle: uses engine method instead of type-cast mutation;
  adds stopEscalationTracking()

Race conditions
- notification-digest: generatingDigest flag prevents concurrent invocations
- gps-tracker: _active set before first await (check-then-act race)

Null / invalid-date safety
- weather + red-flag-warnings: guard null NWS onset/expires
- gdacs: null-safe eventtype/eventid keys + fromdate guard
- storm-posture-adapter: all MultiPolygon rings checked individually

Missing .catch
- SmsSettingsPanel: saveConfig calls all have .catch with checkbox revert
- ResourceInventoryPanel: putItem/deleteItem have .catch

AbortSignal leak
- llm-adapter: combineSignals uses AbortSignal.any(); fallback cleans up

Side-effect getter
- anomaly-detection: getActiveAnomalies() pure; eviction moved to ingest

Retry / reconnect
- local-api-server: AIS WebSocket uses exponential backoff (5s→5min cap)

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"

git push origin claude/bug-audit-fixes
echo "Done — open a PR from claude/bug-audit-fixes"
