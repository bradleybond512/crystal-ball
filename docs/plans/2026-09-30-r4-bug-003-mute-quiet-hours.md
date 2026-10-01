# R4-BUG-003: Critical alerts bypass master mute; one quiet-hours rule

Status: approved by Bradley on September 30, 2026 ("Approve as designed"). Branch
`claude/r4-bug-003-mute-quiet-hours` from `a255546ee`. Classification:
Standard+ (alerting path). Queue item Q9. Part 1b decision: **critical alerts
bypass master mute.**

## Problem (verified at a255546ee)

**Mute:** `evaluateNotificationPreference` returns `master-mute` before
anything else, so a mute left on for a meeting silences Tornado and EEW
notifications indefinitely.

**Quiet hours:** there are **five** implementations, not two, with three
storage keys and two settings panels.

| Where | Store | Equal start/end | Blank or invalid | Who uses it in production |
|---|---|---|---|---|
| `notification-settings-service` `isInQuietHours` | `wm-notification-settings-v1` (HH:MM + per-domain toggle), **Notification Settings** panel | 24 h quiet | parsed as `0`, so blank means 24 h quiet | dispatcher (`evaluateNotificationPreference`) |
| `alert-trace` `isWithinQuietWindow` | same | 24 h quiet | `0` | the "why was this suppressed" explanation |
| `notification-preferences` `isQuietHour` | `wm-notification-preferences` (whole hours), **Notification Preferences** panel | (hours) | sanitized | **weather ladder** (`data-loader.ts:2019`) |
| `notification-dispatcher` `isQuietHoursActive` | `wm-quiet-hours` | never quiet | rejected | dispatcher; **nothing writes this key** |
| `alerting-prefs` `inQuietHours` | `crystalball-quiet-hours-v1` | (hours) | none | alert sound and border flash; **nothing writes this key** |

So the two panels each control a different subset of alerts, and neither one
says so.

## Design

1. **Master mute lets critical through.**
   - `evaluateNotificationPreference` blocks only non-critical alerts on
     `masterMute`.
   - The alert-trace explanation and the Notification Settings label say
     "critical alerts still come through".
   - Ghost Mode and per-domain "off" are unchanged. They are explicit and
     scoped, and Ghost Mode is a deliberate full silence.
2. **One pure rule:** `src/services/notifications/quiet-hours.ts`.
   - `parseQuietTime` accepts strict `HH:MM` (00–23, 00–59) and returns
     `null` for anything else.
   - `validateQuietWindow(start, end)` returns `ok`, `invalid` or `equal`.
   - `isWithinQuietWindow(minutesOfDay, start, end)` handles the overnight
     wrap. **An invalid or equal window is never quiet**, which fails toward
     delivery, never toward silence.
   - `minutesOfDay(date)` uses local wall-clock time, so DST days follow the
     clock.
3. **One store:** the Notification Settings window (`wm-notification-settings-v1`
   global `HH:MM` plus each domain's quiet-hours toggle).
   - `updateGlobalSettings` **rejects** invalid or equal windows and keeps
     the old value. The panel shows why.
   - The service exports `isDomainInQuietHours(domain, now)`, which the
     dispatcher, alert-trace and the **weather ladder** all use.
   - The weather ladder's per-domain bypass becomes "weather quiet hours
     off".
4. **The Notification Preferences panel** keeps its per-domain table. Its
   quiet-hours window becomes a read-only line ("Quiet hours 22:00–07:00 ·
   set in Notification Settings") with a button that opens that panel.

   Implementation note: its per-domain "QH override" column is **removed**
   rather than mapped. Two of its domains (`sanctions`, `intelligence`) have
   no canonical counterpart, and weather's toggle in Notification Settings
   is already the per-domain switch.
5. **Migration, once, never adding silence.**
   - If the Preferences window is enabled, and canonical weather quiet hours
     are off, the window is copied (`HH:00`). Weather quiet hours are then
     enabled unless its override was on.
   - This keeps today's weather behavior exactly. No other domain gains
     quiet hours.
   - The readers of the two unwritten keys (`wm-quiet-hours`,
     `crystalball-quiet-hours-v1`) are removed. A stale value from an old
     build stops silencing anything, which fails toward delivery.

## Tests (fakes only; mutation proof per behavior)

- **A table-driven quiet-hours test**, run through every call site (the
  pure rule, `evaluateNotificationPreference`, alert-trace and the weather
  ladder input):
  - same-day window;
  - overnight window;
  - boundaries (start inclusive, end exclusive);
  - equal start and end;
  - blank;
  - invalid (`24:00`, `7:5`, `ab:cd`);
  - a DST spring-forward and fall-back day.
- **Mute bypass:** critical is allowed under mute; high and medium stay
  suppressed. The trace explanation matches.
- **Save-time rejection:** invalid and equal windows are refused and the
  stored value is unchanged. The panel shows the error.
- **Migration:** a Preferences window plus weather → canonical weather. An
  override stays off. An already-set canonical window is untouched. The
  migration runs once.
- **Source gates:** no reader of `wm-quiet-hours` or
  `crystalball-quiet-hours-v1` remains, and `data-loader` reads the
  canonical store.

## Observation, not changed here

The Notification Preferences panel's global **"Notifications enabled"**
toggle is consulted only by that panel's own helpers. No production path
reads it, so turning it off silences nothing. Making it a second master mute
would repeat this bug, so it is left for a separate decision: remove it, or
relabel it.

## Approval requirement

Per AGENTS.md High Assurance rules, implementation starts only after
Bradley approves this design.
