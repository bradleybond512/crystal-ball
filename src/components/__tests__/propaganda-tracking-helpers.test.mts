import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  computeGlobalInfoWarIndex,
  getActiveCampaigns,
  getDormantCampaigns,
  getConcludedCampaigns,
  getTopActors,
  computeTotalReach,
  getCriticalCampaigns,
  rankOutletsByReach,
  severityClass,
  statusClass,
  buildRenderData,
  type PropagandaCampaign,
  type StateMediaOutlet,
  type CampaignStatus,
  type CampaignSeverity,
} from "../propaganda-tracking-helpers.js";

const MOCK_CAMPAIGNS: PropagandaCampaign[] = [
  { id: "C1", actor: "Russia", startDate: "2022-01", primaryNarrative: "N1", platforms: ["RT"], estimatedReachM: 100, targetAudience: "Europe", status: "Active", severity: "Critical", detectedBy: "DFRLab", description: "D1" },
  { id: "C2", actor: "China", startDate: "2021-01", primaryNarrative: "N2", platforms: ["CGTN"], estimatedReachM: 50, targetAudience: "Global", status: "Active", severity: "High", detectedBy: "ASPI", description: "D2" },
  { id: "C3", actor: "Russia", startDate: "2020-01", endDate: "2021-01", primaryNarrative: "N3", platforms: ["FB"], estimatedReachM: 200, targetAudience: "US", status: "Concluded", severity: "Critical", detectedBy: "FBI", description: "D3" },
  { id: "C4", actor: "Iran", startDate: "2023-01", primaryNarrative: "N4", platforms: ["Telegram"], estimatedReachM: 20, targetAudience: "ME", status: "Dormant", severity: "Medium", detectedBy: "Meta", description: "D4" },
  { id: "C5", actor: "China", startDate: "2022-06", primaryNarrative: "N5", platforms: ["Twitter/X"], estimatedReachM: 30, targetAudience: "SE Asia", status: "Active", severity: "High", detectedBy: "Mandiant", description: "D5" },
];

const MOCK_OUTLETS: StateMediaOutlet[] = [
  { id: "O1", name: "RT", country: "Russia", monthlyReachM: 100, factCheckScore: 15, platformsActive: ["YT"], bannedIn: ["EU"], annualBudgetM: 400, primaryNarratives: ["NATO"] },
  { id: "O2", name: "CGTN", country: "China", monthlyReachM: 78, factCheckScore: 32, platformsActive: ["YT"], bannedIn: [], annualBudgetM: 300, primaryNarratives: ["Taiwan"] },
  { id: "O3", name: "TRT", country: "Turkey", monthlyReachM: 22, factCheckScore: 48, platformsActive: ["Web"], bannedIn: [], annualBudgetM: 120, primaryNarratives: ["Regional"] },
];

describe("computeGlobalInfoWarIndex", () => {
  it("returns a number between 0 and 100", () => {
    const idx = computeGlobalInfoWarIndex(MOCK_CAMPAIGNS);
    assert.ok(idx >= 0 && idx <= 100);
  });
  it("returns 5 when no active campaigns", () => {
    const all = MOCK_CAMPAIGNS.map(c => ({ ...c, status: "Concluded" as CampaignStatus }));
    assert.equal(computeGlobalInfoWarIndex(all), 5);
  });
  it("returns 0 for empty array", () => {
    assert.equal(computeGlobalInfoWarIndex([]), 0);
  });
  it("returns higher index for more critical active campaigns", () => {
    const allCrit = MOCK_CAMPAIGNS.map(c => ({ ...c, status: "Active" as CampaignStatus, severity: "Critical" as CampaignSeverity }));
    const allLow = MOCK_CAMPAIGNS.map(c => ({ ...c, status: "Active" as CampaignStatus, severity: "Low" as CampaignSeverity }));
    assert.ok(computeGlobalInfoWarIndex(allCrit) > computeGlobalInfoWarIndex(allLow));
  });
  it("caps at 100", () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ ...MOCK_CAMPAIGNS[0], id: `X${i}`, status: "Active" as CampaignStatus, severity: "Critical" as CampaignSeverity }));
    assert.ok(computeGlobalInfoWarIndex(many) <= 100);
  });
  it("returns integer", () => {
    const idx = computeGlobalInfoWarIndex(MOCK_CAMPAIGNS);
    assert.equal(idx, Math.round(idx));
  });
  it("single low campaign returns low index", () => {
    const one = [{ ...MOCK_CAMPAIGNS[0], status: "Active" as CampaignStatus, severity: "Low" as CampaignSeverity }];
    assert.ok(computeGlobalInfoWarIndex(one) < 10);
  });
});

