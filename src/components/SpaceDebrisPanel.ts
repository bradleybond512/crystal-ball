/**
 * SpaceDebrisPanel (panel id: `space-debris`).
 *
 * Tracks the orbital debris crisis as a geopolitical security issue.
 *
 * Sections:
 *   1. Kessler Risk Header     — computed risk index, total tracked objects, removal missions.
 *   2. Orbit Regime Table      — per-regime density, collision risk, key threat.
 *   3. Debris Event Log        — historical events sorted by severity descending.
 *
 * Pure logic lives in `space-debris-helpers.ts` so all classifiers and
 * aggregations stay testable in isolation.
 */

import { Panel } from './Panel';
import {
  buildRenderData,
  debrisSeverityClass,
  regimeDensityClass,
  type DebrisRenderData,
  type DebrisEvent,
  type OrbitRegimeStatus,
  type DebrisDensity,
} from './space-debris-helpers';

const REFRESH_MS = 24 * 60 * 60 * 1000; // 24 hours

export class SpaceDebrisPanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private data: DebrisRenderData;

  constructor() {
    super({
      id: 'space-debris',
      title: 'Space Debris',
      showCount: true,
      trackActivity: true,
      infoTooltip:
        'Orbital debris crisis tracker: Kessler risk index, per-regime density status, ASAT test history, and conjunction threat log.',
    });
    this.data = buildRenderData();
    this.render();
    if (typeof setInterval !== 'undefined') {
      this.refreshTimer = setInterval(() => {
        this.data = buildRenderData();
        this.render();
      }, REFRESH_MS);
    }
  }

  private get badgeCount(): number {
    return this.data.events.filter((e) => e.severity >= 7 && e.stillInOrbit).length;
  }

  private render(): void {
    const d = this.data;
    const html = [
      renderKesslerHeader(d),
      renderOrbitRegimeTable(d.orbitRegimes),
      renderDebrisEventLog(d.events),
    ].join('');
    this.setContent(
      `<div class="space-debris-panel" style="padding:var(--space-3,12px);display:flex;flex-direction:column;gap:var(--space-4,16px);">${html}</div>`,
    );
    this.setCount(this.badgeCount);
    this.markFresh();
  }

  override destroy(): void {
    if (this.refreshTimer !== null) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    super.destroy();
  }
}

// ── Section renderers (HTML string builders) ──────────────────────────────

function esc(s: string | number): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function kesslerRiskLabel(index: number): string {
  if (index >= 80) return 'CRITICAL';
  if (index >= 60) return 'HIGH';
  if (index >= 40) return 'ELEVATED';
  return 'MODERATE';
}

function kesslerRiskColor(index: number): string {
  if (index >= 80) return 'var(--severity-critical, #ef4444)';
  if (index >= 60) return 'var(--severity-high,     #fb923c)';
  if (index >= 40) return 'var(--severity-medium,   #facc15)';
  return 'var(--severity-low,      #4caf50)';
}

function renderKesslerHeader(d: DebrisRenderData): string {
  const color = kesslerRiskColor(d.kesslerRiskIndex);
  const label = kesslerRiskLabel(d.kesslerRiskIndex);
  const pct = Math.min(100, d.kesslerRiskIndex);
  return `
    <div style="background:var(--surface-2,#1e1e2e);border:1px solid var(--border,#333);border-radius:6px;padding:10px 12px;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
        <span style="font-size:11px;color:var(--text-muted,#888);text-transform:uppercase;letter-spacing:.5px;">Kessler Cascade Risk Index</span>
        <span style="font-size:13px;font-weight:700;color:${esc(color)};">${esc(label)} — ${esc(d.kesslerRiskIndex)}/100</span>
      </div>
      <div style="height:6px;background:var(--surface-3,#2a2a3c);border-radius:3px;overflow:hidden;margin-bottom:10px;">
        <div style="height:100%;width:${esc(pct)}%;background:${esc(color)};transition:width .4s ease;"></div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;">
        <div style="text-align:center;">
          <div style="font-size:18px;font-weight:700;color:var(--text-primary,#fff);">${esc(d.totalTrackedObjects.toLocaleString())}</div>
          <div style="font-size:10px;color:var(--text-muted,#888);">Tracked Objects</div>
        </div>
        <div style="text-align:center;">
          <div style="font-size:18px;font-weight:700;color:var(--severity-critical,#ef4444);">${esc(d.events.filter((e) => e.stillInOrbit && e.severity >= 7).length)}</div>
          <div style="font-size:10px;color:var(--text-muted,#888);">High-Risk Clouds</div>
        </div>
        <div style="text-align:center;">
          <div style="font-size:18px;font-weight:700;color:var(--severity-medium,#facc15);">${esc(d.activeRemovalMissions)}</div>
          <div style="font-size:10px;color:var(--text-muted,#888);">Removal Missions</div>
        </div>
      </div>
    </div>`;
}

