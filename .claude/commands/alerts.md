Check and manage Crystal Ball alerts — view triggered alerts, clear history, adjust filters.

## Usage

`/alerts` — show current alerts from sentinel, sorted by severity
`/alerts check` — run all alert rules against live data right now
`/alerts clear` — clear the alerts file
`/alerts --severity high` — filter to high+ severity only

## Execution

1. **No args or default** — Read `~/.crystal-ball/sentinel/alerts.json`. Present alerts grouped by severity (critical first, then high, medium, low). Show timestamp, domain, and summary for each.

2. **check** — Call the `alert_check` MCP tool. Present triggered rules with current values vs thresholds.

3. **clear** — Write an empty array to `~/.crystal-ball/sentinel/alerts.json`. Confirm with count of cleared alerts.

4. **--severity filter** — Only show alerts at or above the specified severity level. Severity order: critical > high > medium > low.

## Format

Present alerts as a concise table:

| Severity | Domain   | Time  | Summary                        |
|----------|----------|-------|--------------------------------|
| CRITICAL | markets  | 08:30 | S&P 500 dropped 3.1%           |
| HIGH     | cyber    | 09:00 | 3 new CISA KEVs published      |

If no alerts, report "All clear — no alerts since last sentinel run."
