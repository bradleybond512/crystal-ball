import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import {
  computeGlobalNationalismIndex,
  getByResource,
  getHighRiskCountries,
  getRecentEvents,
  resourceConcentrationScore,
  nationalismClass,
  eventTypeClass,
  outcomeClass,
  volatilityClass,
  buildRenderData,
  type NationalizationEvent,
  type CriticalResource,
  type CountryRiskProfile,
  type NationalismRiskLevel,
  type EventType,
  type NationalizationOutcome,
} from "../resource-nationalism-helpers.ts";

// ── Fixtures ─────────────────────────────────────────────────────────────────

const MOCK_EVENTS: NationalizationEvent[] = [
  { id: "E1", date: "2023-05-01", country: "Alpha", resource: "Lithium", eventType: "Nationalization", description: "Full nationalization", outcome: "Completed", economicImpactBn: 2.0, affectedCompanies: ["Acme Corp"], severity: 9 },
  { id: "E2", date: "2022-03-10", country: "Beta", resource: "Copper", eventType: "Export Ban", description: "Raw ore export ban", outcome: "Ongoing", economicImpactBn: 0.5, affectedCompanies: ["Globex"], severity: 6 },
  { id: "E3", date: "2021-07-20", country: "Gamma", resource: "Nickel", eventType: "Seizure", description: "Artisanal site seized", outcome: "Reversed", economicImpactBn: 0.1, affectedCompanies: ["Local miners"], severity: 4 },
  { id: "E4", date: "2024-01-01", country: "Delta", resource: "Rare Earths", eventType: "Export Ban", description: "Gallium/germanium ban", outcome: "Completed", economicImpactBn: 2.3, affectedCompanies: ["Chip makers"], severity: 10 },
  { id: "E5", date: "2020-06-15", country: "Epsilon", resource: "Oil", eventType: "Windfall Tax", description: "Oil windfall levy", outcome: "Completed", economicImpactBn: 1.2, affectedCompanies: ["PetroCorp"], severity: 5 },
];

const MOCK_RESOURCES: CriticalResource[] = [
  { id: "R1", name: "Cobalt", primaryProducers: ["DRC", "Russia"], topProducerSharePct: 74, supplyConcentrationHHI: 5600, weaponizationRisk: "Critical", strategicUse: "EV batteries", priceVolatility: "Extreme" },
  { id: "R2", name: "Copper", primaryProducers: ["Chile", "Peru"], topProducerSharePct: 28, supplyConcentrationHHI: 1400, weaponizationRisk: "Moderate", strategicUse: "Wiring", priceVolatility: "Moderate" },
  { id: "R3", name: "Palladium", primaryProducers: ["Russia", "South Africa"], topProducerSharePct: 44, supplyConcentrationHHI: 2900, weaponizationRisk: "High", strategicUse: "Catalytic converters", priceVolatility: "Extreme" },
  { id: "R4", name: "Silicon", primaryProducers: ["China"], topProducerSharePct: 79, supplyConcentrationHHI: 6400, weaponizationRisk: "Critical", strategicUse: "Solar, semiconductors", priceVolatility: "Moderate" },
];

const MOCK_COUNTRIES: CountryRiskProfile[] = [
  { id: "C1", country: "Alpha", region: "LA", nationalismScore: 90, riskLevel: "Critical", keyResources: ["Lithium"], recentActions: 2, trend: "Escalating", notes: "Repeat nationalizer" },
  { id: "C2", country: "Beta", region: "Africa", nationalismScore: 70, riskLevel: "High", keyResources: ["Copper"], recentActions: 1, trend: "Increasing", notes: "Export bans" },
  { id: "C3", country: "Gamma", region: "Asia", nationalismScore: 45, riskLevel: "Moderate", keyResources: ["Nickel"], recentActions: 1, trend: "Stable", notes: "Mixed signals" },
  { id: "C4", country: "Delta", region: "Europe", nationalismScore: 20, riskLevel: "Low", keyResources: ["Coal"], recentActions: 0, trend: "Decreasing", notes: "Stable investor climate" },
];

// ── computeGlobalNationalismIndex ─────────────────────────────────────────────

