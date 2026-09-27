/* eslint-disable no-console, @typescript-eslint/require-await */
import type { AppContext, AppModule, UpdateState } from '@/app/app-context';
import { invokeTauri, tryInvokeTauri } from '@/services/tauri-bridge';
import { trackUpdateShown, trackUpdateClicked, trackUpdateDismissed } from '@/services/analytics';
import { escapeHtml } from '@/utils/sanitize';

type UpdaterOutcome = 'no_update' | 'update_available' | 'open_failed' | 'fetch_failed';

type NativeUpdateResult =
  | { status: 'up_to_date'; currentVersion: string; checkedAt: number }
  | { status: 'ready'; version: string; checkedAt: number }
  | { status: 'browser_download'; version: string; downloadUrl: string; reason: string; checkedAt: number };

const BROWSER_DOWNLOAD_REASONS = new Set([
  'unsupported_platform', 'unsupported_architecture', 'no_signer_pin',
  'missing_manifest', 'invalid_release', 'signer_mismatch',
]);

function isUpdateVersion(value: unknown): value is string {
  return typeof value === 'string'
    && /^(0|[1-9]\d{0,9})\.(0|[1-9]\d{0,9})\.(0|[1-9]\d{0,9})$/.test(value)
    && value.split('.').every(part => Number(part) <= 4_294_967_295);
}

function isNativeUpdateResult(value: unknown): value is NativeUpdateResult {
  if (typeof value !== 'object' || value === null) return false;
  const result = value as Record<string, unknown>;
  if (typeof result.checkedAt !== 'number' || !Number.isSafeInteger(result.checkedAt) || result.checkedAt <= 0) return false;
  if (result.status === 'up_to_date') return isUpdateVersion(result.currentVersion);
  if (!isUpdateVersion(result.version)) return false;
  if (result.status === 'ready') return true;
  return result.status === 'browser_download'
    && typeof result.reason === 'string' && BROWSER_DOWNLOAD_REASONS.has(result.reason)
    && result.downloadUrl === `https://github.com/bradleybond512/crystal-ball/releases/tag/v${result.version}`;
}

export class DesktopUpdater implements AppModule {
  private ctx: AppContext;
  private checkInFlight = false;
  private manualCheckRequested = false;
  private destroyed = false;
  private updateCheckIntervalId: ReturnType<typeof setInterval> | null = null;
  // Hourly background check is the right cadence for a long-running desktop
  // app: short enough that a user who keeps Crystal Ball open in the
  // background notices a new release the same day, long enough that we
  // don't grind through GitHub's 60/hr unauthenticated API limit.
  private readonly UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;
  // Cooldown between focus-triggered re-checks so re-focusing the window
  // every 30 seconds doesn't rate-limit us out.
  private readonly FOCUS_RECHECK_COOLDOWN_MS = 5 * 60 * 1000;
  private lastFocusCheckAt = 0;
  // Epoch ms of the last check that actually reached GitHub — drives the
  // sidebar "last checked N ago" tooltip. Persisted so it survives relaunches
  // and is meaningful before the first check of a new session completes.
  private lastCheckedAt = Number(localStorage.getItem('wm-update-last-checked')) || 0;
  private readonly boundFocusHandler = (): void => {
 if (!this.ctx.isDesktopApp || this.ctx.isDestroyed) return;
 const now = Date.now();
 if (now - this.lastFocusCheckAt < this.FOCUS_RECHECK_COOLDOWN_MS) return;
 this.lastFocusCheckAt = now;
 void this.checkForUpdate();
  };

  constructor(ctx: AppContext) {
 this.ctx = ctx;
  }

  init(): void {
 this.setupUpdateChecks();

 if (!this.ctx.isDesktopApp) return;
 // Manual "Check for Updates…" from the macOS Help menu
 document.addEventListener('wm:check-for-updates', () => {
 void this.checkForUpdate(true);
 });
 // Re-check whenever the user brings the window back to focus — covers
 // the common case of leaving the app open in the background for a few
 // hours and returning to it after a release went out.
 window.addEventListener('focus', this.boundFocusHandler);
 document.addEventListener('visibilitychange', () => {
 if (document.visibilityState === 'visible') this.boundFocusHandler();
 });
  }

  destroy(): void {
 this.destroyed = true;
 if (this.updateCheckIntervalId) {
 clearInterval(this.updateCheckIntervalId);
 this.updateCheckIntervalId = null;
 }
 window.removeEventListener('focus', this.boundFocusHandler);
  }

