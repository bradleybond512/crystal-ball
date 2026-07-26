export interface FetchResult<T> {
  data: T;
  status: 'fresh' | 'stale' | 'degraded' | 'disabled';
  source: string;
  fetchedAt: number;
  errorCode?: string;
}
