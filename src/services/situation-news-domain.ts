import type { SituationDomain } from './situation-types';
import type { EventCategory, ThreatClassification } from './threat-classifier';

export interface NewsArticleEvidence {
  articleId: string;
  sourceId: string;
  publishedAt: number;
  category?: EventCategory;
  confidence?: number;
  method?: ThreatClassification['source'];
}

export interface NewsDomainEvidence {
  articles: NewsArticleEvidence[];
  overflow?: boolean;
}

export type NewsDomainReason = 'supported' | 'incomplete_evidence' | 'unsupported_category'
  | 'invalid_evidence' | 'conflicting_evidence' | 'insufficient_evidence' | 'evidence_overflow';

export interface SituationDomainClassification {
  version: 1;
  domain: SituationDomain;
  basis: 'article_classification' | 'abstained';
  reason: NewsDomainReason;
  evidence: NewsArticleEvidence[];
  articleCount: number;
  sourceCount: number;
}

const MAX_ARTICLES = 64;
const MAX_REFERENCES = 8;
const CATEGORY_DOMAINS: Partial<Record<EventCategory, SituationDomain>> = {
  protest: 'civil_unrest', economic: 'economic', disaster: 'natural_hazard',
  conflict: 'military', military: 'military', terrorism: 'military',
  cyber: 'cyber', health: 'health', infrastructure: 'infrastructure',
};
const CATEGORIES = new Set(['conflict', 'protest', 'disaster', 'diplomatic', 'economic', 'terrorism',
  'cyber', 'health', 'environmental', 'military', 'crime', 'infrastructure', 'tech', 'general']);
const METHODS = new Set(['keyword', 'ml', 'llm']);
const REASONS = new Set<NewsDomainReason>(['supported', 'incomplete_evidence', 'unsupported_category',
  'invalid_evidence', 'conflicting_evidence', 'insufficient_evidence', 'evidence_overflow']);

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validId(value: unknown, limit: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= limit
    && new TextEncoder().encode(value).length <= limit
    && value === value.trim() && !/[\u0000-\u001F\u007F]/u.test(value);
}

function articleProblem(value: unknown, asOf: number): NewsDomainReason | null {
  if (!record(value) || !validId(value.articleId, 512) || !validId(value.sourceId, 128)
    || typeof value.publishedAt !== 'number' || !Number.isFinite(value.publishedAt)
    || value.publishedAt <= 0 || value.publishedAt > asOf) return 'invalid_evidence';
  if (value.category === undefined || value.confidence === undefined || value.method === undefined) return 'incomplete_evidence';
  if (typeof value.category !== 'string' || !CATEGORIES.has(value.category)
    || typeof value.method !== 'string' || !METHODS.has(value.method)
    || typeof value.confidence !== 'number' || !Number.isFinite(value.confidence)
    || value.confidence <= 0 || value.confidence > 1) return 'invalid_evidence';
  return null;
}

function copyArticle(value: Record<string, unknown>): NewsArticleEvidence {
  return { articleId: value.articleId as string, sourceId: value.sourceId as string,
    publishedAt: value.publishedAt as number, category: value.category as EventCategory,
    confidence: value.confidence as number, method: value.method as ThreatClassification['source'] };
}

function compareArticles(a: NewsArticleEvidence, b: NewsArticleEvidence): number {
  if (a.articleId === b.articleId) return 0;
  return a.articleId < b.articleId ? -1 : 1;
}

function references(articles: NewsArticleEvidence[]): NewsArticleEvidence[] {
  const ordered = [...articles].sort(compareArticles);
  const selected: NewsArticleEvidence[] = [];
  const sources = new Set<string>();
  for (const article of ordered) {
    if (sources.has(article.sourceId)) continue;
    sources.add(article.sourceId);
    selected.push(article);
    if (selected.length === MAX_REFERENCES) break;
  }
  for (const article of ordered) {
    if (selected.length === MAX_REFERENCES) break;
    if (!selected.includes(article)) selected.push(article);
  }
  return selected.sort(compareArticles);
}

function result(reason: NewsDomainReason, articles: NewsArticleEvidence[] = [], domain: SituationDomain = 'unknown'): SituationDomainClassification {
  return { version: 1, domain, basis: reason === 'supported' ? 'article_classification' : 'abstained', reason,
    evidence: references(articles), articleCount: articles.length, sourceCount: new Set(articles.map(a => a.sourceId)).size };
}

