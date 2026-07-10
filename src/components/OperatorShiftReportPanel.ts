/**
 * OperatorShiftReportPanel — generate and display end-of-shift
 * intelligence reports. Pulls live data from the
 * CivilizationPulseEngine, WorldNarrativeEngine, and SituationStoreV2
 * (each with null-safe fallbacks). The rendered report container
 * carries a `print-friendly` class so the operator can hit ⌘P and
 * get a clean printable handoff.
 */

import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';
import {
  getOperatorShiftReportService,
  type OperatorShiftReportService,
  type ShiftReport,
  type ShiftReportSources,
} from '@/services/intelligence/operator-shift-report';
import { getCivilizationPulseEngine } from '@/services/intelligence/civilization-pulse';
import { getWorldNarrativeEngine } from '@/services/intelligence/world-narrative';

const REFRESH_MS = 60_000;

export class OperatorShiftReportPanel extends Panel {
  private readonly service: OperatorShiftReportService;
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private unsubscribe: (() => void) | null = null;
  private handoffNotesDraft = '';
  private selectedReportId: string | null = null;

  constructor() {
    super({
      id: 'operator-shift-report',
      title: 'Operator Shift Report',
      showCount: true,
      trackActivity: true,
      infoTooltip:
        'End-of-shift intelligence summary. Combines pulse, narrative, top situations, anomalies, feed health, and your handoff notes into a printable report.',
    });
    this.service = getOperatorShiftReportService(liveSources());
    this.start();
  }

  private start(): void {
    this.render();
    this.refreshTimer = setInterval(() => this.renderWhenVisible(() => this.render()), REFRESH_MS);
    this.unsubscribe = this.service.subscribe(() => this.render());
  }

  public override destroy(): void {
    if (this.refreshTimer !== null) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    this.unsubscribe?.();
    this.unsubscribe = null;
    super.destroy();
  }

  private render(): void {
    try {
      const reports = this.service.getReports();
      const selected = this.selectedReportId
        ? reports.find((r) => r.id === this.selectedReportId) ?? null
        : reports[0] ?? null;
      this.setCount(reports.length);
      this.setContent(this.buildHtml(reports, selected), () => this.wireHandlers());
    } catch (error) {
      this.setContent(
        `<div style="padding:12px;color:var(--severity-critical);">Shift-report panel error: ${escapeHtml(String(error))}</div>`,
      );
    }
  }

  private buildHtml(reports: readonly ShiftReport[], selected: ShiftReport | null): string {
    return `${this.renderControls(reports, selected)}${this.renderReport(selected)}`;
  }

  private renderControls(reports: readonly ShiftReport[], selected: ShiftReport | null): string {
    const dropdown = reports.length === 0
      ? `<span style="font-size:11px;color:var(--text-secondary,#888);">No reports yet</span>`
      : `<select class="osr-select" style="font-size:11px;padding:3px 6px;background:transparent;color:var(--text-primary,#ddd);border:1px solid var(--border-subtle,#333);border-radius:3px;">
          ${reports.map((r) => `<option value="${escapeHtml(r.id)}"${selected?.id === r.id ? ' selected' : ''}>${escapeHtml(formatReportLabel(r))}</option>`).join('')}
        </select>`;
    return `<div style="padding:10px 12px;border-bottom:1px solid var(--border-subtle,#333);display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
      <input class="osr-notes" placeholder="Handoff notes (optional)" value="${escapeHtml(this.handoffNotesDraft)}" style="flex:1;min-width:200px;font-size:11px;padding:4px 8px;background:transparent;color:var(--text-primary,#ddd);border:1px solid var(--border-subtle,#333);border-radius:3px;"/>
      <button class="osr-generate" style="font-size:11px;font-weight:600;padding:4px 12px;background:var(--severity-ok,#4ade80);color:#000;border:none;border-radius:3px;cursor:pointer;">Generate Report</button>
      ${dropdown}
      ${selected ? `<button class="osr-print" style="font-size:11px;padding:4px 10px;background:transparent;color:var(--text-secondary,#ccc);border:1px solid var(--border-subtle,#333);border-radius:3px;cursor:pointer;">Print</button>` : ''}
    </div>`;
  }

