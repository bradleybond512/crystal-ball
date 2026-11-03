# UX-052 — limiting derived alert interruptions

Approved by the operator on November 3, 2026. The roadmap controller selected UX-052 at priority S on canonical main `cd459dfec`, with no blocking findings. This is a high-assurance change to notification policy.

## Reproduced behavior

Five synthetic critical convergence candidates with the same title and distinct locations were sent through the real dispatcher during enabled Cyber quiet hours. A substitute notification constructor recorded five calls, five distinct tags and five sticky notices. Disabling Cyber then suppressed another convergence candidate. An authoritative critical NWS control delivered once. No real notification was sent. ACC-509 already handles upstream identity and repeat admission. Distinct, admitted candidates can still produce a burst of interruptions.

## Approved policy

* Give `source === 'correlation'` its own **Derived alerts** setting and use the existing reasoning diagnostics category. This covers convergence, anomaly, compound/situation, escalation and analyst notifications that reach the shared dispatcher. Source metadata determines eligibility. Display and retain the original inference severity.
* Eligible derived notices can produce **one silent, non-sticky standard banner per two minutes per window**. The same normalized title can interrupt **once per fixed 30-minute window**, even if the ID, location or inferred severity changes. An authoritative warning can still interrupt during either window. The two-minute limit uses the dispatcher's existing source cooldown. Thirty minutes is the approved operator policy for repeated titles, not an accuracy estimate.
* Apply the master switch, derived-domain enablement, minimum severity, canonical quiet hours and channel settings to derived candidates, including critical ones. For a fresh profile use enabled, minimum High, existing quiet window enabled and both channels permitted. A native banner requires permission already granted. A derived notification must not open an automatic permission prompt. An in-app-only preference allows existing in-app behavior and rules out an OS banner.
* The store's separate reaction subscriber must not play a sound, flash the window/panel or arm its five-minute critical reminder for a derived candidate. Choose eligible authoritative reactions from the batch before ranking, so a higher-scored derived item cannot displace a real warning. Passive store, panel and map information stays available. Configured webhooks and external relays use separate delivery paths and are outside this policy.
* Respect Ghost Mode and unresolved privacy holds first. A single decision must not increment both the Ghost counter and a derived burst counter. No catch-up notifications when a window ends, a permission changes or the operator unmutes. Critical NWS and other authoritative sources keep their existing policy.

## Accounting and storage

Group titles in memory using bounded, deterministic normalization of case and whitespace; retain distinguishing text such as numerals. Use bounded, opaque per-window notification tags. Avoid putting a title, precise location, situation ID or other alert content in new persisted fields or counters. Coalescing applies only to outward interruptions and does not merge underlying situations, alter ACC-509 identity or manufacture inbox items.

Check duplicate title before domain cooldown, measured from first admitted interruption using an elapsed-time clock. Suppressed repeats do not extend the window. Reserve a slot synchronously before invoking a delivery API so concurrent candidates cannot both pass. Limit the table to 16 admitted groups and expire old ones. With one admission per two minutes, at most 15 groups can still be live in a 30-minute window. Rejected floods do not allocate groups. Distinguish attempted, delivered, permission-unavailable, duplicate-title and cooldown outcomes. The existing diagnostics surface should show fixed suppression reasons and counts. A critical inferred severity alone does not mark a derived interruption as a safety-critical warning.

Add an optional derived setting to the existing v1 preferences. On upgrade, honor restrictive legacy Cyber settings: carry forward an off switch, a stricter threshold or a narrower channel. Enable the approved quiet-hour protection without bypassing the existing quiet-window migration for other domains. Initialize the independent setting once; later Cyber edits must not edit Derived alerts. On unreadable, malformed or unsupported saved preferences, hold derived external notices until the policy can be established. Never overwrite unread preferences.

## Implementation and acceptance

The notification specialist owns classification, pacing and delivery decisions. The settings/UI specialist owns migration, labels and operator-visible accounting. The test owner covers both store-admitted and direct producers, with temporary profiles and fail-on-real-send fixtures.

1. Send 100 same-title critical candidates during an allowed period. Verify one banner, 99 title suppressions, no sticky or audible behavior and unchanged source severity. Verify different titles inside two minutes, exact two- and 30-minute boundaries, changing IDs and locations, permission failure, concurrent arrivals and a large distinct-title burst.
2. Interleave a critical NWS warning during quiet hours and during a derived burst. Verify a mixed store batch and advance the five-minute reminder clock. Test master mute, independent Cyber and Derived settings, all channels, restored Ghost, storage failures and no replay. Verify that a provisional ladder decision or transport failure cannot claim a delivered notification.
3. Run ACC-509 identity/replay, notification settings, quiet hours, UX-050 and relevant CI suites. Prove the guards fail under isolated mutations and run the agentic gate and opposite-agent review. Do not change inference scores, thresholds in the prediction system, upstream feeds, notification endpoints or install settings.
4. Draft #1846 also changes the shared dispatcher, and draft #1844 changes active-warning reaction checks. Both remain held. Use a separate main-based claim and test the affected branches together in a disposable integration worktree. Reconcile any overlap and reverify the integrated tip before delivery. The operator's pause takes precedence.

Rollback removes the presentation policy and its per-window state. The prior reader can ignore the optional v1 field. No alert history or source records need migration.
