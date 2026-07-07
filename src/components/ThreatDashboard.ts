/**
 * Threat Dashboard — pinned home panel.
 *
 * 3-column grid of domain cards driven by the
 * `wm:threat-levels-updated` event from the threat-aggregator service.
 *
 * Each card is clickable: click navigates to the linked domain panel
 * via the same scrollIntoView pattern the sidebar uses. HIGH and
 * CRITICAL cards pulse via inline @keyframes so the dashboard ships
 * without depending on a separate stylesheet.
 */

import { Panel } from './Panel';
import {
  THREAT_LEVELS_EVENT,
  emptyAggregatedThreats,
  type AggregatedThreats,
  type DomainThreat,
  type ThreatDomain,
  type ThreatLevel,
  type ThreatLevelsEventDetail,
} from '@/services/synthesis/threat-aggregator';
import { escapeHtml } from '@/utils/sanitize';

interface DomainMeta {
  domain: ThreatDomain;
  label: string;
  icon: string;
  /** Panel id to navigate to when the card is clicked. */
  targetPanel: string;
}

const DOMAINS: readonly DomainMeta[] = [
  { domain: 'seismic', label: 'Seismic', icon: '⚡', targetPanel: 'earthquakes' },
  { domain: 'space_weather', label: 'Space Weather', icon: '☀', targetPanel: 'space-weather' },
  { domain: 'wildfire', label: 'Wildfire', icon: '🔥', targetPanel: 'wildfire-incidents' },
  { domain: 'weather', label: 'Weather Hazards', icon: '⛈', targetPanel: 'hazard-alerts' },
  { domain: 'aviation', label: 'Aviation', icon: '✈', targetPanel: 'aviation-intel' },
  { domain: 'infrastructure', label: 'Infrastructure', icon: '⚙', targetPanel: 'monitors' },
  { domain: 'maritime', label: 'Maritime', icon: '⚓', targetPanel: 'maritime-superpower' },
  { domain: 'biosurveillance', label: 'Biosurveillance', icon: '🧬', targetPanel: 'disease-outbreak' },
  { domain: 'economic', label: 'Economic', icon: '$', targetPanel: 'economic' },
  { domain: 'cyber', label: 'Cyber', icon: '☣', targetPanel: 'cyber-threats' },
  { domain: 'geopolitical', label: 'Geopolitical', icon: '◎', targetPanel: 'gdelt-intel' },
];

const LEVEL_COLOR: Record<ThreatLevel, string> = {
  NONE: '#6b7280',
  LOW: '#22c55e',
  ELEVATED: '#eab308',
  HIGH: '#f97316',
  CRITICAL: '#dc2626',
};

const LEVEL_BACKGROUND: Record<ThreatLevel, string> = {
  NONE: 'rgba(107,114,128,0.10)',
  LOW: 'rgba(34,197,94,0.10)',
  ELEVATED: 'rgba(234,179,8,0.10)',
  HIGH: 'rgba(249,115,22,0.12)',
  CRITICAL: 'rgba(220,38,38,0.15)',
};

const PULSE_ANIM_NAME = 'threat-dashboard-pulse';

let cssInjected = false;
function ensureCssInjected(): void {
  if (cssInjected || typeof document === 'undefined') return;
  const style = document.createElement('style');
  style.dataset.injectedBy = 'ThreatDashboard';
  style.textContent = `
    @keyframes ${PULSE_ANIM_NAME} {
      0%, 100% { box-shadow: 0 0 0 rgba(220,38,38,0); }
      50% { box-shadow: 0 0 14px rgba(220,38,38,0.55); }
    }
    .threat-dashboard-card {
      cursor: pointer;
      transition: transform 0.15s ease, background 0.2s ease;
    }
    .threat-dashboard-card:hover {
      transform: translateY(-1px);
    }
    .threat-dashboard-card.pulse-high {
      animation: ${PULSE_ANIM_NAME} 2.4s ease-in-out infinite;
    }
    .threat-dashboard-card.pulse-critical {
      animation: ${PULSE_ANIM_NAME} 1.4s ease-in-out infinite;
    }
  `;
  document.head.append(style);
  cssInjected = true;
}

export class ThreatDashboard extends Panel {
  private latest: AggregatedThreats = emptyAggregatedThreats();
  private listener: ((event: Event) => void) | null = null;
  /** Whether the user has expanded the all-quiet disclosure. Survives re-renders. */
  private quietExpanded = false;

  constructor() {
    super({
      id: 'threat-dashboard',
      title: 'Threat Dashboard',
      showCount: true,
      trackActivity: true,
      infoTooltip:
        'At-a-glance threat level for all 11 monitored domains. Updates every 30s. Click a card to jump to that domain.',
    });
    ensureCssInjected();
    this.subscribe();
    this.render();
  }

  public destroy(): void {
    super.destroy();
    if (this.listener && typeof document !== 'undefined') {
      document.removeEventListener(THREAT_LEVELS_EVENT, this.listener);
      this.listener = null;
    }
  }

  private subscribe(): void {
    if (typeof document === 'undefined') return;
    this.listener = (event: Event): void => {
      const detail = (event as CustomEvent<ThreatLevelsEventDetail>).detail;
      if (!detail?.threats) return;
      this.latest = detail.threats;
      this.render();
    };
    document.addEventListener(THREAT_LEVELS_EVENT, this.listener);
  }

