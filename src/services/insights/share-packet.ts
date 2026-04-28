/**
 * Shareable Intelligence Packets — gap #13 from
 * docs/ELITE_REMAINING_GAPS_FOR_CLAUDE.md.
 *
 * Wraps the existing presentation-export helpers (toMarkdown,
 * toClipboardSummary, toShareSheetText, toClaudeDebugPacket) into a
 * single one-click "send this to someone" surface that bundles:
 *   - the briefing content
 *   - source/provenance appendix
 *   - diagnostics appendix when warning delivery is questioned
 *   - a stable shareId for citation
 *
 * Pure deterministic. No DOM, no fetch, no globals at import time.
 */

import {
  toMarkdown,
  toClipboardSummary,
  toShareSheetText,
  toClaudeDebugPacket,
  type BriefingContent,
} from './presentation-export';

// ── Public API ──────────────────────────────────────────────────────────

export type ShareFormat = 'markdown' | 'clipboard' | 'share_sheet' | 'claude_debug';

export interface ProvenanceEntry {
  /** Source id ("nws-alerts", "fred", "watchlist:taiwan"). */
  sourceId: string;
  /** Display label. */
  label: string;
  /** Free-text claim or fact this source contributed. */
  claim: string;
  /** ms timestamp this fact was observed. */
  observedAt: number;
  /** Optional confidence 0..1. */
  confidence?: number;
}

export interface DiagnosticsAppendix {
  /** Plain-English answer to "why did or did not I get warned?". */
  whyOrWhyNot: string;
  /** Key timestamps from the warning trace. */
  trace?: readonly { stage: string; outcome: string; at?: number; reason?: string }[];
  /** Optional remediation hints if delivery is questioned. */
  remediation?: readonly string[];
}

export interface BuildSharePacketInput {
  /** Stable id — the receiver can quote this back. */
  shareId: string;
  /** Optional clock for tests. Defaults to Date.now(). */
  now?: () => number;
  briefing: BriefingContent;
  /** Source/provenance appendix. */
  provenance?: readonly ProvenanceEntry[];
  /** Optional diagnostics appendix (used when sharing a "why didn't I
   *  get warned?" trace). */
  diagnostics?: DiagnosticsAppendix;
  /** Footer URL the receiver can use to drill into the underlying
   *  data (optional — leave undefined for offline shares). */
  followUpUrl?: string;
}

export interface SharePacket {
  shareId: string;
  generatedAt: number;
  /** Markdown export — for GitHub issues, Notion, email. */
  markdown: string;
  /** Plain-text clipboard summary (≤ 280 chars by default). */
  clipboard: string;
  /** Native share-sheet body (mobile). */
  shareSheet: string;
  /** Claude debug packet — the same JSON we'd hand the model. */
  claudeDebug: string;
  /** The original briefing content for re-use. */
  briefing: BriefingContent;
  /** Provenance copied through for the export bundle. */
  provenance: readonly ProvenanceEntry[];
  /** Diagnostics if the briefing came with one. */
  diagnostics?: DiagnosticsAppendix;
}

// ── Builder ────────────────────────────────────────────────────────────

export function buildSharePacket(input: BuildSharePacketInput): SharePacket {
  const now = input.now ?? (() => Date.now());
  const generatedAt = now();
  const enrichedBriefing = enrichBriefing(input);
  const markdown = toMarkdown(enrichedBriefing);
  const clipboard = toClipboardSummary(enrichedBriefing);
  const shareSheet = toShareSheetText(enrichedBriefing);
  const claudeDebug = toClaudeDebugPacket(enrichedBriefing);
  return {
    shareId: input.shareId,
    generatedAt,
    markdown,
    clipboard,
    shareSheet,
    claudeDebug,
    briefing: enrichedBriefing,
    provenance: input.provenance ?? [],
    diagnostics: input.diagnostics,
  };
}

/** Pull a single format out of a packet — convenient when the host
 *  only needs one (e.g. clipboard write). */
export function selectFormat(packet: SharePacket, format: ShareFormat): string {
  switch (format) {
    case 'markdown': {
      return packet.markdown;
    }
    case 'clipboard': {
      return packet.clipboard;
    }
    case 'share_sheet': {
      return packet.shareSheet;
    }
    case 'claude_debug': {
      return packet.claudeDebug;
    }
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────

function enrichBriefing(input: BuildSharePacketInput): BriefingContent {
  const provenanceSection = buildProvenanceSection(input.provenance);
  const diagnosticsSection = buildDiagnosticsSection(input.diagnostics);
  const sections = [...input.briefing.sections];
  if (provenanceSection) sections.push(provenanceSection);
  if (diagnosticsSection) sections.push(diagnosticsSection);
  const metadata = [...(input.briefing.metadata ?? []), { label: 'Share ID', value: input.shareId }];
  if (input.followUpUrl) metadata.push({ label: 'Follow-up', value: input.followUpUrl });
  return {
    ...input.briefing,
    metadata,
    sections,
  };
}

function buildProvenanceSection(
  provenance: readonly ProvenanceEntry[] | undefined,
): BriefingContent['sections'][number] | undefined {
  if (!provenance || provenance.length === 0) return undefined;
  const bullets = provenance.map((p) => {
    const conf = p.confidence === undefined ? '' : ` · confidence ${(p.confidence * 100).toFixed(0)}%`;
    return `${p.label} (${p.sourceId}): ${p.claim}${conf}`;
  });
  return {
    heading: 'Sources',
    bullets,
  };
}

function buildDiagnosticsSection(
  diagnostics: DiagnosticsAppendix | undefined,
): BriefingContent['sections'][number] | undefined {
  if (!diagnostics) return undefined;
  const bullets: string[] = [diagnostics.whyOrWhyNot];
  if (diagnostics.trace) {
    for (const t of diagnostics.trace) {
      const note = t.reason ? ` — ${t.reason}` : '';
      bullets.push(`${t.stage}: ${t.outcome}${note}`);
    }
  }
  if (diagnostics.remediation && diagnostics.remediation.length > 0) {
    bullets.push(`Remediation: ${diagnostics.remediation.join('; ')}`);
  }
  return {
    heading: 'Why or why not',
    bullets,
  };
}
