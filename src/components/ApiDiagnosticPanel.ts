/* eslint-disable no-console, @typescript-eslint/prefer-nullish-coalescing, sonarjs/no-nested-conditional, sonarjs/cognitive-complexity, unicorn/no-nested-ternary, sonarjs/no-misleading-array-reverse, sonarjs/no-nested-template-literals, @typescript-eslint/no-misused-promises */
/**
 * API Diagnostic Panel
 *
 * Live view of every external data source: health status, last update
 * time, item count, error state, circuit-breaker state. One click to
 * issue a live probe against an upstream endpoint.
 *
 * Refreshes every 10s. Clicking a row expands per-source detail.
 */

import { Panel } from './Panel';
import {
  diagnoseAll,
  pingSource,
  formatReport,
  type DiagnosticReport,
  type SourceDiagnostic,
  type HealthStatus,
} from '@/services/api-diagnostic';
import { escapeHtml } from '@/utils/sanitize';

const REFRESH_MS = 10_000;

const STATUS_COLOR: Record<HealthStatus, string> = {
  healthy: '#4caf50',
  degraded: '#ffeb3b',
  failing: '#ff453a',
  silent: '#9e9e9e',
  unknown: '#607d8b',
};

const STATUS_ICON: Record<HealthStatus, string> = {
  healthy: '✓',
  degraded: '⚠',
  failing: '✗',
  silent: '·',
  unknown: '?',
};

