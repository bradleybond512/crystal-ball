# Crystal Ball — SMS / iMessage Command Interface Plan

## Purpose

This document defines a safe, local-first command interface that allows the user to query Crystal Ball by SMS or iMessage and receive concise intelligence responses.

Goal:

> Every important Crystal Ball command should eventually work over SMS/iMessage.

This turns Crystal Ball into an always-available intelligence assistant that can be queried away from the desktop.

Examples:

```text
STATUS
WHAT CHANGED
LOCAL RISK
WATCH H5N1
WHY IS CYBER RISK UP?
ANYTHING NEAR SOUTH BEND?
BRIEF ME
SOURCES DOWN?
```

Crystal Ball should reply with short, evidence-aware, confidence-aware intelligence summaries.

---

# Core Vision

The SMS/iMessage interface should feel like texting an operations center.

It should provide:
- situational summaries
- What Changed briefs
- local risk checks
- watch mission updates
- source health reports
- personal impact checks
- active situation summaries
- next indicators to watch
- emergency-relevant alerts

But it must not become:
- a surveillance tool
- an unrestricted remote-control system
- a spam bot
- an unsafe automation layer
- a way to leak private context

---

# Product Standard

The text interface should not be a generic chatbot.

It should be:

> a constrained operational command channel for Crystal Ball intelligence.

Every response should be:
- short enough for SMS
- grounded in existing Crystal Ball intelligence objects
- confidence-aware
- source-health-aware
- privacy-preserving
- auditable
- safe to send to the requesting user

The core test:

> Could this reply help the user understand what matters without leaking private data or overstating certainty?

---

# Safety and Privacy Principles

## 1. Local-First

All message processing should happen locally on the user’s Mac whenever possible.

Do not send private SMS/iMessage content to analytics.
Do not send message history to cloud AI unless the user explicitly enables it.

## 2. Allowlisted Senders Only

Crystal Ball should only respond to:
- the owner’s phone number
- explicitly allowlisted contacts
- optionally a small trusted group

Default:
> owner only.

## 3. Explicit Command Grammar

The system should not answer arbitrary private conversations.

It should only respond to messages that match:
- explicit prefix
- explicit command
- trusted sender

Recommended prefixes:

```text
CB STATUS
CB BRIEF
CB LOCAL RISK
CB WATCH H5N1
CB SOURCES
```

Do not process every incoming message as a command.

## 4. Audit Everything

Every inbound command and outbound reply should be logged locally.

Audit fields:
- timestamp
- sender hash or label
- command
- parsed intent
- response type
- whether AI was used
- whether personal context was included
- delivery status

## 5. Rate Limits

Prevent loops and spam.

Recommended default:
- max 10 commands per sender per hour
- max 3 long briefs per hour
- emergency alerts exempt but throttled

## 6. No Silent Auto-Reply to Non-Commands

Crystal Ball must never reply to normal conversations.

Only explicit commands should trigger replies.

## 7. No Dangerous Remote Actions

SMS commands should be read/query oriented by default.

Allowed:
- ask for status
- ask for brief
- ask for source health
- ask for watch mission update
- ask for local risk
- ask for active situations

Restricted / require local confirmation:
- changing settings
- changing API keys
- deleting data
- sending messages to third parties
- disabling alerts
- modifying watchlists broadly

---

# Threat Model

The SMS/iMessage command interface must be designed against realistic abuse cases.

## Threats

- spoofed sender identity
- lost/stolen phone
- command replay
- message loop / auto-reply loop
- group chat leakage
- sensitive context disclosure
- malicious contact sending crafted commands
- accidental command from quoted text
- prompt injection through SMS text
- cloud LLM leakage of private context
- automation permission misuse
- Messages database schema changes
- macOS automation failure causing duplicate sends

## Required Mitigations

- allowlisted sender required
- explicit `CB` prefix required
- optional owner PIN for sensitive commands
- dedupe inbound message IDs
- group chat disabled by default
- reply only once per command ID
- max reply chunks per command
- local-only audit log
- redaction by default
- no arbitrary free-form tool execution
- no secrets, API keys, coordinates, or exact home labels in replies
- never process quoted previous replies as new commands
- transport adapter must be idempotent

