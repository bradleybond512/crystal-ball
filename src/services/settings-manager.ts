import {
  RUNTIME_FEATURES,
  getEffectiveSecrets,
  getRuntimeConfigSnapshot,
  getSecretState,
  isFeatureEnabled,
  setSecretValue,
  validateSecret,
  verifySecretWithApi,
  type RuntimeSecretKey,
} from './runtime-config';
import { PLAINTEXT_KEYS, MASKED_SENTINEL } from './settings-constants';

const companions: Partial<Record<RuntimeSecretKey, RuntimeSecretKey>> = {
  OPENSKY_CLIENT_ID: 'OPENSKY_CLIENT_SECRET',
  OPENSKY_CLIENT_SECRET: 'OPENSKY_CLIENT_ID',
};

export class SettingsManager {
  private pendingSecrets = new Map<RuntimeSecretKey, string>();
  private validatedKeys = new Map<RuntimeSecretKey, boolean>();
  private validationMessages = new Map<RuntimeSecretKey, string>();

  private revision = 0;
  private approvedRevision = -1;

  captureUnsavedInputs(container: HTMLElement): void {
 container.querySelectorAll<HTMLInputElement>('input[data-secret]').forEach((input) => {
 const key = input.dataset.secret as RuntimeSecretKey | undefined;
 if (!key) return;
 const raw = input.value.trim();
 if (!raw || raw === MASKED_SENTINEL) return;
 if (PLAINTEXT_KEYS.has(key) && !this.pendingSecrets.has(key)) {
 const stored = getRuntimeConfigSnapshot().secrets[key]?.value ?? '';
 if (raw === stored) return;
 }
 this.setPending(key, raw);
 const result = validateSecret(key, raw);
 if (!result.valid) {
 this.validatedKeys.set(key, false);
 this.validationMessages.set(key, result.hint ?? 'Invalid format');
 }
 });
 const modelSelect = container.querySelector<HTMLSelectElement>('select[data-model-select]');
 const modelManual = container.querySelector<HTMLInputElement>('input[data-model-manual]');
 const modelValue = (modelManual && !modelManual.classList.contains('hidden-input') ? modelManual.value.trim() : modelSelect?.value) ?? '';
 if (modelValue && modelValue !== getRuntimeConfigSnapshot().secrets.OLLAMA_MODEL?.value && !this.pendingSecrets.has('OLLAMA_MODEL')) {
 this.setPending('OLLAMA_MODEL', modelValue);
 this.validatedKeys.set('OLLAMA_MODEL', true);
 }
  }

  hasPendingChanges(): boolean {
 return this.pendingSecrets.size > 0;
  }

  getMissingRequiredSecrets(features = RUNTIME_FEATURES): string[] {
 const missing: string[] = [];
 for (const feature of features) {
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

  getValidationErrors(): string[] {
 const errors: string[] = [];
 for (const [key, value] of this.pendingSecrets) {
 const result = validateSecret(key, value);
 if (!result.valid) errors.push(`${key}: ${result.hint ?? 'Invalid format'}`);
 }
 return errors;
  }

  async verifyPendingSecrets(): Promise<string[]> {
    const revision = this.revision;
    this.approvedRevision = -1;
    const errors: string[] = [];
    const drafts = new Map(this.pendingSecrets);
    for (const [key, value] of drafts) {
      const local = validateSecret(key, value);
      let canSave = local.valid;
      let message = local.hint;
      if (local.valid) {
        const context: Partial<Record<RuntimeSecretKey, string>> = {};
        const companion = companions[key];
        if (companion && drafts.has(companion)) context[companion] = drafts.get(companion);
        const result = await verifySecretWithApi(key, value, context);
        canSave = result.canSave;
        message = result.message;
      }
      if (revision !== this.revision) return ['The draft changed. Review it and save again.'];
      this.setValidation(key, canSave, message);
      if (!canSave) errors.push(`${key}: ${message ?? 'Could not validate this value'}`);
    }
    if (!errors.length) this.approvedRevision = revision;
    return errors;
  }

  async commitVerifiedSecrets(): Promise<void> {
    const revision = this.revision;
    if (this.approvedRevision !== revision) return;
    this.approvedRevision = -1;
    await this.writeDrafts(revision);
  }

  async commitPendingSecrets(): Promise<void> {
    if (this.getValidationErrors().length || [...this.pendingSecrets.keys()].some(key => this.validatedKeys.get(key) === false)) return;
    await this.writeDrafts(this.revision);
  }

  private async writeDrafts(revision: number): Promise<void> {
    const drafts = new Map(this.pendingSecrets);
    for (const [key, value] of drafts) {
      await setSecretValue(key, value);
      if (this.revision !== revision) return;
      this.pendingSecrets.delete(key);
      this.validatedKeys.delete(key);
      this.validationMessages.delete(key);
    }
  }

  setPending(key: RuntimeSecretKey, value: string): void {
    if (this.pendingSecrets.get(key) === value) return;
    this.revision++;
    this.pendingSecrets.set(key, value);
    this.validatedKeys.delete(key);
    this.validationMessages.delete(key);
  }

  getPending(key: RuntimeSecretKey): string | undefined {
 return this.pendingSecrets.get(key);
  }

  hasPending(key: RuntimeSecretKey): boolean {
 return this.pendingSecrets.has(key);
  }

  deletePending(key: RuntimeSecretKey): void {
 this.revision++;
 this.pendingSecrets.delete(key);
 this.validatedKeys.delete(key);
 this.validationMessages.delete(key);
  }

  clearValidation(key: RuntimeSecretKey): void {
    this.validatedKeys.delete(key);
    this.validationMessages.delete(key);
  }

  setValidation(key: RuntimeSecretKey, valid: boolean, message?: string): void {
 this.validatedKeys.set(key, valid);
 if (message) {
 this.validationMessages.set(key, message);
 } else {
 this.validationMessages.delete(key);
 }
  }

  getValidationState(key: RuntimeSecretKey): { validated?: boolean; message?: string } {
 return {
 validated: this.validatedKeys.get(key),
 message: this.validationMessages.get(key),
 };
  }

  destroy(): void {
 this.revision++;
 this.pendingSecrets.clear();
 this.validatedKeys.clear();
 this.validationMessages.clear();
  }
}
