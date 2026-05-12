/**
 * Enhanced multi-section intelligence-brief PDF renderer.
 *
 * Pure function over a typed `EnhancedBriefingInput`. The companion
 * snapshot collector (enhanced-brief-snapshot.ts) handles the impure
 * pull from singletons (situation engine, unified alerts, swpc monitor,
 * fire intel, etc); this module just renders.
 *
 * Sections (in order):
 *   1. Cover page         — title, classification banner, timestamp
 *   2. Executive summary  — AI-generated when present, auto-derived from
 *                            threat-matrix when not
 *   3. Threat matrix      — colored grid: domain × severity heat map
 *   4. Active alerts      — bulleted NWS / FEMA / EEW with severity badge
 *   5. Space weather      — X-ray flux, Kp, aurora lat, active CMEs
 *   6. Wildfire status    — top 5 fires by threat score (acres × inv. containment)
 *   7. Economic indicators — VIX, OFR FSI, FRED key series + 30-day trend arrows
 *   8. Data feed status   — green/yellow/red per feed
 *   Footer                — version stamp + data-current-as-of timestamp
 *
 * Why a separate file from brief-pdf.ts: that one renders the existing
 * IntelligenceBriefing; this one renders a richer composite snapshot
 * with sections that aren't part of IntelligenceBriefing's shape.
 * Spec calls for keeping the simple export as a fallback.
 */

import { jsPDF } from 'jspdf';
import type { ThreatSeverity } from '../intelligence-briefing';

// ── Public input types ───────────────────────────────────────────────

export interface ThreatMatrixCell {
  /** Domain label, e.g. 'Weather', 'Cyber', 'Economic'. */
  domain: string;
  severity: ThreatSeverity;
  /** Short label rendered inside the cell, e.g. '3 active'. */
  label: string;
}

export interface AlertEntry {
  source: string;             // 'NWS' | 'FEMA' | 'EEW' | …
  title: string;
  severity: ThreatSeverity;
  location?: string;
}

export interface SpaceWeatherSnapshot {
  /** Free-text class label, e.g. 'M1.2'. Falls back to '—' when empty. */
  xrayPeakLabel: string;
  /** Numeric flux for context, W/m². null when unavailable. */
  xrayPeakFlux: number | null;
  kp: number | null;
  /** Lowest geomagnetic latitude °N where aurora is visible overhead.
   *  90 = invisible. */
  auroraVisibilityLatN: number | null;
  /** Count of currently-tracked Earth-directed CMEs. */
  earthwardCmeCount: number;
  /** Optional headline list of active CME notes. */
  cmeNotes?: string[];
}

export interface WildfireRanked {
  name: string;
  state: string | null;
  acres: number | null;
  containmentPct: number | null;
  /** Pre-computed threat score: acres × (1 - containment). */
  threatScore: number;
}

export interface EconomicIndicator {
  id: string;                       // e.g. 'VIXCLS'
  label: string;
  /** Latest observation. null when feed degraded or no data. */
  latestValue: number | null;
  /** Value 30 days ago (or oldest in window). null when insufficient. */
  baselineValue: number | null;
  /** Optional units shown beside the value. */
  units?: string;
}

export type FeedStatus = 'green' | 'yellow' | 'red';

export interface FeedHealthRow {
  feedId: string;
  label: string;
  status: FeedStatus;
  /** Optional age-in-seconds annotation. */
  ageSeconds?: number;
}

export interface CorrelationEntry {
  type: 'spatial' | 'temporal' | 'entity';
  confidence: number;    // 0–1
  title: string;
  detectedAt: number;    // epoch ms
}

export interface ShortageRadarEntry {
  commodity: string;
  riskLevel: string;     // 'low' | 'moderate' | 'elevated' | 'high' | 'critical'
  riskScore: number;     // 0–100
  primaryDrivers: string[];
  trend: string;         // 'rising' | 'stable' | 'falling'
}

export interface PersonalizedAlertEntry {
  placeName: string;
  eventCount: number;
  topEventTitle: string;
  topSeverity: number;   // 0–10
}

