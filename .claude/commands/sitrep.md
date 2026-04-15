Generate a comprehensive situational report using Crystal Ball MCP tools.

## Steps

1. **Pre-flight**: Call `check_feed_health` first. Note which feeds are down and which API keys are missing.
2. **Fetch data with summary_only=true**: Call these three tools in parallel:
   - `get_sitrep` with `summary_only: true`
   - `get_threat_landscape` with `summary_only: true`
   - `get_military_posture` with `summary_only: true`
3. **Selective deep-dive**: For any section with elevated/critical counts, re-call that specific tool with `limit: 20` (no summary_only) to get details.
4. **Synthesize** into a daily brief with sections: **Feed Health**, **Conflicts**, **Markets**, **Cyber**, **Military**, **Weather**.
5. Flag anything at elevated or critical levels. Note any degraded feeds or missing API keys.

Be concise — this is a daily brief, not a research paper.