describe("computeGlobalNationalismIndex", () => {
  it("returns a number between 0 and 100", () => {
    const idx = computeGlobalNationalismIndex(MOCK_COUNTRIES);
    assert.ok(idx >= 0 && idx <= 100);
  });

  it("returns 0 for empty array", () => {
    assert.equal(computeGlobalNationalismIndex([]), 0);
  });

  it("higher scores yield higher index", () => {
    const high = MOCK_COUNTRIES.map(c => ({ ...c, nationalismScore: 95 }));
    const low = MOCK_COUNTRIES.map(c => ({ ...c, nationalismScore: 10 }));
    assert.ok(computeGlobalNationalismIndex(high) > computeGlobalNationalismIndex(low));
  });

  it("returns an integer", () => {
    const idx = computeGlobalNationalismIndex(MOCK_COUNTRIES);
    assert.equal(idx, Math.round(idx));
  });

  it("single country with score 100 returns 100", () => {
    const c = [{ ...MOCK_COUNTRIES[0], nationalismScore: 100 }];
    assert.equal(computeGlobalNationalismIndex(c), 100);
  });

  it("single country with score 50 returns 50", () => {
    const c = [{ ...MOCK_COUNTRIES[0], nationalismScore: 50 }];
    assert.equal(computeGlobalNationalismIndex(c), 50);
  });

  it("caps at 100 even if scores exceed", () => {
    const c = [{ ...MOCK_COUNTRIES[0], nationalismScore: 120 }];
    assert.ok(computeGlobalNationalismIndex(c) <= 100);
  });
});

// ── getByResource ─────────────────────────────────────────────────────────────

describe("getByResource", () => {
  it("returns events matching a resource name", () => {
    const results = getByResource(MOCK_EVENTS, "Lithium");
    assert.equal(results.length, 1);
    assert.equal(results[0].id, "E1");
  });

  it("is case-insensitive", () => {
    const results = getByResource(MOCK_EVENTS, "lithium");
    assert.equal(results.length, 1);
  });

  it("returns empty array for unknown resource", () => {
    const results = getByResource(MOCK_EVENTS, "Unobtanium");
    assert.equal(results.length, 0);
  });

  it("returns multiple matches when partial name matches", () => {
    const results = getByResource(MOCK_EVENTS, "oil");
    assert.ok(results.length >= 1);
  });

  it("returns empty array for empty events list", () => {
    assert.equal(getByResource([], "Lithium").length, 0);
  });
});

// ── getHighRiskCountries ──────────────────────────────────────────────────────

describe("getHighRiskCountries", () => {
  it("returns High and Critical by default", () => {
    const results = getHighRiskCountries(MOCK_COUNTRIES);
    assert.ok(results.every(c => c.riskLevel === "High" || c.riskLevel === "Critical"));
  });

  it("correct count for default threshold", () => {
    const results = getHighRiskCountries(MOCK_COUNTRIES);
    assert.equal(results.length, 2);
  });

  it("returns only Critical when specified", () => {
    const results = getHighRiskCountries(MOCK_COUNTRIES, ["Critical"]);
    assert.ok(results.every(c => c.riskLevel === "Critical"));
    assert.equal(results.length, 1);
  });

  it("returns all when all levels specified", () => {
    const results = getHighRiskCountries(MOCK_COUNTRIES, ["Low", "Moderate", "High", "Critical"]);
    assert.equal(results.length, MOCK_COUNTRIES.length);
  });

  it("returns empty array for empty input", () => {
    assert.equal(getHighRiskCountries([]).length, 0);
  });
});

// ── getRecentEvents ───────────────────────────────────────────────────────────

describe("getRecentEvents", () => {
  it("returns events from specified year onwards", () => {
    const results = getRecentEvents(MOCK_EVENTS, 2023);
    assert.ok(results.every(e => parseInt(e.date.slice(0, 4), 10) >= 2023));
  });

  it("default threshold 2022 includes 2022+", () => {
    const results = getRecentEvents(MOCK_EVENTS);
    assert.ok(results.every(e => parseInt(e.date.slice(0, 4), 10) >= 2022));
  });

  it("returns all events when year is very old", () => {
    const results = getRecentEvents(MOCK_EVENTS, 2000);
    assert.equal(results.length, MOCK_EVENTS.length);
  });

  it("returns empty for future year", () => {
    const results = getRecentEvents(MOCK_EVENTS, 2030);
    assert.equal(results.length, 0);
  });

  it("correct count for 2022 cutoff", () => {
    const results = getRecentEvents(MOCK_EVENTS, 2022);
    assert.ok(results.length >= 3);
  });
});

// ── resourceConcentrationScore ────────────────────────────────────────────────

