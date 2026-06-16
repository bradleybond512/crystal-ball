import { Panel } from './Panel';
import { KeyDashboard } from './KeyDashboard';
import { SetupWizard } from './SetupWizard';
import {
  RUNTIME_FEATURES,
  getEffectiveSecrets,
  getRuntimeConfigSnapshot,
  getSecretState,
  isFeatureAvailable,
  isFeatureEnabled,
  setFeatureToggle,
  setSecretValue,
  subscribeRuntimeConfig,
  validateSecret,
  verifySecretWithApi,
  type RuntimeFeatureDefinition,
  type RuntimeFeatureId,
  type RuntimeSecretKey,
} from '@/services/runtime-config';
import { invokeTauri } from '@/services/tauri-bridge';
import { escapeHtml } from '@/utils/sanitize';
import { isDesktopRuntime } from '@/services/runtime';
import { openExternalSafe } from '@/utils/safe-open';
import { t } from '@/services/i18n';
import { trackFeatureToggle } from '@/services/analytics';
import { PLAINTEXT_KEYS, MASKED_SENTINEL } from '@/services/settings-constants';
import { getRegistrationProfile, saveRegistrationProfile, clearRegistrationProfile } from '@/services/registration-profile';
import type { RegistrationProfile } from '@/services/registration-profile';
import {
  createVault as createWebVault,
  destroyVault as destroyWebVault,
  getVaultState as getWebVaultState,
  isSupported as isWebVaultSupported,
  isVaultUnlocked as isWebVaultUnlocked,
  lockVault as lockWebVault,
  onVaultChange as onWebVaultChange,
  unlockVault as unlockWebVault,
  validatePassphrase as validateWebPassphrase,
  type LockState as WebVaultLockState,
} from '@/services/web-secret-store';

function canEditWebSecrets(): boolean {
  return isDesktopRuntime() || isWebVaultUnlocked();
}

interface RuntimeConfigPanelOptions {
  mode?: 'full' | 'alert';
  buffered?: boolean;
  featureFilter?: RuntimeFeatureId[];
}

export class RuntimeConfigPanel extends Panel {
  private unsubscribe: (() => void) | null = null;
  private unsubscribeVault: (() => void) | null = null;
  private readonly mode: 'full' | 'alert';
  private readonly buffered: boolean;
  private readonly featureFilter?: RuntimeFeatureId[];
  private pendingSecrets = new Map<RuntimeSecretKey, string>();
  private validatedKeys = new Map<RuntimeSecretKey, boolean>();
  private validationMessages = new Map<RuntimeSecretKey, string>();
  private webVaultState: WebVaultLockState = isWebVaultUnlocked() ? 'unlocked' : 'missing';
  private webVaultMessage: { kind: 'info' | 'error'; text: string } | null = null;

  constructor(options: RuntimeConfigPanelOptions = {}) {
 super({ id: 'runtime-config', title: t('modals.runtimeConfig.title'), showCount: false });
 this.mode = options.mode ?? (isDesktopRuntime() ? 'alert' : 'full');
 this.buffered = options.buffered ?? false;
 this.featureFilter = options.featureFilter;
 this.unsubscribe = subscribeRuntimeConfig(() => this.render());
 if (!isDesktopRuntime()) {
 this.unsubscribeVault = onWebVaultChange(() => {
 if (isWebVaultUnlocked()) {
 this.webVaultState = 'unlocked';
 } else if (this.webVaultState === 'unlocked') {
 this.webVaultState = 'locked';
 }
 this.render();
 });
 // Fire-and-forget initial probe so a newly-mounted panel reflects the
 // persisted vault state (locked vs missing) once IDB responds.
 // eslint-disable-next-line sonarjs/no-async-constructor
 void this.refreshWebVaultState();
 }
 this.render();
  }

  private async refreshWebVaultState(): Promise<void> {
 if (isDesktopRuntime()) return;
 try {
 this.webVaultState = await getWebVaultState();
 } catch {
 this.webVaultState = 'missing';
 }
 this.render();
  }

  public async commitPendingSecrets(): Promise<void> {
 for (const [key, value] of this.pendingSecrets) {
 await setSecretValue(key, value);
 }
 this.pendingSecrets.clear();
 this.validatedKeys.clear();
 this.validationMessages.clear();
  }

  public async commitVerifiedSecrets(): Promise<void> {
 for (const [key, value] of this.pendingSecrets) {
 if (this.validatedKeys.get(key) !== false) {
 await setSecretValue(key, value);
 this.pendingSecrets.delete(key);
 this.validatedKeys.delete(key);
 this.validationMessages.delete(key);
 }
 }
  }

