import { getApiBaseUrl, isDesktopRuntime } from '@/services/runtime';

export type LittleSnitchDecision = 'allow' | 'block' | 'unknown';
export type LittleSnitchDirection = 'inbound' | 'outbound' | 'unknown';

export interface LittleSnitchEntry {
  id: string;
  app: string;
  remoteHost: string;
  remoteIp: string | null;
  decision: LittleSnitchDecision;
  direction: LittleSnitchDirection;
  protocol: string;
  bytesIn: number;
  bytesOut: number;
  lastSeen: string;
  count: number;
  firstSeen: boolean;
  risk: LittleSnitchRiskScore;
}

export interface LittleSnitchSummaryRow {
  name: string;
  count: number;
  bytesIn: number;
  bytesOut: number;
}

export interface LittleSnitchSummary {
  totalConnections: number;
  allowedConnections: number;
  blockedConnections: number;
  highRiskConnections: number;
  newDestinations: number;
  outboundBytes: number;
  topApps: LittleSnitchSummaryRow[];
  topDomains: LittleSnitchSummaryRow[];
  topRisks: LittleSnitchRiskFinding[];
  allowlistHits: number;
}

export type LittleSnitchRiskLevel = 'low' | 'medium' | 'high';

export interface LittleSnitchRiskScore {
  level: LittleSnitchRiskLevel;
  score: number;
  reasons: string[];
}

export interface LittleSnitchRiskFinding {
  app: string;
  remoteHost: string;
  level: LittleSnitchRiskLevel;
  score: number;
  reasons: string[];
}

export interface LittleSnitchSnapshot {
  available: boolean;
  sourceState: LittleSnitchSourceState;
  generatedAt: string | null;
  sourcePath?: string;
  error?: string;
  freshness: LittleSnitchFreshness;
  entries: LittleSnitchEntry[];
  summary: LittleSnitchSummary;
}

export type LittleSnitchSourceState = 'ready' | 'empty' | 'missing' | 'stale' | 'invalid' | 'permission-denied';

export type SecurityPostureStatus = 'ok' | 'warn' | 'fail' | 'unknown';
export type PersistenceRisk = 'low' | 'medium' | 'high';

export interface SecurityPostureCheck {
  id: string;
  label: string;
  status: SecurityPostureStatus;
  detail: string;
}

export interface PersistenceItem {
  id: string;
  kind: string;
  path: string;
  label: string;
  command: string;
  risk: PersistenceRisk;
}

export interface SecurityPostureSnapshot {
  available: boolean;
  generatedAt: string | null;
  checks: SecurityPostureCheck[];
  persistenceItems: PersistenceItem[];
  quarantineCommands: string[];
  error?: string;
}

export interface LittleSnitchEnrichment {
  available: boolean;
  value: string;
  type: 'domain' | 'ip';
  generatedAt: string | null;
  providers: LittleSnitchEnrichmentProvider[];
  signals: string[];
  error?: string;
}

export interface LittleSnitchEnrichmentProvider {
  name: string;
  status: 'ok' | 'missing' | 'error';
  summary: string;
}

export type LittleSnitchFreshnessStatus = 'missing' | 'fresh' | 'stale';

export interface LittleSnitchFreshness {
  status: LittleSnitchFreshnessStatus;
  ageMs: number | null;
  label: string;
}

const MAX_ENTRIES = 500;
const STALE_AFTER_MS = 10 * 60 * 1000;
const HOST_RE = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;

export async function fetchLittleSnitchSnapshot(): Promise<LittleSnitchSnapshot> {
  if (!isDesktopRuntime()) return emptyLittleSnitchSnapshot('Desktop runtime required');
  try {
    const res = await fetch(`${getApiBaseUrl()}/api/little-snitch`);
    if (!res.ok) return emptyLittleSnitchSnapshot(`HTTP ${res.status}`);
    return sanitizeLittleSnitchSnapshot(await res.json());
  } catch (error) {
    return emptyLittleSnitchSnapshot(error instanceof Error ? error.message : 'Little Snitch data unavailable');
  }
}

