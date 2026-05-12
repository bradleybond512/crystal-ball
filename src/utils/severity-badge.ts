import { escapeHtml } from './sanitize';

export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info' | 'ok';
export type Domain =
  | 'earthquake'
  | 'wildfire'
  | 'aviation'
  | 'maritime'
  | 'weather'
  | 'cyber'
  | 'space'
  | 'biosurveillance'
  | 'geopolitical'
  | 'infrastructure';

const SEVERITY_LABEL: Record<Severity, string> = {
  critical: 'Critical',
  high:     'High',
  medium:   'Medium',
  low:      'Low',
  info:     'Info',
  ok:       'OK',
};

const DOMAIN_LABEL: Record<Domain, string> = {
  earthquake:      'Earthquake',
  wildfire:        'Wildfire',
  aviation:        'Aviation',
  maritime:        'Maritime',
  weather:         'Weather',
  cyber:           'Cyber',
  space:           'Space',
  biosurveillance: 'Biosurveillance',
  geopolitical:    'Geopolitical',
  infrastructure:  'Infrastructure',
};

const DOMAIN_ICON_MAP: Record<Domain, string> = {
  earthquake:      '🌐',
  wildfire:        '🔥',
  aviation:        '✈️',
  maritime:        '🚢',
  weather:         '⛈️',
  cyber:           '💻',
  space:           '🛰️',
  biosurveillance: '🧬',
  geopolitical:    '🗺️',
  infrastructure:  '🏗️',
};

export function severityToColor(severity: Severity): string {
  return `var(--severity-${severity})`;
}

export function severityBadge(severity: Severity, label?: string): string {
  const displayLabel = label ?? SEVERITY_LABEL[severity];
  const color = severityToColor(severity);
  const bg = `color-mix(in srgb, ${color} 15%, transparent)`;
  return `<span class="severity-badge" style="color:${color};background:${bg};">${escapeHtml(displayLabel)}</span>`;
}

export function domainBadge(domain: Domain, label?: string): string {
  const displayLabel = label ?? DOMAIN_LABEL[domain];
  const color = `var(--domain-${domain})`;
  const bg = `color-mix(in srgb, ${color} 15%, transparent)`;
  return `<span class="domain-badge" style="color:${color};background:${bg};">${escapeHtml(displayLabel)}</span>`;
}

export function domainIcon(domain: Domain): string {
  return DOMAIN_ICON_MAP[domain] ?? '●';
}
