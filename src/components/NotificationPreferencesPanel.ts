/**
 * Notification Preferences Panel (panel id: `notification-preferences`).
 *
 * Per-domain mute, severity threshold, channel selection (system / sms /
 * email / menubar), and quiet-hours-override toggle. Plus global toggles:
 * on/off, quiet-hours window, rate limit.
 *
 * Auto-saves every change to the NotificationPreferencesService singleton
 * (which persists to localStorage under STORAGE_KEY).
 */

import { Panel } from './Panel';
import {
  getNotificationPreferencesService,
  type NotificationChannel,
  type Severity,
} from '@/services/notifications/notification-preferences';
import { getVoiceSettings, saveVoiceSettings } from '@/services/notifications/voice-alerter';
import { escapeHtml } from '@/utils/sanitize';

const CHANNELS: NotificationChannel[] = ['system', 'sms', 'email', 'menubar'];
const CHANNEL_LABELS: Record<NotificationChannel, string> = {
  system: 'System',
  sms: 'SMS',
  email: 'Email',
  menubar: 'Menubar',
};
const SEVERITIES: Severity[] = ['low', 'medium', 'high', 'critical'];

const DOMAIN_LABELS: Record<string, string> = {
  earthquake: 'Earthquakes',
  weather: 'Weather',
  wildfire: 'Wildfire',
  maritime: 'Maritime',
  aviation: 'Aviation',
  biosurveillance: 'Biosurveillance',
  'space-weather': 'Space Weather',
  cyber: 'Cyber',
  sanctions: 'Sanctions',
  intelligence: 'Intelligence',
};

export class NotificationPreferencesPanel extends Panel {
  private unsubscribe: (() => void) | null = null;

  constructor() {
    super({
      id: 'notification-preferences',
      title: 'Notification Preferences',
      showCount: true,
      trackActivity: false,
      infoTooltip:
        'Per-domain mute / threshold / channel selection (system / SMS / email / menubar) and quiet-hours override. Auto-saves on every change.',
    });
    this.unsubscribe = getNotificationPreferencesService().subscribe(() => this.render());
    this.render();
  }

  public override destroy(): void {
    if (this.unsubscribe) { this.unsubscribe(); this.unsubscribe = null; }
    super.destroy();
  }

  private render(): void {
    const svc = getNotificationPreferencesService();
    const prefs = svc.getPreferences();
    const enabledCount = prefs.globalEnabled
      ? prefs.domains.filter((d) => d.enabled).length
      : 0;
    this.setCount(enabledCount);
    this.setContent(this.buildHtml(), () => this.wireHandlers());
  }

