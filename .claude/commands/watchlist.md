Manage Crystal Ball watchlists — track IPs, tickers, regions, CVEs, vessels, or callsigns.

## Usage

`/watchlist` — list all watchlists and their item counts
`/watchlist create <name> <type> <items...>` — create a new watchlist
`/watchlist show <name>` — show watchlist details and items
`/watchlist add <name> <items...>` — add items to a watchlist
`/watchlist remove <name> <items...>` — remove items
`/watchlist delete <name>` — delete a watchlist
`/watchlist check` — run all watchlists against live data, report new activity
`/watchlist check <name>` — check a specific watchlist

## Execution

Parse the arguments to determine the action. Map user-friendly verbs to MCP tool actions:
- `create` → `watchlist_manage` with action `create`
- `show` → `watchlist_manage` with action `get`
- `add` → `watchlist_manage` with action `add_items`
- `remove` → `watchlist_manage` with action `remove_items`
- `delete` → `watchlist_manage` with action `delete`
- `check` → `watchlist_check`
- No args or `list` → `watchlist_manage` with action `list`

Valid types: `ip`, `ticker`, `region`, `cve`, `vessel`, `callsign`

When showing results, format them as a clean table or list. For `check` results, highlight items with new activity and explain what changed.

## Rules Management

Also supports alert rules:
- `/watchlist rule create <id> <domain> <metric> <operator> <threshold> "<message>"` → `alert_rules_manage` create
- `/watchlist rule list` → `alert_rules_manage` list
- `/watchlist rule delete <id>` → `alert_rules_manage` delete

Example: `/watchlist rule create spy-crash markets spy_price lt 400 "SPY dropped below 400"`
