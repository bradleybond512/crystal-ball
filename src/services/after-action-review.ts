/**
 * After-Action Review (AAR) Service
 *
 * Manages post-incident analysis workflows. AARs track what happened, the
 * timeline of events, lessons learned, and recommendations for future
 * incidents. Entries are persisted to localStorage and held in memory.
 *
 * Persistence key: `crystalball-aars`
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AarStatus = 'draft' | 'in_review' | 'finalized';

export interface AarTimelineEntry {
  timestamp: number;
  description: string;
  source: string;
}

export interface AarEntry {
  id: string;
  title: string;
  incidentDate: number;
  createdAt: number;
  status: AarStatus;
  /** The app mode active during the incident (e.g. 'war', 'disaster', 'peace'). */
  mode: string;
  summary: string;
  timeline: AarTimelineEntry[];
  whatWorked: string[];
  whatFailed: string[];
  recommendations: string[];
  lessonsLearned: string[];
  participants: string[];
  relatedPanels: string[];
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

const STORAGE_KEY = 'crystalball-aars';

function loadFromStorage(): AarEntry[] {
  try {
 const raw = localStorage.getItem(STORAGE_KEY);
 if (!raw) return [];
 const parsed: unknown = JSON.parse(raw);
 if (!Array.isArray(parsed)) return [];
 return parsed as AarEntry[];
  } catch {
 return [];
  }
}

function saveToStorage(entries: AarEntry[]): void {
  try {
 localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
 // Quota or unavailable — silently skip persistence
  }
}

// ---------------------------------------------------------------------------
// In-memory state (loaded at module init)
// ---------------------------------------------------------------------------

let _aars: AarEntry[] = loadFromStorage();

// ---------------------------------------------------------------------------
// ID generation
// ---------------------------------------------------------------------------

let _idCounter = 0;

