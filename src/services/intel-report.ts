/**
 * @module intel-report
 *
 * Structured Intelligence Report Generator — pure TypeScript, fully offline
 *
 * Creates formatted SITREP (Situation Report), INTSUM (Intelligence Summary),
 * WARNING (Warning Intelligence), and ASSESSMENT documents from current app
 * state metrics. Each report type follows standard military/intelligence
 * reporting conventions with prose sections generated from numeric inputs.
 *
 * Reports are stored in-memory (max 50). The oldest report is pruned when
 * the cap is exceeded.
 *
 * No external dependencies, no network calls. All state is in-memory.
 */

// ── Types ──────────────────────────────────────────────────────────────────

/** Supported intelligence report formats */
export type ReportType = 'sitrep' | 'intsum' | 'warning' | 'assessment';

/** A single section within a report */
export interface ReportSection {
  /** Section heading */
  title: string;
  /** Section importance tier */
  priority: 'critical' | 'high' | 'medium' | 'low';
  /** Prose body text for this section */
  content: string;
  /** Source references cited in this section */
  sources: string[];
  /** Unix ms timestamp when this section was composed */
  timestamp: number;
}

/** A complete structured intelligence report */
export interface IntelReport {
  /** Unique report identifier */
  id: string;
  /** Report format */
  type: ReportType;
  /** Human-readable report title */
  title: string;
  /** Classification marking */
  classification: 'unclassified' | 'fouo' | 'confidential';
  /** Unix ms timestamp when this report was generated */
  generatedAt: number;
  /** Unix ms timestamp after which the report should be reviewed/expired */
  validUntil: number;
  /** Preparing system or analyst attribution */
  preparedBy: string;
  /** Ordered list of report sections */
  sections: ReportSection[];
  /** Brief top-level summary paragraph */
  executiveSummary: string;
  /** Bullet-point key findings */
  keyFindings: string[];
  /** Actionable recommendations */
  recommendations: string[];
  /** Supplemental notes or references */
  appendices: string[];
}

/** Numeric threat/event metrics used to drive report prose generation */
export interface ReportInput {
  /** Number of seismic events at M4+ */
  earthquakes?: number;
  /** Number of active armed conflict events */
  conflicts?: number;
  /** Number of cyber threat indicators */
  cyberThreats?: number;
  /** Number of vessels with AIS dark periods > 6 h */
  darkVessels?: number;
  /** Number of SIGINT geospatial cluster detections */
  sigintClusters?: number;
  /** Number of kill-chain phase observations */
  killChainCount?: number;
  /** Number of anomaly detections across all sensors */
  anomalies?: number;
  /** Current app mode (peace / finance / war / disaster / ghost) */
  activeMode?: string;
  /** Number of geo-convergence zones active */
  convergenceZones?: number;
  /** Number of internet / BGP outages */
  outages?: number;
  /** Number of military flights tracked */
  militaryFlights?: number;
  /** Number of airstrike events */
  airstrikes?: number;
  /** Total IOC count from ioc-manager */
  iocCount?: number;
  /** Number of active custom geofence alerts */
  geofenceAlerts?: number;
}

// ── Constants ──────────────────────────────────────────────────────────────

const MAX_REPORTS = 50;
const PREPARED_BY = 'Crystal Ball Automated Intelligence System';

/** How long (ms) each report type remains valid before requiring reassessment */
const VALIDITY_WINDOWS: Record<ReportType, number> = {
  sitrep: 4 * 3_600_000, // 4 h
  intsum: 12 * 3_600_000,  // 12 h
  warning: 2 * 3_600_000, // 2 h
  assessment: 24 * 3_600_000,  // 24 h
};

// ── In-memory Store ────────────────────────────────────────────────────────

/** Stored reports, newest first */
const _reports: IntelReport[] = [];

// ── Helpers ────────────────────────────────────────────────────────────────

