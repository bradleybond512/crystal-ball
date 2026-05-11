# Crystal Ball Threat Algorithm Blueprint: The Loom

## Vision

Crystal Ball should evolve into a personal world-risk intelligence engine.

The goal is not to display isolated alerts.
The goal is to:

- detect weak signals
- correlate global events
- estimate cascading risk
- determine user exposure
- explain why events matter
- forecast plausible scenarios

Working codename: **The Loom**.

---

# Core Principle

Instead of:

> Earthquake detected.

Crystal Ball should say:

> Earthquake near a logistics corridor. Port congestion and grid instability are increasing. Direct danger to the user is low, but regional supply-chain risk is elevated.

---

# High Level Architecture

```text
Raw APIs
  ↓
Normalization
  ↓
Source Trust Engine
  ↓
Entity Resolution
  ↓
Event Graph
  ↓
Correlation Engine
  ↓
Threat Scoring
  ↓
Forecast / Scenario Engine
  ↓
Personal Exposure Engine
  ↓
Explainability Layer
  ↓
UI + Alerts + Map + Timeline
```

---

# ThreatEvent Model

```ts
export interface ThreatEvent {
  id: string;
  type: string;
  subtype?: string;
  title: string;
  summary: string;

  createdAt: string;
  observedAt: string;

  location?: {
    lat: number;
    lon: number;
    radiusKm?: number;
    name?: string;
  };

  severity: number;
  confidence: number;
  novelty: number;
  velocity: number;
  credibility: number;

  sourceIds: string[];
  affectedSystems: string[];
  tags: string[];
}
```

---

# Threat Formula

```text
Threat Score =
Severity
× Confidence
× Proximity
× Velocity
× Novelty
× Correlation Strength
× User Exposure
× Cascading Risk
```

---

# Seven Engines

## 1. Event Ingestion Engine

Pull data from:

- earthquakes
- disease APIs
- weather
- wildfire
- aviation
- maritime
- cyber
- infrastructure outages
- government alerts
- social media
- news
- satellite feeds
- economic signals
- conflict feeds

Everything becomes a normalized ThreatEvent.

---

## 2. Source Trust Engine

Every source receives a dynamic trust score.

Example:

```text
USGS: 0.97
NOAA: 0.96
CDC: 0.95
Local news: 0.72
Social media rumor: 0.18
```

Factors:

- historical reliability
- official status
- corroboration
- freshness
- specificity
- retraction history

---

## 3. Correlation Engine

This is the magic.

Crystal Ball links weak signals together.

Example:

```text
Hantavirus article
+ heavy rainfall
+ rodent activity reports
+ rural hospital language
= elevated biological exposure pattern
```

Another:

```text
Earthquake
+ port congestion
+ power outage
+ traffic disruption
= supply chain instability risk
```

Correlation dimensions:

- spatial
- temporal
- infrastructure
- narrative
- anomaly-based
- cascade-based

---

## 4. Threat Propagation Engine

Estimate what happens next.

Not:

> Fire detected.

But:

> Smoke may affect highways within 3 hours.
> Power instability risk increasing.
> Hospital load may rise.

---

## 5. Personal Exposure Engine

This makes the system feel alive.

Inputs:

- home region
- work region
- saved locations
- travel routes
- airports
- preferred alert radius
- user threat preferences

Outputs:

```text
Global severity: 88
User relevance: 14
```

or:

```text
Global severity: 38
User relevance: 96
```

Local relevance matters more than global drama.

---

## 6. Anomaly Detection Engine

The system continuously asks:

> What changed compared to normal?

Examples:

- abnormal earthquake frequency
- sudden ship traffic drop
- unusual aircraft reroutes
- infrastructure outages clustering
- disease language changes
- emergency keyword spikes

---

## 7. Scenario Engine

Every major threat generates:

```text
Most likely scenario
Worst plausible scenario
Best case scenario
Watch indicators
Suggested action
Unknowns
```

Example:

```text
Threat: Hantavirus signal

Most likely:
Localized health concern.

Worst plausible:
Multiple exposure clusters tied to rodent contamination.

Watch:
- county health alerts
- hospital language
- facility closures
- pest reports

Action:
Avoid dusty enclosed cleanup areas without PPE.
```

---

# Event Graph

Everything becomes connected:

```text
People
Places
Events
Weather
Infrastructure
Disease
Markets
Transportation
Military
Energy
Communications
Government alerts
```

Edges:

```text
near
caused_by
affects
amplifies
precedes
follows
contradicts
confirms
```

---

# Explainability Layer

Every alert must answer:

- Why am I seeing this?
- What changed?
- How certain is this?
- What else is connected?
- What would make this worse?
- What should I watch next?
- What should I do?

Crystal Ball should NEVER become a black box.

---

# UI Concepts

## Threat Card

```text
CRYSTAL BALL ALERT

Pattern:
Biological + Weather + Exposure

Threat Level:
Elevated

Confidence:
62%

User Relevance:
High

Why It Matters:
Environmental conditions align with multiple health signals.

Watch:
County alerts, hospital language, closures.

Action:
Monitor and avoid exposure conditions.
```

---

# Implementation Plan

## Phase 1

- Build ThreatEvent schema
- Normalize all APIs
- Store severity/confidence/location

## Phase 2

- Add source trust scoring
- Add explainable scoring

## Phase 3

- Add event clustering
- Merge duplicates

## Phase 4

- Add user exposure logic
- Add saved places

## Phase 5

- Build spatial + temporal correlation

## Phase 6

- Add anomaly detection

## Phase 7

- Add scenario generation

## Phase 8

- Build graph visualization

## Phase 9

- Add cascade modeling

---

# Claude Instructions

Claude:

Implement incrementally.

Start with:

1. Create shared ThreatEvent type.
2. Normalize all APIs into ThreatEvent.
3. Create sourceTrust.ts.
4. Create threatScore.ts.
5. Create correlationEngine.ts.
6. Create personalExposure.ts.
7. Create scenarioEngine.ts.
8. Add explainability output.
9. Add threat score UI.
10. Add relationship graph later.

Important:

Every alert must explain WHY it exists.

---

# Final Goal

Crystal Ball should feel like:

> A living intelligence system watching the world breathe in real time.

Not just an alert feed.

A pattern-detection engine that helps users understand what matters before everyone else sees it clearly.
