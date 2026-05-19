import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';
import { getApiBaseUrl } from '@/services/runtime';

// ── Types mirroring the sidecar shapes from PR B + PR C ─────────────────

interface XmppMessage {
  at: number;
  sender: string;
  body: string;
  channel: string;
  priority: 'high' | 'normal' | 'low';
}

interface XmppSnapshot {
  configured: boolean;
  connected: boolean;
  joinedRooms: string[];
  lastMessage: string | null;
  lastConnectedAt: string | null;
  lastError: string | null;
  channels: Record<string, XmppMessage[]>;
}

interface TakFeed {
  uuid: string;
  name: string;
  type: string;
  address: string;
  protocol: string;
  auth: string;
}

interface TakFeedsResponse {
  configured: boolean;
  ok?: boolean;
  source?: 'cache' | 'live';
  feeds?: TakFeed[];
  fetchedAt?: number;
  error?: string;
  detail?: string;
}

type TabId = 'wire' | 'eventtracking' | 'emergency' | 'main' | 'offtopic' | 'tak';

const XMPP_REFRESH_MS = 10_000;
const TAK_REFRESH_MS = 60_000;

const TLS_PIN_MISMATCH_MSG = 'TLS certificate pin mismatch. The server\'s SHA-256 fingerprint does not match the pinned value. Either S2U rotated the cert (update the pin), or this is a man-in-the-middle. To bypass intentionally, set <code>S2U_TLS_INSECURE_OPT_IN=true</code> in Settings — at your own risk.';

function pickAccentColor(channelKey: string): string {
  if (channelKey === 'emergency') return '#fca5a5';
  if (channelKey === 'wire' || channelKey === 'eventtracking') return '#fde68a';
  return '#9ca3af';
}

function formatTakErrorMessage(error: string | undefined, detail: string | undefined): string {
  if (error === 'tls-pin-mismatch') return TLS_PIN_MISMATCH_MSG;
  const head = `TAK error: ${escapeHtml(String(error ?? 'unknown'))}`;
  if (!detail) return head;
  return `${head} — ${escapeHtml(detail)}`;
}

// Surfaces the S2 Underground IRT XMPP MUC rooms (PR B) and the public
// TAK server Marti API (PR C) inside Crystal Ball. Renders as a tabbed
// panel: Wire / Event Tracking / Emergency / Main / Off-Topic / TAK
// Feeds. Refuses to demand creds — when the sidecar reports
// configured=false, the panel shows a "Configure in Settings" empty
// state instead of a noisy error.
export class S2UIntelPanel extends Panel {
  private xmpp: XmppSnapshot | null = null;
  private tak: TakFeedsResponse | null = null;
  private xmppError: string | null = null;
  private takError: string | null = null;
  private activeTab: TabId = 'wire';
  private xmppTimer: number | null = null;
  private takTimer: number | null = null;

  constructor() {
 super({
 id: 's2u-intel',
 title: 'S2U Intelligence',
 showCount: true,
 trackActivity: true,
 infoTooltip: 'S2 Underground IRT XMPP wire/event/emergency MUC feeds + public TAK server Marti API. Configure creds in Settings → Tactical (TAK / S2U).',
 });
 this.showLoading('Connecting to S2U…');
 setTimeout(() => { void this.refresh(); }, 0);
 // Schedule independent refresh ticks for the two sources.
 this.xmppTimer = window.setInterval(() => { void this.refreshXmpp(); }, XMPP_REFRESH_MS);
 this.takTimer = window.setInterval(() => { void this.refreshTak(); }, TAK_REFRESH_MS);
  }

  override destroy(): void {
 if (this.xmppTimer !== null) {
 window.clearInterval(this.xmppTimer);
 this.xmppTimer = null;
 }
 if (this.takTimer !== null) {
 window.clearInterval(this.takTimer);
 this.takTimer = null;
 }
 super.destroy();
  }

  async refresh(): Promise<void> {
 await Promise.all([this.refreshXmpp(), this.refreshTak()]);
  }

  private async refreshXmpp(): Promise<void> {
 try {
 const res = await fetch(`${getApiBaseUrl()}/api/s2u-xmpp`);
 if (res.ok) {
 this.xmpp = (await res.json()) as XmppSnapshot;
 this.xmppError = null;
 } else {
 this.xmppError = `Sidecar returned HTTP ${res.status}`;
 }
 } catch (error) {
 this.xmppError = error instanceof Error ? error.message : String(error);
 }
 this.updateCount();
 this.render();
  }

  private async refreshTak(): Promise<void> {
 try {
 const res = await fetch(`${getApiBaseUrl()}/api/s2u-tak-feeds`);
 // 503 with a JSON body is the "not configured" signal — read the body.
 const body = (await res.json().catch(() => null)) as TakFeedsResponse | null;
 if (body) {
 this.tak = body;
 this.takError = null;
 } else {
 this.takError = `Sidecar returned HTTP ${res.status}`;
 }
 } catch (error) {
 this.takError = error instanceof Error ? error.message : String(error);
 }
 this.render();
  }