  private setupUpdateChecks(): void {
 if (!this.ctx.isDesktopApp || this.ctx.isDestroyed) return;

 setTimeout(() => {
 if (this.ctx.isDestroyed) return;
 void this.checkForUpdate();
 }, 5000);

 if (this.updateCheckIntervalId) {
 clearInterval(this.updateCheckIntervalId);
 }
 this.updateCheckIntervalId = setInterval(() => {
 if (this.ctx.isDestroyed) return;
 void this.checkForUpdate();
 }, this.UPDATE_CHECK_INTERVAL_MS);
  }

  private logUpdaterOutcome(outcome: UpdaterOutcome, context: Record<string, unknown> = {}): void {
 const logger = outcome === 'open_failed' || outcome === 'fetch_failed'
 ? console.warn
 : console.info;
 logger('[updater]', outcome, context);
  }

  private setUpdateState(state: UpdateState): void {
 // Carry the last successful check time onto every non-null phase so the
 // sidebar tooltip stays accurate even while a fresh check is in flight.
 if (state && state.lastCheckedAt === undefined && this.lastCheckedAt > 0) {
 state = { ...state, lastCheckedAt: this.lastCheckedAt };
 }
 this.ctx.updateState = state;
 document.dispatchEvent(new CustomEvent('wm:update-state'));
  }

  private markChecked(checkedAt: number): void {
 this.lastCheckedAt = checkedAt;
 try {
 localStorage.setItem('wm-update-last-checked', String(this.lastCheckedAt));
 } catch {
 // localStorage quota — the in-memory value still drives this session.
 }
  }

  private async checkForUpdate(manual = false): Promise<void> {
 if (!this.ctx.isDesktopApp || this.ctx.isDestroyed || this.destroyed) return;
 this.manualCheckRequested ||= manual;
 if (this.checkInFlight) return;
 this.checkInFlight = true;
 this.setUpdateState({ phase: 'checking' });
 try {
 const result = await invokeTauri<unknown>('stage_latest_update');
 if (this.ctx.isDestroyed || this.destroyed) return;
 if (!isNativeUpdateResult(result)) throw new Error('Invalid native updater result');
 await this.presentUpdate(result);
 } catch (error) {
 if (this.ctx.isDestroyed || this.destroyed) return;
 this.logUpdaterOutcome('fetch_failed', {
 error: error instanceof Error ? error.message : 'Native update check failed',
 });
 document.querySelector('.update-toast:not(.update-info-toast)')?.remove();
 this.setUpdateState(null);
 if (this.manualCheckRequested) this.showInfoToast('Could not check for updates. Please try again.');
 } finally {
 this.checkInFlight = false;
 this.manualCheckRequested = false;
 }
  }

  private async presentUpdate(result: NativeUpdateResult): Promise<void> {
 this.markChecked(result.checkedAt);
 const existing = document.querySelector<HTMLElement>('.update-toast:not(.update-info-toast)');
 const nextKind = result.status === 'ready' ? 'ready' : 'browser';
 if (result.status === 'up_to_date' || existing?.dataset.version !== result.version || existing.dataset.kind !== nextKind) {
 existing?.remove();
 }
 const current = __APP_VERSION__;
 if (result.status === 'up_to_date') {
 this.logUpdaterOutcome('no_update', { current: result.currentVersion });
 this.setUpdateState({ phase: 'up-to-date' });
 if (this.manualCheckRequested) this.showInfoToast(`You're up to date — v${result.currentVersion} is the latest version.`);
 } else if (result.status === 'ready') {
 await this.promptReady(current, result.version, this.manualCheckRequested);
 } else {
 await this.offerBrowserDownload(current, result.version, result.downloadUrl, this.manualCheckRequested);
 }
  }

  private buildStrokeIcon(
 children: { tag: 'path' | 'polyline' | 'line'; attrs: Record<string, string> }[],
  ): SVGElement {
 const NS = 'http://www.w3.org/2000/svg' as const;
 const svg = document.createElementNS(NS, 'svg');
 const svgAttrs: Record<string, string> = {
 width: '20', height: '20', viewBox: '0 0 24 24', fill: 'none',
 stroke: 'currentColor', 'stroke-width': '2',
 'stroke-linecap': 'round', 'stroke-linejoin': 'round',
 };
 for (const [k, v] of Object.entries(svgAttrs)) svg.setAttribute(k, v);
 for (const child of children) {
 const el = document.createElementNS(NS, child.tag);
 for (const [k, v] of Object.entries(child.attrs)) el.setAttribute(k, v);
 svg.append(el);
 }
 return svg;
  }

