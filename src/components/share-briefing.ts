/**
 * Share-briefing adapter — builds a presentation-export `BriefingContent`
 * from plain command-center strings. Pure and decoupled from the
 * diagnostics / insights domain types so it's trivially testable and the
 * Command Center panel can hand it whatever strings it already computes.
 */

import type {
  BriefingContent,
  BriefingMetadataItem,
  BriefingSection,
} from '@/services/insights/presentation-export';

export interface ShareBriefingInput {
  headline: string;
  severityScore?: number;
  confidence?: 'low' | 'medium' | 'high';
  location?: string;
  sourceCount?: number;
  concerns: readonly string[];
  watch: readonly string[];
  actions: readonly string[];
  generatedAt: number;
}

export function buildShareBriefing(input: ShareBriefingInput): BriefingContent {
  const metadata: BriefingMetadataItem[] = [];
  if (input.location) metadata.push({ label: 'Location', value: input.location });
  if (input.sourceCount !== undefined) metadata.push({ label: 'Sources', value: String(input.sourceCount) });

  const sections: BriefingSection[] = [];
  if (input.concerns.length > 0) sections.push({ heading: 'Top concerns', bullets: [...input.concerns] });
  if (input.watch.length > 0) sections.push({ heading: 'What to watch', bullets: [...input.watch] });
  if (input.actions.length > 0) sections.push({ heading: 'Recommended actions', bullets: [...input.actions] });

  return {
    title: `Crystal Ball briefing — ${input.headline}`,
    generatedAt: input.generatedAt,
    summary: input.headline,
    severityScore: input.severityScore,
    confidence: input.confidence,
    metadata: metadata.length > 0 ? metadata : undefined,
    sections,
  };
}
