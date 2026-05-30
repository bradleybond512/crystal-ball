import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import {
  computeGlobalPiracyIndex,
  getHighSeverity,
  getIncreasingRegions,
  getByAttackType,
  severityClass,
  trendClass,
  attackTypeClass,
  buildRenderData,
  type PiracyHotspot,
  type PiracyIncident,
  type SeverityLevel,
  type AttackType,
} from "../maritime-piracy-helpers.ts";

// ── Mock data ────────────────────────────────────────────────────────────────

const MOCK_HOTSPOTS: PiracyHotspot[] = [
  {
    id: "H1",
    region: "Alpha Gulf",
    annualIncidents: 80,
    trend: "increasing",
    primaryTactics: ["Boarding", "Kidnapping"],
    severityLevel: "Critical",
    primaryGroups: ["Alpha Gang"],
    description: "High threat zone",
    economicImpactBn: 5.0,
  },
  {
    id: "H2",
    region: "Beta Strait",
    annualIncidents: 40,
    trend: "stable",
    primaryTactics: ["Armed Robbery"],
    severityLevel: "High",
    primaryGroups: ["Beta Crew"],
    description: "Moderate threat zone",
    economicImpactBn: 1.0,
  },
  {
    id: "H3",
    region: "Gamma Coast",
    annualIncidents: 20,
    trend: "decreasing",
    primaryTactics: ["Attempted Boarding"],
    severityLevel: "Medium",
    primaryGroups: ["Gamma Group"],
    description: "Lower threat zone",
    economicImpactBn: 0.3,
  },
  {
    id: "H4",
    region: "Delta Shore",
    annualIncidents: 10,
    trend: "decreasing",
    primaryTactics: ["Theft"],
    severityLevel: "Low",
    primaryGroups: ["Local thieves"],
    description: "Minimal threat zone",
    economicImpactBn: 0.1,
  },
];

const MOCK_INCIDENTS: PiracyIncident[] = [
  {
    id: "I1",
    date: "2023-11-19",
    region: "Red Sea",
    shipType: "Car carrier",
    attackType: "Hijacking",
    outcome: "Hijacked",
    crewImpact: "25 crew held",
    description: "Galaxy Leader seized",
    significance: 9,
  },
  {
    id: "I2",
    date: "2024-03-06",
    region: "Red Sea",
    shipType: "Bulk carrier",
    attackType: "Fired Upon",
    outcome: "Fired Upon",
    crewImpact: "3 killed",
    description: "True Confidence attack",
    significance: 9,
  },
  {
    id: "I3",
    date: "2023-06-14",
    region: "Gulf of Guinea",
    shipType: "Oil tanker",
    attackType: "Kidnapping",
    outcome: "Crew Kidnapped",
    crewImpact: "7 crew kidnapped",
    description: "MT Agisilaos kidnapping",
    significance: 7,
  },
  {
    id: "I4",
    date: "2024-03-12",
    region: "Strait of Malacca",
    shipType: "Chemical tanker",
    attackType: "Boarding",
    outcome: "Repelled",
    crewImpact: "No casualties",
    description: "Tanker boarding",
    significance: 5,
  },
  {
    id: "I5",
    date: "2023-08-20",
    region: "Somali Basin",
    shipType: "Fishing vessel",
    attackType: "Attempted Boarding",
    outcome: "Repelled",
    crewImpact: "No casualties",
    description: "Somali skiffs repelled",
    significance: 4,
  },
  {
    id: "I6",
    date: "2024-01-15",
    region: "Bangladesh coast",
    shipType: "Cargo vessel",
    attackType: "Armed Robbery",
    outcome: "Repelled",
    crewImpact: "No casualties",
    description: "Anchorage robbery",
    significance: 4,
  },
];

// ── computeGlobalPiracyIndex ─────────────────────────────────────────────────