  private buildHtml(): string {
    const svc = getNotificationPreferencesService();
    const prefs = svc.getPreferences();

    const voiceSettings = getVoiceSettings();
    const globalBlock = `
      <section style="padding:10px 12px;border-bottom:1px solid rgba(255,255,255,0.08);">
        <div style="font-size:10px;font-weight:700;color:#aaa;text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px;">Global</div>
        <div style="display:flex;flex-wrap:wrap;gap:14px;align-items:center;font-size:12px;color:#ddd;">
          <label style="display:flex;align-items:center;gap:6px;cursor:pointer;">
            <input type="checkbox" id="np-global-enabled" ${prefs.globalEnabled ? 'checked' : ''}
              style="accent-color:#4a9eff;width:14px;height:14px;cursor:pointer;">
            Enable notifications
          </label>
          <label style="display:flex;align-items:center;gap:6px;">
            <span>Rate limit (/hour):</span>
            <input type="number" id="np-rate-limit" min="1" max="100" step="1"
              value="${prefs.rateLimitPerHour}"
              style="width:60px;background:#222;color:#ddd;border:1px solid rgba(255,255,255,0.15);border-radius:3px;padding:2px 4px;font-size:12px;">
          </label>
          <label style="display:flex;align-items:center;gap:6px;cursor:pointer;">
            <input type="checkbox" id="np-voice-enabled" ${voiceSettings.enabled ? 'checked' : ''}
              style="accent-color:#4a9eff;width:14px;height:14px;cursor:pointer;">
            Speak critical alerts aloud
          </label>
        </div>
      </section>`;

    const qh = prefs.quietHours;
    const quietBlock = `
      <section style="padding:10px 12px;border-bottom:1px solid rgba(255,255,255,0.08);">
        <div style="font-size:10px;font-weight:700;color:#aaa;text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px;">Quiet Hours</div>
        <div style="display:flex;flex-wrap:wrap;gap:14px;align-items:center;font-size:12px;color:#ddd;">
          <label style="display:flex;align-items:center;gap:6px;cursor:pointer;">
            <input type="checkbox" id="np-qh-enabled" ${qh.enabled ? 'checked' : ''}
              style="accent-color:#4a9eff;width:14px;height:14px;cursor:pointer;">
            Enable
          </label>
          <label style="display:flex;align-items:center;gap:6px;">
            <span>Start (0–23):</span>
            <input type="number" id="np-qh-start" min="0" max="23" step="1"
              value="${qh.startHour}"
              style="width:54px;background:#222;color:#ddd;border:1px solid rgba(255,255,255,0.15);border-radius:3px;padding:2px 4px;font-size:12px;">
          </label>
          <label style="display:flex;align-items:center;gap:6px;">
            <span>End (0–23):</span>
            <input type="number" id="np-qh-end" min="0" max="23" step="1"
              value="${qh.endHour}"
              style="width:54px;background:#222;color:#ddd;border:1px solid rgba(255,255,255,0.15);border-radius:3px;padding:2px 4px;font-size:12px;">
          </label>
          <span style="opacity:0.6;font-size:11px;">Wrap past midnight: set start &gt; end (e.g. 22 → 6).</span>
        </div>
      </section>`;

    const headerCells = [
      '<th style="text-align:left;padding:6px 8px;">On</th>',
      '<th style="text-align:left;padding:6px 8px;">Domain</th>',
      '<th style="text-align:left;padding:6px 8px;">Min severity</th>',
      ...CHANNELS.map((c) => `<th style="text-align:center;padding:6px 8px;">${escapeHtml(CHANNEL_LABELS[c])}</th>`),
      '<th style="text-align:center;padding:6px 8px;" title="Send even during quiet hours">QH override</th>',
    ].join('');

    const rows = prefs.domains.map((d) => {
      const dimmed = prefs.globalEnabled && d.enabled ? '' : 'opacity:0.55;';
      const label = escapeHtml(DOMAIN_LABELS[d.domain] ?? d.domain);
      const severityOptions = SEVERITIES.map((s) =>
        `<option value="${s}"${s === d.minSeverity ? ' selected' : ''}>${s}</option>`,
      ).join('');
      const channelCells = CHANNELS.map((c) => `
        <td style="text-align:center;padding:6px 8px;">
          <input type="checkbox" data-domain="${escapeHtml(d.domain)}" data-channel="${c}"
            ${d.channels.includes(c) ? 'checked' : ''}
            style="accent-color:#4a9eff;width:14px;height:14px;cursor:pointer;">
        </td>`).join('');
      return `<tr style="border-bottom:1px solid rgba(255,255,255,0.05);${dimmed}">
        <td style="padding:6px 8px;text-align:center;">
          <input type="checkbox" data-domain="${escapeHtml(d.domain)}" data-field="enabled"
            ${d.enabled ? 'checked' : ''}
            style="accent-color:#4a9eff;width:14px;height:14px;cursor:pointer;">
        </td>
        <td style="padding:6px 8px;font-size:12px;color:#ddd;white-space:nowrap;">${label}</td>
        <td style="padding:6px 8px;">
          <select data-domain="${escapeHtml(d.domain)}" data-field="minSeverity"
            style="background:#222;color:#ddd;border:1px solid rgba(255,255,255,0.15);border-radius:3px;padding:2px 4px;font-size:12px;">
            ${severityOptions}
          </select>
        </td>
        ${channelCells}
        <td style="padding:6px 8px;text-align:center;">
          <input type="checkbox" data-domain="${escapeHtml(d.domain)}" data-field="quietHoursOverride"
            ${d.quietHoursOverride ? 'checked' : ''}
            style="accent-color:#4a9eff;width:14px;height:14px;cursor:pointer;">
        </td>
      </tr>`;
    }).join('');

    const tableBlock = `
      <section style="padding:6px 4px 10px;">
        <div style="overflow-x:auto;">
          <table style="width:100%;border-collapse:collapse;font-size:11px;color:#bbb;">
            <thead><tr style="border-bottom:1px solid rgba(255,255,255,0.12);">${headerCells}</tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </section>`;

    return `<div class="np-panel">${globalBlock}${quietBlock}${tableBlock}</div>`;
  }

