# Missed Features for Claude

Use this as the cleanup and integration checklist after the foundation PR wave.

The core deterministic services exist or are planned in the related docs, but the app still needs important user-facing integration. Focus on turning the services into warnings, briefings, native notifications, and clear presentation.

## Highest Priority

### 1. Weather Warning End-to-End Integration

The weather remediation stack needs to be checked from data ingestion to user notification.

Make sure:

- Saved-place NWS polygon matching is wired into active weather alert ingestion.
- Weather urgency scoring feeds notification routing.
- Tornado, flash flood, destructive wind, severe thunderstorm, and nearby severe-cell threats can bypass quiet-hours only when the user setting allows it.
- Weather notifications include the matched place and why the user got the alert.
- Repeated notifications only fire for meaningful changes.
- Miss diagnostics explain every suppression.

Expected user outcome:

```text
Crystal Ball warns Bradley before severe wind/storm threats reach saved places and explains what to do.
```

### 2. Personal Storm Mode UI

The weather plan deferred PR 5 UI. Build the minimal macOS-native presentation.

Needed:

- Persistent critical strip for active threats.
- Compact Storm Mode panel/card.
- Primary hazard, arrival window, confidence, place match, and actions.
- Acknowledge / snooze controls.
- "Why did I get this?" diagnostic link.

Suggested files:

- `src/components/PersonalStormMode.ts`
- `src/styles/macos-native.css`
- `src/styles/alerts.css`

### 3. Native Notification Ladder Wiring

The insights plan deferred notification ladder wiring.

Needed:

- Big Event Detector output should route to notification policy.
- Confidence/Urgency Matrix should select badge/banner/sound/persistent/digest.
- Weather criticals should use weather-specific urgency.
- Action Briefs should be included in high-urgency notifications when space allows.
- Notification digests should use What Changed Digest, not raw alert dumps.

Suggested files:

- `src/services/notification-router.ts`
- `src/services/notification-dispatcher.ts`
- `src/app/desktop-notifications.ts`

### 4. What Changed Digest In App

The service-level digest needs an actual product surface.

Needed:

- "Since you last checked" panel/card.
- Morning/evening digest mode.
- Weather-specific change explanations.
- Shortage/commodity risk changes.
- Intelligence confidence changes.
- Source corroboration changes.
- User exposure changes.

Expected output:

```text
Since you last checked:
- Storm risk near Home rose from Watch -> Critical
- Diesel stress rose from 54 -> 69
- Two sources now confirm port closure
- Taiwan Strait activity normalized
```

### 5. Action Briefs In Notifications and Situation Cards

Action Briefs should not remain hidden in service code.

Needed:

- Attach practical action guidance to major situations.
- Use reaction playbooks by category.
- Show action guidance in Storm Mode, Command Center, and exported briefs.
- Keep wording calm and proportional.

## Important Integration Gaps

### 6. Critical Event Command Center

The app still needs the main high-visibility situation surface.

Needed:

- Top 3 active global/personal situations.
- Why it matters.
- Confidence.
- Personal impact.
- What changed.
- What to do now.
- What to watch next.
- Source agreement/disagreement.
- Timeline.

Suggested files:

- `src/components/CriticalEventCommandCenter.ts`
- `src/styles/macos-native.css`

### 7. Should-I-Care Filter In UI

Watchlist relevance only matters if users see it.

Needed:

- "Should Bradley care?" answer on major situation cards.
- Reason based on saved places, watchlist, portfolio, travel, and confidence.
- Sort/rank by personal exposure.
- Expose low-personal-impact label for distant but serious events.

### 8. Compound Risk Connected To Situations

Compound risk should influence big-event detection and presentation.

Needed:

- Feed compound risk into Big Event Detector.
- Show involved domains.
- Explain cascade path.
- Promote high compound risk to Command Center.
- Include data gaps and confidence.

### 9. Negative Evidence Connected To Confidence

Negative evidence should visibly reduce confidence instead of living as an isolated score.

Needed:

- Attach missing confirmation to situation cards.
- Feed negative evidence into truth scoring/compound risk.
- Show watch-window expiration.
- Explain why a risk decayed.

Example:

```text
Risk decreased because no warning expansion, outage reports, or airport ground stops appeared within the expected 30-minute window.
```

### 10. Shortage Forecast UI

The shortage models need a user-facing surface.

Needed:

- Shortage Radar ranked list.
- Commodity watch cards.
- Driver breakdowns.
- Watch windows.
- Data gaps.
- Food/energy maps later.

Initial cards:

- Wheat
- Corn
- Rice
- Soybeans
- Diesel
- Gasoline
- Natural gas
- Jet fuel

## Data and Redundancy Gaps

### 11. Weather Data Redundancy

The weather warning path should not depend on one signal.

Add or confirm:

- NWS alerts with polygons.
- SPC outlook/watch/mesoscale discussion ingestion.
- Radar/precipitation layer for nowcasting.
- Lightning source if available.
- River/stream gauge checks for flood context.
- Power outage/grid signals for wind impact.

### 12. Food and Energy Data Redundancy

Shortage forecasting needs real provider wiring after deterministic models.

Add or confirm:

- USDA Quick Stats.
- FAOSTAT.
- FEWS NET.
- WFP/HDX food prices.
- EIA petroleum and natural gas.
- JODI oil.
- World Bank commodity prices.
- NOAA/drought/soil moisture signals.

### 13. ADS-B Frontend Wiring

Backend ADS-B aggregation landed, but frontend wiring still has an open PR.

Needed:

- Use `/api/adsb-aggregate` in aviation/military views.
- Show provider confidence/fallback status.
- Use multiple providers for redundancy.

Related PR:

- <https://github.com/bradleybond512/crystal-ball/pull/128>

## Native macOS Presentation Gaps

### 14. Menu Bar Risk Status

Add compact high-signal status in the macOS menu bar.

Example:

```text
Crystal Ball: Elevated
Top driver: Severe weather near Home
Next watch: NWS update in 8 min
```

### 15. Quick Look-Style Event Preview

Major events should open into a clean native-feeling preview.

Needed:

- Compact summary.
- Timeline.
- Drivers.
- Confidence breakdown.
- Action brief.
- Sources.

### 16. Share/Export Surface

Presentation export exists/planned, but make it accessible.

Needed:

- Markdown brief button.
- Copy summary button.
- PNG card export if available.
- Send-to-Claude debug packet.

## Old PR Cleanup

Review or close stale/superseded PRs:

- <https://github.com/bradleybond512/crystal-ball/pull/114>
- <https://github.com/bradleybond512/crystal-ball/pull/61>
- <https://github.com/bradleybond512/crystal-ball/pull/60>

These appear stale, dirty, failing, or superseded by later work.

## Recommended Next Claude Batch

Start here:

1. Weather warning end-to-end integration
2. Personal Storm Mode UI
3. Native notification ladder wiring
4. What Changed Digest in app
5. Action Briefs in notifications and situation cards

Recommended Claude prompt:

```text
Read docs/MISSED_FEATURES_FOR_CLAUDE.md, docs/WEATHER_WARNING_REMEDIATION_PLAN.md, and docs/INSIGHTS_NOTIFICATIONS_PRESENTATION_PLAN.md. Implement the next smallest batch: weather warning end-to-end integration plus minimal Personal Storm Mode UI. Focus on real user warning behavior, not broad refactors.
```