function generateId(): string {
  _idCounter += 1;
  return `aar-${Date.now().toString(36)}-${_idCounter.toString(36)}`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Create a new draft AAR. Returns the generated id.
 */
export function createAar(
  title: string,
  incidentDate: number,
  mode: string,
  summary: string,
): string {
  const entry: AarEntry = {
 id: generateId(),
 title: title.trim(),
 incidentDate,
 createdAt: Date.now(),
 status: 'draft',
 mode,
 summary,
 timeline: [],
 whatWorked: [],
 whatFailed: [],
 recommendations: [],
 lessonsLearned: [],
 participants: [],
 relatedPanels: [],
  };
  _aars = [entry, ..._aars];
  saveToStorage(_aars);
  return entry.id;
}

/**
 * Append a timeline entry to an existing AAR.
 * No-ops if the AAR id is not found.
 */
export function addTimelineEntry(
  aarId: string,
  timestamp: number,
  description: string,
  source: string,
): void {
  const idx = _aars.findIndex(a => a.id === aarId);
  if (idx === -1) return;

  const entry = _aars[idx];
  if (!entry) return;

  const updated: AarEntry = {
 ...entry,
 timeline: [
 ...entry.timeline,
 { timestamp, description, source },
 ].sort((a, b) => a.timestamp - b.timestamp),
  };

  _aars = _aars.map(a => a.id === aarId ? updated : a);
  saveToStorage(_aars);
}

/**
 * Replace an array section of an AAR (whatWorked, whatFailed,
 * recommendations, lessonsLearned, participants, relatedPanels).
 */
export function updateAarSection(
  aarId: string,
  section: 'whatWorked' | 'whatFailed' | 'recommendations' | 'lessonsLearned' | 'participants' | 'relatedPanels',
  items: string[],
): void {
  const idx = _aars.findIndex(a => a.id === aarId);
  if (idx === -1) return;

  const entry = _aars[idx];
  if (!entry) return;

  const updated: AarEntry = { ...entry, [section]: [...items] };
  _aars = _aars.map(a => a.id === aarId ? updated : a);
  saveToStorage(_aars);
}

/**
 * Mark an AAR as finalized. No further edits are enforced by convention;
 * callers are responsible for respecting the finalized status.
 */
export function finalizeAar(aarId: string): void {
  const idx = _aars.findIndex(a => a.id === aarId);
  if (idx === -1) return;

  const entry = _aars[idx];
  if (!entry) return;

  const updated: AarEntry = { ...entry, status: 'finalized' };
  _aars = _aars.map(a => a.id === aarId ? updated : a);
  saveToStorage(_aars);
}

/**
 * Retrieve AARs, optionally filtered by status and/or capped at a limit.
 * Results are returned newest-first (by createdAt).
 */
export function getAars(opts?: { status?: AarStatus; limit?: number }): AarEntry[] {
  let results = [..._aars].sort((a, b) => b.createdAt - a.createdAt);

  if (opts?.status != null) {
 results = results.filter(a => a.status === opts.status);
  }

  if (opts?.limit != null && opts.limit > 0) {
 results = results.slice(0, opts.limit);
  }

  return results.map(cloneAar);
}

/**
 * Retrieve a single AAR by id, or undefined if not found.
 */
export function getAar(id: string): AarEntry | undefined {
  const entry = _aars.find(a => a.id === id);
  return entry ? cloneAar(entry) : undefined;
}

/**
 * Delete an AAR by id. No-ops if not found.
 */
export function deleteAar(id: string): void {
  const before = _aars.length;
  _aars = _aars.filter(a => a.id !== id);
  if (_aars.length !== before) {
 saveToStorage(_aars);
  }
}

/**
 * Export an AAR as a formatted Markdown string.
 * Returns an empty string if the AAR is not found.
 */
export function exportAarMarkdown(id: string): string {
  const entry = _aars.find(a => a.id === id);
  if (!entry) return '';

  const dateStr = (ts: number) => new Date(ts).toISOString().replace('T', ' ').slice(0, 19) + ' UTC';

  const listSection = (heading: string, items: string[]): string => {
 if (items.length === 0) return `## ${heading}\n\n_None recorded._\n`;
 return `## ${heading}\n\n${items.map(i => `- ${i}`).join('\n')}\n`;
  };

  const timelineSection = (): string => {
 if (entry.timeline.length === 0) return '## Timeline\n\n_No timeline entries._\n';
 const rows = entry.timeline
 .slice()
 .sort((a, b) => a.timestamp - b.timestamp)
 .map(t => `| ${dateStr(t.timestamp)} | ${t.source} | ${t.description} |`)
 .join('\n');
 return `## Timeline\n\n| Time (UTC) | Source | Event |\n|---|---|---|\n${rows}\n`;
  };

  const lines: string[] = [
 `# After-Action Review: ${entry.title}`,
 '',
 `**Status**: ${entry.status}`,
 `**Incident Date**: ${dateStr(entry.incidentDate)}`,
 `**Created**: ${dateStr(entry.createdAt)}`,
 `**App Mode During Incident**: ${entry.mode}`,
 '',
 '## Summary',
 '',
 entry.summary || '_No summary provided._',
 '',
 timelineSection(),
 listSection('What Worked', entry.whatWorked),
 listSection('What Failed', entry.whatFailed),
 listSection('Recommendations', entry.recommendations),
 listSection('Lessons Learned', entry.lessonsLearned),
 listSection('Participants', entry.participants),
 listSection('Related Panels', entry.relatedPanels),
  ];

  return lines.join('\n');
}

/**
 * Return the total count of all AARs.
 */
export function getAarCount(): number {
  return _aars.length;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function cloneAar(entry: AarEntry): AarEntry {
  return {
 ...entry,
 timeline: entry.timeline.map(t => ({ ...t })),
 whatWorked: [...entry.whatWorked],
 whatFailed: [...entry.whatFailed],
 recommendations: [...entry.recommendations],
 lessonsLearned: [...entry.lessonsLearned],
 participants: [...entry.participants],
 relatedPanels: [...entry.relatedPanels],
  };
}
