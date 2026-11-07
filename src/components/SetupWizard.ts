import {
  KEY_CATEGORIES, HUMAN_LABELS, KEY_DESCRIPTIONS, SIGNUP_URLS, OAUTH_CONNECT_KEYS, KEY_SETUP_STEPS,
} from '../services/settings-constants';
import {
  setSecretValue, validateSecret, verifyStoredSecretWithApi, type RuntimeSecretKey,
} from '../services/runtime-config';
import {
  getPosition, setPosition,
  getDontAsk, addDontAsk,
  getSkipped, addSkipped, clearSkipped,
} from '../services/wizard-state';
import { getCredentialEvidenceDisplay } from '../services/credential-evidence';
import { invokeTauri } from '../services/tauri-bridge';
import { startWatching, stopWatching, markConsumed } from '../services/clipboard-watcher';

type StepView =
  | { kind: 'step'; tier: number; stepIndex: number; key: RuntimeSecretKey }
  | { kind: 'checkpoint'; tier: number }
  | { kind: 'done' };

export interface SetupWizardOpts {
  /** Presence of the saved key. */
  isSet: (key: RuntimeSecretKey) => boolean;
  onClose: () => void;
}

export class SetupWizard {
  private overlay: HTMLElement;
  private opts: SetupWizardOpts;
  private stopEvidence?: () => void;
  private opener = document.activeElement;
  private current: StepView = { kind: 'done' };

  constructor(host: HTMLElement, opts: SetupWizardOpts) {
    this.opts = opts;
    this.overlay = document.createElement('div');
    this.overlay.className = 'setup-wizard-overlay';
    host.append(this.overlay);
  }

  open(): void {
    const pos = getPosition() ?? { tier: 1, stepIndex: 0 };
    this.current = this.resolveStep(pos.tier, pos.stepIndex);
    this.render();
    window.addEventListener('keydown', this.onKey, true);
  }

  close(): void {
    this.stopEvidence?.();
    stopWatching();
    clearSkipped();
    window.removeEventListener('keydown', this.onKey, true);
    this.overlay.remove();
    this.opts.onClose();
    if (this.opener instanceof HTMLElement && this.opener.isConnected) this.opener.focus();
  }

  private onKey = (ev: KeyboardEvent): void => {
    if (ev.key !== 'Escape' && ev.key !== 'Tab') return;
    if (document.querySelector('.cmdk-v2-overlay:not([hidden])')) return;
    if (ev.key === 'Escape') {
      ev.preventDefault();
      ev.stopImmediatePropagation();
      if (confirm('Close the setup wizard? Your progress is saved.')) this.close();
      return;
    }
    const controls = this.overlay.querySelectorAll<HTMLElement>('a[href], input:not(:disabled), button:not(:disabled)');
    const edge = ev.shiftKey ? controls[0] : controls[controls.length - 1];
    if (edge?.isSameNode(document.activeElement) || !this.overlay.contains(document.activeElement)) {
      ev.preventDefault();
      (ev.shiftKey ? controls[controls.length - 1] : controls[0])?.focus();
    }
  };

  // Keys excluded from this wizard session: explicitly skipped, marked
  // don't-ask, already saved, or providers that require an interactive
  // OAuth/account-connect flow (no standalone paste possible).
  private isExcludedKey(key: RuntimeSecretKey, dontAsk: Set<RuntimeSecretKey>, skipped: Set<RuntimeSecretKey>): boolean {
    return dontAsk.has(key) || skipped.has(key) || OAUTH_CONNECT_KEYS.has(key) || this.opts.isSet(key);
  }

  private resolveStep(startTier: number, startIndex: number): StepView {
    const dontAsk = new Set(getDontAsk());
    const skipped = new Set(getSkipped());
    for (const cat of KEY_CATEGORIES) {
      if (cat.tier < startTier) continue;
      const wizardKeys = cat.keys.filter((k) => !this.isExcludedKey(k, dontAsk, skipped));
      if (wizardKeys.length === 0) {
        if (cat.tier === startTier) return { kind: 'checkpoint', tier: cat.tier };
        continue;
      }
      const startAt = cat.tier === startTier
        ? Math.max(0, Math.min(startIndex, wizardKeys.length - 1))
        : 0;
      const key = wizardKeys[startAt];
      if (!key) continue;
      return { kind: 'step', tier: cat.tier, stepIndex: startAt, key };
    }
    return { kind: 'done' };
  }

