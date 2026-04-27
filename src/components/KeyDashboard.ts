import { KEY_CATEGORIES, HUMAN_LABELS } from '../services/settings-constants';
import { getKeyStatus, type KeyStatusState } from '../services/wizard-state';
import type { RuntimeSecretKey } from '../services/runtime-config';

const ESSENTIAL_TIERS = new Set([1, 2, 3, 4]);
const STATUS_GLYPH: Record<KeyStatusState, string> = {
  valid: '✓', unvalidated: '⚠', invalid: '✗', unset: '○', skipped: '⏸',
};

export interface KeyDashboardOpts {
  getValue: (key: RuntimeSecretKey) => string | undefined;
  onRunWizard: () => void;
}

export class KeyDashboard {
  private root: HTMLElement;
  private opts: KeyDashboardOpts;

  constructor(root: HTMLElement, opts: KeyDashboardOpts) {
    this.root = root;
    this.opts = opts;
  }

  render(): void {
    this.root.replaceChildren();
    const wrap = document.createElement('div');
    wrap.className = 'key-dashboard';
    wrap.append(this.renderHeader());
    wrap.append(this.renderProgress());
    for (const cat of KEY_CATEGORIES) wrap.append(this.renderTier(cat));
    this.root.append(wrap);
  }

  private renderHeader(): HTMLElement {
    const totalAll = KEY_CATEGORIES.reduce((acc, c) => acc + c.keys.length, 0);
    const setAll = KEY_CATEGORIES.reduce(
      (acc, c) => acc + c.keys.filter((k) => this.opts.getValue(k)).length, 0);
    const header = document.createElement('div');
    header.className = 'key-dashboard-header';
    const label = document.createElement('div');
    label.className = 'key-dashboard-progress-label';
    label.textContent = setAll + ' of ' + totalAll + ' configured';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'key-dashboard-run-wizard';
    btn.textContent = '▶ Run Setup Wizard';
    btn.addEventListener('click', () => this.opts.onRunWizard());
    header.append(label, btn);
    return header;
  }

  private renderProgress(): HTMLElement {
    const totalEss = KEY_CATEGORIES
      .filter((c) => ESSENTIAL_TIERS.has(c.tier))
      .reduce((acc, c) => acc + c.keys.length, 0);
    const setEss = KEY_CATEGORIES
      .filter((c) => ESSENTIAL_TIERS.has(c.tier))
      .reduce((acc, c) => acc + c.keys.filter((k) => this.opts.getValue(k)).length, 0);
    const pct = Math.round((setEss / totalEss) * 100);
    const bar = document.createElement('div');
    bar.className = 'key-dashboard-progress';
    bar.setAttribute('role', 'progressbar');
    bar.setAttribute('aria-valuenow', String(pct));
    bar.setAttribute('aria-valuemin', '0');
    bar.setAttribute('aria-valuemax', '100');
    bar.title = setEss + ' of ' + totalEss + ' essential keys configured';
    const fill = document.createElement('div');
    fill.className = 'key-dashboard-progress-bar';
    fill.style.width = pct + '%';
    bar.append(fill);
    return bar;
  }

  private renderTier(cat: typeof KEY_CATEGORIES[number]): HTMLElement {
    const setCount = cat.keys.filter((k) => this.opts.getValue(k)).length;
    const allSet = setCount === cat.keys.length;
    const det = document.createElement('details');
    det.className = 'key-tier';
    det.dataset.tier = String(cat.tier);
    if (!allSet) det.open = true;
    const sum = document.createElement('summary');
    sum.textContent = 'Tier ' + cat.tier + ' — ' + cat.label + ' (' + setCount + ' of ' + cat.keys.length + ')';
    det.append(sum);
    const body = document.createElement('div');
    body.className = 'key-tier-cards';
    for (const k of cat.keys) body.append(this.renderCardPlaceholder(k));
    det.append(body);
    return det;
  }

  // Real card built in Task 6.
  private renderCardPlaceholder(key: RuntimeSecretKey): HTMLElement {
    const stored = this.opts.getValue(key);
    const status = getKeyStatus(key)?.state ?? (stored ? 'unvalidated' : 'unset');
    const card = document.createElement('div');
    card.className = 'key-card';
    card.dataset.key = key;
    card.dataset.status = status;
    const glyph = document.createElement('span');
    glyph.className = 'key-card-glyph';
    glyph.textContent = STATUS_GLYPH[status];
    const label = document.createElement('span');
    label.className = 'key-card-label';
    label.textContent = HUMAN_LABELS[key] ?? key;
    card.append(glyph, label);
    return card;
  }
}