---

# Integration Options

## Option A — macOS Messages Database Read + AppleScript Send

The Mac Messages app stores local message data in a SQLite database under the user Library.

Potential approach:
- watch Messages database for new inbound messages
- parse new messages from allowlisted senders
- send replies through AppleScript / Shortcuts / Messages automation

Pros:
- native iMessage/SMS support through the Mac
- no monthly SMS gateway cost
- works with the user’s real phone number when Messages sync is enabled

Cons:
- fragile across macOS updates
- requires Full Disk Access or similar permission
- database schema may change
- sending automation may require permissions
- must be designed carefully to avoid privacy risk

## Option B — Apple Shortcuts Bridge

Use Shortcuts automation to pass inbound message contents to a local Crystal Ball endpoint.

Pros:
- user-approved automation flow
- clearer permissions
- less direct database scraping
- easier to reason about privacy

Cons:
- iOS/macOS automation limitations
- may require manual setup
- iMessage automation can be constrained

## Option C — Twilio / SMS Gateway

Use a dedicated SMS number that forwards commands to Crystal Ball API.

Pros:
- reliable SMS webhook model
- clean inbound/outbound API
- works even when Mac Messages is not synced

Cons:
- recurring cost
- separate phone number
- requires internet-exposed endpoint or relay
- more cloud involvement

## Option D — Local Relay App / Menu Bar Companion

Build a small local companion service that:
- watches trusted inbound commands
- calls Crystal Ball local API
- sends replies
- exposes status and permissions

Pros:
- clean architecture
- can be hardened independently
- good macOS UX

Cons:
- more engineering effort

---

# Recommended Approach

Start with:

> Local macOS-only owner-command prototype using explicit `CB` prefix and allowlisted sender.

Avoid broad automation at first.

MVP should be:
- local-only
- read/query only
- owner-only
- explicit prefix only
- fully audited
- easy to disable

Recommended order:

1. Build command parser and response generator independent of Messages.
2. Expose local command endpoint in sidecar.
3. Build test CLI to simulate SMS commands.
4. Add allowlist and audit log.
5. Add outbound reply adapter.
6. Add inbound Messages bridge only after parser/security are stable.

---

# Architecture

```text
Inbound SMS/iMessage
  -> Local Message Bridge
    -> Sender Allowlist Check
      -> Sender/Thread Context Resolver
        -> Prefix + Command Boundary Check
          -> Command Parser
            -> Authorization + Rate Limit
              -> Intent Router
                -> Crystal Ball Intelligence Services
                  -> Response Formatter
                    -> Redaction + Safety Filter
                      -> Delivery Queue
                        -> Outbound Message Adapter
                          -> SMS/iMessage Reply
```

---

# Core Components

## 1. Message Bridge

Responsible for:
- detecting inbound candidate messages
- extracting sender, timestamp, text, thread id
- deduplicating messages
- passing only candidate messages to command parser

It should not perform intelligence logic.

## 2. Sender Allowlist

Responsible for:
- verifying sender identity
- owner-only default
- trusted contacts if enabled
- emergency group if enabled

Suggested config:

```ts
interface SmsAllowlistEntry {
  id: string;
  label: string;
  phoneHash: string;
  role: 'owner' | 'trusted' | 'readonly';
  enabled: boolean;
}
```

Do not store plaintext phone numbers if avoidable.

## 3. Thread Context Resolver

Responsible for knowing whether the inbound command is safe to answer in the current conversation.

Rules:
- one-on-one owner thread is allowed by default
- group threads disabled by default
- trusted group threads require explicit setting
- unknown participants block replies
- replies should not include private saved-place labels in group threads

Suggested contract:

```ts
interface SmsThreadContext {
  threadId: string;
  participantCount: number;
  participantsHash: string[];
  isGroup: boolean;
  authorization: 'owner_direct' | 'trusted_direct' | 'trusted_group' | 'blocked';
  redactionLevel: 'normal' | 'strict' | 'minimal';
}
```

