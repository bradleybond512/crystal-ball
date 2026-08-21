import type { LocalLogisticsSnapshot } from '@/services/local-logistics-types';

export interface CommsContextDisclosure {
  label: string;
  detail: string;
  knowledge: 'reported' | 'device-only' | 'unknown';
}

export function buildDeviceConnectivityDisclosure(isOnline: boolean): CommsContextDisclosure {
  return isOnline
    ? {
        label: 'This device',
        detail: 'A network interface is reported. Internet, cellular, and place-wide service remain unverified.',
        knowledge: 'device-only',
      }
    : {
        label: 'This device',
        detail: 'The browser reports offline. This does not establish the condition of other devices or carriers.',
        knowledge: 'device-only',
      };
}

export function buildCountyPowerDisclosure(
  snapshot: LocalLogisticsSnapshot | null,
  now = Date.now(),
): CommsContextDisclosure {
  if (!snapshot) {
    return {
      label: 'County power coverage',
      detail: 'Unknown; no exact-place Lifelines snapshot is available.',
      knowledge: 'unknown',
    };
  }
  const provider = snapshot.providers.find((item) => item.id === 'ornl-odin');
  const current = snapshot.areaConditions.filter((condition) => (
    condition.coverage === 'reported' && condition.expiresAt.getTime() > now
  ));
  if (!provider || provider.state === 'error' || current.length === 0) {
    return {
      label: 'County power coverage',
      detail: 'Unknown; no current accepted county observation. This does not mean power or communications are on.',
      knowledge: 'unknown',
    };
  }
  const customersOut = current.reduce((sum, condition) => sum + condition.customersOut, 0);
  const county = current[0]?.county ?? 'County';
  return {
    label: `${county} power context`,
    detail: `${customersOut.toLocaleString()} customers reported out. Facility power and communications remain unverified.`,
    knowledge: 'reported',
  };
}
