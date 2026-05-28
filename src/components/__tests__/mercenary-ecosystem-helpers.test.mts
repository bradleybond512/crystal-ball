import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  scorePMCThreat,
  rankBySponsor,
  filterByStatus,
  filterByTheater,
  computeTotalStrength,
  rankGroupsByThreat,
  getMostActiveTheater,
  getHumanRightsViolators,
  computeRecentIncidentRate,
  buildRenderData,
  PMCGroup,
  PMCIncident,
} from "../mercenary-ecosystem-helpers.js";

// ── Fixtures ──────────────────────────────────────────────────────────────────
const makeGroup = (overrides: Partial<PMCGroup> = {}): PMCGroup => ({
  id: "test",
  name: "Test PMC",
  sponsor: "USA",
  status: "active",
  estimatedStrength: 1000,
  activeTheaters: ["Iraq"],
  operationTypes: ["security"],
  humanRightsFlags: 0,
  revenueMUSD: 100,
  governmentAffiliation: 50,
  ...overrides,
});

const makeIncident = (overrides: Partial<PMCIncident> = {}): PMCIncident => ({
  id: "inc1",
  groupId: "test",
  date: "2024-01-01",
  country: "Iraq",
  type: "atrocity",
  description: "test incident",
  severity: 5,
  ...overrides,
});

// ── scorePMCThreat ─────────────────────────────────────────────────────────────
describe("scorePMCThreat", () => {
  it("returns 0 for zero-value group", () => {
    const g = makeGroup({ humanRightsFlags: 0, estimatedStrength: 0, revenueMUSD: 0, governmentAffiliation: 0 });
    assert.equal(scorePMCThreat(g), 0);
  });

  it("caps at 100", () => {
    const g = makeGroup({ humanRightsFlags: 10, estimatedStrength: 100000, revenueMUSD: 10000, governmentAffiliation: 100 });
    assert.ok(scorePMCThreat(g) <= 100);
  });

  it("higher HR flags increase score", () => {
    const low = makeGroup({ humanRightsFlags: 0, governmentAffiliation: 50, revenueMUSD: 100, estimatedStrength: 1000 });
    const high = makeGroup({ humanRightsFlags: 9, governmentAffiliation: 50, revenueMUSD: 100, estimatedStrength: 1000 });
    assert.ok(scorePMCThreat(high) > scorePMCThreat(low));
  });

  it("higher governmentAffiliation increases score", () => {
    const low = makeGroup({ governmentAffiliation: 10, humanRightsFlags: 0, revenueMUSD: 0, estimatedStrength: 0 });
    const high = makeGroup({ governmentAffiliation: 90, humanRightsFlags: 0, revenueMUSD: 0, estimatedStrength: 0 });
    assert.ok(scorePMCThreat(high) > scorePMCThreat(low));
  });

  it("strength factor capped at 30 personnel equivalent", () => {
    const g1 = makeGroup({ estimatedStrength: 60000, humanRightsFlags: 0, revenueMUSD: 0, governmentAffiliation: 0 });
    const g2 = makeGroup({ estimatedStrength: 200000, humanRightsFlags: 0, revenueMUSD: 0, governmentAffiliation: 0 });
    assert.equal(scorePMCThreat(g1), scorePMCThreat(g2));
  });

  it("returns integer", () => {
    const g = makeGroup();
    assert.ok(Number.isInteger(scorePMCThreat(g)));
  });

  it("wagner-like group scores above 80", () => {
    const g = makeGroup({ humanRightsFlags: 9, estimatedStrength: 50000, revenueMUSD: 3500, governmentAffiliation: 95 });
    assert.ok(scorePMCThreat(g) > 50);
  });

  it("low-profile group scores under 30", () => {
    const g = makeGroup({ humanRightsFlags: 1, estimatedStrength: 500, revenueMUSD: 50, governmentAffiliation: 10 });
    assert.ok(scorePMCThreat(g) < 30);
  });
});

