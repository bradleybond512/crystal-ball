/**
 * Causal-chain view adapter — maps the LIVE causal-chain builder's
 * chains into the CorrelationMapPanel render shape. Replaces the dead
 * sidecar mirror read (correlator-v2 never posted to it, so the panel
 * rendered empty since forever).
 *
 * Pure: the chain list is injected; no DOM, no fetch, no clock reads.
 */

import type { CausalChain } from '../intelligence/causal-chain';
import type { ObservationEvent } from '@/types/intelligence';

export interface PanelChainEvent {
  id: string;
  domain: string;
  title: string;
  /** 0–100 numeric severity (panel contract). */
  severity: number;
  occurredAt: number;
}

export interface PanelCorrelationChain {
  id: string;
  chainType: string;
  title: string;
  confidence: number;
  detectedAt: number;
  events: PanelChainEvent[];
}

const SEVERITY_SCORE: Record<ObservationEvent['severity'], number> = {
  INFO: 10,
  LOW: 30,
  MEDIUM: 55,
  HIGH: 75,
  CRITICAL: 92,
};

function toPanelEvent(o: ObservationEvent): PanelChainEvent {
  return {
    id: o.id,
    domain: o.domain,
    title: o.title,
    severity: SEVERITY_SCORE[o.severity] ?? 30,
    occurredAt: o.timestamp,
  };
}

/**
 * One chain → panel shape. Events are the root cause followed by the
 * leaf effects, time-ordered (the chain only materializes observations
 * at its endpoints; intermediate hops exist as link ids only).
 */
export function causalChainToPanelChain(chain: CausalChain): PanelCorrelationChain {
  const seen = new Set<string>([chain.rootCause.id]);
  const events: PanelChainEvent[] = [toPanelEvent(chain.rootCause)];
  const leaves = [...chain.leafEffects].sort((a, b) => a.timestamp - b.timestamp);
  for (const leaf of leaves) {
    if (seen.has(leaf.id)) continue;
    seen.add(leaf.id);
    events.push(toPanelEvent(leaf));
  }
  return {
    id: chain.id,
    chainType: 'causal',
    title: chain.rootCause.title,
    confidence: chain.overallConfidence,
    detectedAt: chain.builtAt,
    events,
  };
}

/** Newest-first, confidence-tiebroken list for the panel. */
export function chainsForPanel(chains: readonly CausalChain[]): PanelCorrelationChain[] {
  return chains
    .map((c) => causalChainToPanelChain(c))
    .sort((a, b) => b.detectedAt - a.detectedAt || b.confidence - a.confidence);
}
