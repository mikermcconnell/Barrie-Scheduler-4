import React from 'react';
import { AlertTriangle, ArrowRightLeft, Construction, MapPin } from 'lucide-react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import type { TodActivityMetric } from '../../utils/todPickupAggregation';
import type {
  TodTrendGrain,
  TodZonePerformance,
  TodZonePerformanceRow,
  TodZoneTopStop,
  TodZoneTrendPoint,
} from '../../utils/todZones/todZonePerformance';

interface TodZonePerformanceViewProps {
  performance: TodZonePerformance;
  metric: TodActivityMetric;
  selectedZone: string;
  onSelectedZoneChange: (zoneCode: string) => void;
  trendGrain: TodTrendGrain;
  onTrendGrainChange: (grain: TodTrendGrain) => void;
  trend: TodZoneTrendPoint[];
  unversionedDateCount: number;
  effectiveFrom?: string;
}

function metricLabel(metric: TodActivityMetric): string {
  if (metric === 'pickups') return 'pickups';
  if (metric === 'dropoffs') return 'drop-offs';
  return 'activity';
}

function percentage(value: number): string {
  return `${(value * 100).toFixed(value > 0 && value < 0.01 ? 1 : 0)}%`;
}

function shortDate(date?: string): string {
  if (!date) return 'the published effective date';
  return new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

const StopList: React.FC<{ stops: TodZoneTopStop[]; label: string }> = ({ stops, label }) => (
  <ol className="mt-3 divide-y divide-gray-100">
    {stops.length > 0 ? stops.map((stop, index) => (
      <li key={stop.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="w-4 shrink-0 text-xs font-bold text-gray-400">{index + 1}</span>
            <span className="truncate font-semibold text-gray-800">{stop.name}</span>
            {stop.isConnectionStop && (
              <span title="Connection stop" className="inline-flex shrink-0 items-center gap-1 rounded-full bg-blue-50 px-1.5 py-0.5 text-[10px] font-bold text-blue-700">
                <ArrowRightLeft size={10} />Connection
              </span>
            )}
          </div>
          <div className="ml-6 mt-0.5 text-xs text-gray-500">
            {stop.pickups.toLocaleString()} pickups · {stop.dropoffs.toLocaleString()} drop-offs
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className="font-extrabold tabular-nums text-gray-900">{stop.value.toLocaleString()}</div>
          <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">{label}</div>
        </div>
      </li>
    )) : (
      <li className="py-8 text-center text-sm text-gray-500">No activity for this selection.</li>
    )}
  </ol>
);

export const TodZonePerformanceView: React.FC<TodZonePerformanceViewProps> = ({
  performance,
  metric,
  selectedZone,
  onSelectedZoneChange,
  trendGrain,
  onTrendGrainChange,
  trend,
  unversionedDateCount,
  effectiveFrom,
}) => {
  const label = metricLabel(metric);
  const selectedRow = performance.rows.find(row => row.code === selectedZone);
  const selected = selectedZone === 'unassigned' ? performance.unassigned : selectedRow;
  const selectedName = selectedZone === 'unassigned' ? 'Unassigned' : selectedRow?.label ?? `Zone ${selectedZone}`;
  const zoneF = performance.rows.find(row => row.code === 'F');
  const zoneT = performance.rows.find(row => row.code === 'T');
  const constructionTotal = (zoneF?.value ?? 0) + (zoneT?.value ?? 0);

  return (
    <div className="space-y-4">
      {performance.unassigned.value > 0 && (
        <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <AlertTriangle size={17} className="mt-0.5 shrink-0 text-amber-600" />
          <div>
            <div className="font-bold">Unassigned activity needs review</div>
            <p className="mt-0.5 text-xs leading-5 text-amber-800">
              {performance.unassigned.activeStops.toLocaleString()} active location{performance.unassigned.activeStops === 1 ? '' : 's'} account for{' '}
              {performance.unassigned.value.toLocaleString()} {label} ({percentage(performance.unassigned.activityShare)} of the selected-period total).
              {unversionedDateCount > 0 ? ` ${unversionedDateCount} service date${unversionedDateCount === 1 ? '' : 's'} predates an effective publication; those records are intentionally unassigned.` : ''}
            </p>
          </div>
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
        <div className="border-b border-gray-200 bg-gray-50 px-4 py-3">
          <div className="text-sm font-bold text-gray-900">Zone performance summary</div>
          <p className="mt-0.5 text-xs text-gray-500">
            Each zone receives the full activity of shared stops. Coverage shares can overlap, so zone rows must not be added together.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="border-b border-gray-200 bg-white text-[11px] uppercase tracking-wide text-gray-500">
              <tr>
                <th scope="col" className="px-4 py-2.5 font-bold">Zone</th>
                <th scope="col" className="px-3 py-2.5 text-right font-bold">{label}</th>
                <th scope="col" className="px-3 py-2.5 text-right font-bold">Pickups</th>
                <th scope="col" className="px-3 py-2.5 text-right font-bold">Drop-offs</th>
                <th scope="col" className="px-3 py-2.5 text-right font-bold">Coverage share</th>
                <th scope="col" className="px-3 py-2.5 text-right font-bold">Active stops</th>
                <th scope="col" className="px-4 py-2.5 text-right font-bold">Connection share</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {performance.rows.map(row => (
                <tr key={row.code} className={selectedZone === row.code ? 'bg-blue-50/70' : 'hover:bg-gray-50'}>
                  <td className="p-0">
                    <button
                      type="button"
                      onClick={() => onSelectedZoneChange(row.code)}
                      className="flex w-full items-center gap-2 px-4 py-3 text-left font-bold text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500"
                      aria-pressed={selectedZone === row.code}
                    >
                      <span className="h-3 w-3 rounded-full border border-black/10" style={{ backgroundColor: row.color }} />
                      {row.label}
                    </button>
                  </td>
                  <td className="px-3 py-3 text-right font-extrabold tabular-nums text-gray-900">{row.value.toLocaleString()}</td>
                  <td className="px-3 py-3 text-right tabular-nums text-gray-600">{row.pickups.toLocaleString()}</td>
                  <td className="px-3 py-3 text-right tabular-nums text-gray-600">{row.dropoffs.toLocaleString()}</td>
                  <td className="px-3 py-3 text-right font-semibold tabular-nums text-gray-700">{percentage(row.activityShare)}</td>
                  <td className="px-3 py-3 text-right tabular-nums text-gray-600">{row.activeStops.toLocaleString()}</td>
                  <td className="px-4 py-3 text-right font-semibold tabular-nums text-gray-700">{percentage(row.connectionShare)}</td>
                </tr>
              ))}
              <tr className={selectedZone === 'unassigned' ? 'bg-amber-50' : 'bg-gray-50/70 hover:bg-amber-50/60'}>
                <td className="p-0">
                  <button
                    type="button"
                    onClick={() => onSelectedZoneChange('unassigned')}
                    className="flex w-full items-center gap-2 px-4 py-3 text-left font-bold text-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-amber-500"
                    aria-pressed={selectedZone === 'unassigned'}
                  >
                    <span className="h-3 w-3 rounded-full border border-gray-300 bg-white" />Unassigned
                  </button>
                </td>
                <td className="px-3 py-3 text-right font-extrabold tabular-nums text-gray-900">{performance.unassigned.value.toLocaleString()}</td>
                <td className="px-3 py-3 text-right tabular-nums text-gray-600">{performance.unassigned.pickups.toLocaleString()}</td>
                <td className="px-3 py-3 text-right tabular-nums text-gray-600">{performance.unassigned.dropoffs.toLocaleString()}</td>
                <td className="px-3 py-3 text-right font-semibold tabular-nums text-gray-700">{percentage(performance.unassigned.activityShare)}</td>
                <td className="px-3 py-3 text-right tabular-nums text-gray-600">{performance.unassigned.activeStops.toLocaleString()}</td>
                <td className="px-4 py-3 text-right text-gray-400">—</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <section className="rounded-xl border border-gray-200 bg-white p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-sm font-bold text-gray-900">{selectedName} trend</div>
              <div className="mt-0.5 text-xs text-gray-500">Selected-period {label}; not a unique-rider count</div>
            </div>
            <div className="inline-flex rounded-lg border border-gray-200 bg-gray-50 p-0.5" aria-label="TOD trend interval">
              {(['daily', 'weekly'] as TodTrendGrain[]).map(grain => (
                <button
                  key={grain}
                  type="button"
                  aria-pressed={trendGrain === grain}
                  onClick={() => onTrendGrainChange(grain)}
                  className={`rounded-md px-2.5 py-1 text-xs font-bold capitalize ${trendGrain === grain ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}
                >
                  {grain}
                </button>
              ))}
            </div>
          </div>
          <div className="mt-4 h-56" aria-label={`${selectedName} ${trendGrain} ${label} trend`}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={trend} margin={{ top: 8, right: 10, bottom: 4, left: -12 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#6b7280' }} tickLine={false} axisLine={false} minTickGap={20} />
                <YAxis tick={{ fontSize: 10, fill: '#6b7280' }} tickLine={false} axisLine={false} allowDecimals={false} />
                <Tooltip />
                <Line type="monotone" dataKey="value" name={label} stroke={selectedRow?.color ?? '#d97706'} strokeWidth={2.5} dot={{ r: 3 }} activeDot={{ r: 5 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </section>

        <section className="rounded-xl border border-gray-200 bg-white p-4">
          <div className="flex items-center gap-2 text-sm font-bold text-gray-900"><MapPin size={15} className="text-gray-400" />Top stops · {selectedName}</div>
          <div className="mt-0.5 text-xs text-gray-500">Ranked by selected {label}</div>
          <StopList stops={selected?.topStops ?? []} label={label} />
        </section>
      </div>

      {(zoneF || zoneT) && (
        <section className="rounded-xl border border-gray-200 bg-gray-50 p-4">
          <div className="flex items-start gap-3">
            <div className="rounded-lg bg-white p-2 text-amber-700 shadow-sm"><Construction size={18} /></div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-bold text-gray-900">F / Temporary T construction watch</div>
              <p className="mt-0.5 text-xs leading-5 text-gray-500">
                Current configuration from {shortDate(effectiveFrom)}. This compares activity captured in F and T; it does not claim a construction impact or provide a pre-construction baseline.
              </p>
              <div className="mt-3 grid gap-2 sm:grid-cols-3">
                {[zoneF, zoneT].filter((row): row is TodZonePerformanceRow => !!row).map(row => (
                  <button key={row.code} type="button" onClick={() => onSelectedZoneChange(row.code)} className="rounded-lg border border-gray-200 bg-white p-3 text-left shadow-sm hover:border-gray-300">
                    <div className="flex items-center gap-2 text-xs font-bold text-gray-600"><span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: row.color }} />{row.label}</div>
                    <div className="mt-1 text-xl font-extrabold tabular-nums text-gray-900">{row.value.toLocaleString()}</div>
                    <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">{label}</div>
                  </button>
                ))}
                <div className="rounded-lg border border-gray-200 bg-white p-3 shadow-sm">
                  <div className="text-xs font-bold text-gray-600">Temporary T share of F + T</div>
                  <div className="mt-1 text-xl font-extrabold tabular-nums text-gray-900">{constructionTotal > 0 ? percentage((zoneT?.value ?? 0) / constructionTotal) : '0%'}</div>
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">overlapping coverage</div>
                </div>
              </div>
            </div>
          </div>
        </section>
      )}
    </div>
  );
};