export async function fetchSecurityPostureSnapshot(): Promise<SecurityPostureSnapshot> {
  if (!isDesktopRuntime()) return emptySecurityPostureSnapshot('Desktop runtime required');
  try {
    const res = await fetch(`${getApiBaseUrl()}/api/security-posture`);
    if (!res.ok) return emptySecurityPostureSnapshot(`HTTP ${res.status}`);
    return sanitizeSecurityPostureSnapshot(await res.json());
  } catch (error) {
    return emptySecurityPostureSnapshot(error instanceof Error ? error.message : 'Security posture unavailable');
  }
}

export async function fetchLittleSnitchEnrichment(value: string): Promise<LittleSnitchEnrichment> {
  if (!isDesktopRuntime()) return emptyLittleSnitchEnrichment(value, 'Desktop runtime required');
  const normalized = normalizeIndicator(value);
  if (!normalized) return emptyLittleSnitchEnrichment(value, 'Invalid indicator');
  try {
    const res = await fetch(`${getApiBaseUrl()}/api/little-snitch-enrich?value=${encodeURIComponent(normalized)}`);
    if (!res.ok) return emptyLittleSnitchEnrichment(normalized, `HTTP ${res.status}`);
    return sanitizeLittleSnitchEnrichment(await res.json(), normalized);
  } catch (error) {
    return emptyLittleSnitchEnrichment(normalized, error instanceof Error ? error.message : 'Enrichment unavailable');
  }
}

export function sanitizeLittleSnitchSnapshot(input: unknown, nowMs = Date.now()): LittleSnitchSnapshot {
  const obj = isObject(input) ? input : {};
  const generatedAt = sanitizeIso(obj.generatedAt);
  const freshness = getLittleSnitchFreshness(generatedAt, nowMs);
  const advertisedState = sanitizeLittleSnitchSourceState(obj.state);
  let sourceState = advertisedState;
  if (advertisedState === 'ready' || advertisedState === 'empty') {
    if (freshness.status === 'fresh') sourceState = advertisedState;
    else if (freshness.status === 'stale') sourceState = 'stale';
    else sourceState = 'invalid';
  }
  const rawEntries = Array.isArray(obj.entries) ? obj.entries : [];
  let entries = sourceState === 'ready'
    ? rawEntries
      .slice(0, MAX_ENTRIES)
      .map((entry, idx) => sanitizeEntry(entry, idx))
      .filter((entry): entry is LittleSnitchEntry => entry !== null)
    : [];
  if (sourceState === 'ready' && entries.length === 0) {
    sourceState = 'invalid';
    entries = [];
  }

  return {
    available: sourceState === 'ready' || sourceState === 'empty',
    sourceState,
    generatedAt,
    sourcePath: typeof obj.sourcePath === 'string' ? obj.sourcePath.slice(0, 300) : undefined,
    error: typeof obj.error === 'string' ? obj.error.slice(0, 300) : undefined,
    freshness,
    entries,
    summary: summarizeLittleSnitchSnapshot({ entries } as LittleSnitchSnapshot),
  };
}

export function sanitizeSecurityPostureSnapshot(input: unknown): SecurityPostureSnapshot {
  const obj = isObject(input) ? input : {};
  const checks = Array.isArray(obj.checks) ? obj.checks.map(check => sanitizeSecurityCheck(check)).filter((check): check is SecurityPostureCheck => check !== null) : [];
  const persistenceItems = Array.isArray(obj.persistenceItems)
    ? obj.persistenceItems.map(item => sanitizePersistenceItem(item)).filter((item): item is PersistenceItem => item !== null).slice(0, 80)
    : [];
  const quarantineCommands = Array.isArray(obj.quarantineCommands)
    ? obj.quarantineCommands.filter((cmd): cmd is string => typeof cmd === 'string').map(cmd => cmd.slice(0, 240)).slice(0, 12)
    : [];

  return {
    available: typeof obj.available === 'boolean' ? obj.available : checks.length > 0 || persistenceItems.length > 0,
    generatedAt: sanitizeIso(obj.generatedAt),
    checks,
    persistenceItems,
    quarantineCommands,
    error: typeof obj.error === 'string' ? obj.error.slice(0, 300) : undefined,
  };
}