  private async promptReady(current: string, remote: string, manual: boolean): Promise<void> {
 const dismissKey = `wm-update-dismissed-${remote}`;
 const notifiedKey = `wm-update-notified-${remote}`;

 // Staged and verified — it will apply on the next quit/relaunch even if the
 // user never touches the prompt.
 this.logUpdaterOutcome('update_available', { current, remote, staged: true });
 this.setUpdateState({ phase: 'ready', version: remote });
 trackUpdateShown(current, remote);
 if (!localStorage.getItem(dismissKey) || manual) {
 this.showReadyToast(current, remote);
 }
 if (!localStorage.getItem(notifiedKey)) {
 try { localStorage.setItem(notifiedKey, '1'); } catch { /* quota */ }
 await tryInvokeTauri<void>('send_notification', {
 title: 'Crystal Ball update ready',
 body: `v${current} → v${remote} downloaded. Restart to update — it also applies next time you quit and reopen.`,
 sound: 'Glass',
 });
 }
  }

  // Native policy can offer a manual download without authorizing installation.
  private async offerBrowserDownload(
 current: string,
 remote: string,
 downloadUrl: string,
 manual: boolean,
  ): Promise<void> {
 const dismissKey = `wm-update-dismissed-${remote}`;
 const notifiedKey = `wm-update-notified-${remote}`;
 this.setUpdateState({ phase: 'available', version: remote, downloadUrl });
 if (localStorage.getItem(dismissKey) && !manual) {
 this.logUpdaterOutcome('update_available', { current, remote, dismissed: true });
 return;
 }
 this.logUpdaterOutcome('update_available', { current, remote, dismissed: false });
 trackUpdateShown(current, remote);
 await this.showUpdateToast(remote, downloadUrl);
 if (!localStorage.getItem(notifiedKey)) {
 try { localStorage.setItem(notifiedKey, '1'); } catch { /* quota */ }
 await tryInvokeTauri<void>('send_notification', {
 title: 'Crystal Ball update available',
 body: `v${current} → v${remote}. Click the version chip in the sidebar to download.`,
 sound: 'Glass',
 });
 }
  }

  private showReadyToast(current: string, version: string): void {
 const existing = document.querySelector<HTMLElement>('.update-toast');
 if (existing?.dataset.version === version && existing.dataset.kind === 'ready') return;
 existing?.remove();

 const toast = document.createElement('div');
 toast.className = 'update-toast';
 toast.dataset.version = version;
 toast.dataset.kind = 'ready';

 const icon = document.createElement('div');
 icon.className = 'update-toast-icon';
 icon.append(this.buildStrokeIcon([
 { tag: 'path', attrs: { d: 'M21 2v6h-6' } },
 { tag: 'path', attrs: { d: 'M3 12a9 9 0 0 1 15-6.7L21 8' } },
 { tag: 'path', attrs: { d: 'M3 22v-6h6' } },
 { tag: 'path', attrs: { d: 'M21 12a9 9 0 0 1-15 6.7L3 16' } },
 ]));

 const body = document.createElement('div');
 body.className = 'update-toast-body';
 const title = document.createElement('div');
 title.className = 'update-toast-title';
 title.textContent = 'Update ready';
 const detail = document.createElement('div');
 detail.className = 'update-toast-detail';
 detail.textContent = `v${current} → v${version} · downloaded`;
 body.append(title, detail);

 const apply = document.createElement('button');
 apply.className = 'update-toast-action';
 apply.dataset.action = 'apply';
 apply.textContent = 'Restart now';

 const dismiss = document.createElement('button');
 dismiss.className = 'update-toast-dismiss';
 dismiss.dataset.action = 'dismiss';
 dismiss.setAttribute('aria-label', 'Later');
 dismiss.textContent = '×';

 toast.append(icon, body, apply, dismiss);

 toast.addEventListener('click', (e) => {
 const target = e.target as HTMLElement;
 const action = target.closest<HTMLElement>('[data-action]')?.dataset.action;
 if (action === 'apply') {
 trackUpdateClicked(version);
 const btn = toast.querySelector<HTMLButtonElement>('[data-action="apply"]');
 if (btn) { btn.textContent = 'Restarting…'; btn.disabled = true; }
 // On success the app swaps the bundle and relaunches, so nothing after
 // this resolves; only the failure path returns to JS.
 invokeTauri<void>('apply_staged_update').catch((error: unknown) => {
 this.logUpdaterOutcome('open_failed', {
 error: error instanceof Error ? error.message : String(error),
 });
 this.setUpdateState(null);
 toast.remove();
 this.showInfoToast('Could not apply the update. Check for updates to try again.');
 });
 } else if (action === 'dismiss') {
 trackUpdateDismissed(version);
 localStorage.setItem(`wm-update-dismissed-${version}`, '1');
 toast.classList.remove('visible');
 setTimeout(() => toast.remove(), 300);
 }
 });

 document.body.append(toast);
 requestAnimationFrame(() => {
 requestAnimationFrame(() => toast.classList.add('visible'));
 });
  }