  public hasPendingChanges(): boolean {
 return this.pendingSecrets.size > 0;
  }

  private getFilteredFeatures(): RuntimeFeatureDefinition[] {
 return this.featureFilter
 ? RUNTIME_FEATURES.filter(f => this.featureFilter!.includes(f.id))
 : RUNTIME_FEATURES;
  }

  /** Returns missing required secrets for enabled features that have at least one pending key. */
  public getMissingRequiredSecrets(): string[] {
 const missing: string[] = [];
 for (const feature of this.getFilteredFeatures()) {
 if (!isFeatureEnabled(feature.id)) continue;
 const secrets = getEffectiveSecrets(feature);
 const hasPending = secrets.some(k => this.pendingSecrets.has(k));
 if (!hasPending) continue;
 for (const key of secrets) {
 if (!getSecretState(key).valid && !this.pendingSecrets.has(key)) {
 missing.push(key);
 }
 }
 }
 return missing;
  }

  public getValidationErrors(): string[] {
 const errors: string[] = [];
 for (const [key, value] of this.pendingSecrets) {
 const result = validateSecret(key, value);
 if (!result.valid) errors.push(`${key}: ${result.hint ?? 'Invalid format'}`);
 }
 return errors;
  }

  public async verifyPendingSecrets(): Promise<string[]> {
 this.captureUnsavedInputs();
 const errors: string[] = [];
 const context = Object.fromEntries(this.pendingSecrets.entries()) as Partial<Record<RuntimeSecretKey, string>>;

 // Split into local-only failures vs keys needing remote verification
 const toVerifyRemotely: [RuntimeSecretKey, string][] = [];
 for (const [key, value] of this.pendingSecrets) {
 const localResult = validateSecret(key, value);
 if (localResult.valid) {
 toVerifyRemotely.push([key, value]);
 } else {
 this.validatedKeys.set(key, false);
 this.validationMessages.set(key, localResult.hint ?? 'Invalid format');
 errors.push(`${key}: ${localResult.hint ?? 'Invalid format'}`);
 }
 }

 // Run all remote verifications in parallel with a 15s global timeout
 if (toVerifyRemotely.length > 0) {
 const results = await Promise.race([
 Promise.all(toVerifyRemotely.map(async ([key, value]) => {
 const result = await verifySecretWithApi(key, value, context);
 return { key, result };
 })),
 new Promise<{ key: RuntimeSecretKey; result: { valid: boolean; message?: string } }[]>(resolve =>
 setTimeout(() => resolve(toVerifyRemotely.map(([key]) => ({
 key, result: { valid: true, message: 'Saved (verification timed out)' },
 }))), 15_000)
 ),
 ]);
 for (const { key, result: verifyResult } of results) {
 this.validatedKeys.set(key, verifyResult.valid);
 if (verifyResult.valid) {
 this.validationMessages.delete(key);
 } else {
 this.validationMessages.set(key, verifyResult.message ?? 'Verification failed');
 errors.push(`${key}: ${verifyResult.message ?? 'Verification failed'}`);
 }
 }
 }

 if (this.pendingSecrets.size > 0) {
 this.render();
 }

 return errors;
  }

  public destroy(): void {
 this.unsubscribe?.();
 this.unsubscribe = null;
 this.unsubscribeVault?.();
 this.unsubscribeVault = null;
 this.pendingSecrets.clear();
  }

  private captureUnsavedInputs(): void {
 if (!this.buffered) return;
 this.content.querySelectorAll<HTMLInputElement>('input[data-secret]').forEach((input) => {
 const key = input.dataset.secret as RuntimeSecretKey | undefined;
 if (!key) return;
 const raw = input.value.trim();
 if (!raw || raw === MASKED_SENTINEL) return;
 // Skip plaintext keys whose value hasn't changed from stored value
 if (PLAINTEXT_KEYS.has(key) && !this.pendingSecrets.has(key)) {
 const stored = getRuntimeConfigSnapshot().secrets[key]?.value ?? '';
 if (raw === stored) return;
 }
 this.pendingSecrets.set(key, raw);
 const result = validateSecret(key, raw);
 if (!result.valid) {
 this.validatedKeys.set(key, false);
 this.validationMessages.set(key, result.hint ?? 'Invalid format');
 }
 });
 // Capture model from select or manual input
 const modelSelect = this.content.querySelector<HTMLSelectElement>('select[data-model-select]');
 const modelManual = this.content.querySelector<HTMLInputElement>('input[data-model-manual]');
 const modelValue = (modelManual && !modelManual.classList.contains('hidden-input') ? modelManual.value.trim() : modelSelect?.value) ?? '';
 if (modelValue && !this.pendingSecrets.has('OLLAMA_MODEL')) {
 this.pendingSecrets.set('OLLAMA_MODEL', modelValue);
 this.validatedKeys.set('OLLAMA_MODEL', true);
 }
  }

