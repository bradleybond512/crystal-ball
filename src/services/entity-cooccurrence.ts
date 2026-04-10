/**
 * Entity co-occurrence graph — builds an adjacency map from entity
 * mentions that appear together in the same alerts.
 *
 * Used by StatusOverlay to render a small force-directed graph.
 */

import { computeEntityHeat } from './entity-heat';
import { unifiedAlertStore } from './unified-alerts';

export interface CooccurrenceEdge {
  a: string;
  b: string;
  weight: number;
}

export interface CooccurrenceNode {
  name: string;
  mentions: number;
}

export interface CooccurrenceGraph {
  nodes: CooccurrenceNode[];
  edges: CooccurrenceEdge[];
}

export function buildCooccurrenceGraph(windowMs = 6 * 60 * 60_000): CooccurrenceGraph {
  const heat = computeEntityHeat(windowMs);
  const entityNames = new Set(heat.map(e => e.name));
  const nodeMap = new Map<string, CooccurrenceNode>();
  for (const e of heat) nodeMap.set(e.name, { name: e.name, mentions: e.count });

  const edgeMap = new Map<string, CooccurrenceEdge>();
  const cutoff = Date.now() - windowMs;
  const alerts = unifiedAlertStore.getAll().filter(a => a.timestamp >= cutoff && !a.acknowledged);

  for (const a of alerts) {
    const present: string[] = [];
    for (const name of entityNames) {
      const ent = heat.find(e => e.name === name);
      if (ent?.alertIds.includes(a.id)) present.push(name);
    }
    for (let i = 0; i < present.length; i++) {
      for (let j = i + 1; j < present.length; j++) {
        const pair = [present[i]!, present[j]!].sort((a, b) => a.localeCompare(b));
        const key = `${pair[0]}|${pair[1]}`;
        const edge = edgeMap.get(key) ?? { a: pair[0]!, b: pair[1]!, weight: 0 };
        edge.weight++;
        edgeMap.set(key, edge);
      }
    }
  }

  return {
    nodes: [...nodeMap.values()].sort((a, b) => b.mentions - a.mentions).slice(0, 15),
    edges: [...edgeMap.values()].filter(e => e.weight >= 2).sort((a, b) => b.weight - a.weight).slice(0, 30),
  };
}
