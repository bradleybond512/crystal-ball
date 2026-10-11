/** Bounded, scored-only capture before working-ledger eviction. No ledger imports. */
import { isDesktopRuntime } from '../runtime';
import {
  canonicalJson, evidenceDraftRefusal, projectEvidenceDraft, runEvidenceProjection, sha256Hex, snapshotEvidence, validEvidencePayload,
  type EvidenceCapture, type EvidenceDraft, type EvidenceEntry, type EvidenceKind, type EvidencePayload,
} from './evidence-projection';

export const OUTBOX_NAMESPACE = 'crystalball-evidence-outbox-v1:';
export const OUTBOX_SLOTS = 4096;
export const OUTBOX_STORAGE_BYTES = 2 * 1024 * 1024;
export const OUTBOX_TRANSIENT_BYTES = 2 * 1024 * 1024;
export const OUTBOX_INPUT_BYTES = 8 * 1024;
export const OUTBOX_PAYLOAD_BYTES = 4 * 1024;
export const OUTBOX_WORKERS = 4;
const DIAGNOSTICS_RESERVATION = 4096;
const DIAGNOSTICS_KEY = `${OUTBOX_NAMESPACE}diagnostics`;
const KINDS: ReadonlySet<EvidenceKind> = new Set(['forecast', 'alert-outcome', 'ema-forecast', 'ema-forecast-totals']);
const encoder = new TextEncoder();
const bytes = (value: string) => encoder.encode(value).byteLength;
const slotKey = (slot: number) => `${OUTBOX_NAMESPACE}slot:${slot}`;

export type CaptureReason = 'capacity' | 'storage-bytes' | 'transient-bytes' | 'input-size' | 'payload-size'
  | 'invalid-input' | 'storage-unavailable' | 'storage-quota' | 'projection-failed' | 'interrupted'
  | 'invalid-persisted' | 'rejected';
export interface CaptureResult {
  status: 'admitted' | 'already-pending' | 'refused' | 'inactive';
  reason?: CaptureReason;
}
export interface EvidenceReceipt extends EvidenceEntry { readonly slot: number; readonly token: string; readonly admittedAt: number }
export interface OutboxDiagnostics {
  savedAwaitingSync: number;
  hashing: number;
  awaitingStorage: number;
  terminalBlocked: number;
  refused: number;
  interrupted: number;
  quarantined: number;
  blocked: boolean;
  diagnosticsUnsaved: boolean;
  storageFailures: number;
  saturated: boolean;
  lastReason: CaptureReason | null;
  lastRefusedAt: number | null;
  byReason: Partial<Record<CaptureReason, number>>;
  byKind: Partial<Record<EvidenceKind, number>>;
  journalFull: boolean;
  slots: number;
  reservedBytes: number;
  transientBytes: number;
  workers: number;
  highWater: { slots: number; reservedBytes: number; transientBytes: number; workers: number };
  limits: { slots: number; storageBytes: number; transientBytes: number; inputBytes: number; payloadBytes: number; workers: number };
}
interface StorageApi { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void }
export interface EvidenceOutboxDeps {
  storage: () => StorageApi | null;
  available: () => boolean;
  clock?: () => number;
  project?: (draft: EvidenceDraft) => Promise<EvidenceEntry>;
  schedule?: (fn: () => void) => void;
  setTimeout?: (fn: () => void, ms: number) => unknown;
  clearTimeout?: (handle: unknown) => void;
}
export interface EvidenceOutbox {
  capture(change: EvidenceCapture): CaptureResult;
  watermark(): number;
  materializeThrough(watermark: number, timeoutMs?: number): Promise<void>;
  readyThrough(watermark: number): readonly EvidenceReceipt[];
  hasPendingIdentity(kind: EvidenceKind, id: string): boolean;
  ack(receipt: EvidenceReceipt): boolean;
  reject(receipt: EvidenceReceipt): boolean;
  diagnostics(): OutboxDiagnostics;
  subscribe(listener: () => void): () => void;
  setJournalFull(full: boolean): void;
}
interface Slot {
  slot: number; token: string; kind: EvidenceKind; admittedAt: number; order: number;
  reserved: number; transient: number; draft?: EvidenceDraft; draftKey?: string;
  entry?: EvidenceEntry; phase: 'hashing' | 'ready' | 'volatile' | 'verify' | 'terminal';
  terminalReason?: CaptureReason; running?: boolean; identity?: string;
}
interface Counters {
  v: 1; refused: number; interrupted: number; storageFailures: number; saturated: boolean; creditedSlots: string;
  lastReason: CaptureReason | null; lastRefusedAt: number | null;
  byReason: Partial<Record<CaptureReason, number>>; byKind: Partial<Record<EvidenceKind, number>>;
}
const emptyCounters = (): Counters => ({ v: 1, refused: 0, interrupted: 0, storageFailures: 0, saturated: false, creditedSlots: '0'.repeat(OUTBOX_SLOTS / 4), lastReason: null, lastRefusedAt: null, byReason: {}, byKind: {} });
const REASONS: ReadonlySet<CaptureReason> = new Set(['capacity', 'storage-bytes', 'transient-bytes', 'input-size', 'payload-size', 'invalid-input', 'storage-unavailable', 'storage-quota', 'projection-failed', 'interrupted', 'invalid-persisted', 'rejected']);
const safeCount = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) >= 0;

