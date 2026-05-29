import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyRiskLevel,
  filterByOutcome,
  filterByAcquirerNation,
  filterBySector,
  rankByRisk,
  computeBlockRate,
  getTotalDealValue,
  getAcquirerNationDistribution,
  getCriticalSectors,
  getTotalPendingReviews,
  buildRenderData,
} from "../foreign-investment-risk-helpers.ts";
import type {
  FDITransaction,
  SectorExposure,
  InvestorNation,
  TargetSector,
  ReviewOutcome,
  RiskLevel,
} from "../foreign-investment-risk-helpers.ts";

// ── Fixtures ────────────────────────────────────────────────────────────────

function makeTx(overrides: Partial<FDITransaction> = {}): FDITransaction {
  return {
    id: "test-tx",
    acquirer: "Test Corp",
    acquirerNation: "China",
    targetCompany: "Target Inc",
    targetNation: "USA",
    targetSector: "semiconductors",
    dealValueBn: 10,
    reviewBody: "CFIUS",
    outcome: "blocked",
    year: 2023,
    strategicConcern: "Test concern",
    riskScore: 80,
    ...overrides,
  };
}

function makeExposure(overrides: Partial<SectorExposure> = {}): SectorExposure {
  return {
    sector: "semiconductors",
    foreignControlledPct: 30,
    criticalInfraFlag: true,
    dominantInvestorNation: "China",
    pendingReviewCount: 2,
    ...overrides,
  };
}

// ── classifyRiskLevel ───────────────────────────────────────────────────────

test("classifyRiskLevel: 100 is critical", () => {
  assert.equal(classifyRiskLevel(100), "critical");
});

test("classifyRiskLevel: 80 is critical boundary", () => {
  assert.equal(classifyRiskLevel(80), "critical");
});

test("classifyRiskLevel: 79 is high", () => {
  assert.equal(classifyRiskLevel(79), "high");
});

test("classifyRiskLevel: 60 is high boundary", () => {
  assert.equal(classifyRiskLevel(60), "high");
});

test("classifyRiskLevel: 59 is moderate", () => {
  assert.equal(classifyRiskLevel(59), "moderate");
});

test("classifyRiskLevel: 35 is moderate boundary", () => {
  assert.equal(classifyRiskLevel(35), "moderate");
});

test("classifyRiskLevel: 34 is low", () => {
  assert.equal(classifyRiskLevel(34), "low");
});

test("classifyRiskLevel: 0 is low", () => {
  assert.equal(classifyRiskLevel(0), "low");
});

// ── filterByOutcome ─────────────────────────────────────────────────────────

test("filterByOutcome: returns only blocked", () => {
  const txs = [makeTx({ outcome: "blocked" }), makeTx({ outcome: "approved" })];
  const result = filterByOutcome(txs, "blocked");
  assert.equal(result.length, 1);
  assert.equal(result[0]!.outcome, "blocked");
});

test("filterByOutcome: returns only approved", () => {
  const txs = [makeTx({ outcome: "approved" }), makeTx({ outcome: "pending" })];
  assert.equal(filterByOutcome(txs, "approved").length, 1);
});

test("filterByOutcome: returns empty when none match", () => {
  const txs = [makeTx({ outcome: "blocked" })];
  assert.equal(filterByOutcome(txs, "approved").length, 0);
});

test("filterByOutcome: pending works", () => {
  const txs = [makeTx({ outcome: "pending" }), makeTx({ outcome: "blocked" })];
  assert.equal(filterByOutcome(txs, "pending").length, 1);
});

test("filterByOutcome: withdrawn works", () => {
  const txs = [makeTx({ outcome: "withdrawn" })];
  assert.equal(filterByOutcome(txs, "withdrawn").length, 1);
});

test("filterByOutcome: approved-with-mitigation works", () => {
  const txs = [makeTx({ outcome: "approved-with-mitigation" })];
  assert.equal(filterByOutcome(txs, "approved-with-mitigation").length, 1);
});

// ── filterByAcquirerNation ──────────────────────────────────────────────────

