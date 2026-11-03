import { notifyNative } from '@/services/native-notify';
import type { AppContext, AppModule } from '@/app/app-context';
import type { BreakingAlert } from '@/services/breaking-news-alerts';
import { getAlertSettings } from '@/services/breaking-news-alerts';
import { isGhostMode } from '@/services/mode-manager';
import { getImessageSettings, refreshImessageSettings, sendImessage } from '@/services/imessage-bridge';
import { notifyImessagePausedOnce, recordPausedImessageRelay } from '@/services/notifications/imessage-pause-alerts';

/**
 * Routes breaking alerts to native macOS notifications on desktop (osascript
 * via Tauri) and to the browser Notification API on web. Respects the alert
 * settings toggle and Ghost Mode.
 */
export class DesktopNotifications implements AppModule {
  private ctx: AppContext;
  private readonly boundHandler: (e: Event) => void;
  private workspaceOpen = false;
  private sourcesReady = false;

  constructor(ctx: AppContext) {
 this.ctx = ctx;
 this.boundHandler = (e: Event) => {
 void this.onBreakingNews((e as CustomEvent<BreakingAlert>).detail);
 };
  }

  init(): void {
    document.addEventListener('wm:breaking-news', this.boundHandler);
  }

  openWorkspace(): void {
    if (this.workspaceOpen || this.ctx.isDestroyed) return;
    this.workspaceOpen = true;
    if (this.sourcesReady) this.hydrateRelay();
  }

  sourcesSettled(): void {
    if (this.sourcesReady || this.ctx.isDestroyed) return;
    this.sourcesReady = true;
    if (this.workspaceOpen) this.hydrateRelay();
  }

  private hydrateRelay(): void {
    if (this.ctx.isDesktopApp) {
      void refreshImessageSettings().then(() => {
        if (this.workspaceOpen && !this.ctx.isDestroyed) return notifyImessagePausedOnce();
      }).catch(() => undefined);
    }
  }

  destroy(): void {
    this.workspaceOpen = false;
    document.removeEventListener('wm:breaking-news', this.boundHandler);
  }

  private canRoute(): boolean {
    if (!this.workspaceOpen || this.ctx.isDestroyed || isGhostMode()) return false;
    if (!this.sourcesReady) {
      try {
        const mode = localStorage.getItem('wm-app-mode');
        if (mode !== null && mode !== 'gods-vision') return false;
        if (localStorage.getItem('cb:onboarding-complete') !== 'true') return false;
      } catch { return false; }
    }
    const settings = getAlertSettings();
    return settings.enabled && settings.desktopNotificationsEnabled;
  }

  private async onBreakingNews(alert: BreakingAlert): Promise<void> {
    if (!this.canRoute()) return;
    const body = `[${alert.threatLevel.toUpperCase()}] ${alert.headline} — ${alert.source}`;
    const allowRelay = this.sourcesReady;
    if (this.ctx.isDesktopApp) {
      const sound = alert.threatLevel === 'critical' ? 'Basso' : 'Ping';
      await notifyNative({ title: 'Crystal Ball Alert', body, sound, priority: 'high' });
      if (allowRelay && this.canRoute()) await this.relayToImessage(alert, body);
      return;
    }
    await this.showWebNotification(body);
  }

  /**
   * Best-effort iMessage routing. Threshold gating happens first so we never
   * wake the user's phone for a 'high' if they only opted into 'critical'. A
   * relay skipped because iMessage is paused is traced, never silent (R4-BUG-001).
   */
  private async relayToImessage(alert: BreakingAlert, body: string): Promise<void> {
    const imSettings = getImessageSettings();
    const meetsThreshold = imSettings.threshold === 'critical'
      ? alert.threatLevel === 'critical'
      : alert.threatLevel === 'critical' || alert.threatLevel === 'high';
    if (!meetsThreshold) return;
    const paused = { source: 'breaking-news', urgency: alert.threatLevel === 'critical' ? 'critical' : 'high', headline: alert.headline } as const;
    if (!imSettings.ready || !imSettings.enabled || !imSettings.recipient) {
      recordPausedImessageRelay(paused);
      return;
    }
    const result = await sendImessage(`Crystal Ball: ${body}`);
    if (result.ok) return;
    // eslint-disable-next-line no-console -- best-effort relay; user-actionable failure
    console.warn('[imessage] alert relay failed', result.reason);
    if (result.code === 'disabled') recordPausedImessageRelay(paused);
  }

  private async showWebNotification(body: string): Promise<void> {
    if (typeof Notification === 'undefined') return;
    try {
      let permission = Notification.permission;
      if (permission === 'default' && this.sourcesReady) permission = await Notification.requestPermission();
      if (permission === 'granted' && this.canRoute()) new Notification('Crystal Ball Alert', { body });
    } catch {
      // Some browsers require a user gesture.
    }
  }
}
