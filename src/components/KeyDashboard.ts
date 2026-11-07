import {
  KEY_CATEGORIES, HUMAN_LABELS, KEY_DESCRIPTIONS, SIGNUP_URLS, PLAINTEXT_KEYS, KEY_SETUP_STEPS,
} from '../services/settings-constants';
import { getCredentialEvidenceDisplay } from '../services/credential-evidence';
import {
  setSecretValue, validateSecret, verifySecretWithApi, verifyStoredSecretWithApi, type RuntimeSecretKey, type SecretVerificationResult,
} from '../services/runtime-config';
import { invokeTauri } from '../services/tauri-bridge';

const ESSENTIAL_TIERS = new Set([1, 2, 3, 4]);
export interface KeyDashboardOpts {
  /** Presence of the saved key. */
  isSet: (key: RuntimeSecretKey) => boolean;
  /** Current value for PLAINTEXT_KEYS only; secrets are never read back. */
  plaintextValue: (key: RuntimeSecretKey) => string | undefined;
  onRunWizard: () => void;
}

export class KeyDashboard {
  private root: HTMLElement;
  private opts: KeyDashboardOpts;
  private attempt = 0;
  private ageTimer: number;
  private visibility?: IntersectionObserver;
  private writing = new Set<RuntimeSecretKey>();

  private refreshVisible = (): void => {
    if (document.hidden || !this.root.isConnected || this.root.closest('.unified-settings-tab-panel:not(.active), .modal-overlay:not(.active)')) return;
    for (const category of KEY_CATEGORIES) {
      for (const key of category.keys) this.updateCardStatus(key);
    }
  };

  constructor(root: HTMLElement, opts: KeyDashboardOpts) {
    this.root = root;
    this.opts = opts;
    this.ageTimer = window.setInterval(this.refreshVisible, 60_000);
    if (window.IntersectionObserver) {
      this.visibility = new window.IntersectionObserver(entries => {
        if (entries.some(entry => entry.isIntersecting)) this.refreshVisible();
      });
      this.visibility.observe(root);
    }
    document.addEventListener('visibilitychange', this.refreshVisible);
    window.addEventListener('cb:credential-evidence-changed', this.refreshVisible);
  }

  destroy(): void {
    window.clearInterval(this.ageTimer);
    this.visibility?.disconnect();
    document.removeEventListener('visibilitychange', this.refreshVisible);
    window.removeEventListener('cb:credential-evidence-changed', this.refreshVisible);
  }

