/**
 * Anomaly Detection Engine — adaptive statistical monitoring
 *
 * Monitors multiple signal streams (alert counts, EMA velocity, data freshness,
 * market volatility, military activity) using rolling-window Z-score analysis
 * and pattern detection (spikes, silence, reversals, deviations).
 *
 * Fully offline, no network calls. Dispatches `wm:anomaly-detected` CustomEvent
 * on document when anomalies are detected. Persists history in localStorage.
 *
 * Integration: call `anomalyEngine.ingest(source, value, timestamp)` from
 * data-loader after each data refresh cycle.
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export type AnomalyType = 'spike' | 'silence' | 'reversal' | 'deviation';
export type AnomalySeverity = 'info' | 'warning' | 'critical';

export interface Anomaly {
  id: string;
  source: string;
  type: AnomalyType;
  severity: AnomalySeverity;
  value: number;
  expectedMin: number;
  expectedMax: number;
  zScore: number;
  timestamp: number;
  description: string;
}

interface Observation {
  value: number;
  timestamp: number;
}

interface SourceState {
  observations: Observation[];
  lastValue: number | null;
  lastTimestamp: number | null;
  trendDirection: 'up' | 'down' | 'flat';
  trendLength: number;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const STORAGE_KEY = 'crystalball-anomaly-history';
const MAX_HISTORY = 100;
const DEFAULT_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours
const Z_SCORE_THRESHOLD = 2.5;
const BURST_MULTIPLIER = 10;
const SILENCE_THRESHOLD_MS = 2 * 60 * 60 * 1000; // 2 hours without update = silence
const MIN_OBSERVATIONS = 5; // need at least this many for meaningful stats
const REVERSAL_Z_THRESHOLD = 1.5; // Lower threshold for reversals — inherently notable

// ── Math helpers ──────────────────────────────────────────────────────────────

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

function stdDev(values: number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  const variance = values.reduce((s, v) => s + (v - m) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

let idCounter = 0;

/** Non-cryptographic ID for deduplication only (not security-sensitive). */
function generateId(): string {
  idCounter++;
  return `${Date.now()}-${idCounter}`;
}

// ── Severity classification ───────────────────────────────────────────────────

function classifySeverity(zScore: number, type: AnomalyType): AnomalySeverity {
  const absZ = Math.abs(zScore);
  if (type === 'silence') {
 // Silence is always at least warning
 return absZ >= 4 ? 'critical' : 'warning';
  }
  if (absZ >= 4) return 'critical';
  if (absZ >= 3) return 'warning';
  return 'info';
}

/** Determine trend direction from value comparison. */
function computeDirection(current: number, previous: number): 'up' | 'down' | 'flat' {
  if (current > previous) return 'up';
  if (current < previous) return 'down';
  return 'flat';
}

// ── Anomaly Detection Engine ──────────────────────────────────────────────────

class AnomalyDetectionEngine {
  private sources = new Map<string, SourceState>();
  private activeAnomalies: Anomaly[] = [];
  private history: Anomaly[] = [];
  private subscribers = new Set<(anomaly: Anomaly) => void>();
  private windowMs: number;

  constructor(windowMs = DEFAULT_WINDOW_MS) {
 this.windowMs = windowMs;
 this.loadHistory();
  }

  // ── Public API ────────────────────────────────────────────────────────────

  /**
 * Ingest a new observation for a signal source.
 * Automatically runs anomaly detection after ingestion.
 */
  ingest(source: string, value: number, timestamp?: number): void {
 const ts = timestamp ?? Date.now();
 const state = this.getOrCreateSource(source);

 // Record observation
 state.observations.push({ value, timestamp: ts });

 // Prune observations outside the rolling window
 const cutoff = ts - this.windowMs;
 state.observations = state.observations.filter(o => o.timestamp >= cutoff);

 // Update trend tracking
 if (state.lastValue !== null) {
 const direction = computeDirection(value, state.lastValue);
 if (direction === state.trendDirection) {
 state.trendLength++;
 } else {
 state.trendDirection = direction;
 state.trendLength = 1;
 }
 }

 state.lastValue = value;
 state.lastTimestamp = ts;

 // Run detection
 this.runDetection(source, state, value, ts);
  }

  /** Get all currently active (recent) anomalies. */
  getActiveAnomalies(): Anomaly[] {
 // Active = within the last hour
 const cutoff = Date.now() - 60 * 60 * 1000;
 this.activeAnomalies = this.activeAnomalies.filter(a => a.timestamp >= cutoff);
 return [...this.activeAnomalies].sort((a, b) => {
 const severityOrder: Record<AnomalySeverity, number> = { critical: 0, warning: 1, info: 2 };
 return severityOrder[a.severity] - severityOrder[b.severity];
 });
  }

  /** Get full anomaly history (persisted, last 100). */
  getHistory(): Anomaly[] {
 return [...this.history];
  }