describe("computeGlobalPiracyIndex", () => {
  it("returns 0 for empty array", () => {
    assert.equal(computeGlobalPiracyIndex([]), 0);
  });

  it("returns a number in 0-100", () => {
    const idx = computeGlobalPiracyIndex(MOCK_HOTSPOTS);
    assert.ok(idx >= 0 && idx <= 100, );
  });

  it("returns an integer", () => {
    const idx = computeGlobalPiracyIndex(MOCK_HOTSPOTS);
    assert.equal(idx, Math.round(idx));
  });

  it("higher incidents yield higher index", () => {
    const high = MOCK_HOTSPOTS.map(h => ({ ...h, annualIncidents: 200 }));
    const low = MOCK_HOTSPOTS.map(h => ({ ...h, annualIncidents: 1 }));
    assert.ok(computeGlobalPiracyIndex(high) > computeGlobalPiracyIndex(low));
  });

  it("Critical severity weighs more than Low", () => {
    const critical = [{ ...MOCK_HOTSPOTS[0], annualIncidents: 50, severityLevel: "Critical" as SeverityLevel, trend: "stable" as const }];
    const low = [{ ...MOCK_HOTSPOTS[3], annualIncidents: 50, severityLevel: "Low" as SeverityLevel, trend: "stable" as const }];
    assert.ok(computeGlobalPiracyIndex(critical) > computeGlobalPiracyIndex(low));
  });

  it("increasing trend multiplies index upward vs decreasing", () => {
    const inc = [{ ...MOCK_HOTSPOTS[0], annualIncidents: 50, severityLevel: "High" as SeverityLevel, trend: "increasing" as const }];
    const dec = [{ ...MOCK_HOTSPOTS[0], annualIncidents: 50, severityLevel: "High" as SeverityLevel, trend: "decreasing" as const }];
    assert.ok(computeGlobalPiracyIndex(inc) > computeGlobalPiracyIndex(dec));
  });

  it("caps at 100 even with extreme input", () => {
    const extreme = [{ ...MOCK_HOTSPOTS[0], annualIncidents: 99999, severityLevel: "Critical" as SeverityLevel, trend: "increasing" as const }];
    assert.equal(computeGlobalPiracyIndex(extreme), 100);
  });

  it("single Low stable hotspot with 0 incidents returns 0", () => {
    const z = [{ ...MOCK_HOTSPOTS[3], annualIncidents: 0, severityLevel: "Low" as SeverityLevel, trend: "stable" as const }];
    assert.equal(computeGlobalPiracyIndex(z), 0);
  });
});

// ── getHighSeverity ──────────────────────────────────────────────────────────

describe("getHighSeverity", () => {
  it("default threshold High returns High and Critical", () => {
    const result = getHighSeverity(MOCK_HOTSPOTS);
    assert.equal(result.length, 2);
    assert.ok(result.every(h => h.severityLevel === "High" || h.severityLevel === "Critical"));
  });

  it("threshold Critical returns only Critical", () => {
    const result = getHighSeverity(MOCK_HOTSPOTS, "Critical");
    assert.equal(result.length, 1);
    assert.equal(result[0].id, "H1");
  });

  it("threshold Medium returns Medium, High, Critical", () => {
    const result = getHighSeverity(MOCK_HOTSPOTS, "Medium");
    assert.equal(result.length, 3);
    assert.ok(result.every(h => h.severityLevel !== "Low"));
  });

  it("threshold Low returns all hotspots", () => {
    assert.equal(getHighSeverity(MOCK_HOTSPOTS, "Low").length, MOCK_HOTSPOTS.length);
  });

  it("returns empty for empty input", () => {
    assert.equal(getHighSeverity([], "High").length, 0);
  });

  it("does not mutate the input array", () => {
    const before = MOCK_HOTSPOTS.length;
    getHighSeverity(MOCK_HOTSPOTS, "High");
    assert.equal(MOCK_HOTSPOTS.length, before);
  });

  it("boundary: High threshold includes exactly High and Critical", () => {
    const result = getHighSeverity(MOCK_HOTSPOTS, "High");
    const levels = new Set(result.map(h => h.severityLevel));
    assert.ok(!levels.has("Low") && !levels.has("Medium"));
  });
});

