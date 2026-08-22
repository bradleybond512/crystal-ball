/**
 * News clustering service - main thread wrapper.
 * Core logic is in analysis-core.ts (shared with worker).
 * Hybrid clustering combines Jaccard + semantic similarity when ML is available.
 */

import type { NewsItem, ClusteredEvent } from '@/types';

import { getSourceTier } from '@/config';
import { clusterNewsCore } from './analysis-core';
import { mlWorker } from './ml-worker';
import { ML_THRESHOLDS } from '@/config/ml-config';
import { buildClusterEvidencePack } from './evidence-pack';
import { boundSemanticClusters } from './analysis-input';

// Warn once per session — WKWebView can't run ONNX SIMD models so this fires constantly.
let clusterWarnedThisSession = false;

export function clusterNews(items: NewsItem[]): ClusteredEvent[] {
  return clusterNewsCore(items, getSourceTier) as ClusteredEvent[];
}

/**
 * Hybrid clustering: Jaccard first, then semantic refinement if ML available
 */
export async function clusterNewsHybrid(items: NewsItem[]): Promise<ClusteredEvent[]> {
  // Step 1: Fast Jaccard clustering
  const jaccardClusters = clusterNewsCore(items, getSourceTier) as ClusteredEvent[];

  // Step 2: If ML unavailable or too few clusters, return Jaccard results
  if (!mlWorker.isAvailable || jaccardClusters.length < ML_THRESHOLDS.minClustersForML) {
 return jaccardClusters;
  }

 try {
 // Bound local inference so a large feed refresh cannot pin the ML worker for minutes.
 const clusterTexts = boundSemanticClusters(jaccardClusters).map(c => ({
 id: c.id,
 text: c.primaryTitle,
 }));

 // Get semantic groupings
 const semanticGroups = await mlWorker.clusterBySemanticSimilarity(
 clusterTexts,
 ML_THRESHOLDS.semanticClusterThreshold
 );

 // Merge semantically similar clusters
 return mergeSemanticallySimilarClusters(jaccardClusters, semanticGroups);
  } catch {
 if (!clusterWarnedThisSession) {
 clusterWarnedThisSession = true;
 // eslint-disable-next-line no-console
 console.warn('[Clustering] Semantic clustering unavailable, using Jaccard only (suppressing further warnings)');
 }
 return jaccardClusters;
  }
}

/** Combine multiple semantically-similar clusters into one, using the highest-tier source as base. */
function combineGroupClusters(groupClusters: ClusteredEvent[]): ClusteredEvent {
  const sortedByTier = [...groupClusters].sort((a, b) => {
 const diff = getSourceTier(a.primarySource) - getSourceTier(b.primarySource);
 return diff === 0 ? b.lastUpdated.getTime() - a.lastUpdated.getTime() : diff;
  });
  const primary = sortedByTier[0]!;
  const allItems = [...primary.allItems];
  const topSourcesSet = new Map(primary.topSources.map(s => [s.url, s]));
  for (const other of sortedByTier.slice(1)) {
 allItems.push(...other.allItems);
 for (const src of other.topSources) {
 if (!topSourcesSet.has(src.url)) topSourcesSet.set(src.url, src);
 }
  }
  const sortedTopSources = [...topSourcesSet.values()].sort((a, b) => a.tier - b.tier).slice(0, 5);
  const allDates = allItems.map(i => i.pubDate.getTime());
  const merged: ClusteredEvent = {
 id: primary.id,
 primaryTitle: primary.primaryTitle,
 primaryLink: primary.primaryLink,
 primarySource: primary.primarySource,
 sourceCount: allItems.length,
 topSources: sortedTopSources,
 allItems,
 firstSeen: new Date(Math.min(...allDates)),
 lastUpdated: new Date(Math.max(...allDates)),
 isAlert: allItems.some(i => i.isAlert),
 monitorColor: primary.monitorColor,
 velocity: primary.velocity,
 threat: primary.threat,
  };
  merged.evidence = buildClusterEvidencePack(merged);
  return merged;
}

/**
 * Merge clusters that are semantically similar
 */
function mergeSemanticallySimilarClusters(
  clusters: ClusteredEvent[],
  semanticGroups: string[][]
): ClusteredEvent[] {
  const clusterMap = new Map(clusters.map(c => [c.id, c]));
  const merged: ClusteredEvent[] = [];
  const usedIds = new Set<string>();

  for (const group of semanticGroups) {
 if (group.length === 0) continue;
 const groupClusters = group
 .map(id => clusterMap.get(id))
 .filter((c): c is ClusteredEvent => c !== undefined && !usedIds.has(c.id));
 if (groupClusters.length === 0) continue;
 groupClusters.forEach(c => usedIds.add(c.id));
 merged.push(groupClusters.length === 1 ? groupClusters[0]! : combineGroupClusters(groupClusters));
  }

  for (const cluster of clusters) {
 if (!usedIds.has(cluster.id)) merged.push(cluster);
  }

  merged.sort((a, b) => b.lastUpdated.getTime() - a.lastUpdated.getTime());
  return merged;
}
