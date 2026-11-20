export const UKPN_METADATA_URL = 'https://ukpowernetworks.opendatasoft.com/api/explore/v2.1/catalog/datasets/ukpn-live-faults';
export const UKPN_RECORDS_URL = `${UKPN_METADATA_URL}/records?limit=100`;
const MAX_ROWS = 100;
const PUBLICATION_TTL_MS = 15 * 60_000;
const CACHE_TTL_MS = 60_000;
const DEADLINE_MS = 8000;
const EXCLUDED_TYPES = new Map([['Restored', 'restored'], ['Planned', 'planned'], ['Multiple', 'multiple']]);

function failure(reasonCode, now, publishedAt = null) {
  return {
    schemaVersion: 1, provider: 'ukpn', scope: 'ukpn-regional', coverage: 'partial',
    state: reasonCode === 'publication_stale' ? 'stale' : 'unavailable', apiConsistency: 'unverified',
    publishedAt, retrievedAt: new Date(now).toISOString(),
    expiresAt: publishedAt === null ? null : new Date(Date.parse(publishedAt) + PUBLICATION_TTL_MS).toISOString(),
    counts: { raw: 0, accepted: 0, excluded: 0, invalid: 0 },
    exclusions: { restored: 0, planned: 0, multiple: 0, unknown: 0 }, incidents: [], reasonCode,
  };
}

