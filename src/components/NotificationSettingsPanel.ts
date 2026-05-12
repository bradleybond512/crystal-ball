 
import { Panel } from './Panel';
import {
  getSettings,
  resetSettings,
  updateDomainSettings,
  updateGlobalSettings,
  type NotificationDomain,
} from '@/services/notifications/notification-settings-service';
import { record as recordHistory } from '@/services/notifications/notification-history-service';
import { escapeHtml } from '@/utils/sanitize';
import {
  buildTestHistoryEntry,
  SETTINGS_DOMAIN_LABELS as DOMAIN_LABELS,
  SETTINGS_DOMAINS as ALL_DOMAINS,
} from './notification-settings-helpers';

export class NotificationSettingsPanel extends Panel {
  private settingsChangeListener: (() => void) | null = null;

  constructor() {
    super({
      id: 'notification-settings',
      title: 'Notification Settings',
      showCount: true,
      trackActivity: false,
      infoTooltip:
        'Per-domain notification mute, severity threshold, delivery channel, and quiet hours.',
    });
    this.settingsChangeListener = () => this.render();
    document.addEventListener('wm:notification-settings-changed', this.settingsChangeListener);
    this.render();
  }

  private fireTestNotification(domain: NotificationDomain): void {
    const threshold = getSettings().domains[domain].threshold;
    recordHistory(buildTestHistoryEntry(domain, threshold));
  }

  public override destroy(): void {
    if (this.settingsChangeListener) {
      document.removeEventListener(
        'wm:notification-settings-changed',
        this.settingsChangeListener,
      );
      this.settingsChangeListener = null;
    }
    super.destroy();
  }

  private render(): void {
    const settings = getSettings();
    const mutedOrDisabled = ALL_DOMAINS.filter(
      (d) => settings.global.masterMute || !settings.domains[d].enabled,
    ).length;
    this.setCount(mutedOrDisabled);
    this.setContent(this.buildHtml());
    queueMicrotask(() => this.wireHandlers());
  }

  private buildHtml(): string {
    const s = getSettings();
    const g = s.global;

    const globalSection = `
      <div style="padding:10px 12px;border-bottom:1px solid var(--border-subtle,#333);">
        <div style="font-size:11px;font-weight:700;color:var(--text-secondary,#aaa);text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px;">Global</div>
        <div style="display:flex;flex-wrap:wrap;gap:12px;align-items:center;">
          <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:13px;color:#ddd;">
            <input type="checkbox" id="ns-master-mute" ${g.masterMute ? 'checked' : ''}
              style="accent-color:var(--accent,#4a9eff);width:14px;height:14px;cursor:pointer;">
            Mute all notifications
          </label>
          <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:13px;color:#ddd;">
            <input type="checkbox" id="ns-daily-summary" ${g.dailySummaryEnabled ? 'checked' : ''}
              style="accent-color:var(--accent,#4a9eff);width:14px;height:14px;cursor:pointer;">
            Daily summary
          </label>
          <div style="display:flex;align-items:center;gap:8px;font-size:13px;color:#ddd;">
            <span>Quiet hours</span>
            <input type="time" id="ns-quiet-start" value="${escapeHtml(g.quietHoursStart)}"
              style="background:#222;color:#ddd;border:1px solid var(--border-subtle,#333);border-radius:3px;padding:2px 6px;font-size:12px;cursor:pointer;">
            <span style="color:var(--text-secondary,#aaa);">to</span>
            <input type="time" id="ns-quiet-end" value="${escapeHtml(g.quietHoursEnd)}"
              style="background:#222;color:#ddd;border:1px solid var(--border-subtle,#333);border-radius:3px;padding:2px 6px;font-size:12px;cursor:pointer;">
          </div>
        </div>
      </div>`;

    const domainRows = ALL_DOMAINS.map((domain) => {
      const ds = s.domains[domain];
      const label = escapeHtml(DOMAIN_LABELS[domain]);
      const disabledStyle = (!ds.enabled || g.masterMute) ? 'opacity:0.5;' : '';
      return `
        <tr style="border-bottom:1px solid var(--border-subtle,#333);${disabledStyle}">
          <td style="padding:6px 8px;font-size:13px;color:#ddd;white-space:nowrap;">${label}</td>
          <td style="padding:6px 8px;text-align:center;">
            <input type="checkbox" data-domain="${domain}" data-field="enabled"
              ${ds.enabled ? 'checked' : ''}
              style="accent-color:var(--accent,#4a9eff);width:14px;height:14px;cursor:pointer;">
          </td>
          <td style="padding:6px 8px;">
            <select data-domain="${domain}" data-field="threshold"
              style="background:#222;color:#ddd;border:1px solid var(--border-subtle,#333);border-radius:3px;padding:2px 4px;font-size:12px;cursor:pointer;">
              ${(['info', 'low', 'medium', 'high', 'critical'] as const).map(
                (sev) => `<option value="${sev}" ${ds.threshold === sev ? 'selected' : ''}>${escapeHtml(sev)}</option>`,
              ).join('')}
            </select>
          </td>
          <td style="padding:6px 8px;">
            <select data-domain="${domain}" data-field="channel"
              style="background:#222;color:#ddd;border:1px solid var(--border-subtle,#333);border-radius:3px;padding:2px 4px;font-size:12px;cursor:pointer;">
              <option value="in_app" ${ds.channel === 'in_app' ? 'selected' : ''}>In-App</option>
              <option value="native" ${ds.channel === 'native' ? 'selected' : ''}>Native macOS</option>
              <option value="both" ${ds.channel === 'both' ? 'selected' : ''}>Both</option>
            </select>
          </td>
          <td style="padding:6px 8px;text-align:center;">
            <label style="display:flex;align-items:center;gap:4px;cursor:pointer;font-size:12px;color:var(--text-secondary,#aaa);white-space:nowrap;">
              <input type="checkbox" data-domain="${domain}" data-field="quietHoursEnabled"
                ${ds.quietHoursEnabled ? 'checked' : ''}
                style="accent-color:var(--accent,#4a9eff);width:13px;height:13px;cursor:pointer;">
              Quiet hrs
            </label>
          </td>
          <td style="padding:6px 8px;text-align:center;">
            <button type="button" data-action="test-notification" data-domain="${domain}"
              title="Fire a synthetic ${escapeHtml(DOMAIN_LABELS[domain])} alert into the history ring"
              style="background:rgba(74,158,255,0.12);color:var(--accent,#4a9eff);border:1px solid var(--accent,#4a9eff);border-radius:3px;padding:2px 8px;font-size:11px;cursor:pointer;white-space:nowrap;">
              Test
            </button>
          </td>
        </tr>`;
    }).join('');

    const tableSection = `
      <div style="padding:10px 12px;">
        <div style="font-size:11px;font-weight:700;color:var(--text-secondary,#aaa);text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px;">Per-Domain</div>
        <div style="overflow-x:auto;">
          <table style="width:100%;border-collapse:collapse;font-size:12px;">
            <thead>
              <tr style="border-bottom:1px solid var(--border-subtle,#333);">
                <th style="padding:4px 8px;text-align:left;color:var(--text-secondary,#aaa);font-weight:600;">Domain</th>
                <th style="padding:4px 8px;text-align:center;color:var(--text-secondary,#aaa);font-weight:600;">Enabled</th>
                <th style="padding:4px 8px;text-align:left;color:var(--text-secondary,#aaa);font-weight:600;">Threshold</th>
                <th style="padding:4px 8px;text-align:left;color:var(--text-secondary,#aaa);font-weight:600;">Channel</th>
                <th style="padding:4px 8px;text-align:center;color:var(--text-secondary,#aaa);font-weight:600;">Quiet Hrs</th>
                <th style="padding:4px 8px;text-align:center;color:var(--text-secondary,#aaa);font-weight:600;">Test</th>
              </tr>
            </thead>
            <tbody>
              ${domainRows}
            </tbody>
          </table>
        </div>
      </div>`;

    const footerSection = `
      <div style="padding:10px 12px;border-top:1px solid var(--border-subtle,#333);display:flex;justify-content:flex-end;gap:8px;">
        <button type="button" id="ns-reset-defaults"
          title="Reset every domain + global settings to defaults"
          style="background:transparent;color:var(--text-secondary,#aaa);border:1px solid var(--border-subtle,#444);border-radius:3px;padding:4px 12px;font-size:12px;cursor:pointer;">
          Reset to defaults
        </button>
      </div>`;

    return `<div style="font-size:13px;">${globalSection}${tableSection}${footerSection}</div>`;
  }

