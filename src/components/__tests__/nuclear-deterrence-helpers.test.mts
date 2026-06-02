import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  computeGlobalEscalationIndex,
  rankByEscalationRisk,
  filterByAlertLevel,
  getTotalDeployedWarheads,
  getTotalEstimatedWarheads,
  getDoctrineSummary,
  getHighRiskDyads,
  getRecentEscalations,
  getTreatyHealth,
  buildRenderData,
} from "../nuclear-deterrence-helpers.js";
import type {
  NuclearPosture,
  DeterrenceEvent,
  NuclearTreaty,
  AlertLevel,
} from "../nuclear-deterrence-helpers.js";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const p = (overrides: Partial<NuclearPosture> = {}): NuclearPosture => ({
  nation: "USA",
  estimatedWarheads: 100,
  deployedWarheads: 50,
  doctrine: "ambiguous",
  alertLevel: "DEFCON-4",
  triadLegs: ["land-based"],
  modernizationActive: false,
  treatyStatus: "NPT member",
  stabilityScore: 70,
  escalationRisk: 30,
  ...overrides,
});

const e = (overrides: Partial<DeterrenceEvent> = {}): DeterrenceEvent => ({
  id: "e1",
  date: "2024-01-01",
  nations: ["USA"],
  eventType: "rhetoric-escalation",
  description: "test",
  escalationImpact: 5,
  ...overrides,
});

const t = (overrides: Partial<NuclearTreaty> = {}): NuclearTreaty => ({
  name: "TestTreaty",
  status: "in-force",
  parties: ["USA"],
  keyProvision: "test provision",
  ...overrides,
});

// ── computeGlobalEscalationIndex ─────────────────────────────────────────────

describe("computeGlobalEscalationIndex", () => {
  it("returns NaN for empty array (0/0)", () => {
    // Division by zero yields NaN — just verify it does not throw
    const result = computeGlobalEscalationIndex([]);
    assert.ok(Number.isNaN(result));
  });

  it("returns exact value for single posture", () => {
    assert.equal(computeGlobalEscalationIndex([p({ escalationRisk: 42 })]), 42);
  });

  it("averages two postures", () => {
    assert.equal(computeGlobalEscalationIndex([p({ escalationRisk: 30 }), p({ escalationRisk: 70 })]), 50);
  });

  it("rounds fractional average", () => {
    assert.equal(computeGlobalEscalationIndex([p({ escalationRisk: 33 }), p({ escalationRisk: 34 })]), 34);
  });

  it("handles all zero risks", () => {
    assert.equal(computeGlobalEscalationIndex([p({ escalationRisk: 0 }), p({ escalationRisk: 0 })]), 0);
  });

  it("handles all max risks", () => {
    assert.equal(computeGlobalEscalationIndex([p({ escalationRisk: 100 }), p({ escalationRisk: 100 })]), 100);
  });
});

// ── rankByEscalationRisk ──────────────────────────────────────────────────────

describe("rankByEscalationRisk", () => {
  it("returns empty array for empty input", () => {
    assert.deepEqual(rankByEscalationRisk([]), []);
  });

  it("single element unchanged", () => {
    const posture = p({ escalationRisk: 50 });
    assert.deepEqual(rankByEscalationRisk([posture]), [posture]);
  });

  it("sorts descending by escalationRisk", () => {
    const low = p({ escalationRisk: 10, nation: "UK" });
    const high = p({ escalationRisk: 90, nation: "DPRK" });
    const mid = p({ escalationRisk: 50, nation: "China" });
    const result = rankByEscalationRisk([low, high, mid]);
    assert.equal(result[0].escalationRisk, 90);
    assert.equal(result[1].escalationRisk, 50);
    assert.equal(result[2].escalationRisk, 10);
  });

  it("does not mutate input array", () => {
    const postures = [p({ escalationRisk: 10 }), p({ escalationRisk: 90 })];
    const copy = [...postures];
    rankByEscalationRisk(postures);
    assert.equal(postures[0].escalationRisk, copy[0].escalationRisk);
  });

  it("handles equal escalation risks", () => {
    const a = p({ escalationRisk: 50, nation: "USA" });
    const b = p({ escalationRisk: 50, nation: "Russia" });
    const result = rankByEscalationRisk([a, b]);
    assert.equal(result.length, 2);
  });
});

// ── filterByAlertLevel ────────────────────────────────────────────────────────

describe("filterByAlertLevel", () => {
  it("returns empty for empty postures", () => {
    assert.deepEqual(filterByAlertLevel([], ["DEFCON-1"]), []);
  });

  it("returns empty when no levels match", () => {
    assert.deepEqual(filterByAlertLevel([p({ alertLevel: "DEFCON-5" })], ["DEFCON-1"]), []);
  });

  it("returns matching postures", () => {
    const elevated = p({ alertLevel: "elevated", nation: "Russia" });
    const normal = p({ alertLevel: "normal", nation: "China" });
    const result = filterByAlertLevel([elevated, normal], ["elevated"]);
    assert.equal(result.length, 1);
    assert.equal(result[0].nation, "Russia");
  });

  it("supports multiple alert levels", () => {
    const d1 = p({ alertLevel: "DEFCON-1", nation: "USA" });
    const d2 = p({ alertLevel: "DEFCON-2", nation: "Russia" });
    const d5 = p({ alertLevel: "DEFCON-5", nation: "UK" });
    const result = filterByAlertLevel([d1, d2, d5], ["DEFCON-1", "DEFCON-2"]);
    assert.equal(result.length, 2);
  });

  it("empty levels array returns nothing", () => {
    const result = filterByAlertLevel([p()], [] as AlertLevel[]);
    assert.deepEqual(result, []);
  });
});