function publicationTime(value) {
  if (typeof value !== 'string') return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match) return null;
  const [, year, month, day, hour, minute, second] = match;
  const date = new Date(`${year}-${month}-${day}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.getUTCDate() !== Number(day)
    || Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function readMetadata(value) {
  const metadata = value?.metas?.default;
  const time = publicationTime(metadata?.data_processed);
  if (time === null || !Number.isSafeInteger(metadata?.records_count) || metadata.records_count < 0) return null;
  return { version: metadata.data_processed, time, count: metadata.records_count };
}

function boundedText(value) {
  if (typeof value !== 'string' || /[\u0000-\u001F\u007F]/.test(value)) return null;
  const text = value.trim();
  return text.length > 0 && text.length <= 80 ? text : null;
}

export function normalizeUkpnSnapshot(metadataBefore, records, metadataAfter, now = Date.now()) {
  const before = readMetadata(metadataBefore);
  const after = readMetadata(metadataAfter);
  if (!before || !after || !records || typeof records !== 'object' || Array.isArray(records)
    || !Array.isArray(records.results)) return failure('malformed_response', now);
  if (before.version !== after.version || before.count !== after.count) return failure('version_changed', now);
  if (before.count > MAX_ROWS || !Number.isSafeInteger(records.total_count)
    || records.total_count !== records.results.length || records.total_count !== before.count) return failure('incomplete_snapshot', now);
  const publishedAt = new Date(before.time).toISOString();
  if (before.time > now) return failure('publication_future', now, publishedAt);
  if (now - before.time >= PUBLICATION_TTL_MS) return failure('publication_stale', now, publishedAt);
  return normalizeRecords(records.results, now, publishedAt);
}

function normalizeIncident(row, id) {
  const customersAffected = row.nocustomeraffected;
  const operatingZone = row.operatingzone == null || row.operatingzone === '' ? undefined : boundedText(row.operatingzone);
  if (id === null || !Number.isSafeInteger(customersAffected) || customersAffected < 0
    || operatingZone === null || (row.restoreddatetime != null && row.restoreddatetime !== '')) return null;
  return { id, customersAffected, ...(operatingZone === undefined ? {} : { operatingZone }) };
}

function normalizeRecords(rows, now, publishedAt) {
  const result = {
    ...failure(null, now, publishedAt), state: 'empty', apiConsistency: 'verified',
    counts: { raw: rows.length, accepted: 0, excluded: 0, invalid: 0 },
  };
  const ids = new Set();
  for (const row of rows) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) { result.counts.invalid += 1; continue; }
    const id = boundedText(row.incidentreference);
    if (id !== null) {
      if (ids.has(id)) return failure('malformed_response', now);
      ids.add(id);
    }
    if (row.powercuttype !== 'Unplanned') {
      result.counts.excluded += 1;
      result.exclusions[EXCLUDED_TYPES.get(row.powercuttype) ?? 'unknown'] += 1;
      continue;
    }
    const incident = normalizeIncident(row, id);
    if (incident === null) { result.counts.invalid += 1; continue; }
    result.incidents.push(incident);
  }
  result.incidents.sort((a, b) => {
    if (a.id === b.id) return 0;
    return a.id < b.id ? -1 : 1;
  });
  result.counts.accepted = result.incidents.length;
  result.state = result.incidents.length > 0 ? 'reported' : 'empty';
  return result;
}

function sourceError(reasonCode) {
  return Object.assign(new Error('UKPN snapshot unavailable'), { reasonCode });
}

export function createUkpnSnapshotProvider({ fetchFn, readJson, clock = Date.now }) {
  let cached = null;
  let inflight = null;

  async function acquire(controller) {
    const deadline = clock() + DEADLINE_MS;
    const timer = setTimeout(() => controller.abort(sourceError('timeout')), DEADLINE_MS);
    let rejectAbort;
    const aborted = new Promise((_, reject) => { rejectAbort = () => reject(controller.signal.reason); });
    controller.signal.addEventListener('abort', rejectAbort, { once: true });
    async function read(url, maxResponseBytes) {
      controller.signal.throwIfAborted();
      const remaining = deadline - clock();
      if (remaining <= 0) throw sourceError('timeout');
      let response;
      try {
        response = await fetchFn(url, {
          headers: { Accept: 'application/json' }, redirect: 'error', signal: controller.signal, maxResponseBytes,
        }, remaining);
      } catch { throw sourceError('upstream_unavailable'); }
      if (response.status === 429) throw sourceError('rate_limited');
      if (!response.ok || response.redirected) throw sourceError('upstream_unavailable');
      try { return await readJson(response, maxResponseBytes); }
      catch { throw sourceError('malformed_response'); }
    }
    const run = async () => {
      const before = await read(UKPN_METADATA_URL, 64 * 1024);
      const metadata = readMetadata(before);
      if (!metadata) throw sourceError('malformed_response');
      if (metadata.count > MAX_ROWS) throw sourceError('incomplete_snapshot');
      const records = await read(UKPN_RECORDS_URL, 512 * 1024);
      const after = await read(UKPN_METADATA_URL, 64 * 1024);
      if (clock() >= deadline) throw sourceError('timeout');
      return normalizeUkpnSnapshot(before, records, after, clock());
    };
    try {
      const result = await Promise.race([run(), aborted]);
      controller.signal.throwIfAborted();
      if ((result.state === 'reported' || result.state === 'empty') && result.counts.invalid === 0) cached = result;
      return result;
    } catch (error) {
      return failure(error?.reasonCode ?? 'upstream_unavailable', clock());
    } finally {
      clearTimeout(timer);
      controller.signal.removeEventListener('abort', rejectAbort);
    }
  }

  return {
    get({ signal } = {}) {
      if (signal?.aborted) return Promise.reject(new DOMException('Request cancelled', 'AbortError'));
      const now = clock();
      if (cached && now >= Date.parse(cached.retrievedAt) && now - Date.parse(cached.retrievedAt) < CACHE_TTL_MS
        && now < Date.parse(cached.expiresAt)) return Promise.resolve(structuredClone(cached));
      if (!inflight) {
        const pending = { controller: new AbortController(), subscribers: 0, settled: false, promise: null };
        inflight = pending;
        pending.promise = acquire(pending.controller).finally(() => {
          pending.settled = true;
          if (inflight === pending) inflight = null;
        });
      }
      const pending = inflight;
      pending.subscribers += 1;
      return new Promise((resolve, reject) => {
        let finished = false;
        const finish = () => {
          if (finished) return false;
          finished = true;
          signal?.removeEventListener('abort', cancel);
          pending.subscribers -= 1;
          return true;
        };
        const cancel = () => {
          if (!finish()) return;
          reject(new DOMException('Request cancelled', 'AbortError'));
          if (pending.subscribers === 0 && !pending.settled) {
            pending.controller.abort();
            if (inflight === pending) inflight = null;
          }
        };
        signal?.addEventListener('abort', cancel, { once: true });
        pending.promise.then(result => { if (finish()) resolve(structuredClone(result)); }, error => { if (finish()) reject(error); });
      });
    },
    reset() {
      cached = null;
      inflight?.controller.abort();
      inflight = null;
    },
  };
}
