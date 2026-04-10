/**
 * Export briefing — generates a plain-text or Markdown briefing
 * from the current shift handoff data and copies to clipboard.
 *
 * Triggered via ⌘⇧H or cb:export-briefing event.
 */

import { generateShiftBriefing } from './shift-handoff';

export function exportBriefingToClipboard(periodHours = 8): void {
  const b = generateShiftBriefing(periodHours);
  const lines: string[] = [
    `# Crystal Ball Briefing — ${new Date(b.generatedAt).toLocaleString()}`,
   `Period: last ${b.periodHours}h | Alerts: ${b.totalAlerts} (${b.acknowledgedCount} ack'd)`, ''];

  if (b.topStories.length > 0) {
    lines.push('## Top Stories');
    for (const s of b.topStories) {
      lines.push(`- [${s.leadSeverity.toUpperCase()}] ${s.label} (${s.count} alerts)`);
    }
    lines.push('');
  }

  if (b.activeSituations.length > 0) {
    lines.push('## Active Situations');
    for (const s of b.activeSituations) {
      lines.push(`- ${s.title} — ${s.phase} (${s.confidence}% confidence)`);
    }
    lines.push('');
  }

  lines.push('## Lifecycle Summary', `Rising: ${b.lifecycleSummary.rising} | Peaked: ${b.lifecycleSummary.peaked} | Cooling: ${b.lifecycleSummary.cooling} | Resolved: ${b.lifecycleSummary.resolved}`, '');

  const acc = b.forecastAccuracy;
  if (acc.totalPredictions > 0) {
    lines.push(`## Forecast Accuracy: ${acc.accuracy}% (${acc.hits}/${acc.hits + acc.misses} resolved, ${acc.pending} pending)`, '');
  }

  if (b.degradedSources.length > 0) {
    lines.push('## Degraded Sources');
    for (const s of b.degradedSources) {
      lines.push(`- ${s.name}: ${s.status} (${Math.round(s.errorRate * 100)}% errors)`);
    }
    lines.push('');
  }

  const text = lines.join('\n');
  navigator.clipboard.writeText(text).then(() => {
    document.dispatchEvent(new CustomEvent('cb:toast', {
      detail: { message: 'Briefing copied to clipboard', type: 'success' },
    }));
  }).catch(() => {
    document.dispatchEvent(new CustomEvent('cb:toast', {
      detail: { message: 'Failed to copy briefing', type: 'error' },
    }));
  });
}

export function initExportBriefing(): void {
  document.addEventListener('cb:export-briefing', () => exportBriefingToClipboard());
}
