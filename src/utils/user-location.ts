type MapView = 'global' | 'america' | 'mena' | 'eu' | 'asia' | 'latam' | 'africa' | 'oceania';

const ASIA_EAST_TIMEZONES = new Set([
  'Asia/Tokyo', 'Asia/Seoul', 'Asia/Shanghai', 'Asia/Hong_Kong',
  'Asia/Taipei', 'Asia/Singapore',
]);

function timezoneToRegion(tz: string): MapView | null {
  if (ASIA_EAST_TIMEZONES.has(tz)) return 'asia';
  const prefix = tz.split('/')[0];
  switch (prefix) {
 case 'America':
 case 'US':
 case 'Canada': {
 return 'america';
 }
 case 'Europe': {
 return 'eu';
 }
 case 'Africa': {
 return 'africa';
 }
 case 'Asia': {
 return 'mena';
 }
 case 'Australia':
 case 'Pacific': {
 return 'oceania';
 }
 default: {
 return null;
 }
  }
}

export function resolveUserRegion(): Promise<MapView> {
  let tzRegion: MapView = 'global';
  try {
 const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
 tzRegion = timezoneToRegion(tz) ?? 'global';
  } catch {
 // Intl unavailable
  }

  return Promise.resolve(tzRegion);
}
