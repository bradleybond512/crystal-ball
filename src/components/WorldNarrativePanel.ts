/**
 * WorldNarrativePanel — surfaces the latest WorldNarrative produced by
 * the engine. Large headline, executive summary, up to 3 domain
 * section cards with severity badges, and an outlook sentence footer.
 * "Generate" button kicks off a fresh narrative from the current state.
 */

import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';
import {
  getWorldNarrativeEngine,
  type WorldNarrative,
  type NarrativeSection,
} from '@/services/intelligence/world-narrative';
import { getSituationStoreV2 } from '@/services/intelligence/situation-store-v2';
import type { Situation } from '@/services/intelligence/situation-store-v2';

const REFRESH_MS = 60_000;

const SEVERITY_COLOR: Record<string, string> = {
  CRITICAL: 'var(--severity-critical, #ef4444)',
  HIGH:     'var(--severity-high, #fb923c)',
  MEDIUM:   'var(--severity-medium, #facc15)',
  LOW:      'var(--severity-info, #60a5fa)',
  INFO:     'var(--text-secondary, #888)',
};

export class WorldNarrativePanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private unsubscribe: (() => void) | null = null;

  constructor() {
    super({
      id: 'world-narrative',
      title: 'World Narrative',
      showCount: true,
      trackActivity: true,
      infoTooltip:
        'Plain-English synthesis of the current intelligence picture. Templates slot in real domain activity counts, entity names, and severity labels — no LLM required.',
    });
    this.start();
  }

  private start(): void {
    this.refresh();
    this.refreshTimer = setInterval(() => this.refresh(), REFRESH_MS);
    this.unsubscribe = getWorldNarrativeEngine().subscribe(() => this.render());
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

  private refresh(): void {
    try {
      const situations = safeAll();
      // The narrative is read-only here — the engine consumes
      // observations elsewhere. For the in-panel Generate button we
      // re-run with the situations we know about and an empty obs
      // list (the panel may not have an observation aggregate).
      getWorldNarrativeEngine().generate([], situations);
      this.render();
    } catch (error) {
      this.setContent(`<div style="padding:12px;color:var(--severity-critical);">World-narrative panel error: ${escapeHtml(String(error))}</div>`);
    }
  }

  private render(): void {
    try {
      const narrative = getWorldNarrativeEngine().getLatestNarrative();
      this.setCount(narrative?.criticalAlertCount ?? 0);
      this.setContent(this.buildHtml(narrative));
      queueMicrotask(() => this.wireHandlers());
    } catch (error) {
      this.setContent(`<div style="padding:12px;color:var(--severity-critical);">World-narrative render error: ${escapeHtml(String(error))}</div>`);
    }
  }

  private buildHtml(narrative: WorldNarrative | undefined): string {
    if (!narrative) return renderEmptyState();
    return `${renderHeader(narrative)}${renderHeadline(narrative)}${renderSummary(narrative)}${renderSections(narrative.sections)}${renderOutlook(narrative)}`;
  }

  private wireHandlers(): void {
    const root = this.getContentElement();
    const button = root.querySelector<HTMLButtonElement>('.wnp-generate');
    button?.addEventListener('click', () => this.refresh());
  }
}