  // eslint-disable-next-line sonarjs/cognitive-complexity -- dispatches alert/full modes with many small branches; splitting would obscure the flow
  protected render(): void {
 this.captureUnsavedInputs();
 const snapshot = getRuntimeConfigSnapshot();
 const desktop = isDesktopRuntime();

 const features = this.getFilteredFeatures();

 if (desktop && this.mode === 'alert') {
 const totalFeatures = RUNTIME_FEATURES.length;
 const availableFeatures = RUNTIME_FEATURES.filter((feature) => isFeatureAvailable(feature.id)).length;
 const missingFeatures = Math.max(0, totalFeatures - availableFeatures);
 const configuredCount = Object.keys(snapshot.secrets).length;

 if (missingFeatures === 0 && configuredCount >= totalFeatures) {
 this.hide();
 return;
 }

 let alertTitle: string;
 if (configuredCount === 0) {
 alertTitle = t('modals.runtimeConfig.alertTitle.needsKeys');
 } else if (missingFeatures > 0) {
 alertTitle = t('modals.runtimeConfig.alertTitle.some');
 } else {
 alertTitle = t('modals.runtimeConfig.alertTitle.configured');
 }
 const alertClass = missingFeatures > 0 ? 'warn' : 'ok';

 this.show();
 this.content.innerHTML = `
 <section class="runtime-alert runtime-alert-${alertClass}">
 <h3>${alertTitle}</h3>
 <p>
 ${availableFeatures}/${totalFeatures} ${t('modals.runtimeConfig.summary.available')}${configuredCount > 0 ? ` · ${configuredCount} ${t('modals.runtimeConfig.summary.secrets')}` : ''}.
 </p>
 <p class="runtime-alert-skip">${t('modals.runtimeConfig.skipSetup')}</p>
 <button type="button" class="runtime-open-settings-btn" data-open-settings>
 ${t('modals.runtimeConfig.openSettings')}
 </button>
 </section>
 `;
 this.attachListeners();
 return;
 }

 this.content.innerHTML = `
 ${this.renderProfileSection()}
 ${desktop ? '' : this.renderWebVaultBanner()}
 <div class="runtime-config-summary">
 ${desktop ? t('modals.runtimeConfig.summary.desktop') : t('modals.runtimeConfig.summary.web')} · ${features.filter(f => isFeatureAvailable(f.id)).length}/${features.length} ${t('modals.runtimeConfig.summary.available')}
 </div>
 <div class="runtime-config-list" data-key-dashboard-mount></div>
 `;

 const dashboardMount = this.content.querySelector<HTMLElement>('[data-key-dashboard-mount]');
 if (dashboardMount) this.mountDashboard(dashboardMount);

 this.attachListeners();
 this.attachProfileListeners();
 if (!desktop) this.attachWebVaultListeners();
  }

  private mountDashboard(container: HTMLElement): void {
 const dashboard = new KeyDashboard(container, {
 getValue: (key) => this.pendingSecrets.get(key) ?? getRuntimeConfigSnapshot().secrets[key]?.value,
 onRunWizard: () => this.openWizard(),
 });
 dashboard.render();
  }

  private openWizard(): void {
 const wizard = new SetupWizard(document.body, {
 getValue: (key) => this.pendingSecrets.get(key) ?? getRuntimeConfigSnapshot().secrets[key]?.value,
 onClose: () => this.render(),
 });
 wizard.open();
  }

