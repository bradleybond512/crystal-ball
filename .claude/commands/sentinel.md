Generate a sentinel intelligence sweep. This is designed to run on a schedule (every 30 minutes) but can also be run manually.

## Execution Steps

1. **Gather current intelligence** — Call these MCP tools in parallel:
   - `get_sitrep`
   - `get_threat_landscape`
   - `get_market_overview`
   - `get_cyber_intel`

2. **Check for previous snapshot** — Use `query_raw` with endpoint `/api/service-status` to confirm sidecar is alive. Then read `~/.crystal-ball/sentinel/latest-snapshot.json` (if it exists).

3. **Diff against previous** — Compare the current results to the previous snapshot. For each domain, identify:
   - **New items**: events, threats, or data points not in the previous snapshot
   - **Disappeared items**: things present before but gone now
   - **Significant changes**: notable shifts in values (market moves >1%, new conflict events, new CVEs)

4. **Assign severity** to each change:
   - `critical`: War mode triggers (>=2 conflicts >0.6 confidence), M7+ earthquakes, market crashes >5%
   - `high`: New armed conflicts, new CISA KEVs, market moves >2.5%
   - `medium`: Trend changes, new conflict events in any region, new threat intel
   - `low`: Minor data updates, routine changes

5. **Write outputs**:
   - Save current results to `~/.crystal-ball/sentinel/latest-snapshot.json` (overwrite)
   - Copy previous snapshot to `~/.crystal-ball/sentinel/history/YYYY-MM-DD-HHmm.json`
   - Append new alerts to `~/.crystal-ball/sentinel/alerts.json` with format:
     ```json
     {"timestamp": "ISO", "domain": "conflicts|markets|cyber|weather", "severity": "critical|high|medium|low", "summary": "one-line", "details": {}, "source": "sentinel"}
     ```
   - Prune history files older than 7 days

6. **Report** — Output a concise summary:
   - Number of new alerts by severity
   - Top 3 most significant changes
   - "No significant changes detected" if the diff is clean

If no previous snapshot exists (first run), save the current snapshot and report "First sentinel run — baseline established. No diff available."

If the sidecar is not running, report the error and do not write any files.