export interface EnhancedBriefingInput {
  /** Optional pre-built executive summary (e.g. from AI brief). When
   *  absent, the renderer derives one from the threat matrix. */
  executiveSummary?: string;
  threatMatrix: ThreatMatrixCell[];
  activeAlerts: AlertEntry[];
  spaceWeather: SpaceWeatherSnapshot | null;
  topWildfires: WildfireRanked[];
  economicIndicators: EconomicIndicator[];
  feedHealth: FeedHealthRow[];
  correlations?: CorrelationEntry[];
  shortageRadar?: ShortageRadarEntry[];
  personalizedAlerts?: PersonalizedAlertEntry[];
  /** Wall-clock data-current-as-of timestamp shown in the footer. */
  dataCurrentAt: number;
  /** Crystal Ball app version, shown in the footer. */
  appVersion: string;
}

export interface EnhancedBriefOptions {
  classification?: string;       // default 'UNCLASSIFIED'
  title?: string;                // default 'CRYSTAL BALL INTELLIGENCE BRIEF'
}

// ── Constants ────────────────────────────────────────────────────────

const DEFAULT_CLASSIFICATION = 'UNCLASSIFIED';
const DEFAULT_TITLE = 'CRYSTAL BALL INTELLIGENCE BRIEF';

const PAGE_WIDTH = 612;     // 8.5"
const PAGE_HEIGHT = 792;    // 11"
const MARGIN = 54;          // 0.75"
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const HEADER_BOTTOM_Y = 80;
const FOOTER_TOP_Y = PAGE_HEIGHT - 50;

const SEVERITY_RANK: Readonly<Record<ThreatSeverity, number>> = {
  critical: 4, high: 3, medium: 2, low: 1, info: 0,
};

const SEVERITY_COLOR: Readonly<Record<ThreatSeverity, [number, number, number]>> = {
  critical: [194, 0, 0],
  high:     [217, 86, 0],
  medium:   [186, 137, 0],
  low:      [70, 113, 70],
  info:     [80, 80, 80],
};

const FEED_STATUS_COLOR: Readonly<Record<FeedStatus, [number, number, number]>> = {
  green:  [34, 139, 34],
  yellow: [217, 174, 0],
  red:    [194, 0, 0],
};

// ── Public API ────────────────────────────────────────────────────────

export function renderEnhancedBriefingPdf(
  input: EnhancedBriefingInput,
  options: EnhancedBriefOptions = {},
): jsPDF {
  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  const title = options.title ?? DEFAULT_TITLE;
  const classification = options.classification ?? DEFAULT_CLASSIFICATION;

  drawCoverPage(doc, title, classification, input);

  // Body pages start fresh.
  doc.addPage();
  let y = HEADER_BOTTOM_Y + 20;
  drawHeader(doc, title, input.dataCurrentAt);

  const onPageBreak = () => {
    drawHeader(doc, title, input.dataCurrentAt);
    return HEADER_BOTTOM_Y + 20;
  };

  y = renderExecutiveSummary(doc, input, y, onPageBreak);
  y = renderThreatMatrix(doc, input.threatMatrix, y, onPageBreak);
  y = renderActiveAlerts(doc, input.activeAlerts, y, onPageBreak);
  y = renderSpaceWeather(doc, input.spaceWeather, y, onPageBreak);
  y = renderWildfires(doc, input.topWildfires, y, onPageBreak);
  y = renderEconomicIndicators(doc, input.economicIndicators, y, onPageBreak);
  y = renderFeedHealth(doc, input.feedHealth, y, onPageBreak);
  y = renderCorrelations(doc, input.correlations ?? [], y, onPageBreak);
  y = renderShortageRadar(doc, input.shortageRadar ?? [], y, onPageBreak);
  renderPersonalizedAlerts(doc, input.personalizedAlerts ?? [], y, onPageBreak);

  // Stamp footer + page numbers across every page.
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i += 1) {
    doc.setPage(i);
    drawFooter(doc, classification, input, i, pageCount);
  }
  return doc;
}

export function renderEnhancedBriefingPdfBlob(
  input: EnhancedBriefingInput,
  options: EnhancedBriefOptions = {},
): Blob {
  return renderEnhancedBriefingPdf(input, options).output('blob');
}

export function enhancedBriefPdfFilename(input: EnhancedBriefingInput): string {
  const iso = new Date(input.dataCurrentAt).toISOString().slice(0, 10);
  return `crystal-ball-intel-brief-${iso}.pdf`;
}