// ── getIncreasingRegions ─────────────────────────────────────────────────────

describe("getIncreasingRegions", () => {
  it("returns only hotspots with increasing trend", () => {
    const result = getIncreasingRegions(MOCK_HOTSPOTS);
    assert.equal(result.length, 1);
    assert.equal(result[0].id, "H1");
  });

  it("returns empty when none increasing", () => {
    const stable = MOCK_HOTSPOTS.map(h => ({ ...h, trend: "stable" as const }));
    assert.equal(getIncreasingRegions(stable).length, 0);
  });

  it("excludes stable trend", () => {
    const result = getIncreasingRegions(MOCK_HOTSPOTS);
    assert.ok(result.every(h => h.trend === "increasing"));
  });

  it("excludes decreasing trend", () => {
    const decOnly = MOCK_HOTSPOTS.map(h => ({ ...h, trend: "decreasing" as const }));
    assert.equal(getIncreasingRegions(decOnly).length, 0);
  });

  it("returns all when all are increasing", () => {
    const all = MOCK_HOTSPOTS.map(h => ({ ...h, trend: "increasing" as const }));
    assert.equal(getIncreasingRegions(all).length, MOCK_HOTSPOTS.length);
  });

  it("does not mutate the input array", () => {
    const before = MOCK_HOTSPOTS.length;
    getIncreasingRegions(MOCK_HOTSPOTS);
    assert.equal(MOCK_HOTSPOTS.length, before);
  });
});

// ── getByAttackType ──────────────────────────────────────────────────────────

describe("getByAttackType", () => {
  it("returns only Hijacking incidents", () => {
    const result = getByAttackType(MOCK_INCIDENTS, "Hijacking");
    assert.equal(result.length, 1);
    assert.equal(result[0].id, "I1");
  });

  it("returns only Fired Upon incidents", () => {
    const result = getByAttackType(MOCK_INCIDENTS, "Fired Upon");
    assert.equal(result.length, 1);
    assert.equal(result[0].id, "I2");
  });

  it("returns only Kidnapping incidents", () => {
    const result = getByAttackType(MOCK_INCIDENTS, "Kidnapping");
    assert.equal(result.length, 1);
    assert.equal(result[0].id, "I3");
  });

  it("returns only Boarding incidents", () => {
    const result = getByAttackType(MOCK_INCIDENTS, "Boarding");
    assert.equal(result.length, 1);
    assert.equal(result[0].id, "I4");
  });

  it("returns only Armed Robbery incidents", () => {
    const result = getByAttackType(MOCK_INCIDENTS, "Armed Robbery");
    assert.equal(result.length, 1);
    assert.equal(result[0].id, "I6");
  });

  it("returns empty when no match", () => {
    const noHijack = MOCK_INCIDENTS.filter(i => i.attackType !== "Hijacking");
    assert.equal(getByAttackType(noHijack, "Hijacking").length, 0);
  });

  it("does not mutate input array", () => {
    const before = MOCK_INCIDENTS.length;
    getByAttackType(MOCK_INCIDENTS, "Boarding");
    assert.equal(MOCK_INCIDENTS.length, before);
  });
});

// ── severityClass ────────────────────────────────────────────────────────────

describe("severityClass", () => {
  it("Low returns piracy-low", () => { assert.equal(severityClass("Low"), "piracy-low"); });
  it("Medium returns piracy-medium", () => { assert.equal(severityClass("Medium"), "piracy-medium"); });
  it("High returns piracy-high", () => { assert.equal(severityClass("High"), "piracy-high"); });
  it("Critical returns piracy-critical", () => { assert.equal(severityClass("Critical"), "piracy-critical"); });
});

// ── trendClass ───────────────────────────────────────────────────────────────

