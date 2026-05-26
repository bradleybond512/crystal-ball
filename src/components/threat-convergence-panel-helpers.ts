/**
 * Pure rendering helpers for ThreatConvergencePanel.
 *
 * Extracted from the panel class so the rendering can be tested
 * without happy-dom + the Vite loader hook (the panel itself imports
 * the Panel base class, which transitively pulls in workers/analytics).
 *
 * All functions are pure: input → HTML string. No DOM, no fetch,
 * no globals (the only globalThis read is in `resolveFatigueScore`,
 * which is opt-in).
 */

import { escapeHtml } from '@/utils/sanitize';
import {
  ageLabel,
  colorForScore,
  labelForScore,
  recommendationForScore,
  severityColor,
  severityLabel,
  type ActiveWindowStats,
  type ConvergenceEvent,
  type ConvergenceRecommendation,
  type DomainElevation,
} from '@/services/intelligence/mission-bridges/threat-convergence-bridge';

export const WINDOW_MS = 60 * 60 * 1000;
export const HISTORY_LIMIT = 20;
export const ELEVATION_FEED_LIMIT = 30;

export const RECOMMENDATION_LABEL: Record<ConvergenceRecommendation, string> = {
  monitor: 'Monitor',
  elevate: 'Elevate posture',
  crisis: 'Crisis response',
};

export const RECOMMENDATION_DETAIL: Record<ConvergenceRecommendation, string> = {
  monitor: 'Continue normal watch cadence; cross-domain pressure is rising but below critical.',
  elevate: 'Promote watches, brief stakeholders, and check escalation playbooks.',
  crisis: 'Trigger crisis playbook — multiple high-severity domains are firing simultaneously.',
};

// ── safe() wrapper for any service call that may throw ────────────────

export function safe<T>(fn: () => T): T | undefined {
  try { return fn(); } catch { return undefined; }
}

// ── Fatigue lookup (opt-in via globalThis) ────────────────────────────

interface FatigueLike {
  getFatigueReport?: (windowMs: number) => { fatigueScore: number };
}
interface FatigueDetectorModule {
  AlertFatigueDetector?: { getInstance?: () => FatigueLike };
}

export function resolveFatigueScore(windowMs: number): number | undefined {
  const slot = (globalThis as { __crystalballFatigueDetector?: FatigueDetectorModule }).__crystalballFatigueDetector;
  const inst = safe(() => slot?.AlertFatigueDetector?.getInstance?.());
  const report = safe(() => inst?.getFatigueReport?.(windowMs));
  return report?.fatigueScore;
}

// ── Section: unavailable banner (no detector) ─────────────────────────

export function renderUnavailable(): string {
  return `<div style="padding:18px;text-align:center;color:var(--text-secondary,#aaa);font-size:13px;">
    Threat convergence detector is not registered yet. The panel will populate once the detector service is loaded.
  </div>`;
}

// ── Section 1: Convergence Alert banner ───────────────────────────────

export function renderAlert(current: ConvergenceEvent | null): string {
  if (!current) {
    return `<div data-section="alert" style="border:1px solid var(--border-subtle,#333);border-radius:4px;padding:10px 12px;font-size:12px;color:var(--text-secondary,#aaa);">
      No active convergence detected in the current window.
    </div>`;
  }
  const color = colorForScore(current.score);
  const rec = recommendationForScore(current.score);
  const recLabel = RECOMMENDATION_LABEL[rec];
  const recDetail = RECOMMENDATION_DETAIL[rec];
  const domains = current.domains.map((d) => `<span style="background:rgba(255,255,255,0.06);padding:1px 5px;border-radius:2px;font-size:10px;">${escapeHtml(d)}</span>`).join(' ');
  return `<div data-section="alert" data-recommendation="${escapeHtml(rec)}" style="border-left:4px solid ${color};background:rgba(255,255,255,0.03);padding:10px 12px;border-radius:4px;display:flex;flex-direction:column;gap:6px;">
    <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
      <span style="font-weight:700;color:${color};font-size:13px;letter-spacing:0.04em;">${escapeHtml(labelForScore(current.score))}</span>
      <span style="font-size:10px;color:var(--text-secondary,#aaa);font-family:ui-monospace,monospace;">score ${current.score.toFixed(2)} · ${escapeHtml(ageLabel(current.detectedAt))}</span>
    </div>
    <div style="font-size:11px;color:var(--text-secondary,#aaa);">${current.domains.length} domains firing within ${Math.round(current.windowMs / 60_000)}m: ${domains}</div>
    <div style="font-size:11px;"><strong style="color:${color};">${escapeHtml(recLabel)}</strong> — <span style="color:var(--text-secondary,#aaa);">${escapeHtml(recDetail)}</span></div>
  </div>`;
}

// ── Section: Active Window Status ─────────────────────────────────────

