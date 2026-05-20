/**
 * Financial domain mission bridges.
 *
 * Normalizes market crash signals, credit default/CDS spread widening, and
 * currency crisis events into NormalizedFeedEvent shape. All three bridges
 * self-register with MissionBridgeRegistry at module load.
 */

import {
  MissionBridgeBase,
  getMissionBridgeRegistry,
  type FeedSeverity,
  type NormalizedFeedEvent,
} from './mission-bridge-core';

// ── Helpers ───────────────────────────────────────────────────────────────

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function num(v: unknown, fallback: number): number {
  return typeof v === 'number' ? v : fallback;
}

// ── MarketCrashBridge ─────────────────────────────────────────────────────

function dropToSeverity(dropPct: number): FeedSeverity {
  if (dropPct > 10) return 4;
  if (dropPct > 5) return 3;
  if (dropPct > 2) return 2;
  return 1;
}

export class MarketCrashBridge extends MissionBridgeBase {
  readonly domain = 'financial';
  readonly feedId  = 'market-crash';

  normalize(raw: Record<string, unknown>): NormalizedFeedEvent | null {
    const id = str(raw.id);
    if (id.length === 0) return null;

    const dropPct = Math.abs(num(raw.dropPct, 0));
    const severity = dropToSeverity(dropPct);
    const index = str(raw.index) || 'equity index';
    const description = str(raw.description) || `${index} dropped ${dropPct.toFixed(1)}% in a single session`;
    const timestamp = num(raw.timestamp, Date.now());
    return { id, severity, description, timestamp, raw };
  }
}

// ── CreditDefaultBridge ───────────────────────────────────────────────────

function spreadToSeverity(spreadBps: number): FeedSeverity {
  if (spreadBps > 500) return 4;
  if (spreadBps > 200) return 3;
  if (spreadBps > 100) return 2;
  return 1;
}

export class CreditDefaultBridge extends MissionBridgeBase {
  readonly domain = 'financial';
  readonly feedId  = 'credit-default';

  normalize(raw: Record<string, unknown>): NormalizedFeedEvent | null {
    const id = str(raw.id);
    if (id.length === 0) return null;

    const spreadBps = num(raw.spreadBps, 0);
    const severity = spreadToSeverity(spreadBps);
    const entity = str(raw.entity) || 'credit entity';
    const description = str(raw.description) || `CDS spread for ${entity} widened to ${spreadBps}bps`;
    const timestamp = num(raw.timestamp, Date.now());
    return { id, severity, description, timestamp, raw };
  }
}

// ── CurrencyCrisisBridge ──────────────────────────────────────────────────

function devaluationToSeverity(pct: number): FeedSeverity {
  if (pct > 30) return 4;
  if (pct > 15) return 3;
  if (pct > 5) return 2;
  return 1;
}

export class CurrencyCrisisBridge extends MissionBridgeBase {
  readonly domain = 'financial';
  readonly feedId  = 'currency-crisis';

  normalize(raw: Record<string, unknown>): NormalizedFeedEvent | null {
    const id = str(raw.id);
    if (id.length === 0) return null;

    const devaluationPct = Math.abs(num(raw.devaluationPct, 0));
    const severity = devaluationToSeverity(devaluationPct);
    const currency = str(raw.currency) || 'currency';
    const description = str(raw.description) || `${currency} devalued ${devaluationPct.toFixed(1)}% rapidly`;
    const timestamp = num(raw.timestamp, Date.now());
    return { id, severity, description, timestamp, raw };
  }
}

// ── Auto-registration ─────────────────────────────────────────────────────

getMissionBridgeRegistry().register(new MarketCrashBridge());
getMissionBridgeRegistry().register(new CreditDefaultBridge());
getMissionBridgeRegistry().register(new CurrencyCrisisBridge());