  private wizardKeysForTier(tier: number): RuntimeSecretKey[] {
    const dontAsk = new Set(getDontAsk());
    const skipped = new Set(getSkipped());
    const cat = KEY_CATEGORIES.find((c) => c.tier === tier);
    if (!cat) return [];
    return cat.keys.filter((k) => !this.isExcludedKey(k, dontAsk, skipped));
  }

  private render(): void {
    this.stopEvidence?.();
    this.stopEvidence = undefined;
    this.overlay.replaceChildren();
    const modal = document.createElement('div');
    modal.className = 'setup-wizard-modal';
    if (this.current.kind === 'step') this.renderStep(modal, this.current);
    else if (this.current.kind === 'checkpoint') this.renderCheckpoint(modal, this.current.tier);
    else this.renderDone(modal);
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-label', 'Credential setup');
    this.overlay.append(modal);
    modal.querySelector<HTMLElement>('.setup-wizard-input, button')?.focus();
  }

  private renderStep(modal: HTMLElement, step: { tier: number; stepIndex: number; key: RuntimeSecretKey }): void {
    const cat = KEY_CATEGORIES.find((c) => c.tier === step.tier)!;
    const total = this.wizardKeysForTier(step.tier).length;
    const tierLabel = document.createElement('div');
    tierLabel.className = 'setup-wizard-tier';
    tierLabel.textContent = 'Tier ' + step.tier + ' / 8 — ' + cat.label;
    const stepLabel = document.createElement('div');
    stepLabel.className = 'setup-wizard-step';
    stepLabel.textContent = 'Step ' + (step.stepIndex + 1) + ' of ' + total + ' — ' + (HUMAN_LABELS[step.key] ?? step.key);
    const desc = document.createElement('p');
    desc.className = 'setup-wizard-desc';
    desc.textContent = KEY_DESCRIPTIONS[step.key] ?? '';
    modal.append(tierLabel, stepLabel, desc);

    const setupSteps = KEY_SETUP_STEPS[step.key];
    if (setupSteps && setupSteps.length > 0) {
      const list = document.createElement('ol');
      list.className = 'setup-wizard-steps';
      for (const stepText of setupSteps) {
        const li = document.createElement('li');
        li.textContent = stepText;
        list.append(li);
      }
      modal.append(list);
    }

    const signup = SIGNUP_URLS[step.key];
    if (signup && /^https?:\/\//.test(signup)) {
      const a = document.createElement('a');
      a.className = 'setup-wizard-signup';
      a.href = signup;
      a.textContent = 'Open Signup ↗';
      a.addEventListener('click', (ev) => {
        ev.preventDefault();
        void (async () => {
          try { await invokeTauri('open_url', { url: signup }); }
          catch { window.open(signup, '_blank', 'noopener,noreferrer'); }
        })();
      });
      modal.append(a);
    }

    const input = document.createElement('input');
    input.type = 'password';
    input.className = 'setup-wizard-input';
    input.placeholder = 'Paste key here';
    input.setAttribute('aria-label', HUMAN_LABELS[step.key] ?? step.key);
    modal.append(input);

    const feedback = document.createElement('div');
    feedback.className = 'setup-wizard-feedback';
    feedback.setAttribute('role', 'status');
    modal.append(feedback);

    startWatching(step.key, (value) => {
      if (input.readOnly) return;
      input.value = value;
      feedback.textContent = 'Detected from clipboard — click Save & verify to use';
      feedback.dataset.kind = 'info';
    });

    const footer = document.createElement('div');
    footer.className = 'setup-wizard-footer';
    footer.append(
      this.button('← Back',           () => { this.advance(step, -1); }),
      this.button('Skip',             () => { addSkipped(step.key); this.advance(step, +1); }),
      this.button("Don't ask again",  () => { addDontAsk(step.key); this.advance(step, +1); }),
    );
    const save = this.button('Save & verify', () => {
      if (save.dataset.saved) this.advance(step, 0);
      else void this.handleSaveNext(step, input, feedback, save);
    }, 'primary');
    footer.append(save);
    modal.append(footer);
  }

