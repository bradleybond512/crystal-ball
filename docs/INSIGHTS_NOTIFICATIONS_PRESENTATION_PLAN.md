# Insights, Notifications, and Presentation Plan

Use this plan to make Crystal Ball better at high-visibility big-event detection, user reaction guidance, native macOS notifications, and polished intelligence presentation.

The goal is simple: when something big happens, the user should know quickly, understand why it matters, and know how to react.

## Product Direction

Crystal Ball should feel like a native macOS intelligence desk:

- It detects major events early.
- It separates noise from meaningful developments.
- It explains why an event matters.
- It tells the user what changed.
- It shows what to watch next.
- It recommends a practical reaction.
- It avoids spam.
- It escalates aggressively only when the event truly deserves it.

## 1. Critical Event Command Center

Create a top-level view for the biggest active situations.

This should not be another feed. It should be a focused view with only high-importance situations.

Each situation should show:

- Current status
- Why this matters
- Confidence
- Personal impact
- What changed
- What to do now
- What to watch next
- Source agreement and disagreement
- Timeline

Suggested behavior:

- Show the top 3 global events by default.
- Prioritize user-exposed events above distant global noise.
- Support a compact and expanded view.

## 2. Situation Severity Tiers

Use clear tiers instead of raw alert noise.

Suggested tiers:

```text
FYI        worth knowing
Watch      may develop
Elevated   likely to matter
Critical   needs attention now
Emergency  immediate action
```

Each tier should map to presentation and notification behavior.

## 3. Native macOS Notification Ladder

Notifications should escalate intelligently.

Suggested ladder:

- Badge only
- Notification Center banner
- Banner + sound
- Persistent critical alert inside app
- Optional Messages/iMessage contact
- Optional hourly/daily digest
- Optional app focus or wake-screen style behavior for extreme events

The app should avoid spam, but it must cut through for truly important events.

Existing starting points:

- `src/app/desktop-notifications.ts`
- `src/services/notification-dispatcher.ts`
- `src/services/notification-router.ts`
- `src/services/notification-digest.ts`
- `src-tauri/src/main.rs`

## 4. What Changed Since Last Look

Build a digest that explains meaningful deltas since the user last checked.

Example:

```text
Since you last checked:
- Iran escalation risk rose from 48 -> 71
- Diesel stress risk rose from Watch -> Elevated
- Hurricane track shifted 90 miles west
- Two sources now confirm the port closure
- No tsunami bulletin appeared, lowering quake cascade risk
```

This should be one of the highest-priority features. It makes Crystal Ball feel alive and attentive.

Inputs:

- Situation score changes
- Severity tier changes
- Source corroboration changes
- Forecast changes
- User exposure changes
- New contradictions
- Negative evidence updates

## 5. Action Briefs

Every major situation should include a practical "what should I do?" section.

Weather examples:

- Charge devices
- Check fuel
- Avoid route
- Monitor NWS update
- Prepare outage plan

Markets examples:

- Check portfolio exposure
- Monitor specific commodity
- Avoid panic until confirmation source appears

Cyber examples:

- Patch affected software
- Enable MFA
- Check bank/provider status
- Watch for phishing surge

Conflict and travel examples:

- Review flights
- Check advisories
- Avoid airspace or region
- Monitor embassy alerts

Action guidance should be calm, specific, and proportionate to confidence and urgency.

## 6. Personal Exposure Graph

Connect events to the user's world.

Use:

- Saved places
- Travel plans
- Portfolio
- Watched countries
- Watched companies
- Local utilities
- Family/home/work locations
- Devices and services

Each big event should answer:

```text
Personal impact: High
Reason: storm path overlaps saved place + grid outage risk + airport disruption
```

Or:

```text
Personal impact: Low
Reason: serious global event, but low personal exposure and no direct asset overlap
```

## 7. Briefing Modes

Different moments need different presentations.

Suggested modes:

- Now Brief: 30-second summary
- Deep Brief: full intelligence explanation
- Action Brief: what to do
- Morning Brief: overnight deltas
- Crisis Brief: only critical active situations
- After-Action Brief: what happened, what was predicted correctly

Each mode should reuse the same underlying situation data, not duplicate logic.

## 8. Big Event Detection

Create a dedicated detector for "this is not ordinary."

Trigger when any of these happen:

- Rapid severity jump
- Many sources converge
- Official source confirms weak signals
- User exposure is high
- Multiple domains overlap
- High confidence + high impact
- Low confidence but extreme possible impact
- Prediction model crosses threshold

This detector should power the Command Center and notification ladder.

## 9. Confidence and Urgency Matrix

Separate confidence from urgency.

Suggested matrix:

```text
High confidence + high urgency = notify now
Low confidence + high urgency = watch window alert
High confidence + low urgency = digest
Low confidence + low urgency = background only
```

This prevents noisy predictions from becoming panic alerts while still allowing low-confidence/high-impact events to be watched.

## 10. Native macOS Presentation

