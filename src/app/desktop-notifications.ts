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
  // Remember permission across calls so we don't spam requestPermission().
  // Possible values per spec: 'default' | 'granted' | 'denied'.
  private webPermission: NotificationPermission | 'unsupported' = 'default';

  constructor(ctx: AppContext) {
 this.ctx = ctx;
 this.boundHandler = (e: Event) => {
 void this.onBreakingNews((e as CustomEvent<BreakingAlert>).detail);
 };
  }

  init(): void {
 // Hydrate native iMessage state, then tell the user once if relays are paused (R4-BUG-001).
 if (this.ctx.isDesktopApp) void refreshImessageSettings().then(() => notifyImessagePausedOnce()).catch(() => undefined);
 if (!this.ctx.isDesktopApp && typeof Notification === 'undefined') {
 this.webPermission = 'unsupported';
 }
 if (!this.ctx.isDesktopApp && typeof Notification !== 'undefined') {
 this.webPermission = Notification.permission;
 }
 document.addEventListener('wm:breaking-news', this.boundHandler);
  }

  destroy(): void {
 document.removeEventListener('wm:breaking-news', this.boundHandler);
  }

  private async onBreakingNews(alert: BreakingAlert): Promise<void> {
 if (isGhostMode()) return;  // Ghost Mode: notifications suppressed
 const settings = getAlertSettings();
 if (!settings.enabled || !settings.desktopNotificationsEnabled) return;

 const body = `[${alert.threatLevel.toUpperCase()}] ${alert.headline} — ${alert.source}`;

 if (this.ctx.isDesktopApp) {
 const sound = alert.threatLevel === 'critical' ? 'Basso' : 'Ping';
 await notifyNative({
 title: 'Crystal Ball Alert',
 body,
 sound,
 priority: 'high',
 });
 await this.relayToImessage(alert, body);
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
 if (this.webPermission === 'unsupported' || typeof Notification === 'undefined') return;
 // Re-sync with the browser each time so a user who flipped the site
 // lock-icon setting from denied → allowed without us seeing a
 // requestPermission round-trip is picked up automatically.
 if (this.webPermission !== Notification.permission) {
 this.webPermission = Notification.permission;
 }
 if (this.webPermission === 'default') {
 try {
 this.webPermission = await Notification.requestPermission();
 } catch {
 this.webPermission = 'denied';
 }
 }
 if (this.webPermission !== 'granted') return;
 try {
 new Notification('Crystal Ball Alert', { body });
 } catch {
 // Some browsers throw if Notification is called outside a user gesture;
 // fail silent rather than spamming the console on every alert.
 }
  }
}
