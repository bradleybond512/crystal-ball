import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';
import { getApiBaseUrl } from '@/services/runtime';
import type { Watchboard, WatchboardFiring, WatchboardTemplate } from '@/types/watchboard';

const REFRESH_MS = 30_000;

export class WatchboardPanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private watchboards: Watchboard[] = [];
  private firings: WatchboardFiring[] = [];
  private formVisible = false;
  private templates: WatchboardTemplate[] = [];

  constructor() {
    super({ id: 'watchboards', title: 'Watchboards & Tripwires' });
    void this.fetchData();
    this.refreshTimer = setInterval(() => void this.fetchData(), REFRESH_MS);
  }

  override destroy(): void {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    super.destroy();
  }

  private async fetchData(): Promise<void> {
    try {
      const base = getApiBaseUrl();
      const [wbResp, firingsResp] = await Promise.all([
        fetch(`${base}/api/watchboards`, { headers: { Accept: 'application/json' } }),
        fetch(`${base}/api/watchboards/firings?limit=10`, { headers: { Accept: 'application/json' } }),
      ]);
      if (wbResp.ok) {
        const body = (await wbResp.json()) as { watchboards: Watchboard[] };
        this.watchboards = Array.isArray(body.watchboards) ? body.watchboards : [];
      }
      if (firingsResp.ok) {
        const body = (await firingsResp.json()) as { firings: WatchboardFiring[] };
        this.firings = Array.isArray(body.firings) ? body.firings : [];
      }
    } catch {
      // silently retain last-known state
    }
    this.render();
  }

  private async fetchTemplates(): Promise<void> {
    try {
      const resp = await fetch(`${getApiBaseUrl()}/api/watchboards/templates`, {
        headers: { Accept: 'application/json' },
      });
      if (resp.ok) {
        const body = (await resp.json()) as { templates: WatchboardTemplate[] };
        this.templates = Array.isArray(body.templates) ? body.templates : [];
      }
    } catch {
      this.templates = [];
    }
    this.render();
  }

  private async submitNewWatchboard(name: string, description: string, templateName: string): Promise<void> {
    try {
      await fetch(`${getApiBaseUrl()}/api/watchboards`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ name, description, tripwires: this.tripwiresFor(templateName), enabled: true }),
      });
    } catch {
      // ignore
    }
    this.formVisible = false;
    await this.fetchData();
  }

  /** Expand the chosen template into tripwire payloads (one per shape). The
   *  sidecar normalizes ids/timestamps; we only send name/shape/conditions. */
  private tripwiresFor(templateName: string): Array<Record<string, unknown>> {
    const tpl = this.templates.find((t) => t.name === templateName);
    if (!tpl) return [];
    return tpl.shapes.map((shape, i) => ({
      name: tpl.shapes.length > 1 ? `${tpl.name} (${i + 1})` : tpl.name,
      shape,
      conditions: tpl.conditions,
      enabled: true,
    }));
  }

  private render(): void {
    this.setContent(this.buildHtml());
    this.bindEvents();
  }

  private buildHtml(): string {
    const wbSection = this.renderWatchboards();
    const firingsSection = this.renderFirings();
    const formSection = this.renderForm();
    return `
      <div class="wb-panel" style="padding:8px;font-size:13px;">
        ${wbSection}
        ${firingsSection}
        <div style="margin-top:10px;">
          <button id="wb-toggle-form" style="padding:4px 10px;cursor:pointer;font-size:12px;">+ New Watchboard</button>
        </div>
        ${formSection}
      </div>`;
  }

  private renderWatchboards(): string {
    if (this.watchboards.length === 0) {
      return `<div style="color:#888;margin-bottom:8px;">No watchboards configured.</div>`;
    }
    const rows = this.watchboards.map((wb) => {
      const totalFires = wb.tripwires.reduce((sum, t) => sum + (t.fireCount ?? 0), 0);
      const badge = wb.enabled
        ? `<span style="color:#4caf50;font-size:11px;">enabled</span>`
        : `<span style="color:#888;font-size:11px;">disabled</span>`;
      return `
        <div style="border-bottom:1px solid #333;padding:5px 0;">
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <strong>${escapeHtml(wb.name)}</strong>
            ${badge}
          </div>
          ${wb.description ? `<div style="color:#aaa;font-size:12px;">${escapeHtml(wb.description)}</div>` : ''}
          <div style="color:#999;font-size:11px;margin-top:2px;">
            ${wb.tripwires.length} tripwire${wb.tripwires.length !== 1 ? 's' : ''} &middot; ${totalFires} fire${totalFires !== 1 ? 's' : ''}
          </div>
        </div>`;
    }).join('');
    return `
      <div style="margin-bottom:10px;">
        <div style="font-weight:600;margin-bottom:4px;text-transform:uppercase;font-size:11px;color:#aaa;">Watchboards</div>
        ${rows}
      </div>`;
  }

  private renderFirings(): string {
    const sorted = [...this.firings].sort(
      (a, b) => new Date(b.firedAt).getTime() - new Date(a.firedAt).getTime(),
    );
    if (sorted.length === 0) {
      return `<div style="color:#888;margin-bottom:8px;">No recent firings.</div>`;
    }
    const rows = sorted.map((f) => {
      const time = new Date(f.firedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      const severity = f.severity != null ? ` &middot; sev ${f.severity}` : '';
      return `
        <div style="border-bottom:1px solid #333;padding:4px 0;font-size:12px;">
          <span style="color:#aaa;margin-right:6px;">${escapeHtml(time)}</span>
          <span style="margin-right:6px;">${escapeHtml(f.tripwireId)}</span>
          <span style="color:#7ec8e3;">${escapeHtml(f.domain)}${severity}</span>
        </div>`;
    }).join('');
    return `
      <div style="margin-bottom:10px;">
        <div style="font-weight:600;margin-bottom:4px;text-transform:uppercase;font-size:11px;color:#aaa;">Recent Firings</div>
        ${rows}
      </div>`;
  }

  private renderForm(): string {
    if (!this.formVisible) return '';
    const templateOptions = this.templates.map(
      (t) => `<option value="${escapeHtml(t.name)}">${escapeHtml(t.name)}</option>`,
    ).join('');
    const templateSelect = this.templates.length > 0
      ? `<div style="margin-bottom:6px;">
           <label style="display:block;font-size:11px;color:#aaa;margin-bottom:2px;">Template</label>
           <select id="wb-template" style="width:100%;padding:4px;font-size:12px;background:#222;color:#eee;border:1px solid #444;">
             <option value="">-- none --</option>
             ${templateOptions}
           </select>
         </div>`
      : '';
    return `
      <div id="wb-form" style="margin-top:8px;padding:10px;border:1px solid #444;background:#1a1a1a;">
        <div style="font-weight:600;margin-bottom:8px;font-size:12px;">New Watchboard</div>
        <div style="margin-bottom:6px;">
          <label style="display:block;font-size:11px;color:#aaa;margin-bottom:2px;">Name</label>
          <input id="wb-name" type="text" style="width:100%;padding:4px;font-size:12px;background:#222;color:#eee;border:1px solid #444;box-sizing:border-box;" />
        </div>
        <div style="margin-bottom:6px;">
          <label style="display:block;font-size:11px;color:#aaa;margin-bottom:2px;">Description</label>
          <input id="wb-desc" type="text" style="width:100%;padding:4px;font-size:12px;background:#222;color:#eee;border:1px solid #444;box-sizing:border-box;" />
        </div>
        ${templateSelect}
        <div style="display:flex;gap:6px;margin-top:8px;">
          <button id="wb-submit" style="padding:4px 12px;cursor:pointer;font-size:12px;">Create</button>
          <button id="wb-cancel" style="padding:4px 10px;cursor:pointer;font-size:12px;background:#333;border:1px solid #555;color:#ccc;">Cancel</button>
        </div>
      </div>`;
  }

  private bindEvents(): void {
    const el = this.getContentElement();

    const toggleBtn = el.querySelector<HTMLButtonElement>('#wb-toggle-form');
    toggleBtn?.addEventListener('click', () => {
      this.formVisible = !this.formVisible;
      if (this.formVisible && this.templates.length === 0) {
        void this.fetchTemplates();
      } else {
        this.render();
      }
    });

    const cancelBtn = el.querySelector<HTMLButtonElement>('#wb-cancel');
    cancelBtn?.addEventListener('click', () => {
      this.formVisible = false;
      this.render();
    });

    const submitBtn = el.querySelector<HTMLButtonElement>('#wb-submit');
    submitBtn?.addEventListener('click', () => {
      const name = (el.querySelector<HTMLInputElement>('#wb-name')?.value ?? '').trim();
      const desc = (el.querySelector<HTMLInputElement>('#wb-desc')?.value ?? '').trim();
      const template = el.querySelector<HTMLSelectElement>('#wb-template')?.value ?? '';
      if (!name) return;
      void this.submitNewWatchboard(name, desc, template);
    });
  }
}