export function classifyNewsDomain(input: unknown, asOf: number): SituationDomainClassification {
  if (input === undefined || input === null) return result('incomplete_evidence');
  if (!record(input) || !Array.isArray(input.articles) || !Number.isFinite(asOf) || asOf <= 0
    || (input.overflow !== undefined && typeof input.overflow !== 'boolean')) return result('invalid_evidence');
  if (input.overflow) return result('evidence_overflow');
  const unique = new Map<string, NewsArticleEvidence>();
  const problems = new Set<NewsDomainReason>();
  for (const value of input.articles) {
    const problem = articleProblem(value, asOf);
    if (problem) { problems.add(problem); continue; }
    const article = copyArticle(value as Record<string, unknown>);
    const previous = unique.get(article.articleId);
    if (previous && JSON.stringify(previous) !== JSON.stringify(article)) problems.add('invalid_evidence');
    else unique.set(article.articleId, article);
    if (unique.size > MAX_ARTICLES) return result('evidence_overflow');
  }
  const articles = [...unique.values()];
  if (problems.has('invalid_evidence')) return result('invalid_evidence', articles);
  if (problems.has('incomplete_evidence')) return result('incomplete_evidence', articles);
  return classifyValidArticles(articles);
}

function classifyValidArticles(articles: NewsArticleEvidence[]): SituationDomainClassification {
  const domains = new Set<SituationDomain>();
  let unsupported = false;
  for (const article of articles) {
    const domain = CATEGORY_DOMAINS[article.category!];
    if (domain) domains.add(domain);
    else unsupported = true;
  }
  if (unsupported) return result('unsupported_category', articles);
  if (domains.size > 1) return result('conflicting_evidence', articles);
  if (articles.length < 2 || new Set(articles.map(a => a.sourceId)).size < 2) return result('insufficient_evidence', articles);
  return result('supported', articles, [...domains][0]!);
}

interface ContributingArticle {
  link?: string;
  source: string;
  pubDate: Date;
  threat?: ThreatClassification;
  provenance?: { sourceId: string; publicationState: string; publishedAt: number | null };
}

function publicationTime(item: ContributingArticle): number {
  if (!item.provenance) return item.pubDate.getTime();
  return item.provenance.publicationState === 'known' ? item.provenance.publishedAt ?? Number.NaN : Number.NaN;
}

export function collectNewsEvidence(items: readonly ContributingArticle[]): NewsDomainEvidence {
  const unique = new Map<string, NewsArticleEvidence>();
  for (const item of items) {
    const article: NewsArticleEvidence = {
      articleId: item.link ?? '',
      sourceId: item.provenance?.sourceId ?? item.source,
      publishedAt: publicationTime(item),
      ...(item.threat && { category: item.threat.category, confidence: item.threat.confidence, method: item.threat.source }),
    };
    const previous = unique.get(article.articleId);
    if (previous && JSON.stringify(previous) !== JSON.stringify(article)) return { articles: [previous, article] };
    unique.set(article.articleId, article);
    if (unique.size > MAX_ARTICLES) return { articles: [], overflow: true };
  }
  return { articles: [...unique.values()] };
}

export function isGenericNewsSignalType(type: string): boolean {
  return type === 'velocity_spike' || type === 'keyword_spike' || type === 'convergence';
}

export function restoreNewsDomainClassification(input: unknown, asOf: number): SituationDomainClassification {
  if (input === undefined || input === null) return result('incomplete_evidence');
  if (!record(input) || input.version !== 1 || !REASONS.has(input.reason as NewsDomainReason)
    || !Array.isArray(input.evidence) || input.evidence.length > MAX_REFERENCES
    || !Number.isInteger(input.articleCount) || !Number.isInteger(input.sourceCount)
    || (input.articleCount as number) < 0 || (input.articleCount as number) > MAX_ARTICLES
    || (input.sourceCount as number) < 0 || (input.sourceCount as number) > (input.articleCount as number)
    || !Number.isFinite(asOf) || asOf <= 0) return result('invalid_evidence');
  const evidence: NewsArticleEvidence[] = [];
  for (const value of input.evidence) {
    if (articleProblem(value, asOf)) return result('invalid_evidence');
    evidence.push(copyArticle(value as Record<string, unknown>));
  }
  const articleCount = input.articleCount as number;
  const sourceCount = input.sourceCount as number;
  const retainedSources = new Set(evidence.map(a => a.sourceId)).size;
  if (new Set(evidence.map(a => a.articleId)).size !== evidence.length || evidence.length > articleCount
    || retainedSources > sourceCount || (evidence.length === articleCount && retainedSources !== sourceCount)) return result('invalid_evidence');
  if (input.domain === 'unknown') {
    if (input.basis !== 'abstained' || input.reason === 'supported') return result('invalid_evidence');
  } else {
    if (typeof input.domain !== 'string' || !Object.values(CATEGORY_DOMAINS).includes(input.domain as SituationDomain)
      || input.basis !== 'article_classification' || input.reason !== 'supported'
      || articleCount < 2 || sourceCount < 2 || evidence.length < 2 || retainedSources < 2
      || evidence.some(a => CATEGORY_DOMAINS[a.category!] !== input.domain)) return result('invalid_evidence');
  }
  return { version: 1, domain: input.domain as SituationDomain,
    basis: input.basis as SituationDomainClassification['basis'], reason: input.reason as NewsDomainReason,
    evidence: references(evidence), articleCount, sourceCount };
}