export function sanitizeLittleSnitchEnrichment(input: unknown, fallbackValue = ''): LittleSnitchEnrichment {
  const obj = isObject(input) ? input : {};
  const value = sanitizeLabel(obj.value, fallbackValue || 'unknown');
  const providers = Array.isArray(obj.providers)
    ? obj.providers.map(provider => sanitizeEnrichmentProvider(provider)).filter((provider): provider is LittleSnitchEnrichmentProvider => provider !== null)
    : [];
  const signals = Array.isArray(obj.signals)
    ? obj.signals.filter((signal): signal is string => typeof signal === 'string').map(signal => signal.slice(0, 160)).slice(0, 12)
    : [];
  return {
    available: typeof obj.available === 'boolean' ? obj.available : providers.some(provider => provider.status === 'ok'),
    value,
    type: obj.type === 'ip' ? 'ip' : 'domain',
    generatedAt: sanitizeIso(obj.generatedAt),
    providers,
    signals,
    error: typeof obj.error === 'string' ? obj.error.slice(0, 300) : undefined,
  };
}

export function getLittleSnitchFreshness(generatedAt: string | null, nowMs = Date.now()): LittleSnitchFreshness {
  if (!generatedAt) return { status: 'missing', ageMs: null, label: 'No export timestamp' };
  const generatedMs = Date.parse(generatedAt);
  if (!Number.isFinite(generatedMs)) return { status: 'missing', ageMs: null, label: 'Invalid export timestamp' };
  const ageMs = Math.max(0, nowMs - generatedMs);
  return {
    status: ageMs > STALE_AFTER_MS ? 'stale' : 'fresh',
    ageMs,
    label: formatFreshnessAge(ageMs),
  };
}

export function summarizeLittleSnitchSnapshot(snapshot: Pick<LittleSnitchSnapshot, 'entries'>): LittleSnitchSummary {
  const topApps = new Map<string, LittleSnitchSummaryRow>();
  const topDomains = new Map<string, LittleSnitchSummaryRow>();
  let allowedConnections = 0;
  let blockedConnections = 0;
  let highRiskConnections = 0;
  let newDestinations = 0;
  let outboundBytes = 0;
  let allowlistHits = 0;
  let totalConnections = 0;

  for (const entry of snapshot.entries) {
    totalConnections = addBounded(totalConnections, entry.count);
    if (entry.decision === 'block') blockedConnections = addBounded(blockedConnections, entry.count);
    else if (entry.decision === 'allow') allowedConnections = addBounded(allowedConnections, entry.count);
    if (entry.risk.level === 'high') highRiskConnections = addBounded(highRiskConnections, entry.count);
    if (entry.firstSeen) newDestinations += 1;
    outboundBytes = addBounded(outboundBytes, entry.bytesOut);
    if (isKnownGoodHost(entry.remoteHost)) allowlistHits = addBounded(allowlistHits, entry.count);
    bump(topApps, entry.app, entry);
    bump(topDomains, entry.remoteHost, entry);
  }

  return {
    totalConnections,
    allowedConnections,
    blockedConnections,
    highRiskConnections,
    newDestinations,
    outboundBytes,
    topApps: sortRows(topApps).slice(0, 6),
    topDomains: sortRows(topDomains).slice(0, 8),
    allowlistHits,
    topRisks: snapshot.entries
      .filter(entry => entry.risk.level !== 'low')
      .sort((a, b) => b.risk.score - a.risk.score)
      .slice(0, 6)
      .map(entry => ({
        app: entry.app,
        remoteHost: entry.remoteHost,
        level: entry.risk.level,
        score: entry.risk.score,
        reasons: entry.risk.reasons,
      })),
  };
}

export function emptyLittleSnitchSnapshot(error?: string): LittleSnitchSnapshot {
  return {
    available: false,
    sourceState: 'missing',
    generatedAt: null,
    error,
    freshness: getLittleSnitchFreshness(null),
    entries: [],
    summary: {
      totalConnections: 0,
      allowedConnections: 0,
      blockedConnections: 0,
      highRiskConnections: 0,
      newDestinations: 0,
      outboundBytes: 0,
      topApps: [],
      topDomains: [],
      topRisks: [],
      allowlistHits: 0,
    },
  };
}

function sanitizeLittleSnitchSourceState(value: unknown): LittleSnitchSourceState {
  if (value === 'ready' || value === 'empty' || value === 'missing' || value === 'stale' || value === 'invalid' || value === 'permission-denied') {
    return value;
  }
  return 'invalid';
}