// ── Pure derivation helpers (exported for unit tests) ────────────────

/** When the caller doesn't supply an executive summary, derive a
 *  3-4-sentence overview from the threat matrix. The summary is purely
 *  data-driven so it stays accurate even when the AI brief is offline. */
export function deriveExecutiveSummary(matrix: readonly ThreatMatrixCell[]): string {
  if (matrix.length === 0) {
    return 'Crystal Ball detected no active threats across monitored domains. The current operating environment is clear; routine monitoring continues.';
  }
  const buckets: Record<ThreatSeverity, ThreatMatrixCell[]> = {
    critical: [], high: [], medium: [], low: [], info: [],
  };
  for (const cell of matrix) buckets[cell.severity].push(cell);

  const parts: string[] = [];
  if (buckets.critical.length > 0) {
    parts.push(`${buckets.critical.length} critical-severity threat${buckets.critical.length === 1 ? '' : 's'} active in ${joinDomains(buckets.critical)}`);
  }
  if (buckets.high.length > 0) {
    parts.push(`${buckets.high.length} high-severity in ${joinDomains(buckets.high)}`);
  }
  if (buckets.medium.length > 0) {
    parts.push(`${buckets.medium.length} medium in ${joinDomains(buckets.medium)}`);
  }
  if (parts.length === 0) {
    return `Monitoring ${matrix.length} domain${matrix.length === 1 ? '' : 's'} with low-severity activity only. No elevated threats detected at this time.`;
  }
  const lead = parts.join(', ');
  let tail = 'Routine monitoring posture; review items below for context.';
  if (buckets.critical.length > 0) {
    tail = 'Recommend immediate review of critical-severity items below; situational awareness elevated.';
  } else if (buckets.high.length > 0) {
    tail = 'Monitoring posture remains elevated; review high-severity items below.';
  }
  return `${capitalize(lead)}. ${tail}`;
}

function joinDomains(cells: readonly ThreatMatrixCell[]): string {
  const unique = [...new Set(cells.map((c) => c.domain))];
  if (unique.length <= 2) return unique.join(' and ');
  return `${unique.slice(0, -1).join(', ')}, and ${unique[unique.length - 1]}`;
}

function capitalize(s: string): string {
  if (s.length === 0) return s;
  const first = s.charAt(0);
  return first.toUpperCase() + s.slice(1);
}

/** Format a 30-day trend as an arrow + delta. Pure for tests. */
export function formatTrendArrow(latest: number | null, baseline: number | null): string {
  if (latest === null || baseline === null) return '—';
  if (baseline === 0) {
    if (latest > 0) return '↑';
    if (latest < 0) return '↓';
    return '→';
  }
  const pct = ((latest - baseline) / Math.abs(baseline)) * 100;
  if (Math.abs(pct) < 1) return `→ ${pct.toFixed(1)}%`;
  if (pct > 0) return `↑ +${pct.toFixed(1)}%`;
  return `↓ ${pct.toFixed(1)}%`;
}

/** Sort wildfires by threat score (acres × inverse containment) desc. */
export function topWildfiresByThreat(
  fires: readonly WildfireRanked[],
  topN = 5,
): WildfireRanked[] {
  return [...fires].sort((a, b) => b.threatScore - a.threatScore).slice(0, topN);
}

/** Compute threat score for a single fire. Acres × (1 − containment%/100).
 *  When containment is null, treat as 0 (worst case for unknowns). */
export function computeFireThreatScore(acres: number | null, containmentPct: number | null): number {
  if (acres === null || acres <= 0) return 0;
  const contained = containmentPct === null ? 0 : Math.max(0, Math.min(100, containmentPct));
  return acres * (1 - contained / 100);
}

// ── Cover page ──────────────────────────────────────────────────────