export function renderWindowStatus(stats: ActiveWindowStats): string {
  const sinceLast = stats.msSinceLastElevation === null
    ? 'no elevations in window'
    : `last elevation ${ageLabel(Date.now() - stats.msSinceLastElevation)}`;
  const fatigueChip = stats.fatigueScore === undefined
    ? ''
    : `<div data-stat="fatigue" style="display:flex;flex-direction:column;gap:2px;">
        <span style="font-size:10px;color:var(--text-secondary,#aaa);text-transform:uppercase;letter-spacing:0.05em;">Fatigue</span>
        <span style="font-size:14px;font-weight:700;font-family:ui-monospace,monospace;color:${fatigueColorFor(stats.fatigueScore)};">${Math.round(stats.fatigueScore * 100)}%</span>
      </div>`;
  return `<div data-section="window" style="border:1px solid var(--border-subtle,#333);border-radius:4px;padding:10px 12px;display:flex;flex-direction:column;gap:8px;">
    <div style="font-size:11px;color:var(--text-secondary,#aaa);text-transform:uppercase;letter-spacing:0.05em;font-weight:600;">Active window (${Math.round(WINDOW_MS / 60_000)}m)</div>
    <div style="display:flex;flex-wrap:wrap;gap:18px;">
      <div data-stat="elevated" style="display:flex;flex-direction:column;gap:2px;">
        <span style="font-size:10px;color:var(--text-secondary,#aaa);text-transform:uppercase;letter-spacing:0.05em;">Elevated domains</span>
        <span style="font-size:14px;font-weight:700;font-family:ui-monospace,monospace;">${stats.elevatedDomains}</span>
      </div>
      <div data-stat="peak" style="display:flex;flex-direction:column;gap:2px;">
        <span style="font-size:10px;color:var(--text-secondary,#aaa);text-transform:uppercase;letter-spacing:0.05em;">Peak severity</span>
        <span style="font-size:14px;font-weight:700;font-family:ui-monospace,monospace;color:${severityColor(stats.peakSeverity)};">${escapeHtml(severityLabel(stats.peakSeverity))}</span>
      </div>
      <div data-stat="since" style="display:flex;flex-direction:column;gap:2px;">
        <span style="font-size:10px;color:var(--text-secondary,#aaa);text-transform:uppercase;letter-spacing:0.05em;">Last elevation</span>
        <span style="font-size:14px;font-weight:700;font-family:ui-monospace,monospace;">${escapeHtml(sinceLast)}</span>
      </div>
      ${fatigueChip}
    </div>
  </div>`;
}

function fatigueColorFor(score: number): string {
  if (score > 0.66) return '#ef4444';
  if (score > 0.33) return '#f59e0b';
  return '#22c55e';
}

// ── Section: Convergence History (last N) ─────────────────────────────

export function renderHistory(history: readonly ConvergenceEvent[]): string {
  const heading = `<div style="font-size:11px;color:var(--text-secondary,#aaa);text-transform:uppercase;letter-spacing:0.05em;font-weight:600;">Convergence history (${history.length})</div>`;
  if (history.length === 0) {
    return `<div data-section="history" style="display:flex;flex-direction:column;gap:6px;">
      ${heading}
      <div style="font-size:12px;color:var(--text-secondary,#aaa);">No prior convergence events.</div>
    </div>`;
  }
  const rows = history.map((e) => {
    const color = colorForScore(e.score);
    const peakSev = Math.max(0, Math.min(4, Math.round(e.score * 4)));
    return `<div data-history-id="${escapeHtml(e.id)}" style="display:flex;align-items:center;gap:8px;padding:4px 8px;border-left:3px solid ${color};background:rgba(255,255,255,0.02);border-radius:2px;font-size:11px;">
      <span style="font-family:ui-monospace,monospace;color:var(--text-secondary,#aaa);width:78px;">${escapeHtml(ageLabel(e.detectedAt))}</span>
      <span style="flex:1;color:#e5e5e5;">${e.domains.length} domain${e.domains.length === 1 ? '' : 's'}</span>
      <span style="font-size:10px;color:${severityColor(peakSev)};font-family:ui-monospace,monospace;">${escapeHtml(severityLabel(peakSev))}</span>
      <span style="font-size:10px;color:${color};font-family:ui-monospace,monospace;width:48px;text-align:right;">${e.score.toFixed(2)}</span>
    </div>`;
  }).join('');
  return `<div data-section="history" style="display:flex;flex-direction:column;gap:6px;">
    ${heading}
    <div style="display:flex;flex-direction:column;gap:3px;max-height:280px;overflow-y:auto;">${rows}</div>
  </div>`;
}

// ── Section: Domain Elevation Feed ────────────────────────────────────

export function renderElevationFeed(elevations: readonly DomainElevation[]): string {
  const recent = [...elevations].sort((a, b) => b.timestamp - a.timestamp).slice(0, ELEVATION_FEED_LIMIT);
  const heading = `<div style="font-size:11px;color:var(--text-secondary,#aaa);text-transform:uppercase;letter-spacing:0.05em;font-weight:600;">Domain elevations (${recent.length})</div>`;
  if (recent.length === 0) {
    return `<div data-section="elevations" style="display:flex;flex-direction:column;gap:6px;">
      ${heading}
      <div style="font-size:12px;color:var(--text-secondary,#aaa);">No domain elevations recorded.</div>
    </div>`;
  }
  const rows = recent.map((e) => {
    const sev = Math.max(0, Math.min(4, Math.round(e.severity)));
    return `<div style="display:flex;align-items:center;gap:8px;padding:4px 8px;border-left:3px solid ${severityColor(sev)};background:rgba(255,255,255,0.02);border-radius:2px;font-size:11px;">
      <span style="flex:1;color:#e5e5e5;font-weight:600;">${escapeHtml(e.domain)}</span>
      <span style="font-size:10px;color:${severityColor(sev)};font-family:ui-monospace,monospace;background:rgba(255,255,255,0.04);padding:1px 5px;border-radius:2px;">${escapeHtml(severityLabel(sev))}</span>
      <span style="font-family:ui-monospace,monospace;color:var(--text-secondary,#aaa);width:72px;text-align:right;">${escapeHtml(ageLabel(e.timestamp))}</span>
    </div>`;
  }).join('');
  return `<div data-section="elevations" style="display:flex;flex-direction:column;gap:6px;">
    ${heading}
    <div style="display:flex;flex-direction:column;gap:3px;max-height:320px;overflow-y:auto;">${rows}</div>
  </div>`;
}
