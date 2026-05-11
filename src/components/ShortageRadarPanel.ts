/* eslint-disable sonarjs/no-nested-template-literals */
/**
 * Shortage Radar Panel — 2×4 overview grid for 8 commodity shortage models.
 *
 * Commodities: wheat · corn · rice · soybeans · diesel · gasoline ·
 *              natural-gas · jet-fuel
 *
 * Each card shows risk level badge, score, top driver, and trend arrow.
 * Clicking a card dispatches `wm:shortage-drill-down` so ShortageDetailPanel
 * can open. CRITICAL transitions are routed to the notification ladder.
 * After each render the computed state is pushed to the sidecar so
 * /api/shortage/summary is populated for external tools.
 */

import { Panel } from './Panel';
import {
  computeShortageFullSet,
  ALL_FULLSET_COMMODITIES,
  type ShortageSummaryEntry,
  type FullSetCommodity,
  type RiskLevel,
  type Trend,
} from '@/services/shortage/shortage-fullset';
import type { ShortageInputBag } from '@/services/shortage/shortage-types';
import { getPlaybook } from '@/services/shortage/commodity-playbooks';
import { detectBigEvent } from '@/services/insights/big-event-detector';
import { routeBigEventToLadder } from '@/services/insights/notification-ladder';
import { getNotificationTraceRegistry } from '@/services/diagnostics/diagnostics-state';
import { getApiBaseUrl } from '@/services/runtime';
import { escapeHtml } from '@/utils/sanitize';

const REFRESH_MS = 30_000;
const SIDECAR_PUSH_TTL_MS = 30 * 60 * 1000; // 30-minute cache

// ── Risk level colors ──────────────────────────────────────────────────────

const RISK_COLOR: Record<RiskLevel, string> = {
  CRITICAL: '#d50000',
  HIGH:     '#ff9800',
  MODERATE: '#ffeb3b',
  LOW:      '#4caf50',
};

const RISK_BG: Record<RiskLevel, string> = {
  CRITICAL: 'rgba(213,0,0,0.12)',
  HIGH:     'rgba(255,152,0,0.10)',
  MODERATE: 'rgba(255,235,59,0.08)',
  LOW:      'rgba(76,175,80,0.08)',
};

// ── Trend arrows ───────────────────────────────────────────────────────────

const TREND_ARROW: Record<Trend, string> = {
  deteriorating: '▲',
  stable:        '→',
  improving:     '▼',
};

const TREND_COLOR: Record<Trend, string> = {
  deteriorating: '#f44336',
  stable:        '#9e9e9e',
  improving:     '#4caf50',
};

// ── Commodity display names ───────────────────────────────────────────────

const DISPLAY_NAME: Record<FullSetCommodity, string> = {
  'wheat':       'Wheat',
  'corn':        'Corn',
  'rice':        'Rice',
  'soybeans':    'Soybeans',
  'diesel':      'Diesel',
  'gasoline':    'Gasoline',
  'natural-gas': 'Nat Gas',
  'jet-fuel':    'Jet Fuel',
};

// ── Notification ladder guard ─────────────────────────────────────────────
// Track previous risk levels to fire only on HIGH → CRITICAL transitions.

const _prevRiskLevels = new Map<FullSetCommodity, RiskLevel>();

function checkAndNotify(entry: ShortageSummaryEntry): void {
  const prev = _prevRiskLevels.get(entry.commodity);
  _prevRiskLevels.set(entry.commodity, entry.riskLevel);

  const justCritical = entry.riskLevel === 'CRITICAL' && prev !== 'CRITICAL';
  if (!justCritical) return;

  try {
    const input = {
      id: `shortage-${entry.commodity}-${Date.now()}`,
      domain: 'shortage',
      severityScore: entry.riskScore,
      previousSeverityScore: 0,
      truthScore: { high: 0.85, medium: 0.65, low: 0.45 }[entry.forecast.confidence] ?? 0.45,
      sourceCount: new Set(
        entry.forecast.drivers.flatMap((d) => d.sources ?? [])
      ).size || 1,
      hasOfficialSource: false,
      overlappingDomains: [entry.forecast.domain],
      userExposure: 30,
      potentialImpact: entry.riskScore,
      forecastThresholdCrossed: true,
    };
    const result = detectBigEvent(input);
    if (result.isBigEvent) {
      routeBigEventToLadder(
        getNotificationTraceRegistry(),
        result,
        input,
        {
          domain: 'shortage',
          headline: `${DISPLAY_NAME[entry.commodity]} shortage risk: CRITICAL`,
          summary: entry.forecast.drivers.slice(0, 2).map((d) => d.label).join('; '),
        },
      );
    }
  } catch {
    // Notification failure must not crash the panel render loop.
  }
}

