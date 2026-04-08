export interface StatusCardConfig {
  label: string;
  value: string | number;
  unit?: string;
  severity: 'normal' | 'warning' | 'critical' | 'unknown';
  sublabel?: string;
  wide?: boolean; // grid-column: 1 / -1
  inlineNote?: string;  // small inline text for partial-data states
}

// Internal escape helper (all string values are escaped before HTML insertion)
function esc(v: string | number): string {
  return String(v)
 .replace(/&/g, '&amp;')
 .replace(/</g, '&lt;')
 .replace(/>/g, '&gt;')
 .replace(/"/g, '&quot;');
}

const SEVERITY_COLORS: Record<StatusCardConfig['severity'], string> = {
  normal: 'rgba(34,197,94,',
  warning:  'rgba(234,179,8,',
  critical: 'rgba(239,68,68,',
  unknown:  'rgba(148,163,184,',
};

const TEXT_COLORS: Record<StatusCardConfig['severity'], string> = {
  normal: '#22c55e',
  warning:  '#eab308',
  critical: '#ef4444',
  unknown:  '#94a3b8',
};

// Returns a sanitized HTML string. All string values are escaped before use.
export function renderStatusCard(config: StatusCardConfig): string {
  const { label, value, unit, severity, sublabel, wide, inlineNote } = config;
  const bg = SEVERITY_COLORS[severity];
  const color = TEXT_COLORS[severity];
  const col = wide ? 'grid-column:1/-1;' : '';
  const unitHtml = unit ? `<span style="font-size:0.7rem;opacity:0.6;">${esc(unit)}</span>` : '';
  const subHtml = sublabel ? `<div style="font-size:0.65rem;opacity:0.55;margin-top:0.15rem;">${esc(sublabel)}</div>` : '';
  const noteHtml = inlineNote ? `<div style="font-size:0.62rem;opacity:0.55;margin-top:0.2rem;font-style:italic;">${esc(inlineNote)}</div>` : '';

  return `<div style="${col}background:${bg}0.1);border:1px solid ${bg}0.3);border-radius:6px;padding:0.5rem 0.65rem;">
  <div style="font-size:0.65rem;opacity:0.55;text-transform:uppercase;letter-spacing:0.05em;">${esc(label)}</div>
  <div style="font-size:1.1rem;font-weight:700;color:${color};line-height:1.3;margin-top:0.15rem;">${esc(String(value))}${unitHtml}</div>
  ${subHtml}${noteHtml}
</div>`;
}
