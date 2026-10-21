import { z } from 'zod';
import { TOOL_CATALOG } from './tool-catalog.mjs';

export { TOOL_CATALOG, TOOL_INDEX, TOOL_REFERENCE, permissionFromAnnotations, catalogSummary } from './tool-catalog.mjs';

export function createToolConfig(name, config) {
  const metadata = TOOL_CATALOG[name];
  if (!metadata) throw new Error(`Tool "${name}" is not declared in the canonical registry.`);
  return {
    ...config,
    annotations: metadata.annotations,
    outputSchema: { result: z.unknown() },
  };
}
