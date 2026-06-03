import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  computeGlobalHybridIndex,
  getActiveOperations,
  getEscalatingOperations,
  getCriticalOperations,
  getTopActors,
  getComponentDistribution,
  severityClass,
  statusClass,
  buildRenderData,
  type HybridOperation,
  type ThreatSeverity,
  type OperationStatus,
} from "../hybrid-warfare-helpers.js";

// ---- helpers for building minimal test operations ----
function makeOp(overrides: Partial<HybridOperation> = {}): HybridOperation {
  return {
    id: "T001",
    actor: "TestActor",
    target: "TestTarget",
    components: ["Cyber"],
    status: "Active",
    severity: "Medium",
    severityScore: 5,
    description: "Test op",
    startDate: "2024-01",
    lastActivity: "2024-12",
    attribution: "Confirmed",
    ...overrides,
  };
}

// ==================== computeGlobalHybridIndex ====================
describe("computeGlobalHybridIndex", () => {
  it("returns 0 for empty array", () => {
    assert.equal(computeGlobalHybridIndex([]), 0);
  });

  it("returns 10 when no active or escalating ops", () => {
    const ops = [
      makeOp({ status: "Dormant", severityScore: 10 }),
      makeOp({ status: "Concluded", severityScore: 10 }),
    ];
    assert.equal(computeGlobalHybridIndex(ops), 10);
  });

  it("returns 100 when single active op with score 10", () => {
    const ops = [makeOp({ status: "Active", severityScore: 10 })];
    assert.equal(computeGlobalHybridIndex(ops), 100);
  });

  it("returns 50 for single active op with score 5", () => {
    const ops = [makeOp({ status: "Active", severityScore: 5 })];
    assert.equal(computeGlobalHybridIndex(ops), 50);
  });

  it("counts Escalating ops as active for index", () => {
    const ops = [makeOp({ status: "Escalating", severityScore: 10 })];
    assert.equal(computeGlobalHybridIndex(ops), 100);
  });

  it("averages scores across multiple active ops", () => {
    const ops = [
      makeOp({ status: "Active", severityScore: 10 }),
      makeOp({ status: "Active", severityScore: 0 }),
    ];
    // avg = 5, 5/10 * 100 = 50
    assert.equal(computeGlobalHybridIndex(ops), 50);
  });

  it("ignores Dormant/Concluded in average", () => {
    const ops = [
      makeOp({ status: "Active", severityScore: 10 }),
      makeOp({ status: "Dormant", severityScore: 1 }),
    ];
    assert.equal(computeGlobalHybridIndex(ops), 100);
  });

  it("caps at 100 (cannot exceed)", () => {
    const ops = [
      makeOp({ status: "Active", severityScore: 10 }),
      makeOp({ status: "Active", severityScore: 10 }),
      makeOp({ status: "Active", severityScore: 10 }),
    ];
    assert.equal(computeGlobalHybridIndex(ops), 100);
  });

  it("returns integer (Math.round applied)", () => {
    const ops = [
      makeOp({ status: "Active", severityScore: 3 }),
    ];
    const result = computeGlobalHybridIndex(ops);
    assert.equal(result, Math.round(result));
  });
});

// ==================== getActiveOperations ====================
describe("getActiveOperations", () => {
  it("returns empty array when no ops", () => {
    assert.deepEqual(getActiveOperations([]), []);
  });

  it("includes Active ops", () => {
    const op = makeOp({ status: "Active" });
    const result = getActiveOperations([op]);
    assert.equal(result.length, 1);
    assert.equal(result[0].status, "Active");
  });

  it("includes Escalating ops", () => {
    const op = makeOp({ status: "Escalating" });
    const result = getActiveOperations([op]);
    assert.equal(result.length, 1);
  });

  it("excludes Dormant ops", () => {
    const op = makeOp({ status: "Dormant" });
    assert.deepEqual(getActiveOperations([op]), []);
  });

  it("excludes Concluded ops", () => {
    const op = makeOp({ status: "Concluded" });
    assert.deepEqual(getActiveOperations([op]), []);
  });

  it("returns only active+escalating from mixed set", () => {
    const ops = [
      makeOp({ id: "A", status: "Active" }),
      makeOp({ id: "B", status: "Escalating" }),
      makeOp({ id: "C", status: "Dormant" }),
      makeOp({ id: "D", status: "Concluded" }),
    ];
    const result = getActiveOperations(ops);
    assert.equal(result.length, 2);
    assert.ok(result.every(o => o.status === "Active" || o.status === "Escalating"));
  });
});