  private render(): void {
    const elevatedOrHigher = countElevatedOrHigher(this.latest);
    this.setCount(elevatedOrHigher);
    const cards = DOMAINS.map((meta) => this.renderCard(meta, this.latest[meta.domain]));
    const grid = `<div style="
          display:grid;
          grid-template-columns:repeat(auto-fit, minmax(220px, 1fr));
          gap:8px;
        ">
          ${cards.join('')}
        </div>`;
    const allQuiet = DOMAINS.every((meta) => this.latest[meta.domain].level === 'NONE');
    const domainsWord = elevatedOrHigher === 1 ? 'domain' : 'domains';
    const expandedHtml = `
      <div style="padding:8px;">
        ${grid}
        <div style="margin-top:10px;font-size:11px;opacity:0.6;">
          ${elevatedOrHigher} ${domainsWord} above baseline. Click a card to jump.
        </div>
      </div>
    `;
    const html = allQuiet ? this.renderAllQuiet(grid) : expandedHtml;
    this.setContent(html, () => this.wireClickHandlers());
  }

  /** Every sensor reports NONE — collapse the grid behind one quiet line. */
  private renderAllQuiet(grid: string): string {
    const lastChecked = Math.max(0, ...DOMAINS.map((meta) => this.latest[meta.domain].lastUpdatedMs || 0));
    const checkedLabel = lastChecked > 0
      ? `checked ${formatRelativeTime(lastChecked)}`
      : 'awaiting first check';
    return `
      <div style="padding:8px;">
        <details class="threat-dashboard-quiet"${this.quietExpanded ? ' open' : ''}>
          <summary style="cursor:pointer;display:flex;align-items:center;gap:8px;font-size:12px;padding:4px 2px;">
            <span style="width:8px;height:8px;border-radius:50%;background:${LEVEL_COLOR.LOW};flex:none;"></span>
            <span style="font-weight:600;">All sensors quiet</span>
            <span style="opacity:0.6;">· ${escapeHtml(checkedLabel)}</span>
            <span style="margin-left:auto;font-size:10px;opacity:0.5;text-transform:uppercase;letter-spacing:0.04em;">${DOMAINS.length} sensors</span>
          </summary>
          <div style="margin-top:8px;">${grid}</div>
        </details>
      </div>
    `;
  }

  private renderCard(meta: DomainMeta, threat: DomainThreat): string {
    const color = LEVEL_COLOR[threat.level];
    const background = LEVEL_BACKGROUND[threat.level];
    const pulseClass = pulseClassFor(threat.level);
    const updated = formatRelativeTime(threat.lastUpdatedMs);
    return `
      <div
        class="threat-dashboard-card ${pulseClass}"
        data-target-panel="${escapeHtml(meta.targetPanel)}"
        data-domain="${escapeHtml(meta.domain)}"
        role="button"
        tabindex="0"
        style="
          padding:10px;
          border-radius:6px;
          border:1px solid ${color};
          background:${background};
        "
      >
        <div style="display:flex;align-items:center;justify-content:space-between;">
          <div style="display:flex;align-items:center;gap:6px;">
            <span style="font-size:14px;">${escapeHtml(meta.icon)}</span>
            <span style="font-weight:600;font-size:12px;">${escapeHtml(meta.label)}</span>
          </div>
          <span
            style="
              padding:1px 6px;
              border-radius:9px;
              background:${color};
              color:white;
              font-size:10px;
              font-weight:700;
              letter-spacing:0.5px;
            "
          >${escapeHtml(threat.level)}</span>
        </div>
        <div style="margin-top:6px;font-size:11px;opacity:0.85;min-height:14px;">
          ${threat.topAlert ? escapeHtml(threat.topAlert) : '—'}
        </div>
        <div style="margin-top:4px;font-size:10px;opacity:0.55;">
          ${escapeHtml(updated)}
        </div>
      </div>
    `;
  }

  private wireClickHandlers(): void {
    const root = this.getContentElement();
    const quiet = root.querySelector<HTMLDetailsElement>('details.threat-dashboard-quiet');
    quiet?.addEventListener('toggle', () => {
      this.quietExpanded = quiet.open;
    });
    for (const card of root.querySelectorAll<HTMLElement>('.threat-dashboard-card')) {
      card.addEventListener('click', () => navigateToPanel(card.dataset.targetPanel));
      card.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          navigateToPanel(card.dataset.targetPanel);
        }
      });
    }
  }
}

function pulseClassFor(level: ThreatLevel): string {
  if (level === 'CRITICAL') return 'pulse-critical';
  if (level === 'HIGH') return 'pulse-high';
  return '';
}

function navigateToPanel(targetPanelKey: string | undefined): void {
  if (!targetPanelKey || typeof document === 'undefined') return;
  const target = document.querySelector<HTMLElement>(
    `[data-panel="${escapeHtml(targetPanelKey)}"]`,
  );
  target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function countElevatedOrHigher(threats: AggregatedThreats): number {
  let n = 0;
  for (const t of Object.values(threats)) {
    if (t.level === 'ELEVATED' || t.level === 'HIGH' || t.level === 'CRITICAL') n += 1;
  }
  return n;
}

function formatRelativeTime(ts: number): string {
  if (!Number.isFinite(ts) || ts === 0) return 'never';
  const ageMs = Date.now() - ts;
  if (ageMs < 60_000) return 'just now';
  const minutes = Math.round(ageMs / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}