  private renderCheckpoint(modal: HTMLElement, tier: number): void {
    stopWatching();
    const cat = KEY_CATEGORIES.find((c) => c.tier === tier)!;
    const total = cat.keys.length;
    const setCount = cat.keys.filter((k) => this.opts.isSet(k)).length;
    const skipped = getSkipped().filter((k) => cat.keys.includes(k)).length;
    const h = document.createElement('h2');
    h.textContent = 'Tier ' + tier + ' done';
    const summary = document.createElement('p');
    summary.textContent = '✓ ' + setCount + ' of ' + total + ' added · ' + skipped + ' skipped';
    const prompt = document.createElement('p');
    prompt.textContent = 'Continue to Tier ' + (tier + 1) + ', or stop here?';
    modal.append(h, summary, prompt);
    const footer = document.createElement('div');
    footer.className = 'setup-wizard-footer';
    footer.append(
      this.button('Finish for now', () => { this.close(); }),
      this.button('Continue →',     () => {
        const next = this.resolveStep(tier + 1, 0);
        this.current = next;
        if (next.kind === 'step') setPosition({ tier: next.tier, stepIndex: next.stepIndex });
        this.render();
      }, 'primary'),
    );
    modal.append(footer);
  }

  private renderDone(modal: HTMLElement): void {
    stopWatching();
    const h = document.createElement('h2');
    h.textContent = 'All set';
    const p = document.createElement('p');
    p.textContent = "You've configured every key the wizard knows about. Visit Settings → API Keys to add or rotate any of them.";
    modal.append(h, p);
    const footer = document.createElement('div');
    footer.className = 'setup-wizard-footer';
    footer.append(this.button('Done', () => { this.close(); }, 'primary'));
    modal.append(footer);
  }

  private button(label: string, handler: () => void, kind?: 'primary'): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    if (kind) b.className = kind;
    b.textContent = label;
    b.addEventListener('click', () => { handler(); });
    return b;
  }

  private async handleSaveNext(
    step: { tier: number; stepIndex: number; key: RuntimeSecretKey },
    input: HTMLInputElement,
    feedback: HTMLElement,
    save: HTMLButtonElement,
  ): Promise<void> {
    if (input.readOnly) return;
    const value = input.value.trim();
    const format = validateSecret(step.key, value);
    if (!format.valid) { this.setFeedback(feedback, format.hint ?? 'Invalid format', 'err'); return; }
    input.readOnly = true;
    save.setAttribute('aria-busy', 'true');
    markConsumed(value);
    this.setFeedback(feedback, 'Saving…', 'info');
    try {
      await setSecretValue(step.key, value);
    } catch {
      input.readOnly = false;
      save.removeAttribute('aria-busy');
      this.setFeedback(feedback, 'Save failed. Check vault access and try again.', 'err');
      return;
    }
    if (!this.overlay.isConnected || !this.overlay.contains(input)) return;
    input.value = '';
    this.setFeedback(feedback, 'Saved. Checking stored credential…', 'info');
    try {
      const result = await verifyStoredSecretWithApi(step.key);
      if (!this.overlay.contains(input) || !input.isConnected) return;
      const display = () => {
        const evidence = getCredentialEvidenceDisplay(step.key, this.opts.isSet(step.key));
        this.setFeedback(feedback, evidence.text, evidence.state === 'rejected' ? 'err' : 'info');
        feedback.title = evidence.title;
        feedback.setAttribute('aria-label', [evidence.text, evidence.title].filter(Boolean).join('. '));
        return evidence.state;
      };
      const state = display();
      if (state === 'unverified' || result.reason === 'cooldown' || result.reason === 'concurrency-limit') {
        feedback.append(' · This check: ' + result.message);
        feedback.removeAttribute('aria-label');
      }
      const timer = window.setInterval(() => { if (!document.hidden) display(); }, 60_000);
      document.addEventListener('visibilitychange', display);
      window.addEventListener('cb:credential-evidence-changed', display);
      this.stopEvidence = () => {
        window.clearInterval(timer);
        document.removeEventListener('visibilitychange', display);
        window.removeEventListener('cb:credential-evidence-changed', display);
      };
    } catch {
      this.setFeedback(feedback, 'Saved, not verified. Try again from API Keys.', 'info');
    }
    save.removeAttribute('aria-busy');
    save.dataset.saved = 'true';
    save.textContent = 'Next →';
  }

  private setFeedback(el: HTMLElement, message: string, kind: 'ok' | 'err' | 'info'): void {
    el.textContent = message;
    el.dataset.kind = kind;
  }

  private advance(step: { tier: number; stepIndex: number }, delta: number): void {
    const next = this.resolveStep(step.tier, step.stepIndex + delta);
    this.current = next;
    if (next.kind === 'step') setPosition({ tier: next.tier, stepIndex: next.stepIndex });
    this.render();
  }
}