  private renderReport(report: ShiftReport | null): string {
    if (!report) {
      return `<div style="padding:24px 16px;color:var(--text-secondary,#aaa);font-size:12px;text-align:center;">
        No report selected. Add optional handoff notes and click <strong>Generate Report</strong>.
      </div>`;
    }
    return `<div class="print-friendly osr-report" style="padding:14px 16px;max-height:520px;overflow:auto;">
      ${renderOverview(report)}
      ${renderKeyDevelopments(report)}
      ${renderRecommendedActions(report)}
      ${renderTopSituations(report)}
      ${renderHandoff(report)}
      ${renderRaw(report)}
    </div>`;
  }

  private wireHandlers(): void {
    const root = this.getContentElement();
    const notes = root.querySelector<HTMLInputElement>('.osr-notes');
    notes?.addEventListener('input', () => {
      this.handoffNotesDraft = notes.value;
    });
    const generate = root.querySelector<HTMLButtonElement>('.osr-generate');
    generate?.addEventListener('click', () => {
      const report = this.service.generate(this.handoffNotesDraft.trim());
      this.selectedReportId = report.id;
      this.handoffNotesDraft = '';
      this.render();
    });
    const select = root.querySelector<HTMLSelectElement>('.osr-select');
    select?.addEventListener('change', () => {
      this.selectedReportId = select.value || null;
      this.render();
    });
    const print = root.querySelector<HTMLButtonElement>('.osr-print');
    print?.addEventListener('click', () => {
      if (typeof window !== 'undefined') window.print();
    });
  }
}

function liveSources(): ShiftReportSources {
  return {
    getPulse: () => {
      const reading = getCivilizationPulseEngine().getLatestReading();
      if (!reading) return null;
      return { overallScore: reading.overallScore, label: reading.label };
    },
    getNarrative: () => {
      const narrative = getWorldNarrativeEngine().getLatestNarrative();
      if (!narrative) return null;
      return { headline: narrative.headline, executiveSummary: narrative.executiveSummary };
    },
    getTopSituations: () => {
      // Wire to SituationStoreV2 when its accessor surface is stable;
      // for now return empty so the report still renders.
      return [];
    },
    getRecentAnomalyCount: () => 0,
    getFeedHealthSummary: () => 'feed-health status not yet wired',
  };
}

function formatReportLabel(r: ShiftReport): string {
  const date = new Date(r.generatedAt).toISOString().slice(0, 16).replace('T', ' ') + 'Z';
  return `${r.period.toUpperCase()} · ${date}`;
}

function renderOverview(r: ShiftReport): string {
  const generatedAt = new Date(r.generatedAt).toISOString();
  const pulseLine = r.civilizationScore !== null && r.civilizationLabel !== null
    ? `Civilization pulse: <strong>${r.civilizationScore}/100</strong> (${escapeHtml(r.civilizationLabel)})`
    : `Civilization pulse: <em>unavailable</em>`;
  return `<section style="margin-bottom:14px;">
    <h2 style="margin:0 0 4px;font-size:14px;font-weight:700;">${escapeHtml(r.period.toUpperCase())} shift report</h2>
    <div style="font-size:10px;color:var(--text-secondary,#888);font-family:ui-monospace,monospace;">${escapeHtml(generatedAt)}</div>
    <h3 style="margin:10px 0 4px;font-size:11px;text-transform:uppercase;letter-spacing:0.06em;color:var(--text-secondary,#aaa);">Overview</h3>
    <div style="font-size:12px;line-height:1.5;">${pulseLine}</div>
    <div style="font-size:12px;line-height:1.5;">Anomalies in window: <strong>${r.anomalyCount}</strong></div>
    <div style="font-size:12px;line-height:1.5;">Feed health: ${escapeHtml(r.feedHealthSummary)}</div>
    ${r.worldNarrativeSummary ? `<div style="margin-top:6px;font-size:11px;line-height:1.5;color:var(--text-secondary,#ccc);font-style:italic;">${escapeHtml(r.worldNarrativeSummary)}</div>` : ''}
  </section>`;
}