  private updateCount(): void {
 if (!this.xmpp) {
 this.setCount(0);
 return;
 }
 const total = ['wire', 'eventtracking', 'emergency'].reduce((sum, key) => {
 return sum + (this.xmpp?.channels?.[key]?.length ?? 0);
 }, 0);
 this.setCount(total);
  }

  private xmppHeaderState(): { dot: string; label: string } {
 if (this.xmpp?.connected) {
 return { dot: '#22c55e', label: `XMPP connected (${this.xmpp.joinedRooms.length}/5 rooms)` };
 }
 if (this.xmpp?.configured) {
 return { dot: '#f59e0b', label: 'XMPP configured, reconnecting…' };
 }
 return { dot: '#6b7280', label: 'XMPP not configured' };
  }

  private takHeaderState(): { dot: string; label: string } {
 if (this.tak?.configured && this.tak?.ok) {
 return { dot: '#22c55e', label: `TAK ok (${this.tak.feeds?.length ?? 0} feeds)` };
 }
 if (this.tak?.configured) {
 return { dot: '#ef4444', label: `TAK error: ${String(this.tak.error ?? 'unknown')}` };
 }
 return { dot: '#6b7280', label: 'TAK not configured' };
  }

  private renderHeader(): string {
 const xmpp = this.xmppHeaderState();
 const tak = this.takHeaderState();
 return `
 <div style="display:flex;gap:16px;padding:6px 10px;font-size:11px;border-bottom:1px solid var(--panel-border,#2a2a2c);background:rgba(255,255,255,0.02)">
 <span><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${xmpp.dot};margin-right:6px"></span>${escapeHtml(xmpp.label)}</span>
 <span><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${tak.dot};margin-right:6px"></span>${escapeHtml(tak.label)}</span>
 </div>`;
  }

  private renderTabs(): string {
 const takFeedSuffix = this.tak?.feeds ? ` (${this.tak.feeds.length})` : '';
 const takLabel = `TAK Feeds${takFeedSuffix}`;
 const tabs: { id: TabId; label: string; count?: number; emphasis?: boolean }[] = [
 { id: 'wire', label: 'Wire', count: this.xmpp?.channels?.wire?.length, emphasis: true },
 { id: 'eventtracking', label: 'Event Tracking', count: this.xmpp?.channels?.eventtracking?.length, emphasis: true },
 { id: 'emergency', label: 'Emergency', count: this.xmpp?.channels?.emergency?.length, emphasis: true },
 { id: 'main', label: 'Main', count: this.xmpp?.channels?.main?.length },
 { id: 'offtopic', label: 'Off-Topic', count: this.xmpp?.channels?.offtopic?.length },
 { id: 'tak', label: takLabel },
 ];
 const items = tabs.map(t => {
 const active = t.id === this.activeTab;
 const emphasis = t.emphasis && t.id === 'emergency';
 const bg = active ? 'rgba(255,255,255,0.08)' : 'transparent';
 const color = emphasis && (t.count ?? 0) > 0 ? '#fca5a5' : 'inherit';
 const countSuffix = typeof t.count === 'number' ? ` <span style="opacity:0.5">${t.count}</span>` : '';
 return `<button data-s2u-tab="${escapeHtml(t.id)}" style="background:${bg};color:${color};border:none;padding:6px 10px;font-size:11px;cursor:pointer;border-bottom:2px solid ${active ? '#3b82f6' : 'transparent'}">${escapeHtml(t.label)}${countSuffix}</button>`;
 }).join('');
 return `<div style="display:flex;border-bottom:1px solid var(--panel-border,#2a2a2c);background:rgba(255,255,255,0.02)">${items}</div>`;
  }

  private renderXmppChannel(channelKey: string): string {
 if (this.xmppError) {
 return `<div style="padding:12px;color:#ef4444;font-size:12px">${escapeHtml(this.xmppError)}</div>`;
 }
 if (!this.xmpp) return '<div style="padding:12px;opacity:0.6;font-size:12px">Loading…</div>';
 if (!this.xmpp.configured) {
 return `<div style="padding:12px;font-size:12px;line-height:1.5">
 <strong>XMPP not configured.</strong><br/>
 Open Settings → API Keys → Tactical (TAK / S2U) and set <code>S2U_XMPP_JID</code> + <code>S2U_XMPP_SECRET</code>.<br/>
 <span style="opacity:0.7">Crystal Ball will not register an XMPP account on your behalf — register one at s2tak.com first.</span>
 </div>`;
 }
 const messages = this.xmpp.channels[channelKey] ?? [];
 if (messages.length === 0) {
 const note = this.xmpp.connected
 ? 'Joined — waiting for messages.'
 : 'Reconnecting — last error: ' + escapeHtml(this.xmpp.lastError ?? 'none');
 return `<div style="padding:12px;opacity:0.7;font-size:12px">${note}</div>`;
 }
 const isEmergency = channelKey === 'emergency';
 const accentColor = pickAccentColor(channelKey);
 // Newest first. (toReversed is ES2023; project targets ES2020.)
 // eslint-disable-next-line unicorn/no-array-reverse -- toReversed unavailable at ES2020 target
 const items = [...messages].reverse().map(m => {
 const ts = new Date(m.at).toLocaleTimeString();
 return `<div style="padding:6px 10px;border-bottom:1px solid rgba(255,255,255,0.04);font-size:12px;line-height:1.5">
 <div style="display:flex;justify-content:space-between;font-size:10px;opacity:0.6;margin-bottom:2px">
 <span style="color:${accentColor}">${escapeHtml(m.sender || 'anonymous')}</span>
 <span>${escapeHtml(ts)}</span>
 </div>
 <div style="white-space:pre-wrap;word-break:break-word">${escapeHtml(m.body)}</div>
 </div>`;
 }).join('');
 const banner = isEmergency
 ? `<div style="padding:6px 10px;background:rgba(239,68,68,0.15);color:#fca5a5;font-size:11px;font-weight:600">Emergency Channel — verify before acting</div>`
 : '';
 return `${banner}<div style="overflow-y:auto;max-height:480px">${items}</div>`;
  }