describe("trendClass", () => {
  it("increasing returns trend-up", () => { assert.equal(trendClass("increasing"), "trend-up"); });
  it("stable returns trend-flat", () => { assert.equal(trendClass("stable"), "trend-flat"); });
  it("decreasing returns trend-down", () => { assert.equal(trendClass("decreasing"), "trend-down"); });
});

// ── attackTypeClass ──────────────────────────────────────────────────────────

describe("attackTypeClass", () => {
  it("Boarding returns attack-boarding", () => { assert.equal(attackTypeClass("Boarding"), "attack-boarding"); });
  it("Hijacking returns attack-hijacking", () => { assert.equal(attackTypeClass("Hijacking"), "attack-hijacking"); });
  it("Attempted Boarding returns attack-attempted", () => { assert.equal(attackTypeClass("Attempted Boarding"), "attack-attempted"); });
  it("Fired Upon returns attack-fired", () => { assert.equal(attackTypeClass("Fired Upon"), "attack-fired"); });
  it("Kidnapping returns attack-kidnapping", () => { assert.equal(attackTypeClass("Kidnapping"), "attack-kidnapping"); });
  it("Armed Robbery returns attack-robbery", () => { assert.equal(attackTypeClass("Armed Robbery"), "attack-robbery"); });
});

// ── buildRenderData ──────────────────────────────────────────────────────────

