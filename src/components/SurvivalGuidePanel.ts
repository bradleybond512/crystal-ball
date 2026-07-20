import { Panel } from './Panel';
import { showToast } from './Toast';
import type { GuideId, SurvivalGuide } from '@/services/survival-guide/guide-types';
import { getGuide, guidesByKind } from '@/services/survival-guide/guide-library';
import { computeGuideReadiness } from '@/services/survival-guide/readiness-score';
import { getCheckedIds, isChecked, toggle, subscribe } from '@/services/survival-guide/checklist-store';

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
}

function detailSuffix(detail: string | undefined): string {
  if (!detail) return '';
  return `<br><span style="font-size:12px;opacity:0.7;">${esc(detail)}</span>`;
}

export class SurvivalGuidePanel extends Panel {
  private selected: GuideId | null = null;
  private unsubscribe: (() => void) | null = null;

  constructor() {
    super({
      id: 'survival-guide',
      title: 'Survival Guide',
      trackActivity: true,
      infoTooltip:
        'Offline reference guidance for hazards and preparedness. Distilled from public FEMA/Ready.gov/NWS/CDC materials — always follow local emergency officials.',
    });
    this.start();
  }

  private start(): void {
    this.render();
    this.unsubscribe = subscribe(() => this.renderWhenVisible(() => this.render()));
    if (typeof document !== 'undefined') {
      document.addEventListener('cb:open-survival-guide', this.onDeepLink as EventListener);
      this.element.addEventListener('click', this.onClick);
    }
  }

  public override destroy(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    if (typeof document !== 'undefined') {
      document.removeEventListener('cb:open-survival-guide', this.onDeepLink as EventListener);
      this.element.removeEventListener('click', this.onClick);
    }
    super.destroy();
  }

  /** Deep link: select the guide (or index) and ask the shell to front us. */
  private readonly onDeepLink = (ev: Event): void => {
    const id = (ev as CustomEvent<{ guideId?: string }>).detail?.guideId;
    if (id && getGuide(id as GuideId)) {
      this.selected = id as GuideId;
    } else {
      this.selected = null;
      if (id) showToast({ title: 'Guide not found', message: `No survival guide for "${id}".`, severity: 'normal' });
    }
    this.render();
    document.dispatchEvent(new CustomEvent('cb:open-panel', { detail: { panelKey: 'survival-guide' } }));
  };

  private readonly onClick = (ev: Event): void => {
    const target = ev.target as Element | null;
    if (!target) return;

    const card = target.closest('[data-guide-open]');
    if (card) {
      this.selected = card.getAttribute('data-guide-open') as GuideId;
      this.render();
      return;
    }
    if (target.closest('[data-guide-back]')) {
      this.selected = null;
      this.render();
      return;
    }
    const rel = target.closest('[data-guide-nav]');
    if (rel) {
      this.selected = rel.getAttribute('data-guide-nav') as GuideId;
      this.render();
      return;
    }
    const check = target.closest('[data-guide-check]');
    if (check) {
      toggle(check.getAttribute('data-guide-check') as string);
      this.render();
    }
  };

  private render(): void {
    const html = this.selected ? this.renderDetail(this.selected) : this.renderIndex();
    this.setContent(html);
  }

  private renderIndex(): string {
    return `<div style="padding:12px;">
      ${this.renderSection('Hazards', guidesByKind('hazard'))}
      ${this.renderSection('Preparedness Basics', guidesByKind('preparedness'))}
    </div>`;
  }

  private renderSection(title: string, guides: SurvivalGuide[]): string {
    return `
      <div style="margin-bottom:16px;">
        <div style="font-size:12px;text-transform:uppercase;letter-spacing:0.05em;opacity:0.7;margin:0 0 8px;">${esc(title)}</div>
        <div style="display:grid;gap:8px;">
          ${guides.map((g) => this.renderCard(g)).join('')}
        </div>
      </div>`;
  }

  private renderCard(g: SurvivalGuide): string {
    const readiness = computeGuideReadiness(g, getCheckedIds());
    const ring = readiness
      ? `<span style="font-variant-numeric:tabular-nums;font-size:12px;opacity:0.85;">${readiness.percent}%</span>`
      : '';
    return `<button type="button" data-guide-open="${g.id}" style="display:flex;justify-content:space-between;align-items:center;gap:10px;text-align:left;padding:10px 12px;border:1px solid var(--border-subtle,#333);border-radius:8px;background:rgba(255,255,255,0.02);cursor:pointer;color:inherit;width:100%;">
      <span><span style="font-weight:600;">${esc(g.title)}</span><br><span style="font-size:12px;opacity:0.7;">${esc(g.summary.slice(0, 90))}${g.summary.length > 90 ? '…' : ''}</span></span>
      ${ring}
    </button>`;
  }

