import { safeSetItem } from '../utils/safe-storage';

export interface RegistrationProfile {
  firstName: string;
  lastName: string;
  email: string;
  organization: string;
}

const PROFILE_KEY = 'crystalball-reg-profile';

export function getRegistrationProfile(): RegistrationProfile | null {
  try {
 const raw = localStorage.getItem(PROFILE_KEY);
 return raw ? JSON.parse(raw) as RegistrationProfile : null;
  } catch { return null; }
}

export function saveRegistrationProfile(profile: RegistrationProfile): void {
  safeSetItem(PROFILE_KEY, JSON.stringify(profile));
}

export function clearRegistrationProfile(): void {
  localStorage.removeItem(PROFILE_KEY);
}
