/**
 * ACC-404 — champion rollback self-test fixture.
 *
 * The roadmap's phase exit requires rollback "tested against the
 * installed app". This fixture runs INSIDE the app runtime (wired as a
 * SystemDiagnostic self-test probe) but against a fully ISOLATED
 * in-memory registry — it proves the real ChampionRegistry code path
 * (setInitial → promote → rollback → previous champion restored) in the
 * shipped bundle without ever touching the production registry's
 * persisted state.
 *
 * Pure module — no DOM, no fetch, no globals, no Date.now() (fixture
 * clock is fixed).
 */

import { ChampionRegistry } from './champion-registry';
import type { PromotionDecision } from './promotion-gate';

const FIXTURE_T0 = Date.UTC(2026, 0, 1);

function fixtureDecision(): PromotionDecision {
  return {
    challengerId: 'selftest-challenger',
    incumbentId: 'selftest-incumbent',
    recommendation: 'promote',
    gates: [{ id: 'min-pairs-overall', pass: true, detail: 'fixture' }],
    pairCount: 200,
    perDomainCounts: { fixture: 200 },
    proxyShare: 0,
    evaluatedAt: FIXTURE_T0,
  };
}

/** In-memory StorageLike so the fixture never touches localStorage. */
function memoryStorage(): { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void } {
  const data = new Map<string, string>();
  return {
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => { data.set(k, v); },
    removeItem: (k) => { data.delete(k); },
  };
}

export function runChampionRollbackSelfTestFixture(): { ok: boolean; reason: string } {
  try {
    let tick = 0;
    const registry = new ChampionRegistry({
      storage: memoryStorage(),
      clock: () => {
        tick += 1000;
        return FIXTURE_T0 + tick;
      },
    });
    const slot = 'selftest-slot';

    const initial = registry.setInitial(slot, 'selftest-incumbent', '1.0.0');
    if (!initial.ok) return { ok: false, reason: `setInitial refused: ${initial.reason}` };

    const promoted = registry.promote(slot, fixtureDecision());
    if (!promoted.ok) return { ok: false, reason: `promote refused: ${promoted.reason}` };
    if (registry.getActiveChampion(slot)?.modelId !== 'selftest-challenger') {
      return { ok: false, reason: 'promote did not activate the challenger.' };
    }

    const rolled = registry.rollback(slot);
    if (!rolled.ok) return { ok: false, reason: `rollback refused: ${rolled.reason}` };
    const active = registry.getActiveChampion(slot);
    if (active?.modelId !== 'selftest-incumbent' || active.version !== '1.0.0') {
      return { ok: false, reason: `rollback restored '${active?.modelId ?? 'nothing'}' instead of the previous champion.` };
    }

    return { ok: true, reason: 'setInitial → promote → rollback restored the previous champion (isolated registry).' };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
}