Make the experience feel like a real Mac app.

Presentation ideas:

- Translucent sidebar
- Compact inspector panels
- Segmented controls
- Native-feeling toolbar
- Command palette
- Menu bar status item
- Notification Center actions
- Keyboard shortcuts
- Quick Look-style event previews
- Share sheet for briefs
- System accent color support
- Optional compact menu bar risk status

Menu bar status idea:

```text
Crystal Ball: Elevated
Top driver: Gulf fuel stress
Next watch: EIA inventory update
```

Existing style starting point:

- `src/styles/macos-native.css`

## 11. Event Story Cards

Each major event should get a polished story card.

Example:

```text
Diesel Stress Rising

Why:
- inventories below normal
- refinery utilization falling
- Gulf storm risk rising

Confidence:
Medium, improving

Watch next:
- EIA update Wednesday
- port closures
- diesel crack spread

Action:
Monitor fuel and freight-linked exposure
```

Story cards should be compact, scannable, and shareable.

## 12. Should I Care Filter

Every alert or situation should answer this directly.

Example:

```text
Should Bradley care? Yes.
Why: saved place within 80 miles, high outage risk, confidence high.
```

Or:

```text
Should Bradley care? Not yet.
Why: serious event, but low personal exposure and no confirming sources.
```

This should use the personal exposure graph plus confidence/urgency scoring.

## 13. Notification Digest Intelligence

Digests should summarize meaning, not dump alerts.

Example:

```text
3 things changed:
1. Food stress risk rising in East Africa
2. Gulf refinery risk increased
3. Taiwan Strait activity normalized
```

Digest types:

- Morning
- Evening
- Critical-only
- Missed while away
- Weekly forecast

## 14. Presentation Export

Add one-click export for major situations.

Formats:

- Markdown brief
- PNG intelligence card
- PDF situation report
- Clipboard summary
- Share sheet
- Send-to-Claude debug packet

Useful existing starting points:

- `src/services/export-briefing.ts`
- `src/services/intelligence-briefing.ts`
- `src/services/briefing-archive.ts`

## 15. Reaction Playbooks

Build playbooks for major categories.

Suggested categories:

- Severe weather
- Wildfire
- Oil/fuel shortage
- Food shortage
- Cyber campaign
- Banking outage
- Conflict escalation
- Travel disruption
- Grid outage
- Disease outbreak

Each playbook should include:

- User actions
- Confirming sources
- Invalidating sources
- Notification rules
- Recommended panels
- Time windows

## Implementation Order

### PR 1: Big Event Detector and Confidence/Urgency Matrix

Add deterministic services that classify situations by importance and delivery priority.

Suggested files:

- `src/services/insights/big-event-detector.ts`
- `src/services/insights/confidence-urgency-matrix.ts`
- `src/services/insights/__tests__/big-event-detector.test.mts`
- `src/services/insights/__tests__/confidence-urgency-matrix.test.mts`

### PR 2: What Changed Digest

Track meaningful changes since the user last checked.

Suggested files:

- `src/services/insights/what-changed-digest.ts`
- `src/services/insights/change-memory.ts`
- `src/services/insights/__tests__/what-changed-digest.test.mts`

### PR 3: Action Briefs and Reaction Playbooks

Add practical response guidance for major event categories.

Suggested files:

- `src/services/insights/action-briefs.ts`
- `src/services/insights/reaction-playbooks.ts`
- `src/services/insights/__tests__/action-briefs.test.mts`

### PR 4: Native Notification Ladder

Wire the matrix into existing notification routing.

Suggested files:

- `src/services/notification-router.ts`
- `src/services/notification-dispatcher.ts`
- `src/app/desktop-notifications.ts`

### PR 5: Critical Event Command Center

Create the presentation layer once the scoring and digest services exist.

Suggested files:

- `src/components/CriticalEventCommandCenter.ts`
- `src/styles/macos-native.css`
- `src/styles/alerts.css`

### PR 6: Briefing Export and Share

Add polished output options for situations.

Suggested files:

- `src/services/export-briefing.ts`
- `src/services/insights/presentation-export.ts`

## Best First Build

Start with:

1. Big Event Detector
2. Confidence/Urgency Matrix
3. What Changed Digest

Those three turn existing intelligence into something the user can understand immediately.

## Guardrails

- Keep notifications rare and meaningful.
- Always separate confidence from urgency.
- Always explain why the user is being notified.
- Never notify repeatedly for the same unchanged situation.
- Prefer native macOS patterns over web-app styling.
- Make every major alert actionable.
- Do not build broad UI before the ranking and digest logic exists.
- Keep the first PR deterministic and unit-tested.

## Claude Instruction

Claude should read this plan before implementation.

Recommended prompt:

```text
Read docs/INSIGHTS_NOTIFICATIONS_PRESENTATION_PLAN.md. Implement PR 1 only: Big Event Detector and Confidence/Urgency Matrix with deterministic tests. Do not build broad UI yet.
```
