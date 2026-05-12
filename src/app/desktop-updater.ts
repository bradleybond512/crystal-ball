/* eslint-disable no-console, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-empty-function, @typescript-eslint/require-await */
import type { AppContext, AppModule, UpdateState } from '@/app/app-context';
import { invokeTauri, tryInvokeTauri } from '@/services/tauri-bridge';
import { trackUpdateShown, trackUpdateClicked, trackUpdateDismissed } from '@/services/analytics';
import { escapeHtml } from '@/utils/sanitize';

type UpdaterOutcome = 'no_update' | 'update_available' | 'open_failed' | 'fetch_failed';

export class DesktopUpdater implements AppModule {
  private ctx: AppContext;
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
 this.ctx.updateState = state;
 document.dispatchEvent(new CustomEvent('wm:update-state'));
  }

  private resolveDownloadInfo(data: { assets?: { name: string; browser_download_url: string }[] }): { url: string; name: string | null } {
 const buildArch = (typeof __BUILD_ARCH__ === 'undefined' ? 'aarch64' : __BUILD_ARCH__) as string;
 const assets = Array.isArray(data.assets) ? data.assets : [];
 const dmg =
 assets.find(a => typeof a.name === 'string' && a.name.endsWith('.dmg') && a.name.includes(buildArch)) ??
 assets.find(a => typeof a.name === 'string' && a.name.endsWith('.dmg'));
 return {
 url: dmg?.browser_download_url ?? 'https://github.com/bradleybond512/crystal-ball/releases/latest',
 name: dmg?.name ?? null,
 };
  }

  private async fetchExpectedSha256(
 assets: { name: string; browser_download_url: string }[],
 dmgName: string,
  ): Promise<string | undefined> {
 const manifestAsset = assets.find(a => a.name === 'release-manifest.json');
 if (!manifestAsset) return undefined;
 try {
 const res = await fetch(manifestAsset.browser_download_url, { signal: AbortSignal.timeout(10_000) });
 if (!res.ok) return undefined;
 const manifest = await res.json() as { assets?: { name: string; sha256: string }[] };
 return manifest.assets?.find(a => a.name === dmgName)?.sha256;
 } catch {
 return undefined;
 }
  }

  // eslint-disable-next-line sonarjs/cognitive-complexity -- linear fetch + parse + state branches; splitting hides the flow
  private async checkForUpdate(manual = false): Promise<void> {
 this.setUpdateState({ phase: 'checking' });
 try {
 const res = await fetch(
 'https://api.github.com/repos/bradleybond512/crystal-ball/releases/latest',
 { headers: { Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(10_000) }
 );
 if (!res.ok) {
 this.logUpdaterOutcome('fetch_failed', { status: res.status });
 // Don't claim up-to-date on a server error — that hides real
 // failures behind a false green check. Reset to null so the sidebar
 // falls back to just the version label and the user can retry.
 this.setUpdateState(null);
 if (manual) this.showInfoToast('Could not reach update server. Check your connection.');
 return;
 }
 const data = await res.json();

 const tagName = typeof data.tag_name === 'string' ? data.tag_name : '';
 const remote = tagName.replace(/^v/, '');
 if (!remote) {
 this.logUpdaterOutcome('fetch_failed', { reason: 'missing_remote_version' });
 this.setUpdateState({ phase: 'up-to-date' });
 return;
 }

 const current = __APP_VERSION__;
 if (!this.isNewerVersion(remote, current)) {
 this.logUpdaterOutcome('no_update', { current, remote });
 this.setUpdateState({ phase: 'up-to-date' });
 if (manual) this.showInfoToast(`You're up to date — v${current} is the latest version.`);
 return;
 }

 const assets = Array.isArray(data.assets) ? data.assets : [];
 const { url: downloadUrl, name: dmgName } = this.resolveDownloadInfo(data);
 const expectedSha256 = dmgName ? await this.fetchExpectedSha256(assets, dmgName) : undefined;
 const dismissKey = `wm-update-dismissed-${remote}`;
 const notifiedKey = `wm-update-notified-${remote}`;
 if (localStorage.getItem(dismissKey) && !manual) {
 this.logUpdaterOutcome('update_available', { current, remote, dismissed: true });
 this.setUpdateState({ phase: 'available', version: remote, downloadUrl, expectedSha256 });
 return;
 }

 this.logUpdaterOutcome('update_available', { current, remote, dismissed: false });
 this.setUpdateState({ phase: 'available', version: remote, downloadUrl, expectedSha256 });
 trackUpdateShown(current, remote);
 await this.showUpdateToast(remote, downloadUrl, expectedSha256);
 // Fire a native macOS notification once per remote version so a
 // background-running app surfaces the update without the user needing
 // to look at the Crystal Ball window.
 if (!localStorage.getItem(notifiedKey)) {
 localStorage.setItem(notifiedKey, '1');
 await tryInvokeTauri<void>('send_notification', {
 title: 'Crystal Ball update available',
 body: `v${current} → v${remote}. Click the version chip in the sidebar to install.`,
 sound: 'Glass',
 });
 }
 } catch (error) {
 this.logUpdaterOutcome('fetch_failed', {
 error: error instanceof Error ? error.message : String(error),
 });
 // Network or parsing failure — same as the !res.ok branch, don't pretend
 // the user is current.
 this.setUpdateState(null);
 if (manual) this.showInfoToast('Could not reach update server. Check your connection.');
  }
  }

  private isNewerVersion(remote: string, current: string): boolean {
 const r = remote.split('.').map(Number);
 const c = current.split('.').map(Number);
 for (let i = 0; i < Math.max(r.length, c.length); i++) {
 const rv = r[i] ?? 0;
 const cv = c[i] ?? 0;
 if (rv > cv) return true;
 if (rv < cv) return false;
 }
 return false;
  }

  private async showUpdateToast(version: string, downloadUrl: string, expectedSha256?: string): Promise<void> {
 const existing = document.querySelector<HTMLElement>('.update-toast');
 if (existing?.dataset.version === version) return;
 existing?.remove();

 // On macOS desktop, show "Update Now" (auto-install). Otherwise show "Download".
 const canAutoInstall = this.ctx.isDesktopApp && downloadUrl.endsWith('.dmg');
 const actionLabel = canAutoInstall ? 'Update Now' : 'Download';

 const toast = document.createElement('div');
 toast.className = 'update-toast';
 toast.dataset.version = version;
 toast.innerHTML = `
 <div class="update-toast-icon">
 <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
 <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
 <polyline points="7 10 12 15 17 10"/>
 <line x1="12" y1="15" x2="12" y2="3"/>
 </svg>
 </div>
 <div class="update-toast-body">
 <div class="update-toast-title">Update Available</div>
 <div class="update-toast-detail">v${escapeHtml(__APP_VERSION__)} \u2192 v${escapeHtml(version)}</div>
 </div>
 <button class="update-toast-action" data-action="install">${actionLabel}</button>
 <button class="update-toast-dismiss" data-action="dismiss" aria-label="Dismiss">\u00D7</button>
 `;

 toast.addEventListener('click', (e) => {
 const target = e.target as HTMLElement;
 const action = target.closest<HTMLElement>('[data-action]')?.dataset.action;

 if (action === 'install') {
 trackUpdateClicked(version);
 const btn = toast.querySelector<HTMLButtonElement>('[data-action="install"]');

 if (canAutoInstall) {
 // Auto-install: download DMG, mount, replace app, relaunch
 if (btn) { btn.textContent = 'Downloading…'; btn.disabled = true; }
 invokeTauri<void>('install_update', { downloadUrl, expectedSha256 })
 .catch((error: unknown) => {
 this.logUpdaterOutcome('open_failed', {
 downloadUrl,
 error: error instanceof Error ? error.message : String(error),
 });
 if (btn) { btn.textContent = 'Failed — retry?'; btn.disabled = false; }
 // Fall back to opening the releases page
 void invokeTauri<void>('open_url', {
 url: 'https://github.com/bradleybond512/crystal-ball/releases/latest',
 }).catch(() => {});
 });
 } else {
 // Web or non-DMG: open in browser
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
 }
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
