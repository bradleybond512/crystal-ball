# UX-026 cached GDACS context repair

Status: approved bounded fifth repair cycle. Bradley answered the pending
request to continue cached-context repair with “Lets continue” and added
macOS 27 evaluation as parallel scope. No publication is authorized by this
record alone.

The fourth review reproduced live flood context scoring 50 and matching one
camera, then disappearing on an ordinary cache hit at age zero. The explicit
incomplete-evidence warning avoided false reassurance but did not prevent
information loss. The actual ten-minute GDACS cache uses `cached` for both
healthy TTL hits and older fallback, so cached must not be relabeled live.

The approved architect design retains fulfilled live/cached GDACS events in
existing scoring and qualifies cached matches in both row and viewer labels.
Rejected/unavailable results remain excluded. Preserve current scores, ranking,
provider contracts, network calls and polling. No source schema or privilege
change is needed.

UI specialist owns FAAWeatherCamsPanel and focused actual-runtime tests. Parent
owns evidence/checkpoint; test engineer owns clean mutation proofs; independent
reviewer reviews the complete correction.

Acceptance: warm the actual service cache, then retain the same flood match
on an immediate hit; retain older context with explicit cached wording; remove
qualification on live recovery; exclude unavailable data; keep NWS match labels
and scores unchanged. Use runtime/UX026, type/lint, clean mutation proofs and
the full named-test gate. Fresh independent and Claude reviews are required.
Rollback reverts the focused correction and would restore the known information
loss. No installed application or user data is changed by implementation.
