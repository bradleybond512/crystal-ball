/**
 * Intelligence Digest Panel (panel id: `intelligence-digest`).
 *
 * Period selector (1h / 6h / 24h) + Generate button. Shows the
 * latest digest: headline, civilization-pulse badge, top-risks
 * strip, expandable sections, world-narrative paragraph.
 */
/* eslint-disable sonarjs/no-nested-template-literals */

import { Panel } from './Panel';
import {
  getIntelligenceDigestService,
  type DigestPeriod,
  type DigestSection,
  type DigestItem,
  type IntelligenceDigest,
} from '@/services/intelligence/intelligence-digest';
import { escapeHtml } from '@/utils/sanitize';

const SEVERITY_COLOR: Record<string, string> = {
  critical: '#a626a4',
  high: '#e94f37',
  medium: '#f5a524',
  low: '#9ca3af',
  info: '#9ca3af',
};

const PULSE_COLOR_BY_LABEL: Record<string, string> = {
  calm: '#2ec27e',
  elevated: '#f5a524',
  acute: '#e94f37',
  crisis: '#a626a4',
};

export class IntelligenceDigestPanel extends Panel {
  private listener: ((digest: IntelligenceDigest) => void) | null = null;
  private period: DigestPeriod = '24h';
  private expandedSections = new Set<string>();

  constructor() {
    super({
      id: 'intelligence-digest',
      title: 'Intelligence Digest',
      showCount: true,
      trackActivity: true,
      infoTooltip:
        'Structured 1h / 6h / 24h compilation across active services: situations, signature matches, contradictions, failure predictions, civilization pulse, world narrative.',
    });
    const svc = getIntelligenceDigestService();
    this.listener = () => this.render();
    svc.subscribe(this.listener);
    this.render();
  }

  public override destroy(): void {
    if (this.listener) {
      getIntelligenceDigestService().unsubscribe(this.listener);
      this.listener = null;
    }
    super.destroy();
  }

  private render(): void {
    const svc = getIntelligenceDigestService();
    const digest = svc.getLatestDigest();
    this.setCount(digest ? digest.totalAlerts : 0);
    this.setContent(this.buildHtml(digest));
    queueMicrotask(() => this.wireHandlers());
  }

  private buildHtml(digest: IntelligenceDigest | undefined): string {
    return `<div class="id-panel" style="display:flex;flex-direction:column;gap:8px;padding:10px;font-size:12px;line-height:1.45;">
      ${this.renderControls()}
      ${digest ? this.renderDigest(digest) : renderEmptyState()}
    </div>`;
  }

  private renderControls(): string {
    const periods: DigestPeriod[] = ['1h', '6h', '24h'];
    const chips = periods.map((p) => {
      const isActive = p === this.period;
      const bg = isActive ? 'rgba(74,158,255,0.18)' : 'transparent';
      const borderAlpha = isActive ? '0.4' : '0.15';
      return `<button class="id-period" data-period="${p}" type="button"
        style="padding:3px 10px;background:${bg};color:inherit;border:1px solid rgba(74,158,255,${borderAlpha});border-radius:3px;cursor:pointer;font-size:11px;">${p}</button>`;
    }).join('');
    return `<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
      <div style="display:flex;gap:4px;">${chips}</div>
      <button class="id-generate" type="button" style="padding:3px 10px;background:rgba(74,158,255,0.18);color:inherit;border:1px solid rgba(74,158,255,0.4);border-radius:3px;cursor:pointer;font-size:11px;">Generate</button>
    </div>`;
  }

  private renderDigest(d: IntelligenceDigest): string {
    return `<div style="display:flex;flex-direction:column;gap:8px;">
      ${this.renderHeadline(d)}
      ${this.renderTopRisks(d.topRisks)}
      ${d.sections.map((s) => this.renderSection(s)).join('')}
      ${d.worldNarrative
        ? `<section style="padding:8px;background:rgba(155,89,182,0.06);border-left:3px solid #9b59b6;border-radius:2px;">
            <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.04em;color:#9b59b6;font-weight:700;margin-bottom:4px;">World Narrative</div>
            <p style="margin:0;font-size:12px;color:#ddd;">${escapeHtml(d.worldNarrative)}</p>
          </section>`
        : ''}
    </div>`;
  }

  private renderHeadline(d: IntelligenceDigest): string {
    const pulseColor = PULSE_COLOR_BY_LABEL[d.pulseLabel] ?? '#9ca3af';
    const pulseChip = d.civilizationPulseScore === null
      ? ''
      : `<span style="background:${pulseColor};color:#fff;font-size:9px;padding:1px 5px;border-radius:2px;text-transform:uppercase;letter-spacing:0.04em;font-weight:700;">pulse ${d.pulseLabel} ${d.civilizationPulseScore.toFixed(2)}</span>`;
    const generatedLabel = ageLabel(new Date(d.generatedAt), Date.now());
    return `<div style="padding:8px;background:rgba(255,255,255,0.03);border-radius:3px;border-left:3px solid #4a9eff;">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:6px;flex-wrap:wrap;">
        <div style="display:flex;align-items:center;gap:6px;">
          <span style="font-size:9px;text-transform:uppercase;letter-spacing:0.04em;color:#4a9eff;font-weight:700;">${escapeHtml(d.period)} digest</span>
          ${pulseChip}
        </div>
        <span style="font-size:10px;opacity:0.55;">generated ${escapeHtml(generatedLabel)}</span>
      </div>
      <div style="font-size:13px;color:#ddd;margin-top:4px;font-weight:600;">${escapeHtml(d.headline)}</div>
      <div style="font-size:11px;opacity:0.65;margin-top:2px;">${d.totalAlerts} total · <strong style="color:${d.criticalCount > 0 ? '#a626a4' : '#9ca3af'};">${d.criticalCount} critical</strong></div>
    </div>`;
  }