test("filterByAcquirerNation: returns China only", () => {
  const txs = [makeTx({ acquirerNation: "China" }), makeTx({ acquirerNation: "Russia" })];
  const result = filterByAcquirerNation(txs, "China");
  assert.equal(result.length, 1);
  assert.equal(result[0]!.acquirerNation, "China");
});

test("filterByAcquirerNation: returns UAE", () => {
  const txs = [makeTx({ acquirerNation: "UAE" }), makeTx({ acquirerNation: "China" })];
  assert.equal(filterByAcquirerNation(txs, "UAE").length, 1);
});

test("filterByAcquirerNation: empty list returns empty", () => {
  assert.equal(filterByAcquirerNation([], "China").length, 0);
});

test("filterByAcquirerNation: multiple matches returned", () => {
  const txs = [makeTx({ acquirerNation: "China" }), makeTx({ acquirerNation: "China" })];
  assert.equal(filterByAcquirerNation(txs, "China").length, 2);
});

// ── filterBySector ──────────────────────────────────────────────────────────

test("filterBySector: returns semiconductors", () => {
  const txs = [makeTx({ targetSector: "semiconductors" }), makeTx({ targetSector: "telecom" })];
  assert.equal(filterBySector(txs, "semiconductors").length, 1);
});

test("filterBySector: returns media", () => {
  const txs = [makeTx({ targetSector: "media" }), makeTx({ targetSector: "AI" })];
  assert.equal(filterBySector(txs, "media").length, 1);
});

test("filterBySector: no match returns empty", () => {
  const txs = [makeTx({ targetSector: "telecom" })];
  assert.equal(filterBySector(txs, "defense").length, 0);
});

// ── rankByRisk ──────────────────────────────────────────────────────────────

test("rankByRisk: sorts descending by riskScore", () => {
  const txs = [makeTx({ riskScore: 50 }), makeTx({ riskScore: 90 }), makeTx({ riskScore: 70 })];
  const ranked = rankByRisk(txs);
  assert.equal(ranked[0]!.riskScore, 90);
  assert.equal(ranked[1]!.riskScore, 70);
  assert.equal(ranked[2]!.riskScore, 50);
});

test("rankByRisk: does not mutate original array", () => {
  const txs = [makeTx({ riskScore: 30 }), makeTx({ riskScore: 90 })];
  const original = [...txs];
  rankByRisk(txs);
  assert.equal(txs[0]!.riskScore, original[0]!.riskScore);
});

test("rankByRisk: empty array returns empty", () => {
  assert.deepEqual(rankByRisk([]), []);
});

test("rankByRisk: single element unchanged", () => {
  const txs = [makeTx({ riskScore: 42 })];
  assert.equal(rankByRisk(txs)[0]!.riskScore, 42);
});

// ── computeBlockRate ────────────────────────────────────────────────────────

test("computeBlockRate: empty list returns 0", () => {
  assert.equal(computeBlockRate([]), 0);
});

test("computeBlockRate: all blocked gives 100", () => {
  const txs = [makeTx({ outcome: "blocked" }), makeTx({ outcome: "blocked" })];
  assert.equal(computeBlockRate(txs), 100);
});

test("computeBlockRate: none blocked gives 0", () => {
  const txs = [makeTx({ outcome: "approved" }), makeTx({ outcome: "pending" })];
  assert.equal(computeBlockRate(txs), 0);
});

test("computeBlockRate: withdrawn counts as blocked", () => {
  const txs = [makeTx({ outcome: "withdrawn" }), makeTx({ outcome: "approved" })];
  assert.equal(computeBlockRate(txs), 50);
});

test("computeBlockRate: mixed set returns rounded pct", () => {
  const txs = [
    makeTx({ outcome: "blocked" }),
    makeTx({ outcome: "withdrawn" }),
    makeTx({ outcome: "approved" }),
    makeTx({ outcome: "approved" }),
  ];
  assert.equal(computeBlockRate(txs), 50);
});

// ── getTotalDealValue ───────────────────────────────────────────────────────

test("getTotalDealValue: empty returns 0", () => {
  assert.equal(getTotalDealValue([]), 0);
});

test("getTotalDealValue: sums deal values", () => {
  const txs = [makeTx({ dealValueBn: 10 }), makeTx({ dealValueBn: 5 })];
  assert.equal(getTotalDealValue(txs), 15);
});