  private wireHandlers(): void {
    const root = this.getContentElement();
    const svc = getNotificationPreferencesService();

    const globalEnabledEl = root.querySelector<HTMLInputElement>('#np-global-enabled');
    globalEnabledEl?.addEventListener('change', () => {
      svc.setGlobalEnabled(globalEnabledEl.checked);
    });

    const rateLimitEl = root.querySelector<HTMLInputElement>('#np-rate-limit');
    rateLimitEl?.addEventListener('change', () => {
      svc.setRateLimitPerHour(Number(rateLimitEl.value));
    });

    const voiceEnabledEl = root.querySelector<HTMLInputElement>('#np-voice-enabled');
    voiceEnabledEl?.addEventListener('change', () => {
      saveVoiceSettings({ ...getVoiceSettings(), enabled: voiceEnabledEl.checked });
    });

    const qhEnabledEl = root.querySelector<HTMLInputElement>('#np-qh-enabled');
    const qhStartEl = root.querySelector<HTMLInputElement>('#np-qh-start');
    const qhEndEl = root.querySelector<HTMLInputElement>('#np-qh-end');
    const writeQh = (): void => {
      svc.setQuietHours({
        enabled: !!qhEnabledEl?.checked,
        startHour: Number(qhStartEl?.value ?? 0),
        endHour: Number(qhEndEl?.value ?? 0),
      });
    };
    qhEnabledEl?.addEventListener('change', writeQh);
    qhStartEl?.addEventListener('change', writeQh);
    qhEndEl?.addEventListener('change', writeQh);

    for (const el of root.querySelectorAll<HTMLInputElement>('input[data-field="enabled"]')) {
      el.addEventListener('change', () => {
        const domain = el.dataset.domain;
        if (domain) svc.setDomainPreference(domain, { enabled: el.checked });
      });
    }
    for (const el of root.querySelectorAll<HTMLInputElement>('input[data-field="quietHoursOverride"]')) {
      el.addEventListener('change', () => {
        const domain = el.dataset.domain;
        if (domain) svc.setDomainPreference(domain, { quietHoursOverride: el.checked });
      });
    }
    for (const el of root.querySelectorAll<HTMLSelectElement>('select[data-field="minSeverity"]')) {
      el.addEventListener('change', () => {
        const domain = el.dataset.domain;
        if (domain) svc.setDomainPreference(domain, { minSeverity: el.value as Severity });
      });
    }
    for (const el of root.querySelectorAll<HTMLInputElement>('input[data-channel]')) {
      el.addEventListener('change', () => {
        const domain = el.dataset.domain;
        const channel = el.dataset.channel as NotificationChannel | undefined;
        if (!domain || !channel) return;
        const current = svc.getPreferences().domains.find((d) => d.domain === domain);
        if (!current) return;
        const next = el.checked
          ? [...new Set([...current.channels, channel])]
          : current.channels.filter((c) => c !== channel);
        svc.setDomainPreference(domain, { channels: next });
      });
    }
  }
}