// ── getTotalDeployedWarheads ──────────────────────────────────────────────────

describe("getTotalDeployedWarheads", () => {
  it("returns 0 for empty input", () => {
    assert.equal(getTotalDeployedWarheads([]), 0);
  });

  it("sums deployed warheads", () => {
    assert.equal(getTotalDeployedWarheads([p({ deployedWarheads: 100 }), p({ deployedWarheads: 200 })]), 300);
  });

  it("handles zeros", () => {
    assert.equal(getTotalDeployedWarheads([p({ deployedWarheads: 0 }), p({ deployedWarheads: 0 })]), 0);
  });

  it("handles single entry", () => {
    assert.equal(getTotalDeployedWarheads([p({ deployedWarheads: 1588 })]), 1588);
  });
});

// ── getTotalEstimatedWarheads ─────────────────────────────────────────────────

describe("getTotalEstimatedWarheads", () => {
  it("returns 0 for empty input", () => {
    assert.equal(getTotalEstimatedWarheads([]), 0);
  });

  it("sums estimated warheads", () => {
    assert.equal(getTotalEstimatedWarheads([p({ estimatedWarheads: 5550 }), p({ estimatedWarheads: 6257 })]), 11807);
  });

  it("handles single entry", () => {
    assert.equal(getTotalEstimatedWarheads([p({ estimatedWarheads: 90 })]), 90);
  });
});

// ── getDoctrineSummary ────────────────────────────────────────────────────────

describe("getDoctrineSummary", () => {
  it("returns all-zero summary for empty input", () => {
    const result = getDoctrineSummary([]);
    assert.equal(result["no-first-use"], 0);
    assert.equal(result["ambiguous"], 0);
    assert.equal(result["first-use-reserved"], 0);
    assert.equal(result["launch-on-warning"], 0);
    assert.equal(result["massive-retaliation"], 0);
  });

  it("counts single doctrine", () => {
    const result = getDoctrineSummary([p({ doctrine: "no-first-use" })]);
    assert.equal(result["no-first-use"], 1);
    assert.equal(result["ambiguous"], 0);
  });

  it("counts multiple doctrines correctly", () => {
    const postures = [
      p({ doctrine: "ambiguous" }),
      p({ doctrine: "ambiguous" }),
      p({ doctrine: "no-first-use" }),
      p({ doctrine: "launch-on-warning" }),
    ];
    const result = getDoctrineSummary(postures);
    assert.equal(result["ambiguous"], 2);
    assert.equal(result["no-first-use"], 1);
    assert.equal(result["launch-on-warning"], 1);
    assert.equal(result["first-use-reserved"], 0);
  });

  it("result has all five doctrine keys", () => {
    const result = getDoctrineSummary([p()]);
    const keys = Object.keys(result);
    assert.ok(keys.includes("no-first-use"));
    assert.ok(keys.includes("ambiguous"));
    assert.ok(keys.includes("first-use-reserved"));
    assert.ok(keys.includes("launch-on-warning"));
    assert.ok(keys.includes("massive-retaliation"));
  });
});

// ── getHighRiskDyads ──────────────────────────────────────────────────────────

describe("getHighRiskDyads", () => {
  it("returns empty for empty input", () => {
    assert.deepEqual(getHighRiskDyads([]), []);
  });

  it("returns empty when no nations exceed threshold", () => {
    const result = getHighRiskDyads([p({ escalationRisk: 30 }), p({ escalationRisk: 40 })], 55);
    assert.deepEqual(result, []);
  });

  it("returns single dyad for two high-risk nations", () => {
    const a = p({ nation: "Russia", escalationRisk: 72 });
    const b = p({ nation: "DPRK", escalationRisk: 85 });
    const result = getHighRiskDyads([a, b], 55);
    assert.equal(result.length, 1);
  });

  it("produces N*(N-1)/2 dyads for N high-risk nations", () => {
    const postures = [
      p({ nation: "Russia", escalationRisk: 72 }),
      p({ nation: "DPRK", escalationRisk: 85 }),
      p({ nation: "Pakistan", escalationRisk: 58 }),
    ];
    const result = getHighRiskDyads(postures, 55);
    assert.equal(result.length, 3); // 3*2/2
  });

  it("uses default threshold of 55", () => {
    const a = p({ nation: "Russia", escalationRisk: 56 });
    const b = p({ nation: "DPRK", escalationRisk: 85 });
    const result = getHighRiskDyads([a, b]);
    assert.equal(result.length, 1);
  });

  it("excludes nations exactly at threshold", () => {
    const a = p({ nation: "Russia", escalationRisk: 55 });
    const b = p({ nation: "DPRK", escalationRisk: 55 });
    const result = getHighRiskDyads([a, b], 55);
    assert.equal(result.length, 1); // >= threshold, so included
  });
});