// ==================== getEscalatingOperations ====================
describe("getEscalatingOperations", () => {
  it("returns empty array for empty input", () => {
    assert.deepEqual(getEscalatingOperations([]), []);
  });

  it("returns only Escalating ops", () => {
    const ops = [
      makeOp({ id: "A", status: "Active" }),
      makeOp({ id: "B", status: "Escalating" }),
      makeOp({ id: "C", status: "Dormant" }),
    ];
    const result = getEscalatingOperations(ops);
    assert.equal(result.length, 1);
    assert.equal(result[0].id, "B");
  });

  it("does not include Active as Escalating", () => {
    const op = makeOp({ status: "Active" });
    assert.deepEqual(getEscalatingOperations([op]), []);
  });

  it("returns multiple escalating ops", () => {
    const ops = [
      makeOp({ id: "X", status: "Escalating" }),
      makeOp({ id: "Y", status: "Escalating" }),
    ];
    assert.equal(getEscalatingOperations(ops).length, 2);
  });
});

// ==================== getCriticalOperations ====================
describe("getCriticalOperations", () => {
  it("returns empty for empty input", () => {
    assert.deepEqual(getCriticalOperations([]), []);
  });

  it("returns only Critical severity ops", () => {
    const ops = [
      makeOp({ id: "A", severity: "Critical" }),
      makeOp({ id: "B", severity: "High" }),
      makeOp({ id: "C", severity: "Medium" }),
      makeOp({ id: "D", severity: "Low" }),
    ];
    const result = getCriticalOperations(ops);
    assert.equal(result.length, 1);
    assert.equal(result[0].id, "A");
  });

  it("returns multiple Critical ops when present", () => {
    const ops = [
      makeOp({ id: "A", severity: "Critical" }),
      makeOp({ id: "B", severity: "Critical" }),
    ];
    assert.equal(getCriticalOperations(ops).length, 2);
  });

  it("excludes High severity", () => {
    assert.deepEqual(getCriticalOperations([makeOp({ severity: "High" })]), []);
  });
});

// ==================== getTopActors ====================
describe("getTopActors", () => {
  it("returns empty array for empty input", () => {
    assert.deepEqual(getTopActors([]), []);
  });

  it("returns single actor for single op", () => {
    const result = getTopActors([makeOp({ actor: "Alpha", severityScore: 5 })]);
    assert.deepEqual(result, ["Alpha"]);
  });

  it("sorts by cumulative severity score descending", () => {
    const ops = [
      makeOp({ actor: "Low", severityScore: 2 }),
      makeOp({ actor: "High", severityScore: 9 }),
      makeOp({ actor: "Mid", severityScore: 5 }),
    ];
    const result = getTopActors(ops);
    assert.equal(result[0], "High");
    assert.equal(result[1], "Mid");
    assert.equal(result[2], "Low");
  });

  it("accumulates scores for same actor across ops", () => {
    const ops = [
      makeOp({ actor: "Russia", severityScore: 5 }),
      makeOp({ actor: "Russia", severityScore: 5 }),
      makeOp({ actor: "China", severityScore: 9 }),
    ];
    const result = getTopActors(ops);
    // Russia total=10, China total=9
    assert.equal(result[0], "Russia");
    assert.equal(result[1], "China");
  });

  it("returns unique actor names", () => {
    const ops = [
      makeOp({ actor: "Russia", severityScore: 5 }),
      makeOp({ actor: "Russia", severityScore: 5 }),
    ];
    const result = getTopActors(ops);
    const unique = new Set(result);
    assert.equal(unique.size, result.length);
  });
});

// ==================== getComponentDistribution ====================
describe("getComponentDistribution", () => {
  it("returns empty object for empty input", () => {
    assert.deepEqual(getComponentDistribution([]), {});
  });

  it("counts single component correctly", () => {
    const ops = [makeOp({ components: ["Cyber"] })];
    const dist = getComponentDistribution(ops);
    assert.equal(dist["Cyber"], 1);
  });

  it("counts multiple components in single op", () => {
    const ops = [makeOp({ components: ["Cyber", "Information Ops", "Sabotage"] })];
    const dist = getComponentDistribution(ops);
    assert.equal(dist["Cyber"], 1);
    assert.equal(dist["Information Ops"], 1);
    assert.equal(dist["Sabotage"], 1);
  });

  it("accumulates same component across multiple ops", () => {
    const ops = [
      makeOp({ id: "A", components: ["Cyber"] }),
      makeOp({ id: "B", components: ["Cyber", "Lawfare"] }),
    ];
    const dist = getComponentDistribution(ops);
    assert.equal(dist["Cyber"], 2);
    assert.equal(dist["Lawfare"], 1);
  });

  it("handles all 8 component types", () => {
    const ops = [makeOp({ components: ["Cyber", "Information Ops", "Proxy Forces", "Economic Coercion", "Lawfare", "Sabotage", "Political Subversion", "Energy Leverage"] })];
    const dist = getComponentDistribution(ops);
    for (const c of ["Cyber","Information Ops","Proxy Forces","Economic Coercion","Lawfare","Sabotage","Political Subversion","Energy Leverage"]) {
      assert.equal(dist[c], 1, `Missing component: ${c}`);
    }
  });
});