describe("getActiveCampaigns", () => {
  it("returns only Active campaigns", () => {
    const active = getActiveCampaigns(MOCK_CAMPAIGNS);
    assert.equal(active.length, 3); // C1, C2, C5
    assert.ok(active.every(c => c.status === "Active"));
  });
  it("returns empty when none active", () => {
    const all = MOCK_CAMPAIGNS.map(c => ({ ...c, status: "Concluded" as CampaignStatus }));
    assert.equal(getActiveCampaigns(all).length, 0);
  });
  it("returns all when all active", () => {
    const all = MOCK_CAMPAIGNS.map(c => ({ ...c, status: "Active" as CampaignStatus }));
    assert.equal(getActiveCampaigns(all).length, MOCK_CAMPAIGNS.length);
  });
  it("returns empty for empty input", () => {
    assert.equal(getActiveCampaigns([]).length, 0);
  });
});

describe("getDormantCampaigns", () => {
  it("returns only Dormant campaigns", () => {
    const dormant = getDormantCampaigns(MOCK_CAMPAIGNS);
    assert.equal(dormant.length, 1); // C4
    assert.ok(dormant.every(c => c.status === "Dormant"));
  });
  it("returns empty when none dormant", () => {
    const all = MOCK_CAMPAIGNS.map(c => ({ ...c, status: "Active" as CampaignStatus }));
    assert.equal(getDormantCampaigns(all).length, 0);
  });
});

describe("getConcludedCampaigns", () => {
  it("returns only Concluded campaigns", () => {
    const concluded = getConcludedCampaigns(MOCK_CAMPAIGNS);
    assert.equal(concluded.length, 1); // C3
    assert.ok(concluded.every(c => c.status === "Concluded"));
  });
  it("returns empty when none concluded", () => {
    const all = MOCK_CAMPAIGNS.map(c => ({ ...c, status: "Active" as CampaignStatus }));
    assert.equal(getConcludedCampaigns(all).length, 0);
  });
});

describe("getTopActors", () => {
  it("returns actors sorted by campaign count descending", () => {
    const actors = getTopActors(MOCK_CAMPAIGNS);
    // Russia=2, China=2, Iran=1
    assert.ok(actors.includes("Russia"));
    assert.ok(actors.includes("China"));
    assert.ok(actors.includes("Iran"));
    assert.equal(actors[actors.length - 1], "Iran"); // lowest count last
  });
  it("returns empty for empty input", () => {
    assert.deepEqual(getTopActors([]), []);
  });
  it("returns unique actors", () => {
    const actors = getTopActors(MOCK_CAMPAIGNS);
    const unique = new Set(actors);
    assert.equal(actors.length, unique.size);
  });
  it("handles single campaign", () => {
    const actors = getTopActors([MOCK_CAMPAIGNS[0]]);
    assert.equal(actors.length, 1);
    assert.equal(actors[0], "Russia");
  });
  it("returns all actors present in campaigns", () => {
    const actors = getTopActors(MOCK_CAMPAIGNS);
    assert.equal(actors.length, 3); // Russia, China, Iran
  });
});

describe("computeTotalReach", () => {
  it("sums monthly reach across all outlets", () => {
    assert.equal(computeTotalReach(MOCK_OUTLETS), 200); // 100+78+22
  });
  it("returns 0 for empty array", () => {
    assert.equal(computeTotalReach([]), 0);
  });
  it("handles single outlet", () => {
    assert.equal(computeTotalReach([MOCK_OUTLETS[0]]), 100);
  });
  it("handles two outlets", () => {
    assert.equal(computeTotalReach(MOCK_OUTLETS.slice(0, 2)), 178);
  });
});

describe("getCriticalCampaigns", () => {
  it("returns only Critical severity campaigns", () => {
    const crit = getCriticalCampaigns(MOCK_CAMPAIGNS);
    assert.equal(crit.length, 2); // C1, C3
    assert.ok(crit.every(c => c.severity === "Critical"));
  });
  it("returns empty when none Critical", () => {
    const all = MOCK_CAMPAIGNS.map(c => ({ ...c, severity: "Low" as CampaignSeverity }));
    assert.equal(getCriticalCampaigns(all).length, 0);
  });
  it("returns all when all Critical", () => {
    const all = MOCK_CAMPAIGNS.map(c => ({ ...c, severity: "Critical" as CampaignSeverity }));
    assert.equal(getCriticalCampaigns(all).length, MOCK_CAMPAIGNS.length);
  });
});