  private renderWebVaultBanner(): string {
 if (!isWebVaultSupported()) {
 return `
 <div class="web-vault-banner web-vault-banner-error">
 <strong>Key vault unavailable</strong>
 <p>This browser does not support Web Crypto or IndexedDB, so API keys cannot be persisted locally.</p>
 </div>
 `;
 }

 const state = this.webVaultState;
 const msg = this.webVaultMessage
 ? `<p class="web-vault-message web-vault-message-${this.webVaultMessage.kind}">${escapeHtml(this.webVaultMessage.text)}</p>`
 : '';

 if (state === 'unlocked') {
 return `
 <div class="web-vault-banner web-vault-banner-ok">
 <div class="web-vault-banner-row">
 <span class="web-vault-banner-title">Key vault unlocked for this session</span>
 <button type="button" data-vault-lock class="web-vault-btn">Lock vault</button>
 <button type="button" data-vault-destroy class="web-vault-btn web-vault-btn-danger">Destroy vault</button>
 </div>
 <p class="web-vault-banner-hint">Keys are encrypted with your passphrase (AES-GCM-256 / PBKDF2-SHA-256, 600k iters) and stored only in this browser. They never leave your device.</p>
 ${msg}
 </div>
 `;
 }

 if (state === 'locked') {
 return `
 <div class="web-vault-banner web-vault-banner-locked">
 <div class="web-vault-banner-row">
 <span class="web-vault-banner-title">Key vault is locked</span>
 </div>
 <form data-vault-unlock-form class="web-vault-form">
 <input type="password" data-vault-passphrase placeholder="Vault passphrase" autocomplete="current-password" class="web-vault-input">
 <button type="submit" class="web-vault-btn web-vault-btn-primary">Unlock</button>
 <button type="button" data-vault-destroy class="web-vault-btn web-vault-btn-danger">Forget vault</button>
 </form>
 <p class="web-vault-banner-hint">Enter the passphrase you set when creating the vault. There is no recovery — lost passphrases require destroying the vault and re-entering keys.</p>
 ${msg}
 </div>
 `;
 }

 // missing
 return `
 <div class="web-vault-banner web-vault-banner-create">
 <div class="web-vault-banner-row">
 <span class="web-vault-banner-title">Create a key vault to keep your API keys between sessions</span>
 </div>
 <form data-vault-create-form class="web-vault-form">
 <input type="password" data-vault-passphrase placeholder="Choose a passphrase (12+ characters)" autocomplete="new-password" class="web-vault-input">
 <input type="password" data-vault-passphrase-confirm placeholder="Confirm passphrase" autocomplete="new-password" class="web-vault-input">
 <button type="submit" class="web-vault-btn web-vault-btn-primary" data-vault-create-submit disabled>Create vault</button>
 </form>
 <p class="web-vault-match-hint" data-vault-match-hint></p>
 <p class="web-vault-banner-hint">The passphrase never leaves this browser. Keys are encrypted locally with AES-GCM-256 derived from your passphrase via PBKDF2-SHA-256 (600,000 iterations). If you forget the passphrase the keys cannot be recovered.</p>
 ${msg}
 </div>
 `;
  }

  private setWebVaultMessage(kind: 'info' | 'error', text: string): void {
 this.webVaultMessage = { kind, text };
 this.render();
  }