// ==================== severityClass ====================
describe("severityClass", () => {
  it("returns sev-critical for Critical", () => {
    assert.equal(severityClass("Critical"), "sev-critical");
  });

  it("returns sev-high for High", () => {
    assert.equal(severityClass("High"), "sev-high");
  });

  it("returns sev-medium for Medium", () => {
    assert.equal(severityClass("Medium"), "sev-medium");
  });

  it("returns sev-low for Low", () => {
    assert.equal(severityClass("Low"), "sev-low");
  });

  it("all four severity values produce distinct classes", () => {
    const classes = ["Critical","High","Medium","Low"].map(s => severityClass(s as ThreatSeverity));
    const unique = new Set(classes);
    assert.equal(unique.size, 4);
  });
});

// ==================== statusClass ====================
describe("statusClass", () => {
  it("returns op-active for Active", () => {
    assert.equal(statusClass("Active"), "op-active");
  });

  it("returns op-escalating for Escalating", () => {
    assert.equal(statusClass("Escalating"), "op-escalating");
  });

  it("returns op-dormant for Dormant", () => {
    assert.equal(statusClass("Dormant"), "op-dormant");
  });

  it("returns op-concluded for Concluded", () => {
    assert.equal(statusClass("Concluded"), "op-concluded");
  });

  it("all four status values produce distinct classes", () => {
    const classes = ["Active","Escalating","Dormant","Concluded"].map(s => statusClass(s as OperationStatus));
    const unique = new Set(classes);
    assert.equal(unique.size, 4);
  });
});

// ==================== buildRenderData ====================
describe("buildRenderData", () => {
  it("returns an object with operations array", () => {
    const data = buildRenderData();
    assert.ok(Array.isArray(data.operations));
  });

  it("returns an object with incidents array", () => {
    const data = buildRenderData();
    assert.ok(Array.isArray(data.incidents));
  });

  it("operations array is non-empty", () => {
    const data = buildRenderData();
    assert.ok(data.operations.length > 0);
  });

  it("incidents array is non-empty", () => {
    const data = buildRenderData();
    assert.ok(data.incidents.length > 0);
  });

  it("has exactly 8 operations", () => {
    const data = buildRenderData();
    assert.equal(data.operations.length, 8);
  });

  it("has exactly 8 incidents", () => {
    const data = buildRenderData();
    assert.equal(data.incidents.length, 8);
  });

  it("globalHybridIndex is a number", () => {
    const data = buildRenderData();
    assert.equal(typeof data.globalHybridIndex, "number");
  });

  it("globalHybridIndex is between 0 and 100", () => {
    const data = buildRenderData();
    assert.ok(data.globalHybridIndex >= 0 && data.globalHybridIndex <= 100);
  });

  it("activeOperationCount matches getActiveOperations length", () => {
    const data = buildRenderData();
    const active = data.operations.filter(o => o.status === "Active" || o.status === "Escalating");
    assert.equal(data.activeOperationCount, active.length);
  });

  it("escalatingCount matches escalating ops", () => {
    const data = buildRenderData();
    const escalating = data.operations.filter(o => o.status === "Escalating");
    assert.equal(data.escalatingCount, escalating.length);
  });

  it("criticalCount matches critical ops", () => {
    const data = buildRenderData();
    const critical = data.operations.filter(o => o.severity === "Critical");
    assert.equal(data.criticalCount, critical.length);
  });

  it("topActors is an array", () => {
    const data = buildRenderData();
    assert.ok(Array.isArray(data.topActors));
  });

  it("topActors contains Russia and China", () => {
    const data = buildRenderData();
    assert.ok(data.topActors.includes("Russia") || data.topActors.some(a => a.includes("Russia")));
    assert.ok(data.topActors.includes("China"));
  });

  it("each operation has required fields", () => {
    const data = buildRenderData();
    for (const op of data.operations) {
      assert.ok(op.id, "missing id");
      assert.ok(op.actor, "missing actor");
      assert.ok(op.target, "missing target");
      assert.ok(Array.isArray(op.components), "components not array");
      assert.ok(op.status, "missing status");
      assert.ok(op.severity, "missing severity");
      assert.ok(typeof op.severityScore === "number", "severityScore not number");
    }
  });

  it("each incident has required fields", () => {
    const data = buildRenderData();
    for (const inc of data.incidents) {
      assert.ok(inc.id, "missing id");
      assert.ok(inc.date, "missing date");
      assert.ok(inc.actor, "missing actor");
      assert.ok(inc.target, "missing target");
      assert.ok(inc.component, "missing component");
      assert.ok(inc.severity, "missing severity");
    }
  });

  it("severityScore is in 1-10 range for all ops", () => {
    const data = buildRenderData();
    for (const op of data.operations) {
      assert.ok(op.severityScore >= 1 && op.severityScore <= 10, `Score ${op.severityScore} out of range for ${op.id}`);
    }
  });

  it("globalHybridIndex is consistent with computed value", () => {
    const data = buildRenderData();
    const active = data.operations.filter(o => o.status === "Active" || o.status === "Escalating");
    const expectedScore = active.length > 0
      ? Math.min(100, Math.round((active.reduce((s, o) => s + o.severityScore, 0) / (active.length * 10)) * 100))
      : 10;
    assert.equal(data.globalHybridIndex, expectedScore);
  });
});