describe("resourceConcentrationScore", () => {
  it("returns a number between 0 and 100", () => {
    for (const r of MOCK_RESOURCES) {
      const score = resourceConcentrationScore(r);
      assert.ok(score >= 0 && score <= 100, );
    }
  });

  it("higher HHI yields higher score (ceteris paribus)", () => {
    const lowHHI: CriticalResource = { ...MOCK_RESOURCES[0], supplyConcentrationHHI: 500, topProducerSharePct: 20 };
    const highHHI: CriticalResource = { ...MOCK_RESOURCES[0], supplyConcentrationHHI: 8000, topProducerSharePct: 80 };
    assert.ok(resourceConcentrationScore(highHHI) > resourceConcentrationScore(lowHHI));
  });

  it("returns an integer", () => {
    const score = resourceConcentrationScore(MOCK_RESOURCES[0]);
    assert.equal(score, Math.round(score));
  });

  it("cobalt scores higher than copper", () => {
    const cobalt = MOCK_RESOURCES.find(r => r.name === "Cobalt")!;
    const copper = MOCK_RESOURCES.find(r => r.name === "Copper")!;
    assert.ok(resourceConcentrationScore(cobalt) > resourceConcentrationScore(copper));
  });
});

// ── nationalismClass ──────────────────────────────────────────────────────────

describe("nationalismClass", () => {
  it("Low maps to nm-low", () => assert.equal(nationalismClass("Low"), "nm-low"));
  it("Moderate maps to nm-moderate", () => assert.equal(nationalismClass("Moderate"), "nm-moderate"));
  it("High maps to nm-high", () => assert.equal(nationalismClass("High"), "nm-high"));
  it("Critical maps to nm-critical", () => assert.equal(nationalismClass("Critical"), "nm-critical"));
  it("returns a non-empty string", () => {
    const levels: NationalismRiskLevel[] = ["Low", "Moderate", "High", "Critical"];
    for (const l of levels) assert.ok(nationalismClass(l).length > 0);
  });
});

// ── eventTypeClass ────────────────────────────────────────────────────────────

describe("eventTypeClass", () => {
  it("Nationalization maps to et-nationalization", () => assert.equal(eventTypeClass("Nationalization"), "et-nationalization"));
  it("Export Ban maps to et-export-ban", () => assert.equal(eventTypeClass("Export Ban"), "et-export-ban"));
  it("Seizure maps to et-seizure", () => assert.equal(eventTypeClass("Seizure"), "et-seizure"));
  it("Windfall Tax maps to et-windfall", () => assert.equal(eventTypeClass("Windfall Tax"), "et-windfall"));
  it("Forced Divestiture maps to et-divestiture", () => assert.equal(eventTypeClass("Forced Divestiture"), "et-divestiture"));
  it("License Revocation maps to et-revocation", () => assert.equal(eventTypeClass("License Revocation"), "et-revocation"));
  it("State Equity Demand maps to et-equity-demand", () => assert.equal(eventTypeClass("State Equity Demand"), "et-equity-demand"));
  it("returns a non-empty string for all types", () => {
    const types: EventType[] = ["Nationalization", "Export Ban", "Seizure", "Windfall Tax", "Forced Divestiture", "License Revocation", "State Equity Demand"];
    for (const t of types) assert.ok(eventTypeClass(t).length > 0);
  });
});

// ── outcomeClass ──────────────────────────────────────────────────────────────

describe("outcomeClass", () => {
  it("Completed maps to oc-completed", () => assert.equal(outcomeClass("Completed"), "oc-completed"));
  it("Ongoing maps to oc-ongoing", () => assert.equal(outcomeClass("Ongoing"), "oc-ongoing"));
  it("Reversed maps to oc-reversed", () => assert.equal(outcomeClass("Reversed"), "oc-reversed"));
  it("Negotiated Settlement maps to oc-settled", () => assert.equal(outcomeClass("Negotiated Settlement"), "oc-settled"));
  it("returns a non-empty string for all outcomes", () => {
    const outcomes: NationalizationOutcome[] = ["Completed", "Ongoing", "Reversed", "Negotiated Settlement"];
    for (const o of outcomes) assert.ok(outcomeClass(o).length > 0);
  });
});

// ── volatilityClass ───────────────────────────────────────────────────────────

describe("volatilityClass", () => {
  it("Low maps to vol-low", () => assert.equal(volatilityClass("Low"), "vol-low"));
  it("Moderate maps to vol-moderate", () => assert.equal(volatilityClass("Moderate"), "vol-moderate"));
  it("High maps to vol-high", () => assert.equal(volatilityClass("High"), "vol-high"));
  it("Extreme maps to vol-extreme", () => assert.equal(volatilityClass("Extreme"), "vol-extreme"));
});