  private attachWebVaultListeners(): void {
 const unlockForm = this.content.querySelector<HTMLFormElement>('[data-vault-unlock-form]');
 unlockForm?.addEventListener('submit', (event) => {
 event.preventDefault();
 const input = unlockForm.querySelector<HTMLInputElement>('[data-vault-passphrase]');
 const passphrase = input?.value ?? '';
 if (!passphrase) return;
 void (async () => {
 const ok = await unlockWebVault(passphrase);
 if (ok) {
 this.webVaultMessage = null;
 await this.refreshWebVaultState();
 } else {
 this.setWebVaultMessage('error', 'Incorrect passphrase. Try again.');
 }
 })();
 });

 const createForm = this.content.querySelector<HTMLFormElement>('[data-vault-create-form]');
 if (createForm) {
 const passInput = createForm.querySelector<HTMLInputElement>('[data-vault-passphrase]');
 const confirmInput = createForm.querySelector<HTMLInputElement>('[data-vault-passphrase-confirm]');
 const submitBtn = createForm.querySelector<HTMLButtonElement>('[data-vault-create-submit]');
 const hintEl = this.content.querySelector<HTMLElement>('[data-vault-match-hint]');

 // Live status as the user types: shows length progress, mismatch
 // warning, and the green-light state when ready. Disables Submit
 // until everything is satisfied so a stray autocomplete-driven
 // mismatch can't produce a "passphrases do not match" toast.
 const updateStatus = (): void => {
 if (!passInput || !confirmInput || !submitBtn || !hintEl) return;
 const pass = passInput.value;
 const confirm = confirmInput.value;
 const check = validateWebPassphrase(pass);
 let text = '';
 let cls = 'web-vault-match-hint';
 if (pass && !check.valid) {
 text = check.hint ?? `Use at least 12 characters (${pass.length} so far).`;
 cls += ' web-vault-match-hint--warn';
 } else if (pass && check.valid && confirm.length === 0) {
 text = 'Passphrase OK — re-enter to confirm.';
 cls += ' web-vault-match-hint--info';
 } else if (pass && confirm.length > 0 && pass === confirm) {
 text = '✓ Passphrases match.';
 cls += ' web-vault-match-hint--ok';
 } else if (pass && confirm.length > 0) {
 text = 'Passphrases don\'t match yet.';
 cls += ' web-vault-match-hint--warn';
 }
 hintEl.textContent = text;
 hintEl.className = cls;
 submitBtn.disabled = !(check.valid && pass === confirm && pass.length > 0);
 };
 passInput?.addEventListener('input', updateStatus);
 confirmInput?.addEventListener('input', updateStatus);
 // Run once on mount in case the browser autofilled before listeners attached.
 updateStatus();

 createForm.addEventListener('submit', (event) => {
 event.preventDefault();
 // Trimmed comparison defends against trailing-whitespace pastes
 // from password managers — but we still encrypt with the raw value
 // the user typed so a leading/trailing space they meant to include
 // is preserved.
 const pass = passInput?.value ?? '';
 const confirm = confirmInput?.value ?? '';
 if (pass.trim() !== confirm.trim() || pass !== confirm) {
 this.setWebVaultMessage('error', 'Passphrases do not match.');
 return;
 }
 const check = validateWebPassphrase(pass);
 if (!check.valid) { this.setWebVaultMessage('error', check.hint ?? 'Passphrase too weak'); return; }
 void (async () => {
 try {
 await createWebVault(pass);
 this.webVaultMessage = null;
 await this.refreshWebVaultState();
 } catch (error) {
 this.setWebVaultMessage('error', error instanceof Error ? error.message : 'Could not create vault');
 }
 })();
 });
 }

 this.content.querySelector<HTMLButtonElement>('[data-vault-lock]')?.addEventListener('click', () => {
 lockWebVault();
 this.webVaultMessage = { kind: 'info', text: 'Vault locked. Enter your passphrase to unlock it.' };
 void this.refreshWebVaultState();
 });

 this.content.querySelector<HTMLButtonElement>('[data-vault-destroy]')?.addEventListener('click', () => {
 const confirmed = typeof window === 'undefined'
 ? false
 : window.confirm('Destroy the key vault? All stored API keys will be permanently deleted.');
 if (!confirmed) return;
 void (async () => {
 await destroyWebVault();
 this.webVaultMessage = { kind: 'info', text: 'Vault destroyed. Create a new one to save keys again.' };
 await this.refreshWebVaultState();
 })();
 });
  }

  private renderProfileSection(): string {
 const profile = getRegistrationProfile();
 if (profile) {
 return `
 <details class="reg-profile-section">
 <summary class="reg-profile-summary">
 Saved as: ${escapeHtml(profile.firstName)} ${escapeHtml(profile.lastName)} (${escapeHtml(profile.email)})
 <span class="reg-profile-edit-hint">— click to edit</span>
 </summary>
 <div class="reg-profile-form">
 <input type="text" class="reg-profile-input" data-reg-field="firstName" placeholder="First name" value="${escapeHtml(profile.firstName)}">
 <input type="text" class="reg-profile-input" data-reg-field="lastName" placeholder="Last name" value="${escapeHtml(profile.lastName)}">
 <input type="email" class="reg-profile-input" data-reg-field="email" placeholder="Email" value="${escapeHtml(profile.email)}">
 <input type="text" class="reg-profile-input" data-reg-field="organization" placeholder="Organization (optional)" value="${escapeHtml(profile.organization)}">
 <div class="reg-profile-actions">
 <button type="button" class="reg-profile-save-btn" data-reg-save>Save Profile</button>
 <button type="button" class="reg-profile-save-btn" data-reg-copy>Copy Email</button>
 <button type="button" class="reg-profile-clear-btn" data-reg-clear>Clear</button>
 </div>
 <span class="reg-profile-status"></span>
 <p class="reg-profile-explainer">Cross-origin browsers block auto-fill into provider signup pages. We open the provider's tab and copy your email to your clipboard so you can paste it in seconds.</p>
 </div>
 </details>
 `;
 }
 return `
 <details class="reg-profile-section">
 <summary class="reg-profile-summary">
 Save your info once for faster API key signups
 <span class="reg-profile-edit-hint">— click to set up</span>
 </summary>
 <div class="reg-profile-form">
 <input type="text" class="reg-profile-input" data-reg-field="firstName" placeholder="First name" value="">
 <input type="text" class="reg-profile-input" data-reg-field="lastName" placeholder="Last name" value="">
 <input type="email" class="reg-profile-input" data-reg-field="email" placeholder="Email" value="">
 <input type="text" class="reg-profile-input" data-reg-field="organization" placeholder="Organization (optional)" value="">
 <div class="reg-profile-actions">
 <button type="button" class="reg-profile-save-btn" data-reg-save>Save Profile</button>
 </div>
 <span class="reg-profile-status"></span>
 </div>
 </details>
 `;
  }

