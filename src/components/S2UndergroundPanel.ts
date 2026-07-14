import { Panel } from './Panel';
import { isTrustedOAuthMessage } from './s2-underground-helpers';
import { escapeHtml } from '@/utils/sanitize';
import { getLocalApiPort } from '@/services/runtime';
import {
  fetchS2Videos,
  fetchS2Audio,
  fetchPatronStatus,
  setPatreonSessionTokens,
  S2_PATREON_URL,
  type S2Video,
  type S2Audio,
  type PatronStatusResult,
} from '@/services/s2-underground-media';

const REFRESH_MS = 30 * 60 * 1000;

export class S2UndergroundPanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private activeVideoId: string | null = null;
  private oauthWindow: Window | null = null;

  constructor() {
    super({
      id: 's2-underground-media',
      title: 'S2 Underground',
      showCount: true,
      trackActivity: false,
      infoTooltip: 'S2 Underground video briefings (free, via YouTube) plus your Patreon supporter audio + status.',
    });
    this.start();
  }

  public override destroy(): void {
    if (this.refreshTimer !== null) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    if (typeof window !== 'undefined') window.removeEventListener('message', this.onOAuthMessage);
    super.destroy();
  }

  private start(): void {
    void this.render();
    this.refreshTimer = setInterval(() => void this.render(), REFRESH_MS);
  }

  private async render(): Promise<void> {
    try {
      const [videos, audio, patron] = await Promise.all([
        fetchS2Videos(),
        fetchS2Audio(),
        fetchPatronStatus(),
      ]);
      this.setCount(videos.length);
      this.setContent(this.buildHtml(videos, audio.episodes, audio.configured, patron));
      this.wireButtons();
    } catch {
      this.setContent('<div style="padding:12px;color:var(--text-secondary,#888)">S2 Underground content unavailable.</div>');
    }
  }

  private buildHtml(
    videos: S2Video[],
    episodes: S2Audio[],
    audioConfigured: boolean,
    patron: PatronStatusResult,
  ): string {
    const badge = this.badgeHtml(patron);

    const vids = videos.length
      ? videos.map((v) => `<div data-s2-video="${escapeHtml(v.videoId)}" role="button" tabindex="0" style="display:flex;gap:8px;padding:6px;cursor:pointer;border-bottom:1px solid var(--border-subtle,#222)">
          <img src="${escapeHtml(v.thumbnail)}" alt="" style="width:120px;height:68px;object-fit:cover;border-radius:4px"/>
          <div style="font-size:12px">${escapeHtml(v.title)}<div style="opacity:.6;font-size:10px">${escapeHtml(v.published.slice(0, 10))}</div></div>
        </div>`).join('')
      : '<div style="padding:8px;opacity:.6;font-size:12px">No videos loaded.</div>';

    const player = this.activeVideoId
      ? `<iframe src="http://127.0.0.1:${getLocalApiPort()}/api/youtube-embed?videoId=${escapeHtml(this.activeVideoId)}&autoplay=1&mute=0" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" style="width:100%;aspect-ratio:16/9;border:0;border-radius:6px;margin-bottom:8px"></iframe>`
      : '';

    const audioSection = this.audioHtml(episodes, audioConfigured);

    return `
      <div style="padding:8px 10px;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid var(--border-subtle,#333)">
        <strong style="font-size:12px">Briefings</strong>${badge}
      </div>
      ${player}
      <div>${vids}</div>
      <div style="padding:8px 10px;border-top:1px solid var(--border-subtle,#333);font-size:12px"><strong>Supporter audio</strong></div>
      ${audioSection}
      <div style="padding:8px 10px;border-top:1px solid var(--border-subtle,#333)"><a href="${S2_PATREON_URL}" target="_blank" rel="noopener" style="font-size:12px">Open S2 on Patreon ↗</a></div>`;
  }

  private badgeHtml(patron: PatronStatusResult): string {
    if (patron.active) {
      return `<span style="background:#16331f;color:#22c55e;border:1px solid #22c55e44;border-radius:3px;padding:1px 6px;font-size:11px">Verified patron · $${(patron.amountCents / 100).toFixed(0)}/mo</span>`;
    }
    if (patron.configured) {
      return '<span style="opacity:.7;font-size:11px">Patreon not active</span> <a href="#" data-s2-connect style="font-size:11px">Connect</a>';
    }
    return '<a href="#" data-s2-connect style="font-size:11px">Connect Patreon</a>';
  }

  private audioHtml(episodes: S2Audio[], configured: boolean): string {
    if (configured && episodes.length) {
      return episodes.map((e) => `<div style="padding:6px;border-bottom:1px solid var(--border-subtle,#222)"><div style="font-size:12px">${escapeHtml(e.title)}</div><audio controls preload="none" src="${escapeHtml(e.audioUrl)}" style="width:100%;height:32px"></audio></div>`).join('');
    }
    if (configured) {
      return '<div style="padding:8px;opacity:.6;font-size:12px">No audio episodes.</div>';
    }
    return '<div style="padding:8px;font-size:12px;opacity:.7">Paste your Patreon audio-RSS URL in Settings → API Keys (<code>PATREON_AUDIO_RSS_URL</code>) to list supporter audio.</div>';
  }

  private wireButtons(): void {
    const root = this.getContentElement();
    root.querySelectorAll('[data-s2-video]').forEach((el) => {
      el.addEventListener('click', () => {
        this.activeVideoId = el.getAttribute('data-s2-video');
        void this.render();
      });
    });
    root.querySelector('[data-s2-connect]')?.addEventListener('click', (ev) => {
      ev.preventDefault();
      void this.startPatreonConnect();
    });
  }

  private async startPatreonConnect(): Promise<void> {
    try {
      const r = await fetch('/api/patreon/authorize-url');
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = (await r.json()) as { url?: string; configured?: boolean };
      if (!j.configured || !j.url) {
        this.setContent('<div style="padding:12px;font-size:12px">Set <code>PATREON_OAUTH_CLIENT_ID</code> and <code>PATREON_OAUTH_CLIENT_SECRET</code> in Settings → API Keys first, then reconnect.</div>');
        return;
      }
      window.addEventListener('message', this.onOAuthMessage);
      this.oauthWindow = window.open(j.url, 'patreon-oauth', 'width=600,height=800');
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.setContent(`<div style="padding:12px;font-size:12px;color:#ff453a">Could not start Patreon connect: ${msg}</div>`);
    }
  }

  private readonly onOAuthMessage = (ev: MessageEvent): void => {
    // Only trust the OAuth callback served by our own sidecar, and only the
    // popup window we opened. Without these checks any page/frame able to
    // postMessage to this window could inject an attacker-controlled
    // access_token that we'd persist to the keychain.
    if (!isTrustedOAuthMessage(ev, `http://127.0.0.1:${getLocalApiPort()}`, this.oauthWindow)) return;
    const m = ev.data as { type?: string; ok?: boolean; access_token?: string; refresh_token?: string };
    if (m?.type !== 'patreon-oauth') return;
    window.removeEventListener('message', this.onOAuthMessage);
    this.oauthWindow = null;
    if (m.ok && m.access_token) {
      setPatreonSessionTokens(m.access_token, m.refresh_token);
    }
    void this.render();
  };
}
