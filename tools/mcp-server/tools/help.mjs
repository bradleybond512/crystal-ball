import { z } from 'zod';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TOOL_CATALOG, TOOL_INDEX } from '../tool-registry.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DOCS_DIR = join(__dirname, '..', 'docs');

function makeResponse(summary, data, sources, warnings = []) {
  return { summary, data, sources, warnings, timestamp: new Date().toISOString(), healthy: true };
}

function loadJSON(relPath) {
  try {
    return JSON.parse(readFileSync(join(DOCS_DIR, relPath), 'utf8'));
  } catch {
    return null;
  }
}

export function makeHelpTools() {
  async function help({ tool, topic, examples }) {
    if (!tool && !topic && !examples) {
      return makeResponse('Crystal Ball MCP Tools — use help({ tool: "name" }) for details on any tool.', TOOL_INDEX, []);
    }
    if (tool) {
      const doc = loadJSON(`tools/${tool}.json`);
      if (!doc && TOOL_CATALOG[tool]) {
        return makeResponse(`Generated man page for ${tool}.`, {
          name: tool,
          description: TOOL_CATALOG[tool].description,
          category: TOOL_CATALOG[tool].category,
          annotations: TOOL_CATALOG[tool].annotations,
        }, [], [`Detailed examples for ${tool} are not yet available.`]);
      }
      if (!doc) return makeResponse(`No man page found for "${tool}". Use help() to see all tools.`, {}, [], [`Unknown tool: ${tool}`]);
      return makeResponse(`Man page for ${tool}.`, doc, []);
    }
    if (topic) {
      const doc = loadJSON(`topics/${topic}.json`);
      if (!doc) return makeResponse(`No topic guide found for "${topic}".`, {}, [], [`docs/topics/${topic}.json not found`]);
      return makeResponse(`Topic: ${doc.title}`, doc, []);
    }
    if (examples) {
      const doc = loadJSON(`examples/${examples}.json`);
      if (!doc) return makeResponse(`No examples found for "${examples}".`, {}, [], [`docs/examples/${examples}.json not found`]);
      return makeResponse(`Examples: ${doc.title}`, doc, []);
    }
    return makeResponse('Use help(), help({ tool }), help({ topic }), or help({ examples }).', {}, []);
  }
  return { help };
}

export const schemas = {
  help: {
    description: 'Built-in documentation: tool man pages, conceptual guides, and example cookbooks. Call with no args for a full tool index.',
    inputSchema: z.object({
      tool: z.string().optional().describe('Tool name for its man page (e.g., "correlate", "query_raw")'),
      topic: z.string().optional().describe('Conceptual topic: "getting-started", "watchlists", "alerts", "correlation", "sentinel", "capabilities"'),
      examples: z.string().optional().describe('Example cookbook: "cross-domain", "time-series", "watchlists", "alert-rules"'),
    }),
  },
};
