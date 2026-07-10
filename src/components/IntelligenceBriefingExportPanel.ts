/**
 * Intelligence Briefing Export Panel (panel id: `intelligence-briefing-export`).
 *
 * Lets the operator pick a classification + title, generate a briefing
 * from current system state, preview it in a sandboxed iframe, see the
 * word count, download it as a self-contained .html file, and browse
 * history of prior briefings. The panel owns a service instance bound
 * to live providers; persistence shares the singleton's storage key
 * so history is consistent across surfaces.
 */
/* eslint-disable sonarjs/no-nested-template-literals */

import { Panel } from './Panel';
import {
  createIntelligenceBriefingExportService,
  type BriefingClassification,
  type IntelligenceBriefing,
  type IntelligenceBriefingExportService,
  type IntelligenceBriefingProviders,
} from '@/services/intelligence/intelligence-briefing-export';
import { getCivilizationPulseEngine } from '@/services/intelligence/civilization-pulse';
import { getWorldNarrativeEngine } from '@/services/intelligence/world-narrative';
import { getActive as getActiveSituations } from '@/services/intelligence/situation-store';
import { getThreatHorizonScanner } from '@/services/intelligence/threat-horizon';
import { getGeopoliticalEventCalendar } from '@/services/intelligence/geopolitical-event-calendar';
import { getIntelligenceHealthMonitorService } from '@/services/intelligence/intelligence-health-monitor';
import { escapeHtml } from '@/utils/sanitize';

const REFRESH_MS = 60_000;

const CLASSIFICATION_LABEL: Record<BriefingClassification, string> = {
  unclassified: 'Unclassified',
  internal: 'Internal',
  sensitive: 'Sensitive',
};

const CLASSIFICATION_COLOR: Record<BriefingClassification, string> = {
  unclassified: '#2ec27e',
  internal: '#f5a524',
  sensitive: '#e94f37',
};

const DAY_MS = 24 * 60 * 60 * 1000;
const BRIEFING_EVENT_HORIZON_MS = 30 * DAY_MS;

export class IntelligenceBriefingExportPanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private listener: ((briefing: IntelligenceBriefing) => void) | null = null;
  private classification: BriefingClassification = 'unclassified';
  private titleInput = 'Crystal Ball Intelligence Briefing';
  private current: IntelligenceBriefing | null = null;
  private readonly service: IntelligenceBriefingExportService;

  constructor() {
    super({
      id: 'intelligence-briefing-export',
      title: 'Briefing Export',
      showCount: true,
      trackActivity: true,
      infoTooltip:
        'Generates a polished HTML intelligence briefing from current system state. Downloadable as a self-contained file.',
    });
    this.service = createIntelligenceBriefingExportService({
      providers: buildLiveProviders(),
    });
    this.current = this.service.getLatest();
    this.listener = (briefing) => {
      this.current = briefing;
      this.render();
    };
    this.service.subscribe(this.listener);
    this.refreshTimer = setInterval(() => this.renderWhenVisible(() => this.render()), REFRESH_MS);
    this.render();
  }

  public override destroy(): void {
    if (this.refreshTimer !== null) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    if (this.listener) {
      this.service.unsubscribe(this.listener);
      this.listener = null;
    }
    super.destroy();
  }

  private render(): void {
    const history = this.service.getBriefings(10);
    this.setCount(history.length);
    this.setContent(this.buildHtml(history), () => this.wireHandlers());
  }

  private buildHtml(history: readonly IntelligenceBriefing[]): string {
    return `<div class="brief-panel" style="display:flex;flex-direction:column;gap:8px;padding:10px;font-size:12px;line-height:1.45;">
      ${this.renderControls()}
      ${this.renderPreview()}
      ${this.renderHistory(history)}
    </div>`;
  }

  private renderControls(): string {
    return `<form class="brief-form" style="display:flex;flex-direction:column;gap:5px;padding:8px;background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.08);border-radius:4px;">
      <label style="display:flex;flex-direction:column;gap:2px;font-size:10px;opacity:0.7;text-transform:uppercase;letter-spacing:0.04em;">
        Title
        <input class="brief-input-title" type="text" value="${escapeHtml(this.titleInput)}" style="padding:4px 6px;background:rgba(0,0,0,0.3);color:inherit;border:1px solid rgba(255,255,255,0.1);border-radius:2px;font-size:11px;font-family:inherit;" />
      </label>
      <div style="display:flex;gap:5px;align-items:flex-end;justify-content:space-between;">
        <div style="display:flex;gap:3px;flex-wrap:wrap;">
          ${(['unclassified', 'internal', 'sensitive'] as BriefingClassification[]).map((c) => this.renderClassificationChip(c)).join('')}
        </div>
        <button class="brief-generate" type="submit" style="padding:4px 12px;background:rgba(74,158,255,0.22);color:inherit;border:1px solid rgba(74,158,255,0.5);border-radius:2px;cursor:pointer;font-size:11px;font-family:inherit;">Generate</button>
      </div>
    </form>`;
  }

  private renderClassificationChip(value: BriefingClassification): string {
    const active = this.classification === value;
    const color = CLASSIFICATION_COLOR[value];
    const bg = active ? `${color}33` : 'rgba(255,255,255,0.04)';
    const border = active ? `${color}88` : 'rgba(255,255,255,0.1)';
    return `<button class="brief-classification" data-value="${escapeHtml(value)}" type="button" style="padding:2px 8px;background:${bg};color:inherit;border:1px solid ${border};border-radius:2px;cursor:pointer;font-size:10px;font-family:inherit;text-transform:capitalize;">${escapeHtml(CLASSIFICATION_LABEL[value])}</button>`;
  }

  private renderPreview(): string {
    if (!this.current) {
      return `<div style="font-size:11px;opacity:0.55;padding:10px 0;text-align:center;">No briefing generated yet. Configure title + classification, then click Generate.</div>`;
    }
    const b = this.current;
    const color = CLASSIFICATION_COLOR[b.classification];
    return `<div style="display:flex;flex-direction:column;gap:5px;">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:6px;padding:5px 8px;background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.08);border-radius:3px;">
        <span style="font-size:11.5px;font-weight:600;">${escapeHtml(b.title)}</span>
        <span style="font-size:9px;color:${color};font-weight:700;text-transform:uppercase;letter-spacing:0.04em;">${escapeHtml(b.classification)} · ${b.wordCount}w</span>
      </div>
      <div style="font-size:10px;opacity:0.65;font-family:ui-monospace,monospace;">${escapeHtml(b.periodLabel)} · ${escapeHtml(b.id)}</div>
      <iframe class="brief-preview-frame" sandbox="" style="width:100%;height:280px;background:#fff;border:1px solid rgba(255,255,255,0.08);border-radius:3px;"></iframe>
      <div style="display:flex;gap:5px;justify-content:flex-end;">
        <button class="brief-download" type="button" style="padding:3px 10px;background:rgba(46,194,126,0.18);color:#2ec27e;border:1px solid rgba(46,194,126,0.45);border-radius:2px;cursor:pointer;font-size:10px;font-family:inherit;">Download HTML</button>
      </div>
    </div>`;
  }

  private renderHistory(history: readonly IntelligenceBriefing[]): string {
    if (history.length <= 1) return '';
    const older = history.slice(1);
    return `<div style="display:flex;flex-direction:column;gap:3px;padding-top:5px;border-top:1px solid rgba(255,255,255,0.08);">
      <span style="font-size:9px;text-transform:uppercase;letter-spacing:0.04em;color:#aaa;">Recent briefings</span>
      ${older.map((b) => this.renderHistoryRow(b)).join('')}
    </div>`;
  }

  private renderHistoryRow(b: IntelligenceBriefing): string {
    const color = CLASSIFICATION_COLOR[b.classification];
    return `<div class="brief-history-row" data-id="${escapeHtml(b.id)}" style="display:flex;justify-content:space-between;gap:6px;padding:4px 6px;background:rgba(255,255,255,0.02);border-left:3px solid ${color};border-radius:0 2px 2px 0;cursor:pointer;font-size:10.5px;">
      <span style="font-family:ui-monospace,monospace;">${escapeHtml(b.title)}</span>
      <span style="opacity:0.6;font-family:ui-monospace,monospace;">${escapeHtml(b.periodLabel)}</span>
    </div>`;
  }

  private wireHandlers(): void {
    const root = this.getContentElement();

    for (const chip of root.querySelectorAll<HTMLButtonElement>('.brief-classification')) {
      chip.addEventListener('click', () => {
        const value = chip.getAttribute('data-value');
        if (value === 'unclassified' || value === 'internal' || value === 'sensitive') {
          this.classification = value;
          this.render();
        }
      });
    }

    const form = root.querySelector<HTMLFormElement>('.brief-form');
    form?.addEventListener('submit', (ev) => {
      ev.preventDefault();
      const titleEl = form.querySelector<HTMLInputElement>('.brief-input-title');
      const trimmed = titleEl?.value.trim() ?? '';
      this.titleInput = trimmed.length === 0 ? 'Crystal Ball Intelligence Briefing' : trimmed;
      this.service.generate({ classification: this.classification, title: this.titleInput });
    });

    const frame = root.querySelector<HTMLIFrameElement>('.brief-preview-frame');
    if (frame && this.current) {
      frame.srcdoc = this.current.htmlContent;
    }

    root.querySelector<HTMLButtonElement>('.brief-download')?.addEventListener('click', () => {
      this.handleDownload();
    });

    for (const row of root.querySelectorAll<HTMLElement>('.brief-history-row')) {
      row.addEventListener('click', () => {
        const id = row.getAttribute('data-id');
        if (!id) return;
        const match = this.service.getBriefings(50).find((b) => b.id === id);
        if (match) {
          this.current = match;
          this.render();
        }
      });
    }
  }

  private handleDownload(): void {
    if (!this.current) return;
    const blob = new Blob([this.current.htmlContent], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `briefing-${this.current.id}.html`;
    a.style.display = 'none';
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  }
}