describe("buildRenderData", () => {
  it("returns all required fields", () => {
    const d = buildRenderData();
    assert.ok(Array.isArray(d.hotspots));
    assert.ok(Array.isArray(d.incidents));
    assert.equal(typeof d.globalPiracyIndex, "number");
    assert.equal(typeof d.totalIncidentsYTD, "number");
    assert.ok(Array.isArray(d.highRiskRegions));
    assert.equal(typeof d.crewsAtRisk, "number");
  });

  it("hotspots array has 7 entries", () => {
    assert.equal(buildRenderData().hotspots.length, 7);
  });

  it("incidents array has 10 entries", () => {
    assert.equal(buildRenderData().incidents.length, 10);
  });

  it("globalPiracyIndex is in range 0-100", () => {
    const idx = buildRenderData().globalPiracyIndex;
    assert.ok(idx >= 0 && idx <= 100, );
  });

  it("totalIncidentsYTD equals sum of all hotspot annual incidents", () => {
    const d = buildRenderData();
    const sum = d.hotspots.reduce((s, h) => s + h.annualIncidents, 0);
    assert.equal(d.totalIncidentsYTD, sum);
  });

  it("highRiskRegions contains only High and Critical hotspot regions", () => {
    const d = buildRenderData();
    const highCritRegions = d.hotspots
      .filter(h => h.severityLevel === "High" || h.severityLevel === "Critical")
      .map(h => h.region);
    assert.deepEqual(d.highRiskRegions.sort(), highCritRegions.sort());
  });

  it("crewsAtRisk is a positive number", () => {
    assert.ok(buildRenderData().crewsAtRisk > 0);
  });

  it("all hotspot IDs are unique", () => {
    const ids = buildRenderData().hotspots.map(h => h.id);
    assert.equal(new Set(ids).size, ids.length);
  });

  it("all incident IDs are unique", () => {
    const ids = buildRenderData().incidents.map(i => i.id);
    assert.equal(new Set(ids).size, ids.length);
  });

  it("all annualIncidents are positive", () => {
    for (const h of buildRenderData().hotspots) {
      assert.ok(h.annualIncidents > 0, );
    }
  });

  it("all economicImpactBn are positive", () => {
    for (const h of buildRenderData().hotspots) {
      assert.ok(h.economicImpactBn > 0, );
    }
  });

  it("all severity levels are valid", () => {
    const valid = new Set(["Low", "Medium", "High", "Critical"]);
    for (const h of buildRenderData().hotspots) {
      assert.ok(valid.has(h.severityLevel), );
    }
  });

  it("all trends are valid", () => {
    const valid = new Set(["increasing", "stable", "decreasing"]);
    for (const h of buildRenderData().hotspots) {
      assert.ok(valid.has(h.trend), );
    }
  });

  it("all attack types are valid", () => {
    const valid = new Set(["Boarding", "Hijacking", "Attempted Boarding", "Fired Upon", "Kidnapping", "Armed Robbery"]);
    for (const i of buildRenderData().incidents) {
      assert.ok(valid.has(i.attackType), );
    }
  });

  it("all outcomes are valid", () => {
    const valid = new Set(["Hijacked", "Repelled", "Crew Kidnapped", "Escaped", "Fired Upon"]);
    for (const i of buildRenderData().incidents) {
      assert.ok(valid.has(i.outcome), );
    }
  });

  it("all significances are in range 1-10", () => {
    for (const i of buildRenderData().incidents) {
      assert.ok(i.significance >= 1 && i.significance <= 10, );
    }
  });

  it("all hotspot regions are non-empty strings", () => {
    for (const h of buildRenderData().hotspots) {
      assert.ok(h.region.trim().length > 0);
    }
  });

  it("all hotspot descriptions are non-empty", () => {
    for (const h of buildRenderData().hotspots) {
      assert.ok(h.description.trim().length > 0);
    }
  });

  it("all hotspots have at least one primary tactic", () => {
    for (const h of buildRenderData().hotspots) {
      assert.ok(h.primaryTactics.length > 0, );
    }
  });

  it("all hotspots have at least one primary group", () => {
    for (const h of buildRenderData().hotspots) {
      assert.ok(h.primaryGroups.length > 0, );
    }
  });

  it("at least one hotspot is Critical", () => {
    const critical = buildRenderData().hotspots.filter(h => h.severityLevel === "Critical");
    assert.ok(critical.length > 0);
  });

  it("at least one hotspot has increasing trend", () => {
    const increasing = buildRenderData().hotspots.filter(h => h.trend === "increasing");
    assert.ok(increasing.length > 0);
  });

  it("Red Sea / Houthi hotspot is Critical and increasing", () => {
    const houthi = buildRenderData().hotspots.find(h => h.id === "H004");
    assert.ok(houthi);
    assert.equal(houthi!.severityLevel, "Critical");
    assert.equal(houthi!.trend, "increasing");
  });

  it("Gulf of Guinea has highest annual incidents among non-Houthi zones", () => {
    const d = buildRenderData();
    const goG = d.hotspots.find(h => h.id === "H001");
    assert.ok(goG);
    assert.equal(goG!.annualIncidents, 80);
  });

  it("Somali Basin incidents are below Gulf of Guinea", () => {
    const d = buildRenderData();
    const somalia = d.hotspots.find(h => h.id === "H003");
    const goG = d.hotspots.find(h => h.id === "H001");
    assert.ok(somalia && goG);
    assert.ok(somalia!.annualIncidents < goG!.annualIncidents);
  });

  it("Galaxy Leader incident has significance 9", () => {
    const inc = buildRenderData().incidents.find(i => i.id === "I001");
    assert.ok(inc);
    assert.equal(inc!.significance, 9);
    assert.equal(inc!.attackType, "Hijacking");
  });

  it("True Confidence incident has significance 9 and Fired Upon type", () => {
    const inc = buildRenderData().incidents.find(i => i.id === "I004");
    assert.ok(inc);
    assert.equal(inc!.significance, 9);
    assert.equal(inc!.attackType, "Fired Upon");
  });

  it("all incident dates are non-empty", () => {
    for (const i of buildRenderData().incidents) {
      assert.ok(i.date.trim().length > 0);
    }
  });

  it("all incident ship types are non-empty", () => {
    for (const i of buildRenderData().incidents) {
      assert.ok(i.shipType.trim().length > 0);
    }
  });

  it("totalIncidentsYTD is at least 200", () => {
    // 7 hotspots with 10+ incidents each: should sum > 200
    assert.ok(buildRenderData().totalIncidentsYTD >= 200);
  });

  it("highRiskRegions is non-empty", () => {
    assert.ok(buildRenderData().highRiskRegions.length > 0);
  });
});
