import React, { useState } from 'react';
import { CalendarDays, Database, Loader2 } from 'lucide-react';
import { ChartCard } from '../Analytics/AnalyticsShared';
import {
  getTodActivityValue,
  type TodActivityMetric,
} from '../../utils/todPickupAggregation';
import type { TodDailyKpiDataset, TodDailyKpiLocation } from '../../utils/todPickupTypes';
import { useTodZoneVersionsQuery } from '../../hooks/useTodZones';
import {
  aggregateClassifiedTodLocations,
  classifyTodReports,
} from '../../utils/todZones/todZonePerformance';
import type { TodZoneDefinition } from '../../utils/todZones/todZoneTypes';
import { TodActivityMap } from './TodActivityMap';

interface TodDailyKpiSectionProps {
  reports: TodDailyKpiDataset[];
  locations: TodDailyKpiLocation[];
  isLoading: boolean;
  error: unknown;
  hasStoredReports: boolean;
  teamId?: string;
  userId?: string;
  canManageZones?: boolean;
}

function formatDate(date: string): string {
  return new Date(`${date}T12:00:00`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function formatPeriod(dates: string[]): string {
  if (dates.length === 0) return 'No imported days in period';
  const sorted = [...dates].sort();
  if (sorted[0] === sorted.at(-1)) return formatDate(sorted[0]);
  return `${formatDate(sorted[0])} – ${formatDate(sorted.at(-1)!)}`;
}

function metricLabel(metric: TodActivityMetric): string {
  if (metric === 'pickups') return 'pickups';
  if (metric === 'dropoffs') return 'drop-offs';
  return 'activity';
}

export const TodDailyKpiSection: React.FC<TodDailyKpiSectionProps> = ({
  reports,
  isLoading,
  error,
  hasStoredReports,
  teamId,
}) => {
  const [metric, setMetric] = useState<TodActivityMetric>('activity');
  const versionsQuery = useTodZoneVersionsQuery(teamId);
  const reportDates = reports.map(report => report.date);
  const label = metricLabel(metric);
  const versions = React.useMemo(() => versionsQuery.data ?? [], [versionsQuery.data]);
  const classified = React.useMemo(() => classifyTodReports(reports, versions), [reports, versions]);
  const mappedLocations = React.useMemo(
    () => aggregateClassifiedTodLocations(classified.locations, 'all'),
    [classified.locations],
  );
  const zoneDefinitions = React.useMemo(() => {
    const byCode = new Map<string, TodZoneDefinition>();
    [...versions]
      .sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom) || a.revision - b.revision)
      .forEach(version => version.definitions
        .filter(zone => zone.active)
        .forEach(zone => byCode.set(zone.code, zone)));
    return [...byCode.values()].sort((a, b) => a.code.localeCompare(b.code));
  }, [versions]);
  const total = mappedLocations.reduce(
    (sum, location) => sum + getTodActivityValue(location, metric),
    0,
  );

  return (
    <ChartCard
      title="Transit On Demand Activity"
      subtitle="Map from automatically imported daily pickup and drop-off activity"
    >
      <div className="space-y-4">
        <div className="flex flex-col gap-3 rounded-xl border border-gray-200 bg-gray-50 p-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="inline-flex w-fit rounded-lg border border-gray-200 bg-white p-1 shadow-sm" aria-label="TOD activity metric">
            {(['activity', 'pickups', 'dropoffs'] as TodActivityMetric[]).map(value => (
              <button
                key={value}
                type="button"
                aria-pressed={metric === value}
                onClick={() => setMetric(value)}
                className={`rounded-md px-3 py-1.5 text-xs font-bold transition-colors ${
                  metric === value
                    ? 'bg-gray-900 text-white shadow-sm'
                    : 'text-gray-500 hover:bg-gray-100 hover:text-gray-800'
                }`}
              >
                {value === 'activity' ? 'Activity' : value === 'pickups' ? 'Pickups' : 'Drop-offs'}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-gray-600">
            <span className="inline-flex items-center gap-1.5 font-semibold">
              <CalendarDays size={15} className="text-gray-400" />
              {formatPeriod(reportDates)}
            </span>
            <span className="inline-flex items-center gap-1.5 font-semibold">
              <Database size={15} className="text-gray-400" />
              {reports.length.toLocaleString()} imported day{reports.length === 1 ? '' : 's'}
            </span>
            <span className="rounded-full bg-purple-100 px-2.5 py-1 font-bold text-purple-700">
              {total.toLocaleString()} {label}
            </span>
          </div>
        </div>

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">
            Transit On Demand activity could not be loaded. Refresh the page to try again.
          </div>
        )}

        {isLoading ? (
          <div className="grid h-64 place-items-center text-sm font-semibold text-gray-500">
            <span className="inline-flex items-center gap-2"><Loader2 size={16} className="animate-spin" /> Loading TOD activity...</span>
          </div>
        ) : reports.length === 0 ? (
          <div className="grid h-64 place-items-center rounded-lg border border-dashed border-gray-300 bg-gray-50 p-6 text-center">
            <div>
              <div className="text-sm font-bold text-gray-700">
                {hasStoredReports ? 'No TOD report in the selected Ridership period' : 'No automatic daily TOD reports received yet'}
              </div>
              <p className="mt-1 text-sm text-gray-500">
                {hasStoredReports
                  ? 'Choose a Ridership period that includes an imported TOD service date.'
                  : 'The map will populate after the daily Licensee KPI email flow completes.'}
              </p>
            </div>
          </div>
        ) : (
          <TodActivityMap
            locations={mappedLocations}
            metric={metric}
            zoneDefinitions={zoneDefinitions}
          />
        )}
      </div>
    </ChartCard>
  );
};
