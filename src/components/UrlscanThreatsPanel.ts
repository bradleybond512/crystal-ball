/**
 * urlscan.io Threats panel — recent malicious scans with expandable rows
 * and a "Scan URL" submit input. Auto-refreshes every 15 min.
 */

import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';
import {
  fetchUrlscanThreats,
  submitUrlscan,
  type UrlscanEnvelope,
} from '@/services/security/urlscan-service';
import {
  validateSubmitUrl,
  verdictColor,
  type UrlscanThreat,
} from '@/services/security/urlscan-classify';

const REFRESH_MS = 15 * 60 * 1000;

interface SubmitStatus {
  state: 'idle' | 'submitting' | 'ok' | 'error';
  message: string;
  reportUrl?: string;
}

export class UrlscanThreatsPanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private envelope: UrlscanEnvelope | null = null;
  private expanded = new Set<string>();
  private submit: SubmitStatus = { state: 'idle', message: '' };
  private submitInputValue = '';

  constructor() {
    super({
      id: 'urlscan-threats',
      title: 'urlscan.io Threats',
      showCount: true,
      trackActivity: true,
      infoTooltip: 'Recently scanned malicious URLs from urlscan.io (free public scans). Submit a URL to queue a public scan. Cache refreshes every 15 minutes.',
    });
    this.start();
  }

  private start(): void {
    this.render();
    void this.refresh();
    this.refreshTimer = setInterval(() => void this.refresh(), REFRESH_MS);
  }

  public destroy(): void {
    super.destroy();
    if (this.refreshTimer !== null) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  private async refresh(): Promise<void> {
    try {
      this.envelope = await fetchUrlscanThreats({ q: 'malicious:true', size: 50 });
    } catch {
      // degraded envelope returned by service
    }
    this.render();
  }

  private toggleRow(uuid: string): void {
    const isOpen = this.expanded.has(uuid);
    if (isOpen) {
      this.expanded.delete(uuid);
    } else {
      this.expanded.add(uuid);
    }
    this.render();
  }

  private async runSubmit(value: string): Promise<void> {
    const v = validateSubmitUrl(value);
    if (!v.ok) {
      this.submit = { state: 'error', message: v.error };
      this.render();
      return;
    }
    this.submit = { state: 'submitting', message: `Submitting ${v.url}…` };
    this.render();
    const result = await submitUrlscan(value);
    this.submit = result.ok
      ? {
          state: 'ok',
          message: `Scan queued · uuid ${result.uuid ?? '?'}`,
          reportUrl: result.reportUrl,
        }
      : { state: 'error', message: result.error ?? 'Submit failed' };
    this.render();
  }

  private render(): void {
    const env = this.envelope;
    const stats = env?.stats;
    if (env) this.setCount(env.threats.length);

    const banner = env?.degraded
      ? `<div style="padding:4px 6px;background:rgba(255, 69, 58,0.10);border-left:3px solid #ff453a;margin-bottom:6px;font-size:11px;">
           Degraded: ${escapeHtml(env.reason ?? 'unknown')} (source: ${escapeHtml(env.source)})
         </div>`
      : '';

    const summaryHtml = stats
      ? `<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:6px;font-size:11px;">
          <span style="display:inline-block;padding:2px 8px;border:1px solid ${verdictColor('malicious')};border-radius:8px;color:${verdictColor('malicious')};">Malicious <strong>${stats.byVerdict.malicious}</strong></span>
          <span style="display:inline-block;padding:2px 8px;border:1px solid ${verdictColor('suspicious')};border-radius:8px;color:${verdictColor('suspicious')};">Suspicious <strong>${stats.byVerdict.suspicious}</strong></span>
          <span style="display:inline-block;padding:2px 8px;border:1px solid rgba(255,255,255,0.12);border-radius:8px;">Categories <strong>${stats.topCategories.length}</strong></span>
          <span style="display:inline-block;padding:2px 8px;border:1px solid rgba(255,255,255,0.12);border-radius:8px;">Brands <strong>${stats.topBrands.length}</strong></span>
        </div>`
      : '';

    const submitHtml = this.renderSubmit();

    let listHtml = '';
    if (!env) {
      listHtml = `<div style="opacity:0.6;">Loading scans…</div>`;
    } else if (env.threats.length === 0) {
      listHtml = `<div style="opacity:0.6;">No malicious scans returned.</div>`;
    } else {
      listHtml = env.threats.slice(0, 30).map((t) => this.renderThreat(t)).join('');
    }

    this.setContent(`
      <div style="padding:8px;font-size:12px;line-height:1.45;">
        ${banner}
        ${submitHtml}
        ${summaryHtml}
        <div style="display:flex;flex-direction:column;gap:4px;">${listHtml}</div>
      </div>
    `, () => this.wireHandlers());
  }

  private renderSubmit(): string {
    const stateColor = submitStateColor(this.submit.state);
    const reportLink = this.submit.reportUrl
      ? ` · <a href="${escapeHtml(this.submit.reportUrl)}" target="_blank" rel="noopener noreferrer" style="color:inherit;text-decoration:underline;">view report</a>`
      : '';
    const message = this.submit.message
      ? `<div style="font-size:10px;color:${stateColor};margin-top:2px;">${escapeHtml(this.submit.message)}${reportLink}</div>`
      : '';
    return `<div style="margin-bottom:8px;">
      <div style="display:flex;gap:4px;">
        <input type="text" class="urlscan-submit-input" placeholder="https://example.com/suspicious-path"
          value="${escapeHtml(this.submitInputValue)}"
          style="flex:1;padding:4px 8px;background:rgba(255,255,255,0.04);color:inherit;border:1px solid rgba(255,255,255,0.12);border-radius:4px;font-size:11px;font-family:ui-monospace,monospace;" />
        <button class="urlscan-submit-btn" type="button"
          style="padding:4px 10px;background:rgba(74,158,255,0.18);color:inherit;border:1px solid rgba(74,158,255,0.4);border-radius:4px;cursor:pointer;font-size:11px;"
          ${this.submit.state === 'submitting' ? 'disabled' : ''}>${this.submit.state === 'submitting' ? '…' : 'Scan URL'}</button>
      </div>
      ${message}
    </div>`;
  }

  private renderThreat(t: UrlscanThreat): string {
    const color = verdictColor(t.verdict);
    const expanded = this.expanded.has(t.uuid);
    const cats = t.categories.length === 0 ? '' :
      t.categories.slice(0, 4).map((c) => `<span style="padding:1px 5px;border-radius:3px;background:rgba(255,255,255,0.08);font-size:10px;margin-right:3px;">${escapeHtml(c)}</span>`).join('');
    const brands = t.brands.length === 0 ? '' :
      t.brands.slice(0, 3).map((b) => `<span style="padding:1px 5px;border-radius:3px;background:rgba(255, 69, 58,0.12);font-size:10px;margin-right:3px;color:${color};">${escapeHtml(b)}</span>`).join('');
    const date = new Date(t.scannedAt).toISOString().slice(0, 16).replace('T', ' ');
    const reportLink = t.reportUrl
      ? `<a href="${escapeHtml(t.reportUrl)}" target="_blank" rel="noopener noreferrer" style="color:inherit;text-decoration:underline;">report</a>`
      : '';
    const scoreText = t.verdictScore === null ? '—' : t.verdictScore.toFixed(0);
    const tagsText = t.tags.length === 0
      ? '—'
      : t.tags.slice(0, 8).map((tag) => escapeHtml(tag)).join(', ');
    const screenshotRow = t.screenshotUrl
      ? `<div style="opacity:0.6;">Screenshot</div><div><a href="${escapeHtml(t.screenshotUrl)}" target="_blank" rel="noopener noreferrer" style="color:inherit;text-decoration:underline;">open</a></div>`
      : '';
    const expandedBody = expanded
      ? `<div style="margin-top:4px;padding:6px;background:rgba(255,255,255,0.03);border-radius:3px;font-size:11px;display:grid;grid-template-columns:max-content 1fr;gap:2px 8px;">
          <div style="opacity:0.6;">IP</div><div style="font-family:ui-monospace,monospace;">${escapeHtml(t.ip ?? '—')}</div>
          <div style="opacity:0.6;">ASN</div><div style="font-family:ui-monospace,monospace;">${escapeHtml(t.asn ?? '—')}</div>
          <div style="opacity:0.6;">Country</div><div>${escapeHtml(t.country ?? '—')}</div>
          <div style="opacity:0.6;">Score</div><div>${scoreText}</div>
          <div style="opacity:0.6;">Tags</div><div>${tagsText}</div>
          ${screenshotRow}
        </div>`
      : '';
    return `<div class="urlscan-row" data-uuid="${escapeHtml(t.uuid)}" style="border:1px solid rgba(255,255,255,0.08);border-left:3px solid ${color};border-radius:3px;padding:6px 8px;cursor:pointer;">
      <div style="display:flex;justify-content:space-between;align-items:start;gap:6px;">
        <div style="min-width:0;flex:1;">
          <div style="font-family:ui-monospace,monospace;font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(t.url)}</div>
          <div style="font-size:10px;opacity:0.8;margin-top:2px;">${escapeHtml(t.domain ?? '—')} · ${escapeHtml(date)} ${reportLink ? `· ${reportLink}` : ''}</div>
        </div>
        <div style="text-align:right;font-size:10px;font-weight:700;color:${color};text-transform:uppercase;">${t.verdict}</div>
      </div>
      <div style="margin-top:3px;">${cats}${brands}</div>
      ${expandedBody}
    </div>`;
  }

  private wireHandlers(): void {
    const root = this.getElement();
    if (!root) return;
    for (const row of root.querySelectorAll<HTMLElement>('.urlscan-row')) {
      row.addEventListener('click', (e) => {
        // Don't toggle when the user clicks an embedded link.
        if ((e.target as HTMLElement).tagName === 'A') return;
        const uuid = row.dataset.uuid;
        if (uuid) this.toggleRow(uuid);
      });
    }
    const input = root.querySelector<HTMLInputElement>('.urlscan-submit-input');
    const btn = root.querySelector<HTMLButtonElement>('.urlscan-submit-btn');
    if (input) {
      input.addEventListener('input', () => {
        this.submitInputValue = input.value;
      });
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          void this.runSubmit(input.value);
        }
      });
    }
    if (btn) {
      btn.addEventListener('click', () => {
        if (input) void this.runSubmit(input.value);
      });
    }
  }
}

function submitStateColor(state: SubmitStatus['state']): string {
  if (state === 'error') return '#ff453a';
  if (state === 'ok') return '#4caf50';
  if (state === 'submitting') return '#ffeb3b';
  return 'rgba(255,255,255,0.5)';
}