  private readRegField(field: string): string {
 return this.content.querySelector<HTMLInputElement>(`[data-reg-field="${field}"]`)?.value.trim() ?? '';
  }

  private attachProfileListeners(): void {
 const saveBtn = this.content.querySelector<HTMLButtonElement>('[data-reg-save]');
 const clearBtn = this.content.querySelector<HTMLButtonElement>('[data-reg-clear]');
 const copyBtn = this.content.querySelector<HTMLButtonElement>('[data-reg-copy]');
 const statusEl = this.content.querySelector<HTMLSpanElement>('.reg-profile-status');

 saveBtn?.addEventListener('click', () => {
 const profile: RegistrationProfile = {
 firstName: this.readRegField('firstName'),
 lastName: this.readRegField('lastName'),
 email: this.readRegField('email'),
 organization: this.readRegField('organization'),
 };
 if (!profile.email) {
 if (statusEl) statusEl.textContent = 'Email required';
 return;
 }
 saveRegistrationProfile(profile);
 if (statusEl) statusEl.textContent = 'Profile saved';
 this.render();
 });

 copyBtn?.addEventListener('click', () => {
 const profile = getRegistrationProfile();
 if (!profile?.email) {
 if (statusEl) statusEl.textContent = 'No email to copy';
 return;
 }
 void navigator.clipboard?.writeText(profile.email).then(() => {
 if (statusEl) statusEl.textContent = `Copied ${profile.email} to clipboard`;
 }).catch(() => {
 if (statusEl) statusEl.textContent = 'Clipboard write failed';
 });
 });

 clearBtn?.addEventListener('click', () => {
 clearRegistrationProfile();
 this.render();
 });
  }

