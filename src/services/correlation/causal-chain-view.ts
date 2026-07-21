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
 * One chain → panel shape. The visible path walks the links in causal
 * order (root → intermediates → leaves), so multi-hop chains show every
 * hop, not just endpoints. The chain only materializes observations at
 * its endpoints; intermediate nodes resolve through the injected lookup
 * (typically the observation store) and degrade to a mechanism-labeled
 * placeholder when the observation has aged out of the ring buffer.
 */
export function causalChainToPanelChain(
  chain: CausalChain,
  resolveObservation?: (id: string) => ObservationEvent | undefined,
): PanelCorrelationChain {
  const materialized = new Map<string, ObservationEvent>([[chain.rootCause.id, chain.rootCause]]);
  for (const leaf of chain.leafEffects) materialized.set(leaf.id, leaf);

  const events: PanelChainEvent[] = [];
  const seen = new Set<string>();
  const push = (nodeId: string, mechanism?: string): void => {
    if (seen.has(nodeId)) return;
    seen.add(nodeId);
    const known = materialized.get(nodeId) ?? resolveObservation?.(nodeId);
    if (known) {
      events.push(toPanelEvent(known));
      return;
    }
    events.push({
      id: nodeId,
      domain: 'unknown',
      title: mechanism ? `(via ${mechanism})` : '(intermediate event)',
      severity: 30,
      occurredAt: chain.builtAt,
    });
  };

  push(chain.rootCause.id);
  // Links were collected root-outward (BFS); array order is causal order.
  for (const link of chain.links) {
    push(link.causeId, link.mechanism);
    push(link.effectId, link.mechanism);
  }
  // Leaves not reachable through links (defensive) still render.
  for (const leaf of [...chain.leafEffects].sort((a, b) => a.timestamp - b.timestamp)) {
    push(leaf.id);
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
export function chainsForPanel(
  chains: readonly CausalChain[],
  resolveObservation?: (id: string) => ObservationEvent | undefined,
): PanelCorrelationChain[] {
  return chains
    .map((c) => causalChainToPanelChain(c, resolveObservation))
    .sort((a, b) => b.detectedAt - a.detectedAt || b.confidence - a.confidence);
}
