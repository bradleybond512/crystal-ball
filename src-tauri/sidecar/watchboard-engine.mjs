import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

// State
let _storePath = null;
let _watchboards = [];
let _firings = [];

export function initWatchboardEngine(storePath) {
  _storePath = storePath;
  // Always reset before (re)loading so pointing the engine at a fresh/absent
  // store fully clears prior in-memory state.
  _watchboards = [];
  _firings = [];
  if (existsSync(storePath)) {
    try {
      const data = JSON.parse(readFileSync(storePath, 'utf8'));
      _watchboards = Array.isArray(data.watchboards) ? data.watchboards : [];
      _firings = Array.isArray(data.firings) ? data.firings : [];
    } catch {
      _watchboards = [];
      _firings = [];
    }
  }
}

function persist() {
  if (!_storePath) return;
  try {
    writeFileSync(_storePath, JSON.stringify({ watchboards: _watchboards, firings: _firings }, null, 2));
  } catch { /* non-fatal */ }
}

// Evaluate a signal against all enabled watchboards.
// Returns array of firing objects for any tripwires that matched.
export function evaluateSignal(signal) {
  // signal: { id?, lon, lat, domain?, severity?, entityIds?, payload? }
  const firings = [];
  for (const wb of _watchboards) {
    if (!wb.enabled) continue;
    for (const tw of wb.tripwires) {
      if (!tw.enabled) continue;
      if (tripwireMatches(tw, signal)) {
        const firing = {
          id: generateId(),
          tripwireId: tw.id,
          watchboardId: wb.id,
          firedAt: new Date().toISOString(),
          eventSummary: signal.eventSummary ?? `${tw.name} triggered by ${signal.domain ?? 'unknown'} event`,
          domain: signal.domain ?? 'unknown',
          severity: signal.severity,
          entityIds: signal.entityIds,
          payload: signal.payload ?? null,
        };
        tw.lastFiredAt = firing.firedAt;
        tw.fireCount = (tw.fireCount || 0) + 1;
        _firings.unshift(firing);
        firings.push(firing);
      }
    }
  }
  if (firings.length > 0) {
    // Cap firings at 500
    if (_firings.length > 500) _firings = _firings.slice(0, 500);
    persist();
  }
  return firings;
}

// Point-in-shape check (mirrored from watchboard-store-helpers.ts)
function pointOnSegment(px, py, ax, ay, bx, by) {
  const cross = (bx - ax) * (py - ay) - (by - ay) * (px - ax);
  if (Math.abs(cross) > 1e-9) return false;
  const dot = (px - ax) * (bx - ax) + (py - ay) * (by - ay);
  if (dot < 0) return false;
  const lenSq = (bx - ax) ** 2 + (by - ay) ** 2;
  return dot <= lenSq;
}

function pointInPolygon(lon, lat, coords) {
  if (coords.length < 3) return false;
  for (let i = 0; i < coords.length; i++) {
    const a = coords[i], b = coords[(i + 1) % coords.length];
    if (pointOnSegment(lon, lat, a[0], a[1], b[0], b[1])) return true;
  }
  let inside = false;
  for (let i = 0, j = coords.length - 1; i < coords.length; j = i++) {
    const [xi, yi] = coords[i];
    const [xj, yj] = coords[j];
    const intersects = yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

function pointInCircle(lon, lat, center, radiusKm) {
  const R = 6371;
  const lat1 = lat * Math.PI / 180;
  const lat2 = center[1] * Math.PI / 180;
  const dLat = (center[1] - lat) * Math.PI / 180;
  const dLon = (center[0] - lon) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a)) <= radiusKm;
}

function pointInShape(lon, lat, shape) {
  if (shape.type === 'polygon') return pointInPolygon(lon, lat, shape.coordinates);
  return pointInCircle(lon, lat, shape.center, shape.radiusKm);
}

function tripwireMatches(tw, signal) {
  if (!pointInShape(signal.lon, signal.lat, tw.shape)) return false;
  for (const cond of tw.conditions) {
    if (cond.type === 'domain' && signal.domain !== cond.value) return false;
    if (cond.type === 'severity' && (signal.severity === undefined || signal.severity < cond.value)) return false;
    if (cond.type === 'entity' && !(signal.entityIds?.includes(cond.value) ?? false)) return false;
    if (cond.type === 'keyword') {
      const needle = String(cond.value).toLowerCase();
      const hay = (typeof signal.payload === 'string' ? signal.payload : safeStringify(signal.payload)).toLowerCase();
      if (!hay.includes(needle)) return false;
    }
    if (cond.type === 'event-type' && signal.eventType !== cond.value) return false;
  }
  return true;
}