// ── rankBySponsor ─────────────────────────────────────────────────────────────
describe("rankBySponsor", () => {
  it("groups by sponsor nation", () => {
    const groups = [
      makeGroup({ id: "a", sponsor: "Russia" }),
      makeGroup({ id: "b", sponsor: "USA" }),
      makeGroup({ id: "c", sponsor: "Russia" }),
    ];
    const result = rankBySponsor(groups);
    assert.equal(result["Russia"].length, 2);
    assert.equal(result["USA"].length, 1);
  });

  it("handles empty input", () => {
    assert.deepEqual(rankBySponsor([]), {});
  });

  it("all unique sponsors produce single-element arrays", () => {
    const groups = [
      makeGroup({ id: "a", sponsor: "Russia" }),
      makeGroup({ id: "b", sponsor: "China" }),
    ];
    const result = rankBySponsor(groups);
    assert.equal(result["Russia"].length, 1);
    assert.equal(result["China"].length, 1);
  });

  it("preserves group identity in output", () => {
    const g = makeGroup({ id: "unique-id", sponsor: "UAE" });
    const result = rankBySponsor([g]);
    assert.equal(result["UAE"][0].id, "unique-id");
  });
});

// ── filterByStatus ─────────────────────────────────────────────────────────────
describe("filterByStatus", () => {
  it("returns only active groups", () => {
    const groups = [
      makeGroup({ id: "a", status: "active" }),
      makeGroup({ id: "b", status: "sanctioned" }),
      makeGroup({ id: "c", status: "active" }),
    ];
    const result = filterByStatus(groups, "active");
    assert.equal(result.length, 2);
    assert.ok(result.every(g => g.status === "active"));
  });

  it("returns empty when no match", () => {
    const groups = [makeGroup({ status: "active" })];
    assert.deepEqual(filterByStatus(groups, "disbanded"), []);
  });

  it("returns rebranded correctly", () => {
    const groups = [
      makeGroup({ id: "a", status: "rebranded" }),
      makeGroup({ id: "b", status: "active" }),
    ];
    const result = filterByStatus(groups, "rebranded");
    assert.equal(result.length, 1);
    assert.equal(result[0].id, "a");
  });

  it("handles empty input", () => {
    assert.deepEqual(filterByStatus([], "active"), []);
  });
});

// ── filterByTheater ──────────────────────────────────────────────────────────
describe("filterByTheater", () => {
  it("returns groups active in given theater", () => {
    const groups = [
      makeGroup({ id: "a", activeTheaters: ["Ukraine", "Mali"] }),
      makeGroup({ id: "b", activeTheaters: ["Iraq"] }),
    ];
    const result = filterByTheater(groups, "Ukraine");
    assert.equal(result.length, 1);
    assert.equal(result[0].id, "a");
  });

  it("returns empty when no groups in theater", () => {
    const groups = [makeGroup({ activeTheaters: ["Iraq"] })];
    assert.deepEqual(filterByTheater(groups, "Antarctica"), []);
  });

  it("returns multiple groups in same theater", () => {
    const groups = [
      makeGroup({ id: "a", activeTheaters: ["Libya"] }),
      makeGroup({ id: "b", activeTheaters: ["Libya", "Mali"] }),
    ];
    assert.equal(filterByTheater(groups, "Libya").length, 2);
  });

  it("handles empty group list", () => {
    assert.deepEqual(filterByTheater([], "Iraq"), []);
  });
});

