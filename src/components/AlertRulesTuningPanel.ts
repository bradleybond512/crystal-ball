/**
 * AlertRulesTuningPanel — per-domain alert rules editor.
 *
 * Four sections that wrap AlertRulesService:
 *   1. Severity Thresholds   — per-domain `<input type="range" min=0 max=4>`
 *   2. Suppression Windows   — per-domain `<select>` over preset durations
 *   3. Domain Priority Weights — per-domain 0..100 % `<input type="range">`
 *   4. Quick Presets         — 4 buttons (all / high-priority / crisis / silent)
 *
 * Pure DOM construction via h() / replaceChildren() — no innerHTML mutation
 * so user-entered domain names can never inject markup. Every interactive
 * control round-trips through AlertRulesService, which is the source of
 * truth + persistence layer.
 */

import { Panel } from './Panel';
import { h, replaceChildren } from '@/utils/dom-utils';
import {
  ALL_DOMAINS,
  SUPPRESSION_PRESETS_MS,
  getAlertRulesService,
  type AlertRulesPreset,
} from '@/services/intelligence/alert-rules';
import type { NotificationDomain } from '@/services/notifications/notification-settings-service';

const SEVERITY_LABELS = ['Info', 'Low', 'Medium', 'High', 'Critical'];

const DOMAIN_LABELS: Record<NotificationDomain, string> = {
  earthquakes: 'Earthquakes',
  wildfire: 'Wildfire',
  aviation: 'Aviation',
  maritime: 'Maritime',
  biosurveillance: 'Biosurveillance',
  space_weather: 'Space Weather',
  infrastructure: 'Infrastructure',
  geopolitical: 'Geopolitical',
  weather: 'Weather',
  cyber: 'Cyber',
  supply: 'Supply',
};

const PRESETS: { id: AlertRulesPreset; label: string; description: string }[] = [
  { id: 'all', label: 'All Alerts', description: 'Surface every alert at every severity.' },
  { id: 'high-priority', label: 'High Priority Only', description: 'Only severity ≥ 3 (high or critical).' },
  { id: 'crisis', label: 'Crisis Mode', description: 'Only critical (severity ≥ 4).' },
  { id: 'silent', label: 'Silent', description: 'Suppress every domain.' },
];

const SECTION_STYLE = 'border:1px solid var(--border-subtle,#333);border-radius:4px;padding:10px;display:flex;flex-direction:column;gap:8px;';
const SECTION_TITLE_STYLE = 'font-size:11px;color:var(--text-secondary,#aaa);text-transform:uppercase;letter-spacing:0.05em;margin:0;';
const ROW_STYLE = 'display:grid;grid-template-columns:140px 1fr 60px;align-items:center;gap:10px;font-size:12px;';
const DOMAIN_LABEL_STYLE = 'color:#e5e5e5;';
const VALUE_STYLE = 'font-family:ui-monospace,monospace;font-size:11px;color:var(--text-secondary,#aaa);text-align:right;';
const PRESET_BUTTON_STYLE = 'padding:6px 10px;background:var(--surface-1,#111);color:#e5e5e5;border:1px solid var(--border-subtle,#333);border-radius:3px;font-size:12px;cursor:pointer;';

export class AlertRulesTuningPanel extends Panel {
  private readonly service = getAlertRulesService();

  constructor() {
    super({
      id: 'alert-rules-tuning',
      title: 'Alert Rules',
      showCount: false,
      trackActivity: true,
      infoTooltip:
        'Tune per-domain alert behaviour: severity thresholds (suppress below N), suppression windows (cooldown before re-alerting), priority weights (how heavily each domain factors into overall risk score). Quick presets reset every threshold at once.',
    });
    this.render();
  }

  private render(): void {
    const root = h(
      'div',
      { style: 'padding:12px;display:flex;flex-direction:column;gap:12px;' },
      this.renderThresholdSection(),
      this.renderSuppressionSection(),
      this.renderWeightsSection(),
      this.renderPresetSection(),
    );
    replaceChildren(this.content, root);
  }

  // ── Section: Severity thresholds ──────────────────────────────────

  private renderThresholdSection(): HTMLElement {
    const rows = ALL_DOMAINS.map((domain) => this.renderThresholdRow(domain));
    return h(
      'div',
      { style: SECTION_STYLE, dataset: { section: 'thresholds' } },
      h('div', { style: SECTION_TITLE_STYLE }, 'Severity Thresholds'),
      h('div', { style: 'font-size:11px;color:var(--text-secondary,#aaa);' },
        'Suppress alerts below this severity. 0 = Info, 4 = Critical.'),
      ...rows,
    );
  }