## 4. Command Parser

Responsible for converting text into structured intents.

Example:

```ts
interface SmsCommand {
  id: string;
  rawText: string;
  senderId: string;
  commandType: SmsCommandType;
  args: Record<string, string>;
  receivedAt: string;
}
```

## 5. Intent Router

Routes commands to existing Crystal Ball services.

Examples:
- `STATUS` -> system health + active situations
- `BRIEF` -> OperationalBrief
- `WHAT CHANGED` -> What Changed digest
- `LOCAL RISK` -> Personal Impact Engine
- `SOURCES` -> source health / degraded feeds
- `WATCH <topic>` -> Watch Mission status
- `WHY <topic>` -> evidence-backed explanation

## 6. Response Formatter

Formats replies for SMS constraints.

Rules:
- short by default
- include confidence
- include top drivers
- include uncertainty if relevant
- no giant walls of text
- split long messages safely

## 7. Response Redactor

Applies redaction policy before delivery.

Redacts:
- exact home address
- exact coordinates
- personal saved-place names when strict mode is active
- API/source secrets
- private notes
- raw logs
- full URLs if they contain tokens

## 8. Delivery Queue

Outbound messages should be queued before sending.

Responsibilities:
- idempotency
- retry handling
- duplicate prevention
- chunk ordering
- failure status
- delivery audit

## 9. Outbound Adapter

Responsible for sending reply.

Potential implementations:
- AppleScript Messages send
- Shortcuts bridge
- Twilio
- local notification fallback

## 10. Audit Log

Local-only event record.

```ts
interface SmsCommandAuditRecord {
  id: string;
  receivedAt: string;
  senderLabel: string;
  commandType: string;
  parsed: boolean;
  authorized: boolean;
  responseSent: boolean;
  usedPersonalContext: boolean;
  usedLLM: boolean;
  redactionLevel: string;
  chunksSent: number;
  transport: string;
  error?: string;
}
```

---

# Command Grammar

All commands should use prefix:

```text
CB <COMMAND>
```

Examples:

```text
CB STATUS
CB BRIEF
CB WHAT CHANGED
CB LOCAL RISK
CB LOCAL RISK SOUTH BEND
CB WATCH H5N1
CB WATCH RED SEA
CB SOURCES
CB WHY CYBER RISK UP
CB ACTIVE
CB HELP
```

---

# Command Parsing Rules

## Valid Forms

```text
CB STATUS
CB BRIEF
CB WATCH H5N1
CB WHY CYBER
CB LOCAL RISK SOUTH BEND
```

## Invalid Forms

These should not trigger replies:

```text
Can CB status tell me something?
> CB STATUS
Crystal Ball: CB STATUS
CB
```

## Prefix Rules

- prefix must be at start of message after trimming whitespace
- quoted text should be ignored
- forwarded messages should be ignored unless explicitly supported later
- prefix matching should be case-insensitive
- commands should normalize punctuation

## Ambiguous Commands

If command is ambiguous, reply with short help instead of guessing.

Example:

```text
Crystal Ball: I need a clearer command. Try: CB STATUS, CB BRIEF, CB WATCH H5N1, or CB HELP.
```

---

# Initial Command Set

## CB HELP

Returns supported commands.

## CB STATUS

Returns:
- app health
- source health summary
- active situation count
- highest priority item

Example reply:

```text
Crystal Ball: Stable.
3 active situations.
Top: Midwest severe weather logistics risk.
Confidence: medium-high.
Watch: power outages + road closures.
```

## CB BRIEF

Returns short OperationalBrief.

Should include:
- top 3 situations
- what changed
- personal relevance if any
- degraded sources

## CB WHAT CHANGED

Returns material changes since last check.

## CB LOCAL RISK

Returns user-local personal impact summary.

Should include:
- weather
- infrastructure
- travel
- cyber/internet
- nearby critical alerts

## CB WATCH <topic>

Returns status of a Watch Mission.