export function emptySecurityPostureSnapshot(error?: string): SecurityPostureSnapshot {
  return {
    available: false,
    generatedAt: null,
    checks: [],
    persistenceItems: [],
    quarantineCommands: [],
    error,
  };
}

function emptyLittleSnitchEnrichment(value: string, error?: string): LittleSnitchEnrichment {
  return {
    available: false,
    value,
    type: normalizeIp(value) ? 'ip' : 'domain',
    generatedAt: null,
    providers: [],
    signals: [],
    error,
  };
}

function formatFreshnessAge(ageMs: number): string {
  const minutes = Math.round(ageMs / 60_000);
  if (minutes < 1) return 'Updated just now';
  if (minutes === 1) return 'Updated 1 minute ago';
  return `Updated ${minutes} minutes ago`;
}

function sanitizeEntry(input: unknown, idx: number): LittleSnitchEntry | null {
  if (!isObject(input)) return null;
  const remoteHost = normalizeHost(input.remoteHost ?? input.host ?? input.domain ?? input.remote);
  if (!remoteHost) return null;
  const remoteIp = normalizeIp(input.remoteIp ?? input.ip ?? input.ipAddress);
  const app = sanitizeLabel(input.app ?? input.process ?? input.processName, 'Unknown App');
  const entry = {
    id: sanitizeLabel(input.id, `${app}-${remoteHost}-${idx}`),
    app,
    remoteHost,
    remoteIp,
    decision: sanitizeDecision(input.decision ?? input.action),
    direction: sanitizeDirection(input.direction),
    protocol: sanitizeProtocol(input.protocol),
    bytesIn: sanitizeNumber(input.bytesIn),
    bytesOut: sanitizeNumber(input.bytesOut),
    lastSeen: sanitizeIso(input.lastSeen ?? input.timestamp) ?? new Date(0).toISOString(),
    count: Math.max(1, sanitizeNumber(input.count)),
    firstSeen: input.firstSeen === true,
    risk: { level: 'low' as const, score: 0, reasons: [] },
  };
  return { ...entry, risk: scoreLittleSnitchEntry(entry) };
}

export function scoreLittleSnitchEntry(entry: Omit<LittleSnitchEntry, 'risk'>): LittleSnitchRiskScore {
  let score = 0;
  const reasons: string[] = [];
  const app = entry.app.toLowerCase();
  const outboundBytes = entry.bytesOut;

  if (entry.decision === 'block') {
    score += 35;
    reasons.push('blocked by Little Snitch');
  }
  if (isKnownGoodHost(entry.remoteHost)) {
    score -= 20;
    reasons.push('known-good baseline destination');
  }
  if (entry.firstSeen) {
    score += 25;
    reasons.push('new destination for this app');
  }
  if (entry.direction === 'outbound' && isDeveloperTool(app)) {
    score += 25;
    reasons.push('developer tool made outbound connection');
  }
  if (outboundBytes >= 1_000_000) {
    score += 20;
    reasons.push('large outbound transfer');
  }
  if (entry.count >= 10) {
    score += 10;
    reasons.push('repeated connection attempts');
  }
  if (isSuspiciousTld(entry.remoteHost)) {
    score += 15;
    reasons.push('unusual destination TLD');
  }
  if (entry.remoteIp && isPublicIp(entry.remoteIp) && entry.direction === 'outbound') {
    score += 5;
    reasons.push('direct public IP context available');
  }

  let level: LittleSnitchRiskLevel = 'low';
  if (score >= 60) level = 'high';
  else if (score >= 30) level = 'medium';

  return {
    level,
    score: Math.min(Math.max(score, 0), 100),
    reasons,
  };
}

function sanitizeSecurityCheck(input: unknown): SecurityPostureCheck | null {
  if (!isObject(input)) return null;
  const id = sanitizeLabel(input.id, '');
  const label = sanitizeLabel(input.label, '');
  if (!id || !label) return null;
  const status = input.status === 'ok' || input.status === 'warn' || input.status === 'fail' || input.status === 'unknown' ? input.status : 'unknown';
  return {
    id,
    label,
    status,
    detail: sanitizeLabel(input.detail, 'No detail'),
  };
}

