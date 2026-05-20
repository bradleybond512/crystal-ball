/**
 * Pure helpers used by FeedHealthDashboardPanel. Lives in its own file so
 * tests can import without dragging in Panel (which pulls Vite-only workers).
 */

export function formatAge(lastSeenAt: number, now: number): string {
  if (lastSeenAt === 0) return 'never';
  const ms = now - lastSeenAt;
  if (ms < 60_000) return 'just now';
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
  return `${Math.floor(ms / 86_400_000)}d ago`;
}
