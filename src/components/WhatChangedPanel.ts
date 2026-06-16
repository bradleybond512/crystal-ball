import { Panel } from './Panel';
import { getApiBaseUrl } from '@/services/runtime';
import { escapeHtml } from '@/utils/sanitize';

interface WhatChangedReport {
  since: number;
  until: number;
  newEventsByDomain: Record<string, string[]>;
  resolvedEventIds: string[];
  severityEscalations: { domain: string; from: number; to: number }[];
  newCorrelationIds: string[];
  totalNewEvents: number;
  totalResolved: number;
}

export class WhatChangedPanel extends Panel {
  private lastFetchAt = 0;
  private intervalId: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super({
      id: 'what-changed',
      title: 'What Changed',
      showCount: true,
      trackActivity: true,
      infoTooltip: 'Cross-domain diff: new events, resolved events, severity escalations, and new correlations since last snapshot.',
    });
    this.showLoading('Loading change digest...');
    this.startPolling();
  }

  private startPolling(): void {
    void this.fetchReport();
    this.intervalId = setInterval(() => { void this.fetchReport(); }, 30_000);
  }

  override destroy(): void {
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    super.destroy();
  }

  private async fetchReport(): Promise<void> {
    const since = this.lastFetchAt > 0 ? this.lastFetchAt : Date.now() - 60 * 60 * 1000;
    try {
      const res = await fetch(`${getApiBaseUrl()}/api/intelligence/snapshot-diff?since=${since}`);
      if (!res.ok) {
        this.setContent('<div class="panel-empty">Change digest unavailable.</div>');
        return;
      }
      const report = await res.json() as WhatChangedReport;
      if (!report || !Array.isArray(report.severityEscalations) || !Array.isArray(report.newCorrelationIds)) {
        this.setContent('<div class="panel-empty">Change digest unavailable.</div>');
        return;
      }
      this.lastFetchAt = report.until;
      this.render(report);
    } catch {
      this.setContent('<div class="panel-empty">Could not reach intelligence service.</div>');
    }
  }

  private render(report: WhatChangedReport): void {
    const totalChanges = report.totalNewEvents + report.totalResolved +
      report.severityEscalations.length + report.newCorrelationIds.length;
    this.setCount(totalChanges);

    if (totalChanges === 0) {
      this.setContent('<div class="panel-empty">No changes detected in this window.</div>');
      return;
    }

    const sections: string[] = [];

    const newDomains = Object.keys(report.newEventsByDomain);
    if (newDomains.length > 0) {
      const rows = newDomains.map(domain => {
        const ids = report.newEventsByDomain[domain] ?? [];
        return `<tr>
          <td class="wc-domain">${escapeHtml(domain)}</td>
          <td class="wc-count">+${ids.length}</td>
        </tr>`;
      }).join('');
      sections.push(`
        <div class="wc-section">
          <div class="wc-section-title">New Events (${report.totalNewEvents})</div>
          <table class="eq-table"><tbody>${rows}</tbody></table>
        </div>`);
    }

    if (report.totalResolved > 0) {
      sections.push(`
        <div class="wc-section">
          <div class="wc-section-title">Resolved (${report.totalResolved})</div>
          <div class="wc-resolved">${report.resolvedEventIds.slice(0, 10).map(id => `<span class="wc-tag">${escapeHtml(id)}</span>`).join(' ')}${report.resolvedEventIds.length > 10 ? ` +${report.resolvedEventIds.length - 10} more` : ''}</div>
        </div>`);
    }

    if (report.severityEscalations.length > 0) {
      const rows = report.severityEscalations.map(e =>
        `<tr>
          <td class="wc-domain">${escapeHtml(e.domain)}</td>
          <td class="wc-count">${e.from} → <strong>${e.to}</strong></td>
        </tr>`
      ).join('');
      sections.push(`
        <div class="wc-section">
          <div class="wc-section-title">Severity Escalations (${report.severityEscalations.length})</div>
          <table class="eq-table"><tbody>${rows}</tbody></table>
        </div>`);
    }

    if (report.newCorrelationIds.length > 0) {
      sections.push(`
        <div class="wc-section">
          <div class="wc-section-title">New Correlations (${report.newCorrelationIds.length})</div>
          <div class="wc-resolved">${report.newCorrelationIds.slice(0, 8).map(id => `<span class="wc-tag">${escapeHtml(id.split('|')[0] ?? id)}</span>`).join(' ')}</div>
        </div>`);
    }

    const windowMins = Math.round((report.until - report.since) / 60_000);
    this.setContent(`
      <div class="wc-panel-content">
        ${sections.join('')}
        <div class="fires-footer">
          <span class="fires-source">Intelligence correlator · ${windowMins}m window</span>
        </div>
      </div>
    `);
  }
}