// ── Globe overlay ─────────────────────────────────────────────────────────

function emitGlobeOverlay(entries: ShortageSummaryEntry[]): void {
  if (typeof window === 'undefined' || typeof CustomEvent === 'undefined') return;
  const regionRisk: { commodity: string; countries: string[]; riskLevel: RiskLevel; score: number }[] = [];
  for (const e of entries) {
    if (e.riskLevel === 'LOW') continue;
    const pb = getPlaybook(e.commodity);
    if (pb?.affectedCountries && pb.affectedCountries.length > 0) {
      regionRisk.push({
        commodity: e.commodity,
        countries: pb.affectedCountries,
        riskLevel: e.riskLevel,
        score: e.riskScore,
      });
    }
  }
  window.dispatchEvent(new CustomEvent('wm:shortage-risk-data', { detail: regionRisk }));
}

// ── Sidecar push ──────────────────────────────────────────────────────────

async function pushToSidecar(entries: ShortageSummaryEntry[]): Promise<void> {
  const base = getApiBaseUrl();
  if (!base) return; // web build — no sidecar
  try {
    const payload = {
      entries: entries.map((e) => ({
        commodity: e.commodity,
        riskScore: e.riskScore,
        riskLevel: e.riskLevel,
        primaryDrivers: e.primaryDrivers,
        timeToImpact: e.timeToImpact,
        trend: e.trend,
        forecast: e.forecast,
      })),
      updatedAt: Date.now(),
      ttlMs: SIDECAR_PUSH_TTL_MS,
    };
    await fetch(`${base}/api/shortage/state`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(4000),
    });
  } catch {
    // Sidecar push is best-effort; the panel renders locally regardless.
  }
}

// ── Panel class ───────────────────────────────────────────────────────────

