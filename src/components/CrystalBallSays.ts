/* eslint-disable sonarjs/cognitive-complexity */
/**
 * Crystal Ball Says — lightweight strip below the Triage bar showing
 * the top actionable Situation from the OODA-loop Situation Engine.
 *
 * Displays: situation title, phase badge, confidence, top scenario,
 * and first action card. Shows diff indicators when situations change.
 */

import type { Situation, ActionCard, Scenario } from '@/services/situation-types';
import { situationEngine } from '@/services/situation-engine';

const REFRESH_MS = 30_000;

interface SitSnapshot {
  id: string;
  confidence: number;
  scenarioIds: Set<string>;
}

export class CrystalBallSays {
  private element: HTMLElement;
  private timer: number | null = null;
  private prevSnapshots = new Map<string, SitSnapshot>();

  constructor() {
    this.element = document.createElement('div');
    this.element.className = 'cbs-strip';
    this.element.id = 'crystalBallSays';
    this.element.hidden = true;
  }

  mount(parent: HTMLElement): void {
    parent.append(this.element);
    this.render();
    this.timer = window.setInterval(() => this.render(), REFRESH_MS);
    document.addEventListener('cb:situations-updated', () => this.render());
  }

  destroy(): void {
    if (this.timer != null) window.clearInterval(this.timer);
    this.element.remove();
  }

  getElement(): HTMLElement { return this.element; }

  private render(): void {
    const situations = situationEngine.getActionableSituations();
    if (situations.length === 0) {
      this.element.hidden = true;
      this.element.textContent = '';
      return;
    }
    this.element.hidden = false;
    this.element.textContent = '';

    const label = document.createElement('div');
    label.className = 'cbs-label';
    label.textContent = 'CRYSTAL BALL SAYS';
    this.element.append(label);

    const items = document.createElement('div');
    items.className = 'cbs-items';

    const currentIds = new Set<string>();
    for (const sit of situations.slice(0, 3)) {
      currentIds.add(sit.id);
      const prev = this.prevSnapshots.get(sit.id);
      items.append(this.buildSitCard(sit, prev ?? null));
    }

    // Show removed situations briefly (struck through).
    for (const [id] of this.prevSnapshots) {
      if (!currentIds.has(id)) {
        const ghost = document.createElement('div');
        ghost.className = 'cbs-card cbs-removed';
        ghost.textContent = `\u2014 ${id.slice(0, 20)} resolved`;
        items.append(ghost);
      }
    }

    this.element.append(items);

    // Update snapshots for next diff.
    const nextSnapshots = new Map<string, SitSnapshot>();
    for (const sit of situations.slice(0, 3)) {
      nextSnapshots.set(sit.id, {
        id: sit.id,
        confidence: sit.confidence,
        scenarioIds: new Set(sit.scenarios.map(s => s.id)),
      });
    }
    this.prevSnapshots = nextSnapshots;
  }

  private buildSitCard(sit: Situation, prev: SitSnapshot | null): HTMLElement {
    const card = document.createElement('div');
    const isNew = !prev;
    card.className = `cbs-card cbs-phase-${sit.phase}${isNew ? ' cbs-new' : ''}`;

    const header = document.createElement('div');
    header.className = 'cbs-header';
    const title = document.createElement('span');
    title.className = 'cbs-title';
    title.textContent = sit.title;
    if (isNew) {
      const newBadge = document.createElement('span');
      newBadge.className = 'cbs-new-badge';
      newBadge.textContent = 'NEW';
      title.append(newBadge);
    }
    const phase = document.createElement('span');
    phase.className = `cbs-phase-badge cbs-badge-${sit.phase}`;
    phase.textContent = sit.phase.toUpperCase();
    const conf = document.createElement('span');
    conf.className = 'cbs-confidence';
    conf.textContent = `${Math.round(sit.confidence * 100)}%`;

    // Confidence delta arrow.
    if (prev) {
      const delta = sit.confidence - prev.confidence;
      if (Math.abs(delta) >= 0.02) {
        const arrow = document.createElement('span');
        arrow.className = delta > 0 ? 'cbs-delta-up' : 'cbs-delta-down';
        arrow.textContent = delta > 0 ? '\u2191' : '\u2193';
        conf.append(arrow);
      }
    }

    header.append(title, phase, conf);

    const body = document.createElement('div');
    body.className = 'cbs-body';

    // Top scenario with diff markers.
    const topScenario = sit.scenarios[0];
    if (topScenario) {
      const isScenarioNew = prev ? !prev.scenarioIds.has(topScenario.id) : false;
      body.append(this.buildScenarioLine(topScenario, isScenarioNew));
    }

    // Show removed scenarios.
    if (prev) {
      const currentScenarioIds = new Set(sit.scenarios.map(s => s.id));
      for (const oldId of prev.scenarioIds) {
        if (!currentScenarioIds.has(oldId)) {
          const removed = document.createElement('div');
          removed.className = 'cbs-scenario cbs-scenario-removed';
          removed.textContent = `\u2014 scenario removed`;
          body.append(removed);
        }
      }
    }

    // Top action.
    const topAction = sit.actions.find(a => !a.dismissed);
    if (topAction) {
      body.append(this.buildActionLine(topAction));
    }

    card.append(header, body);
    return card;
  }

  private buildScenarioLine(s: Scenario, isNew: boolean): HTMLElement {
    const el = document.createElement('div');
    el.className = `cbs-scenario${isNew ? ' cbs-scenario-new' : ''}`;
    const prob = document.createElement('span');
    prob.className = `cbs-prob cbs-sev-${s.severity}`;
    prob.textContent = `${Math.round(s.probability * 100)}%`;
    const label = document.createElement('span');
    label.className = 'cbs-scenario-label';
    label.textContent = s.label;
    el.append(prob, label);
    return el;
  }

  private buildActionLine(a: ActionCard): HTMLElement {
    const el = document.createElement('div');
    el.className = `cbs-action cbs-urgency-${a.urgency}`;
    const icon = document.createElement('span');
    icon.className = 'cbs-action-icon';
    const URGENCY_ICON: Record<string, string> = { immediate: '!', soon: '>', monitor: '~', fyi: 'i' };
    icon.textContent = URGENCY_ICON[a.urgency] ?? '~';
    const headline = document.createElement('span');
    headline.className = 'cbs-action-headline';
    headline.textContent = a.headline;
    el.append(icon, headline);
    return el;
  }
}