  private renderTopRisks(risks: DigestItem[]): string {
    if (risks.length === 0) return '';
    return `<section>
      <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.04em;color:#aaa;margin-bottom:4px;">Top risks</div>
      <div style="display:flex;flex-direction:column;gap:4px;">${risks.map((r) => this.renderItem(r)).join('')}</div>
    </section>`;
  }

  private renderSection(section: DigestSection): string {
    const expanded = this.expandedSections.has(section.title);
    const color = SEVERITY_COLOR[section.highestSeverity.toLowerCase()] ?? '#9ca3af';
    return `<section style="border-left:3px solid ${color};padding:6px 8px;background:rgba(255,255,255,0.02);border-radius:0 3px 3px 0;">
      <button class="id-section-toggle" data-title="${escapeHtml(section.title)}" type="button" style="background:transparent;border:none;color:inherit;cursor:pointer;font-family:inherit;text-align:left;width:100%;padding:0;">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:6px;">
          <div style="display:flex;align-items:center;gap:6px;">
            <span style="font-size:9px;color:#bbb;">${expanded ? '▼' : '▶'}</span>
            <span style="font-weight:600;color:#ddd;font-size:12px;">${escapeHtml(section.title)}</span>
            <span style="font-size:10px;opacity:0.6;">${section.itemCount}</span>
          </div>
          <span style="font-size:10px;opacity:0.55;">${escapeHtml(section.summary)}</span>
        </div>
      </button>
      ${expanded
        ? `<div style="display:flex;flex-direction:column;gap:3px;margin-top:6px;">${section.items.map((i) => this.renderItem(i)).join('')}</div>`
        : ''}
    </section>`;
  }

  private renderItem(item: DigestItem): string {
    const color = SEVERITY_COLOR[item.severity.toLowerCase()] ?? '#9ca3af';
    const ts = ageLabel(new Date(item.timestamp), Date.now());
    return `<div style="display:flex;gap:6px;align-items:start;padding:3px 0;">
      <span style="background:${color};color:#fff;font-size:9px;padding:1px 5px;border-radius:2px;text-transform:uppercase;letter-spacing:0.04em;font-weight:700;flex-shrink:0;">${escapeHtml(item.severity)}</span>
      <span style="background:rgba(74,158,255,0.18);color:#4a9eff;font-size:9px;padding:1px 5px;border-radius:2px;text-transform:uppercase;letter-spacing:0.04em;flex-shrink:0;">${escapeHtml(item.domain)}</span>
      <div style="flex:1;min-width:0;">
        <div style="font-size:11px;color:#ddd;">${escapeHtml(item.title)}</div>
        <div style="font-size:10px;opacity:0.65;">${escapeHtml(item.summary)}</div>
      </div>
      <span style="font-size:10px;opacity:0.55;flex-shrink:0;">${escapeHtml(ts)}</span>
    </div>`;
  }

  private wireHandlers(): void {
    const root = this.getContentElement();
    const svc = getIntelligenceDigestService();

    for (const btn of root.querySelectorAll<HTMLButtonElement>('.id-period')) {
      btn.addEventListener('click', () => {
        const p = btn.dataset.period;
        if (p === '1h' || p === '6h' || p === '24h') {
          this.period = p;
          this.render();
        }
      });
    }

    root.querySelector<HTMLButtonElement>('.id-generate')?.addEventListener('click', () => {
      svc.generate(this.period);
    });

    for (const btn of root.querySelectorAll<HTMLButtonElement>('.id-section-toggle')) {
      btn.addEventListener('click', () => {
        const title = btn.dataset.title;
        if (!title) return;
        if (this.expandedSections.has(title)) this.expandedSections.delete(title);
        else this.expandedSections.add(title);
        this.render();
      });
    }
  }
}

function renderEmptyState(): string {
  return `<div style="padding:14px;text-align:center;opacity:0.55;font-size:12px;">No digest yet — choose a period and press Generate.</div>`;
}

function ageLabel(then: Date, now: number): string {
  const ms = now - then.getTime();
  if (ms < 60_000) return `${Math.max(0, Math.round(ms / 1000))}s ago`;
  if (ms < 60 * 60_000) return `${Math.round(ms / 60_000)}m ago`;
  if (ms < 24 * 60 * 60_000) return `${Math.round(ms / (60 * 60_000))}h ago`;
  return `${Math.round(ms / (24 * 60 * 60_000))}d ago`;
}
