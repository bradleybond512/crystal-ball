import type { NWSAlert } from '../../src/services/nws-alerts';

export function normalizeNwsAlert(value: unknown, responseBudget: { polygons: number; rings: number; vertices: number }): NWSAlert | null;