function drawCoverPage(
  doc: jsPDF,
  title: string,
  classification: string,
  input: EnhancedBriefingInput,
): void {
  // Classification banner (top + bottom).
  doc.setFillColor(20, 20, 20);
  doc.rect(0, 30, PAGE_WIDTH, 24, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text(classification, PAGE_WIDTH / 2, 47, { align: 'center' });

  doc.setFillColor(20, 20, 20);
  doc.rect(0, PAGE_HEIGHT - 54, PAGE_WIDTH, 24, 'F');
  doc.setTextColor(255, 255, 255);
  doc.text(classification, PAGE_WIDTH / 2, PAGE_HEIGHT - 38, { align: 'center' });

  // Title — centered, large.
  doc.setTextColor(20, 20, 20);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(28);
  doc.text(title, PAGE_WIDTH / 2, 280, { align: 'center', maxWidth: PAGE_WIDTH - 80 });

  // Subtitle / generated-at.
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(12);
  doc.setTextColor(80, 80, 80);
  const ts = new Date(input.dataCurrentAt).toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
  doc.text(`Data current as of: ${ts}`, PAGE_WIDTH / 2, 320, { align: 'center' });
  doc.text(`Crystal Ball v${input.appVersion}`, PAGE_WIDTH / 2, 340, { align: 'center' });

  // Quick-glance summary line.
  const totalCells = input.threatMatrix.length;
  const criticals = input.threatMatrix.filter((c) => c.severity === 'critical').length;
  const highs = input.threatMatrix.filter((c) => c.severity === 'high').length;
  const summary = `${totalCells} domain${totalCells === 1 ? '' : 's'} monitored — ${criticals} critical, ${highs} high`;
  doc.setFontSize(11);
  doc.setTextColor(40, 40, 40);
  doc.text(summary, PAGE_WIDTH / 2, 400, { align: 'center' });
}

// ── Body sections ────────────────────────────────────────────────────

function renderExecutiveSummary(
  doc: jsPDF,
  input: EnhancedBriefingInput,
  startY: number,
  onPageBreak: () => number,
): number {
  let y = startY;
  y = drawSectionHeader(doc, 'EXECUTIVE SUMMARY', y);
  const summary = (input.executiveSummary?.trim().length ?? 0) > 0
    ? input.executiveSummary!.trim()
    : deriveExecutiveSummary(input.threatMatrix);
  return renderWrappedText(doc, summary, y, onPageBreak) + 14;
}

function renderThreatMatrix(
  doc: jsPDF,
  matrix: readonly ThreatMatrixCell[],
  startY: number,
  onPageBreak: () => number,
): number {
  let y = ensureRoomFor(doc, startY, 80, onPageBreak);
  y = drawSectionHeader(doc, 'THREAT MATRIX', y);
  if (matrix.length === 0) {
    return drawEmptyLine(doc, 'No active threats in matrix.', y) + 14;
  }
  // 2-column grid: domain | colored cell with label.
  const rowHeight = 22;
  const labelColW = 180;
  const cellColW = CONTENT_WIDTH - labelColW;
  const sorted = [...matrix].sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(80, 80, 80);
  doc.text('DOMAIN', MARGIN + 4, y + 14);
  doc.text('SEVERITY', MARGIN + labelColW + 4, y + 14);
  y += rowHeight;

  for (const cell of sorted) {
    y = ensureRoomFor(doc, y, rowHeight, onPageBreak);
    const [r, g, b] = SEVERITY_COLOR[cell.severity];
    // Domain cell (white bg, dark text).
    doc.setDrawColor(220, 220, 220);
    doc.setLineWidth(0.5);
    doc.setFillColor(252, 252, 252);
    doc.rect(MARGIN, y, labelColW, rowHeight, 'FD');
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(20, 20, 20);
    doc.text(cell.domain, MARGIN + 6, y + 14);
    // Severity heat-cell.
    doc.setFillColor(r, g, b);
    doc.rect(MARGIN + labelColW, y, cellColW, rowHeight, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.text(`${cell.severity.toUpperCase()} — ${cell.label}`, MARGIN + labelColW + 6, y + 14);
    y += rowHeight;
  }
  return y + 14;
}

function renderActiveAlerts(
  doc: jsPDF,
  alerts: readonly AlertEntry[],
  startY: number,
  onPageBreak: () => number,
): number {
  let y = ensureRoomFor(doc, startY, 60, onPageBreak);
  y = drawSectionHeader(doc, 'ACTIVE ALERTS', y);
  if (alerts.length === 0) {
    return drawEmptyLine(doc, 'No active alerts at this time.', y) + 14;
  }
  // Sort by severity desc.
  const sorted = [...alerts].sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]);
  for (const alert of sorted) {
    y = ensureRoomFor(doc, y, 24, onPageBreak);
    const [r, g, b] = SEVERITY_COLOR[alert.severity];
    // Severity dot.
    doc.setFillColor(r, g, b);
    doc.circle(MARGIN + 4, y - 4, 4, 'F');
    // Body text: source: title (location).
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(20, 20, 20);
    const lead = `[${alert.source}] ${alert.title}`;
    const locTail = alert.location ? `  —  ${alert.location}` : '';
    const wrapped = doc.splitTextToSize(lead + locTail, CONTENT_WIDTH - 16) as string[];
    doc.text(wrapped[0] ?? '', MARGIN + 14, y);
    y += 14;
    for (let i = 1; i < wrapped.length; i += 1) {
      y = ensureRoomFor(doc, y, 12, onPageBreak);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.text(wrapped[i] ?? '', MARGIN + 14, y);
      y += 12;
    }
    y += 4;
  }
  return y + 8;
}

