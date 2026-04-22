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
import { getThreadFor } from '@/services/hypothesis-threads';
import { entitiesForHypothesis, getHotEntities, type EntityMention } from '@/services/hypothesis-entities';
import { getSkepticNote, isSkepticEnabled, setSkepticEnabled, subscribeSkeptic } from '@/services/hypothesis-skeptic';
import { getPressureHistory, buildSparklinePath, subscribePressureHistory } from '@/services/pressure-history';
import { getPlaybookFor, summarizePlaybook, recordAction, noteRecurrence } from '@/services/action-memory';
import { suggestQuestions, getCachedAnswer, askQuestion, subscribeQuestionAnswered, type QuestionAnswer } from '@/services/question-suggester';
import { getArchive, subscribeBriefingArchive } from '@/services/briefing-archive';
import type { ForecastDomain } from '@/services/mode-forecast';
import type { PressureSample } from '@/services/pressure-history';

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

function ageLabel(ms: number): string {
  const mins = Math.max(0, Math.round(ms / 60_000));
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h`;
}

export class AnalystHUD {
  private readonly root: HTMLElement;
  private snapshot: AnalystSnapshot | null = null;
  private forecast: ForecastSnapshot | null = null;
  private briefs: Record<string, AutoBrief | undefined> = {};
  private pressure: Record<ForecastDomain, PressureSample[]>;
  private visible = false;
  private expandedSkeptic = new Set<string>();
  private expandedQuestion = new Set<string>();
  private loadingQuestion = new Set<string>();
  private answers = new Map<string, QuestionAnswer>();

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
    this.pressure = getPressureHistory();
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
    subscribePressureHistory((h) => {
      this.pressure = h;
      if (this.visible) this.render();
    });
    subscribeSkeptic(() => {
      if (this.visible) this.render();
    });
    subscribeQuestionAnswered((answer) => {
      // Cache on HUD state; re-render if visible so the answer expands.
      for (const [key] of this.answers) if (key.endsWith(`||${answer.question}`)) this.answers.delete(key);
      this.answers.set(`__last||${answer.question}`, answer);
      if (this.visible) this.render();
    });
    subscribeBriefingArchive(() => {
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
      this.buildHotEntitiesSection(),
      this.buildHypothesesSection(),
      this.buildBriefsSection(),
      this.buildTimelineSection(),
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

    const meterRow = document.createElement('div');
    meterRow.className = 'analyst-hud-advisory-meter-row';
    const bar = document.createElement('div');
    bar.className = 'analyst-hud-meter';
    const fill = document.createElement('div');
    fill.className = 'analyst-hud-meter-fill';
    fill.style.width = `${pct}%`;
    bar.append(fill);
    const spark = this.buildSparkline(advisory.domain);
    meterRow.append(bar, spark);

    row.append(body, meterRow);
    return row;
  }

  private buildSparkline(domain: ForecastDomain): SVGSVGElement {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'analyst-hud-sparkline');
    svg.setAttribute('width', '80');
    svg.setAttribute('height', '18');
    svg.setAttribute('viewBox', '0 0 80 18');
    const series = this.pressure[domain] ?? [];
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', buildSparklinePath(series, 80, 18));
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', 'currentColor');
    path.setAttribute('stroke-width', '1.2');
    svg.append(path);
    return svg;
  }

  private buildHotEntitiesSection(): HTMLElement {
    const sec = document.createElement('section');
    sec.className = 'analyst-hud-section';
    const h = document.createElement('h3');
    h.textContent = 'Hot Entities';
    sec.append(h);

    const hot = getHotEntities().slice(0, 12);
    if (hot.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'analyst-hud-empty';
      empty.textContent = 'No entities span multiple hypotheses.';
      sec.append(empty);
      return sec;
    }
    const row = document.createElement('div');
    row.className = 'analyst-hud-hot-entities';
    for (const m of hot) row.append(this.buildEntityChip(m, true));
    sec.append(row);
    return sec;
  }

  private buildEntityChip(m: EntityMention, includeCount: boolean): HTMLElement {
    const chip = document.createElement('span');
    chip.className = `analyst-hud-entity-chip analyst-hud-entity-${m.kind}`;
    chip.textContent = includeCount ? `${m.entity} ×${m.hypothesisIds.length}` : m.entity;
    chip.title = `${m.kind} — appears in ${m.hypothesisIds.length} hypotheses`;
    return chip;
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
    // Note recurrence (playbook bookkeeping) exactly once per render pass.
    noteRecurrence(h);

    row.append(
      this.buildHypHead(h),
      this.buildHypStatement(h),
      this.buildHypPlaybook(h),
      this.buildHypEntities(h),
      this.buildHypEvidence(h),
      this.buildHypQuestions(h),
      this.buildHypSkeptic(h),
      this.buildHypActions(h),
    );
    return row;
  }

  private buildHypPlaybook(h: Hypothesis): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'analyst-hud-hyp-playbook';
    const book = getPlaybookFor(h);
    if (!book || book.actions.length === 0) return wrap;
    const line = document.createElement('span');
    line.className = 'analyst-hud-playbook-line';
    line.textContent = summarizePlaybook(book);
    wrap.append(line);
    return wrap;
  }

  private buildHypQuestions(h: Hypothesis): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'analyst-hud-hyp-questions';
    const questions = suggestQuestions(h);
    for (const q of questions) wrap.append(this.buildQuestionChip(h, q));
    return wrap;
  }

  private buildQuestionChip(h: Hypothesis, question: string): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'analyst-hud-question';
    const key = `${h.id}||${question}`;
    const cached = getCachedAnswer(h, question);
    const loading = this.loadingQuestion.has(key);
    const expanded = this.expandedQuestion.has(key);

    const chip = document.createElement('button');
    chip.className = 'analyst-hud-question-chip';
    chip.textContent = loading ? `? ${question} …` : `? ${question}`;
    chip.disabled = loading;
    chip.title = cached
      ? 'Cached answer — click to toggle'
      : 'Ask Claude (local if configured) and cache the answer';
    chip.addEventListener('click', () => {
      if (cached) {
        if (expanded) this.expandedQuestion.delete(key);
        else this.expandedQuestion.add(key);
        this.render();
        return;
      }
      this.loadingQuestion.add(key);
      this.render();
      void askQuestion(h, question).finally(() => {
        this.loadingQuestion.delete(key);
        this.expandedQuestion.add(key);
        this.render();
      });
    });
    wrap.append(chip);
    if (cached && expanded) {
      const body = document.createElement('p');
      body.className = 'analyst-hud-question-answer';
      body.textContent = `[${cached.provider}] ${cached.text}`;
      wrap.append(body);
    }
    return wrap;
  }

  private buildTimelineSection(): HTMLElement {
    const sec = document.createElement('section');
    sec.className = 'analyst-hud-section';
    const h = document.createElement('h3');
    h.textContent = 'Briefing Timeline';
    sec.append(h);
    const items = getArchive().slice(0, 8);
    if (items.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'analyst-hud-empty';
      empty.textContent = 'No briefings archived yet.';
      sec.append(empty);
      return sec;
    }
    const list = document.createElement('div');
    list.className = 'analyst-hud-timeline';
    for (const brief of items) {
      const row = document.createElement('div');
      row.className = 'analyst-hud-timeline-row';
      const agoLabel = ageLabel(Date.now() - brief.generatedAt);
      const head = document.createElement('span');
      head.className = 'analyst-hud-timeline-head';
      const providerSuffix = brief.provider ? ` (${brief.provider})` : '';
      head.textContent = `${agoLabel} · ${brief.domain}${providerSuffix}`;
      const body = document.createElement('span');
      body.className = 'analyst-hud-timeline-body';
      body.textContent = brief.summary || brief.text.slice(0, 160);
      row.append(head, body);
      list.append(row);
    }
    sec.append(list);
    return sec;
  }

  private buildHypHead(h: Hypothesis): HTMLElement {
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

    const thread = getThreadFor(h);
    head.append(kind, risk, conf);
    const fused = (h as Hypothesis & { fusedFrom?: string[] }).fusedFrom;
    if (fused && fused.length > 0) {
      const fuseBadge = document.createElement('span');
      fuseBadge.className = 'analyst-hud-fused';
      fuseBadge.textContent = `+${fused.length}`;
      fuseBadge.title = `Fused from: ${fused.join(', ')}`;
      head.append(fuseBadge);
    }
    if (thread && thread.cycleCount > 1) {
      const badge = document.createElement('span');
      badge.className = `analyst-hud-thread analyst-hud-thread-${thread.trajectory}`;
      const TRAJECTORY_ARROW = { strengthening: 'up', weakening: 'down', stable: 'flat', new: 'new' } as const;
      const arrow = TRAJECTORY_ARROW[thread.trajectory];
      badge.textContent = `${thread.cycleCount}c ${arrow}`;
      badge.title = `Thread: ${thread.cycleCount} cycles, ${thread.trajectory}, peak=${thread.peakRisk}`;
      head.append(badge);
    }
    return head;
  }

  private buildHypStatement(h: Hypothesis): HTMLElement {
    const p = document.createElement('p');
    p.className = 'analyst-hud-hyp-statement';
    p.textContent = h.statement;
    return p;
  }

  private buildHypEntities(h: Hypothesis): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'analyst-hud-hyp-entities';
    for (const m of entitiesForHypothesis(h.id).slice(0, 6)) {
      wrap.append(this.buildEntityChip(m, false));
    }
    return wrap;
  }

  private buildHypEvidence(h: Hypothesis): HTMLElement {
    const ev = document.createElement('div');
    ev.className = 'analyst-hud-hyp-evidence';
    for (const e of h.evidence.slice(0, 6)) ev.append(this.buildEvidenceChip(e));
    return ev;
  }

  private buildHypSkeptic(h: Hypothesis): HTMLElement {
    const note = getSkepticNote(h);
    const wrap = document.createElement('div');
    wrap.className = 'analyst-hud-hyp-skeptic';
    if (!note) return wrap;
    const expanded = this.expandedSkeptic.has(note.signature);
    const btn = document.createElement('button');
    btn.className = 'analyst-hud-skeptic-toggle';
    btn.textContent = expanded ? `[skeptic ▼] ${note.summary}` : `[skeptic ▶] ${note.summary.slice(0, 80)}…`;
    btn.title = 'Click to expand the skeptic\'s full critique';
    btn.addEventListener('click', () => {
      if (expanded) this.expandedSkeptic.delete(note.signature);
      else this.expandedSkeptic.add(note.signature);
      this.render();
    });
    wrap.append(btn);
    if (expanded && note.text) {
      const full = document.createElement('p');
      full.className = 'analyst-hud-skeptic-full';
      full.textContent = note.text;
      wrap.append(full);
    }
    return wrap;
  }

  private buildHypActions(h: Hypothesis): HTMLElement {
    const actions = document.createElement('div');
    actions.className = 'analyst-hud-hyp-actions';
    const up = document.createElement('button');
    up.className = 'analyst-hud-thumb';
    up.textContent = '+';
    up.title = 'Useful';
    up.addEventListener('click', () => {
      thumbsUp(h);
      recordAction(h, 'thumbs-up');
      up.classList.add('analyst-hud-thumb-done');
    });
    const down = document.createElement('button');
    down.className = 'analyst-hud-thumb';
    down.textContent = '-';
    down.title = 'Noise';
    down.addEventListener('click', () => {
      thumbsDown(h);
      recordAction(h, 'thumbs-down');
      down.classList.add('analyst-hud-thumb-done');
    });
    actions.append(up, down);
    return actions;
  }

  private buildEvidenceChip(e: HypothesisEvidence): HTMLElement {
    const chip = document.createElement('button');
    chip.className = 'analyst-hud-evidence-chip';
    chip.textContent = e.label.length > 40 ? `${e.label.slice(0, 40)}...` : e.label;
    chip.title = `${e.source} — ${e.id}`;
    if (e.panelId) {
      chip.addEventListener('click', () => {
        const h = this.findHypothesisForEvidence(e);
        if (e.panelId) {
          jumpToPanel(e.panelId);
          flashPanel(e.panelId);
          if (h) recordAction(h, 'panel-jump', e.panelId);
        }
        this.hide();
      });
    } else {
      chip.disabled = true;
    }
    return chip;
  }

  private findHypothesisForEvidence(e: HypothesisEvidence): Hypothesis | null {
    if (!this.snapshot) return null;
    return this.snapshot.hypotheses.find(h => h.evidence.some(ev => ev.id === e.id && ev.source === e.source)) ?? null;
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

    const skepticToggle = document.createElement('label');
    skepticToggle.className = 'analyst-hud-toggle';
    const sk = document.createElement('input');
    sk.type = 'checkbox';
    sk.checked = isSkepticEnabled();
    sk.addEventListener('change', () => {
      setSkepticEnabled(sk.checked);
    });
    const skLabel = document.createElement('span');
    skLabel.textContent = 'Run skeptic pass on high/critical hypotheses';
    skepticToggle.append(sk, skLabel);
    sec.append(skepticToggle);

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