  private renderTakTab(): string {
 if (this.takError) {
 return `<div style="padding:12px;color:#ef4444;font-size:12px">${escapeHtml(this.takError)}</div>`;
 }
 if (!this.tak) return '<div style="padding:12px;opacity:0.6;font-size:12px">Loading…</div>';
 if (!this.tak.configured) {
 return `<div style="padding:12px;font-size:12px;line-height:1.5">
 <strong>TAK server not configured.</strong><br/>
 Open Settings → API Keys → Tactical (TAK / S2U) and set <code>S2U_TAK_URL</code>, <code>S2U_TAK_USERNAME</code>, and <code>S2U_TAK_SECRET</code>.<br/>
 <span style="opacity:0.7">The S2U SOP publishes the public read-only credentials (GHOSTMAPSPUBLIC) for the ghostmaps server.</span>
 </div>`;
 }
 if (!this.tak.ok) {
 const msg = formatTakErrorMessage(this.tak.error, this.tak.detail);
 return `<div style="padding:12px;color:#ef4444;font-size:12px;line-height:1.5">${msg}</div>`;
 }
 const feeds = this.tak.feeds ?? [];
 if (feeds.length === 0) {
 return '<div style="padding:12px;opacity:0.6;font-size:12px">TAK server returned no public feeds.</div>';
 }
 const fetched = this.tak.fetchedAt ? new Date(this.tak.fetchedAt).toLocaleTimeString() : '—';
 const rows = feeds.map(f => `
 <tr>
 <td style="padding:4px 8px;font-size:11px;font-weight:600">${escapeHtml(f.name || f.uuid)}</td>
 <td style="padding:4px 8px;font-size:11px;opacity:0.7">${escapeHtml(f.type || '—')}</td>
 <td style="padding:4px 8px;font-size:11px;opacity:0.7;font-family:ui-monospace,monospace">${escapeHtml(f.address || '—')}</td>
 <td style="padding:4px 8px;font-size:11px;opacity:0.7">${escapeHtml(f.protocol || '—')}</td>
 </tr>`).join('');
 return `
 <div style="padding:6px 10px;font-size:10px;opacity:0.5">Source: ${escapeHtml(this.tak.source ?? 'live')} · fetched ${escapeHtml(fetched)}</div>
 <table style="width:100%;border-collapse:collapse;font-size:11px">
 <thead style="background:rgba(255,255,255,0.04);text-align:left;font-size:10px;opacity:0.7">
 <tr><th style="padding:4px 8px">Name</th><th style="padding:4px 8px">Type</th><th style="padding:4px 8px">Address</th><th style="padding:4px 8px">Protocol</th></tr>
 </thead>
 <tbody>${rows}</tbody>
 </table>`;
  }

  private renderActiveTab(): string {
 if (this.activeTab === 'tak') return this.renderTakTab();
 return this.renderXmppChannel(this.activeTab);
  }

  private render(): void {
 const html = `${this.renderHeader()}${this.renderTabs()}<div data-s2u-body>${this.renderActiveTab()}</div>`;
 this.setContent(html);
 // Wire tab clicks. Use the panel's content root via getContentEl() if
 // available; fall back to a delegated document handler scoped to the
 // panel id selector pattern shared by other panels.
 const root = this.getContentRoot();
 if (root) {
 root.querySelectorAll<HTMLButtonElement>('button[data-s2u-tab]').forEach(btn => {
 btn.addEventListener('click', () => {
 const id = btn.getAttribute('data-s2u-tab') as TabId | null;
 if (id) {
 this.activeTab = id;
 this.render();
 }
 });
 });
 }
  }

  /** Best-effort accessor for the panel's content root element. The
   *  Panel base exposes the shadow content via `setContent()` only, so
   *  we look it up by the shared `data-panel-id` attribute used by the
   *  rest of the app. */
  private getContentRoot(): HTMLElement | null {
 return document.querySelector<HTMLElement>(`[data-panel-id="${this.getPanelId()}"] [data-s2u-body]`)?.parentElement ?? null;
  }
}