function renderSpaceWeather(
  doc: jsPDF,
  sw: SpaceWeatherSnapshot | null,
  startY: number,
  onPageBreak: () => number,
): number {
  let y = ensureRoomFor(doc, startY, 50, onPageBreak);
  y = drawSectionHeader(doc, 'SPACE WEATHER', y);
  if (!sw) {
    return drawEmptyLine(doc, 'Space-weather data unavailable (SWPC not polled).', y) + 14;
  }
  const fluxNote = sw.xrayPeakFlux === null ? '' : `  (${sw.xrayPeakFlux.toExponential(2)} W/m²)`;
  const kpStr = sw.kp === null ? '—' : sw.kp.toFixed(1);
  const rows: string[] = [
    `X-ray peak class: ${sw.xrayPeakLabel}${fluxNote}`,
    `Planetary Kp: ${kpStr}`,
    `Aurora visibility: ${formatAuroraLat(sw.auroraVisibilityLatN)}`,
    `Earth-directed CMEs: ${sw.earthwardCmeCount}`,
  ];
  for (const row of rows) {
    y = ensureRoomFor(doc, y, 14, onPageBreak);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(40, 40, 40);
    doc.text(`• ${row}`, MARGIN, y);
    y += 14;
  }
  if (sw.cmeNotes && sw.cmeNotes.length > 0) {
    for (const note of sw.cmeNotes.slice(0, 3)) {
      y = ensureRoomFor(doc, y, 12, onPageBreak);
      doc.setFont('helvetica', 'italic');
      doc.setFontSize(9);
      doc.setTextColor(80, 80, 80);
      const wrapped = doc.splitTextToSize(`  — ${note}`, CONTENT_WIDTH) as string[];
      for (const line of wrapped) {
        y = ensureRoomFor(doc, y, 12, onPageBreak);
        doc.text(line, MARGIN, y);
        y += 12;
      }
    }
  }
  return y + 14;
}

/** "Aurora visible from 65°N or higher" / "Not visible from typical latitudes" */
export function formatAuroraLat(latN: number | null): string {
  if (latN === null || latN >= 89) return 'Not visible from typical latitudes';
  return `Visible from ${latN.toFixed(0)}°N or higher`;
}

function renderWildfires(
  doc: jsPDF,
  fires: readonly WildfireRanked[],
  startY: number,
  onPageBreak: () => number,
): number {
  let y = ensureRoomFor(doc, startY, 60, onPageBreak);
  y = drawSectionHeader(doc, 'WILDFIRE STATUS — TOP 5 BY THREAT SCORE', y);
  const top = topWildfiresByThreat(fires, 5);
  if (top.length === 0) {
    return drawEmptyLine(doc, 'No active wildfire incidents reported.', y) + 14;
  }
  for (const fire of top) {
    y = ensureRoomFor(doc, y, 16, onPageBreak);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(217, 86, 0);
    const stateSuffix = fire.state ? ` (${fire.state})` : '';
    doc.text(`• ${fire.name}${stateSuffix}`, MARGIN, y);
    y += 12;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(60, 60, 60);
    const acresStr = fire.acres === null ? 'acreage unknown' : `${Math.round(fire.acres).toLocaleString()} acres`;
    const contStr = fire.containmentPct === null ? 'containment unknown' : `${Math.round(fire.containmentPct)}% contained`;
    const scoreStr = `threat score ${Math.round(fire.threatScore).toLocaleString()}`;
    doc.text(`  ${acresStr} • ${contStr} • ${scoreStr}`, MARGIN, y);
    y += 14;
  }
  return y + 8;
}