function validCounters(c: Counters): boolean {
  return c.v === 1 && typeof c.creditedSlots === 'string' && /^[0-9a-f]{1024}$/.test(c.creditedSlots) && safeCount(c.refused) && safeCount(c.interrupted) && safeCount(c.storageFailures) && typeof c.saturated === 'boolean'
    && (c.lastReason === null || REASONS.has(c.lastReason))
    && (c.lastRefusedAt === null || (typeof c.lastRefusedAt === 'number' && Number.isFinite(c.lastRefusedAt)))
    && !!c.byReason && !!c.byKind
    && Object.entries(c.byReason).every(([k, v]) => REASONS.has(k as CaptureReason) && safeCount(v))
    && Object.entries(c.byKind).every(([k, v]) => KINDS.has(k as EvidenceKind) && safeCount(v))
    && Object.keys(c).every(k => Object.keys(emptyCounters()).includes(k));
}
function validEnvelope(row: Record<string, unknown>): boolean {
  return row.v === 1 && typeof row.token === 'string' && /^[-0-9a-f]{36}:[1-9]\d{0,15}$/.test(row.token)
    && KINDS.has(row.kind as EvidenceKind) && typeof row.admittedAt === 'number' && Number.isFinite(row.admittedAt)
    && row.admittedAt > 0 && row.admittedAt < 1e14 && safeCount(row.admission) && row.admission > 0;
}
function parseStoredSlot(raw: string, index: number): Slot {
  if (raw.length > OUTBOX_PAYLOAD_BYTES * 2 || bytes(raw) > OUTBOX_PAYLOAD_BYTES + 1024) throw new Error('size');
  const row = JSON.parse(raw) as Record<string, unknown>;
  if (!row || !validEnvelope(row)) throw new Error('envelope');
  const kind = row.kind as EvidenceKind;
  const common = ['v', 'phase', 'token', 'kind', 'admittedAt', 'admission'];
  const slot: Slot = { slot: index, token: row.token as string, kind, admittedAt: row.admittedAt as number,
    order: row.admission as number, reserved: 0, transient: 0, phase: 'terminal' };
  if (row.phase === 'hashing') {
    if (Object.keys(row).some(k => ![...common, 'reservedBytes'].includes(k)) || !safeCount(row.reservedBytes)
      || row.reservedBytes < bytes(raw) || row.reservedBytes > OUTBOX_PAYLOAD_BYTES + 1024) throw new Error('marker');
    slot.reserved = row.reservedBytes;
  } else if (row.phase === 'ready') {
    if (Object.keys(row).some(k => ![...common, 'id', 'digest', 'payload', 'encodedBytes'].includes(k))
      || row.encodedBytes !== bytes(raw) || !validEvidencePayload(kind, row.payload) || row.id !== row.payload.id
      || typeof row.digest !== 'string' || !/^[0-9a-f]{64}$/.test(row.digest)
      || bytes(canonicalJson(row.payload)) > OUTBOX_PAYLOAD_BYTES) throw new Error('ready');
    slot.reserved = bytes(raw); slot.phase = 'verify';
    slot.entry = Object.freeze({ kind, id: String(row.id), digest: row.digest, payload: Object.freeze({ ...row.payload as EvidencePayload }) });
  } else throw new Error('phase');
  return slot;
}