export class ShortageRadarPanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private inputs: Partial<Record<FullSetCommodity, ShortageInputBag>> = {};

  constructor() {
    super({
      id: 'shortage-radar',
      title: 'Shortage Radar',
      showCount: true,
      trackActivity: true,
      infoTooltip:
        'Shortage risk across 8 commodities: wheat, corn, rice, soybeans, diesel, gasoline, natural gas, jet fuel. Sorted by risk. Click a card for the full drill-down.',
    });
    this.start();
  }

  /** Inject live commodity inputs from the data loader. */
  public setInputs(inputs: Partial<Record<FullSetCommodity, ShortageInputBag>>): void {
    this.inputs = { ...inputs };
    this.render();
  }

  /** Legacy compat shim — previous callers used setRequests(). */
  public setRequests(requests: readonly { commodity: FullSetCommodity; inputs: ShortageInputBag }[]): void {
    const map: Partial<Record<FullSetCommodity, ShortageInputBag>> = {};
    for (const r of requests) map[r.commodity] = r.inputs;
    this.setInputs(map);
  }

  public dispose(): void {
    if (this.refreshTimer !== null) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  private start(): void {
    this.render();
    this.refreshTimer = setInterval(() => this.render(), REFRESH_MS);
  }

  private render(): void {
    const entries = computeShortageFullSet(this.inputs);
    const criticalCount = entries.filter((e) => e.riskLevel === 'CRITICAL').length;
    const alertCount = entries.filter((e) => e.riskLevel === 'CRITICAL' || e.riskLevel === 'HIGH').length;
    this.setCount(alertCount);

    for (const e of entries) checkAndNotify(e);
    emitGlobeOverlay(entries);
    void pushToSidecar(entries);

    this.setContent(this.buildHtml(entries, criticalCount));
  }

  private buildHtml(entries: ShortageSummaryEntry[], criticalCount: number): string {
    const plural = criticalCount === 1 ? '' : 'S';
    const bannerHtml = criticalCount > 0
      ? `<div style="padding:6px 12px;background:rgba(213,0,0,0.15);border-bottom:1px solid rgba(213,0,0,0.3);font-size:11px;font-weight:700;color:#d50000;letter-spacing:0.04em;">
           ⚠ ${criticalCount} CRITICAL SHORTAGE${plural} DETECTED
         </div>`
      : '';

    // 2×4 grid — ordered by commodity position (not sorted by risk) so
    // the grid layout stays stable across refreshes. Tier badges provide
    // the urgency signal.
    const ordered: ShortageSummaryEntry[] = [];
    for (const c of ALL_FULLSET_COMMODITIES) {
      const e = entries.find((x) => x.commodity === c);
      if (e) ordered.push(e);
    }

    const cards = ordered.map((e) => this.buildCard(e)).join('');

    return `${bannerHtml}
      <div style="padding:10px;display:grid;grid-template-columns:1fr 1fr;gap:8px;">
        ${cards}
      </div>`;
  }

  private buildCard(e: ShortageSummaryEntry): string {
    const color = RISK_COLOR[e.riskLevel];
    const bg = RISK_BG[e.riskLevel];
    const arrow = TREND_ARROW[e.trend];
    const arrowColor = TREND_COLOR[e.trend];
    const topDriver = e.primaryDrivers[0] ? escapeHtml(e.primaryDrivers[0]) : 'No drivers';
    const gapDot = e.forecast.dataGaps.length > 0
      ? `<span title="${escapeHtml(e.forecast.dataGaps[0] ?? '')}" style="color:#ff9800;font-size:10px;" aria-label="data gaps">⚠</span>`
      : '';

    return `<div
      data-shortage-commodity="${escapeHtml(e.commodity)}"
      role="button"
      tabindex="0"
      style="border:1px solid var(--border-subtle,#333);border-left:3px solid ${color};border-radius:4px;padding:9px 10px;cursor:pointer;background:${bg};transition:filter 0.15s;"
      onmouseenter="this.style.filter='brightness(1.1)'"
      onmouseleave="this.style.filter=''"
    >
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;">
        <span style="font-weight:700;font-size:12px;">${escapeHtml(DISPLAY_NAME[e.commodity])}</span>
        <span style="display:flex;align-items:center;gap:4px;">
          ${gapDot}
          <span style="color:${arrowColor};font-size:12px;" title="${escapeHtml(e.trend)}">${arrow}</span>
        </span>
      </div>
      <div style="display:flex;align-items:baseline;gap:6px;margin-bottom:4px;">
        <span style="font-size:18px;font-weight:700;color:${color};font-family:ui-monospace,monospace;">${e.riskScore.toFixed(0)}</span>
        <span style="font-size:10px;font-weight:700;color:${color};text-transform:uppercase;letter-spacing:0.06em;padding:1px 4px;border:1px solid ${color};border-radius:2px;">${e.riskLevel}</span>
      </div>
      <div style="font-size:10px;color:var(--text-secondary,#aaa);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${escapeHtml(e.primaryDrivers.join(' · '))}">${topDriver}</div>
      <div style="font-size:10px;color:var(--text-secondary,#777);margin-top:2px;">${escapeHtml(e.timeToImpact)}</div>
    </div>`;
  }
}

// ── Click delegation ───────────────────────────────────────────────────────
// Attached once at module load so all card clicks dispatch the drill-down
// event regardless of how many times the panel re-renders.

if (typeof document !== 'undefined') {
  document.addEventListener('click', (ev) => {
    const target = (ev.target as Element)?.closest('[data-shortage-commodity]');
    if (!target) return;
    const commodity = target.getAttribute('data-shortage-commodity');
    if (!commodity) return;
    document.dispatchEvent(
      new CustomEvent('wm:shortage-drill-down', { detail: { commodity }, bubbles: true }),
    );
  });

  document.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Enter' && ev.key !== ' ') return;
    const target = (ev.target as Element)?.closest('[data-shortage-commodity]');
    if (!target) return;
    const commodity = target.getAttribute('data-shortage-commodity');
    if (!commodity) return;
    document.dispatchEvent(
      new CustomEvent('wm:shortage-drill-down', { detail: { commodity }, bubbles: true }),
    );
  });
}

// Re-export type for external callers.


export {type ShortageSummaryEntry, type FullSetCommodity, type RiskLevel, type Trend} from '@/services/shortage/shortage-fullset';