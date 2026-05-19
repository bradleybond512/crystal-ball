import { escapeHtml } from './sanitize';

export type SeverityLevel = 0 | 1 | 2 | 3 | 4;
export type DomainKey =
  | 'cyber'
  | 'weather'
  | 'geopolitical'
  | 'maritime'
  | 'aviation'
  | 'health'
  | 'financial'
  | 'seismic'
  | 'space';

const SEVERITY_LABELS: Record<SeverityLevel, string> = {
  0: 'Minimal',
  1: 'Low',
  2: 'Moderate',
  3: 'High',
  4: 'Critical',
};

const DOMAIN_ICONS: Record<DomainKey, string> = {
  cyber:       '💻',
  weather:     '⛈️',
  geopolitical:'🗺️',
  maritime:    '🚢',
  aviation:    '✈️',
  health:      '🧬',
  financial:   '📈',
  seismic:     '🌐',
  space:       '🛰️',
};

export function severityColor(level: SeverityLevel): string {
  return `var(--severity-${level})`;
}

export function severityLabel(level: SeverityLevel): string {
  return SEVERITY_LABELS[level];
}

export function domainColor(domain: DomainKey): string {
  return `var(--domain-${domain})`;
}

export function domainIcon(domain: DomainKey): string {
  return DOMAIN_ICONS[domain];
}

export function renderSeverityBadge(level: SeverityLevel, label?: string): string {
  const displayLabel = label ?? severityLabel(level);
  const color = severityColor(level);
  const bg = `color-mix(in srgb, ${color} 15%, transparent)`;
  return `<span class="vs-severity-badge" style="color:${color};background:${bg};">${escapeHtml(displayLabel)}</span>`;
}

export function renderDomainBadge(domain: DomainKey, label?: string): string {
  const icon = domainIcon(domain);
  const displayLabel = label ?? domain;
  const color = domainColor(domain);
  const bg = `color-mix(in srgb, ${color} 15%, transparent)`;
  return `<span class="vs-domain-badge" style="color:${color};background:${bg};">${icon} ${escapeHtml(displayLabel)}</span>`;
}
