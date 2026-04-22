/**
 * Watchlist → Hypothesis bridge
 *
 * Today the watchlist only influences alert scoring — a member gets a
 * flat +mult in alert-routing. This bridge makes watchlist members a
 * first-class analyst-loop slot: whenever a watchlist entry shows up in
 * multiple surfaces (hot alerts + situations) we synthesize a
 * `watchlist-convergence` hypothesis with the watchlist entry as the
 * implied region.
 *
 * analyst-loop imports getWatchlistHypotheses() and includes the result
 * alongside its own sources at rank time. Because the signature includes
 * the watchlist label as region, feedback and playbooks work normally.
 */

import { getWatchlist, type WatchlistEntry } from './watchlist';
import { unifiedAlertStore, type UnifiedAlert, computeDistanceKm } from './unified-alerts';
import { situationEngine } from './situation-engine';
import { scoreAlert } from './alert-routing';

// These types must match analyst-loop exactly, but we redeclare them here
// locally to avoid importing analyst-loop at module load (circular: analyst-
// loop imports us). TypeScript checks compatibility at the call site.
type HypothesisKind =
  | 'cross-domain-cluster'
  | 'anomaly-convergence'
  | 'alert-burst'
  | 'situation-escalation'
  | 'watchlist-convergence';

type EscalationRisk = 'low' | 'moderate' | 'high' | 'critical';

interface HypothesisEvidence {
  source: 'situation-engine' | 'anomaly-detection' | 'unified-alerts' | 'threat-synthesis';
  id: string;
  label: string;
  panelId?: string;
}

interface Hypothesis {
  id: string;
  kind: HypothesisKind;
  statement: string;
  confidence: number;
  risk: EscalationRisk;
  evidence: HypothesisEvidence[];
  timestamp: number;
  region?: string;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const HOT_ALERT_SCORE = 40;
const MIN_SURFACES = 2; // alert OR situation, need ≥2 distinct surfaces
const MAX_EVIDENCE_PER_HYP = 8;

// ── Helpers ──────────────────────────────────────────────────────────────────

let _idCounter = 0;
function genId(): string {
  _idCounter += 1;
  return `wh-${Date.now().toString(36)}-${_idCounter.toString(36)}`;
}

function confidenceToRisk(c: number): EscalationRisk {
  if (c >= 0.8) return 'critical';
  if (c >= 0.6) return 'high';
  if (c >= 0.35) return 'moderate';
  return 'low';
}

function textMatchesEntry(text: string, entry: WatchlistEntry): boolean {
  if (!text) return false;
  const lower = text.toLowerCase();
  return entry.keywords.some(k => k && lower.includes(k.toLowerCase()));
}

function locationNearEntry(
  loc: { lat: number; lon: number } | undefined,
  entry: WatchlistEntry,
): boolean {
  if (!loc) return false;
  if (typeof entry.lat !== 'number' || typeof entry.lon !== 'number') return false;
  const radius = entry.radiusKm ?? 100;
  return computeDistanceKm(entry.lat, entry.lon, loc.lat, loc.lon) <= radius;
}

function alertMatchesEntry(alert: UnifiedAlert, entry: WatchlistEntry): boolean {
  const text = `${alert.title} ${alert.body}`;
  if (textMatchesEntry(text, entry)) return true;
  return locationNearEntry(alert.location, entry);
}

// ── Core ─────────────────────────────────────────────────────────────────────

function collectMatchingAlerts(entry: WatchlistEntry): UnifiedAlert[] {
  const now = Date.now();
  const matching: UnifiedAlert[] = [];
  for (const alert of unifiedAlertStore.getAll()) {
    if (alert.acknowledged) continue;
    if (scoreAlert(alert, now) < HOT_ALERT_SCORE) continue;
    if (alertMatchesEntry(alert, entry)) matching.push(alert);
  }
  return matching;
}

function collectMatchingSituations(entry: WatchlistEntry): ReturnType<typeof situationEngine.getSituations> {
  const situations = situationEngine.getSituations();
  return situations.filter(s => {
    if (s.phase === 'resolved') return false;
    const text = `${s.title} ${s.summary}`;
    if (textMatchesEntry(text, entry)) return true;
    if (locationNearEntry({ lat: s.geo.lat, lon: s.geo.lon }, entry)) return true;
    return false;
  });
}

function buildHypothesisFor(
  entry: WatchlistEntry,
  alerts: UnifiedAlert[],
  situations: ReturnType<typeof situationEngine.getSituations>,
): Hypothesis | null {
  const alertHot = alerts.length > 0;
  const hasSituation = situations.length > 0;
  // Require at least two surfaces OR multiple hot alerts for credibility.
  const surfaces = (alertHot ? 1 : 0) + (hasSituation ? 1 : 0);
  if (surfaces < MIN_SURFACES && alerts.length < 3) return null;

  const evidence: HypothesisEvidence[] = [];
  for (const s of situations.slice(0, 3)) {
    evidence.push({
      source: 'situation-engine',
      id: s.id,
      label: s.title.slice(0, 100),
      panelId: 'situation-awareness',
    });
  }
  for (const a of alerts.slice(0, MAX_EVIDENCE_PER_HYP - evidence.length)) {
    evidence.push({
      source: 'unified-alerts',
      id: a.id,
      label: a.title.slice(0, 100),
      panelId: 'unified-alert-inbox',
    });
  }

  // Confidence scales with breadth of coverage.
  const breadth = Math.min(1, (alerts.length + situations.length) / 5);
  const confidence = Math.min(0.95, 0.5 + breadth * 0.4);

  const alertPlural = alerts.length === 1 ? '' : 's';
  const sitPlural = situations.length === 1 ? '' : 's';
  const alertPhrase = alerts.length > 0 ? `${alerts.length} hot alert${alertPlural}` : '';
  const sitPhrase = situations.length > 0 ? `${situations.length} active situation${sitPlural}` : '';
  const joiner = alertPhrase && sitPhrase ? ' and ' : '';
  const statement = `Watchlist entry "${entry.label}" is converging on ${alertPhrase}${joiner}${sitPhrase}.`;

  return {
    id: genId(),
    kind: 'watchlist-convergence',
    statement,
    confidence,
    risk: confidenceToRisk(confidence),
    region: entry.label,
    timestamp: Date.now(),
    evidence,
  };
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Synthesize hypotheses for any watchlist entry with 2+ supporting surfaces.
 * Called by analyst-loop each cycle; returns an empty array if the watchlist
 * is empty or nothing matches.
 */
export function getWatchlistHypotheses(): Hypothesis[] {
  const list = getWatchlist();
  if (list.length === 0) return [];
  const out: Hypothesis[] = [];
  for (const entry of list) {
    const alerts = collectMatchingAlerts(entry);
    const situations = collectMatchingSituations(entry);
    const h = buildHypothesisFor(entry, alerts, situations);
    if (h) out.push(h);
  }
  return out;
}