// ── computeTotalStrength ──────────────────────────────────────────────────────
describe("computeTotalStrength", () => {
  it("sums all personnel", () => {
    const groups = [
      makeGroup({ estimatedStrength: 1000 }),
      makeGroup({ estimatedStrength: 2000 }),
      makeGroup({ estimatedStrength: 3000 }),
    ];
    assert.equal(computeTotalStrength(groups), 6000);
  });

  it("returns 0 for empty list", () => {
    assert.equal(computeTotalStrength([]), 0);
  });

  it("handles single group", () => {
    assert.equal(computeTotalStrength([makeGroup({ estimatedStrength: 5000 })]), 5000);
  });

  it("handles large numbers without overflow", () => {
    const groups = Array(10).fill(null).map((_, i) => makeGroup({ id: String(i), estimatedStrength: 100000 }));
    assert.equal(computeTotalStrength(groups), 1000000);
  });
});

// ── rankGroupsByThreat ─────────────────────────────────────────────────────────
describe("rankGroupsByThreat", () => {
  it("sorts highest threat first", () => {
    const groups = [
      makeGroup({ id: "low", humanRightsFlags: 0, governmentAffiliation: 10, revenueMUSD: 10, estimatedStrength: 100 }),
      makeGroup({ id: "high", humanRightsFlags: 9, governmentAffiliation: 90, revenueMUSD: 3000, estimatedStrength: 50000 }),
    ];
    const result = rankGroupsByThreat(groups);
    assert.equal(result[0].id, "high");
    assert.equal(result[1].id, "low");
  });

  it("does not mutate original array", () => {
    const groups = [makeGroup({ id: "a" }), makeGroup({ id: "b" })];
    const original = [...groups];
    rankGroupsByThreat(groups);
    assert.equal(groups[0].id, original[0].id);
  });

  it("returns all groups", () => {
    const groups = [makeGroup({ id: "a" }), makeGroup({ id: "b" }), makeGroup({ id: "c" })];
    assert.equal(rankGroupsByThreat(groups).length, 3);
  });

  it("handles empty list", () => {
    assert.deepEqual(rankGroupsByThreat([]), []);
  });
});

// ── getMostActiveTheater ──────────────────────────────────────────────────────
describe("getMostActiveTheater", () => {
  it("returns theater appearing most across groups", () => {
    const groups = [
      makeGroup({ activeTheaters: ["Libya", "Mali"] }),
      makeGroup({ activeTheaters: ["Libya"] }),
      makeGroup({ activeTheaters: ["Mali"] }),
    ];
    assert.equal(getMostActiveTheater(groups), "Libya");
  });

  it("returns unknown for empty list", () => {
    assert.equal(getMostActiveTheater([]), "unknown");
  });

  it("handles group with no theaters", () => {
    const groups = [
      makeGroup({ activeTheaters: [] }),
      makeGroup({ activeTheaters: ["Iraq"] }),
    ];
    assert.equal(getMostActiveTheater(groups), "Iraq");
  });

  it("single theater group returns that theater", () => {
    assert.equal(getMostActiveTheater([makeGroup({ activeTheaters: ["Syria"] })]), "Syria");
  });
});

// ── getHumanRightsViolators ───────────────────────────────────────────────────
describe("getHumanRightsViolators", () => {
  it("returns groups with flags >= default 5", () => {
    const groups = [
      makeGroup({ id: "a", humanRightsFlags: 3 }),
      makeGroup({ id: "b", humanRightsFlags: 7 }),
      makeGroup({ id: "c", humanRightsFlags: 5 }),
    ];
    const result = getHumanRightsViolators(groups);
    assert.equal(result.length, 2);
    assert.ok(result.every(g => g.humanRightsFlags >= 5));
  });

  it("sorts highest flags first", () => {
    const groups = [
      makeGroup({ id: "a", humanRightsFlags: 5 }),
      makeGroup({ id: "b", humanRightsFlags: 9 }),
      makeGroup({ id: "c", humanRightsFlags: 7 }),
    ];
    const result = getHumanRightsViolators(groups);
    assert.equal(result[0].id, "b");
    assert.equal(result[1].id, "c");
  });

  it("respects custom minFlags threshold", () => {
    const groups = [
      makeGroup({ id: "a", humanRightsFlags: 3 }),
      makeGroup({ id: "b", humanRightsFlags: 7 }),
    ];
    const result = getHumanRightsViolators(groups, 3);
    assert.equal(result.length, 2);
  });

  it("returns empty when no violators", () => {
    const groups = [makeGroup({ humanRightsFlags: 0 })];
    assert.deepEqual(getHumanRightsViolators(groups), []);
  });
});

