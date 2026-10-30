import type { NewsItem } from '@/types';
import {
  acquisitionAge, newsDeliveryGroup, normalizeAcquisition, normalizeNewsProvenance,
  type NewsAcquisition, type NewsDeliveryGroup,
} from './news-provenance';

export const NEWS_SNAPSHOT_MAX_AGE_MS = 2 * 60 * 60 * 1000;
const MAX_SOURCES = 500;
const MAX_ITEMS_PER_SOURCE = 80;

export interface NewsSnapshotScope {
  variant: string;
  language: string;
  query: string;
  configSignature: string;
}
export interface NewsSnapshotSourceConfig {
  sourceId: string;
  label: string;
  configuredUrl: string;
  enabled: boolean;
  category: string;
}
export interface NewsSnapshotSource extends NewsSnapshotSourceConfig {
  deliveryGroup: NewsDeliveryGroup;
  acquisition: NewsAcquisition;
  items: readonly NewsItem[];
}
export interface NewsSnapshotView {
  generation: number;
  scope: NewsSnapshotScope | null;
  sources: readonly NewsSnapshotSource[];
}
export interface NewsSnapshotConfiguration {
  scope: NewsSnapshotScope;
  sources: readonly NewsSnapshotSourceConfig[];
}
const unknown = (): NewsAcquisition => ({ outcome: 'unknown', delivery: 'unknown', attemptedAt: null, acquiredAt: null, cacheStoredAt: null, acceptedCount: 0 });

/** App lifetime only: no acquisition, persistence, timers, or provider discovery. */
export class NewsSnapshot {
  private generation = 0;
  private scope: NewsSnapshotScope | null = null;
  private sources = new Map<string, NewsSnapshotSource>();
  private listeners = new Set<(snapshot: NewsSnapshotView) => void>();
  private destroyed = false;
  private scopeProvider: (() => NewsSnapshotConfiguration) | null = null;

  bindScope(provider: () => NewsSnapshotConfiguration): void {
    if (this.destroyed) return;
    this.scopeProvider = provider;
    this.syncScope();
  }

  private syncScope(): void {
    if (this.destroyed || !this.scopeProvider) return;
    const config = this.scopeProvider();
    this.setScope(config.scope, config.sources);
  }

  setScope(scope: NewsSnapshotScope, configs: readonly NewsSnapshotSourceConfig[]): number {
    if (this.destroyed) return this.generation;
    const bounded = [...new Map(configs.map(config => [config.sourceId, config])).values()].slice(0, MAX_SOURCES);
    const signature = (entries: readonly NewsSnapshotSourceConfig[]) => JSON.stringify(entries.map(config => [config.sourceId, config.label, config.configuredUrl, config.enabled, config.category]));
    if (JSON.stringify(this.scope) === JSON.stringify(scope)
      && signature([...this.sources.values()]) === signature(bounded)) return this.generation;
    this.generation++;
    this.scope = { ...scope };
    this.sources.clear();
    for (const config of bounded) {
      this.sources.set(config.sourceId, {
        ...config, deliveryGroup: newsDeliveryGroup(config.configuredUrl),
        acquisition: { ...unknown(), outcome: config.enabled ? 'unknown' : 'disabled' }, items: [],
      });
    }
    this.emit();
    return this.generation;
  }

  getSnapshot(): NewsSnapshotView {
    this.syncScope();
    return this.view();
  }

  private view(): NewsSnapshotView {
    return {
      generation: this.generation, scope: this.scope ? { ...this.scope } : null,
      sources: [...this.sources.values()].map(source => ({
        ...source, acquisition: { ...source.acquisition }, items: source.items.map(item => copyItem(item)),
      })),
    };
  }

  subscribe(listener: (snapshot: NewsSnapshotView) => void): () => void {
    if (!this.destroyed) this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  publish(generation: number, sourceId: string, items: readonly NewsItem[], acquisition: NewsAcquisition): boolean {
    this.syncScope();
    if (this.destroyed || generation !== this.generation) return false;
    const source = this.sources.get(sourceId);
    if (!source?.enabled) return false;
    const current = normalizeAcquisition(acquisition);
    const blocked = current.outcome === 'disabled' || current.outcome === 'unconfigured';
    // A late older attempt cannot replace a newer acquisition from an overlapping load.
    if (!blocked && source.acquisition.attemptedAt !== null
      && (current.attemptedAt === null || current.attemptedAt < source.acquisition.attemptedAt)) return false;
    const accepted = (blocked ? [] : items).filter(item => typeof item.title === 'string' && item.title.trim()
      && typeof item.link === 'string' && validArticleUrl(item.link))
      .slice(0, MAX_ITEMS_PER_SOURCE).map(item => {
        const provenance = normalizeNewsProvenance(item.provenance);
        return copyItem({ ...item, provenance: { ...provenance, sourceId, deliveryGroup: source.deliveryGroup } });
      });
    const retain = !blocked && accepted.length === 0 && current.outcome !== 'ok' && current.outcome !== 'empty';
    this.sources.set(sourceId, { ...source, acquisition: current, items: retain ? source.items : accepted });
    this.emit();
    return true;
  }

  getEligibleItems(now = Date.now()): NewsItem[] {
    this.syncScope();
    if (this.destroyed) return [];
    return [...this.sources.values()].filter(source => source.enabled && (source.deliveryGroup === 'google-rss'
        || source.deliveryGroup.startsWith('rss-direct:') || source.deliveryGroup === 'newsapi' || source.deliveryGroup === 'newsdata'))
      .flatMap(source => source.items.filter(item => {
        const provenance = normalizeNewsProvenance(item.provenance, now);
        const age = acquisitionAge(provenance, now);
        return provenance.sourceId === source.sourceId && provenance.deliveryGroup === source.deliveryGroup
          && provenance.acceptedCount > 0 && provenance.outcome !== 'disabled' && provenance.outcome !== 'unconfigured'
          && age !== null && age >= 0 && age < NEWS_SNAPSHOT_MAX_AGE_MS;
      }).map(item => copyItem(item)));
  }

  reset(): void {
    this.generation++;
    this.scope = null;
    this.sources.clear();
    this.emit();
  }

  destroy(): void {
    this.scopeProvider = null;
    this.reset();
    this.destroyed = true;
    this.listeners.clear();
  }

  private emit(): void {
    const snapshot = this.view();
    for (const listener of this.listeners) listener(snapshot);
  }
}

function copyItem(item: NewsItem): NewsItem {
  return { ...item, pubDate: new Date(item.pubDate), ...(item.provenance ? { provenance: { ...item.provenance } } : {}) };
}

function validArticleUrl(value: string): boolean {
  try { return ['http:', 'https:'].includes(new URL(value).protocol); } catch { return false; }
}
