import React, { useMemo, useRef, useState } from 'react';
import { CalendarDays, Loader2, Upload } from 'lucide-react';
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ChartCard } from '../Analytics/AnalyticsShared';
import { useAuth } from '../contexts/AuthContext';
import { useTeam } from '../contexts/TeamContext';
import { useSaveTodDailyKpi, useTodPickupDataQuery, useTodPickupMetadataQuery } from '../../hooks/useTodPickupData';
import { parseTodDailyKpiWorkbook } from '../../utils/todDailyKpiParser';
import type { TodDailyKpiLocation } from '../../utils/todPickupTypes';

interface TodDailyKpiSectionProps {
  includedDates: string[];
}

function previousDateValue(): string {
  const date = new Date();
  date.setDate(date.getDate() - 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function shortDate(date: string): string {
  return new Date(`${date}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function aggregateLocations(locations: TodDailyKpiLocation[]): TodDailyKpiLocation[] {
  const result = new Map<string, TodDailyKpiLocation>();
  for (const location of locations) {
    const current = result.get(location.id);
    if (current) {
      current.pickups += location.pickups;
      current.dropoffs += location.dropoffs;
    } else {
      result.set(location.id, { ...location });
    }
  }
  return [...result.values()];
}

function LocationList({ title, locations, value }: {
  title: string;
  locations: TodDailyKpiLocation[];
  value: 'pickups' | 'dropoffs';
}) {
  const rows = [...locations]
    .filter(location => location[value] > 0)
    .sort((a, b) => b[value] - a[value] || a.name.localeCompare(b.name, undefined, { numeric: true }))
    .slice(0, 5);
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="mb-3 text-xs font-bold uppercase tracking-wide text-gray-500">{title}</div>
      <div className="space-y-2">
        {rows.map((location, index) => (
          <div key={location.id} className="flex items-center gap-3 text-sm">
            <span className="w-5 text-right text-xs font-bold text-gray-400">{index + 1}</span>
            <span className="min-w-0 flex-1 truncate font-semibold text-gray-700">{location.name}</span>
            <span className="font-bold tabular-nums text-gray-900">{location[value].toLocaleString()}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export const TodDailyKpiSection: React.FC<TodDailyKpiSectionProps> = ({ includedDates }) => {
  const { team, canManageTeam } = useTeam();
  const { user } = useAuth();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [serviceDate, setServiceDate] = useState(previousDateValue());
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [error, setError] = useState('');

  const metadataQuery = useTodPickupMetadataQuery(team?.id);
  const dataQuery = useTodPickupDataQuery(team?.id, !!metadataQuery.data, metadataQuery.data);
  const saveMutation = useSaveTodDailyKpi(team?.id);
  const includedDateSet = useMemo(() => new Set(includedDates), [includedDates]);
  const reports = useMemo(
    () => (dataQuery.data?.dailyReports || []).filter(report => includedDateSet.has(report.date)),
    [dataQuery.data?.dailyReports, includedDateSet],
  );
  const totalTrips = reports.reduce((sum, report) => sum + report.totalCompletedTrips, 0);
  const allLocations = useMemo(
    () => aggregateLocations(reports.flatMap(report => report.locations)),
    [reports],
  );
  const trend = reports.map(report => ({
    date: shortDate(report.date),
    fullDate: report.date,
    trips: report.totalCompletedTrips,
  })).sort((a, b) => a.fullDate.localeCompare(b.fullDate));
  const isLoading = metadataQuery.isLoading || dataQuery.isLoading;
  const hasStoredReports = (dataQuery.data?.dailyReports?.length || 0) > 0;

  const handleImport = async () => {
    setError('');
    setWarnings([]);
    if (!team?.id || !user?.uid) {
      setError('Sign in and select a team before importing a TOD KPI workbook.');
      return;
    }
    if (!canManageTeam) {
      setError('Only team owners and admins can import TOD KPI workbooks.');
      return;
    }
    if (!selectedFile) {
      setError('Choose the TOD KPI workbook first.');
      return;
    }
    try {
      const parsed = await parseTodDailyKpiWorkbook(selectedFile, serviceDate, user.uid);
      await saveMutation.mutateAsync({ userId: user.uid, dataset: parsed.dataset });
      setWarnings(parsed.warnings);
      setSelectedFile(null);
      if (fileRef.current) fileRef.current.value = '';
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'TOD KPI import failed.');
    }
  };

  return (
    <ChartCard
      title="Transit On Demand Ridership"
      subtitle="Completed trips from the daily Licensee KPI email report; system-wide and separate from fixed-route APC boardings"
    >
      <div className="space-y-4">
        <div className="flex flex-col gap-3 rounded-xl border border-blue-100 bg-blue-50/50 p-3 lg:flex-row lg:items-end lg:justify-between">
          {canManageTeam ? (
            <div className="flex flex-wrap items-end gap-3">
              <label className="block">
                <span className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-gray-500">Service date</span>
                <input
                  type="date"
                  value={serviceDate}
                  onChange={event => setServiceDate(event.target.value)}
                  className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-700 shadow-sm focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-gray-500">Licensee KPI workbook</span>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
                  onChange={event => {
                    setError('');
                    setWarnings([]);
                    setSelectedFile(event.target.files?.[0] ?? null);
                  }}
                  className="block max-w-xs text-sm text-gray-600 file:mr-3 file:rounded-lg file:border-0 file:bg-white file:px-3 file:py-2 file:text-sm file:font-bold file:text-blue-700 file:shadow-sm hover:file:bg-blue-50"
                />
              </label>
              <button
                type="button"
                onClick={handleImport}
                disabled={!selectedFile || saveMutation.isPending}
                className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-300"
              >
                {saveMutation.isPending ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
                Import day
              </button>
            </div>
          ) : (
            <div className="text-sm text-blue-900">
              <div className="font-bold">Daily TOD imports are owner/admin only.</div>
              <div className="text-blue-700">Ask a team owner or admin to upload the emailed workbook.</div>
            </div>
          )}
          <div className="flex items-center gap-2 text-sm text-blue-900">
            <CalendarDays size={16} />
            <span className="font-semibold">{reports.length.toLocaleString()} imported day{reports.length === 1 ? '' : 's'}</span>
          </div>
        </div>

        {error && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">{error}</div>}
        {warnings.length > 0 && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            {warnings.map(warning => <div key={warning}>{warning}</div>)}
          </div>
        )}

        {isLoading ? (
          <div className="grid h-48 place-items-center text-sm font-semibold text-gray-500">
            <span className="inline-flex items-center gap-2"><Loader2 size={16} className="animate-spin" /> Loading TOD ridership...</span>
          </div>
        ) : reports.length === 0 ? (
          <div className="grid h-48 place-items-center rounded-lg border border-dashed border-gray-300 bg-gray-50 p-6 text-center">
            <div>
              <div className="text-sm font-bold text-gray-700">{hasStoredReports ? 'No TOD report in the selected Ridership period' : 'No daily TOD KPI reports uploaded yet'}</div>
              <p className="mt-1 text-sm text-gray-500">Select the report's service date and upload the emailed Licensee KPI workbook.</p>
            </div>
          </div>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
                <div className="text-xs font-bold uppercase tracking-wide text-gray-500">Completed trips</div>
                <div className="mt-1 text-2xl font-black text-gray-900">{totalTrips.toLocaleString()}</div>
              </div>
              <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
                <div className="text-xs font-bold uppercase tracking-wide text-gray-500">Average per imported day</div>
                <div className="mt-1 text-2xl font-black text-gray-900">{Math.round(totalTrips / reports.length).toLocaleString()}</div>
              </div>
              <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
                <div className="text-xs font-bold uppercase tracking-wide text-gray-500">Imported service days</div>
                <div className="mt-1 text-2xl font-black text-gray-900">{reports.length.toLocaleString()}</div>
              </div>
            </div>

            <div className="h-56 rounded-xl border border-gray-200 bg-white p-3">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={trend} margin={{ top: 12, right: 20, left: 0, bottom: 0 }}>
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11 }} width={42} />
                  <Tooltip formatter={(value: number) => [value.toLocaleString(), 'Completed trips']} />
                  <Line type="monotone" dataKey="trips" stroke="#2563eb" strokeWidth={3} dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>

            <div className="grid gap-3 lg:grid-cols-2">
              <LocationList title="Top pickup locations" locations={allLocations} value="pickups" />
              <LocationList title="Top drop-off locations" locations={allLocations} value="dropoffs" />
            </div>
          </>
        )}
      </div>
    </ChartCard>
  );
};
