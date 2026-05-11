import { Panel } from '@/components/Panel';

export class SmsSettingsPanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private config: { enabled: boolean; allowlist: string[] } = { enabled: false, allowlist: [] };
  private status: { recentCommands?: { from: string; body: string; at: number }[] } = {};

  constructor() {
    super({ id: 'sms-command-interface', title: 'SMS Command Interface' });
    this.load();
  }

  private load(): void {
    void Promise.all([this.loadConfig(), this.loadStatus()]).then(() => {
      this.renderPanel();
      this.refreshTimer = setInterval(() => {
        void this.loadStatus().then(() => this.renderPanel());
      }, 30_000);
    });
  }

  destroy(): void {
    if (this.refreshTimer !== null) clearInterval(this.refreshTimer);
  }

  private async loadConfig(): Promise<void> {
    try {
      const res = await fetch('/api/sms/config');
      if (res.ok) this.config = (await res.json()) as typeof this.config;
    } catch { /* use defaults */ }
  }

  private async loadStatus(): Promise<void> {
    try {
      const res = await fetch('/api/sms/status');
      if (res.ok) this.status = (await res.json()) as typeof this.status;
    } catch { /* ignore */ }
  }

  private async saveConfig(patch: Partial<typeof this.config>): Promise<void> {
    const updated = { ...this.config, ...patch };
    const res = await fetch('/api/sms/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updated),
    });
    if (res.ok) this.config = updated;
  }

  private renderPanel(): void {
    const { enabled, allowlist } = this.config;
    const recentCommands = this.status.recentCommands ?? [];

    const allowlistRows = allowlist
      .map((num, i) => `<tr><td>${num}</td><td><button class="btn btn-xs sms-remove-btn" data-idx="${i}">Remove</button></td></tr>`)
      .join('');

    const commandRows = recentCommands
      .slice(0, 10)
      .map(c => `<tr><td>${c.from}</td><td><code>${c.body}</code></td><td>${new Date(c.at).toLocaleTimeString()}</td></tr>`)
      .join('');

    const allowlistSection = allowlist.length === 0
      ? '<p class="sms-empty">No numbers allowlisted.</p>'
      : `<table><tbody>${allowlistRows}</tbody></table>`;

    const commandSection = recentCommands.length === 0
      ? '<p class="sms-empty">No commands received yet.</p>'
      : `<table><thead><tr><th>From</th><th>Command</th><th>Time</th></tr></thead><tbody>${commandRows}</tbody></table>`;

    const html = `<div class="sms-settings-panel">
      <section class="sms-section">
        <h3>Enable SMS Interface</h3>
        <label><input type="checkbox" id="sms-enabled"${enabled ? ' checked' : ''}> Enabled</label>
      </section>
      <section class="sms-section">
        <h3>Allowlisted Numbers</h3>
        ${allowlistSection}
        <div class="sms-add-row">
          <input type="text" id="sms-add-num" placeholder="+1 (555) 000-0000">
          <button class="btn btn-sm" id="sms-add-btn">Add</button>
        </div>
      </section>
      <section class="sms-section">
        <h3>Recent Commands</h3>
        ${commandSection}
      </section>
      <section class="sms-section">
        <h3>Commands</h3>
        <ul>
          <li><code>CB STATUS</code> — current posture + top threads</li>
          <li><code>CB BRIEF</code> — top hypothesis detail</li>
          <li><code>CB ALERTS [domain]</code> — active alerts</li>
          <li><code>CB FEEDS</code> — feed health summary</li>
          <li><code>CB HELP</code> — command list</li>
        </ul>
      </section>
    </div>`;

    this.setContent(html);
    this.wireEvents();
  }

  private wireEvents(): void {
    const enabledBox = this.content.querySelector<HTMLInputElement>('#sms-enabled');
    enabledBox?.addEventListener('change', (e: Event) => {
      void this.saveConfig({ enabled: (e.target as HTMLInputElement).checked }).then(() => this.renderPanel());
    });

    const addBtn = this.content.querySelector<HTMLButtonElement>('#sms-add-btn');
    addBtn?.addEventListener('click', () => {
      const input = this.content.querySelector<HTMLInputElement>('#sms-add-num');
      const num = input?.value.trim();
      if (num) {
        void this.saveConfig({ allowlist: [...this.config.allowlist, num] }).then(() => this.renderPanel());
        if (input) input.value = '';
      }
    });

    this.content.querySelectorAll('.sms-remove-btn').forEach((btn: Element) => {
      btn.addEventListener('click', (e: Event) => {
        const idx = Number((e.currentTarget as HTMLElement).dataset.idx);
        const updated = [...this.config.allowlist];
        updated.splice(idx, 1);
        void this.saveConfig({ allowlist: updated }).then(() => this.renderPanel());
      });
    });
  }
}
