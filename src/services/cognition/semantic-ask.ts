/**
 * Semantic Ask-the-Data fallback.
 *
 * When `insights/ask-the-data.ts` classifies a question as `unknown` (none
 * of the six structured intents match), this module retrieves the most
 * relevant past briefs and snapshots from `briefing-archive` /
 * `snapshot-archive` using hashed embeddings, then assembles a grounded
 * answer with episode provenance.
 *
 * Design decisions:
 *   - Answers are assembled from real archived content — never free-form
 *     LLM generation.  Provenance (archiveId + generatedAt) accompanies
 *     every evidence row (plan invariant: every claim carries provenance).
 *   - Uses the same `embedHashed` tier as the rest of the cognition layer
 *     so the fallback is fully deterministic and offline-safe.
 *   - `topK` from `vector-index.ts` handles similarity ranking.
 *   - Ghost Mode: reads from archives in read-only fashion, never writes.
 *
 * Plan invariant: every score has an explanation — the `explanation` field
 * on each SemanticHit describes what text matched and why.
 */

import { embedHashed } from './embedding-provider';
import { topK } from './vector-index';
import type { AnswerPacket, EvidenceRow } from '../insights/ask-the-data';
import { getArchive } from '../briefing-archive';
import { getAllSnapshots } from '../snapshot-archive';
import type { AutoBrief } from '../auto-brief';
import type { AnalystSnapshot } from '../analyst-loop';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SemanticHit {
  id: string;
  text: string;
  similarity: number;
  sourceKind: 'brief' | 'snapshot';
  generatedAt: number;
  explanation: string;
}

// ── Internal helpers ──────────────────────────────────────────────────────────

/** Extract a short searchable text from an AutoBrief. */
function briefText(b: AutoBrief): string {
  return `${b.domain}: ${b.summary || b.text.slice(0, 300)}`;
}

/** Extract a short searchable text from an AnalystSnapshot. */
function snapshotText(s: AnalystSnapshot): string {
  const tops = s.hypotheses.slice(0, 3).map(h => h.statement).join(' ');
  return tops || 'analyst snapshot';
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Retrieve the top-K most semantically relevant past briefs and snapshots
 * for a free-form question. Returns up to `k` hits sorted by similarity.
 */
export function semanticRetrieve(question: string, k = 5): SemanticHit[] {
  const queryVec = embedHashed(question);

  // Build corpus from briefing-archive
  const briefs = getArchive();
  const briefCorpus = briefs.map((b, i) => ({
    id: `brief:${i}:${b.domain}:${b.generatedAt}`,
    vector: embedHashed(briefText(b)).vector,
    tier: 'hashed' as const,
    _b: b,
  }));

  // Build corpus from snapshot-archive (use top-3 hypothesis text per snapshot)
  const snapshots = getAllSnapshots();
  const snapCorpus = snapshots.map((s, i) => ({
    id: `snapshot:${i}:${s.timestamp}`,
    vector: embedHashed(snapshotText(s)).vector,
    tier: 'hashed' as const,
    _s: s,
  }));

  const corpus = [...briefCorpus, ...snapCorpus].map(item => ({
    id: item.id,
    vector: item.vector,
    tier: item.tier,
  }));

  if (corpus.length === 0) return [];

  const ranked = topK({ id: 'query', vector: queryVec.vector, tier: 'hashed' }, corpus, k, 0.3);

  // Assemble hits with provenance
  const hits: SemanticHit[] = [];
  for (const { id, similarity } of ranked) {
    if (id.startsWith('brief:')) {
      const idx = Number.parseInt(id.split(':')[1] ?? '0', 10);
      const b = briefs[idx];
      if (!b) continue;
      hits.push({
        id,
        text: b.summary || b.text.slice(0, 280),
        similarity,
        sourceKind: 'brief',
        generatedAt: b.generatedAt,
        explanation: `Past brief (${b.domain}, ${ageLabel(b.generatedAt)}) matched with ${pct(similarity)} similarity.`,
      });
    } else if (id.startsWith('snapshot:')) {
      const idx = Number.parseInt(id.split(':')[1] ?? '0', 10);
      const s = snapshots[idx];
      if (!s) continue;
      const topH = s.hypotheses[0]?.statement ?? 'no hypotheses';
      hits.push({
        id,
        text: topH.slice(0, 280),
        similarity,
        sourceKind: 'snapshot',
        generatedAt: s.timestamp,
        explanation: `Past analyst snapshot (${ageLabel(s.timestamp)}) matched with ${pct(similarity)} similarity.`,
      });
    }
  }
  return hits;
}

/**
 * Build an `AnswerPacket` for the `unknown` intent using semantic retrieval.
 * Returns null when there are no archive entries at all (cold start).
 */
export function semanticFallback(question: string): AnswerPacket | null {
  const hits = semanticRetrieve(question, 5);
  if (hits.length === 0) return null;

  const evidence: EvidenceRow[] = hits.map(h => ({
    id: h.id,
    label: h.sourceKind === 'brief' ? 'Past Brief' : 'Past Snapshot',
    fact: h.text,
    confidence: h.similarity,
  }));

  const topHit = hits[0]!;
  const answer =
    `Closest match from ${hits.length} archived ${hits.length === 1 ? 'record' : 'records'}: ` +
    `"${topHit.text.slice(0, 200)}" ` +
    `(${topHit.explanation})`;

  const followUps = [
    'Why is risk high right now?',
    'What changed since the last brief?',
    'What should I watch next?',
  ];

  return {
    question,
    intent: 'unknown',
    answer,
    evidence,
    followUps,
  };
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function ageLabel(tsMs: number): string {
  const ageMs = Date.now() - tsMs;
  const h = Math.round(ageMs / (60 * 60 * 1000));
  if (h < 1) return 'just now';
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

function pct(sim: number): string {
  return `${Math.round(sim * 100)}%`;
}
