export type PerformanceDataScope = 'yesterday' | 'combined';

export function getPerformanceScopeLabel(scope: PerformanceDataScope): string {
  return scope === 'yesterday' ? "Yesterday's Data" : 'Combined Days';
}

export function resolveFilteredScope(timeRange: 'all' | 'yesterday' | 'past-week' | 'past-month' | 'single-day'): PerformanceDataScope {
  return timeRange === 'yesterday' || timeRange === 'single-day' ? 'yesterday' : 'combined';
}

export function resolveOverviewScope(selectedDate: string, latestDate: string | null): PerformanceDataScope {
  if (selectedDate !== 'all' && latestDate && selectedDate === latestDate) return 'yesterday';
  return 'combined';
}
