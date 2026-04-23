import type { AppContext, AppModule } from '@/app/app-context';
import type { BreakingAlert } from '@/services/breaking-news-alerts';
import { tryInvokeTauri } from '@/services/tauri-bridge';
import { getAlertSettings } from '@/services/breaking-news-alerts';
import { isGhostMode } from '@/services/mode-manager';

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
 return;
 }

 await this.showWebNotification(body);
  }

  private async showWebNotification(body: string): Promise<void> {
 if (this.webPermission === 'unsupported' || typeof Notification === 'undefined') return;
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