  /** Subscribe to new anomaly detections. Returns unsubscribe function. */
  subscribe(cb: (anomaly: Anomaly) => void): () => void {
 this.subscribers.add(cb);
 return () => { this.subscribers.delete(cb); };
  }

  /** Get the number of monitored sources. */
  getSourceCount(): number {
 return this.sources.size;
  }

  /** Get anomalies from the last 24 hours. */
  getRecentAnomalies(windowMs = DEFAULT_WINDOW_MS): Anomaly[] {
 const cutoff = Date.now() - windowMs;
 return this.history.filter(a => a.timestamp >= cutoff);
  }

  /**
 * Check for source silence — call periodically to detect sources
 * that have stopped reporting.
 */
  checkSilence(): void {
 const now = Date.now();
 for (const [source, state] of this.sources.entries()) {
 this.checkSourceSilence(source, state, now);
 }
  }

  /** Reset all state (for testing or session restart). */
  reset(): void {
 this.sources.clear();
 this.activeAnomalies = [];
 this.history = [];
 this.saveHistory();
  }

  // ── Private methods ───────────────────────────────────────────────────────

  private getOrCreateSource(source: string): SourceState {
 let state = this.sources.get(source);
 if (!state) {
 state = {
 observations: [],
 lastValue: null,
 lastTimestamp: null,
 trendDirection: 'flat',
 trendLength: 0,
 };
 this.sources.set(source, state);
 }
 return state;
  }

  /** Orchestrate all detection checks for a single ingestion. */
  private runDetection(source: string, state: SourceState, value: number, timestamp: number): void {
 if (state.observations.length < MIN_OBSERVATIONS) return;

 const values = state.observations.map(o => o.value);
 const m = mean(values);
 const sd = stdDev(values);

 this.detectZScoreAnomaly(source, value, m, sd, timestamp);
 this.detectBurst(source, value, m, sd, timestamp);
 this.detectReversal(source, state, values, value, sd, timestamp);
  }

  /** Detect Z-score anomaly: value significantly above/below rolling mean. */
  private detectZScoreAnomaly(source: string, value: number, m: number, sd: number, timestamp: number): void {
 if (sd <= 0) return;

 const zScore = (value - m) / sd;
 if (Math.abs(zScore) < Z_SCORE_THRESHOLD) return;

 const isSpike = zScore > 0;
 const anomalyType: AnomalyType = isSpike ? 'spike' : 'deviation';
 const severity = classifySeverity(zScore, anomalyType);
 const sigmaLabel = `${Math.abs(Math.round(zScore * 10) / 10)}\u03C3`;
 const direction = isSpike ? 'above' : 'below';

 this.emitAnomaly({
 id: generateId(),
 source,
 type: anomalyType,
 severity,
 value,
 expectedMin: m - Z_SCORE_THRESHOLD * sd,
 expectedMax: m + Z_SCORE_THRESHOLD * sd,
 zScore,
 timestamp,
 description: `${source}: ${sigmaLabel} ${direction} normal (value: ${Math.round(value)}, expected: ${Math.round(m)} \u00B1 ${Math.round(sd)})`,
 });
  }

  /** Detect burst: current value >= 10x rolling mean. */
  private detectBurst(source: string, value: number, m: number, sd: number, timestamp: number): void {
 if (m <= 0 || value < m * BURST_MULTIPLIER) return;

 const zScore = sd > 0 ? (value - m) / sd : BURST_MULTIPLIER;
 this.emitAnomaly({
 id: generateId(),
 source,
 type: 'spike',
 severity: 'critical',
 value,
 expectedMin: 0,
 expectedMax: m * 2,
 zScore,
 timestamp,
 description: `${source}: burst detected \u2014 ${Math.round(value / m)}\u00D7 normal rate (value: ${Math.round(value)}, avg: ${Math.round(m)})`,
 });
  }

  /** Detect trend reversal: sustained trend sharply changes direction. */
  private detectReversal(
 source: string, state: SourceState, values: number[], value: number, sd: number, timestamp: number,
  ): void {
 if (state.trendLength !== 1 || state.observations.length < 4) return;

 const prevValues = values.slice(-4, -1);
 if (prevValues.length < 3) return;

 const wasRising = prevValues.every((v, i) => i === 0 || v >= prevValues[i - 1]!);
 const wasFalling = prevValues.every((v, i) => i === 0 || v <= prevValues[i - 1]!);
 const lastPrev = prevValues[prevValues.length - 1]!;

 const isReversal = (wasRising && value < lastPrev) || (wasFalling && value > lastPrev);
 if (!isReversal) return;

 const reversalMagnitude = Math.abs(value - lastPrev);
 const zScore = sd > 0 ? reversalMagnitude / sd : 0;
 if (zScore < REVERSAL_Z_THRESHOLD) return;

 const priorTrend = wasRising ? 'rising' : 'falling';
 const newTrend = wasRising ? 'dropping' : 'spiking';

 this.emitAnomaly({
 id: generateId(),
 source,
 type: 'reversal',
 severity: classifySeverity(zScore, 'reversal'),
 value,
 expectedMin: Math.min(...prevValues),
 expectedMax: Math.max(...prevValues),
 zScore,
 timestamp,
 description: `${source}: trend reversal \u2014 was ${priorTrend}, now ${newTrend} (${Math.round(zScore * 10) / 10}\u03C3 shift)`,
 });
  }

