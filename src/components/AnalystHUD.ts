/**
 * AnalystHUD — floating overlay showing top analyst-loop hypotheses,
 * mode-forecast advisories, and the latest auto-brief.
 *
 * Toggles with ⌘⇧A (Ctrl+Shift+A on non-mac) or the `cb:toggle-analyst-hud`
 * event. Hidden by default. Subscribes to `cb:analyst-hypotheses`,
 * `cb:mode-advisory`, and `cb:auto-brief` for live updates.
 *
 * Evidence links call `jumpToPanel()` from alert-reactions so clicking a
 * citation scrolls the relevant panel into view.
 */

import { replaceChildren } from '@/utils/dom-utils';
import { jumpToPanel, flashPanel } from '@/services/alert-reactions';
import { subscribeAnalyst, getAnalystSnapshot, type Hypothesis, type HypothesisEvidence, type AnalystSnapshot } from '@/services/analyst-loop';
import { subscribeModeAdvisory, getForecastSnapshot, type ForecastSnapshot, type ModeAdvisory } from '@/services/mode-forecast';
import { subscribeAutoBrief, getLatestBriefs, isAutoBriefEnabled, setAutoBriefEnabled, type AutoBrief } from '@/services/auto-brief';
import { thumbsUp, thumbsDown } from '@/services/hypothesis-feedback';
import { getKindAccuracy } from '@/services/hypothesis-accuracy';

const MAX_VISIBLE = 5;

const RISK_COLORS: Record<Hypothesis['risk'], string> = {
  critical: '#c0392b',
  high: '#e67e22',
  moderate: '#f39c12',
  low: '#27ae60',
};

const DOMAIN_GLYPH = {
  finance: '$', security: '*', disaster: '!', cyber: '#',
} as const;

export class AnalystHUD {
  private readonly root: HTMLElement;
  private snapshot: AnalystSnapshot | null = null;
  private forecast: ForecastSnapshot | null = null;
  private briefs: Record<string, AutoBrief | undefined> = {};
  private visible = false;

  constructor() {
    this.root = document.createElement('div');
    this.root.className = 'analyst-hud';
    this.root.hidden = true;
    this.root.addEventListener('click', (e) => {
      if (e.target === this.root) this.hide();
    });
    this.snapshot = getAnalystSnapshot();
    this.forecast = getForecastSnapshot();
    this.briefs = getLatestBriefs();
  }

  mount(parent: HTMLElement): void {
    parent.append(this.root);
    subscribeAnalyst((snap) => {
      this.snapshot = snap;
      if (this.visible) this.render();
    });
    subscribeModeAdvisory((f) => {
      this.forecast = f;
      if (this.visible) this.render();
    });
    subscribeAutoBrief((brief) => {
      this.briefs[brief.domain] = brief;
      if (this.visible) this.render();
    });
    document.addEventListener('cb:toggle-analyst-hud', () => this.toggle());
    document.addEventListener('cb:hypothesis-feedback', () => {
      if (this.visible) this.render();
    });
  }

  toggle(): void { if (this.visible) this.hide(); else this.show(); }

  show(): void {
    this.visible = true;
    this.root.hidden = false;
    this.render();
  }

  hide(): void {
    this.visible = false;
    this.root.hidden = true;
  }

  // ── Rendering ─────────────────────────────────────────────────────────────

  private render(): void {
    const card = document.createElement('div');
    card.className = 'analyst-hud-card';
    card.append(
      this.buildHeader(),
      this.buildAdvisorySection(),
      this.buildHypothesesSection(),
      this.buildBriefsSection(),
      this.buildFooter(),
    );
    replaceChildren(this.root, card);
  }

  private buildHeader(): HTMLElement {
    const header = document.createElement('div');
    header.className = 'analyst-hud-header';

    const title = document.createElement('h2');
    title.textContent = 'Analyst HUD';

    const aiBadge = document.createElement('span');
    aiBadge.className = 'analyst-hud-ai-badge';
    aiBadge.textContent = this.snapshot?.aiEnriched ? 'AI' : 'templates';
    aiBadge.title = this.snapshot?.aiEnriched
      ? 'Clusters enriched by Claude agent'
      : 'Template-based reasoning (no AI)';

    const close = document.createElement('button');
    close.className = 'analyst-hud-close';
    close.textContent = 'x';
    close.addEventListener('click', () => this.hide());

    header.append(title, aiBadge, close);
    return header;
  }

  private buildAdvisorySection(): HTMLElement {
    const sec = document.createElement('section');
    sec.className = 'analyst-hud-section';

    const h = document.createElement('h3');
    h.textContent = 'Posture Advisories';
    sec.append(h);

    const advisories = this.forecast?.advisories ?? [];
    if (advisories.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'analyst-hud-empty';
      empty.textContent = 'No elevated-pressure domains.';
      sec.append(empty);
      return sec;
    }
    for (const advisory of advisories) sec.append(this.buildAdvisoryRow(advisory));
    return sec;
  }

  private buildAdvisoryRow(advisory: ModeAdvisory): HTMLElement {
    const row = document.createElement('div');
    row.className = 'analyst-hud-advisory';
    const glyph = DOMAIN_GLYPH[advisory.domain];
    const pct = (advisory.pressure * 100).toFixed(0);
    const body = document.createElement('div');
    body.className = 'analyst-hud-advisory-body';
    body.textContent = `[${glyph}] ${advisory.statement}`;
    const bar = document.createElement('div');
    bar.className = 'analyst-hud-meter';
    const fill = document.createElement('div');
    fill.className = 'analyst-hud-meter-fill';
    fill.style.width = `${pct}%`;
    bar.append(fill);
    row.append(body, bar);
    return row;
  }

