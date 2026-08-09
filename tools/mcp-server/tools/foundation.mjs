import { z } from 'zod';
import { validateAgentQueryRoutes } from '../route-policy.mjs';

function makeResponse(summary, data, sources, warnings = [], healthy = true) {
  return {
    summary,
    data,
    sources,
    warnings,
    timestamp: new Date().toISOString(),
    healthy,
  };
}

function deniedResponse(endpoint) {
  return makeResponse(
    `Query denied for ${endpoint}.`,
    { error: 'route_not_approved', endpoint },
    [],
    [`${endpoint} is not approved for agent queries. Add it to the reviewed route catalog before use.`],
    false,
  );
}

function resolvePrevRefs(value, prevResults) {
  if (typeof value !== 'string') return value;
  return value.replace(/\$prev\[(\d+)\]((?:\.\w+(?:\[(\d+)\])?)*)/g, (_match, idx, pathStr) => {
    let current = prevResults[parseInt(idx)];
    const segments = pathStr.split('.').filter(Boolean);
    for (const seg of segments) {
      if (current == null) return 'null';
      const arrMatch = seg.match(/^(\w+)\[(\d+)\]$/);
      if (arrMatch) {
        current = current[arrMatch[1]];
        if (Array.isArray(current)) current = current[parseInt(arrMatch[2])];
        else return 'null';
      } else {
        current = current[seg];
      }
    }
    return current ?? 'null';
  });
}

function findArray(obj) {
  if (Array.isArray(obj)) return obj;
  if (obj && typeof obj === 'object') {
    for (const val of Object.values(obj)) {
      if (Array.isArray(val)) return val;
    }
  }
  return [];
}

export function makeFoundationTools(client) {
  async function query_raw({ endpoint, params, offset, limit } = {}) {
    const policy = validateAgentQueryRoutes([endpoint]);
    if (!policy.allowed) return deniedResponse(policy.denied);

    const merged = { ...params };
    if (offset != null) merged.offset = offset;
    if (limit != null) merged.limit = limit;

    const data = await client.get(endpoint, Object.keys(merged).length ? merged : undefined);
    const warnings = [];
    if (data?.error) warnings.push(`${endpoint}: ${data.error}`);

    return makeResponse(
      `Raw query to ${endpoint}`,
      data,
      [endpoint],
      warnings,
    );
  }

  async function chain_query({ steps }) {
    const policy = validateAgentQueryRoutes(steps.map((step) => step.endpoint));
    if (!policy.allowed) return deniedResponse(policy.denied);

    const results = [];
    const resolved_params = [];
    const warnings = [];
    const sources = [];

    for (const step of steps) {
      const resolvedP = {};
      if (step.params) {
        for (const [k, v] of Object.entries(step.params)) {
          resolvedP[k] = resolvePrevRefs(v, results);
        }
      }
      resolved_params.push(resolvedP);
      sources.push(step.endpoint);

      const data = await client.get(step.endpoint, Object.keys(resolvedP).length ? resolvedP : undefined);
      if (data?.error) warnings.push(`${step.endpoint}: ${data.error}`);
      results.push(data);
    }

    return makeResponse(
      `Chained ${steps.length} queries: ${sources.join(' -> ')}`,
      { results, resolved_params },
      sources,
      warnings,
    );
  }

  async function compare_snapshots({ endpoint, before_params, after_params }) {
    const policy = validateAgentQueryRoutes([endpoint]);
    if (!policy.allowed) return deniedResponse(policy.denied);

    const beforeData = await client.get(endpoint, before_params);
    const afterData = await client.get(endpoint, after_params);

    const warnings = [];
    if (beforeData?.error) warnings.push(`before: ${beforeData.error}`);
    if (afterData?.error) warnings.push(`after: ${afterData.error}`);

    const beforeArr = findArray(beforeData);
    const afterArr = findArray(afterData);

    const beforeSet = new Set(beforeArr.map(i => JSON.stringify(i)));
    const afterSet = new Set(afterArr.map(i => JSON.stringify(i)));

    const appeared = afterArr.filter(i => !beforeSet.has(JSON.stringify(i)));
    const disappeared = beforeArr.filter(i => !afterSet.has(JSON.stringify(i)));

    return makeResponse(
      `Snapshot diff on ${endpoint}: ${appeared.length} appeared, ${disappeared.length} disappeared`,
      { appeared, disappeared, before_count: beforeArr.length, after_count: afterArr.length },
      [endpoint],
      warnings,
    );
  }

  return { query_raw, chain_query, compare_snapshots };
}

export const schemas = {
  query_raw: {
    description: 'Direct access to an approved read-only sidecar endpoint with parameter passthrough and pagination.',
    inputSchema: z.object({
      endpoint: z.string().describe('Approved read-only sidecar API path (e.g., "/api/acled-events")'),
      params: z.record(z.string(), z.any()).optional().describe('Query parameters to pass through'),
      offset: z.number().optional().describe('Pagination offset'),
      limit: z.number().optional().describe('Max results to return'),
    }),
  },
  chain_query: {
    description: 'Sequential approved read-only queries where each step can reference prior results via $prev[N].field.path syntax.',
    inputSchema: z.object({
      steps: z.array(z.object({
        endpoint: z.string().describe('Sidecar API path'),
        params: z.record(z.string(), z.any()).optional().describe('Query params — use $prev[N].field.path to reference prior step results'),
      })).describe('Array of query steps executed in order'),
    }),
  },
  compare_snapshots: {
    description: 'Structured diff between two queries to the same endpoint with different parameters. Returns appeared/disappeared items.',
    inputSchema: z.object({
      endpoint: z.string().describe('Sidecar API path'),
      before_params: z.record(z.string(), z.any()).describe('Parameters for the "before" query'),
      after_params: z.record(z.string(), z.any()).describe('Parameters for the "after" query'),
    }),
  },
};