  private attachListeners(): void {
 this.content.querySelectorAll<HTMLAnchorElement>('a[data-signup-url]').forEach((link) => {
 link.addEventListener('click', (e) => {
 e.preventDefault();
 const url = link.dataset.signupUrl;
 if (!url) return;
 // Best-effort: copy the saved registration email to the clipboard
 // before opening the provider tab. Cross-origin browsers won't let
 // us autofill the form, but a one-keystroke paste is the closest
 // thing to "auto-register" we can deliver in a web build.
 const profile = getRegistrationProfile();
 if (profile?.email) {
 void navigator.clipboard?.writeText(profile.email).catch(() => { /* no clipboard; ignore */ });
 }
 openExternalSafe(url);
 });
 });

 if (!canEditWebSecrets()) return;

 // Save buttons (signup card + regular row)
 this.content.querySelectorAll<HTMLButtonElement>('button[data-save-secret]').forEach((btn) => {
 btn.addEventListener('click', () => {
 const key = btn.dataset.saveSecret as RuntimeSecretKey | undefined;
 if (!key) return;
 // Try signup card row first, then regular input wrapper
 const container = btn.closest('.runtime-signup-card-input-row') ?? btn.closest('.runtime-input-with-save');
 const input = container?.querySelector<HTMLInputElement>('input[data-secret]');
 if (!input) return;
 const raw = input.value.trim();
 if (!raw || raw === MASKED_SENTINEL) return;
 void setSecretValue(key, raw);
 });
 });

 if (this.mode === 'alert') {
 this.content.querySelector<HTMLButtonElement>('[data-open-settings]')?.addEventListener('click', () => {
 void invokeTauri<void>('open_settings_window_command').catch((error) => {
 // eslint-disable-next-line no-console -- user action failure diagnostics
 console.warn('[runtime-config] Failed to open settings window', error);
 });
 });
 return;
 }

 // Ollama model dropdown: fetch models and handle selection
 const modelSelect = this.content.querySelector<HTMLSelectElement>('select[data-model-select]');
 if (modelSelect) {
 modelSelect.addEventListener('change', () => {
 const model = modelSelect.value;
 if (model && this.buffered) {
 this.pendingSecrets.set('OLLAMA_MODEL', model);
 this.validatedKeys.set('OLLAMA_MODEL', true);
 modelSelect.classList.remove('invalid');
 modelSelect.classList.add('valid-staged');
 this.updateFeatureCardStatus('OLLAMA_MODEL');
 }
 });
 void this.fetchOllamaModels(modelSelect);
 }

 this.content.querySelectorAll<HTMLInputElement>('input[data-toggle]').forEach((input) => {
 input.addEventListener('change', () => {
 const featureId = input.dataset.toggle as RuntimeFeatureDefinition['id'] | undefined;
 if (!featureId) return;
 trackFeatureToggle(featureId, input.checked);
 setFeatureToggle(featureId, input.checked);
 });
 });

 this.content.querySelectorAll<HTMLInputElement>('input[data-secret]').forEach((input) => {
 input.addEventListener('input', () => {
 const key = input.dataset.secret as RuntimeSecretKey | undefined;
 if (!key) return;
 if (this.buffered && this.pendingSecrets.has(key) && input.value.startsWith(MASKED_SENTINEL)) {
 input.value = input.value.slice(MASKED_SENTINEL.length);
 }
 this.validatedKeys.delete(key);
 this.validationMessages.delete(key);
 const check = input.closest('.runtime-secret-row')?.querySelector('.runtime-secret-check');
 check?.classList.remove('visible');
 input.classList.remove('valid-staged', 'invalid');
 const hint = input.closest('.runtime-secret-row')?.querySelector('.runtime-secret-hint');
 if (hint) hint.remove();
 });

 // eslint-disable-next-line sonarjs/cognitive-complexity -- blur handler coordinates staging, validation, masking, and feature-card updates
 input.addEventListener('blur', () => {
 const key = input.dataset.secret as RuntimeSecretKey | undefined;
 if (!key) return;
 const raw = input.value.trim();
 if (!raw) {
 if (this.buffered && this.pendingSecrets.has(key)) {
 this.pendingSecrets.delete(key);
 this.validatedKeys.delete(key);
 this.validationMessages.delete(key);
 this.render();
 }
 return;
 }
 if (raw === MASKED_SENTINEL) return;
 if (this.buffered) {
 this.pendingSecrets.set(key, raw);
 const result = validateSecret(key, raw);
 if (result.valid) {
 this.validatedKeys.delete(key);
 this.validationMessages.delete(key);
 } else {
 this.validatedKeys.set(key, false);
 this.validationMessages.set(key, result.hint ?? 'Invalid format');
 }
 if (PLAINTEXT_KEYS.has(key)) {
 input.value = raw;
 } else {
 input.type = 'password';
 input.value = MASKED_SENTINEL;
 }
 input.placeholder = t('modals.runtimeConfig.placeholder.staged');
 const row = input.closest('.runtime-secret-row');
 const check = row?.querySelector('.runtime-secret-check');
 input.classList.remove('valid-staged', 'invalid');
 if (result.valid) {
 check?.classList.remove('visible');
 input.classList.add('valid-staged');
 } else {
 check?.classList.remove('visible');
 input.classList.add('invalid');
 const existingHint = row?.querySelector('.runtime-secret-hint');
 if (existingHint) existingHint.remove();
 if (result.hint) {
 const hint = document.createElement('span');
 hint.className = 'runtime-secret-hint';
 hint.textContent = result.hint;
 row?.append(hint);
 }
 }
 this.updateFeatureCardStatus(key);

 // Update inline status text to reflect staged state
 const statusEl = input.closest('.runtime-secret-row')?.querySelector('.runtime-secret-status');
 if (statusEl) {
 statusEl.textContent = result.valid ? t('modals.runtimeConfig.status.staged') : t('modals.runtimeConfig.status.invalid');
 statusEl.className = `runtime-secret-status ${result.valid ? 'staged' : 'warn'}`;
 }

 // When Ollama URL is staged, auto-fetch available models
 if (key === 'OLLAMA_API_URL' && result.valid) {
 const modelSelect = this.content.querySelector<HTMLSelectElement>('select[data-model-select]');
 if (modelSelect) void this.fetchOllamaModels(modelSelect);
 }
 } else {
 void setSecretValue(key, raw);
 input.value = '';
 }
 });
 });
  }

