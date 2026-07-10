/* eslint-disable sonarjs/no-nested-template-literals */
/**
 * Global Rhythm Panel — Phase 4 circadian / weekly / seasonal baselines.
 *
 * Domain selector on top, 24-hour heatmap of expected severity for the
 * selected domain, recent-anomaly list below, "unusual right now" badge
 * when the current hour's actual observations sit > 2σ above baseline.
 */

import { Panel } from './Panel';
import {
  BUILT_IN_SEEDS,
  getGlobalRhythmEngine,
  
  type AnomalyScore,
  type AnomalyStrength,
  type RhythmPattern,
} from '@/services/intelligence/global-rhythm';
import { escapeHtml } from '@/utils/sanitize';

const REFRESH_MS = 30_000;
const RECENT_LIMIT = 20;

const STRENGTH_COLOR: Record<AnomalyStrength, string> = {
  none: '#9e9e9e',
  mild: '#4a9eff',
  moderate: '#ffb74d',
  strong: '#f44336',
};

const STRENGTH_LABEL: Record<AnomalyStrength, string> = {
  none: 'normal',
  mild: 'mild',
  moderate: 'moderate',
  strong: 'strong',
};

interface PanelState {
  selectedDomain: string;
}

export class GlobalRhythmPanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private unsub: (() => void) | null = null;
  private state: PanelState = {
    selectedDomain: BUILT_IN_SEEDS[0]!.domain,
  };

  constructor() {
    super({
      id: 'global-rhythm',
      title: 'Global Rhythm',
      showCount: true,
      trackActivity: true,
      infoTooltip:
        'Phase 4 baseline rhythms. Tracks expected severity per hour-of-day, day-of-week, and month per domain using Welford\'s online stats. Eight seeded domains start with sensible defaults so anomalies are detectable from the first observation. Anomaly bands on |z|: 1–2 mild, 2–3 moderate, ≥3 strong.',
    });
    this.start();
  }

  private start(): void {
    this.render();
    this.refreshTimer = setInterval(() => this.renderWhenVisible(() => this.render()), REFRESH_MS);
    this.unsub = getGlobalRhythmEngine().subscribe(() => this.render());
  }

  public destroy(): void {
    super.destroy();
    if (this.refreshTimer !== null) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    if (this.unsub) {
      this.unsub();
      this.unsub = null;
    }
  }

  private domainsOnSurface(): string[] {
    // Seeded domains + any extra domain that has accumulated state.
    const out = new Set<string>(BUILT_IN_SEEDS.map((s) => s.domain));
    for (const p of getGlobalRhythmEngine().getAllPatterns()) out.add(p.domain);
    return [...out].sort((a, b) => a.localeCompare(b));
  }

  /** True when the most recent anomaly for the selected domain is at
   *  moderate or strong strength and falls in the current hour. */
  private isUnusualRightNow(domain: string): { unusual: boolean; latest?: AnomalyScore } {
    const engine = getGlobalRhythmEngine();
    const recent = engine.getRecentAnomalies(RECENT_LIMIT);
    const domainAnomalies = recent.filter((a) => a.domain === domain);
    if (domainAnomalies.length === 0) return { unusual: false };
    const latest = domainAnomalies[domainAnomalies.length - 1]!;
    const oneHour = 60 * 60 * 1000;
    const stillCurrent = Date.now() - latest.timestamp < oneHour;
    const aboveBaseline = latest.deviation > 0 && (latest.anomalyStrength === 'moderate' || latest.anomalyStrength === 'strong');
    return { unusual: stillCurrent && aboveBaseline, latest };
  }

  private render(): void {
    const engine = getGlobalRhythmEngine();
    const domains = this.domainsOnSurface();
    if (!domains.includes(this.state.selectedDomain)) {
      this.state.selectedDomain = domains[0] ?? this.state.selectedDomain;
    }
    const selected = this.state.selectedDomain;
    const circadian = engine.getAllPatterns().find(
      (p) => p.domain === selected && p.patternType === 'circadian',
    );
    const anomalies = engine.getRecentAnomalies(RECENT_LIMIT)
      .filter((a) => a.domain === selected);
    this.setCount(anomalies.filter((a) => a.isAnomaly).length);

    const unusual = this.isUnusualRightNow(selected);
    const html = `<div style="padding:12px;display:flex;flex-direction:column;gap:12px;">
      ${renderHeader(selected, domains, unusual.unusual, unusual.latest)}
      ${renderHeatmap(circadian)}
      ${renderAnomalyList(anomalies)}
    </div>`;
    this.setContent(html);
    this.wireDomainSelect();
  }

  private wireDomainSelect(): void {
    setTimeout(() => {
      const sel = this.content.querySelector<HTMLSelectElement>('#globalRhythmDomain');
      sel?.addEventListener('change', () => {
        this.state.selectedDomain = sel.value;
        this.render();
      });
    }, 0);
  }
}