Examples:
- H5N1
- Red Sea
- Taiwan
- cyber
- South Bend
- fuel

## CB WHY <topic>

Returns short explanation with evidence and uncertainty.

Example:

```text
Cyber risk is elevated because:
1. regional outage reports increased
2. BGP instability detected
3. CISA KEV activity elevated
Confidence: medium.
Limit: only 1 independent source confirms impact.
```

## CB SOURCES

Returns degraded/stale/blind sources.

## CB ACTIVE

Returns active situations sorted by operational importance.

## CB MAP <region>

Returns text-only situational summary for a region.

## CB PING

Simple health check.

---

# Remote Operational Commands

These make the interface significantly more useful without becoming unsafe.

## CB FOLLOW <situation/topic>

Temporarily increases monitoring priority for a topic.

Safety:
- owner only
- expires automatically
- does not alter permanent watchlists unless confirmed locally

## CB UNFOLLOW <topic>

Stops temporary follow mode.

## CB NEXT <situation/topic>

Returns next indicators to watch.

## CB CONFIDENCE <topic>

Explains confidence and meta-confidence.

## CB BLINDSPOTS

Returns current degraded observability.

## CB RECOVERY <topic>

Reports whether a situation is stabilizing or recovering.

## CB THREAD <topic>

Returns short narrative timeline of a situation.

These should be read-only or temporary by default.

---

# Advanced Commands

These should come later.

## CB SIM <scenario>

Runs a predefined scenario simulation.

Example:

```text
CB SIM CHICAGO POWER OUTAGE
```

Requires careful cost and abuse controls.

## CB MUTE <topic>

Should require local confirmation before enabling.

## CB ADD WATCH <topic>

Should require local confirmation or owner-only mode.

## CB EXPORT <situation>

Should require confirmation due to possible sensitive context.

---

# Confirmation Workflows

Sensitive commands should use a two-step confirmation flow.

Example:

```text
CB ADD WATCH RED SEA
```

Response:

```text
Crystal Ball: Add Watch Mission “Red Sea”? Reply CB CONFIRM 4821 within 10 min. This changes monitoring settings.
```

Then:

```text
CB CONFIRM 4821
```

Rules:
- confirmation codes expire
- confirmation is bound to sender + command + thread
- only one active confirmation per sender unless queued
- failed attempts are rate-limited

Suggested contract:

```ts
interface PendingSmsConfirmation {
  id: string;
  senderId: string;
  threadId: string;
  commandType: string;
  commandPayload: Record<string, string>;
  codeHash: string;
  expiresAt: string;
  attempts: number;
}
```

---

# Response Design

## SMS Response Constraints

Default replies should be under 600 characters.

Long replies should be split into numbered chunks:

```text
Crystal Ball Brief 1/2:
...
```

## Response Template

```text
Crystal Ball: <summary>
Confidence: <level>
Why: <top drivers>
Watch: <next indicators>
Limits: <uncertainty/blind spot>
```

## Response Priority Order

SMS has limited space. Prioritize:

1. direct answer
2. confidence
3. top driver
4. personal relevance if any
5. next indicator
6. source limitation

## Always Include Uncertainty When Relevant

If source health is degraded:

```text
Limit: AIS coverage degraded; maritime confidence reduced.
```

If single-source:

```text
Limit: single-source signal, not confirmed.
```

## Long Brief Strategy

For long answers, send a compact first message and offer follow-up commands.

Example:

```text
Crystal Ball: 3 active situations. Top: Midwest severe weather logistics risk. Confidence: medium-high. Reply CB DETAILS WEATHER for more.
```

---

# Reliability and Offline Behavior

## If Crystal Ball Is Running But Some Sources Are Stale

Reply with stale-data limitation.

```text
Crystal Ball: Local risk low-moderate. Limit: weather source fresh, AIS stale 42m, cyber source degraded.
```

## If Crystal Ball Is Offline

If the SMS bridge can still respond, reply:

```text
Crystal Ball: Core app unavailable. Last known brief from 2h ago: <summary>. Confidence reduced.
```