  private updateFeatureCardStatus(secretKey: RuntimeSecretKey): void {
 const feature = RUNTIME_FEATURES.find(f => getEffectiveSecrets(f).includes(secretKey));
 if (!feature) return;
 const section = [...this.content.querySelectorAll('.runtime-feature')].find(el => {
 const toggle = el.querySelector<HTMLInputElement>(`input[data-toggle="${feature.id}"]`);
 return !!toggle;
 });
 if (!section) return;
 const available = isFeatureAvailable(feature.id);
 const effectiveSecrets = getEffectiveSecrets(feature);
 const allStaged = !available && effectiveSecrets.every(
 (k) => getSecretState(k).valid || (this.pendingSecrets.has(k) && this.validatedKeys.get(k) !== false)
 );
 let sectionVariant: string;
 let pillVariant: string;
 let pillText: string;
 if (available) {
 sectionVariant = 'available';
 pillVariant = 'ok';
 pillText = t('modals.runtimeConfig.status.ready');
 } else if (allStaged) {
 sectionVariant = 'staged';
 pillVariant = 'staged';
 pillText = t('modals.runtimeConfig.status.staged');
 } else {
 sectionVariant = 'degraded';
 pillVariant = 'warn';
 pillText = t('modals.runtimeConfig.status.needsKeys');
 }
 section.className = `runtime-feature ${sectionVariant}`;
 const pill = section.querySelector('.runtime-pill');
 if (pill) {
 pill.className = `runtime-pill ${pillVariant}`;
 pill.textContent = pillText;
 }
 const fallback = section.querySelector('.runtime-feature-fallback');
 if (available || allStaged) {
 fallback?.remove();
 }
  }

  private static makeTimeout(ms: number): AbortSignal {
 if (typeof AbortSignal.timeout === 'function') return AbortSignal.timeout(ms);
 const ctrl = new AbortController();
 setTimeout(() => ctrl.abort(), ms);
 return ctrl.signal;
  }

  private showManualModelInput(select: HTMLSelectElement): void {
 const manual = select.parentElement?.querySelector<HTMLInputElement>('input[data-model-manual]');
 if (!manual) return;
 select.style.display = 'none';
 manual.classList.remove('hidden-input');
 manual.addEventListener('blur', () => {
 const model = manual.value.trim();
 if (model && this.buffered) {
 this.pendingSecrets.set('OLLAMA_MODEL', model);
 this.validatedKeys.set('OLLAMA_MODEL', true);
 manual.classList.remove('invalid');
 manual.classList.add('valid-staged');
 this.updateFeatureCardStatus('OLLAMA_MODEL');
 }
 });
  }

  private async fetchOllamaModels(select: HTMLSelectElement): Promise<void> {
 const snapshot = getRuntimeConfigSnapshot();
 const ollamaUrl = this.pendingSecrets.get('OLLAMA_API_URL')
 ?? snapshot.secrets.OLLAMA_API_URL?.value
 ?? '';
 if (!ollamaUrl) {
 select.innerHTML = '<option value="" disabled selected>Set Ollama URL first</option>';
 return;
 }

 const currentModel = this.pendingSecrets.get('OLLAMA_MODEL')
 ?? snapshot.secrets.OLLAMA_MODEL?.value
 ?? '';

 try {
 // Try Ollama-native /api/tags first, fall back to OpenAI-compatible /v1/models
 let models: string[] = [];
 try {
 const res = await fetch(new URL('/api/tags', ollamaUrl).toString(), {
 signal: RuntimeConfigPanel.makeTimeout(5000),
 });
 if (res.ok) {
 const data = await res.json() as { models?: { name: string }[] };
 if (data && Array.isArray(data.models)) {
 models = data.models.map(m => m.name).filter(n => !n.includes('embed'));
 }
 }
 } catch { /* Ollama endpoint not available, try OpenAI format */ }

 if (models.length === 0) {
 try {
 const res = await fetch(new URL('/v1/models', ollamaUrl).toString(), {
 signal: RuntimeConfigPanel.makeTimeout(5000),
 });
 if (res.ok) {
 const data = await res.json() as { data?: { id: string }[] };
 if (data && Array.isArray(data.data)) {
 models = data.data.map(m => m.id).filter(n => !n.includes('embed'));
 }
 }
 } catch { /* OpenAI endpoint also unavailable */ }
 }

 if (models.length === 0) {
 // No models discovered — show manual text input as fallback
 this.showManualModelInput(select);
 return;
 }

 select.innerHTML = models.map(name =>
 `<option value="${escapeHtml(name)}" ${name === currentModel ? 'selected' : ''}>${escapeHtml(name)}</option>`
 ).join('');

 // Auto-select first model if none stored
 if (!currentModel && models.length > 0) {
 const first = models[0]!;
 select.value = first;
 if (this.buffered) {
 this.pendingSecrets.set('OLLAMA_MODEL', first);
 this.validatedKeys.set('OLLAMA_MODEL', true);
 select.classList.add('valid-staged');
 this.updateFeatureCardStatus('OLLAMA_MODEL');
 }
 }
 } catch {
 // Complete failure — fall back to manual input
 this.showManualModelInput(select);
 }
  }
}
