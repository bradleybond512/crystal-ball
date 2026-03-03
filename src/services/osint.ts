import { invokeTauri, hasTauriInvokeBridge } from './tauri-bridge';
import type { DomainIntelligence, UsernameSearchResult } from '@/types/osint';

/** Look up domain intelligence via the Tauri OSINT bridge. */
export async function lookupDomain(domain: string): Promise<DomainIntelligence> {
  if (!hasTauriInvokeBridge()) {
    throw new Error('OSINT lookup requires the desktop app (Tauri runtime not available)');
  }
  return invokeTauri<DomainIntelligence>('lookup_domain', { domain });
}

/** Search for a username across social media platforms via the Tauri OSINT bridge. */
export async function searchUsername(username: string): Promise<UsernameSearchResult> {
  if (!hasTauriInvokeBridge()) {
    throw new Error('OSINT search requires the desktop app (Tauri runtime not available)');
  }
  return invokeTauri<UsernameSearchResult>('search_username', { username });
}

/** Clear all cached OSINT results. */
export async function clearOsintCache(): Promise<void> {
  if (!hasTauriInvokeBridge()) {
    return;
  }
  await invokeTauri<void>('clear_osint_cache');
}
