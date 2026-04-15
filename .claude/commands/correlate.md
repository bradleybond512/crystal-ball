Run a cross-domain correlation analysis using Crystal Ball intelligence data.

## Usage

`/correlate` — interactive mode, asks what to correlate
`/correlate conflicts cyber` — correlate specific domains
`/correlate conflicts markets --region "Middle East" --window 7d` — with filters

## Execution

1. **Parse arguments** — If domains are provided as arguments, use them. Otherwise ask:
   "Which domains do you want to correlate? Pick 2 or more: conflicts, markets, cyber, weather, military, health"

2. **Run correlation** — Call the `correlate` MCP tool with the selected domains and any region/timeframe filters.

3. **Run trend analysis** — For each domain with correlations, call the `trend` tool to show whether the correlated activity is increasing or decreasing.

4. **Synthesize findings** — Present results as an intelligence-style brief:
   - Lead with the strongest correlations (highest score)
   - For each correlation, explain what shared entities were found and what it might mean
   - Include trend direction for context ("cyber attacks targeting Ukraine are rising while conflict events are falling")
   - Flag any anomalies

5. **Suggest follow-ups** — Based on findings, suggest:
   - Deeper drill-down queries using `query_raw` or `chain_query`
   - Watchlist items worth tracking
   - Related domains to investigate
