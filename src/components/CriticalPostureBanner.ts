import type { TheaterPostureSummary } from '../services/military-surge';
import { criticalAnnouncementsSuppressed, watchCriticalAnnouncementSuppression } from '../utils/critical-ui-announcements';

function setText(element: Element, text: string): void {
  if (element.textContent !== text) element.textContent = text;
}

export class CriticalPostureBanner {
  private readonly status = document.createElement('span');
  private readonly row = document.createElement('div');
  private readonly stopWatching: () => void;
  private selected?: TheaterPostureSummary;
  private signature = '';
  private rebaseline = false;
  private disposed = false;
  private localDismissedAt = 0;

  constructor(
    private readonly stack: HTMLElement,
    view: (lat: number, lon: number) => void,
    track: (action: 'view' | 'dismiss', theater: string) => void,
  ) {
    this.status.className = 'critical-ui-announcer';
    this.status.dataset.postureAnnouncer = '';
    this.status.setAttribute('role', 'status');
    this.status.setAttribute('aria-live', 'polite');
    this.status.setAttribute('aria-atomic', 'true');
    stack.append(this.status);
    this.row.innerHTML = `
      <div class="banner-content">
        <span class="banner-icon" aria-hidden="true"></span>
        <span class="banner-headline"></span>
        <span class="banner-stats"></span>
        <span class="banner-strike">STRIKE CAPABLE</span>
      </div>
      <button type="button" class="banner-view">View Region</button>
      <button type="button" class="banner-dismiss" aria-label="Dismiss posture banner">×</button>`;
    this.row.querySelector('.banner-view')!.addEventListener('click', () => {
      const top = this.selected;
      if (!top) return;
      track('view', top.theaterId);
      if (Number.isFinite(top.centerLat) && Number.isFinite(top.centerLon)) view(top.centerLat, top.centerLon);
    });
    this.row.querySelector('.banner-dismiss')!.addEventListener('click', () => {
      if (!this.selected) return;
      track('dismiss', this.selected.theaterId);
      const now = Date.now();
      try { sessionStorage.setItem('banner-dismissed', String(now)); }
      catch { this.localDismissedAt = now; }
      this.clear(true);
    });

    let suppressed = criticalAnnouncementsSuppressed();
    this.rebaseline = suppressed;
    this.stopWatching = watchCriticalAnnouncementSuppression(() => {
      const next = criticalAnnouncementsSuppressed();
      if (suppressed === next) return;
      suppressed = next;
      this.rebaseline = true;
      setText(this.status, '');
    });
  }

  render(postures: readonly TheaterPostureSummary[], mobile: boolean): void {
    if (this.disposed) return;
    if (mobile || this.isDismissed()) {
      this.clear(true);
      return;
    }

    const top = postures.find(p => p.postureLevel === 'critical' || (p.postureLevel === 'elevated' && p.strikeCapable));
    const suppressed = criticalAnnouncementsSuppressed();
    if (!top) {
      this.clear(suppressed);
      return;
    }

    this.selected = top;
    const critical = top.postureLevel === 'critical';
    this.row.className = 'critical-posture-banner severity-' + (critical ? 'critical' : 'elevated');
    setText(this.row.querySelector('.banner-icon')!, critical ? '🚨' : '⚠️');
    setText(this.row.querySelector('.banner-headline')!, top.headline);
    setText(this.row.querySelector('.banner-stats')!, `${top.totalAircraft} aircraft • ${top.summary}`);
    this.row.querySelector<HTMLElement>('.banner-strike')!.hidden = !top.strikeCapable;
    const button = this.row.querySelector<HTMLButtonElement>('.banner-view')!;
    button.dataset.lat = String(top.centerLat);
    button.dataset.lon = String(top.centerLon);
    if (this.row.parentElement !== this.stack) this.stack.prepend(this.row);
    document.body.classList.add('has-critical-banner');

    const next = JSON.stringify([top.theaterId, top.postureLevel, top.strikeCapable]);
    if (suppressed) {
      setText(this.status, '');
    } else if (!this.rebaseline && next !== this.signature) {
      const severity = critical ? 'Critical' : 'Elevated';
      const strike = top.strikeCapable ? 'Strike capable.' : 'No strike capability indicated.';
      this.status.textContent = `${severity} posture in ${top.theaterName || top.theaterId}. ${strike}`;
    }
    this.signature = next;
    this.rebaseline = suppressed;
  }

  private isDismissed(): boolean {
    let at = this.localDismissedAt;
    try { at = Math.max(at, Number(sessionStorage.getItem('banner-dismissed')) || 0); }
    catch { /* The in-memory timestamp still honors this window's dismissal. */ }
    return at > 0 && Date.now() - at < 30 * 60_000;
  }

  private clear(rebaseline: boolean): void {
    this.selected = undefined;
    this.row.remove();
    document.body.classList.remove('has-critical-banner');
    setText(this.status, '');
    this.signature = '';
    this.rebaseline = rebaseline;
  }

  destroy(): void {
    this.disposed = true;
    this.stopWatching();
    this.clear(true);
    this.status.remove();
  }
}