## If Intelligence Services Are Not Ready

Reply:

```text
Crystal Ball: Still loading intelligence state. Try CB STATUS again in a minute.
```

## If Outbound Send Fails

Record failure in audit log and avoid retry storms.

## If Inbound Bridge Restarts

Deduplicate by message id / timestamp / sender / command hash.

---

# Security Controls

## Authentication

Minimum:
- allowlisted sender
- `CB` prefix
- local-only command processor

Better:
- optional PIN for sensitive commands

Example:

```text
CB 1234 STATUS
```

Sensitive commands require PIN or local confirmation.

## Authorization Levels

```ts
type SmsCommandPermission =
  | 'public_help'
  | 'owner_read'
  | 'trusted_read_limited'
  | 'owner_sensitive'
  | 'local_confirmation_required';
```

## Sensitive Commands

Require local confirmation:
- add/remove watchlists
- change settings
- export data
- send summaries to third parties
- mute alerts
- modify notification rules

## Abuse Protection

- rate limiting
- deduplication
- loop prevention
- max reply length
- no auto-reply to non-commands
- no group chat by default
- disable switch

---

# Privacy Controls

## Redaction

SMS replies should avoid exposing overly precise private context.

Examples:
- say “saved place near South Bend” instead of exact home address
- avoid exact coordinates
- avoid family/place labels unless user allows

## Redaction Levels

```ts
type SmsRedactionLevel = 'normal' | 'strict' | 'minimal';
```

- `normal`: owner direct thread
- `strict`: trusted contact or group thread
- `minimal`: status-only / no personal context

## Export Boundary

Do not include personal context in exported SMS replies unless explicitly requested and authorized.

## Local Logs

Audit logs should store:
- hashed sender
- command type
- timestamps
- status

Avoid storing full private conversation history.

---

# macOS Permissions

Potential permissions needed:
- Full Disk Access if reading Messages database
- Automation permission for Messages / Shortcuts
- Local network permission if using sidecar endpoint

The UI should clearly explain why each permission is needed.

---

# Sidecar API Design

Add local-only sidecar endpoints:

```text
POST /api/sms-command
GET /api/sms-command/audit
GET /api/sms-command/status
POST /api/sms-command/confirm
```

## Request

```ts
interface SmsCommandRequest {
  senderHash: string;
  senderLabel?: string;
  threadId?: string;
  rawText: string;
  receivedAt: string;
  transport: 'imessage' | 'sms' | 'shortcut' | 'twilio' | 'test';
}
```

## Response

```ts
interface SmsCommandResponse {
  ok: boolean;
  commandType?: string;
  replyText?: string;
  chunks?: string[];
  requiresConfirmation?: boolean;
  confirmationId?: string;
  error?: string;
}
```

---

# Data Contracts

Suggested service folder:

```text
src/services/sms/
```

Suggested files:

```text
sms-command-types.ts
sms-command-parser.ts
sms-command-router.ts
sms-response-formatter.ts
sms-redaction.ts
sms-permissions.ts
sms-rate-limit.ts
sms-audit-log.ts
sms-confirmation.ts
sms-delivery-queue.ts
sms-transport-types.ts
```

---

# Test Harness First

Before touching Messages/iMessage integration, build:

```text
npm run sms:test
```

or a local script:

```text
scripts/simulate-sms-command.mjs
```

Examples:

```bash
node scripts/simulate-sms-command.mjs "CB STATUS"
node scripts/simulate-sms-command.mjs "CB WHAT CHANGED"
node scripts/simulate-sms-command.mjs "CB LOCAL RISK"
```

This ensures command parsing and replies work without messaging risk.

---

# Unit Tests

Add tests for:
- command parsing
- authorization
- unknown commands
- ambiguous commands
- quoted command rejection
- rate limiting
- redaction
- response splitting
- source health inclusion
- personal context boundary
- audit logging
- no response to non-CB messages
- group chat disabled by default
- confirmation code expiry
- duplicate inbound message handling
- delivery queue idempotency
- stale data responses
- offline responses