function renderEconomicIndicators(
  doc: jsPDF,
  indicators: readonly EconomicIndicator[],
  startY: number,
  onPageBreak: () => number,
): number {
  let y = ensureRoomFor(doc, startY, 60, onPageBreak);
  y = drawSectionHeader(doc, 'ECONOMIC INDICATORS', y);
  if (indicators.length === 0) {
    return drawEmptyLine(doc, 'Economic stress feed not available.', y) + 14;
  }
  // Header row. Label / value / trend columns sized for letter width.
  const labelCol = 220;
  const valueCol = 100;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(80, 80, 80);
  doc.text('INDICATOR', MARGIN, y);
  doc.text('LATEST', MARGIN + labelCol, y);
  doc.text('30-DAY TREND', MARGIN + labelCol + valueCol, y);
  y += 6;
  doc.setDrawColor(200, 200, 200);
  doc.line(MARGIN, y, MARGIN + CONTENT_WIDTH, y);
  y += 12;

  for (const ind of indicators) {
    y = ensureRoomFor(doc, y, 18, onPageBreak);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(20, 20, 20);
    doc.text(ind.label, MARGIN, y);
    let valueStr = '—';
    if (ind.latestValue !== null) {
      const unitSuffix = ind.units ? ` ${ind.units}` : '';
      valueStr = `${ind.latestValue.toFixed(2)}${unitSuffix}`;
    }
    doc.text(valueStr, MARGIN + labelCol, y);
    const trend = formatTrendArrow(ind.latestValue, ind.baselineValue);
    if (trend.startsWith('↑')) doc.setTextColor(194, 0, 0);
    else if (trend.startsWith('↓')) doc.setTextColor(34, 139, 34);
    else doc.setTextColor(80, 80, 80);
    doc.text(trend, MARGIN + labelCol + valueCol, y);
    y += 16;
  }
  return y + 8;
}

function renderFeedHealth(
  doc: jsPDF,
  rows: readonly FeedHealthRow[],
  startY: number,
  onPageBreak: () => number,
): number {
  let y = ensureRoomFor(doc, startY, 50, onPageBreak);
  y = drawSectionHeader(doc, 'DATA FEED STATUS', y);
  if (rows.length === 0) {
    return drawEmptyLine(doc, 'Feed health snapshot unavailable.', y) + 14;
  }
  const statusOrder: FeedStatus[] = ['red', 'yellow', 'green'];
  const sorted = [...rows].sort((a, b) => statusOrder.indexOf(a.status) - statusOrder.indexOf(b.status));
  for (const row of sorted) {
    y = ensureRoomFor(doc, y, 14, onPageBreak);
    const [r, g, b] = FEED_STATUS_COLOR[row.status];
    doc.setFillColor(r, g, b);
    doc.circle(MARGIN + 4, y - 4, 3.5, 'F');
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(20, 20, 20);
    const ageStr = typeof row.ageSeconds === 'number'
      ? `  (last update ${formatAge(row.ageSeconds)})` : '';
    doc.text(`${row.label}${ageStr}`, MARGIN + 14, y);
    y += 14;
  }
  return y;
}

function formatAge(ageSeconds: number): string {
  if (ageSeconds < 60) return `${Math.round(ageSeconds)}s ago`;
  if (ageSeconds < 3600) return `${Math.round(ageSeconds / 60)}m ago`;
  if (ageSeconds < 86_400) return `${Math.round(ageSeconds / 3600)}h ago`;
  return `${Math.round(ageSeconds / 86_400)}d ago`;
}

// ── Pure helpers for new sections (exported for unit tests) ──────────

/** Returns top N correlations sorted by confidence desc, capped at 5. */
export function topCorrelationsByConfidence(
  correlations: readonly CorrelationEntry[],
  topN = 5,
): CorrelationEntry[] {
  return [...correlations].sort((a, b) => b.confidence - a.confidence).slice(0, topN);
}