function sanitizePersistenceItem(input: unknown): PersistenceItem | null {
  if (!isObject(input)) return null;
  const path = sanitizeLabel(input.path, '');
  if (!path) return null;
  return {
    id: sanitizeLabel(input.id, path),
    kind: sanitizeLabel(input.kind, 'persistence'),
    path,
    label: sanitizeLabel(input.label, 'Unknown'),
    command: sanitizeLabel(input.command, ''),
    risk: input.risk === 'high' || input.risk === 'medium' || input.risk === 'low' ? input.risk : 'low',
  };
}

function sanitizeEnrichmentProvider(input: unknown): LittleSnitchEnrichmentProvider | null {
  if (!isObject(input)) return null;
  const name = sanitizeLabel(input.name, '');
  if (!name) return null;
  const status = input.status === 'ok' || input.status === 'missing' || input.status === 'error' ? input.status : 'error';
  return {
    name,
    status,
    summary: sanitizeLabel(input.summary, status),
  };
}

function isDeveloperTool(app: string): boolean {
  return ['node', 'python', 'python3', 'ruby', 'perl', 'curl', 'wget', 'ssh', 'git', 'npm', 'pnpm', 'yarn'].includes(app);
}

function isSuspiciousTld(host: string): boolean {
  return /\.(zip|mov|top|xyz|click|country|quest)$/i.test(host);
}

function isKnownGoodHost(host: string): boolean {
  return /(^|\.)((apple|icloud|mzstatic|cdn-apple|github|githubusercontent|npmjs|homebrew|brew)\.com|github\.io|nodejs\.org|cloudflare\.com|fastly\.net|akamaihd\.net)$/i.test(host);
}

function normalizeIndicator(value: string): string | null {
  return normalizeIp(value) ?? normalizeHost(value);
}

function normalizeIp(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!/^(?:\d{1,3}\.){3}\d{1,3}$/.test(trimmed)) return null;
  return trimmed.split('.').every(part => Number(part) <= 255) ? trimmed : null;
}

function isPublicIp(value: string): boolean {
  const parts = value.split('.').map(part => Number(part));
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part))) return false;
  const [a = 0, b = 0] = parts;
  if (a === 10 || a === 127 || a === 0) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  if (a === 169 && b === 254) return false;
  return true;
}

function bump(map: Map<string, LittleSnitchSummaryRow>, name: string, entry: LittleSnitchEntry): void {
  const row = map.get(name) ?? { name, count: 0, bytesIn: 0, bytesOut: 0 };
  row.count = addBounded(row.count, entry.count);
  row.bytesIn = addBounded(row.bytesIn, entry.bytesIn);
  row.bytesOut = addBounded(row.bytesOut, entry.bytesOut);
  map.set(name, row);
}

function sortRows(map: Map<string, LittleSnitchSummaryRow>): LittleSnitchSummaryRow[] {
  return [...map.values()].sort((a, b) => b.count - a.count
    || addBounded(b.bytesIn, b.bytesOut) - addBounded(a.bytesIn, a.bytesOut));
}

function addBounded(a: number, b: number): number {
  return Math.min(Number.MAX_SAFE_INTEGER, a + b);
}

function normalizeHost(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`);
    return normalizeHostLabel(parsed.hostname);
  } catch {
    return normalizeHostLabel(trimmed.split(/[/:?#]/, 1)[0] ?? '');
  }
}

function normalizeHostLabel(value: string): string | null {
  const host = value.toLowerCase().replace(/\.$/, '');
  if (!HOST_RE.test(host)) return null;
  return host;
}

function sanitizeLabel(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  return value.replace(/[<>"'`]/g, '').replace(/\s+/g, ' ').trim().slice(0, 100) || fallback;
}

function sanitizeDecision(value: unknown): LittleSnitchDecision {
  if (value === 'allow' || value === 'allowed') return 'allow';
  if (value === 'block' || value === 'blocked' || value === 'deny' || value === 'denied') return 'block';
  return 'unknown';
}

function sanitizeDirection(value: unknown): LittleSnitchDirection {
  if (value === 'inbound' || value === 'outbound') return value;
  return 'unknown';
}

function sanitizeProtocol(value: unknown): string {
  if (typeof value !== 'string') return 'unknown';
  const protocol = value.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 12);
  return protocol || 'unknown';
}

function sanitizeNumber(value: unknown): number {
  const num = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(num) || num < 0) return 0;
  return Math.min(Math.round(num), Number.MAX_SAFE_INTEGER);
}

function sanitizeIso(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
