/**
 * Re-export shim — the canonical module has moved to
 * `src/services/intelligence/belief-helpers.ts` (arch-audit 2026-07-17).
 *
 * Pure math helpers have no place in components/; they belong in the
 * service/intelligence layer. This shim preserves backward compatibility
 * for BeliefCalibrationPanel and any other UI consumers importing the old path.
 * New code should import from '@/services/intelligence/belief-helpers' directly.
 */
export * from '@/services/intelligence/belief-helpers';