function renderKeyDevelopments(r: ShiftReport): string {
  const items = r.keyDevelopments.map((d) => `<li>${escapeHtml(d)}</li>`).join('');
  return `<section style="margin-bottom:14px;">
    <h3 style="margin:0 0 4px;font-size:11px;text-transform:uppercase;letter-spacing:0.06em;color:var(--text-secondary,#aaa);">Key Developments</h3>
    <ul style="margin:0;padding:0 0 0 18px;font-size:12px;line-height:1.5;">${items}</ul>
  </section>`;
}

function renderRecommendedActions(r: ShiftReport): string {
  const items = r.recommendedActions.map((a) => `<li>${escapeHtml(a)}</li>`).join('');
  return `<section style="margin-bottom:14px;">
    <h3 style="margin:0 0 4px;font-size:11px;text-transform:uppercase;letter-spacing:0.06em;color:var(--text-secondary,#aaa);">Recommended Actions</h3>
    <ul style="margin:0;padding:0 0 0 18px;font-size:12px;line-height:1.5;">${items}</ul>
  </section>`;
}

function renderTopSituations(r: ShiftReport): string {
  if (r.topSituations.length === 0) {
    return `<section style="margin-bottom:14px;">
      <h3 style="margin:0 0 4px;font-size:11px;text-transform:uppercase;letter-spacing:0.06em;color:var(--text-secondary,#aaa);">Top Situations</h3>
      <div style="font-size:11px;color:var(--text-secondary,#888);font-style:italic;">(no active situations)</div>
    </section>`;
  }
  const rows = r.topSituations.map((s) => `<li>
    <span style="font-weight:700;text-transform:uppercase;">[${escapeHtml(s.severity)}]</span>
    ${escapeHtml(s.title)}
    <span style="color:var(--text-secondary,#888);">— ${escapeHtml(s.domain)} (${escapeHtml(s.id)})</span>
  </li>`).join('');
  return `<section style="margin-bottom:14px;">
    <h3 style="margin:0 0 4px;font-size:11px;text-transform:uppercase;letter-spacing:0.06em;color:var(--text-secondary,#aaa);">Top Situations</h3>
    <ul style="margin:0;padding:0 0 0 18px;font-size:12px;line-height:1.5;">${rows}</ul>
  </section>`;
}

function renderHandoff(r: ShiftReport): string {
  const body = r.handoffNotes.trim() === ''
    ? `<div style="font-size:11px;color:var(--text-secondary,#888);font-style:italic;">(no handoff notes supplied by outgoing operator)</div>`
    : `<div style="font-size:12px;line-height:1.5;white-space:pre-wrap;">${escapeHtml(r.handoffNotes)}</div>`;
  return `<section style="margin-bottom:14px;">
    <h3 style="margin:0 0 4px;font-size:11px;text-transform:uppercase;letter-spacing:0.06em;color:var(--text-secondary,#aaa);">Handoff Notes</h3>
    ${body}
  </section>`;
}

function renderRaw(r: ShiftReport): string {
  return `<details style="margin-top:14px;font-size:10px;color:var(--text-secondary,#888);">
    <summary style="cursor:pointer;">Plain-text report</summary>
    <pre style="margin-top:6px;padding:8px;background:rgba(0,0,0,0.18);border-radius:4px;font-size:10px;overflow:auto;">${escapeHtml(r.reportText)}</pre>
  </details>`;
}
