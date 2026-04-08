# Crystal Ball Autoresearch

This folder keeps a narrow, repeatable research loop for non-obvious improvements.

## Loop

1. Pick one track in `research/programs/`.
2. Keep the editable surface small.
3. Run the fixed harness for that track with `bash scripts/research-eval.sh <track>`.
4. Keep only changes that improve the result without creating new regressions.
5. Use `research/results.tsv` and `research/runs/` to compare attempts over time.

## Tracks

- `alerting`
- `source-trust`
- `map-perf`

## Commands

```bash
cd crystalball
bash scripts/research-eval.sh alerting
bash scripts/research-eval.sh source-trust
bash scripts/research-eval.sh map-perf
bash scripts/research-eval.sh rotation
```

## Files

- `research/programs/*.md` - the brief for each research track
- `research/results.tsv` - append-only results ledger
- `research/runs/` - generated logs and summaries for each run (gitignored)
