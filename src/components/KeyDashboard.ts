import {
  KEY_CATEGORIES, HUMAN_LABELS, KEY_DESCRIPTIONS, SIGNUP_URLS, PLAINTEXT_KEYS, KEY_SETUP_STEPS,
} from '../services/settings-constants';
import { getKeyStatus, setKeyStatus, type KeyStatusState } from '../services/wizard-state';
import {
  setSecretValue, verifySecretWithApi, type RuntimeSecretKey,
} from '../services/runtime-config';
import { featuresFor } from '../services/key-feature-index';
import { invokeTauri } from '../services/tauri-bridge';

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
    for (const k of cat.keys) body.append(this.renderCard(k));
    det.append(body);
    return det;
  }

  private renderCard(key: RuntimeSecretKey): HTMLElement {
    const stored = this.opts.getValue(key);
    const status = getKeyStatus(key)?.state ?? (stored ? 'unvalidated' : 'unset');
    const isPlaintext = PLAINTEXT_KEYS.has(key);
    const card = document.createElement('div');
    card.className = 'key-card';
    card.dataset.key = key;
    card.dataset.status = status;

    const row = document.createElement('div');
    row.className = 'key-card-row';
    const glyph = document.createElement('span');
    glyph.className = 'key-card-glyph';
    glyph.textContent = STATUS_GLYPH[status];
    const label = document.createElement('span');
    label.className = 'key-card-label';
    label.textContent = HUMAN_LABELS[key] ?? key;
    row.append(glyph, label);

    const desc = document.createElement('div');
    desc.className = 'key-card-desc';
    desc.textContent = KEY_DESCRIPTIONS[key] ?? '';

    const setupSteps = KEY_SETUP_STEPS[key];
    let stepsList: HTMLOListElement | null = null;
    if (setupSteps && setupSteps.length > 0) {
      stepsList = document.createElement('ol');
      stepsList.className = 'key-card-steps';
      for (const stepText of setupSteps) {
        const li = document.createElement('li');
        li.textContent = stepText;
        stepsList.append(li);
      }
    }

    const inputRow = document.createElement('div');
    inputRow.className = 'key-card-input-row';
    const input = document.createElement('input');
    input.type = isPlaintext ? 'text' : 'password';
    input.className = 'key-card-input';
    let placeholder = 'Paste key here';
    if (stored) {
      placeholder = isPlaintext ? stored : '••••••' + stored.slice(-3);
    }
    input.placeholder = placeholder;
    input.dataset.inputFor = key;

    const testBtn = document.createElement('button');
    testBtn.type = 'button';
    testBtn.className = 'key-card-btn key-card-test';
    testBtn.textContent = 'Test';
    testBtn.addEventListener('click', () => { void this.handleTest(key); });

    const saveBtn = document.createElement('button');
    saveBtn.type = 'button';
    saveBtn.className = 'key-card-btn key-card-save';
    saveBtn.textContent = 'Save';
    saveBtn.addEventListener('click', () => { void this.handleSave(key); });

    inputRow.append(input, testBtn, saveBtn);
    if (stored) {
      const clearBtn = document.createElement('button');
      clearBtn.type = 'button';
      clearBtn.className = 'key-card-btn key-card-clear';
      clearBtn.textContent = 'Clear';
      clearBtn.addEventListener('click', () => { void this.handleClear(key); });
      inputRow.append(clearBtn);
    }

    card.append(row, desc);
    if (stepsList) card.append(stepsList);
    card.append(inputRow);

    const signupUrl = SIGNUP_URLS[key];
    if (signupUrl && /^https?:\/\//.test(signupUrl)) {
      const a = document.createElement('a');
      a.className = 'key-card-signup';
      a.href = signupUrl;
      a.textContent = 'Open Signup ↗';
      a.addEventListener('click', (ev) => {
        ev.preventDefault();
        void (async () => {
          try { await invokeTauri('open_url', { url: signupUrl }); }
          catch { window.open(signupUrl, '_blank', 'noopener,noreferrer'); }
        })();
      });
      card.append(a);
    }

    const feedback = document.createElement('div');
    feedback.className = 'key-card-feedback';
    feedback.dataset.feedbackFor = key;
    card.append(feedback);

    return card;
  }

  private setFeedback(key: RuntimeSecretKey, message: string, kind: 'ok' | 'err' | 'info'): void {
    const el = this.root.querySelector<HTMLElement>('[data-feedback-for="' + key + '"]');
    if (!el) return;
    el.textContent = message;
    el.dataset.kind = kind;
  }

  private getInput(key: RuntimeSecretKey): HTMLInputElement | null {
    return this.root.querySelector<HTMLInputElement>('input[data-input-for="' + key + '"]');
  }

  private async handleSave(key: RuntimeSecretKey): Promise<void> {
    const value = this.getInput(key)?.value.trim();
    if (!value) { this.setFeedback(key, 'Empty value — nothing saved', 'err'); return; }
    try {
      await setSecretValue(key, value);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.setFeedback(key, `Save failed: ${msg}`, 'err');
      return;
    }
    setKeyStatus(key, { state: 'unvalidated', lastChecked: Date.now() });
    this.setFeedback(key, 'Saved (untested) — click Test to verify', 'info');
    this.render();
  }

  private async handleTest(key: RuntimeSecretKey): Promise<void> {
    const typedRaw = this.getInput(key)?.value.trim();
    const value = (typedRaw && typedRaw.length > 0) ? typedRaw : this.opts.getValue(key);
    if (!value) { this.setFeedback(key, 'No value to test', 'err'); return; }
    this.setFeedback(key, 'Testing…', 'info');
    const result = await verifySecretWithApi(key, value);
    if (result.valid) {
      setKeyStatus(key, { state: 'valid', lastChecked: Date.now() });
      const feats = featuresFor(key);
      const unlock = feats.length ? ' — Unlocks: ' + feats.join(', ') : '';
      this.setFeedback(key, '✓ ' + result.message + unlock, 'ok');
    } else {
      setKeyStatus(key, { state: 'invalid', lastChecked: Date.now(), lastError: result.message });
      this.setFeedback(key, '✗ ' + result.message, 'err');
    }
    // Update only the affected card's status glyph + dataset in place. Calling
    // the full this.render() rebuilds every <details class="key-tier"> element;
    // tiers where every key is set lose their `open` attribute (because the
    // render code only sets det.open=true when !allSet) and visibly collapse,
    // making the user think the panel is closing on Test.
    this.updateCardStatus(key);
  }

  private updateCardStatus(key: RuntimeSecretKey): void {
    const card = this.root.querySelector<HTMLElement>(`.key-card[data-key="${key}"]`);
    if (!card) return;
    const stored = this.opts.getValue(key);
    const status = getKeyStatus(key)?.state ?? (stored ? 'unvalidated' : 'unset');
    card.dataset.status = status;
    const glyph = card.querySelector('.key-card-glyph');
    if (glyph) glyph.textContent = STATUS_GLYPH[status];
  }

  private async handleClear(key: RuntimeSecretKey): Promise<void> {
    const label = HUMAN_LABELS[key] ?? key;
    if (!confirm('Clear ' + label + '? This cannot be undone.')) return;
    try {
      await setSecretValue(key, '');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.setFeedback(key, `Clear failed: ${msg}`, 'err');
      return;
    }
    setKeyStatus(key, { state: 'unset' });
    this.render();
  }
}