describe("rankOutletsByReach", () => {
  it("returns outlets sorted by monthlyReachM descending", () => {
    const sorted = rankOutletsByReach(MOCK_OUTLETS);
    for (let i = 1; i < sorted.length; i++) {
      assert.ok(sorted[i - 1].monthlyReachM >= sorted[i].monthlyReachM);
    }
  });
  it("does not mutate original array", () => {
    const orig = MOCK_OUTLETS.map(o => o.id);
    rankOutletsByReach(MOCK_OUTLETS);
    assert.deepEqual(MOCK_OUTLETS.map(o => o.id), orig);
  });
  it("handles empty array", () => {
    assert.deepEqual(rankOutletsByReach([]), []);
  });
  it("handles single outlet", () => {
    assert.equal(rankOutletsByReach([MOCK_OUTLETS[0]]).length, 1);
  });
  it("first element has highest reach", () => {
    const sorted = rankOutletsByReach(MOCK_OUTLETS);
    assert.equal(sorted[0].monthlyReachM, 100);
  });
  it("last element has lowest reach", () => {
    const sorted = rankOutletsByReach(MOCK_OUTLETS);
    assert.equal(sorted[sorted.length - 1].monthlyReachM, 22);
  });
});

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
});

describe("statusClass", () => {
  it("returns status-active for Active", () => {
    assert.equal(statusClass("Active"), "status-active");
  });
  it("returns status-dormant for Dormant", () => {
    assert.equal(statusClass("Dormant"), "status-dormant");
  });
  it("returns status-concluded for Concluded", () => {
    assert.equal(statusClass("Concluded"), "status-concluded");
  });
});

describe("buildRenderData", () => {
  it("returns all required fields", () => {
    const d = buildRenderData();
    assert.ok(Array.isArray(d.outlets));
    assert.ok(Array.isArray(d.campaigns));
    assert.equal(typeof d.globalInfoWarIndex, "number");
    assert.equal(typeof d.activeCampaignCount, "number");
    assert.equal(typeof d.totalReachM, "number");
    assert.ok(Array.isArray(d.topActors));
  });
  it("outlets array is non-empty", () => {
    assert.ok(buildRenderData().outlets.length > 0);
  });
  it("campaigns array is non-empty", () => {
    assert.ok(buildRenderData().campaigns.length > 0);
  });
  it("activeCampaignCount matches actual active", () => {
    const d = buildRenderData();
    assert.equal(d.activeCampaignCount, d.campaigns.filter(c => c.status === "Active").length);
  });
  it("totalReachM matches sum of outlet reach", () => {
    const d = buildRenderData();
    const sum = d.outlets.reduce((s, o) => s + o.monthlyReachM, 0);
    assert.equal(d.totalReachM, sum);
  });
  it("globalInfoWarIndex is 0-100", () => {
    const idx = buildRenderData().globalInfoWarIndex;
    assert.ok(idx >= 0 && idx <= 100);
  });
  it("topActors contains at least one actor", () => {
    assert.ok(buildRenderData().topActors.length > 0);
  });
  it("all campaign statuses are valid", () => {
    const valid = new Set(["Active", "Dormant", "Concluded"]);
    for (const c of buildRenderData().campaigns) {
      assert.ok(valid.has(c.status));
    }
  });
  it("all campaign severities are valid", () => {
    const valid = new Set(["Low", "Medium", "High", "Critical"]);
    for (const c of buildRenderData().campaigns) {
      assert.ok(valid.has(c.severity));
    }
  });
  it("all outlet factCheckScores are 0-100", () => {
    for (const o of buildRenderData().outlets) {
      assert.ok(o.factCheckScore >= 0 && o.factCheckScore <= 100);
    }
  });
  it("all outlet monthlyReachM are positive", () => {
    for (const o of buildRenderData().outlets) {
      assert.ok(o.monthlyReachM > 0);
    }
  });
  it("outlets count is 8", () => {
    assert.equal(buildRenderData().outlets.length, 8);
  });
  it("campaigns count is 8", () => {
    assert.equal(buildRenderData().campaigns.length, 8);
  });
  it("all campaigns have non-empty actor", () => {
    for (const c of buildRenderData().campaigns) {
      assert.ok(c.actor.length > 0);
    }
  });
  it("all outlets have non-empty name", () => {
    for (const o of buildRenderData().outlets) {
      assert.ok(o.name.length > 0);
    }
  });
});
