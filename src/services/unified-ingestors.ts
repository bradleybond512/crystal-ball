/**
 * Source-specific normalizers that convert domain types into UnifiedAlert
 * and push them through the unified store. Centralized so the data-loader
 * just calls one function per source.
 */

import { unifiedAlertStore, type UnifiedAlert } from './unified-alerts';
import { matchesWatchlist } from './watchlist';
import type { CyberThreat } from '@/types';

// Structural shape — matches the proto-generated Earthquake the data-loader uses.
interface EarthquakeLike {
  id: string;
  place: string;
  magnitude: number;
  depthKm: number;
  location?: { latitude: number; longitude: number };
  occurredAt: number;
  sourceUrl: string;
}

function relevance(matched: boolean): number { return matched ? 100 : 50; }

export function ingestEarthquakesUnified(quakes: EarthquakeLike[]): void {
  const out: UnifiedAlert[] = [];
  for (const q of quakes) {
    if (q.magnitude < 5.5) continue;
    if (!q.location) continue;
    const severity: UnifiedAlert['severity'] =
      q.magnitude >= 7 ? 'critical'
      : q.magnitude >= 6.5 ? 'high'
      : q.magnitude >= 6 ? 'medium'
      : 'low';
    const lat = q.location.latitude;
    const lon = q.location.longitude;
    const matched = matchesWatchlist({ text: q.place, lat, lon });
    out.push({
      id: `quake-${q.id}`,
      source: 'earthquake',
      severity,
      title: `M${q.magnitude.toFixed(1)} — ${q.place}`,
      body: `Depth ${q.depthKm.toFixed(0)}km`,
      timestamp: q.occurredAt,
      location: { lat, lon, label: q.place },
      relevanceScore: relevance(matched),
      acknowledged: false,
      pinned: false,
      link: q.sourceUrl,
    });
  }
  if (out.length > 0) unifiedAlertStore.ingest(out);
}

export function ingestCyberThreatsUnified(threats: CyberThreat[]): void {
  const out: UnifiedAlert[] = [];
  for (const t of threats) {
    // Only forward critical/high to triage — full feed lives in cyber panel.
    if (t.severity !== 'critical' && t.severity !== 'high') continue;
    const matched = matchesWatchlist({
      text: `${t.indicator} ${t.malwareFamily ?? ''} ${t.tags.join(' ')}`,
      lat: t.lat, lon: t.lon,
    });
    out.push({
      id: `cyber-${t.id}`,
      source: 'cyber',
      severity: t.severity,
      title: `${t.type.replace(/_/g, ' ')} — ${t.indicator}`,
      body: `${t.source}${t.malwareFamily ? ` · ${t.malwareFamily}` : ''}${t.country ? ` · ${t.country}` : ''}`,
      timestamp: t.lastSeen ? Date.parse(t.lastSeen) : Date.now(),
      location: { lat: t.lat, lon: t.lon, label: t.country },
      relevanceScore: relevance(matched),
      acknowledged: false,
      pinned: false,
    });
  }
  if (out.length > 0) unifiedAlertStore.ingest(out);
}

interface FireLike { id?: string; lat: number; lon: number; brightness?: number; confidence?: number | string; acq_date?: string; acq_time?: string; }
export function ingestFiresUnified(fires: FireLike[]): void {
  const out: UnifiedAlert[] = [];
  for (const f of fires) {
    const conf = typeof f.confidence === 'number' ? f.confidence : Number(f.confidence) || 0;
    const bright = f.brightness ?? 0;
    if (conf < 80 && bright < 350) continue; // only forward likely real, intense fires
    const matched = matchesWatchlist({ lat: f.lat, lon: f.lon });
    if (!matched) continue; // fires only triage if near watchlist; otherwise spammy
    out.push({
      id: `fire-${f.id ?? `${f.lat}-${f.lon}-${f.acq_date}-${f.acq_time}`}`,
      source: 'fire',
      severity: bright >= 400 ? 'high' : 'medium',
      title: `Active fire detected`,
      body: `Brightness ${bright.toFixed(0)}K · confidence ${conf}`,
      timestamp: f.acq_date ? Date.parse(`${f.acq_date}T${(f.acq_time ?? '0000').toString().padStart(4, '0').replace(/(\d{2})(\d{2})/, '$1:$2')}:00Z`) : Date.now(),
      location: { lat: f.lat, lon: f.lon },
      relevanceScore: 100,
      acknowledged: false,
      pinned: false,
    });
  }
  if (out.length > 0) unifiedAlertStore.ingest(out);
}

interface CycloneLike { id: string; name: string; category?: number; windKph?: number; lat: number; lon: number; advisoryTime?: string; }
export function ingestCyclonesUnified(cyclones: CycloneLike[]): void {
  const out: UnifiedAlert[] = [];
  for (const c of cyclones) {
    const cat = c.category ?? 0;
    if (cat < 1) continue;
    const severity: UnifiedAlert['severity'] =
      cat >= 4 ? 'critical' : cat >= 3 ? 'high' : cat >= 2 ? 'medium' : 'low';
    const matched = matchesWatchlist({ text: c.name, lat: c.lat, lon: c.lon });
    out.push({
      id: `cyclone-${c.id}`,
      source: 'cyclone',
      severity,
      title: `${c.name} — Category ${cat}`,
      body: c.windKph ? `${c.windKph.toFixed(0)} km/h sustained winds` : `Tropical cyclone`,
      timestamp: c.advisoryTime ? Date.parse(c.advisoryTime) : Date.now(),
      location: { lat: c.lat, lon: c.lon, label: c.name },
      relevanceScore: relevance(matched),
      acknowledged: false,
      pinned: false,
    });
  }
  if (out.length > 0) unifiedAlertStore.ingest(out);
}
