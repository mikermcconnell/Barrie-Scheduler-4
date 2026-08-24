import React, { useMemo, useState } from 'react';
import { CalendarDays, Database, Loader2 } from 'lucide-react';
import { ChartCard } from '../Analytics/AnalyticsShared';
import { useTeam } from '../contexts/TeamContext';
import { useTodPickupDataQuery, useTodPickupMetadataQuery } from '../../hooks/useTodPickupData';
import {
  aggregateTodDailyLocations,
  getTodActivityValue,
  type TodActivityMetric,
} from '../../utils/todPickupAggregation';
import { TodActivityMap } from './TodActivityMap';

interface TodDailyKpiSectionProps {
  includedDates: string[];
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
  return metric === 'pickups' ? 'pickups' : 'drop-offs';
}

export const TodDailyKpiSection: React.FC<TodDailyKpiSectionProps> = ({ includedDates }) => {
  const { team } = useTeam();
  const [metric, setMetric] = useState<TodActivityMetric>('pickups');
  const metadataQuery = useTodPickupMetadataQuery(team?.id);
  const dataQuery = useTodPickupDataQuery(team?.id, !!metadataQuery.data, metadataQuery.data);
  const includedDateSet = useMemo(() => new Set(includedDates), [includedDates]);
  const reports = useMemo(
    () => (dataQuery.data?.dailyReports || []).filter(report => includedDateSet.has(report.date)),
    [dataQuery.data?.dailyReports, includedDateSet],
  );
  const locations = useMemo(
    () => aggregateTodDailyLocations(dataQuery.data?.dailyReports || [], includedDates),
    [dataQuery.data?.dailyReports, includedDates],
  );
  const total = locations.reduce((sum, location) => sum + getTodActivityValue(location, metric), 0);
  const reportDates = reports.map(report => report.date);
  const isLoading = metadataQuery.isLoading || dataQuery.isLoading;
  const error = metadataQuery.error || dataQuery.error;
  const hasStoredReports = (dataQuery.data?.dailyReports?.length || 0) > 0;
  const label = metricLabel(metric);

  return (
    <ChartCard
      title="Transit On Demand Activity Map"
      subtitle="Automatically imported daily pickup and drop-off activity for the selected Ridership period"
    >
      <div className="space-y-4">
        <div className="flex flex-col gap-3 rounded-xl border border-gray-200 bg-gray-50 p-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="inline-flex w-fit rounded-lg border border-gray-200 bg-white p-1 shadow-sm" aria-label="TOD map metric">
            {(['pickups', 'dropoffs'] as TodActivityMetric[]).map(value => (
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
                {value === 'pickups' ? 'Pickups' : 'Drop-offs'}
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
          <TodActivityMap locations={locations} metric={metric} />
        )}
      </div>
    </ChartCard>
  );
};
