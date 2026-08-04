import {
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname } from 'node:path';

const INITIALIZATION_GRACE_MS = 30_000;

export function acquireLocalLock(lockPath, {
  closeSyncFn = closeSync,
  killFn = process.kill.bind(process),
  lockNow = Date.now,
  openSyncFn = openSync,
  pid = process.pid,
  readFileSyncFn = readFileSync,
  statSyncFn = statSync,
  unlinkSyncFn = unlinkSync,
  writeFileSyncFn = writeFileSync,
} = {}) {
  mkdirSync(dirname(lockPath), { recursive: true });

  for (let attempt = 0; attempt < 2; attempt += 1) {
    let descriptor;
    try {
      descriptor = openSyncFn(lockPath, 'wx', 0o600);
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      if (attempt === 0 && removeRecoverableLock(lockPath, {
        killFn,
        lockNow,
        readFileSyncFn,
        statSyncFn,
        unlinkSyncFn,
      })) continue;
      throw new Error('A local operation is already running for this storage directory.');
    }

    let descriptorOpen = true;
    try {
      writeFileSyncFn(descriptor, JSON.stringify({ pid, startedAt: lockNow() }));
      closeSyncFn(descriptor);
      descriptorOpen = false;
    } catch (error) {
      if (descriptorOpen) {
        try { closeSyncFn(descriptor); } catch { /* preserve initialization error */ }
      }
      try { unlinkSyncFn(lockPath); } catch { /* a missing file is already clean */ }
      throw error;
    }

    return () => {
      try {
        unlinkSyncFn(lockPath);
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
      }
    };
  }

  throw new Error('A local operation is already running for this storage directory.');
}

function removeRecoverableLock(lockPath, {
  killFn,
  lockNow,
  readFileSyncFn,
  statSyncFn,
  unlinkSyncFn,
}) {
  let owner;
  try {
    owner = JSON.parse(readFileSyncFn(lockPath, 'utf8'));
  } catch {
    return removeOldMalformedLock(lockPath, { lockNow, statSyncFn, unlinkSyncFn });
  }

  if (!validOwner(owner)) {
    return removeOldMalformedLock(lockPath, { lockNow, statSyncFn, unlinkSyncFn });
  }
  try {
    killFn(owner.pid, 0);
    return false;
  } catch (error) {
    if (error?.code !== 'ESRCH') return false;
  }
  return removeLock(lockPath, unlinkSyncFn);
}

function validOwner(owner) {
  return owner
    && typeof owner === 'object'
    && !Array.isArray(owner)
    && Number.isInteger(owner.pid)
    && owner.pid > 0
    && Number.isSafeInteger(owner.startedAt)
    && owner.startedAt >= 0;
}

function removeOldMalformedLock(lockPath, { lockNow, statSyncFn, unlinkSyncFn }) {
  try {
    const ageMs = lockNow() - statSyncFn(lockPath).mtimeMs;
    if (!Number.isFinite(ageMs) || ageMs < INITIALIZATION_GRACE_MS) return false;
  } catch {
    return false;
  }
  return removeLock(lockPath, unlinkSyncFn);
}

function removeLock(lockPath, unlinkSyncFn) {
  try {
    unlinkSyncFn(lockPath);
    return true;
  } catch {
    return false;
  }
}