export function createEvidenceOutbox(deps: EvidenceOutboxDeps): EvidenceOutbox {
  const clock = deps.clock ?? Date.now;
  const project = deps.project ?? projectEvidenceDraft;
  const schedule = deps.schedule ?? queueMicrotask;
  const setTimer = deps.setTimeout ?? ((fn, ms) => globalThis.setTimeout(fn, ms));
  const clearTimer = deps.clearTimeout ?? (h => globalThis.clearTimeout(h as ReturnType<typeof setTimeout>));
  const slots = new Map<number, Slot>();
  const drafts = new Map<string, number>();
  const identities = new Map<string, number>();
  const listeners = new Set<() => void>();
  let counters = emptyCounters();
  let loaded = false;
  let blocked = false;
  let quarantined = 0;
  let diagnosticsUnsaved = false;
  let diagnosticsQuarantined = false;
  let order = 0;
  let tokenGeneration = 0;
  const ownerToken = crypto.randomUUID();
  let reservedBytes = DIAGNOSTICS_RESERVATION;
  let transientBytes = 0;
  let workers = 0;
  let pumpScheduled = false;
  let journalFull = false;
  const highWater = { slots: 0, reservedBytes: 0, transientBytes: 0, workers: 0 };

  function storage(): StorageApi | null { try { return deps.storage(); } catch { return null; } }
  function emit(): void {
    highWater.slots = Math.max(highWater.slots, slots.size);
    highWater.reservedBytes = Math.max(highWater.reservedBytes, reservedBytes);
    highWater.transientBytes = Math.max(highWater.transientBytes, transientBytes);
    highWater.workers = Math.max(highWater.workers, workers);
    for (const listener of listeners) { try { listener(); } catch { /* observers cannot stop capture */ } }
  }
  function saveDiagnostics(): boolean {
    if (diagnosticsQuarantined) { diagnosticsUnsaved = true; return false; }
    try {
      const target = storage();
      if (!target) throw new Error('unavailable');
      target.setItem(DIAGNOSTICS_KEY, JSON.stringify(counters));
      diagnosticsUnsaved = false;
      return true;
    } catch { diagnosticsUnsaved = true; return false; }
  }
  function increment(value: number): number {
    if (value === Number.MAX_SAFE_INTEGER) { counters.saturated = true; return value; }
    return value + 1;
  }
  function refusal(kind: EvidenceKind, reason: CaptureReason): boolean {
    counters.refused = increment(counters.refused);
    if (reason === 'interrupted') counters.interrupted = increment(counters.interrupted);
    counters.byReason[reason] = increment(counters.byReason[reason] ?? 0);
    counters.byKind[kind] = increment(counters.byKind[kind] ?? 0);
    counters.lastReason = reason;
    counters.lastRefusedAt = clock();
    const saved = saveDiagnostics();
    emit();
    return saved;
  }
  function storageFailure(): void {
    counters.storageFailures = increment(counters.storageFailures);
    saveDiagnostics(); emit();
  }
  function addIdentity(slot: Slot, id: string): void {
    slot.identity = JSON.stringify([slot.kind, id]);
    identities.set(slot.identity, (identities.get(slot.identity) ?? 0) + 1);
  }
  function release(slot: Slot): boolean {
    if (slots.get(slot.slot) !== slot) return false;
    try { const target = storage(); if (!target) { storageFailure(); return false; } target.removeItem(slotKey(slot.slot)); }
    catch { storageFailure(); return false; }
    slots.delete(slot.slot);
    if (slot.identity) {
      const count = (identities.get(slot.identity) ?? 1) - 1;
      if (count > 0) identities.set(slot.identity, count); else identities.delete(slot.identity);
    }
    reservedBytes -= slot.reserved;
    transientBytes -= slot.transient;
    if (slot.draftKey) drafts.delete(slot.draftKey);
    emit();
    return true;
  }
  function credited(slot: number): boolean {
    return (Number.parseInt(counters.creditedSlots[Math.floor(slot / 4)]!, 16) & (1 << (slot % 4))) !== 0;
  }
  function setCredit(slot: number, value: boolean): void {
    const index = Math.floor(slot / 4);
    const bit = 1 << (slot % 4);
    const previous = Number.parseInt(counters.creditedSlots[index]!, 16);
    const next = (value ? previous | bit : previous & ~bit).toString(16);
    counters.creditedSlots = counters.creditedSlots.slice(0, index) + next + counters.creditedSlots.slice(index + 1);
  }
  function clearCreditBeforeReuse(slot: number): boolean {
    if (!credited(slot)) return true;
    const previous = counters.creditedSlots;
    setCredit(slot, false);
    if (saveDiagnostics()) return true;
    counters.creditedSlots = previous;
    return false;
  }
  function terminal(slot: Slot, reason: CaptureReason): void {
    slot.phase = 'terminal';
    slot.terminalReason = reason;
    // Drop sensitive transient inputs as soon as projection can no longer use them.
    slot.draft = undefined;
    transientBytes -= slot.transient; slot.transient = 0;
    if (slot.draftKey) drafts.delete(slot.draftKey);
    slot.draftKey = undefined;
    if (credited(slot.slot)) {
      if (saveDiagnostics()) release(slot);
    } else {
      setCredit(slot.slot, true);
      if (refusal(slot.kind, reason)) release(slot);
    }
    emit();
  }
  function readyText(slot: Slot, entry: EvidenceEntry): string {
    const row = { v: 1, phase: 'ready', token: slot.token, admittedAt: slot.admittedAt, admission: slot.order, kind: entry.kind, id: entry.id, digest: entry.digest, payload: entry.payload, encodedBytes: 0 };
    let text = JSON.stringify(row);
    do { row.encodedBytes = bytes(text); text = JSON.stringify(row); } while (row.encodedBytes !== bytes(text));
    return text;
  }
  function persistReady(slot: Slot): void {
    const text = readyText(slot, slot.entry!);
    if (bytes(text) > slot.reserved) { terminal(slot, 'payload-size'); return; }
    try {
      const target = storage(); if (!target) throw new Error('unavailable');
      target.setItem(slotKey(slot.slot), text);
      slot.phase = 'ready';
    } catch { slot.phase = 'volatile'; storageFailure(); }
    emit();
  }
  function nudge(): void {
    if (pumpScheduled) return;
    pumpScheduled = true;
    schedule(() => { pumpScheduled = false; pump(); });
  }
  function pump(): void {
    if (blocked) return;
    for (const slot of slots.values()) {
      if (workers >= OUTBOX_WORKERS) break;
      if (slot.running || (slot.phase !== 'hashing' && slot.phase !== 'verify')) continue;
      slot.running = true; workers += 1; emit();
      const task = slot.phase === 'verify'
        ? runEvidenceProjection(() => sha256Hex(canonicalJson(slot.entry!.payload))).then(digest => {
          if (digest !== slot.entry!.digest) throw new Error('digest');
          return slot.entry!;
        })
        : Promise.resolve().then(() => project(slot.draft!));
      void task.then(entry => {
        if (entry.kind !== slot.kind || entry.id !== (slot.draft?.payload.id ?? slot.entry?.id) || !validEvidencePayload(entry.kind, entry.payload) || entry.id !== entry.payload.id || !/^[0-9a-f]{64}$/.test(entry.digest)
          || bytes(canonicalJson(entry.payload)) > OUTBOX_PAYLOAD_BYTES) throw new Error('projection');
        slot.entry = Object.freeze({ ...entry, payload: Object.freeze({ ...entry.payload }) });
        slot.draft = undefined;
        // The exact draft memo retains bounded raw hash inputs until receipt removal.
        if (slot.phase === 'verify' && credited(slot.slot)) terminal(slot, 'rejected');
        else if (slot.phase === 'verify') slot.phase = 'ready';
        else persistReady(slot);
      }).catch(() => {
        if (slot.phase === 'verify') { blocked = true; quarantined += 1; slot.phase = 'terminal'; slot.terminalReason = 'invalid-persisted'; refusal(slot.kind, 'invalid-persisted'); }
        else terminal(slot, 'projection-failed');
      }).finally(() => { slot.running = false; workers -= 1; emit(); nudge(); });
    }
  }
  function mergeCounters(c: Counters): void {
        const live = counters;
        counters = c;
        const add = (a: number, b: number) => {
          if (a > Number.MAX_SAFE_INTEGER - b) { counters.saturated = true; return Number.MAX_SAFE_INTEGER; }
          return a + b;
        };
        counters.refused = add(counters.refused, live.refused);
        counters.interrupted = add(counters.interrupted, live.interrupted);
        counters.storageFailures = add(counters.storageFailures, live.storageFailures);
        for (const [kind, count] of Object.entries(live.byKind)) counters.byKind[kind as EvidenceKind] = add(counters.byKind[kind as EvidenceKind] ?? 0, count);
        for (const [reason, count] of Object.entries(live.byReason)) counters.byReason[reason as CaptureReason] = add(counters.byReason[reason as CaptureReason] ?? 0, count);
        counters.saturated ||= live.saturated;
        if (live.lastRefusedAt !== null && (counters.lastRefusedAt === null || live.lastRefusedAt >= counters.lastRefusedAt)) {
          counters.lastReason = live.lastReason; counters.lastRefusedAt = live.lastRefusedAt;
        }
        if (live.refused > 0 || live.storageFailures > 0) saveDiagnostics();
  }
  function loadCounters(target: StorageApi): void {
    try {
      const raw = target.getItem(DIAGNOSTICS_KEY);
      if (raw) {
        if (bytes(raw) > 4096) throw new Error('diagnostics');
        const c = JSON.parse(raw) as Counters;
        if (!validCounters(c)) throw new Error('diagnostics');
        mergeCounters(c);
      }
    } catch { blocked = true; quarantined += 1; diagnosticsQuarantined = true; }

  }
  function load(): void {
    if (loaded || !deps.available()) return;
    loaded = true;
    const target = storage();
    if (!target) { loaded = false; return; }
    loadCounters(target);
    for (let index = 0; index < OUTBOX_SLOTS; index++) {
      let raw: string | null;
      try { raw = target.getItem(slotKey(index)); } catch { blocked = true; break; }
      if (raw === null) continue;
      try {
        const slot = parseStoredSlot(raw, index);
        order = Math.max(order, slot.order);
        slots.set(index, slot); reservedBytes += slot.reserved;
        if (slot.entry) addIdentity(slot, slot.entry.id);
        if (slot.phase === 'terminal') terminal(slot, 'interrupted');
      } catch { quarantined += 1; blocked = true; }
    }
    if (reservedBytes > OUTBOX_STORAGE_BYTES) { blocked = true; quarantined += slots.size; }
    if (quarantined > 0) refusal('forecast', 'invalid-persisted');
    emit(); nudge();
  }
  function match(receipt: EvidenceReceipt): Slot | undefined {
    const slot = slots.get(receipt.slot);
    return slot?.phase === 'ready' && slot.token === receipt.token && slot.kind === receipt.kind
      && slot.entry?.id === receipt.id && slot.entry.digest === receipt.digest ? slot : undefined;
  }
  const outbox: EvidenceOutbox = {
    capture(change) {
      if (!deps.available()) return { status: 'inactive' };
      load();
      const refuse = (reason: CaptureReason): CaptureResult => { refusal(change.kind, reason); return { status: 'refused', reason }; };
      if (blocked) return refuse('invalid-persisted');
      let draft: EvidenceDraft | null;
      try { draft = snapshotEvidence(change); } catch { return refuse('invalid-input'); }
      if (!draft) return { status: 'inactive' };
      const reason = evidenceDraftRefusal(draft);
      if (reason) return refuse(reason);
      const draftKey = canonicalJson(draft);
      const inputBytes = bytes(draftKey);
      if (drafts.has(draftKey)) return { status: 'already-pending' };
      const projected = { ...draft.payload };
      for (const field of Object.keys(draft.hashInputs)) projected[field] = `sha256:${'0'.repeat(64)}`;
      if (order === Number.MAX_SAFE_INTEGER) return refuse('capacity');
      if (slots.size >= OUTBOX_SLOTS) return refuse('capacity');
      let slotIndex = 0;
      while (slots.has(slotIndex)) slotIndex += 1;
      const slot: Slot = { slot: slotIndex, token: `${ownerToken}:${++tokenGeneration}`, kind: change.kind,
        admittedAt: clock(), order: order + 1, reserved: 0, transient: inputBytes, draft, draftKey, phase: 'hashing' };
      slot.reserved = bytes(readyText(slot, { kind: change.kind, id: String(projected.id), digest: '0'.repeat(64), payload: projected })) + 16;
      if (reservedBytes + slot.reserved > OUTBOX_STORAGE_BYTES) return refuse('storage-bytes');
      if (transientBytes + inputBytes > OUTBOX_TRANSIENT_BYTES) return refuse('transient-bytes');
      const marker = JSON.stringify({ v: 1, phase: 'hashing', token: slot.token, kind: slot.kind, admittedAt: slot.admittedAt, admission: slot.order, reservedBytes: slot.reserved });
      if (!clearCreditBeforeReuse(slotIndex)) return refuse('storage-quota');
      const target = storage(); if (!target) return refuse('storage-unavailable');
      try { target.setItem(slotKey(slotIndex), marker); } catch { return refuse('storage-quota'); }
      slots.set(slotIndex, slot); drafts.set(draftKey, slotIndex); addIdentity(slot, String(projected.id)); order += 1;
      reservedBytes += slot.reserved; transientBytes += inputBytes;
      emit(); nudge(); return { status: 'admitted' };
    },
    watermark() { load(); return order; },
    async materializeThrough(watermark, timeoutMs = 10_000) {
      load();
      for (const slot of slots.values()) {
        if (slot.order > watermark) continue;
        if (slot.phase === 'volatile') persistReady(slot);
        if (slot.phase === 'terminal' && slot.terminalReason !== 'invalid-persisted' && saveDiagnostics()) release(slot);
      }
      nudge();
      const pending = () => !blocked && [...slots.values()].some(s => s.order <= watermark && (s.phase === 'hashing' || s.phase === 'verify'));
      if (!pending()) return;
      await new Promise<void>((resolve, reject) => {
        const done = () => { if (!pending()) { listeners.delete(done); clearTimer(handle); resolve(); } };
        listeners.add(done);
        const handle = setTimer(() => { listeners.delete(done); reject(new Error('evidence capture is still hashing')); }, timeoutMs);
        done();
      });
    },
    readyThrough(watermark) {
      load();
      if (blocked) return [];
      return [...slots.values()].filter(s => s.order <= watermark && s.phase === 'ready')
        .sort((a, b) => a.order - b.order).map(s => Object.freeze({ ...s.entry!, slot: s.slot, token: s.token, admittedAt: s.admittedAt }));
    },
    hasPendingIdentity(kind, id) {
      return identities.has(JSON.stringify([kind, id]));
    },
    ack(receipt) {
      const slot = match(receipt);
      return slot ? release(slot) : false;
    },
    reject(receipt) {
      const slot = match(receipt);
      if (!slot) return false;
      terminal(slot, 'rejected');
      return true;
    },
    diagnostics() {
      load();
      const phases = [...slots.values()];
      return { savedAwaitingSync: phases.filter(s => s.phase === 'ready' || s.phase === 'verify').length,
        hashing: phases.filter(s => s.phase === 'hashing').length, awaitingStorage: phases.filter(s => s.phase === 'volatile').length,
        terminalBlocked: phases.filter(s => s.phase === 'terminal').length, refused: counters.refused, interrupted: counters.interrupted,
        quarantined, blocked, diagnosticsUnsaved, storageFailures: counters.storageFailures, saturated: counters.saturated, lastReason: counters.lastReason, lastRefusedAt: counters.lastRefusedAt,
        byReason: { ...counters.byReason }, byKind: { ...counters.byKind }, journalFull, slots: slots.size, reservedBytes, transientBytes, workers,
        highWater: { ...highWater }, limits: { slots: OUTBOX_SLOTS, storageBytes: OUTBOX_STORAGE_BYTES, transientBytes: OUTBOX_TRANSIENT_BYTES,
          inputBytes: OUTBOX_INPUT_BYTES, payloadBytes: OUTBOX_PAYLOAD_BYTES, workers: OUTBOX_WORKERS } };
    },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    setJournalFull(full) { journalFull = full; emit(); },
  };
  return outbox;
}

