import type { Panel } from '@/components/Panel';
import type { RuntimeSecretKey } from '@/services/runtime-config';
import { setSecretValue } from '@/services/runtime-config';
import { HUMAN_LABELS, SIGNUP_URLS } from '@/services/settings-constants';
import { getRegistrationProfile, saveRegistrationProfile } from '@/services/registration-profile';
import type { RegistrationProfile } from '@/services/registration-profile';
import { getApiBaseUrl, isDesktopRuntime } from '@/services/runtime';
import { h, replaceChildren } from '@/utils/dom-utils';
import { openExternalSafe } from '@/utils/safe-open';

const REGISTERABLE_SERVICES: Partial<Record<RuntimeSecretKey, {
  endpoint: string;
  fields: ('firstName' | 'lastName' | 'email' | 'password' | 'organization')[];
  keyField: string | null;
  note?: string;
  oauthConnect?: boolean; // true = "Connect account" flow, not registration
}>> = {
  NEWSAPI_KEY: { endpoint: '/api/register/newsapi', fields: ['email', 'password'], keyField: 'apiKey' },
  NEWSDATA_API_KEY: { endpoint: '/api/register/newsdata', fields: ['email', 'password', 'firstName', 'lastName'], keyField: 'apiKey' },
  NASA_FIRMS_API_KEY: { endpoint: '/api/register/nasa-firms', fields: ['email', 'firstName', 'lastName', 'organization'], keyField: null, note: 'Key will be sent to your email' },
  ACLED_ACCESS_TOKEN: { endpoint: '/api/acled/connect', fields: ['email', 'password'], keyField: 'accessToken', oauthConnect: true, note: 'Connects your existing myACLED account' },
};

