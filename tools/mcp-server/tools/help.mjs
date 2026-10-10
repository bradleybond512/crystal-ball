import { z } from 'zod';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { join, dirname, relative, isAbsolute, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TOOL_CATALOG, TOOL_INDEX } from '../tool-registry.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = join(__dirname, '..');
const DOC_SLUG = /^[a-z][a-z0-9_-]*$/;

function makeResponse(summary, data, sources, warnings = []) {
  return { summary, data, sources, warnings, timestamp: new Date().toISOString(), healthy: true };
}

function admittedIdentifier(identifier, category) {
  if (typeof identifier !== 'string' || !DOC_SLUG.test(identifier)) return false;
  if (category === 'tools') return Object.hasOwn(TOOL_CATALOG, identifier);
  return TOOL_INDEX[category].includes(identifier);
}

function containedBy(root, target) {
  const child = relative(root, target);
  return child !== '' && child !== '..' && !child.startsWith(`..${sep}`) && !isAbsolute(child);
}

function checkedDirectory(parent, name) {
  const expected = join(parent, name);
  const stat = lstatSync(expected);
  if (stat.isSymbolicLink() || !stat.isDirectory()) return null;
  const canonical = realpathSync(expected);
  if (!containedBy(parent, canonical) || dirname(canonical) !== parent || canonical !== expected) return null;
  return canonical;
}

// Trust only admitted, regular resources below the installed package root.
// An install/ancestor symlink is allowed; docs/category/file redirects are not.
function loadJSON(category, identifier) {
  if (!admittedIdentifier(identifier, category)) return null;
  try {
    const packageRoot = realpathSync(PACKAGE_ROOT);
    const docs = checkedDirectory(packageRoot, 'docs');
    if (!docs) return null;
    const directory = checkedDirectory(docs, category);
    if (!directory) return null;
    const expected = join(directory, `${identifier}.json`);
    const stat = lstatSync(expected);
    if (stat.isSymbolicLink() || !stat.isFile()) return null;
    const filename = realpathSync(expected);
    if (!containedBy(packageRoot, filename) || !containedBy(docs, filename)
      || !containedBy(directory, filename) || dirname(filename) !== directory || filename !== expected) return null;
    return JSON.parse(readFileSync(filename, 'utf8'));
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
      const doc = loadJSON('tools', tool);
      if (!doc && admittedIdentifier(tool, 'tools')) {
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
      const doc = loadJSON('topics', topic);
      if (!doc) return makeResponse(`No topic guide found for "${topic}".`, {}, [], [`docs/topics/${topic}.json not found`]);
      return makeResponse(`Topic: ${doc.title}`, doc, []);
    }
    if (examples) {
      const doc = loadJSON('examples', examples);
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