/** Format a single correlation for text display.
 *  Returns: "[TYPE] {title}   {confidence%}% confidence" */
export function formatCorrelationLine(entry: CorrelationEntry): string {
  const typePart = `[${entry.type.toUpperCase()}]`;
  const pct = Math.round(entry.confidence * 100);
  return `${typePart} ${entry.title}   ${pct}% confidence`;
}

/** Format trend arrow: rising → ↑, falling → ↓, anything else → →. */
export function formatShortageArrow(trend: string): string {
  if (trend === 'rising') return '↑';
  if (trend === 'falling') return '↓';
  return '→';
}

/** Prettify commodity name: 'wheat' → 'Wheat', 'natural-gas' → 'Natural Gas'. */
export function prettifyCommodity(commodity: string): string {
  return commodity
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/** Format a personalized alert line (without leading bullet). */
export function formatPersonalAlertLine(entry: PersonalizedAlertEntry): string {
  return `Events near ${entry.placeName}: ${entry.eventCount} alerts — top: ${entry.topEventTitle} (severity ${entry.topSeverity}/10)`;
}

// ── Risk-level colors for shortage radar ────────────────────────────

const RISK_LEVEL_COLOR: Readonly<Record<string, [number, number, number]>> = {
  critical: [194, 0, 0],
  high:     [217, 86, 0],
  elevated: [186, 137, 0],
  moderate: [70, 113, 70],
  low:      [80, 80, 80],
};

function riskLevelColor(riskLevel: string): [number, number, number] {
  return RISK_LEVEL_COLOR[riskLevel.toLowerCase()] ?? [80, 80, 80];
}

// ── New section renderers ─────────────────────────────────────────────

function renderCorrelations(
  doc: jsPDF,
  correlations: readonly CorrelationEntry[],
  startY: number,
  onPageBreak: () => number,
): number {
  let y = ensureRoomFor(doc, startY, 50, onPageBreak);
  y = drawSectionHeader(doc, 'CROSS-DOMAIN CORRELATIONS', y);
  if (correlations.length === 0) {
    return drawEmptyLine(doc, 'No cross-domain correlations detected.', y) + 14;
  }
  const top = topCorrelationsByConfidence(correlations, 5);
  for (const entry of top) {
    y = ensureRoomFor(doc, y, 14, onPageBreak);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(40, 40, 40);
    const line = `• ${formatCorrelationLine(entry)}`;
    const wrapped = doc.splitTextToSize(line, CONTENT_WIDTH) as string[];
    for (const wline of wrapped) {
      y = ensureRoomFor(doc, y, 13, onPageBreak);
      doc.text(wline, MARGIN, y);
      y += 13;
    }
    y += 2;
  }
  return y + 8;
}

function renderShortageRadar(
  doc: jsPDF,
  entries: readonly ShortageRadarEntry[],
  startY: number,
  onPageBreak: () => number,
): number {
  let y = ensureRoomFor(doc, startY, 50, onPageBreak);
  y = drawSectionHeader(doc, 'SHORTAGE RADAR', y);
  if (entries.length === 0) {
    return drawEmptyLine(doc, 'Shortage forecast data unavailable.', y) + 14;
  }
  const col1W = 130;
  const col2W = 80;
  const col3W = CONTENT_WIDTH - col1W - col2W;
  for (const entry of entries) {
    y = ensureRoomFor(doc, y, 18, onPageBreak);
    // Column 1 — commodity name.
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(20, 20, 20);
    doc.text(prettifyCommodity(entry.commodity), MARGIN, y);
    // Column 2 — risk level badge (colored text).
    const [r, g, b] = riskLevelColor(entry.riskLevel);
    doc.setTextColor(r, g, b);
    doc.setFont('helvetica', 'bold');
    doc.text(entry.riskLevel.toUpperCase(), MARGIN + col1W, y);
    // Column 3 — top driver + trend arrow.
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(60, 60, 60);
    const driver = entry.primaryDrivers[0] ?? '—';
    const arrow = formatShortageArrow(entry.trend);
    const col3Text = `${driver} ${arrow}`;
    const wrapped = doc.splitTextToSize(col3Text, col3W) as string[];
    doc.text(wrapped[0] ?? '', MARGIN + col1W + col2W, y);
    y += 16;
  }
  return y + 8;
}

function renderPersonalizedAlerts(
  doc: jsPDF,
  alerts: readonly PersonalizedAlertEntry[],
  startY: number,
  onPageBreak: () => number,
): number {
  let y = ensureRoomFor(doc, startY, 50, onPageBreak);
  y = drawSectionHeader(doc, 'PERSONALIZED ALERTS — SAVED PLACES', y);
  if (alerts.length === 0) {
    return drawEmptyLine(doc, 'No saved places configured, or no nearby events detected.', y) + 14;
  }
  for (const alert of alerts) {
    y = ensureRoomFor(doc, y, 14, onPageBreak);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(40, 40, 40);
    const line = `• ${formatPersonalAlertLine(alert)}`;
    const wrapped = doc.splitTextToSize(line, CONTENT_WIDTH) as string[];
    for (const wline of wrapped) {
      y = ensureRoomFor(doc, y, 13, onPageBreak);
      doc.text(wline, MARGIN, y);
      y += 13;
    }
    y += 2;
  }
  return y + 8;
}

// ── Layout primitives ────────────────────────────────────────────────

function drawHeader(doc: jsPDF, title: string, dataCurrentAt: number): void {
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(40, 40, 40);
  const ts = new Date(dataCurrentAt).toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
  doc.text(`${title}  —  ${ts}`, MARGIN, MARGIN + 12);
  doc.setDrawColor(160, 160, 160);
  doc.setLineWidth(0.5);
  doc.line(MARGIN, HEADER_BOTTOM_Y, PAGE_WIDTH - MARGIN, HEADER_BOTTOM_Y);
}

function drawFooter(
  doc: jsPDF,
  classification: string,
  input: EnhancedBriefingInput,
  page: number,
  total: number,
): void {
  doc.setDrawColor(160, 160, 160);
  doc.setLineWidth(0.5);
  doc.line(MARGIN, FOOTER_TOP_Y, PAGE_WIDTH - MARGIN, FOOTER_TOP_Y);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(80, 80, 80);
  doc.text(`Classification: ${classification}`, MARGIN, FOOTER_TOP_Y + 14);
  doc.setFont('helvetica', 'normal');
  const ts = new Date(input.dataCurrentAt).toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
  doc.text(
    `Generated by Crystal Ball v${input.appVersion}  |  Data current as of ${ts}`,
    PAGE_WIDTH / 2, FOOTER_TOP_Y + 28, { align: 'center' },
  );
  doc.text(`Page ${page} of ${total}`, PAGE_WIDTH - MARGIN, FOOTER_TOP_Y + 14, { align: 'right' });
}

function drawSectionHeader(doc: jsPDF, label: string, startY: number): number {
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(20, 20, 20);
  doc.text(label, MARGIN, startY);
  doc.setDrawColor(20, 20, 20);
  doc.setLineWidth(1.5);
  doc.line(MARGIN, startY + 4, MARGIN + 80, startY + 4);
  return startY + 22;
}

function drawEmptyLine(doc: jsPDF, message: string, startY: number): number {
  doc.setFont('helvetica', 'italic');
  doc.setFontSize(10);
  doc.setTextColor(120, 120, 120);
  doc.text(message, MARGIN, startY);
  return startY + 14;
}

function renderWrappedText(
  doc: jsPDF,
  text: string,
  startY: number,
  onPageBreak: () => number,
  x: number = MARGIN,
  width: number = CONTENT_WIDTH,
): number {
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(40, 40, 40);
  const wrapped = doc.splitTextToSize(text, width) as string[];
  let y = startY;
  for (const line of wrapped) {
    y = ensureRoomFor(doc, y, 13, onPageBreak);
    doc.text(line, x, y);
    y += 13;
  }
  return y;
}

function ensureRoomFor(
  doc: jsPDF,
  y: number,
  needed: number,
  onPageBreak: () => number,
): number {
  if (y + needed >= FOOTER_TOP_Y - 10) {
    doc.addPage();
    return onPageBreak();
  }
  return y;
}