/** Main renderer only. Standalone windows must never recover this owner's markers. */
export function isEvidenceCaptureOwner(): boolean {
  if (!isDesktopRuntime() || typeof window === 'undefined') return false;
  const pathname = window.location?.pathname ?? '';
  if (pathname.endsWith('/settings.html') || pathname.endsWith('/live-channels.html')) return false;
  const params = new URLSearchParams(window.location?.search ?? '');
  return params.get('settings') !== '1' && params.get('live-channels') !== '1';
}
let singleton: EvidenceOutbox | null = null;
export function getEvidenceOutbox(): EvidenceOutbox {
  singleton ??= createEvidenceOutbox({ available: isEvidenceCaptureOwner, storage: () => typeof localStorage === 'undefined' ? null : localStorage });
  return singleton;
}
export function captureEvidence(change: EvidenceCapture): CaptureResult { return getEvidenceOutbox().capture(change); }
export function getEvidenceOutboxDiagnostics(): OutboxDiagnostics { return getEvidenceOutbox().diagnostics(); }
export function subscribeEvidenceOutbox(listener: () => void): () => void { return getEvidenceOutbox().subscribe(listener); }
/** Forget test ownership without deleting persisted slots. */
export function resetEvidenceOutboxForTests(): void { singleton = null; }