Suggested files:

```text
src/services/sms/__tests__/sms-command-parser.test.mts
src/services/sms/__tests__/sms-permissions.test.mts
src/services/sms/__tests__/sms-response-formatter.test.mts
src/services/sms/__tests__/sms-redaction.test.mts
src/services/sms/__tests__/sms-confirmation.test.mts
src/services/sms/__tests__/sms-delivery-queue.test.mts
```

---

# Implementation Phases

## Phase 1 — Command Core

Build:
- command parser
- command types
- response formatter
- allowlist model
- rate limiter
- audit log
- test harness

No real iMessage integration yet.

## Phase 2 — Crystal Ball Intent Router

Wire commands to:
- OperationalBrief
- What Changed
- Personal Impact
- Source Health
- Active Situations
- Watch Missions

## Phase 3 — Confirmation + Redaction

Add:
- confirmation workflows
- redaction levels
- privacy boundaries
- sensitive command handling

## Phase 4 — Local Sidecar Endpoint

Expose local command endpoint.

Add diagnostic status.

## Phase 5 — Delivery Queue + Outbound Adapter Prototype

Implement:
- delivery queue
- AppleScript send or Shortcuts handoff
- idempotent sending
- retry limits

Owner-only.

## Phase 6 — Inbound Bridge Prototype

Implement inbound detection.

Strict constraints:
- owner only
- CB prefix only
- no group chats
- no non-command replies

## Phase 7 — Settings UI

Add settings for:
- enable/disable SMS command interface
- allowlisted senders
- command prefix
- reply length
- audit log viewer
- sensitive command policy
- transport method
- redaction level
- emergency override behavior

## Phase 8 — Advanced Commands

Add:
- watch mission commands
- follow situation
- simulation commands
- confirmation workflows

---

# Claude Implementation Guidance

## Best First PR

Implement only:
- parser
- command contracts
- response formatter
- authorization model
- redaction primitives
- unit tests
- CLI simulation script

Do not touch Messages.app yet.

## Best Second PR

Wire parser to mocked OperationalBrief / What Changed / Source Health outputs.

## Best Third PR

Wire to real existing services.

## Best Fourth PR

Add confirmation workflows and audit logging.

## Best Fifth PR

Add sidecar endpoint.

## Best Sixth PR

Add delivery queue and outbound reply adapter.

Only after that:
- inbound iMessage/SMS bridge.

---

# Acceptance Criteria

Before enabling real messaging:

- non-CB messages produce no response
- unknown senders produce no response
- group chats blocked by default
- duplicate inbound messages do not duplicate replies
- sensitive commands require confirmation
- personal context is redacted correctly
- logs do not contain raw private conversation history
- source degradation appears in relevant replies
- stale intelligence produces a warning
- rate limits prevent loops
- outbound failure does not retry indefinitely
- all command logic can be tested without Messages.app

---

# Non-Goals

This system is not:
- a general SMS chatbot
- a third-party customer support bot
- an unrestricted remote control channel
- a way to monitor conversations
- a way to respond to arbitrary contacts
- a replacement for official emergency alerts
- a surveillance feature

---

# Elite Version

The elite final version allows the user to text:

```text
CB BRIEF
```

And receive:

```text
Crystal Ball: 2 material changes.
1) Midwest storm risk rising; power outage signals increasing.
2) Cyber source health degraded; confidence reduced.
Local impact: low-moderate near saved places.
Watch: NWS updates + outage reports.
```

Or:

```text
CB CONFIDENCE H5N1
```

And receive:

```text
H5N1 confidence: medium. Supporting: livestock reports + official monitoring. Missing: export/price impact. Watch: USDA updates + poultry price movement.
```

Or:

```text
CB BLINDSPOTS
```

And receive:

```text
Crystal Ball: 2 blind spots. AIS stale in maritime layer; cyber provider redundancy degraded. Confidence reduced for shipping/cyber situations.
```

That is the target:

> Crystal Ball reachable by text, but still evidence-aware, privacy-preserving, and operationally disciplined.