function safeAll(): Situation[] {
  try {
    const store = getSituationStoreV2();
    const list = (store as unknown as { getAll?: () => Situation[] }).getAll?.();
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function renderEmptyState(): string {
  return `<div style="padding:24px 16px;color:var(--text-secondary,#aaa);font-size:12px;text-align:center;">
    No narrative yet. Click <strong>Generate</strong> to synthesize the current picture.
    <div style="margin-top:12px;">
      <button class="wnp-generate" style="font-size:11px;padding:4px 12px;background:transparent;color:var(--text-primary,#ddd);border:1px solid var(--border-subtle,#333);border-radius:3px;cursor:pointer;">Generate</button>
    </div>
  </div>`;
}

function renderHeader(narrative: WorldNarrative): string {
  const generatedAt = new Date(narrative.generatedAt).toISOString().slice(0, 19).replace('T', ' ') + 'Z';
  return `<div style="padding:8px 12px;border-bottom:1px solid var(--border-subtle,#333);display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
    <span style="font-size:10px;color:var(--text-secondary,#aaa);text-transform:uppercase;letter-spacing:0.06em;">Generated</span>
    <span style="font-size:11px;color:var(--text-primary,#ddd);font-family:ui-monospace,monospace;">${escapeHtml(generatedAt)}</span>
    <span style="font-size:11px;color:var(--text-secondary,#aaa);">${narrative.situationCount} situation${narrative.situationCount === 1 ? '' : 's'} · ${narrative.criticalAlertCount} critical alert${narrative.criticalAlertCount === 1 ? '' : 's'}</span>
    <button class="wnp-generate" style="margin-left:auto;font-size:11px;padding:3px 10px;background:transparent;color:var(--text-secondary,#aaa);border:1px solid var(--border-subtle,#333);border-radius:3px;cursor:pointer;">Generate</button>
  </div>`;
}

function renderHeadline(narrative: WorldNarrative): string {
  return `<div style="padding:14px 16px;border-bottom:1px solid var(--border-subtle,#333);">
    <div style="font-size:14px;font-weight:700;line-height:1.4;">${escapeHtml(narrative.headline)}</div>
    <div style="margin-top:6px;font-size:11px;color:var(--text-secondary,#bbb);font-style:italic;">${escapeHtml(narrative.dominantTheme)}</div>
  </div>`;
}

function renderSummary(narrative: WorldNarrative): string {
  return `<div style="padding:10px 16px;border-bottom:1px solid var(--border-subtle,#333);">
    <div style="font-size:10px;color:var(--text-secondary,#aaa);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:4px;">Executive summary</div>
    <p style="margin:0;font-size:12px;line-height:1.5;color:var(--text-primary,#ddd);">${escapeHtml(narrative.executiveSummary)}</p>
  </div>`;
}

function renderSections(sections: readonly NarrativeSection[]): string {
  if (sections.length === 0) {
    return `<div style="padding:18px 16px;color:var(--text-secondary,#aaa);font-size:11px;text-align:center;font-style:italic;">No domain sections — global picture is quiet.</div>`;
  }
  return `<div style="padding:10px;display:flex;flex-direction:column;gap:8px;max-height:380px;overflow:auto;">
    ${sections.map((s) => renderSectionCard(s)).join('')}
  </div>`;
}

function renderSectionCard(section: NarrativeSection): string {
  const color = SEVERITY_COLOR[section.severity] ?? SEVERITY_COLOR.INFO;
  const confidencePct = Math.round(section.confidence * 100);
  return `<div style="padding:10px 12px;background:rgba(255,255,255,0.02);border:1px solid var(--border-subtle,#333);border-radius:4px;">
    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:6px;">
      <span style="font-size:9px;font-weight:700;padding:2px 5px;background:${color};color:#fff;border-radius:3px;text-transform:uppercase;">${escapeHtml(section.severity)}</span>
      <span style="font-size:9px;font-weight:600;padding:2px 5px;background:rgba(255,255,255,0.06);border-radius:3px;text-transform:uppercase;color:var(--text-secondary,#ccc);">${escapeHtml(section.domain)}</span>
      <span style="font-size:12px;font-weight:600;">${escapeHtml(section.title)}</span>
      <span style="margin-left:auto;font-size:10px;color:var(--text-secondary,#aaa);">confidence ${confidencePct}%</span>
    </div>
    <p style="margin:0;font-size:12px;line-height:1.5;color:var(--text-primary,#ddd);">${escapeHtml(section.body)}</p>
  </div>`;
}

function renderOutlook(narrative: WorldNarrative): string {
  return `<div style="padding:10px 16px;border-top:1px solid var(--border-subtle,#333);background:rgba(255,255,255,0.02);">
    <div style="font-size:10px;color:var(--text-secondary,#aaa);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:4px;">Outlook</div>
    <div style="font-size:12px;color:var(--text-primary,#ddd);">${escapeHtml(narrative.outlookSentence)}</div>
  </div>`;
}