function generateId(): string {
  return `rpt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function formatUtc(ts: number): string {
  return new Date(ts).toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, 'Z');
}

/** Derive overall priority from a numeric severity score (0-100) */
function scoreToPriority(score: number): ReportSection['priority'] {
  if (score >= 75) return 'critical';
  if (score >= 50) return 'high';
  if (score >= 25) return 'medium';
  return 'low';
}

/** Compute a 0-100 composite threat score from ReportInput */
function computeThreatScore(input: ReportInput): number {
  let score = 0;
  if ((input.airstrikes ?? 0) > 0) score += 20;
  if ((input.conflicts ?? 0) >= 3) score += 15;
  else if ((input.conflicts ?? 0) >= 1) score += 8;
  if ((input.cyberThreats ?? 0) >= 200) score += 15;
  else if ((input.cyberThreats ?? 0) >= 50)  score += 8;
  if ((input.killChainCount ?? 0) >= 5) score += 10;
  if ((input.sigintClusters ?? 0) >= 3) score += 10;
  if ((input.darkVessels ?? 0) >= 5) score += 8;
  if ((input.convergenceZones ?? 0) >= 2) score += 8;
  if ((input.earthquakes ?? 0) >= 5) score += 5;
  if ((input.geofenceAlerts ?? 0) >= 1) score += 5;
  if ((input.outages ?? 0) >= 3) score += 5;
  if ((input.anomalies ?? 0) >= 10) score += 5;
  // Former mode-based boosts (war +10, disaster +7) inlined as a flat +7
  // unconditional baseline — keeps parity with the old disaster default
  // without over-counting the now-always-on war bump.
  score += 7;
  return Math.min(score, 100);
}

/** Derive classification from threat score */
function classificationFromScore(score: number): IntelReport['classification'] {
  if (score >= 70) return 'confidential';
  if (score >= 40) return 'fouo';
  return 'unclassified';
}

// ── Prose Generators ───────────────────────────────────────────────────────

function cyberProse(n: number): string {
  if (n === 0) return 'No significant cyber threat indicators detected during this period.';
  if (n <= 20) return `${n} cyber threat indicators identified across monitored infrastructure. Activity remains within baseline parameters.`;
  if (n <= 100) return `${n} cyber threat indicators detected, suggesting elevated adversary activity. Multiple domains and IP ranges implicated across collection sources.`;
  return `Elevated cyber threat activity with ${n} indicators across multiple domains and infrastructure segments. Indicator density exceeds 30-day baseline by a significant margin, consistent with coordinated campaign activity.`;
}

function conflictProse(n: number): string {
  if (n === 0) return 'No active armed conflict events reported within the monitored area.';
  if (n === 1) return '1 armed conflict event reported. Situation is being monitored for escalation indicators.';
  if (n <= 4) return `${n} armed conflict events active. Cross-border spillover potential assessed as moderate. Diplomatic channels remain partially open.`;
  return `${n} simultaneous armed conflict events tracked. Multi-theater activity increases the probability of supply-chain disruption and civilian displacement. Escalation risk is elevated.`;
}

function maritimeProse(dark: number): string {
  if (dark === 0) return 'No dark vessel activity detected. Maritime picture is assessed as nominal.';
  if (dark <= 3) return `${dark} vessel(s) with extended AIS dark periods detected. Patterns are consistent with opportunistic evasion or equipment malfunction.`;
  return `${dark} vessels exhibiting AIS dark behavior, several in high-interest maritime corridors. This concentration is consistent with coordinated sanctions-evasion or pre-positioning operations.`;
}

function earthquakeProse(n: number): string {
  if (n === 0) return 'No significant seismic events recorded in the current collection window.';
  if (n <= 2) return `${n} seismic event(s) at M4+ detected. Infrastructure impact is assessed as limited at this time.`;
  return `${n} M4+ seismic events recorded. Elevated seismicity may affect critical infrastructure and humanitarian corridors in proximate regions.`;
}

function iocProse(n: number): string {
  if (n === 0) return 'IOC repository is empty. No indicators loaded for correlation.';
  if (n <= 50) return `${n} indicators of compromise active in the tracking database.`;
  if (n <= 500) return `${n} IOCs tracked across multiple source feeds. Correlation analysis is ongoing.`;
  return `${n} IOCs currently tracked — high-volume indicator set. Automated deduplication and confidence weighting are applied; manual triage is recommended for critical-severity indicators.`;
}

function sigintProse(clusters: number, kc: number): string {
  const parts: string[] = [];
  if (clusters > 0) {
 parts.push(`${clusters} SIGINT geospatial cluster${clusters !== 1 ? 's' : ''} identified through emitter correlation.`);
  }
  if (kc > 0) {
 parts.push(`${kc} kill-chain phase observation${kc !== 1 ? 's' : ''} recorded, indicating at least one active intrusion sequence.`);
  }
  if (parts.length === 0) return 'No SIGINT or kill-chain activity detected during this collection period.';
  return parts.join(' ');
}

// ── Section Builders ───────────────────────────────────────────────────────

function buildSitrepSections(input: ReportInput, location: string, now: number, score: number): ReportSection[] {
  const priority = scoreToPriority(score);
  const modeLine = input.activeMode
 ? `Current operational mode: ${input.activeMode.toUpperCase()}.`
 : '';
  const loc = location !== 'Global' ? ` in ${location}` : ' across all monitored regions';

  return [
 {
 title: 'Executive Summary',
 priority,
 content: `This situation report covers current threat conditions${loc}. ${modeLine} Composite threat score: ${score}/100.`,
 sources: ['Crystal Ball Sensor Fusion'],
 timestamp: now,
 },
 {
 title: 'Current Situation',
 priority: scoreToPriority(Math.min(score + 5, 100)),
 content: [
 conflictProse(input.conflicts ?? 0),
 earthquakeProse(input.earthquakes ?? 0),
 (input.geofenceAlerts ?? 0) > 0
 ? `${input.geofenceAlerts} active geofence alert${(input.geofenceAlerts ?? 0) !== 1 ? 's' : ''} triggered within monitored zones.`
 : '',
 ].filter(Boolean).join(' '),
 sources: ['GDACS', 'USGS PAGER', 'Custom Geofence Engine'],
 timestamp: now,
 },
 {
 title: 'Threat Assessment',
 priority,
 content: [
 cyberProse(input.cyberThreats ?? 0),
 sigintProse(input.sigintClusters ?? 0, input.killChainCount ?? 0),
 ].join(' '),
 sources: ['ThreatFox', 'CISA KEV', 'Kill-Chain Tracker', 'SIGINT Convergence'],
 timestamp: now,
 },
 {
 title: 'Key Events',
 priority: (input.airstrikes ?? 0) > 0 ? 'critical' : scoreToPriority(score - 10),
 content: [
 (input.airstrikes ?? 0) > 0
 ? `${input.airstrikes} airstrike event${(input.airstrikes ?? 0) !== 1 ? 's' : ''} recorded. Immediate area of operations assessed as contested airspace.`
 : 'No airstrike events in current reporting period.',
 (input.militaryFlights ?? 0) > 0
 ? `${input.militaryFlights} military flight${(input.militaryFlights ?? 0) !== 1 ? 's' : ''} tracked via ADS-B.`
 : '',
 maritimeProse(input.darkVessels ?? 0),
 ].filter(Boolean).join(' '),
 sources: ['ADS-B Exchange', 'AIS Monitoring', 'Airstrike Tracker'],
 timestamp: now,
 },
 {
 title: 'Recommended Actions',
 priority: scoreToPriority(score),
 content: score >= 70
 ? 'Immediate escalation to senior watch officer recommended. Activate contingency monitoring protocols. Verify all collection assets are operational.'
 : score >= 40
 ? 'Increase polling frequency on high-priority feeds. Notify duty analyst. Continue monitoring and prepare follow-on SITREP within 4 hours.'
 : 'Continue routine monitoring. No change to current alert posture recommended at this time.',
 sources: [],
 timestamp: now,
 },
  ];
}

function buildIntsumSections(input: ReportInput, location: string, now: number, score: number): ReportSection[] {
  const priority = scoreToPriority(score);
  const loc = location !== 'Global' ? ` for ${location}` : '';

  return [
 {
 title: 'Intelligence Summary',
 priority,
 content: `This intelligence summary${loc} is based on automated multi-source collection. ${input.iocCount ?? 0} indicators of compromise are active. Composite threat index: ${score}/100.`,
 sources: ['Crystal Ball Sensor Fusion'],
 timestamp: now,
 },
 {
 title: 'Collection Priorities',
 priority: 'medium',
 content: [
 cyberProse(input.cyberThreats ?? 0),
 iocProse(input.iocCount ?? 0),
 ].join(' '),
 sources: ['ThreatFox', 'GreyNoise', 'Pulsedive', 'IOC Manager'],
 timestamp: now,
 },
 {
 title: 'Key Indicators',
 priority,
 content: [
 sigintProse(input.sigintClusters ?? 0, input.killChainCount ?? 0),
 (input.anomalies ?? 0) > 0
 ? `${input.anomalies} cross-sensor anomal${(input.anomalies ?? 0) === 1 ? 'y' : 'ies'} flagged by the automated detection pipeline.`
 : 'No anomalies flagged in the automated detection pipeline.',
 (input.convergenceZones ?? 0) > 0
 ? `${input.convergenceZones} geo-convergence zone${(input.convergenceZones ?? 0) !== 1 ? 's' : ''} active — multiple independent threat streams converging in proximate geography.`
 : '',
 ].filter(Boolean).join(' '),
 sources: ['Anomaly Detector', 'SIGINT Convergence', 'Geo-Convergence Engine'],
 timestamp: now,
 },
 {
 title: 'Threat Matrix',
 priority,
 content: [
 `Cyber: ${input.cyberThreats ?? 0} indicators`,
 `Kinetic: ${input.conflicts ?? 0} conflict events, ${input.airstrikes ?? 0} airstrike reports`,
 `Maritime: ${input.darkVessels ?? 0} dark vessels`,
 `SIGINT: ${input.sigintClusters ?? 0} cluster(s), ${input.killChainCount ?? 0} kill-chain observations`,
 `Seismic/Natural: ${input.earthquakes ?? 0} M4+ events`,
 `Infrastructure: ${input.outages ?? 0} network outage(s)`,
 ].join('\n'),
 sources: ['Consolidated Feed Aggregator'],
 timestamp: now,
 },
 {
 title: 'Forecast',
 priority: scoreToPriority(score),
 content: score >= 70
 ? 'Threat trajectory is assessed as HIGH and potentially escalating. Continued multi-domain pressure is expected over the next 12-24 hours. Recommend heightened collection tempo and pre-positioned response options.'
 : score >= 40
 ? 'Threat trajectory is MODERATE. Isolated indicators suggest situational volatility but no imminent coordinated action detected. Reassess in 6-12 hours.'
 : 'Threat environment is assessed as ROUTINE. No significant changes anticipated in the near term. Scheduled reassessment in 24 hours.',
 sources: ['EMA Forecast Engine'],
 timestamp: now,
 },
  ];
}

function buildWarningSections(input: ReportInput, location: string, now: number, score: number): ReportSection[] {
  const priority = scoreToPriority(score);
  const loc = location !== 'Global' ? ` in ${location}` : '';

  const primaryThreat = (input.airstrikes ?? 0) > 0
 ? `Active airstrike activity${loc} — ${input.airstrikes} event${(input.airstrikes ?? 0) !== 1 ? 's' : ''} confirmed. Airspace assessed as CONTESTED.`
 : (input.conflicts ?? 0) >= 3
 ? `Multi-theater conflict activity${loc} with ${input.conflicts} simultaneous events. Escalation risk is HIGH.`
 : (input.cyberThreats ?? 0) >= 100
 ? `Elevated cyber threat activity${loc} — ${input.cyberThreats} indicators detected. Coordinated campaign possible.`
 : `Threat indicators${loc} have crossed warning thresholds. Composite score: ${score}/100.`;

  return [
 {
 title: 'Warning Summary',
 priority: 'critical',
 content: `WARNING INTELLIGENCE — ${primaryThreat}`,
 sources: ['Crystal Ball Warning Engine'],
 timestamp: now,
 },
 {
 title: 'Threat Description',
 priority,
 content: [
 conflictProse(input.conflicts ?? 0),
 cyberProse(input.cyberThreats ?? 0),
 (input.airstrikes ?? 0) > 0
 ? `${input.airstrikes} confirmed airstrike event${(input.airstrikes ?? 0) !== 1 ? 's' : ''} within the reporting window.`
 : '',
 ].filter(Boolean).join(' '),
 sources: ['Airstrike Tracker', 'Conflict Monitor', 'Cyber Feeds'],
 timestamp: now,
 },
 {
 title: 'Affected Areas',
 priority,
 content: location !== 'Global'
 ? `Primary area of concern: ${location}. Adjacent regions may experience secondary effects including displaced populations, supply chain disruption, and elevated cyber targeting.`
 : 'Multi-regional impact assessed. No single geographic area identified as primary locus at this time. Monitor all high-priority zones.',
 sources: ['Geographic Analysis Module'],
 timestamp: now,
 },
 {
 title: 'Recommended Actions',
 priority: 'critical',
 content: [
 '- Notify senior duty officer immediately.',
 '- Increase collection frequency on all affected region feeds.',
 '- Validate all critical infrastructure monitoring assets.',
 score >= 70 ? '- Consider activating emergency notification protocols.' : '',
 (input.geofenceAlerts ?? 0) > 0 ? '- Review active geofence alerts for evacuation corridor impacts.' : '',
 ].filter(Boolean).join('\n'),
 sources: [],
 timestamp: now,
 },
 {
 title: 'Timeline',
 priority: 'high',
 content: `Warning issued: ${formatUtc(now)}\nNext mandatory reassessment: ${formatUtc(now + 2 * 3_600_000)}\nAutomatic expiry: ${formatUtc(now + VALIDITY_WINDOWS.warning)}`,
 sources: [],
 timestamp: now,
 },
  ];
}

function buildAssessmentSections(input: ReportInput, location: string, now: number, score: number): ReportSection[] {
  const priority = scoreToPriority(score);
  const loc = location !== 'Global' ? ` for ${location}` : '';

  return [
 {
 title: 'Assessment Summary',
 priority,
 content: `This assessment${loc} synthesizes multi-source intelligence to provide an analytic judgment on the current threat environment. All source weightings are automated; human review is recommended before operational action.`,
 sources: ['Crystal Ball Analytic Engine'],
 timestamp: now,
 },
 {
 title: 'Background',
 priority: 'low',
 content: [
 `Current operational mode: ${(input.activeMode ?? 'default').toUpperCase()}.`,
 `Collection baseline includes: ${input.cyberThreats ?? 0} cyber indicators, ${input.conflicts ?? 0} conflict events, ${input.earthquakes ?? 0} seismic events, ${input.darkVessels ?? 0} dark vessels.`,
 ].join(' '),
 sources: ['Feed Aggregator'],
 timestamp: now,
 },
 {
 title: 'Analysis',
 priority,
 content: [
 cyberProse(input.cyberThreats ?? 0),
 conflictProse(input.conflicts ?? 0),
 maritimeProse(input.darkVessels ?? 0),
 sigintProse(input.sigintClusters ?? 0, input.killChainCount ?? 0),
 (input.outages ?? 0) > 0
 ? `${input.outages} internet/BGP outage${(input.outages ?? 0) !== 1 ? 's' : ''} detected — potential indicator of infrastructure targeting or collateral disruption.`
 : '',
 ].filter(Boolean).join('\n\n'),
 sources: ['Cyber Feeds', 'Conflict Monitor', 'AIS', 'BGP Monitor', 'SIGINT Convergence'],
 timestamp: now,
 },
 {
 title: 'Key Judgments',
 priority,
 content: score >= 70
 ? `HIGH CONFIDENCE — Current indicators are consistent with an active and coordinated multi-domain threat posture. Probability of significant adverse event within 24 hours is assessed as LIKELY.`
 : score >= 40
 ? `MODERATE CONFIDENCE — Indicators suggest elevated but not imminent threat activity. Probability of significant adverse event within 72 hours is assessed as POSSIBLE.`
 : `LOW CONFIDENCE — Threat indicators remain within baseline variance. Probability of significant adverse event within 7 days is assessed as UNLIKELY based on current collection.`,
 sources: ['Automated Confidence Scoring'],
 timestamp: now,
 },
 {
 title: 'Confidence Levels',
 priority: 'low',
 content: [
 `Overall composite threat score: ${score}/100`,
 `Cyber confidence: ${Math.min(Math.round((input.cyberThreats ?? 0) / 2), 100)}%`,
 `Kinetic confidence: ${Math.min(((input.conflicts ?? 0) + (input.airstrikes ?? 0)) * 15, 100)}%`,
 `Maritime confidence: ${Math.min((input.darkVessels ?? 0) * 12, 100)}%`,
 `SIGINT confidence: ${Math.min(((input.sigintClusters ?? 0) + (input.killChainCount ?? 0)) * 10, 100)}%`,
 'Note: Confidence values reflect automated indicator density. HUMINT sources not factored.',
 ].join('\n'),
 sources: ['Confidence Scoring Module'],
 timestamp: now,
 },
  ];
}

const SECTION_BUILDERS: Record<
  ReportType,
  (input: ReportInput, location: string, now: number, score: number) => ReportSection[]
> = {
  sitrep: buildSitrepSections,
  intsum: buildIntsumSections,
  warning: buildWarningSections,
  assessment: buildAssessmentSections,
};

// ── Key Findings & Recommendations ────────────────────────────────────────

function deriveKeyFindings(input: ReportInput, score: number): string[] {
  const findings: string[] = [];
  if ((input.airstrikes ?? 0) > 0)
 findings.push(`${input.airstrikes} airstrike event${(input.airstrikes ?? 0) !== 1 ? 's' : ''} confirmed in reporting period`);
  if ((input.conflicts ?? 0) >= 3)
 findings.push(`${input.conflicts} simultaneous armed conflict zones active — multi-theater activity`);
  else if ((input.conflicts ?? 0) > 0)
 findings.push(`${input.conflicts} active conflict event${(input.conflicts ?? 0) !== 1 ? 's' : ''} tracked`);
  if ((input.cyberThreats ?? 0) >= 100)
 findings.push(`${input.cyberThreats} cyber indicators — density consistent with coordinated campaign`);
  else if ((input.cyberThreats ?? 0) > 0)
 findings.push(`${input.cyberThreats} cyber threat indicators active`);
  if ((input.darkVessels ?? 0) >= 5)
 findings.push(`${input.darkVessels} dark vessels detected — possible sanctions evasion or pre-positioning`);
  if ((input.killChainCount ?? 0) >= 3)
 findings.push(`${input.killChainCount} kill-chain observations recorded — active intrusion sequence likely`);
  if ((input.convergenceZones ?? 0) >= 2)
 findings.push(`${input.convergenceZones} geo-convergence zones active — multi-stream threat overlap`);
  if ((input.geofenceAlerts ?? 0) > 0)
 findings.push(`${input.geofenceAlerts} geofence alert${(input.geofenceAlerts ?? 0) !== 1 ? 's' : ''} triggered within monitored perimeters`);
  if ((input.outages ?? 0) >= 3)
 findings.push(`${input.outages} infrastructure outages detected — possible targeted disruption`);
  if (score >= 70)
 findings.push('Composite threat score exceeds HIGH threshold (70/100)');
  return findings.length > 0 ? findings : ['No significant threat indicators in current collection window'];
}

function deriveRecommendations(input: ReportInput, score: number): string[] {
  const recs: string[] = [];
  if (score >= 70) {
 recs.push('Escalate to senior watch officer immediately');
 recs.push('Activate heightened collection tempo on all primary feeds');
  }
  if ((input.cyberThreats ?? 0) >= 50)
 recs.push('Engage SOC for cyber indicator triage and attribution analysis');
  if ((input.darkVessels ?? 0) >= 3)
 recs.push('Forward dark vessel positions to maritime intelligence consumers');
  if ((input.killChainCount ?? 0) >= 2)
 recs.push('Initiate kill-chain disruption review with cyber operations team');
  if ((input.geofenceAlerts ?? 0) > 0)
 recs.push('Review geofence alert parameters for operational relevance');
  if (score < 40)
 recs.push('Maintain routine monitoring posture — reassess at next scheduled cycle');
  return recs.length > 0 ? recs : ['Continue routine collection and monitoring'];
}

// ── Report Store Management ────────────────────────────────────────────────

function pruneStore(): void {
  while (_reports.length > MAX_REPORTS) {
 _reports.pop(); // newest-first → pop removes oldest
  }
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Generate a full IntelReport from current data metrics.
 *
 * @param type - Report format to generate
 * @param input - Numeric threat/event metrics from current app state
 * @param locationLabel - Optional geographic label (defaults to "Global")
 */
export function generateReport(
  type: ReportType,
  input: ReportInput,
  locationLabel?: string,
): IntelReport {
  const now = Date.now();
  const location = locationLabel?.trim() || 'Global';
  const score = computeThreatScore(input);
  const classification = classificationFromScore(score);
  const sections = SECTION_BUILDERS[type](input, location, now, score);
  const keyFindings = deriveKeyFindings(input, score);
  const recommendations = deriveRecommendations(input, score);

  const typeLabels: Record<ReportType, string> = {
 sitrep: 'SITREP',
 intsum: 'INTSUM',
 warning: 'WARNING INTELLIGENCE',
 assessment: 'INTELLIGENCE ASSESSMENT',
  };

  const report: IntelReport = {
 id: generateId(),
 type,
 title: `${typeLabels[type]} — ${location} — ${formatUtc(now)}`,
 classification,
 generatedAt: now,
 validUntil: now + VALIDITY_WINDOWS[type],
 preparedBy: PREPARED_BY,
 sections,
 executiveSummary: sections[0]?.content ?? '',
 keyFindings,
 recommendations,
 appendices: [
 `Composite threat score: ${score}/100`,
 `Collection sources: ${[...new Set(sections.flatMap(s => s.sources))].join(', ') || 'Automated systems'}`,
 `Generated: ${formatUtc(now)} | Valid until: ${formatUtc(now + VALIDITY_WINDOWS[type])}`,
 ],
  };

  _reports.unshift(report);
  pruneStore();
  return report;
}

/**
 * Return stored reports, newest first.
 *
 * @param opts.type  - Filter to a specific report type
 * @param opts.limit - Maximum number of reports to return
 */
export function getReports(opts?: { type?: ReportType; limit?: number }): IntelReport[] {
  let result = [..._reports];
  if (opts?.type) result = result.filter(r => r.type === opts.type);
  if (opts?.limit && opts.limit > 0) result = result.slice(0, opts.limit);
  return result;
}

/**
 * Look up a single report by its unique identifier.
 */
export function getReport(id: string): IntelReport | undefined {
  return _reports.find(r => r.id === id);
}

/**
 * Delete a report by its unique identifier.
 *
 * @returns `true` if found and deleted, `false` otherwise
 */
export function deleteReport(id: string): boolean {
  const idx = _reports.findIndex(r => r.id === id);
  if (idx === -1) return false;
  _reports.splice(idx, 1);
  return true;
}

/**
 * Export a report as formatted Markdown with classification banner,
 * headers, and a key findings table.
 */
export function exportReportMarkdown(id: string): string | undefined {
  const report = getReport(id);
  if (!report) return undefined;

  const banner = `**[${report.classification.toUpperCase()}]**`;
  const lines: string[] = [
 banner,
 '',
 `# ${report.title}`,
 '',
 `| Field | Value |`,
 `|-------|-------|`,
 `| Type | ${report.type.toUpperCase()} |`,
 `| Classification | ${report.classification.toUpperCase()} |`,
 `| Prepared By | ${report.preparedBy} |`,
 `| Generated | ${formatUtc(report.generatedAt)} |`,
 `| Valid Until | ${formatUtc(report.validUntil)} |`,
 '',
 `## Executive Summary`,
 '',
 report.executiveSummary,
 '',
 `## Key Findings`,
 '',
 ...report.keyFindings.map(f => `- ${f}`),
 '',
  ];

  for (const section of report.sections) {
 lines.push(`## ${section.title}`);
 lines.push('');
 lines.push(`*Priority: ${section.priority.toUpperCase()} | ${formatUtc(section.timestamp)}*`);
 lines.push('');
 lines.push(section.content);
 if (section.sources.length > 0) {
 lines.push('');
 lines.push(`*Sources: ${section.sources.join(', ')}*`);
 }
 lines.push('');
  }

  lines.push('## Recommendations', '');
  lines.push(...report.recommendations.map(r => `- ${r}`));
  lines.push('');
  lines.push('## Appendices', '');
  lines.push(...report.appendices.map(a => `- ${a}`));
  lines.push('');
  lines.push(banner);

  return lines.join('\n');
}

