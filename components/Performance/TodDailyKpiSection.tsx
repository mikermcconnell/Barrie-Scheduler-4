import React, { useState } from 'react';
import { BarChart3, CalendarDays, Database, Loader2, MapPinned, Settings2 } from 'lucide-react';
import { ChartCard } from '../Analytics/AnalyticsShared';
import {
  getTodActivityValue,
  type TodActivityMetric,
} from '../../utils/todPickupAggregation';
import type { TodDailyKpiDataset, TodDailyKpiLocation } from '../../utils/todPickupTypes';
import { TodActivityMap } from './TodActivityMap';
import { TodZonePerformanceView } from './TodZonePerformanceView';
import { TodZoneEditor } from './TodZoneEditor';
import { useBarrieTransitStopsQuery, useTodZoneVersionsQuery } from '../../hooks/useTodZones';
import { selectEffectiveTodZoneVersion } from '../../utils/todZones/todZoneGeometry';
import {
  aggregateClassifiedTodLocations,
  buildTodZonePerformance,
  buildTodZoneTrend,
  classifyTodReports,
  type TodTrendGrain,
} from '../../utils/todZones/todZonePerformance';
import type { TodZoneDefinition, TodZoneVersion } from '../../utils/todZones/todZoneTypes';

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
  userId,
  canManageZones = false,
}) => {
  const [metric, setMetric] = useState<TodActivityMetric>('activity');
  const [view, setView] = useState<'map' | 'performance'>('map');
  const [zoneFilter, setZoneFilter] = useState('all');
  const [selectedPerformanceZone, setSelectedPerformanceZone] = useState('A');
  const [trendGrain, setTrendGrain] = useState<TodTrendGrain>('daily');
  const [showAllStops, setShowAllStops] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const versionsQuery = useTodZoneVersionsQuery(teamId);
  const cityStopsQuery = useBarrieTransitStopsQuery(!!teamId);
  const reportDates = reports.map(report => report.date);
  const label = metricLabel(metric);
  const versions = React.useMemo(() => versionsQuery.data ?? [], [versionsQuery.data]);
  const effectiveVersionsByDate = React.useMemo(() => new Map(
    [...new Set(reportDates)].map(date => [date, selectEffectiveTodZoneVersion(versions, [date])] as const),
  ), [reportDates, versions]);
  const overlayVersion = selectEffectiveTodZoneVersion(versions, reportDates);
  const classified = React.useMemo(() => classifyTodReports(reports, versions), [reports, versions]);
  const filteredLocations = React.useMemo(
    () => aggregateClassifiedTodLocations(classified.locations, zoneFilter),
    [classified.locations, zoneFilter],
  );
  const usedVersionIds = classified.usedVersionIds;
  const unversionedDateCount = classified.unversionedDates.length;
  const total = filteredLocations.reduce((sum, location) => sum + getTodActivityValue(location, metric), 0);
  const availableZones = React.useMemo(() => {
    const byCode = new Map<string, TodZoneDefinition>();
    [...effectiveVersionsByDate.values()]
      .filter((version): version is TodZoneVersion => version !== null)
      .sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom) || a.revision - b.revision)
      .forEach(version => version.definitions.filter(zone => zone.active).forEach(zone => byCode.set(zone.code, zone)));
    return [...byCode.values()].sort((a, b) => a.code.localeCompare(b.code));
  }, [effectiveVersionsByDate]);
  React.useEffect(() => {
    const activeCodes = new Set(availableZones.map(zone => zone.code));
    if (!['all', 'multi-zone', 'unassigned'].includes(zoneFilter) && !activeCodes.has(zoneFilter)) setZoneFilter('all');
  }, [availableZones, zoneFilter]);
  React.useEffect(() => {
    const activeCodes = new Set(availableZones.map(zone => zone.code));
    if (selectedPerformanceZone !== 'unassigned' && !activeCodes.has(selectedPerformanceZone)) {
      setSelectedPerformanceZone(availableZones[0]?.code ?? 'unassigned');
    }
  }, [availableZones, selectedPerformanceZone]);
  const performance = React.useMemo(
    () => buildTodZonePerformance(classified.locations, availableZones, metric),
    [availableZones, classified.locations, metric],
  );
  const trend = React.useMemo(
    () => buildTodZoneTrend(classified.locations, reportDates, selectedPerformanceZone, metric, trendGrain),
    [classified.locations, metric, reportDates, selectedPerformanceZone, trendGrain],
  );

  return (
    <ChartCard
      title="Transit On Demand Activity"
      subtitle="Map and zone performance from automatically imported daily pickup and drop-off activity"
    >
      <div className="space-y-4">
        <div className="flex flex-col gap-3 rounded-xl border border-gray-200 bg-gray-50 p-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex w-fit rounded-lg border border-gray-200 bg-white p-1 shadow-sm" aria-label="TOD view">
              {([
                { value: 'map' as const, label: 'Map', icon: MapPinned },
                { value: 'performance' as const, label: 'Zone performance', icon: BarChart3 },
              ]).map(option => {
                const Icon = option.icon;
                return (
                  <button
                    key={option.value}
                    type="button"
                    aria-pressed={view === option.value}
                    onClick={() => setView(option.value)}
                    className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-bold transition-colors ${
                      view === option.value ? 'bg-blue-600 text-white shadow-sm' : 'text-gray-500 hover:bg-gray-100 hover:text-gray-800'
                    }`}
                  >
                    <Icon size={13} />{option.label}
                  </button>
                );
              })}
            </div>
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
            {canManageZones && teamId && userId && (
              <button type="button" onClick={() => setEditorOpen(true)} className="inline-flex items-center gap-1.5 rounded-lg border border-violet-200 bg-white px-3 py-1.5 text-xs font-bold text-violet-700 shadow-sm hover:bg-violet-50">
                <Settings2 size={14} />Edit zones
              </button>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-3 rounded-xl border border-violet-100 bg-violet-50/60 p-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="inline-flex items-center gap-1.5 text-xs font-extrabold text-violet-900"><MapPinned size={14} />Published TOD zones</div>
            <p className="mt-1 text-xs text-violet-700">
              {overlayVersion
                ? `Effective ${formatDate(overlayVersion.effectiveFrom)} · ${overlayVersion.source}`
                : versionsQuery.isLoading ? 'Loading effective zone versions…' : 'No published zone version applies to this period.'}
              {usedVersionIds.size > 1 ? ` Activity spans ${usedVersionIds.size} effective versions; each day is classified with its applicable version.` : ''}
              {unversionedDateCount > 0 ? ` ${unversionedDateCount} selected service date${unversionedDateCount === 1 ? ' has' : 's have'} no effective zone version and remains Unassigned.` : ''}
            </p>
          </div>
          {view === 'map' && (
            <div className="flex flex-wrap items-center gap-1.5" aria-label="TOD zone filter">
              {[{ code: 'all', label: 'All' }, ...availableZones.map(zone => ({ code: zone.code, label: zone.code })), { code: 'multi-zone', label: 'Multi-zone' }, { code: 'unassigned', label: 'Unassigned' }].map(option => (
                <button key={option.code} type="button" aria-pressed={zoneFilter === option.code} onClick={() => setZoneFilter(option.code)} className={`rounded-full border px-2.5 py-1 text-xs font-bold ${zoneFilter === option.code ? 'border-violet-700 bg-violet-700 text-white' : 'border-violet-200 bg-white text-violet-800'}`}>{option.label}</button>
              ))}
              <label className="ml-1 inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600"><input type="checkbox" checked={showAllStops} onChange={event => setShowAllStops(event.target.checked)} />All City stops</label>
            </div>
          )}
        </div>

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">
            Transit On Demand activity could not be loaded. Refresh the page to try again.
          </div>
        )}
        {versionsQuery.isError && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">
            Published TOD zones could not be loaded. Activity remains visible, but zone assignments are unavailable.
          </div>
        )}
        {showAllStops && cityStopsQuery.isError && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-800">
            The current City stop layer is unavailable. Published activity and zone boundaries remain visible.
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
        ) : view === 'map' ? (
          <TodActivityMap
            locations={filteredLocations}
            metric={metric}
            zoneVersion={overlayVersion}
            cityStops={cityStopsQuery.data}
            showAllStops={showAllStops}
            focusZone={zoneFilter}
          />
        ) : (
          <TodZonePerformanceView
            performance={performance}
            metric={metric}
            selectedZone={selectedPerformanceZone}
            onSelectedZoneChange={setSelectedPerformanceZone}
            trendGrain={trendGrain}
            onTrendGrainChange={setTrendGrain}
            trend={trend}
            unversionedDateCount={unversionedDateCount}
            effectiveFrom={overlayVersion?.effectiveFrom}
          />
        )}
        {editorOpen && teamId && userId && <TodZoneEditor open teamId={teamId} userId={userId} onClose={() => setEditorOpen(false)} />}
      </div>
    </ChartCard>
  );
};