  /** Check a single source for silence anomaly. */
  private checkSourceSilence(source: string, state: SourceState, now: number): void {
 if (state.lastTimestamp === null) return;
 if (state.observations.length < MIN_OBSERVATIONS) return;

 const timeSinceLast = now - state.lastTimestamp;
 if (timeSinceLast < SILENCE_THRESHOLD_MS) return;

 // Calculate average interval between observations
 const intervals: number[] = [];
 for (let i = 1; i < state.observations.length; i++) {
 intervals.push(state.observations[i]!.timestamp - state.observations[i - 1]!.timestamp);
 }
 if (intervals.length === 0) return;

 const avgInterval = mean(intervals);
 const intervalStd = stdDev(intervals);

 // How many standard deviations is the current gap?
 const zScore = intervalStd > 0 ? (timeSinceLast - avgInterval) / intervalStd : 0;
 if (zScore < Z_SCORE_THRESHOLD) return;

 const silenceHours = Math.round(timeSinceLast / (60 * 60 * 1000) * 10) / 10;
 const severity = classifySeverity(zScore, 'silence');

 this.emitAnomaly({
 id: generateId(),
 source,
 type: 'silence',
 severity,
 value: timeSinceLast,
 expectedMin: avgInterval - intervalStd,
 expectedMax: avgInterval + intervalStd,
 zScore,
 timestamp: now,
 description: `${source} silent for ${silenceHours}h (expected interval ~${Math.round(avgInterval / 60_000)}min)`,
 });
  }

  private emitAnomaly(anomaly: Anomaly): void {
 // Deduplicate: don't emit same source+type within 5 minutes
 const recentCutoff = anomaly.timestamp - 5 * 60 * 1000;
 const duplicate = this.activeAnomalies.find(
 a => a.source === anomaly.source && a.type === anomaly.type && a.timestamp >= recentCutoff,
 );
 if (duplicate) return;

 this.activeAnomalies.push(anomaly);
 this.history.push(anomaly);

 // Trim history
 if (this.history.length > MAX_HISTORY) {
 this.history = this.history.slice(-MAX_HISTORY);
 }

 this.saveHistory();

 // Notify subscribers
 for (const cb of this.subscribers) {
 try {
 cb(anomaly);
 } catch {
 // Subscriber threw — skip silently to avoid cascading failures
 }
 }

 // Dispatch CustomEvent
 try {
 document.dispatchEvent(new CustomEvent('wm:anomaly-detected', { detail: anomaly }));
 } catch {
 // SSR or test environment — no document
 }
  }

  private loadHistory(): void {
 try {
 const stored = localStorage.getItem(STORAGE_KEY);
 if (stored) {
 const parsed = JSON.parse(stored) as Anomaly[];
 if (Array.isArray(parsed)) {
 this.history = parsed.slice(-MAX_HISTORY);
 }
 }
 } catch {
 this.history = [];
 }
  }

  private saveHistory(): void {
 try {
 localStorage.setItem(STORAGE_KEY, JSON.stringify(this.history.slice(-MAX_HISTORY)));
 } catch {
 // localStorage full or unavailable
 }
  }
}

// ── Singleton export ──────────────────────────────────────────────────────────

export const anomalyEngine = new AnomalyDetectionEngine();

// ── Weather & News Anomaly Helpers ──────────────────────────────────────────

/**
 * Ingest weather alert counts as anomaly observations.
 * Call after each weather fetch cycle with the count of active alerts.
 */
export function ingestWeatherAnomalySignals(
  alertCount: number,
  severeCount: number,
): void {
  anomalyEngine.ingest('weather:alert-count', alertCount);
  if (severeCount > 0) {
    anomalyEngine.ingest('weather:severe-count', severeCount);
  }
}

/**
 * Ingest news volume per region as anomaly observations.
 * Detects sudden silence or burst in regional coverage.
 */
export function ingestNewsVolumeSignals(
  regionVolumes: Map<string, number>,
): void {
  for (const [region, volume] of regionVolumes) {
    anomalyEngine.ingest(`news:volume:${region}`, volume);
  }
}

/**
 * Ingest correlation matrix global score for trend monitoring.
 */
export function ingestMatrixScoreSignal(globalScore: number): void {
  anomalyEngine.ingest('matrix:global-score', globalScore);
}