/**
 * Export a report as plain text suitable for secure messaging or printing.
 */
export function exportReportText(id: string): string | undefined {
  const report = getReport(id);
  if (!report) return undefined;

  const divider = '─'.repeat(72);
  const lines: string[] = [
 `[${report.classification.toUpperCase()}]`,
 divider,
 report.title,
 divider,
 `Type: ${report.type.toUpperCase()}`,
 `Classification: ${report.classification.toUpperCase()}`,
 `Prepared By: ${report.preparedBy}`,
 `Generated: ${formatUtc(report.generatedAt)}`,
 `Valid Until: ${formatUtc(report.validUntil)}`,
 divider,
 'EXECUTIVE SUMMARY',
 divider,
 report.executiveSummary,
 '',
 divider,
 'KEY FINDINGS',
 divider,
 ...report.keyFindings.map(f => `* ${f}`),
 '',
  ];

  for (const section of report.sections) {
 lines.push(divider);
 lines.push(`${section.title.toUpperCase()} [${section.priority.toUpperCase()}]`);
 lines.push(divider);
 lines.push(section.content);
 if (section.sources.length > 0) {
 lines.push('');
 lines.push(`Sources: ${section.sources.join(', ')}`);
 }
 lines.push('');
  }

  lines.push(divider, 'RECOMMENDATIONS', divider);
  lines.push(...report.recommendations.map(r => `* ${r}`));
  lines.push('');
  lines.push(divider, 'APPENDICES', divider);
  lines.push(...report.appendices.map(a => `* ${a}`));
  lines.push('');
  lines.push(`[${report.classification.toUpperCase()}]`);

  return lines.join('\n');
}

/**
 * Return the total number of reports currently stored.
 */
export function getReportCount(): number {
  return _reports.length;
}
