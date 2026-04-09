/* eslint-disable sonarjs/void-use, sonarjs/no-nested-template-literals */
/**
 * Crystal Ball Says — lightweight strip below the Triage bar showing
 * the top actionable Situation from the OODA-loop Situation Engine.
 *
 * Displays: situation title, phase badge, confidence, top scenario,
 * and first action card. Collapses when no active situations.
 */

import type { Situation, ActionCard, Scenario } from '@/services/situation-types';
import { situationEngine } from '@/services/situation-engine';

const REFRESH_MS = 30_000;

export class CrystalBallSays {
  private element: HTMLElement;
  private timer: number | null = null;

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

    for (const sit of situations.slice(0, 3)) {
      items.append(this.buildSitCard(sit));
    }

    this.element.append(items);
  }

  private buildSitCard(sit: Situation): HTMLElement {
    const card = document.createElement('div');
    card.className = `cbs-card cbs-phase-${sit.phase}`;

    const header = document.createElement('div');
    header.className = 'cbs-header';
    const title = document.createElement('span');
    title.className = 'cbs-title';
    title.textContent = sit.title;
    const phase = document.createElement('span');
    phase.className = `cbs-phase-badge cbs-badge-${sit.phase}`;
    phase.textContent = sit.phase.toUpperCase();
    const conf = document.createElement('span');
    conf.className = 'cbs-confidence';
    conf.textContent = `${Math.round(sit.confidence * 100)}%`;
    header.append(title, phase, conf);

    const body = document.createElement('div');
    body.className = 'cbs-body';

    // Top scenario
    const topScenario = sit.scenarios[0];
    if (topScenario) {
      body.append(this.buildScenarioLine(topScenario));
    }

    // Top action
    const topAction = sit.actions.find(a => !a.dismissed);
    if (topAction) {
      body.append(this.buildActionLine(topAction));
    }

    card.append(header, body);
    return card;
  }

  private buildScenarioLine(s: Scenario): HTMLElement {
    const el = document.createElement('div');
    el.className = 'cbs-scenario';
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