  private buildHypothesesSection(): HTMLElement {
    const sec = document.createElement('section');
    sec.className = 'analyst-hud-section';

    const h = document.createElement('h3');
    h.textContent = 'Hypotheses';
    sec.append(h);

    const hypotheses = this.snapshot?.hypotheses ?? [];
    const visible = hypotheses.slice(0, MAX_VISIBLE);
    if (visible.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'analyst-hud-empty';
      empty.textContent = 'No cross-domain convergence detected.';
      sec.append(empty);
      return sec;
    }
    for (const h of visible) sec.append(this.buildHypothesisRow(h));
    return sec;
  }

  private buildHypothesisRow(h: Hypothesis): HTMLElement {
    const row = document.createElement('div');
    row.className = 'analyst-hud-hyp';
    row.style.borderLeftColor = RISK_COLORS[h.risk];

    const head = document.createElement('div');
    head.className = 'analyst-hud-hyp-head';
    const kind = document.createElement('span');
    kind.className = 'analyst-hud-hyp-kind';
    kind.textContent = h.kind;
    const risk = document.createElement('span');
    risk.className = 'analyst-hud-hyp-risk';
    risk.textContent = h.risk;
    risk.style.color = RISK_COLORS[h.risk];
    const conf = document.createElement('span');
    conf.className = 'analyst-hud-hyp-conf';
    conf.textContent = `${(h.confidence * 100).toFixed(0)}%`;
    head.append(kind, risk, conf);

    const statement = document.createElement('p');
    statement.className = 'analyst-hud-hyp-statement';
    statement.textContent = h.statement;

    const ev = document.createElement('div');
    ev.className = 'analyst-hud-hyp-evidence';
    for (const e of h.evidence.slice(0, 6)) ev.append(this.buildEvidenceChip(e));

    const actions = document.createElement('div');
    actions.className = 'analyst-hud-hyp-actions';
    const up = document.createElement('button');
    up.className = 'analyst-hud-thumb';
    up.textContent = '+';
    up.title = 'Useful';
    up.addEventListener('click', () => {
      thumbsUp(h);
      up.classList.add('analyst-hud-thumb-done');
    });
    const down = document.createElement('button');
    down.className = 'analyst-hud-thumb';
    down.textContent = '-';
    down.title = 'Noise';
    down.addEventListener('click', () => {
      thumbsDown(h);
      down.classList.add('analyst-hud-thumb-done');
    });
    actions.append(up, down);

    row.append(head, statement, ev, actions);
    return row;
  }

  private buildEvidenceChip(e: HypothesisEvidence): HTMLElement {
    const chip = document.createElement('button');
    chip.className = 'analyst-hud-evidence-chip';
    chip.textContent = e.label.length > 40 ? `${e.label.slice(0, 40)}...` : e.label;
    chip.title = `${e.source} — ${e.id}`;
    if (e.panelId) {
      chip.addEventListener('click', () => {
        if (e.panelId) {
          jumpToPanel(e.panelId);
          flashPanel(e.panelId);
        }
        this.hide();
      });
    } else {
      chip.disabled = true;
    }
    return chip;
  }

  private buildBriefsSection(): HTMLElement {
    const sec = document.createElement('section');
    sec.className = 'analyst-hud-section';
    const h = document.createElement('h3');
    h.textContent = 'Auto-Briefs';
    sec.append(h);

    const toggle = document.createElement('label');
    toggle.className = 'analyst-hud-toggle';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = isAutoBriefEnabled();
    cb.addEventListener('change', () => {
      setAutoBriefEnabled(cb.checked);
    });
    const label = document.createElement('span');
    label.textContent = 'Auto-generate brief on critical crossover';
    toggle.append(cb, label);
    sec.append(toggle);

    const briefs = (['finance', 'security', 'disaster', 'cyber'] as const)
      .map(d => this.briefs[d])
      .filter((b): b is AutoBrief => Boolean(b))
      .sort((a, b) => b.generatedAt - a.generatedAt);

    if (briefs.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'analyst-hud-empty';
      empty.textContent = 'No auto-briefs yet.';
      sec.append(empty);
      return sec;
    }
    for (const b of briefs) sec.append(this.buildBriefRow(b));
    return sec;
  }

  private buildBriefRow(brief: AutoBrief): HTMLElement {
    const row = document.createElement('div');
    row.className = 'analyst-hud-brief';
    const head = document.createElement('div');
    head.className = 'analyst-hud-brief-head';
    const d = document.createElement('span');
    d.className = 'analyst-hud-brief-domain';
    d.textContent = `[${DOMAIN_GLYPH[brief.domain]}] ${brief.domain}`;
    const ago = document.createElement('span');
    ago.className = 'analyst-hud-brief-ago';
    const mins = Math.max(0, Math.round((Date.now() - brief.generatedAt) / 60_000));
    ago.textContent = mins < 1 ? 'just now' : `${mins}m ago`;
    head.append(d, ago);

    const summary = document.createElement('p');
    summary.className = 'analyst-hud-brief-summary';
    summary.textContent = brief.summary || brief.text.slice(0, 240);
    row.append(head, summary);
    return row;
  }

  private buildFooter(): HTMLElement {
    const f = document.createElement('div');
    f.className = 'analyst-hud-footer';
    const accuracy = getKindAccuracy();
    const parts: string[] = [];
    for (const [kind, stats] of accuracy) {
      const total = stats.hits + stats.misses;
      if (total < 3) continue;
      const pct = Math.round((stats.hits / total) * 100);
      parts.push(`${kind}: ${pct}% (${total})`);
    }
    f.textContent = parts.length > 0
      ? `Accuracy — ${parts.join(' · ')}`
      : 'Accuracy — insufficient data.';
    return f;
  }
}