function renderOrbitRegimeTable(regimes: OrbitRegimeStatus[]): string {
  const rows = regimes
    .map((r) => {
      const dColor = regimeDensityClass(r.debrisDensity);
      const rColor = regimeDensityClass(r.collisionRisk as DebrisDensity);
      return `
        <tr>
          <td style="padding:5px 6px;font-size:11px;color:var(--text-primary,#fff);white-space:nowrap;">${esc(r.regime)}</td>
          <td style="padding:5px 6px;font-size:11px;text-align:right;">${esc(r.trackedObjects.toLocaleString())}</td>
          <td style="padding:5px 6px;font-size:11px;text-align:center;">
            <span style="color:${esc(dColor)};font-weight:600;">${esc(r.debrisDensity)}</span>
          </td>
          <td style="padding:5px 6px;font-size:11px;text-align:center;">
            <span style="color:${esc(rColor)};font-weight:600;">${esc(r.collisionRisk)}</span>
          </td>
          <td style="padding:5px 6px;font-size:10px;color:var(--text-muted,#888);max-width:160px;">${esc(r.keyThreat)}</td>
        </tr>`;
    })
    .join('');

  return `
    <div>
      <div style="font-size:11px;color:var(--text-muted,#888);text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px;">Orbit Regime Status</div>
      <div style="overflow-x:auto;">
        <table style="width:100%;border-collapse:collapse;">
          <thead>
            <tr style="border-bottom:1px solid var(--border,#333);">
              <th style="padding:4px 6px;font-size:10px;color:var(--text-muted,#888);font-weight:500;text-align:left;">Regime</th>
              <th style="padding:4px 6px;font-size:10px;color:var(--text-muted,#888);font-weight:500;text-align:right;">Tracked</th>
              <th style="padding:4px 6px;font-size:10px;color:var(--text-muted,#888);font-weight:500;text-align:center;">Density</th>
              <th style="padding:4px 6px;font-size:10px;color:var(--text-muted,#888);font-weight:500;text-align:center;">Collision Risk</th>
              <th style="padding:4px 6px;font-size:10px;color:var(--text-muted,#888);font-weight:500;text-align:left;">Key Threat</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>`;
}

function renderDebrisEventLog(events: DebrisEvent[]): string {
  const sorted = [...events].sort((a, b) => b.severity - a.severity);

  const rows = sorted
    .map((e) => {
      const sColor = debrisSeverityClass(e.severity);
      const inOrbitBadge = e.stillInOrbit
        ? `<span style="font-size:9px;background:var(--severity-critical,#ef4444);color:#fff;border-radius:10px;padding:1px 5px;margin-left:4px;">IN ORBIT</span>`
        : `<span style="font-size:9px;background:var(--surface-3,#2a2a3c);color:var(--text-muted,#888);border-radius:10px;padding:1px 5px;margin-left:4px;">DECAYED</span>`;
      return `
        <tr style="border-bottom:1px solid var(--border,#2a2a3c);">
          <td style="padding:5px 6px;vertical-align:top;">
            <div style="display:flex;align-items:center;flex-wrap:wrap;gap:2px;">
              <span style="font-size:11px;font-weight:600;color:var(--text-primary,#fff);">${esc(e.name)}</span>
              ${inOrbitBadge}
            </div>
            <div style="font-size:10px;color:var(--text-muted,#888);margin-top:2px;">${esc(e.actor)} · ${esc(e.date.slice(0, 4))} · ${esc(e.eventType)} · ${esc(e.orbitRegime)}</div>
            <div style="font-size:10px;color:var(--text-muted,#777);margin-top:2px;">${esc(e.description)}</div>
          </td>
          <td style="padding:5px 6px;vertical-align:top;text-align:right;white-space:nowrap;">
            <div style="font-size:13px;font-weight:700;color:${esc(sColor)};">${esc(e.severity)}/10</div>
            <div style="font-size:10px;color:var(--text-muted,#888);">${esc(e.fragmentCount.toLocaleString())} frags</div>
          </td>
        </tr>`;
    })
    .join('');

  return `
    <div>
      <div style="font-size:11px;color:var(--text-muted,#888);text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px;">Debris Event Log — Sorted by Severity</div>
      <table style="width:100%;border-collapse:collapse;">
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}