function renderHeader(
  selected: string,
  domains: readonly string[],
  unusual: boolean,
  latest: AnomalyScore | undefined,
): string {
  const options = domains.map((d) =>
    `<option value="${escapeHtml(d)}"${d === selected ? ' selected' : ''}>${escapeHtml(d)}</option>`,
  ).join('');
  const badge = unusual && latest
    ? `<span style="font-size:11px;font-weight:700;letter-spacing:0.06em;padding:4px 10px;border-radius:3px;background:#f4433626;color:#f44336;">UNUSUAL — ${STRENGTH_LABEL[latest.anomalyStrength].toUpperCase()} (Δ ${latest.deviation.toFixed(2)})</span>`
    : '<span style="font-size:11px;color:var(--text-secondary,#aaa);">baseline within tolerance</span>';
  return `<div style="display:flex;align-items:center;gap:12px;">
    <label style="display:flex;align-items:center;gap:8px;font-size:11px;color:var(--text-secondary,#aaa);">
      Domain
      <select id="globalRhythmDomain" style="padding:4px 8px;background:var(--surface-2,#1a1a1a);color:inherit;border:1px solid var(--border-subtle,#333);border-radius:3px;font-size:12px;">${options}</select>
    </label>
    <div style="flex:1;text-align:right;">${badge}</div>
  </div>`;
}

function heatmapColor(value: number): string {
  // 0 → cool blue, 1 → hot red. Linear interpolation.
  const v = Math.max(0, Math.min(1, value));
  const r = Math.round(74 + (244 - 74) * v);
  const g = Math.round(158 + (67 - 158) * v);
  const b = Math.round(255 + (54 - 255) * v);
  return `rgb(${r}, ${g}, ${b})`;
}

function renderHeatmap(circadian: RhythmPattern | undefined): string {
  if (!circadian?.expectedSeverityByHour) {
    return `<div style="font-size:12px;color:var(--text-secondary,#aaa);">No circadian pattern available for this domain.</div>`;
  }
  const cells = circadian.expectedSeverityByHour.map((v, h) => {
    const color = heatmapColor(v);
    const hourLabel = `${h.toString().padStart(2, '0')}:00 UTC`;
    return `<div title="${escapeHtml(hourLabel)} · expected ${v.toFixed(2)}" style="flex:1;min-width:18px;height:36px;background:${color};display:flex;flex-direction:column;align-items:center;justify-content:flex-end;font-size:9px;color:#000;border-radius:1px;">
      <span>${(v * 100).toFixed(0)}</span>
    </div>`;
  }).join('');
  const axis = Array.from({ length: 24 }, (_, h) => h % 6 === 0
    ? `<span style="flex:1;text-align:center;">${h.toString().padStart(2, '0')}</span>`
    : `<span style="flex:1;"></span>`,
  ).join('');
  const obsPlural = circadian.sampleCount === 1 ? '' : 's';
  const learnedNote = circadian.sampleCount >= 8
    ? `Learned from ${circadian.sampleCount} observation${obsPlural}.`
    : `Seeded baseline (only ${circadian.sampleCount} observation${obsPlural} so far).`;
  return `<div>
    <div style="font-size:11px;color:var(--text-secondary,#aaa);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:6px;">Expected severity by hour (UTC)</div>
    <div style="display:flex;gap:1px;">${cells}</div>
    <div style="display:flex;gap:1px;margin-top:2px;font-size:9px;color:var(--text-secondary,#aaa);">${axis}</div>
    <div style="font-size:11px;color:var(--text-secondary,#aaa);margin-top:6px;">${escapeHtml(learnedNote)}</div>
  </div>`;
}

function renderAnomalyList(anomalies: readonly AnomalyScore[]): string {
  if (anomalies.length === 0) {
    return `<div>
      <div style="font-size:11px;color:var(--text-secondary,#aaa);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:4px;">Recent anomaly scores</div>
      <div style="font-size:12px;color:var(--text-secondary,#aaa);">No observations scored against this domain yet.</div>
    </div>`;
  }
  // eslint-disable-next-line unicorn/no-array-reverse
  const reversed = [...anomalies].reverse();
  const items = reversed.map((a) => {
    const color = STRENGTH_COLOR[a.anomalyStrength];
    const dir = a.deviation >= 0 ? '+' : '';
    const time = new Date(a.timestamp).toISOString().slice(11, 16);
    return `<li style="display:flex;align-items:center;gap:8px;padding:3px 0;border-bottom:1px solid var(--border-subtle,rgba(255,255,255,0.05));font-size:11px;">
      <span style="font-size:10px;font-weight:700;letter-spacing:0.04em;padding:2px 6px;border-radius:3px;background:${color}26;color:${color};">${STRENGTH_LABEL[a.anomalyStrength].toUpperCase()}</span>
      <span style="font-family:ui-monospace,monospace;">${escapeHtml(a.observationId)}</span>
      <span style="color:var(--text-secondary,#aaa);font-family:ui-monospace,monospace;">cur ${a.currentSeverityNum.toFixed(2)} · exp ${a.expectedSeverityNum.toFixed(2)}</span>
      <span style="color:var(--text-secondary,#aaa);margin-left:auto;font-family:ui-monospace,monospace;">${dir}${a.deviation.toFixed(2)} · ${escapeHtml(time)}</span>
    </li>`;
  }).join('');
  return `<div>
    <div style="font-size:11px;color:var(--text-secondary,#aaa);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:4px;">Recent anomaly scores</div>
    <ul style="margin:0;padding:0;list-style:none;">${items}</ul>
  </div>`;
}

// Re-export for unit tests / external callers.


export {severityToNumber} from '@/services/intelligence/global-rhythm';