export function showApiKeyGate(
  panel: Panel,
  keyName: RuntimeSecretKey,
  onSaved: () => void,
): void {
  const label = HUMAN_LABELS[keyName] ?? keyName;
  const signupUrl = SIGNUP_URLS[keyName];
  const registerable = REGISTERABLE_SERVICES[keyName];

  // ── Paste Key tab ────────────────────────────────────────────────────────
  const input = h('input', {
 type: 'password',
 className: 'api-key-gate-input',
 placeholder: 'Paste key\u2026',
 autocomplete: 'off',
 spellcheck: 'false',
  }) as HTMLInputElement;

  const btn = h('button', { className: 'api-key-gate-save' }, 'Save') as HTMLButtonElement;
  const status = h('span', { className: 'api-key-gate-status' }) as HTMLSpanElement;
  const row = h('div', { className: 'api-key-gate-row' }, input, btn);
  const labelEl = h('p', { className: 'api-key-gate-label' }, `${label} required`);

  const pasteChildren: Node[] = [labelEl, row];
  if (signupUrl) {
 const link = h('a', {
 className: 'api-key-gate-signup',
 href: signupUrl,
 target: '_blank',
 rel: 'noopener',
 }, 'Get a free key \u2192') as HTMLAnchorElement;
 pasteChildren.push(link);
  }
  pasteChildren.push(status);

  const pasteTab = h('div', { className: 'api-key-gate-tab-content' }, ...pasteChildren);

  const save = async () => {
 const value = input.value.trim();
 if (!value) return;
 btn.disabled = true;
 status.textContent = 'Saving\u2026';
 try {
 await setSecretValue(keyName, value);
 onSaved();
 } catch (error) {
 btn.disabled = false;
 status.textContent = error instanceof Error ? error.message : 'Error saving key';
 }
  };

  btn.addEventListener('click', () => { void save(); });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') void save(); });

  // ── Auto-Register tab ────────────────────────────────────────────────────
  const regStatus = h('span', { className: 'api-key-gate-status' }) as HTMLSpanElement;

  function buildRegisterTab(): HTMLElement {
 const profile = getRegistrationProfile();

 if (!registerable) {
 // No sidecar route — open signup URL with profile email pre-filled
 const openBtn = h('button', { className: 'api-key-gate-save' }, 'Open Signup Page') as HTMLButtonElement;
 openBtn.addEventListener('click', () => {
 let url = signupUrl ?? '';
 if (profile?.email && url) {
 url += (url.includes('?') ? '&' : '?') + 'email=' + encodeURIComponent(profile.email);
 }
 if (url) {
 openExternalSafe(url);
 }
 });
 const note = h('p', { className: 'api-key-gate-label' }, 'Opens the signup page in your browser.');
 return h('div', { className: 'api-key-gate-tab-content' }, note, openBtn, regStatus) as HTMLElement;
 }

 const fields = registerable.fields;
 const needsProfile = fields.some(f => f !== 'password');

 if (!profile && needsProfile) {
 return buildProfileForm(null);
 }

 // Profile exists (or only password needed) — show quick-register
 const desc = profile
 ? h('p', { className: 'api-key-gate-label' }, `Register as ${profile.email}`)
 : h('p', { className: 'api-key-gate-label' }, 'Auto-register');

 const registerBtn = h('button', { className: 'api-key-gate-save' }, 'Register \u2192') as HTMLButtonElement;

 // Password field if needed
 let passwordInput: HTMLInputElement | null = null;
 const children: Node[] = [desc];
 if (fields.includes('password')) {
 passwordInput = h('input', {
 type: 'password',
 className: 'api-key-gate-input',
 placeholder: 'Choose a password',
 autocomplete: 'new-password',
 }) as HTMLInputElement;
 children.push(h('div', { className: 'api-key-gate-row' }, passwordInput, registerBtn));
 } else {
 children.push(registerBtn);
 }

 if (registerable.note) {
 children.push(h('p', { className: 'api-key-gate-label' }, registerable.note));
 }

 const changeLink = h('a', {
 className: 'api-key-gate-signup',
 href: '#',
 }, 'Change profile') as HTMLAnchorElement;
 changeLink.addEventListener('click', (e) => {
 e.preventDefault();
 replaceChildren(regTabHolder, buildProfileForm(profile));
 });
 if (profile) children.push(changeLink);
 children.push(regStatus);

 registerBtn.addEventListener('click', () => {
 const pw = passwordInput?.value.trim() ?? '';
 if (fields.includes('password') && !pw) {
 regStatus.textContent = 'Password required';
 return;
 }
 void doRegister(profile, pw);
 });

 return h('div', { className: 'api-key-gate-tab-content' }, ...children) as HTMLElement;
  }

  function buildProfileForm(existing: RegistrationProfile | null): HTMLElement {
 const firstInput = h('input', {
 type: 'text',
 className: 'api-key-gate-input',
 placeholder: 'First name',
 value: existing?.firstName ?? '',
 }) as HTMLInputElement;
 const lastInput = h('input', {
 type: 'text',
 className: 'api-key-gate-input',
 placeholder: 'Last name',
 value: existing?.lastName ?? '',
 }) as HTMLInputElement;
 const emailInput = h('input', {
 type: 'email',
 className: 'api-key-gate-input',
 placeholder: 'Email',
 value: existing?.email ?? '',
 }) as HTMLInputElement;
 const orgInput = h('input', {
 type: 'text',
 className: 'api-key-gate-input',
 placeholder: 'Organization (optional)',
 value: existing?.organization ?? '',
 }) as HTMLInputElement;

 const registerable = REGISTERABLE_SERVICES[keyName];
 const needsPassword = registerable?.fields.includes('password') ?? false;
 let passwordInput: HTMLInputElement | null = null;
 const formChildren: Node[] = [firstInput, lastInput, emailInput, orgInput];
 if (needsPassword) {
 passwordInput = h('input', {
 type: 'password',
 className: 'api-key-gate-input',
 placeholder: 'Choose a password',
 autocomplete: 'new-password',
 }) as HTMLInputElement;
 formChildren.push(passwordInput);
 }

 const saveRegBtn = h('button', { className: 'api-key-gate-save' }, 'Save Profile & Register') as HTMLButtonElement;
 formChildren.push(h('div', { className: 'api-key-gate-row' }, saveRegBtn), regStatus);

 saveRegBtn.addEventListener('click', () => {
 const profile: RegistrationProfile = {
 firstName: firstInput.value.trim(),
 lastName: lastInput.value.trim(),
 email: emailInput.value.trim(),
 organization: orgInput.value.trim(),
 };
 if (!profile.email) { regStatus.textContent = 'Email required'; return; }
 if (needsPassword && !passwordInput?.value.trim()) { regStatus.textContent = 'Password required'; return; }
 saveRegistrationProfile(profile);
 void doRegister(profile, passwordInput?.value.trim() ?? '');
 });

 return h('div', { className: 'api-key-gate-tab-content' }, ...formChildren) as HTMLElement;
  }

  // eslint-disable-next-line sonarjs/cognitive-complexity -- pre-existing complexity, tracked in tech debt
  async function doRegister(profile: RegistrationProfile | null, password: string): Promise<void> {
 const svc = REGISTERABLE_SERVICES[keyName];
 if (!svc) return;

 regStatus.textContent = 'Registering\u2026';

 const payload: Record<string, string> = {};
 if (svc.fields.includes('email') && profile?.email) payload.email = profile.email;
 if (svc.fields.includes('password')) payload.password = password;
 if (svc.fields.includes('firstName') && profile?.firstName) payload.firstName = profile.firstName;
 if (svc.fields.includes('lastName') && profile?.lastName) payload.lastName = profile.lastName;
 if (svc.fields.includes('organization') && profile?.organization) payload.organization = profile.organization;

 try {
 const base = isDesktopRuntime() ? getApiBaseUrl() : '';
 const resp = await fetch(`${base}${svc.endpoint}`, {
 method: 'POST',
 headers: { 'Content-Type': 'application/json' },
 body: JSON.stringify(payload),
 });
 const data = await resp.json() as Record<string, unknown>;

 if (!data || typeof data !== 'object') {
 regStatus.textContent = 'Registration failed';
 return;
 }

 if (data.error) {
 // eslint-disable-next-line @typescript-eslint/no-base-to-string -- server error is string|undefined in practice
 regStatus.textContent = String(data.error);
 return;
 }

 if (svc.keyField === null) {
 // Key arrives by email
 regStatus.textContent = (data.message as string | undefined) ?? 'Check your email for the API key, then paste it above.';
 // Switch to paste tab
 pasteTabBtn.click();
 return;
 }

 const apiKey = data[svc.keyField] as string | null | undefined;
 if (apiKey) {
 regStatus.textContent = 'Saving\u2026';
 await setSecretValue(keyName, apiKey);
 // ACLED OAuth: also save email and refresh token
 if (svc.oauthConnect) {
 const emailVal = (data.email as string | undefined) ?? profile?.email ?? '';
 const refreshToken = data.refreshToken as string | undefined;
 if (emailVal) await setSecretValue('ACLED_EMAIL', emailVal);
 if (refreshToken) await setSecretValue('ACLED_REFRESH_TOKEN' as RuntimeSecretKey, refreshToken);
 }
 onSaved();
 } else {
 regStatus.textContent = (data.message as string | undefined) ?? 'Registration submitted — check your email.';
 }
 } catch (error) {
 regStatus.textContent = error instanceof Error ? error.message : 'Registration failed';
 }
  }

  // ── Tab switcher ─────────────────────────────────────────────────────────
  const pasteTabBtn = h('button', { className: 'api-key-gate-tab-btn active', 'data-tab': 'paste' }, 'Paste Key') as HTMLButtonElement;
  const regTabLabel = registerable?.oauthConnect ? 'Connect Account' : 'Auto-Register';
  const regTabBtn = h('button', { className: 'api-key-gate-tab-btn', 'data-tab': 'register' }, regTabLabel) as HTMLButtonElement;
  const tabBar = h('div', { className: 'api-key-gate-tabs' }, pasteTabBtn, regTabBtn);

  // Holder for the register tab content (rebuilt on demand)
  const regTabHolder = h('div') as HTMLElement;
  replaceChildren(regTabHolder, buildRegisterTab());

  // Initial state: paste tab visible
  regTabHolder.style.display = 'none';

  pasteTabBtn.addEventListener('click', () => {
 pasteTabBtn.classList.add('active');
 regTabBtn.classList.remove('active');
 pasteTab.style.display = '';
 regTabHolder.style.display = 'none';
  });

  regTabBtn.addEventListener('click', () => {
 regTabBtn.classList.add('active');
 pasteTabBtn.classList.remove('active');
 pasteTab.style.display = 'none';
 regTabHolder.style.display = '';
 replaceChildren(regTabHolder, buildRegisterTab());
  });

  const gateChildren: Node[] = [labelEl.cloneNode(true)];
  if (registerable || signupUrl) {
 gateChildren.push(tabBar);
  }
  gateChildren.push(pasteTab, regTabHolder);

  const gate = h('div', { className: 'api-key-gate' }, ...gateChildren);

  replaceChildren(panel.getContentElement(), gate);
}