  refresh(): void {
    for (const category of KEY_CATEGORIES) {
      for (const key of category.keys) this.updateCardStatus(key);
      const summary = this.root.querySelector(`[data-tier="${category.tier}"] summary`);
      const count = category.keys.filter(key => this.opts.isSet(key)).length;
      if (summary) summary.textContent = `Tier ${category.tier} — ${category.label} (${count} of ${category.keys.length})`;
    }
    const count = this.root.querySelector('.key-dashboard-progress-label');
    if (count) count.textContent = this.progressLabel();
    this.root.querySelector('.key-dashboard-progress')?.replaceWith(this.renderProgress());
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

  private progressLabel(): string {
    const totalAll = KEY_CATEGORIES.reduce((acc, c) => acc + c.keys.length, 0);
    const setAll = KEY_CATEGORIES.reduce(
      (acc, c) => acc + c.keys.filter((k) => this.opts.isSet(k)).length, 0);
    return setAll + ' of ' + totalAll + ' configured';
  }

  private renderHeader(): HTMLElement {
    const header = document.createElement('div');
    header.className = 'key-dashboard-header';
    const label = document.createElement('div');
    label.className = 'key-dashboard-progress-label';
    label.textContent = this.progressLabel();
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
      .reduce((acc, c) => acc + c.keys.filter((k) => this.opts.isSet(k)).length, 0);
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
    const setCount = cat.keys.filter((k) => this.opts.isSet(k)).length;
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
    const isPlaintext = PLAINTEXT_KEYS.has(key);
    const card = document.createElement('div');
    card.className = 'key-card';
    card.dataset.key = key;

    const row = document.createElement('div');
    row.className = 'key-card-row';
    const glyph = document.createElement('span');
    glyph.className = 'key-card-glyph';
    glyph.setAttribute('aria-hidden', 'true');
    const label = document.createElement('span');
    label.className = 'key-card-label';
    label.textContent = HUMAN_LABELS[key] ?? key;
    row.append(glyph, label);
    const evidence = document.createElement('div');
    evidence.className = 'key-card-evidence';
    evidence.setAttribute('role', 'note');

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
    input.dataset.inputFor = key;
    input.setAttribute('aria-label', HUMAN_LABELS[key] ?? key);
    input.addEventListener('input', () => {
      this.setFeedback(key, '', 'info');
      delete input.dataset.testing;
    });

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
    const clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.className = 'key-card-btn key-card-clear';
    clearBtn.textContent = 'Clear';
    clearBtn.addEventListener('click', () => { void this.handleClear(key); });
    inputRow.append(clearBtn);

    card.append(row, evidence, desc);
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
    feedback.setAttribute('role', 'status');
    card.append(feedback);

    this.updateCardStatus(key, card);
    return card;
  }

  private setFeedback(key: RuntimeSecretKey, message: string, kind: 'ok' | 'err' | 'info'): void {
    const el = this.root.querySelector<HTMLElement>('[data-feedback-for="' + key + '"]');
    if (!el) return;
    el.textContent = message;
    el.dataset.kind = kind;
    delete el.dataset.attemptOnly;
  }

  private getInput(key: RuntimeSecretKey): HTMLInputElement | null {
    return this.root.querySelector<HTMLInputElement>('input[data-input-for="' + key + '"]');
  }

  private async handleSave(key: RuntimeSecretKey): Promise<void> {
    const input = this.getInput(key);
    if (!input || this.writing.has(key)) return;
    const value = input.value.trim();
    const format = validateSecret(key, value);
    if (!format.valid) { this.setFeedback(key, format.hint ?? 'Invalid format', 'err'); return; }
    await this.write(key, input, value);
  }

  private async write(key: RuntimeSecretKey, input: HTMLInputElement, value: string): Promise<void> {
    this.writing.add(key);
    delete input.dataset.testing;
    input.readOnly = true;
    const original = input.value;
    this.setFeedback(key, value ? 'Saving…' : 'Clearing…', 'info');
    try {
      await setSecretValue(key, value);
      if (this.getInput(key) !== input || !input.isConnected) return;
      if (input.value === original) input.value = '';
      this.refresh();
      this.setFeedback(key, value ? 'Saved, not verified.' : 'Cleared.', 'info');
      if (!value) input.focus();
    } catch {
      this.setFeedback(key, value ? 'Save failed. Check vault access and try again.' : 'Clear failed. Try again.', 'err');
    } finally {
      this.writing.delete(key);
      input.readOnly = false;
    }
  }

  private async handleTest(key: RuntimeSecretKey): Promise<void> {
    const input = this.getInput(key);
    if (!input || this.writing.has(key) || input.dataset.testing) return;
    const typed = input.value.trim();
    if (!typed && !this.opts.isSet(key)) { this.setFeedback(key, 'No value to test', 'err'); return; }
    const attempt = String(++this.attempt);
    input.dataset.testing = attempt;
    this.setFeedback(key, 'Testing…', 'info');
    try {
      const result = typed ? await verifySecretWithApi(key, typed) : await verifyStoredSecretWithApi(key);
      if (!input.isConnected || input.dataset.testing !== attempt || input.value.trim() !== typed) return;
      if (!typed && !this.opts.isSet(key)) { this.setFeedback(key, '', 'info'); return; }
      this.updateCardStatus(key);
      this.showTestResult(key, !!typed, result);
    } catch {
      if (input.isConnected && input.dataset.testing === attempt) this.setFeedback(key, 'Could not verify. Try again later.', 'err');
    } finally {
      if (input.dataset.testing === attempt) delete input.dataset.testing;
    }
  }

  private showTestResult(key: RuntimeSecretKey, draft: boolean, result: SecretVerificationResult): void {
    if (draft) {
      this.setFeedback(key, 'Draft · ' + result.message, result.canSave === false ? 'err' : 'info');
      return;
    }
    // Only the evidence line describes the saved key. It tracks invalidation and age.
    let message = 'Check finished.';
    if (result.reason === 'cooldown' || result.reason === 'concurrency-limit') message = result.message;
    else if (getCredentialEvidenceDisplay(key, true).state === 'unverified') message = 'This check · ' + result.message;
    this.setFeedback(key, message, 'info');
    const feedback = this.root.querySelector<HTMLElement>(`[data-feedback-for="${key}"]`);
    if (feedback) feedback.dataset.attemptOnly = 'true';
  }

  private updateCardStatus(key: RuntimeSecretKey, card = this.root.querySelector<HTMLElement>(`.key-card[data-key="${key}"]`)): void {
    if (!card) return;
    const stored = this.opts.isSet(key);
    if (card.querySelector('[data-attempt-only]')) this.setFeedback(key, '', 'info');
    const evidence = getCredentialEvidenceDisplay(key, stored);
    let status: 'unset' | 'unvalidated' | 'valid' | 'invalid' = stored ? 'unvalidated' : 'unset';
    if (evidence.state === 'verified') status = 'valid';
    if (evidence.state === 'rejected') status = 'invalid';
    card.dataset.status = status;
    const glyph = card.querySelector('.key-card-glyph')!;
    glyph.textContent = { valid: '✓', invalid: '✗', unvalidated: '⚠', unset: '○' }[status];
    const line = card.querySelector<HTMLElement>('.key-card-evidence')!;
    line.textContent = evidence.text;
    line.title = evidence.title;
    line.setAttribute('aria-label', [evidence.text, evidence.title].filter(Boolean).join('. '));
    const clear = card.querySelector<HTMLButtonElement>('.key-card-clear')!;
    clear.hidden = !stored;
    const input = card.querySelector<HTMLInputElement>('input')!;
    let placeholder = 'Paste key here';
    if (stored) placeholder = PLAINTEXT_KEYS.has(key) ? this.opts.plaintextValue(key) ?? '' : '••••••';
    input.placeholder = placeholder;
  }

  private async handleClear(key: RuntimeSecretKey): Promise<void> {
    const input = this.getInput(key);
    if (!input || this.writing.has(key)) return;
    const label = HUMAN_LABELS[key] ?? key;
    if (confirm('Clear ' + label + '? This cannot be undone.')) await this.write(key, input, '');
  }
}