  private renderThresholdRow(domain: NotificationDomain): HTMLElement {
    const current = this.service.getThreshold(domain);
    const valueLabel = h('span', { style: VALUE_STYLE }, SEVERITY_LABELS[current] ?? String(current));
    const slider = h('input', {
      type: 'range',
      min: '0',
      max: '4',
      step: '1',
      value: String(current),
      dataset: { role: 'threshold-slider', domain },
      style: 'width:100%;',
    }) as HTMLInputElement;
    slider.addEventListener('input', () => {
      const next = Number(slider.value);
      this.service.setThreshold(domain, next);
      const idx = Math.max(0, Math.min(4, Math.round(next)));
      valueLabel.textContent = SEVERITY_LABELS[idx] ?? String(idx);
    });
    return h(
      'div',
      { style: ROW_STYLE },
      h('span', { style: DOMAIN_LABEL_STYLE }, DOMAIN_LABELS[domain]),
      slider,
      valueLabel,
    );
  }

  // ── Section: Suppression windows ──────────────────────────────────

  private renderSuppressionSection(): HTMLElement {
    const rows = ALL_DOMAINS.map((domain) => this.renderSuppressionRow(domain));
    return h(
      'div',
      { style: SECTION_STYLE, dataset: { section: 'suppression' } },
      h('div', { style: SECTION_TITLE_STYLE }, 'Suppression Windows'),
      h('div', { style: 'font-size:11px;color:var(--text-secondary,#aaa);' },
        'Cooldown before re-alerting the same domain.'),
      ...rows,
    );
  }

  private renderSuppressionRow(domain: NotificationDomain): HTMLElement {
    const current = this.service.getSuppressionWindow(domain);
    const select = h('select', {
      dataset: { role: 'suppression-select', domain },
      style: 'width:100%;padding:4px 8px;background:var(--surface-1,#111);color:#e5e5e5;border:1px solid var(--border-subtle,#333);border-radius:3px;font-size:12px;',
    }) as HTMLSelectElement;
    for (const ms of SUPPRESSION_PRESETS_MS) {
      const opt = document.createElement('option');
      opt.value = String(ms);
      opt.textContent = formatDuration(ms);
      if (ms === current) opt.selected = true;
      select.append(opt);
    }
    select.addEventListener('change', () => {
      this.service.setSuppressionWindow(domain, Number(select.value));
    });
    return h(
      'div',
      { style: ROW_STYLE },
      h('span', { style: DOMAIN_LABEL_STYLE }, DOMAIN_LABELS[domain]),
      select,
      h('span', { style: VALUE_STYLE }, current === 0 ? 'off' : 'on'),
    );
  }

  // ── Section: Domain priority weights ──────────────────────────────

  private renderWeightsSection(): HTMLElement {
    const rows = ALL_DOMAINS.map((domain) => this.renderWeightRow(domain));
    return h(
      'div',
      { style: SECTION_STYLE, dataset: { section: 'weights' } },
      h('div', { style: SECTION_TITLE_STYLE }, 'Domain Priority Weights'),
      h('div', { style: 'font-size:11px;color:var(--text-secondary,#aaa);' },
        'Relative weight each domain contributes to the overall risk score.'),
      ...rows,
    );
  }

  private renderWeightRow(domain: NotificationDomain): HTMLElement {
    const current = this.service.getDomainWeight(domain);
    const valueLabel = h('span', { style: VALUE_STYLE }, `${Math.round(current * 100)}%`);
    const slider = h('input', {
      type: 'range',
      min: '0',
      max: '100',
      step: '1',
      value: String(Math.round(current * 100)),
      dataset: { role: 'weight-slider', domain },
      style: 'width:100%;',
    }) as HTMLInputElement;
    slider.addEventListener('input', () => {
      const pct = Math.max(0, Math.min(100, Number(slider.value)));
      const next = pct / 100;
      this.service.setDomainWeight(domain, next);
      valueLabel.textContent = `${pct}%`;
    });
    return h(
      'div',
      { style: ROW_STYLE },
      h('span', { style: DOMAIN_LABEL_STYLE }, DOMAIN_LABELS[domain]),
      slider,
      valueLabel,
    );
  }

  // ── Section: Quick presets ────────────────────────────────────────

  private renderPresetSection(): HTMLElement {
    const buttons = PRESETS.map((preset) => this.renderPresetButton(preset));
    return h(
      'div',
      { style: SECTION_STYLE, dataset: { section: 'presets' } },
      h('div', { style: SECTION_TITLE_STYLE }, 'Quick Presets'),
      h(
        'div',
        { style: 'display:flex;gap:6px;flex-wrap:wrap;' },
        ...buttons,
      ),
    );
  }

  private renderPresetButton(preset: { id: AlertRulesPreset; label: string; description: string }): HTMLElement {
    const btn = h('button', {
      type: 'button',
      dataset: { role: 'preset-button', preset: preset.id },
      title: preset.description,
      style: PRESET_BUTTON_STYLE,
    }, preset.label);
    btn.addEventListener('click', () => {
      this.service.applyPreset(preset.id);
      this.render();
    });
    return btn;
  }
}

// ── Helpers ──────────────────────────────────────────────────────────

function formatDuration(ms: number): string {
  if (ms <= 0) return 'No cooldown';
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.round(minutes / 60);
  return `${hours} h`;
}

// Re-exported so callers (tests, future panels) can render the same
// duration label without dragging in a separate helper module.
export const __testables = { formatDuration, DOMAIN_LABELS, SEVERITY_LABELS };
