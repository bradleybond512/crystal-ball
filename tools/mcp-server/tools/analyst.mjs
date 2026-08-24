import { z } from 'zod';
import { safetyEnvelope } from '../safety-policy.mjs';

/**
 * Analyst tools — expose the renderer-side reasoning layer
 * (analyst-loop, mode-forecast, hypothesis-threads, hypothesis-entities,
 * hypothesis-accuracy) via the in-memory mirror at /api/analyst-state.
 */

export const schemas = {
  get_analyst_hypotheses: {
    description:
      'Top ranked cross-domain hypotheses produced by the renderer\'s analyst loop. ' +
      'Each hypothesis has confidence, escalation risk, evidence pointers, and ' +
      'thread continuity (cycle count, trajectory) when available. Returns an ' +
      'unavailable response if Crystal Ball is not running or has not yet pushed.',
    inputSchema: z.object({
      limit: z.number().optional().describe('Max hypotheses to return (default: 8)'),
      min_risk: z.enum(['low', 'moderate', 'high', 'critical']).optional()
        .describe('Minimum escalation risk to include (default: low)'),
    }),
  },
  get_mode_forecast: {
    description:
      'Per-domain pressure forecast (finance, security, disaster, cyber) and ' +
      'active posture advisories. Pressures are EWMA-smoothed [0,1]; ' +
      'advisories include slope and ETA-to-threshold projections.',
    inputSchema: z.object({}),
  },
  get_analyst_accuracy: {
    description:
      'Outcome-graded accuracy of the analyst loop, by hypothesis kind. Hits ' +
      'mean the underlying evidence escalated within a 2-hour window; misses ' +
      'mean it fizzled. Useful for deciding how much to trust each hypothesis kind.',
    inputSchema: z.object({}),
  },
  get_hot_entities: {
    description:
      'Entities (countries, tickers, CVEs, callsigns, regions) appearing in 2+ ' +
      'concurrent analyst hypotheses. Use this to find cross-cutting threats ' +
      'before drilling into individual hypotheses.',
    inputSchema: z.object({}),
  },
  submit_hypothesis_feedback: {
    description:
      'Record thumbs-up or thumbs-down on a specific analyst hypothesis. Feedback ' +
      'is keyed by hypothesis signature (kind + evidence sources + region) so it ' +
      'generalizes across cycles. Pushes a command to the renderer which applies it. ' +
      'Reference a hypothesis by either hypothesis_id (from get_analyst_hypotheses) ' +
      'or signature.',
    inputSchema: z.object({
      vote: z.enum(['up', 'down']).describe('up = useful, down = noise'),
      hypothesis_id: z.string().optional().describe('ID from get_analyst_hypotheses'),
      signature: z.string().optional().describe('Stable signature string'),
      note: z.string().optional().describe('Optional justification (audit only, not persisted in ranking)'),
    }),
  },
  dismiss_hypothesis: {
    description:
      'Hide a hypothesis from the HUD and from ranking for 24 hours. Use when a ' +
      'hypothesis is clearly wrong or already addressed. Dismissal is keyed by ' +
      'signature so it applies to future cycles of the same pattern too.',
    inputSchema: z.object({
      hypothesis_id: z.string().optional(),
      signature: z.string().optional(),
      note: z.string().optional(),
    }),
  },
  run_skeptic_now: {
    description:
      'Request an immediate skeptic pass on a hypothesis, bypassing the opt-in ' +
      'toggle and cooldown. Useful when you want a second opinion before acting. ' +
      'Requires the aiClaude feature to be available in the running app.',
    inputSchema: z.object({
      hypothesis_id: z.string().optional(),
      signature: z.string().optional(),
    }),
  },
  get_reasoning_debug_log: {
    description:
      'Ring-buffer log of the last ~50 reasoning-layer events (bootstrap, ' +
      'IDB ops, LLM calls, commands, errors). Use this for post-mortem ' +
      'debugging or to watch a feature in real time. Supports filtering ' +
      'by level (info / warn / error) and category.',
    inputSchema: z.object({
      level: z.enum(['info', 'warn', 'error']).optional().describe('Minimum level to include'),
      category: z.enum(['bootstrap', 'idb', 'llm', 'events', 'commands', 'hud', 'hypothesis', 'forecast', 'budget', 'sidecar', 'other']).optional().describe('Filter to one category'),
      limit: z.number().optional().describe('Max entries (default 20, max 100)'),
    }),
  },
  get_reasoning_metrics: {
    description:
      'Latency histograms (p50/p95/p99) and counters for every named ' +
      'reasoning operation (analyst-cycle, forecast-cycle, idb.get, ' +
      'idb.put, llm.local, llm.cloud-agent, cmd-poll). Read this to ' +
      'understand throughput, error rates, and where time is being spent.',
    inputSchema: z.object({}),
  },
  get_pipeline_trace: {
    description:
      "Audit trail of facts (alerts, events) tracked through the intelligence " +
      "pipeline — ingested → scored → clustered → evaluated → routed/dropped. " +
      "Use to debug why a fact did/didn't trigger a notification. " +
      "Filter by domain (e.g. 'weather') or stalledOnly=true for stuck facts.",
    inputSchema: z.object({
      domain: z.string().optional().describe('Filter by domain (e.g. "weather", "shortage")'),
      stalledOnly: z.boolean().optional().describe('Return only entries stuck before routed/dropped (default false)'),
      limit: z.number().optional().describe('Max entries to return (default 25)'),
    }),
  },
};

