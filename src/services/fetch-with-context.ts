export async function fetchWithContext(
  context: string,
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  try {
    return await globalThis.fetch(input, init);
  } catch (error) {
    if (error instanceof TypeError && error.message === 'Load failed') {
      const contextualError = new Error(`Failed to fetch ${context}: ${String(error)}`);
      (contextualError as Error & { cause?: unknown }).cause = error;
      throw contextualError;
    }
    throw error;
  }
}