function buildLiveProviders(): IntelligenceBriefingProviders {
  return {
    civilizationPulse: () => {
      const reading = getCivilizationPulseEngine().getLatestReading();
      return {
        overallScore: reading?.overallScore ?? 50,
        label: reading?.label ?? 'nominal',
        dominantStressor: reading?.dominantStressor ?? null,
      };
    },
    worldNarrative: () => {
      const narrative = getWorldNarrativeEngine().getLatestNarrative();
      return {
        headline: narrative?.headline ?? '',
        outlookSentence: narrative?.outlookSentence ?? '',
      };
    },
    activeSituations: () => getActiveSituations(),
    threatHorizon: () => {
      const scanner = getThreatHorizonScanner();
      return scanner.getThreats().map((t) => ({
        id: t.id,
        domain: t.domain,
        region: t.region,
        currentSeverity: t.currentSeverity,
        projectedSeverity: t.projectedSeverity,
        horizon: t.horizon,
        probability: t.probability,
      }));
    },
    upcomingEvents: () => {
      const calendar = getGeopoliticalEventCalendar();
      return calendar.getUpcoming(BRIEFING_EVENT_HORIZON_MS).map((e) => ({
        id: e.id,
        title: e.title,
        country: e.country,
        scheduledAt: e.scheduledAt,
        riskLevel: e.riskLevel,
        type: e.type,
      }));
    },
    systemHealth: () => {
      const snapshot = getIntelligenceHealthMonitorService().getLatest();
      if (!snapshot) return { overallScore: 0.5, overallStatus: 'unknown' };
      return { overallScore: snapshot.overallScore, overallStatus: snapshot.overallStatus };
    },
  };
}