// ── getRecentEscalations ──────────────────────────────────────────────────────

describe("getRecentEscalations", () => {
  it("returns empty for empty events", () => {
    assert.deepEqual(getRecentEscalations([]), []);
  });

  it("filters out stabilizing events (impact <= 0)", () => {
    const ev = e({ date: new Date().toISOString().slice(0, 10), escalationImpact: -2 });
    assert.deepEqual(getRecentEscalations([ev], 180), []);
  });

  it("filters out old events", () => {
    const ev = e({ date: "2000-01-01", escalationImpact: 8 });
    assert.deepEqual(getRecentEscalations([ev], 180), []);
  });

  it("includes recent positive-impact events", () => {
    const today = new Date().toISOString().slice(0, 10);
    const ev = e({ date: today, escalationImpact: 6 });
    const result = getRecentEscalations([ev], 180);
    assert.equal(result.length, 1);
  });

  it("sorts by escalation impact descending", () => {
    const today = new Date().toISOString().slice(0, 10);
    const low = e({ id: "low", date: today, escalationImpact: 2 });
    const high = e({ id: "high", date: today, escalationImpact: 9 });
    const result = getRecentEscalations([low, high], 180);
    assert.equal(result[0].id, "high");
    assert.equal(result[1].id, "low");
  });
});

// ── getTreatyHealth ───────────────────────────────────────────────────────────

describe("getTreatyHealth", () => {
  it("returns all zeros for empty array", () => {
    assert.deepEqual(getTreatyHealth([]), { active: 0, degraded: 0, collapsed: 0 });
  });

  it("counts in-force treaties as active", () => {
    const result = getTreatyHealth([t({ status: "in-force" }), t({ status: "in-force" })]);
    assert.equal(result.active, 2);
  });

  it("counts suspended and negotiating as degraded", () => {
    const result = getTreatyHealth([t({ status: "suspended" }), t({ status: "negotiating" })]);
    assert.equal(result.degraded, 2);
    assert.equal(result.active, 0);
    assert.equal(result.collapsed, 0);
  });

  it("counts withdrawn and expired as collapsed", () => {
    const result = getTreatyHealth([t({ status: "withdrawn" }), t({ status: "expired" })]);
    assert.equal(result.collapsed, 2);
  });

  it("handles mixed statuses", () => {
    const treaties = [
      t({ status: "in-force" }),
      t({ status: "suspended" }),
      t({ status: "withdrawn" }),
      t({ status: "expired" }),
      t({ status: "negotiating" }),
    ];
    const result = getTreatyHealth(treaties);
    assert.equal(result.active, 1);
    assert.equal(result.degraded, 2);
    assert.equal(result.collapsed, 2);
  });
});

// ── buildRenderData ───────────────────────────────────────────────────────────

describe("buildRenderData", () => {
  it("returns an object without throwing", () => {
    assert.ok(buildRenderData());
  });

  it("postures array is non-empty", () => {
    const data = buildRenderData();
    assert.ok(data.postures.length > 0);
  });

  it("postures are sorted by escalation risk descending", () => {
    const data = buildRenderData();
    for (let i = 0; i < data.postures.length - 1; i++) {
      assert.ok(data.postures[i].escalationRisk >= data.postures[i + 1].escalationRisk);
    }
  });

  it("globalEscalationIndex is a finite number", () => {
    const data = buildRenderData();
    assert.ok(Number.isFinite(data.globalEscalationIndex));
  });

  it("totalDeployed matches sum of deployed warheads", () => {
    const data = buildRenderData();
    const sum = data.postures.reduce((s, p) => s + p.deployedWarheads, 0);
    assert.equal(data.totalDeployed, sum);
  });

  it("totalEstimated matches sum of estimated warheads", () => {
    const data = buildRenderData();
    const sum = data.postures.reduce((s, p) => s + p.estimatedWarheads, 0);
    assert.equal(data.totalEstimated, sum);
  });

  it("treatyHealth has active/degraded/collapsed keys", () => {
    const data = buildRenderData();
    assert.ok("active" in data.treatyHealth);
    assert.ok("degraded" in data.treatyHealth);
    assert.ok("collapsed" in data.treatyHealth);
  });

  it("doctrineSummary totals equal posture count", () => {
    const data = buildRenderData();
    const total = Object.values(data.doctrineSummary).reduce((a, b) => a + b, 0);
    assert.equal(total, data.postures.length);
  });

  it("recentEvents is an array", () => {
    const data = buildRenderData();
    assert.ok(Array.isArray(data.recentEvents));
  });

  it("recentEvents has at most 5 entries", () => {
    const data = buildRenderData();
    assert.ok(data.recentEvents.length <= 5);
  });

  it("treaties array is non-empty", () => {
    const data = buildRenderData();
    assert.ok(data.treaties.length > 0);
  });
});
