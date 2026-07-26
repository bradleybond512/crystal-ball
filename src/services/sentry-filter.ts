interface SentryFrameLike {
  filename?: string | null;
}

interface SentryEventLike {
  event_id?: string;
  exception?: {
    values?: {
      value?: string;
      stacktrace?: { frames?: SentryFrameLike[] };
    }[];
  };
  tags?: Record<string, unknown>;
}

export type SentryFailureCode =
  | 'dynamic-import'
  | 'storage'
  | 'network'
  | 'map-internal';

export interface SentryFailureClassification {
  code: SentryFailureCode;
  sampleRate: number;
}

const MAP_CHUNK = /\/(map|maplibre|deck-stack)-[A-Za-z0-9-]+\.js/;

export function classifySentryFailure(
  event: SentryEventLike,
): SentryFailureClassification | null {
  const exception = event.exception?.values?.[0];
  const message = exception?.value ?? '';
  const frames = exception?.stacktrace?.frames ?? [];

  if (/dynamically imported module|Importing a module script failed/i.test(message)) {
    return { code: 'dynamic-import', sampleRate: 1 };
  }
  if (/Indexed Database|QuotaExceededError|objectStoreNames|createObjectStore|database connection is closing/i.test(message)) {
    return { code: 'storage', sampleRate: 1 };
  }
  if (
    message.startsWith('TypeError:')
    && frames.length > 0
    && frames.filter((frame) => frame.filename).every((frame) => MAP_CHUNK.test(frame.filename ?? ''))
  ) {
    return { code: 'map-internal', sampleRate: 0.1 };
  }
  if (/Failed to fetch|Load failed|NetworkError|Network request failed|signal timed out|Operation timed out/i.test(message)) {
    return { code: 'network', sampleRate: 0.05 };
  }
  return null;
}

export function stableSample(key: string, rate: number): boolean {
  if (rate >= 1) return true;
  if (rate <= 0) return false;
  let hash = 2_166_136_261;
  for (let i = 0; i < key.length; i += 1) {
    hash ^= key.codePointAt(i) ?? 0;
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0) / 4_294_967_296 < rate;
}

export function filterSentryEvent<T extends SentryEventLike>(event: T): T | null {
  const classification = classifySentryFailure(event);
  if (!classification) return event;
  const sampleKey = event.event_id
    ?? event.exception?.values?.[0]?.value
    ?? classification.code;
  if (!stableSample(sampleKey, classification.sampleRate)) return null;
  return {
    ...event,
    tags: {
      ...event.tags,
      reason_code: classification.code,
    },
  };
}