function safeStringify(value) {
  if (value === null || value === undefined) return '';
  try {
    return JSON.stringify(value) ?? '';
  } catch {
    return String(value);
  }
}

function generateId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

/** Normalize a raw tripwire payload into a complete, persistable Tripwire. */
function normalizeTripwire(raw, watchboardId) {
  return {
    id: raw.id ?? generateId(),
    watchboardId,
    name: raw.name ?? 'Untitled tripwire',
    shape: raw.shape,
    conditions: Array.isArray(raw.conditions)
      ? raw.conditions.map((c) => ({ id: c.id ?? generateId(), ...c }))
      : [],
    dwellLogic: raw.dwellLogic ?? { enabled: false },
    enabled: raw.enabled !== false,
    createdAt: raw.createdAt ?? new Date().toISOString(),
    lastFiredAt: raw.lastFiredAt,
    fireCount: typeof raw.fireCount === 'number' ? raw.fireCount : 0,
  };
}

export function getWatchboards() {
  return _watchboards;
}

export function createWatchboard(wb) {
  const now = new Date().toISOString();
  const id = wb.id ?? generateId();
  const entry = {
    id,
    name: wb.name ?? 'Untitled',
    description: wb.description ?? '',
    tripwires: Array.isArray(wb.tripwires) ? wb.tripwires.map((tw) => normalizeTripwire(tw, id)) : [],
    createdAt: now,
    updatedAt: now,
    enabled: wb.enabled !== false,
    tags: Array.isArray(wb.tags) ? wb.tags : [],
  };
  _watchboards.push(entry);
  persist();
  return entry;
}

export function updateWatchboard(id, updates) {
  const idx = _watchboards.findIndex(w => w.id === id);
  if (idx === -1) return null;
  _watchboards[idx] = { ..._watchboards[idx], ...updates, id, updatedAt: new Date().toISOString() };
  persist();
  return _watchboards[idx];
}

export function deleteWatchboard(id) {
  const before = _watchboards.length;
  _watchboards = _watchboards.filter(w => w.id !== id);
  if (_watchboards.length < before) persist();
  return _watchboards.length < before;
}

export function getRecentFirings(limit = 50) {
  return _firings.slice(0, limit);
}

// Built-in starter watchboards. Mirrors getTemplates() in
// src/components/watchboard-store-helpers.ts so the /templates route and the
// renderer offer the same starting points.
export function getWatchboardTemplates() {
  return [
    {
      name: 'Strait of Hormuz',
      description: 'Maritime chokepoint between the Persian Gulf and Gulf of Oman',
      shapes: [{ type: 'circle', center: [56.3, 26.5], radiusKm: 150 }],
      conditions: [{ id: 'c1', type: 'domain', value: 'maritime', description: 'Maritime domain events' }],
    },
    {
      name: 'Taiwan Strait',
      description: 'Strait between mainland China and Taiwan',
      shapes: [{ type: 'polygon', coordinates: [[118, 23], [122, 23], [122, 26], [118, 26], [118, 23]] }],
      conditions: [{ id: 'c1', type: 'domain', value: 'military', description: 'Military domain events' }],
    },
    {
      name: 'Black Sea',
      description: 'Black Sea maritime zone',
      shapes: [{ type: 'polygon', coordinates: [[28, 41], [41, 41], [41, 46.5], [28, 46.5], [28, 41]] }],
      conditions: [{ id: 'c1', type: 'domain', value: 'maritime', description: 'Maritime domain events' }],
    },
    {
      name: 'Global Emergency Squawks',
      description: 'Worldwide aircraft squawking 7500/7600/7700',
      shapes: [{ type: 'circle', center: [0, 0], radiusKm: 25000 }],
      conditions: [
        { id: 'c1', type: 'event-type', value: 'emergency_squawk', description: 'Aircraft emergency squawk (7500/7600/7700)' },
        { id: 'c2', type: 'domain', value: 'aviation', description: 'Aviation domain events' },
      ],
    },
    {
      name: 'Earthquake Watch',
      description: 'Worldwide significant seismic activity',
      shapes: [{ type: 'circle', center: [0, 0], radiusKm: 25000 }],
      conditions: [
        { id: 'c1', type: 'severity', value: 0.6, description: 'Severity at or above 0.6' },
        { id: 'c2', type: 'domain', value: 'seismic', description: 'Seismic domain events' },
      ],
    },
  ];
}
