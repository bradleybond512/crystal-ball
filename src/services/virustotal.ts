
export type { VtReputation } from './cyber-extra';

// Re-export the lookup function as the primary entry point for this service.


export function vtSeverityLabel(rep: { malicious: number; suspicious: number }): string {
  if (rep.malicious >= 5) return 'critical';
  if (rep.malicious >= 1) return 'high';
  if (rep.suspicious >= 3) return 'medium';
  return 'clean';
}

export {lookupVtIndicator} from './cyber-extra';