// ── computeRecentIncidentRate ─────────────────────────────────────────────────
describe("computeRecentIncidentRate", () => {
  const today = new Date().toISOString().slice(0, 10);
  const oldDate = "2010-01-01";

  it("counts incidents within lookback window", () => {
    const incidents = [
      makeIncident({ id: "a", date: today }),
      makeIncident({ id: "b", date: oldDate }),
    ];
    assert.equal(computeRecentIncidentRate(incidents, 365), 1);
  });

  it("returns 0 when all incidents are old", () => {
    const incidents = [makeIncident({ date: oldDate })];
    assert.equal(computeRecentIncidentRate(incidents, 365), 0);
  });

  it("returns 0 for empty incident list", () => {
    assert.equal(computeRecentIncidentRate([]), 0);
  });

  it("all today incidents counted with large lookback", () => {
    const incidents = [
      makeIncident({ id: "a", date: today }),
      makeIncident({ id: "b", date: today }),
      makeIncident({ id: "c", date: today }),
    ];
    assert.equal(computeRecentIncidentRate(incidents, 3650), 3);
  });

  it("respects custom lookback window", () => {
    const recentDate = new Date(Date.now() - 10 * 86400000).toISOString().slice(0, 10);
    const incidents = [
      makeIncident({ id: "a", date: recentDate }),
      makeIncident({ id: "b", date: oldDate }),
    ];
    assert.equal(computeRecentIncidentRate(incidents, 30), 1);
    assert.equal(computeRecentIncidentRate(incidents, 5), 0);
  });
});

// ── buildRenderData ───────────────────────────────────────────────────────────
describe("buildRenderData", () => {
  it("returns all required keys", () => {
    const data = buildRenderData();
    assert.ok("groups" in data);
    assert.ok("recentIncidents" in data);
    assert.ok("totalStrength" in data);
    assert.ok("mostActiveTheater" in data);
    assert.ok("humanRightsViolators" in data);
  });

  it("groups are sorted by threat descending", () => {
    const data = buildRenderData();
    const scores = data.groups.map(scorePMCThreat);
    for (let i = 1; i < scores.length; i++) {
      assert.ok(scores[i - 1] >= scores[i], "groups not sorted by threat");
    }
  });

  it("recentIncidents limited to 5", () => {
    const data = buildRenderData();
    assert.ok(data.recentIncidents.length <= 5);
  });

  it("recentIncidents sorted by date descending", () => {
    const data = buildRenderData();
    for (let i = 1; i < data.recentIncidents.length; i++) {
      assert.ok(data.recentIncidents[i - 1].date >= data.recentIncidents[i].date);
    }
  });

  it("totalStrength is positive", () => {
    const data = buildRenderData();
    assert.ok(data.totalStrength > 0);
  });

  it("mostActiveTheater is a non-empty string", () => {
    const data = buildRenderData();
    assert.ok(typeof data.mostActiveTheater === "string");
    assert.ok(data.mostActiveTheater.length > 0);
  });

  it("humanRightsViolators all have flags >= 5", () => {
    const data = buildRenderData();
    assert.ok(data.humanRightsViolators.every(g => g.humanRightsFlags >= 5));
  });

  it("humanRightsViolators sorted by flags descending", () => {
    const data = buildRenderData();
    for (let i = 1; i < data.humanRightsViolators.length; i++) {
      assert.ok(data.humanRightsViolators[i - 1].humanRightsFlags >= data.humanRightsViolators[i].humanRightsFlags);
    }
  });
});
