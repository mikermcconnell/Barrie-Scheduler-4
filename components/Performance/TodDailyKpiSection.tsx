import React, { useState } from 'react';
import { CalendarDays, Database, Loader2, MapPinned, Settings2 } from 'lucide-react';
import { ChartCard } from '../Analytics/AnalyticsShared';
import {
  getTodActivityValue,
  type TodActivityMetric,
} from '../../utils/todPickupAggregation';
import type { TodDailyKpiDataset, TodDailyKpiLocation } from '../../utils/todPickupTypes';
import { TodActivityMap } from './TodActivityMap';
import { TodZoneEditor } from './TodZoneEditor';
import { useBarrieTransitStopsQuery, useTodZoneVersionsQuery } from '../../hooks/useTodZones';
import { assignTodZoneMembership, filterByTodZone, normalizeTodZoneStopId, selectEffectiveTodZoneVersion } from '../../utils/todZones/todZoneGeometry';
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
  const [zoneFilter, setZoneFilter] = useState('all');
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
  const { filteredLocations, usedVersionIds, unversionedDateCount } = React.useMemo(() => {
    const used = new Set<string>();
    const snapshots = new Map(versions.map(version => [version.id, new Map(version.stopSnapshot.map(stop => [normalizeTodZoneStopId(stop.stopId), stop]))]));
    const aggregates = new Map<string, {
      location: TodDailyKpiLocation;
      coordinateWeight: number;
      latWeightedSum: number;
      lonWeightedSum: number;
      zoneCodes: Set<string>;
      isConnectionStop: boolean;
    }>();
    reports.forEach(report => {
      const version = effectiveVersionsByDate.get(report.date) ?? null;
      if (version) used.add(version.id);
      report.locations.forEach(location => {
        const snapshotStop = version ? snapshots.get(version.id)?.get(normalizeTodZoneStopId(location.id)) : undefined;
        const membership = version && !snapshotStop
          ? assignTodZoneMembership(location, version.definitions, version.polygons, version.overrides, version.connectionStops)
          : null;
        const codes = snapshotStop?.zoneCodes ?? membership?.zoneCodes ?? [];
        const isConnectionStop = snapshotStop?.isConnectionStop
          ?? membership?.isConnectionStop
          ?? version?.connectionStops.some(stop => normalizeTodZoneStopId(stop.stopId) === normalizeTodZoneStopId(location.id))
          ?? false;
        if (!filterByTodZone(codes, zoneFilter)) return;
        const weight = Math.max(location.pickups + location.dropoffs, 1);
        const aggregate = aggregates.get(location.id);
        if (aggregate) {
          aggregate.location.name = location.name;
          aggregate.location.pickups += location.pickups;
          aggregate.location.dropoffs += location.dropoffs;
          aggregate.coordinateWeight += weight;
          aggregate.latWeightedSum += location.lat * weight;
          aggregate.lonWeightedSum += location.lon * weight;
          aggregate.isConnectionStop ||= isConnectionStop;
          codes.forEach(code => aggregate.zoneCodes.add(code));
        } else {
          aggregates.set(location.id, {
            location: { ...location },
            coordinateWeight: weight,
            latWeightedSum: location.lat * weight,
            lonWeightedSum: location.lon * weight,
            zoneCodes: new Set(codes),
            isConnectionStop,
          });
        }
      });
    });
    return {
      filteredLocations: [...aggregates.values()].map(aggregate => ({
        ...aggregate.location,
        lat: aggregate.latWeightedSum / aggregate.coordinateWeight,
        lon: aggregate.lonWeightedSum / aggregate.coordinateWeight,
        zoneCodes: [...aggregate.zoneCodes].sort(),
        isConnectionStop: aggregate.isConnectionStop,
      })).sort((a, b) => (b.pickups + b.dropoffs) - (a.pickups + a.dropoffs)),
      usedVersionIds: used,
      unversionedDateCount: [...effectiveVersionsByDate.values()].filter(version => version === null).length,
    };
  }, [effectiveVersionsByDate, reports, versions, zoneFilter]);
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

  return (
    <ChartCard
      title="Transit On Demand Activity Map"
      subtitle="Automatically imported daily pickup and drop-off activity for the selected Ridership period"
    >
      <div className="space-y-4">
        <div className="flex flex-col gap-3 rounded-xl border border-gray-200 bg-gray-50 p-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="inline-flex w-fit rounded-lg border border-gray-200 bg-white p-1 shadow-sm" aria-label="TOD map metric">
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
          <div className="flex flex-wrap items-center gap-1.5" aria-label="TOD zone filter">
            {[{ code: 'all', label: 'All' }, ...availableZones.map(zone => ({ code: zone.code, label: zone.code })), { code: 'multi-zone', label: 'Multi-zone' }, { code: 'unassigned', label: 'Unassigned' }].map(option => (
              <button key={option.code} type="button" aria-pressed={zoneFilter === option.code} onClick={() => setZoneFilter(option.code)} className={`rounded-full border px-2.5 py-1 text-xs font-bold ${zoneFilter === option.code ? 'border-violet-700 bg-violet-700 text-white' : 'border-violet-200 bg-white text-violet-800'}`}>{option.label}</button>
            ))}
            <label className="ml-1 inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600"><input type="checkbox" checked={showAllStops} onChange={event => setShowAllStops(event.target.checked)} />All City stops</label>
          </div>
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
        ) : (
          <TodActivityMap locations={filteredLocations} metric={metric} zoneVersion={overlayVersion} cityStops={cityStopsQuery.data} showAllStops={showAllStops} />
        )}
        {editorOpen && teamId && userId && <TodZoneEditor open teamId={teamId} userId={userId} onClose={() => setEditorOpen(false)} />}
      </div>
    </ChartCard>
  );
};
