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

  private markChecked(): void {
 this.lastCheckedAt = Date.now();
 try {
 localStorage.setItem('wm-update-last-checked', String(this.lastCheckedAt));
 } catch {
 // localStorage quota — the in-memory value still drives this session.
 }
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

 // The check reached GitHub and returned a usable version — record it for
 // the "last checked" indicator. Fetch/parse failures deliberately don't,
 // so the tooltip always reflects the last SUCCESSFUL check.
 this.markChecked();

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

 // On macOS with a real DMG and a verified manifest hash we can auto-download
 // and stage the update in the background, then prompt to restart. Without a
 // hash the Rust side would abort anyway, so we fall back to a browser
 // download there and on web / non-DMG releases.
 await (this.ctx.isDesktopApp && downloadUrl.endsWith('.dmg') && expectedSha256 ? this.stageAndPrompt(current, remote, downloadUrl, expectedSha256, manual) : this.offerBrowserDownload(current, remote, downloadUrl, expectedSha256, manual));
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

  // Ask Rust whether the canonical staged bundle on disk is THIS version, and
  // heal the localStorage hint to match. The hint can go stale (a boot-apply
  // discarded an invalid bundle, or a prior apply consumed it) or claim "staged"
  // for a bundle that was never written — so disk truth wins in both directions.
  private async reconcileStagedOnDisk(stagedKey: string, remote: string): Promise<boolean> {
 let stagedOnDisk: boolean;
 try {
 const diskVersion = await invokeTauri<string | null>('staged_update_status');
 stagedOnDisk = diskVersion === remote;
 } catch {
 // Older desktop binary without the status command — trust the local hint.
 return localStorage.getItem(stagedKey) === '1';
 }
 try {
 if (stagedOnDisk) localStorage.setItem(stagedKey, '1');
 else localStorage.removeItem(stagedKey);
 } catch { /* quota */ }
 return stagedOnDisk;
  }

  // Background-download + verify + stage the update, then prompt to restart.
  // Idempotent per remote version: once staged we skip the (re-)download and go
  // straight to the ready prompt. Any staging failure falls back to a browser
  // download so the user is never left stuck.
  private async stageAndPrompt(
 current: string,
 remote: string,
 downloadUrl: string,
 expectedSha256: string,
 manual: boolean,
  ): Promise<void> {
 const stagedKey = `wm-update-staged-${remote}`;
 const dismissKey = `wm-update-dismissed-${remote}`;
 const notifiedKey = `wm-update-notified-${remote}`;

 // The Rust filesystem — not the localStorage hint — is the source of truth
 // for whether THIS version is already staged on disk.
 const stagedOnDisk = await this.reconcileStagedOnDisk(stagedKey, remote);

 if (!stagedOnDisk) {
 this.setUpdateState({ phase: 'downloading', version: remote, downloadUrl, expectedSha256 });
 try {
 await invokeTauri<void>('stage_update', { downloadUrl, expectedSha256 });
 try { localStorage.setItem(stagedKey, '1'); } catch { /* quota */ }
 } catch (error) {
 this.logUpdaterOutcome('open_failed', {
 downloadUrl,
 error: error instanceof Error ? error.message : String(error),
 });
 await this.offerBrowserDownload(current, remote, downloadUrl, expectedSha256, manual);
 return;
 }
 }

 // Staged and verified — it will apply on the next quit/relaunch even if the
 // user never touches the prompt.
 this.logUpdaterOutcome('update_available', { current, remote, staged: true });
 this.setUpdateState({ phase: 'ready', version: remote, downloadUrl, expectedSha256 });
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

  // Fallback for web builds, non-DMG releases, or a failed background stage:
  // surface the update and offer a browser download.
  private async offerBrowserDownload(
 current: string,
 remote: string,
 downloadUrl: string,
 expectedSha256: string | undefined,
 manual: boolean,
  ): Promise<void> {
 const dismissKey = `wm-update-dismissed-${remote}`;
 const notifiedKey = `wm-update-notified-${remote}`;
 this.setUpdateState({ phase: 'available', version: remote, downloadUrl, expectedSha256 });
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
 // The staged bundle failed to apply (missing / re-verify failed). Clear the
 // "already staged" flag so the next check re-downloads instead of getting
 // stuck offering a phantom ready state.
 try { localStorage.removeItem(`wm-update-staged-${version}`); } catch { /* quota */ }
 if (btn) { btn.textContent = 'Failed — retry?'; btn.disabled = false; }
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
 if (existing?.dataset.version === version) return;
 existing?.remove();

 const toast = document.createElement('div');
 toast.className = 'update-toast';
 toast.dataset.version = version;

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
 // No auto-install on this fallback path — just open the DMG so the user
 // can install it manually.
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
