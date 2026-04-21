import { z } from 'zod';

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

  return {
    async get_analyst_hypotheses(args = {}) {
      const state = await loadState();
      if (!state?.available) return unavailable(state, 'Hypotheses');
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
        timestamp: new Date().toISOString(),
      };
    },

    async get_mode_forecast() {
      const state = await loadState();
      if (!state?.available) return unavailable(state, 'Mode forecast');
      const forecast = state.forecast;
      if (!forecast) return unavailable(state, 'Mode forecast');
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
        timestamp: new Date().toISOString(),
      };
    },

    async get_analyst_accuracy() {
      const state = await loadState();
      if (!state?.available) return unavailable(state, 'Analyst accuracy');
      const rows = state.accuracy ?? [];
      if (rows.length === 0) {
        return {
          available: true,
          summary: 'No graded hypotheses yet — accuracy needs ~2 hours of cycles to populate.',
          rows: [],
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
        timestamp: new Date().toISOString(),
      };
    },

    async get_hot_entities() {
      const state = await loadState();
      if (!state?.available) return unavailable(state, 'Hot entities');
      const entities = state.hotEntities ?? [];
      return {
        available: true,
        summary: entities.length === 0
          ? 'No entities currently appear in multiple concurrent hypotheses.'
          : `${entities.length} hot entities — ${entities.slice(0, 5).map(e => `${e.entity}(${e.hypothesisCount})`).join(', ')}.`,
        entities,
        totalEntities: state.entityCount ?? 0,
        timestamp: new Date().toISOString(),
      };
    },
  };
}
