import type { Hypothesis } from './analyst-loop';
import type { ModeAdvisory } from './mode-forecast';
import type { PCIScore } from './intelligence/predictive-crisis-index';
import { forecastAll } from './intelligence/hypothesis-forecast';

export type ForecastAdvisory = ModeAdvisory;

export interface AnalystContextInput {
  hypotheses: readonly Hypothesis[];
  advisories: readonly ForecastAdvisory[];
  pci: PCIScore | null;
}

export interface AnalystContext {
  systemPromptAddendum: string;
  summaryLine: string;
}

export function buildAnalystContext(input: AnalystContextInput): AnalystContext {
  const { hypotheses, advisories, pci } = input;

  if (hypotheses.length === 0 && pci === null) {
    return { systemPromptAddendum: '', summaryLine: '' };
  }

  const top3 = [...hypotheses]
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 3);

  const forecasts = forecastAll(top3, pci);
  const forecastMap = new Map(forecasts.map(f => [f.hypothesisId, f]));

  let addendum = '## Live Intelligence Context\n\n';

  if (pci !== null) {
    addendum += `Current PCI: ${pci.index}/100 (${pci.trend})\n\n`;
  }

  if (top3.length > 0) {
    addendum += 'Top situations:\n';
    top3.forEach((h, i) => {
      const fc = forecastMap.get(h.id);
      const confPct = Math.round(h.confidence * 100);
      if (fc) {
        const probPct = Math.round(fc.probability * 100);
        addendum += `${i + 1}. ${h.statement} — confidence ${confPct}%, forecast ${probPct}% (${fc.trend}, ${fc.horizon})\n`;
      } else {
        addendum += `${i + 1}. ${h.statement} — confidence ${confPct}%\n`;
      }
    });
    addendum += '\n';
  }

  if (advisories.length > 0) {
    addendum += 'Active advisories:\n';
    for (const a of advisories) {
      addendum += `- ${a.domain}: ${a.statement}\n`;
    }
  }

  const pciPart = pci === null ? 'PCI —' : `PCI ${pci.index}`;
  const situationsPart = `${top3.length} active situation${top3.length === 1 ? '' : 's'}`;
  const advisoriesPart = `${advisories.length} advisor${advisories.length === 1 ? 'y' : 'ies'}`;
  const summaryLine = `${pciPart} · ${situationsPart} · ${advisoriesPart}`;

  return { systemPromptAddendum: addendum, summaryLine };
}