// ── buildRenderData ───────────────────────────────────────────────────────────

describe("buildRenderData", () => {
  const data = buildRenderData();

  it("returns an object with events array", () => {
    assert.ok(Array.isArray(data.events));
    assert.ok(data.events.length > 0);
  });

  it("returns an object with resources array", () => {
    assert.ok(Array.isArray(data.resources));
    assert.ok(data.resources.length > 0);
  });

  it("returns an object with countries array", () => {
    assert.ok(Array.isArray(data.countries));
    assert.ok(data.countries.length > 0);
  });

  it("globalNationalismIndex is between 0 and 100", () => {
    assert.ok(data.globalNationalismIndex >= 0 && data.globalNationalismIndex <= 100);
  });

  it("globalNationalismIndex is an integer", () => {
    assert.equal(data.globalNationalismIndex, Math.round(data.globalNationalismIndex));
  });

  it("criticalEventCount >= 0", () => {
    assert.ok(data.criticalEventCount >= 0);
  });

  it("criticalEventCount matches events with severity >= 8", () => {
    const expected = data.events.filter(e => e.severity >= 8).length;
    assert.equal(data.criticalEventCount, expected);
  });

  it("highRiskResourceCount matches High+Critical resources", () => {
    const expected = data.resources.filter(r => r.weaponizationRisk === "High" || r.weaponizationRisk === "Critical").length;
    assert.equal(data.highRiskResourceCount, expected);
  });

  it("highRiskCountryCount matches High+Critical countries", () => {
    const expected = data.countries.filter(c => c.riskLevel === "High" || c.riskLevel === "Critical").length;
    assert.equal(data.highRiskCountryCount, expected);
  });

  it("mostRiskyResources has <= 4 entries", () => {
    assert.ok(data.mostRiskyResources.length <= 4);
  });

  it("mostRiskyResources are sorted by concentration score descending", () => {
    for (let i = 0; i < data.mostRiskyResources.length - 1; i++) {
      assert.ok(
        resourceConcentrationScore(data.mostRiskyResources[i]) >=
        resourceConcentrationScore(data.mostRiskyResources[i + 1]),
      );
    }
  });

  it("has at least 10 events in the dataset", () => {
    assert.ok(data.events.length >= 10);
  });

  it("has at least 8 resources in the dataset", () => {
    assert.ok(data.resources.length >= 8);
  });

  it("has at least 10 countries in the dataset", () => {
    assert.ok(data.countries.length >= 10);
  });

  it("each event has required fields", () => {
    for (const ev of data.events) {
      assert.ok(ev.id, "missing id");
      assert.ok(ev.date, "missing date");
      assert.ok(ev.country, "missing country");
      assert.ok(ev.resource, "missing resource");
      assert.ok(ev.description, "missing description");
      assert.ok(Array.isArray(ev.affectedCompanies), "affectedCompanies not array");
      assert.ok(ev.severity >= 1 && ev.severity <= 10, "severity out of range");
    }
  });

  it("each resource has required fields", () => {
    for (const r of data.resources) {
      assert.ok(r.id, "missing id");
      assert.ok(r.name, "missing name");
      assert.ok(Array.isArray(r.primaryProducers) && r.primaryProducers.length > 0, "missing producers");
      assert.ok(r.topProducerSharePct > 0 && r.topProducerSharePct <= 100, "producer share out of range");
      assert.ok(r.supplyConcentrationHHI >= 0, "negative HHI");
    }
  });

  it("each country has required fields", () => {
    for (const c of data.countries) {
      assert.ok(c.id, "missing id");
      assert.ok(c.country, "missing country");
      assert.ok(c.nationalismScore >= 0 && c.nationalismScore <= 100, "score out of range");
      assert.ok(Array.isArray(c.keyResources), "keyResources not array");
    }
  });

  it("globalNationalismIndex reflects high-scoring dataset", () => {
    // All countries in the real dataset are scored >= 55, so index should be well above 50
    assert.ok(data.globalNationalismIndex > 50);
  });

  it("Bolivia appears in events", () => {
    assert.ok(data.events.some(e => e.country === "Bolivia"));
  });

  it("Indonesia nickel export ban is present", () => {
    assert.ok(data.events.some(e => e.country === "Indonesia" && e.resource === "Nickel"));
  });

  it("China rare earth controls are present", () => {
    assert.ok(data.events.some(e => e.country === "China"));
  });

  it("cobalt is in the resources list", () => {
    assert.ok(data.resources.some(r => r.name === "Cobalt"));
  });
});