  private renderDetail(id: GuideId): string {
    const g = getGuide(id);
    if (!g) return this.renderIndex();
    const readiness = computeGuideReadiness(g, getCheckedIds());
    const readinessLabel = readiness
      ? `<span style="font-size:12px;opacity:0.85;">${readiness.percent}% · ${readiness.checkedCount}/${readiness.totalCount}</span>`
      : '';

    const mistakes = `
      <div style="margin:14px 0;padding:10px 12px;border:1px solid var(--sev-critical,#ff453a);border-radius:8px;background:rgba(255,69,58,0.08);">
        <div style="font-weight:700;color:var(--sev-critical,#ff453a);margin-bottom:6px;">Deadly mistakes to avoid</div>
        <ul style="margin:0;padding-left:18px;display:grid;gap:4px;">${g.mistakes.map((m) => `<li>${esc(m)}</li>`).join('')}</ul>
      </div>`;

    const checklist = g.checklist.length === 0 ? '' : this.renderChecklist(g, readinessLabel);
    const related = g.relatedGuides.length === 0 ? '' : this.renderRelated(g);
    const sourcesLine = g.sources.map((s) => esc(s)).join(' · ');

    return `<div style="padding:12px;">
      <button type="button" data-guide-back style="font-size:12px;background:transparent;border:none;color:inherit;opacity:0.75;cursor:pointer;padding:0 0 8px;">‹ All guides</button>
      <div style="font-size:18px;font-weight:700;">${esc(g.title)}</div>
      <p style="opacity:0.85;font-size:13px;margin:6px 0 0;">${esc(g.summary)}</p>
      ${this.renderBullets('Know the signs', g.signs)}
      ${this.renderSteps('Prepare ahead', g.prepare)}
      ${this.renderSteps('During — act now', g.during)}
      ${this.renderSteps('Immediately after', g.after)}
      ${this.renderBullets('Recovery', g.recovery)}
      ${mistakes}
      ${checklist}
      ${related}
      <div style="margin-top:16px;padding-top:10px;border-top:1px solid var(--border-subtle,#333);font-size:11px;opacity:0.6;">
        Sources: ${sourcesLine}.<br>
        Reference guidance distilled from public materials — always follow instructions from local emergency officials.
      </div>
    </div>`;
  }

  private renderSteps(title: string, items: SurvivalGuide['during']): string {
    if (items.length === 0) return '';
    const rows = items.map((s) => `<li>${esc(s.label)}${detailSuffix(s.detail)}</li>`).join('');
    return `
      <div style="margin:14px 0;">
        <div style="font-weight:600;margin-bottom:6px;">${esc(title)}</div>
        <ol style="margin:0;padding-left:18px;display:grid;gap:6px;">${rows}</ol>
      </div>`;
  }

  private renderBullets(title: string, items: readonly string[]): string {
    if (items.length === 0) return '';
    const rows = items.map((s) => `<li>${esc(s)}</li>`).join('');
    return `
      <div style="margin:14px 0;">
        <div style="font-weight:600;margin-bottom:6px;">${esc(title)}</div>
        <ul style="margin:0;padding-left:18px;display:grid;gap:4px;">${rows}</ul>
      </div>`;
  }

  private renderChecklist(g: SurvivalGuide, readinessLabel: string): string {
    const rows = g.checklist.map((item) => {
      const checkedAttr = isChecked(item.id) ? 'checked' : '';
      return `
            <label style="display:flex;gap:8px;align-items:flex-start;cursor:pointer;">
              <input type="checkbox" data-guide-check="${esc(item.id)}" ${checkedAttr} style="margin-top:3px;">
              <span>${esc(item.label)}${detailSuffix(item.detail)}</span>
            </label>`;
    }).join('');
    return `
      <div style="margin:14px 0;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
          <span style="font-weight:600;">Readiness checklist</span>
          ${readinessLabel}
        </div>
        <div style="display:grid;gap:6px;">${rows}</div>
      </div>`;
  }

  private renderRelated(g: SurvivalGuide): string {
    const chips = g.relatedGuides.map((r) => this.renderRelatedChip(r)).join('');
    return `
      <div style="margin:14px 0;display:flex;flex-wrap:wrap;gap:6px;align-items:center;">
        <span style="font-size:12px;opacity:0.7;">Related:</span>
        ${chips}
      </div>`;
  }

  private renderRelatedChip(r: GuideId): string {
    const rg = getGuide(r);
    if (!rg) return '';
    return `<button type="button" data-guide-nav="${r}" style="font-size:12px;padding:3px 8px;border:1px solid var(--border-subtle,#333);border-radius:999px;background:transparent;color:inherit;cursor:pointer;">${esc(rg.title)}</button>`;
  }
}
