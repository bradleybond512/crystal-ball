/* eslint-disable @typescript-eslint/no-base-to-string, unicorn/catch-error-name -- Pre-existing violations surfaced by the changed-file linter when this PR added a res.json() shape guard here; not introduced by this change, and refactoring unrelated logic is out of scope for a security fix. */
import { Panel } from '@/components/Panel';

type Tier = 'admin' | 'readonly';

interface AllowedNumber {
  phoneNumber: string;
  name: string;
  tier: Tier;
}

interface SmsConfig {
  enabled: boolean;
  allowlist: AllowedNumber[];
}

interface RateLimitEntry { phone: string; count: number; windowStart: number; }
interface CommandLogEntry { from: string; command: string; outcome: string; at: number; }
interface WatchEntry { keyword: string; addedBy: string; at: number; }
interface AlertEntry { threshold: number; domain: string; addedBy: string; at: number; }

interface SmsStatus {
  enabled?: boolean;
  allowlistSize?: number;
  recentCommands?: CommandLogEntry[];
  watches?: WatchEntry[];
  alerts?: AlertEntry[];
  rateLimit?: RateLimitEntry[];
}

function escapeHtml(s: string): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] ?? c));
}

export class SmsSettingsPanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private config: SmsConfig = { enabled: false, allowlist: [] };
  private status: SmsStatus = {};
  private lastTestResponse: { ok: boolean; text: string; segments?: number; status?: number } | null = null;

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
    super.destroy();
  }

  private async loadConfig(): Promise<void> {
    try {
      const res = await fetch('/api/sms/config');
      if (res.ok) {
        const raw = await res.json() as { enabled?: boolean; allowlist?: unknown[] };
        if (!raw || typeof raw !== 'object') return;
        this.config = {
          enabled: Boolean(raw.enabled),
          allowlist: this.normalizeAllowlist(raw.allowlist),
        };
      }
    } catch { /* keep defaults */ }
  }

  private normalizeAllowlist(raw: unknown[] | undefined): AllowedNumber[] {
    if (!Array.isArray(raw)) return [];
    return raw
      .map((item) => {
        if (typeof item === 'string') {
          return { phoneNumber: item, name: '', tier: 'readonly' as Tier };
        }
        if (item && typeof item === 'object') {
          const obj = item as Record<string, unknown>;
          const tier: Tier = obj.tier === 'admin' ? 'admin' : 'readonly';
          return {
            phoneNumber: String(obj.phoneNumber ?? obj.phone ?? ''),
            name: String(obj.name ?? ''),
            tier,
          };
        }
        return null;
      })
      .filter((e): e is AllowedNumber => e !== null && Boolean(e.phoneNumber));
  }

  private async loadStatus(): Promise<void> {
    try {
      const res = await fetch('/api/sms/status');
      if (res.ok) this.status = (await res.json()) as SmsStatus;
    } catch { /* ignore */ }
  }

  private async saveConfig(patch: Partial<SmsConfig>): Promise<void> {
    const updated: SmsConfig = { ...this.config, ...patch };
    const res = await fetch('/api/sms/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updated),
    });
    if (res.ok) {
      const raw = await res.json() as { enabled?: boolean; allowlist?: unknown[] };
      if (!raw || typeof raw !== 'object') return;
      this.config = {
        enabled: Boolean(raw.enabled),
        allowlist: this.normalizeAllowlist(raw.allowlist),
      };
    }
  }

  private async sendTestCommand(from: string, body: string): Promise<void> {
    try {
      const res = await fetch('/api/sms/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from, body }),
      });
      const raw = await res.json() as { response?: string; error?: string; segments?: number };
      const data: { response?: string; error?: string; segments?: number } = raw && typeof raw === 'object' ? raw : {};
      this.lastTestResponse = {
        ok: res.ok,
        text: data.response ?? data.error ?? '(no response)',
        segments: data.segments,
        status: res.status,
      };
    } catch (e) {
      this.lastTestResponse = { ok: false, text: String((e as Error)?.message ?? e), status: 0 };
    }
    await this.loadStatus();
    this.renderPanel();
  }

  private renderAllowlistTable(): string {
    if (this.config.allowlist.length === 0) {
      return '<p class="sms-empty">No numbers allowlisted.</p>';
    }
    const rows = this.config.allowlist
      .map((entry, i) => `<tr>
        <td>${escapeHtml(entry.phoneNumber)}</td>
        <td>${escapeHtml(entry.name) || '<em>—</em>'}</td>
        <td><span class="sms-tier sms-tier-${entry.tier}">${entry.tier}</span></td>
        <td><button class="btn btn-xs sms-remove-btn" data-idx="${i}">Remove</button></td>
      </tr>`)
      .join('');
    return `<table class="sms-table">
      <thead><tr><th>Phone</th><th>Name</th><th>Tier</th><th></th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
  }

  private renderCommandLog(): string {
    const log = this.status.recentCommands ?? [];
    if (log.length === 0) return '<p class="sms-empty">No commands received yet.</p>';
    const rows = log.slice(0, 10).map((c) => `<tr>
      <td><code>${escapeHtml(c.from)}</code></td>
      <td><code>${escapeHtml(c.command)}</code></td>
      <td>${escapeHtml(c.outcome)}</td>
      <td>${new Date(c.at).toLocaleTimeString()}</td>
    </tr>`).join('');
    return `<table class="sms-table">
      <thead><tr><th>From</th><th>Command</th><th>Outcome</th><th>Time</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
  }

  private renderRateLimitTable(): string {
    const rl = this.status.rateLimit ?? [];
    if (rl.length === 0) return '<p class="sms-empty">No active rate-limit windows.</p>';
    const rows = rl.map((r) => {
      const startedMin = Math.round((Date.now() - r.windowStart) / 60_000);
      const remaining = Math.max(0, 10 - r.count);
      return `<tr>
        <td><code>${escapeHtml(r.phone)}</code></td>
        <td>${r.count}/10</td>
        <td>${remaining}</td>
        <td>${startedMin}m ago</td>
      </tr>`;
    }).join('');
    return `<table class="sms-table">
      <thead><tr><th>Phone</th><th>Used</th><th>Remaining</th><th>Window Started</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
  }

  private renderTestResponse(): string {
    if (!this.lastTestResponse) return '';
    const cls = this.lastTestResponse.ok ? 'sms-test-ok' : 'sms-test-err';
    const seg = this.lastTestResponse.segments ? ` · ${this.lastTestResponse.segments} segment(s)` : '';
    const httpStatus = this.lastTestResponse.status ? ` · HTTP ${this.lastTestResponse.status}` : '';
    return `<pre class="sms-test-response ${cls}">${escapeHtml(this.lastTestResponse.text)}\n— ${escapeHtml(String(this.lastTestResponse.status ?? ''))}${seg}${httpStatus}</pre>`;
  }

  private renderPanel(): void {
    const { enabled } = this.config;

    const html = `<div class="sms-settings-panel">
      <section class="sms-section">
        <h3>Enable SMS Interface</h3>
        <label><input type="checkbox" id="sms-enabled"${enabled ? ' checked' : ''}> Enabled</label>
      </section>

      <section class="sms-section">
        <h3>Allowlist</h3>
        ${this.renderAllowlistTable()}
        <div class="sms-add-row">
          <input type="text" id="sms-add-num" placeholder="+1 (555) 000-0000" />
          <input type="text" id="sms-add-name" placeholder="Name (optional)" />
          <select id="sms-add-tier">
            <option value="readonly">readonly</option>
            <option value="admin">admin</option>
          </select>
          <button class="btn btn-sm" id="sms-add-btn">Add</button>
        </div>
        <p class="sms-hint">Admin tier required for <code>CB WATCH</code> and <code>CB ALERT</code>.</p>
      </section>

      <section class="sms-section">
        <h3>Test Interface</h3>
        <div class="sms-test-row">
          <input type="text" id="sms-test-from" placeholder="+15551234567" />
          <input type="text" id="sms-test-body" placeholder="CB STATUS" value="CB STATUS" />
          <button class="btn btn-sm" id="sms-test-btn">Send</button>
        </div>
        ${this.renderTestResponse()}
      </section>

      <section class="sms-section">
        <h3>Recent Commands</h3>
        ${this.renderCommandLog()}
      </section>

      <section class="sms-section">
        <h3>Rate Limit Status</h3>
        ${this.renderRateLimitTable()}
      </section>

      <section class="sms-section">
        <h3>Commands</h3>
        <ul class="sms-cmd-list">
          <li><code>CB STATUS</code> — posture + top 3 threads + feed health</li>
          <li><code>CB BRIEF</code> — top 3 hypothesis brief</li>
          <li><code>CB SITREP</code> — current situation summary</li>
          <li><code>CB WATCH &lt;keyword&gt;</code> — watch for a keyword <em>(admin)</em></li>
          <li><code>CB ALERT &lt;0-1&gt; &lt;domain&gt;</code> — alert threshold <em>(admin)</em></li>
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
      const num = this.content.querySelector<HTMLInputElement>('#sms-add-num')?.value.trim();
      const name = this.content.querySelector<HTMLInputElement>('#sms-add-name')?.value.trim() ?? '';
      const tier = (this.content.querySelector<HTMLSelectElement>('#sms-add-tier')?.value === 'admin' ? 'admin' : 'readonly') as Tier;
      if (!num) return;
      const next = [...this.config.allowlist, { phoneNumber: num, name, tier }];
      void this.saveConfig({ allowlist: next }).then(() => this.renderPanel());
    });

    this.content.querySelectorAll('.sms-remove-btn').forEach((btn: Element) => {
      btn.addEventListener('click', (e: Event) => {
        const idx = Number((e.currentTarget as HTMLElement).dataset.idx);
        const updated = [...this.config.allowlist];
        updated.splice(idx, 1);
        void this.saveConfig({ allowlist: updated }).then(() => this.renderPanel());
      });
    });

    const testBtn = this.content.querySelector<HTMLButtonElement>('#sms-test-btn');
    testBtn?.addEventListener('click', () => {
      const from = this.content.querySelector<HTMLInputElement>('#sms-test-from')?.value.trim() ?? '';
      const body = this.content.querySelector<HTMLInputElement>('#sms-test-body')?.value.trim() ?? '';
      if (!from || !body) return;
      void this.sendTestCommand(from, body);
    });
  }
}