const RISK_RANK = { low: 0, moderate: 1, high: 2, critical: 3 };

function unavailable(state, sectionLabel) {
  return {
    available: false,
    summary:
      `${sectionLabel} not available. ${state?.message || 'Crystal Ball app is not running or has not pushed analyst state yet.'}`,
    timestamp: new Date().toISOString(),
  };
}

export function makeAnalystTools(client) {
  async function loadState() {
    return client.get('/api/analyst-state');
  }

  function derivedSafety(state, algorithmId) {
    return safetyEnvelope(state?.algorithmDiagnostics?.health, algorithmId);
  }

  function quarantineResponse(state, algorithmId, emptyField) {
    const safety = derivedSafety(state, algorithmId);
    if (!safety.outputAlgorithm.quarantined) return null;
    return {
      available: false,
      quarantined: true,
      summary: `${algorithmId} output is quarantined: ${safety.outputAlgorithm.reason}`,
      safety,
      [emptyField]: [],
      timestamp: new Date().toISOString(),
    };
  }

  return {
    async get_analyst_hypotheses(args = {}) {
      const state = await loadState();
      if (!state?.available) return unavailable(state, 'Hypotheses');
      const blocked = quarantineResponse(state, 'analyst-loop', 'hypotheses');
      if (blocked) return blocked;
      const limit = typeof args.limit === 'number' && args.limit > 0 ? args.limit : 8;
      const minRank = RISK_RANK[args.min_risk] ?? 0;
      const all = state.analyst?.hypotheses ?? [];
      const filtered = all
        .filter(h => (RISK_RANK[h.risk] ?? 0) >= minRank)
        .slice(0, limit);

      const threadsBySig = new Map((state.threads ?? []).map(t => [t.signature, t]));
      const enriched = filtered.map(h => {
        // Match thread by kind + region (signatureFor uses kind|sources|region; we
        // don't have sources here but kind+region narrows it for display purposes).
        const thread = [...threadsBySig.values()].find(t => t.kind === h.kind && (t.region ?? '*') === (h.region ?? '*'));
        return {
          id: h.id,
          kind: h.kind,
          risk: h.risk,
          confidence: h.confidence,
          region: h.region,
          statement: h.statement,
          evidence: (h.evidence ?? []).slice(0, 6).map(e => ({
            source: e.source,
            label: e.label,
            panel: e.panelId,
          })),
          thread: thread ? {
            cycles: thread.cycleCount,
            trajectory: thread.trajectory,
            peakRisk: thread.peakRisk,
            firstSeenAgoMs: Date.now() - thread.firstSeen,
          } : null,
        };
      });

      return {
        available: true,
        summary:
          `${enriched.length} hypotheses returned (of ${all.length}). ` +
          `Snapshot age: ${Math.round((state.ageMs ?? 0) / 1000)}s. AI-enriched: ${state.analyst?.aiEnriched ? 'yes' : 'no'}.`,
        stale: state.stale === true,
        ghostMode: state.ghostMode === true,
        hypotheses: enriched,
        entityCount: state.entityCount ?? 0,
        safety: derivedSafety(state, 'analyst-loop'),
        timestamp: new Date().toISOString(),
      };
    },

    async get_mode_forecast() {
      const state = await loadState();
      if (!state?.available) return unavailable(state, 'Mode forecast');
      const forecast = state.forecast;
      if (!forecast) return unavailable(state, 'Mode forecast');
      const blocked = quarantineResponse(state, 'mode-forecast', 'advisories');
      if (blocked) return { ...blocked, pressure: {} };
      return {
        available: true,
        summary:
          `Pressure — finance:${(forecast.pressure?.finance ?? 0).toFixed(2)} ` +
          `security:${(forecast.pressure?.security ?? 0).toFixed(2)} ` +
          `disaster:${(forecast.pressure?.disaster ?? 0).toFixed(2)} ` +
          `cyber:${(forecast.pressure?.cyber ?? 0).toFixed(2)}. ` +
          `${(forecast.advisories ?? []).length} active advisories.`,
        stale: state.stale === true,
        ghostMode: state.ghostMode === true,
        pressure: forecast.pressure ?? {},
        advisories: forecast.advisories ?? [],
        safety: derivedSafety(state, 'mode-forecast'),
        timestamp: new Date().toISOString(),
      };
    },

    async get_analyst_accuracy() {
      const state = await loadState();
      if (!state?.available) return unavailable(state, 'Analyst accuracy');
      const blocked = quarantineResponse(state, 'hypothesis-accuracy', 'rows');
      if (blocked) return blocked;
      const rows = state.accuracy ?? [];
      if (rows.length === 0) {
        return {
          available: true,
          summary: 'No graded hypotheses yet — accuracy needs ~2 hours of cycles to populate.',
          rows: [],
          safety: derivedSafety(state, 'hypothesis-accuracy'),
          timestamp: new Date().toISOString(),
        };
      }
      const summary = rows
        .map(r => `${r.kind}: ${(r.ratio * 100).toFixed(0)}% (${r.hits + r.misses})`)
        .join('; ');
      return {
        available: true,
        summary,
        rows,
        safety: derivedSafety(state, 'hypothesis-accuracy'),
        timestamp: new Date().toISOString(),
      };
    },

    async get_hot_entities() {
      const state = await loadState();
      if (!state?.available) return unavailable(state, 'Hot entities');
      const blocked = quarantineResponse(state, 'analyst-loop', 'entities');
      if (blocked) return { ...blocked, totalEntities: 0 };
      const entities = state.hotEntities ?? [];
      return {
        available: true,
        summary: entities.length === 0
          ? 'No entities currently appear in multiple concurrent hypotheses.'
          : `${entities.length} hot entities — ${entities.slice(0, 5).map(e => `${e.entity}(${e.hypothesisCount})`).join(', ')}.`,
        entities,
        totalEntities: state.entityCount ?? 0,
        safety: derivedSafety(state, 'analyst-loop'),
        timestamp: new Date().toISOString(),
      };
    },

    async submit_hypothesis_feedback(args = {}) {
      if (!args.hypothesis_id && !args.signature) {
        return { error: 'Provide either hypothesis_id or signature.' };
      }
      const kind = args.vote === 'down' ? 'thumbs_down' : 'thumbs_up';
      const res = await client.post('/api/analyst-commands', {
        kind,
        hypothesisId: args.hypothesis_id ?? null,
        signature: args.signature ?? null,
        note: args.note ?? null,
      });
      if (res?.error) return { submitted: false, error: res.error };
      return {
        submitted: true,
        commandId: res.id,
        summary:
          `Feedback queued (${kind}). The renderer drains the queue every ~10s; ` +
          'the feedback will take effect on the next analyst cycle.',
      };
    },

    async dismiss_hypothesis(args = {}) {
      if (!args.hypothesis_id && !args.signature) {
        return { error: 'Provide either hypothesis_id or signature.' };
      }
      const res = await client.post('/api/analyst-commands', {
        kind: 'dismiss',
        hypothesisId: args.hypothesis_id ?? null,
        signature: args.signature ?? null,
        note: args.note ?? null,
      });
      if (res?.error) return { submitted: false, error: res.error };
      return {
        submitted: true,
        commandId: res.id,
        summary: 'Dismissal queued. Hypothesis will be hidden from HUD + ranking for 24h.',
      };
    },

    async run_skeptic_now(args = {}) {
      if (!args.hypothesis_id && !args.signature) {
        return { error: 'Provide either hypothesis_id or signature.' };
      }
      const res = await client.post('/api/analyst-commands', {
        kind: 'run_skeptic',
        hypothesisId: args.hypothesis_id ?? null,
        signature: args.signature ?? null,
      });
      if (res?.error) return { submitted: false, error: res.error };
      return {
        submitted: true,
        commandId: res.id,
        summary:
          'Skeptic pass queued. The renderer will run a review on the next poll ' +
          '(~10s). Fetch the note via get_analyst_hypotheses afterwards.',
      };
    },

    async get_reasoning_debug_log(args = {}) {
      const state = await loadState();
      if (!state?.available) return unavailable(state, 'Reasoning debug log');
      const log = Array.isArray(state.debugLog) ? state.debugLog : [];
      const levelRank = { info: 0, warn: 1, error: 2 };
      const minRank = args.level ? (levelRank[args.level] ?? 0) : 0;
      const filtered = log
        .filter(e => (levelRank[e.level] ?? 0) >= minRank)
        .filter(e => !args.category || e.category === args.category);
      const limit = Math.min(100, Math.max(1, typeof args.limit === 'number' ? args.limit : 20));
      const tail = filtered.slice(-limit).reverse(); // newest first
      const errorCounts = state.debugErrorCounts || {};
      const totalErrors = Object.values(errorCounts).reduce((a, b) => a + b, 0);
      return {
        available: true,
        summary:
          `${tail.length} entries (of ${log.length} total in ring buffer). ` +
          `${totalErrors} errors logged since last clear.`,
        errorCounts,
        stale: state.stale === true,
        entries: tail,
        timestamp: new Date().toISOString(),
      };
    },

    async get_reasoning_metrics() {
      const state = await loadState();
      if (!state?.available) return unavailable(state, 'Reasoning metrics');
      const metrics = state.metrics;
      if (!metrics) {
        return {
          available: true,
          summary: 'No metrics snapshot yet — the renderer pushes one per analyst cycle.',
          latencies: {},
          counters: {},
          timestamp: new Date().toISOString(),
        };
      }
      const latencyKeys = Object.keys(metrics.latencies ?? {}).sort();
      const summary = latencyKeys.length === 0
        ? 'No latency samples yet.'
        : `${latencyKeys.length} ops tracked. ` +
          latencyKeys.slice(0, 3).map(k => {
            const s = metrics.latencies[k];
            return `${k}: p50=${s.p50.toFixed(0)}ms p95=${s.p95.toFixed(0)}ms`;
          }).join(' · ');
      return {
        available: true,
        summary,
        stale: state.stale === true,
        latencies: metrics.latencies ?? {},
        counters: metrics.counters ?? {},
        snapshotTimestamp: new Date(metrics.timestamp).toISOString(),
        timestamp: new Date().toISOString(),
      };
    },

    async get_pipeline_trace(args = {}) {
      const state = await loadState();
      if (!state?.available) return unavailable(state, 'Pipeline trace');
      const trace = state.pipelineTrace;
      if (!trace) {
        return {
          available: true,
          summary: 'No pipeline trace data yet — the renderer pushes one per analyst cycle.',
          entries: [],
          total: 0,
          timestamp: new Date().toISOString(),
        };
      }
      const stalledOnly = args.stalledOnly === true;
      const domain = typeof args.domain === 'string' ? args.domain : null;
      const limit = Math.min(100, Math.max(1, typeof args.limit === 'number' ? args.limit : 25));
      const TEN_MIN_MS = 10 * 60 * 1000;
      const now = Date.now();
      let entries = trace.entries ?? [];
      if (domain) entries = entries.filter(e => e.domain === domain);
      if (stalledOnly) {
        entries = entries.filter(e => {
          const hasTerminal = e.events.some(ev => ev.stage === 'routed' || ev.stage === 'dropped');
          return !hasTerminal && (now - e.createdAt) > TEN_MIN_MS;
        });
      }
      const total = entries.length;
      const tail = entries.slice(-limit).reverse();
      return {
        available: true,
        summary: tail.length + ' of ' + total + ' trace entries (domain=' + (domain ?? 'all') + ', stalledOnly=' + stalledOnly + ').',
        stale: state.stale === true,
        total,
        entries: tail,
        timestamp: new Date().toISOString(),
      };
    },
  };
}
