import type { AppContext, AppModule } from '@/app/app-context';
import type { BreakingAlert } from '@/services/breaking-news-alerts';
import { tryInvokeTauri } from '@/services/tauri-bridge';
import { getAlertSettings } from '@/services/breaking-news-alerts';
import { isGhostMode } from '@/services/mode-manager';
import { getImessageSettings, sendImessage } from '@/services/imessage-bridge';

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

  // eslint-disable-next-line sonarjs/cognitive-complexity -- threshold gating + native + web + iMessage paths inline
  private async onBreakingNews(alert: BreakingAlert): Promise<void> {
 if (isGhostMode()) return;  // Ghost Mode: notifications suppressed
 const settings = getAlertSettings();
 if (!settings.enabled || !settings.desktopNotificationsEnabled) return;

 const body = `[${alert.threatLevel.toUpperCase()}] ${alert.headline} — ${alert.source}`;

 if (this.ctx.isDesktopApp) {
 const sound = alert.threatLevel === 'critical' ? 'Basso' : 'Ping';
 await tryInvokeTauri<void>('send_notification', {
 title: 'Crystal Ball Alert',
 body,
 sound,
 });
 // Best-effort iMessage routing if the user has it configured. Threshold
 // gating happens here so we never wake the user's phone for a 'high' if
 // they only opted into 'critical'.
 const imSettings = getImessageSettings();
 if (imSettings.enabled && imSettings.recipient) {
 const meetsThreshold = imSettings.threshold === 'critical'
 ? alert.threatLevel === 'critical'
 : alert.threatLevel === 'critical' || alert.threatLevel === 'high';
 if (meetsThreshold) {
 const result = await sendImessage(imSettings.recipient, `Crystal Ball: ${body}`);
 if (!result.ok) {
 // eslint-disable-next-line no-console -- best-effort relay; user-actionable failure
 console.warn('[imessage] alert relay failed', result.reason);
 }
 }
 }
 return;
 }

 await this.showWebNotification(body);
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