test("getTotalDealValue: rounds to 1 decimal", () => {
  const txs = [makeTx({ dealValueBn: 1.123 }), makeTx({ dealValueBn: 2.456 })];
  const result = getTotalDealValue(txs);
  assert.equal(result, Math.round((1.123 + 2.456) * 10) / 10);
});

// ── getAcquirerNationDistribution ───────────────────────────────────────────

test("getAcquirerNationDistribution: counts per nation", () => {
  const txs = [
    makeTx({ acquirerNation: "China" }),
    makeTx({ acquirerNation: "China" }),
    makeTx({ acquirerNation: "Russia" }),
  ];
  const dist = getAcquirerNationDistribution(txs);
  assert.equal(dist["China"], 2);
  assert.equal(dist["Russia"], 1);
});

test("getAcquirerNationDistribution: empty returns empty object", () => {
  const dist = getAcquirerNationDistribution([]);
  assert.deepEqual(dist, {});
});

// ── getCriticalSectors ──────────────────────────────────────────────────────

test("getCriticalSectors: filters out non-critical", () => {
  const exposures = [
    makeExposure({ criticalInfraFlag: true, foreignControlledPct: 40 }),
    makeExposure({ criticalInfraFlag: false, foreignControlledPct: 50 }),
  ];
  const result = getCriticalSectors(exposures);
  assert.equal(result.length, 1);
  assert.equal(result[0]!.criticalInfraFlag, true);
});

test("getCriticalSectors: sorts descending by foreignControlledPct", () => {
  const exposures = [
    makeExposure({ criticalInfraFlag: true, foreignControlledPct: 20 }),
    makeExposure({ criticalInfraFlag: true, foreignControlledPct: 50 }),
    makeExposure({ criticalInfraFlag: true, foreignControlledPct: 35 }),
  ];
  const result = getCriticalSectors(exposures);
  assert.equal(result[0]!.foreignControlledPct, 50);
  assert.equal(result[1]!.foreignControlledPct, 35);
  assert.equal(result[2]!.foreignControlledPct, 20);
});

test("getCriticalSectors: empty returns empty", () => {
  assert.deepEqual(getCriticalSectors([]), []);
});

// ── getTotalPendingReviews ──────────────────────────────────────────────────

test("getTotalPendingReviews: sums pendingReviewCount", () => {
  const exposures = [
    makeExposure({ pendingReviewCount: 3 }),
    makeExposure({ pendingReviewCount: 5 }),
  ];
  assert.equal(getTotalPendingReviews(exposures), 8);
});

test("getTotalPendingReviews: empty returns 0", () => {
  assert.equal(getTotalPendingReviews([]), 0);
});

// ── buildRenderData ─────────────────────────────────────────────────────────

test("buildRenderData: returns transactions sorted by risk descending", () => {
  const data = buildRenderData();
  for (let i = 1; i < data.transactions.length; i++) {
    assert.ok(data.transactions[i - 1]!.riskScore >= data.transactions[i]!.riskScore);
  }
});

test("buildRenderData: blockRate is a number 0-100", () => {
  const data = buildRenderData();
  assert.ok(data.blockRate >= 0 && data.blockRate <= 100);
});

test("buildRenderData: totalDealValueBn is positive", () => {
  const data = buildRenderData();
  assert.ok(data.totalDealValueBn > 0);
});

test("buildRenderData: totalPendingReviews is positive", () => {
  const data = buildRenderData();
  assert.ok(data.totalPendingReviews > 0);
});

test("buildRenderData: criticalSectors all have criticalInfraFlag true", () => {
  const data = buildRenderData();
  for (const s of data.criticalSectors) {
    assert.equal(s.criticalInfraFlag, true);
  }
});

test("buildRenderData: nationDistribution has China as top acquirer", () => {
  const data = buildRenderData();
  assert.ok(data.nationDistribution["China"] > 1);
});

test("buildRenderData: sectorExposures array is non-empty", () => {
  const data = buildRenderData();
  assert.ok(data.sectorExposures.length > 0);
});

test("buildRenderData: transactions array is non-empty", () => {
  const data = buildRenderData();
  assert.ok(data.transactions.length > 0);
});