  private async showUpdateToast(version: string, downloadUrl: string): Promise<void> {
 const existing = document.querySelector<HTMLElement>('.update-toast');
 if (existing?.dataset.version === version && existing.dataset.kind === 'browser') return;
 existing?.remove();

 const toast = document.createElement('div');
 toast.className = 'update-toast';
 toast.dataset.version = version;
 toast.dataset.kind = 'browser';

 const icon = document.createElement('div');
 icon.className = 'update-toast-icon';
 icon.append(this.buildStrokeIcon([
 { tag: 'path', attrs: { d: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4' } },
 { tag: 'polyline', attrs: { points: '7 10 12 15 17 10' } },
 { tag: 'line', attrs: { x1: '12', y1: '15', x2: '12', y2: '3' } },
 ]));

 const body = document.createElement('div');
 body.className = 'update-toast-body';
 const title = document.createElement('div');
 title.className = 'update-toast-title';
 title.textContent = 'Update available';
 const detail = document.createElement('div');
 detail.className = 'update-toast-detail';
 detail.textContent = `v${__APP_VERSION__} → v${version}`;
 body.append(title, detail);

 const action = document.createElement('button');
 action.className = 'update-toast-action';
 action.dataset.action = 'install';
 action.textContent = 'Download';

 const dismiss = document.createElement('button');
 dismiss.className = 'update-toast-dismiss';
 dismiss.dataset.action = 'dismiss';
 dismiss.setAttribute('aria-label', 'Dismiss');
 dismiss.textContent = '×';

 toast.append(icon, body, action, dismiss);

 toast.addEventListener('click', (e) => {
 const target = e.target as HTMLElement;
 const clicked = target.closest<HTMLElement>('[data-action]')?.dataset.action;
 if (clicked === 'install') {
 trackUpdateClicked(version);
 // Open the canonical release page for a manual download.
 if (this.ctx.isDesktopApp) {
 void invokeTauri<void>('open_url', { url: downloadUrl }).catch((error: unknown) => {
 this.logUpdaterOutcome('open_failed', {
 downloadUrl,
 error: error instanceof Error ? error.message : String(error),
 });
 this.showInfoToast('Could not open the download link.');
 });
 } else {
 window.open(downloadUrl, '_blank', 'noopener');
 }
 } else if (clicked === 'dismiss') {
 trackUpdateDismissed(version);
 localStorage.setItem(`wm-update-dismissed-${version}`, '1');
 toast.classList.remove('visible');
 setTimeout(() => toast.remove(), 300);
 }
 });

 document.body.append(toast);
 requestAnimationFrame(() => {
 requestAnimationFrame(() => toast.classList.add('visible'));
 });
  }

  private showInfoToast(message: string): void {
 const existing = document.querySelector<HTMLElement>('.update-info-toast');
 existing?.remove();
 const toast = document.createElement('div');
 toast.className = 'update-toast update-info-toast';
 toast.innerHTML = `
 <div class="update-toast-body">
 <div class="update-toast-title">Crystal Ball</div>
 <div class="update-toast-detail">${escapeHtml(message)}</div>
 </div>
 <button class="update-toast-dismiss" data-action="dismiss" aria-label="Dismiss">\u00D7</button>
 `;
 toast.addEventListener('click', () => {
 toast.classList.remove('visible');
 setTimeout(() => toast.remove(), 300);
 });
 document.body.append(toast);
 requestAnimationFrame(() => requestAnimationFrame(() => toast.classList.add('visible')));
 setTimeout(() => {
 toast.classList.remove('visible');
 setTimeout(() => toast.remove(), 300);
 }, 5000);
  }
}