export class ApiDiagnosticPanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private expandedSourceId: string | null = null;
  private pingResults = new Map<string, { ok: boolean; status: number; latencyMs: number; error: string | null; fetchedAt: number }>();

  constructor() {
    super({
      id: 'api-diagnostic',
      title: 'API Diagnostic',
      showCount: true,
      trackActivity: true,
      infoTooltip: 'Live health of every external data source. Use this to troubleshoot "why isn\'t X updating?" scenarios. Click a row to expand, then "Ping" to issue a live probe.',
    });
    this.start();
  }

  private start(): void {
    this.render();
    this.refreshTimer = setInterval(() => this.renderWhenVisible(() => this.render()), REFRESH_MS);
  }

  private render(): void {
    const report = diagnoseAll();
    this.setCount(report.failing + report.silent);
    this.setContent(this.buildHtml(report), () => this.wireHandlers());
  }

  private buildHtml(report: DiagnosticReport): string {
    const now = new Date(report.generatedAt);
    const overallColor = report.failing > 0 ? '#ff453a'
      : report.degraded > 0 ? '#ff9800'
      : report.silent > 0 ? '#9e9e9e' : '#4caf50';

    const summaryHtml = `<div style="padding:8px 12px;border-bottom:1px solid var(--border-subtle,#333);">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
        <div style="font-size:12px;font-weight:700;color:${overallColor};">
          ${report.isOnline ? '● ONLINE' : '○ OFFLINE'} · ${report.healthy}/${report.totalSources} healthy
        </div>
        <div style="display:flex;gap:4px;">
          <button id="cb-diag-refresh" style="font-size:10px;padding:2px 8px;background:var(--surface-raised,#222);color:var(--text-primary,#fff);border:1px solid var(--border-subtle,#444);border-radius:3px;cursor:pointer;">↻ Refresh</button>
          <button id="cb-diag-export" style="font-size:10px;padding:2px 8px;background:var(--surface-raised,#222);color:var(--text-primary,#fff);border:1px solid var(--border-subtle,#444);border-radius:3px;cursor:pointer;">📋 Export</button>
        </div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;font-size:10px;color:var(--text-secondary,#aaa);">
        <span style="color:#4caf50;">${report.healthy} healthy</span>
        <span style="color:#ffeb3b;">${report.degraded} degraded</span>
        <span style="color:#ff453a;">${report.failing} failing</span>
        <span style="color:#9e9e9e;">${report.silent} silent</span>
      </div>
      ${report.trippedBreakers.length > 0 ? `<div style="margin-top:4px;font-size:10px;color:#ff453a;">Tripped breakers: ${escapeHtml(report.trippedBreakers.slice(0, 5).join(', '))}</div>` : ''}
      ${report.recommendations.length > 0 ? `<div style="margin-top:6px;padding:6px 8px;background:rgba(255,152,0,0.08);border-left:3px solid #ff9800;border-radius:2px;">
        ${report.recommendations.map(r => `<div style="font-size:10px;color:var(--text-secondary,#ccc);margin-bottom:2px;">${escapeHtml(r)}</div>`).join('')}
      </div>` : ''}
      <div style="font-size:9px;color:var(--text-muted,#777);margin-top:4px;">${escapeHtml(now.toLocaleTimeString())}</div>
    </div>`;

    const rowsHtml = report.sources
      .sort((a, b) => {
        const statusOrder: Record<HealthStatus, number> = { failing: 0, silent: 1, degraded: 2, unknown: 3, healthy: 4 };
        return statusOrder[a.status] - statusOrder[b.status];
      })
      .map(s => this.renderSourceRow(s))
      .join('');

    return summaryHtml + `<div style="max-height:480px;overflow-y:auto;">${rowsHtml}</div>`;
  }

  private renderSourceRow(s: SourceDiagnostic): string {
    const color = STATUS_COLOR[s.status];
    const icon = STATUS_ICON[s.status];
    const ageLabel = s.ageSeconds === null
      ? 'never'
      : s.ageSeconds < 60 ? `${s.ageSeconds}s ago`
      : s.ageSeconds < 3600 ? `${Math.floor(s.ageSeconds / 60)}m ago`
      : `${Math.floor(s.ageSeconds / 3600)}h ago`;

    const isExpanded = this.expandedSourceId === s.id;
    const ping = this.pingResults.get(s.id);
    const pingHtml = ping
      ? `<div style="margin-top:4px;padding:4px 6px;background:rgba(255,255,255,0.03);border-radius:3px;font-size:10px;">
          Probe: ${ping.ok ? `<span style="color:#4caf50;">${ping.status} in ${ping.latencyMs}ms</span>` : `<span style="color:#ff453a;">${escapeHtml(ping.error || 'failed')}</span>`}
        </div>`
      : '';

    const detailHtml = isExpanded ? `<div style="padding:6px 12px;background:rgba(255,255,255,0.02);border-top:1px dashed var(--border-subtle,#333);font-size:10px;color:var(--text-secondary,#aaa);">
      <div><strong>ID:</strong> ${escapeHtml(s.id)}</div>
      <div><strong>Items ingested:</strong> ${s.itemCount}</div>
      ${s.breakerState ? `<div><strong>Circuit breaker:</strong> ${escapeHtml(s.breakerState)}${s.onCooldown ? ` (cooldown ${s.cooldownRemainingSeconds}s)` : ''}</div>` : ''}
      ${s.requiredForRisk ? '<div style="color:#ff9800;"><strong>⚠ Required for risk scoring</strong></div>' : ''}
      ${s.notes.length > 0 ? `<div style="margin-top:4px;">${s.notes.map(n => `<div>• ${escapeHtml(n)}</div>`).join('')}</div>` : ''}
      <button data-ping-id="${escapeHtml(s.id)}" style="margin-top:6px;font-size:10px;padding:2px 8px;background:#2b5ea8;color:#fff;border:none;border-radius:3px;cursor:pointer;">Probe endpoint</button>
      ${pingHtml}
    </div>` : '';

    return `<div class="cb-diag-row" data-source-id="${escapeHtml(s.id)}" style="border-bottom:1px solid var(--border-subtle,#333);cursor:pointer;">
      <div style="padding:6px 12px;display:flex;justify-content:space-between;align-items:center;">
        <div style="display:flex;align-items:center;gap:6px;min-width:0;">
          <span style="font-size:14px;color:${color};flex-shrink:0;">${icon}</span>
          <span style="font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(s.name)}</span>
          ${s.requiredForRisk ? '<span style="font-size:8px;color:#ff9800;flex-shrink:0;">★</span>' : ''}
        </div>
        <div style="display:flex;align-items:center;gap:8px;flex-shrink:0;">
          <span style="font-size:10px;color:var(--text-muted,#888);">${ageLabel}</span>
          <span style="font-size:10px;color:var(--text-muted,#888);">${s.itemCount}</span>
        </div>
      </div>
      ${detailHtml}
    </div>`;
  }

  private wireHandlers(): void {
    const el = this.element;
    if (!el) return;

    el.querySelectorAll<HTMLElement>('.cb-diag-row').forEach(row => {
      row.addEventListener('click', (e) => {
        if ((e.target as HTMLElement).closest('button')) return;
        const id = row.dataset.sourceId;
        if (!id) return;
        this.expandedSourceId = this.expandedSourceId === id ? null : id;
        this.render();
      });
    });

    el.querySelectorAll<HTMLButtonElement>('[data-ping-id]').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const id = btn.dataset.pingId;
        if (!id) return;
        btn.textContent = 'Probing…';
        btn.disabled = true;
        const result = await pingSource(id);
        this.pingResults.set(id, {
          ok: result.ok,
          status: result.status,
          latencyMs: result.latencyMs,
          error: result.error,
          fetchedAt: result.fetchedAt,
        });
        this.render();
      });
    });

    const refreshBtn = el.querySelector('#cb-diag-refresh');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.render();
      });
    }

    const exportBtn = el.querySelector('#cb-diag-export');
    if (exportBtn) {
      exportBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const report = diagnoseAll();
        const text = formatReport(report);
        try {
          await navigator.clipboard.writeText(text);
          (exportBtn as HTMLElement).textContent = '✓ Copied';
          setTimeout(() => { (exportBtn as HTMLElement).textContent = '📋 Export'; }, 2000);
        } catch {
          // Clipboard denied — dump to console instead
          console.log(text);
          (exportBtn as HTMLElement).textContent = 'See console';
          setTimeout(() => { (exportBtn as HTMLElement).textContent = '📋 Export'; }, 2000);
        }
      });
    }
  }

  public override destroy(): void {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    super.destroy();
  }
}
