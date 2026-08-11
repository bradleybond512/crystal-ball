async function readServiceWorkers(): Promise<readonly ServiceWorkerRegistration[]> {
  return (await window.navigator.serviceWorker?.getRegistrations?.()) ?? [];
}

async function readCacheKeys(): Promise<readonly string[]> {
  return (await window.caches?.keys?.()) ?? [];
}

export async function clearClientCachesAndReload(): Promise<void> {
  const [registrationsResult, cacheKeysResult] = await Promise.allSettled([
    readServiceWorkers(),
    readCacheKeys(),
  ]);

  const registrations = registrationsResult.status === 'fulfilled'
    ? registrationsResult.value
    : [];
  const cacheKeys = cacheKeysResult.status === 'fulfilled'
    ? cacheKeysResult.value
    : [];

  await Promise.allSettled([
    ...registrations.map((registration) => Promise.resolve().then(() => registration.unregister())),
    ...cacheKeys.map((key) => Promise.resolve().then(() => window.caches.delete(key))),
  ]);

  window.location.reload();
}