  private wireHandlers(): void {
    const root = this.content;

    const masterMute = root.querySelector<HTMLInputElement>('#ns-master-mute');
    masterMute?.addEventListener('change', () => {
      updateGlobalSettings({ masterMute: masterMute.checked });
    });

    const dailySummary = root.querySelector<HTMLInputElement>('#ns-daily-summary');
    dailySummary?.addEventListener('change', () => {
      updateGlobalSettings({ dailySummaryEnabled: dailySummary.checked });
    });

    const quietStart = root.querySelector<HTMLInputElement>('#ns-quiet-start');
    quietStart?.addEventListener('change', () => {
      updateGlobalSettings({ quietHoursStart: quietStart.value });
    });

    const quietEnd = root.querySelector<HTMLInputElement>('#ns-quiet-end');
    quietEnd?.addEventListener('change', () => {
      updateGlobalSettings({ quietHoursEnd: quietEnd.value });
    });

    const resetBtn = root.querySelector<HTMLButtonElement>('#ns-reset-defaults');
    resetBtn?.addEventListener('click', () => {
      // Service auto-persists the reset; re-render via the
      // wm:notification-settings-changed listener wired in the constructor.
      // Emit a fresh change event ourselves since resetSettings() doesn't.
      resetSettings();
      document.dispatchEvent(
        new CustomEvent('wm:notification-settings-changed', { detail: getSettings() }),
      );
    });

    for (const btn of root.querySelectorAll<HTMLButtonElement>('[data-action="test-notification"]')) {
      btn.addEventListener('click', () => {
        const domain = btn.dataset.domain as NotificationDomain | undefined;
        if (!domain) return;
        this.fireTestNotification(domain);
      });
    }

    for (const el of root.querySelectorAll<HTMLInputElement | HTMLSelectElement>(
      '[data-domain][data-field]',
    )) {
      el.addEventListener('change', () => {
        const domain = el.dataset.domain as NotificationDomain;
        const field = el.dataset.field;
        if (!domain || !field) return;

        if (field === 'enabled' && el instanceof HTMLInputElement) {
          updateDomainSettings(domain, { enabled: el.checked });
        } else if (field === 'quietHoursEnabled' && el instanceof HTMLInputElement) {
          updateDomainSettings(domain, { quietHoursEnabled: el.checked });
        } else if (field === 'threshold' && el instanceof HTMLSelectElement) {
          updateDomainSettings(domain, {
            threshold: el.value as 'info' | 'low' | 'medium' | 'high' | 'critical',
          });
        } else if (field === 'channel' && el instanceof HTMLSelectElement) {
          updateDomainSettings(domain, {
            channel: el.value as 'in_app' | 'native' | 'both',
          });
        }
      });
    }
  }
}
