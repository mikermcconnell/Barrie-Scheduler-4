import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Calendar, Loader2, Upload } from 'lucide-react';
import { ChartCard } from '../Analytics/AnalyticsShared';
import { useAuth } from '../contexts/AuthContext';
import { useTeam } from '../contexts/TeamContext';
import { useSaveTodPickupMonth, useTodPickupDataQuery, useTodPickupMetadataQuery } from '../../hooks/useTodPickupData';
import { aggregateTodPickupStops, getLatestTodPickupMonth, getTodPickupMonthOptions } from '../../utils/todPickupAggregation';
import { parseTodPickupCsvFile } from '../../utils/todPickupParser';
import { TodPickupMap } from './TodPickupMap';

type MonthMode = 'latest' | 'all' | 'custom';

function currentMonthValue(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function formatMonth(month: string): string {
  const [year, monthPart] = month.split('-').map(Number);
  if (!year || !monthPart) return month;
  return new Date(year, monthPart - 1, 1).toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
  });
}

export const TodPickupSection: React.FC = () => {
  const { team, canManageTeam } = useTeam();
  const { user } = useAuth();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [monthMode, setMonthMode] = useState<MonthMode>('latest');
  const [customMonths, setCustomMonths] = useState<string[]>([]);
  const [uploadMonth, setUploadMonth] = useState(currentMonthValue());
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [error, setError] = useState('');

  const metadataQuery = useTodPickupMetadataQuery(team?.id);
  const dataQuery = useTodPickupDataQuery(team?.id, !!metadataQuery.data, metadataQuery.data);
  const saveMutation = useSaveTodPickupMonth(team?.id);

  const monthOptions = useMemo(() => getTodPickupMonthOptions(dataQuery.data), [dataQuery.data]);
  const latestMonth = useMemo(() => getLatestTodPickupMonth(dataQuery.data), [dataQuery.data]);

  useEffect(() => {
    if (monthMode !== 'custom' || customMonths.length > 0 || !latestMonth) return;
    setCustomMonths([latestMonth]);
  }, [customMonths.length, latestMonth, monthMode]);

  const selectedMonths = useMemo(() => {
    if (monthMode === 'all') return monthOptions;
    if (monthMode === 'custom') return customMonths.filter(month => monthOptions.includes(month));
    return latestMonth ? [latestMonth] : [];
  }, [customMonths, latestMonth, monthMode, monthOptions]);

  const stops = useMemo(
    () => aggregateTodPickupStops(dataQuery.data?.months || [], selectedMonths),
    [dataQuery.data?.months, selectedMonths],
  );

  const totalPickups = stops.reduce((sum, stop) => sum + stop.pickups, 0);
  const isLoading = metadataQuery.isLoading || dataQuery.isLoading;
  const selectedLabel = selectedMonths.length === 0
    ? 'No month selected'
    : selectedMonths.length === 1
      ? formatMonth(selectedMonths[0])
      : `${selectedMonths.length} months`;

  const toggleCustomMonth = (month: string) => {
    setCustomMonths(prev => prev.includes(month)
      ? prev.filter(value => value !== month)
      : [...prev, month].sort());
  };

  const handleImport = async () => {
    setError('');
    setWarnings([]);
    if (!team?.id || !user?.uid) {
      setError('Sign in and select a team before importing TOD pickup data.');
      return;
    }
    if (!canManageTeam) {
      setError('Only team owners and admins can import TOD pickup data.');
      return;
    }
    if (!selectedFile) {
      setError('Choose a TOD pickup CSV first.');
      return;
    }

    try {
      const result = await parseTodPickupCsvFile(selectedFile, uploadMonth, user.uid);
      await saveMutation.mutateAsync({ userId: user.uid, dataset: result.dataset });
      setWarnings(result.warnings);
      setSelectedFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      setMonthMode('custom');
      setCustomMonths([uploadMonth]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'TOD pickup import failed.');
    }
  };

  return (
    <ChartCard
      title="Transit On Demand Pickups"
      subtitle="Upload monthly pickup rows and map pickup counts by stop or location"
    >
      <div className="space-y-4">
        <div className="flex flex-col gap-3 rounded-xl border border-purple-100 bg-purple-50/40 p-3 lg:flex-row lg:items-end lg:justify-between">
          {canManageTeam ? (
            <div className="flex flex-wrap items-end gap-3">
              <label className="block">
                <span className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-gray-500">Data month</span>
                <input
                  type="month"
                  value={uploadMonth}
                  onChange={event => setUploadMonth(event.target.value)}
                  className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-700 shadow-sm focus:border-purple-400 focus:outline-none focus:ring-2 focus:ring-purple-100"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-gray-500">TOD pickup CSV</span>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv,text/csv"
                  onChange={event => {
                    setError('');
                    setWarnings([]);
                    setSelectedFile(event.target.files?.[0] ?? null);
                  }}
                  className="block max-w-xs text-sm text-gray-600 file:mr-3 file:rounded-lg file:border-0 file:bg-white file:px-3 file:py-2 file:text-sm file:font-bold file:text-purple-700 file:shadow-sm hover:file:bg-purple-50"
                />
              </label>
              <button
                type="button"
                onClick={handleImport}
                disabled={!selectedFile || saveMutation.isPending}
                className="inline-flex items-center gap-2 rounded-lg bg-purple-600 px-4 py-2 text-sm font-bold text-white transition-colors hover:bg-purple-700 disabled:cursor-not-allowed disabled:bg-gray-300"
              >
                {saveMutation.isPending ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
                Import month
              </button>
            </div>
          ) : (
            <div className="text-sm text-purple-900">
              <div className="font-bold">TOD pickup imports are owner/admin only.</div>
              <div className="text-purple-700">Ask a team owner or admin to upload new monthly data.</div>
            </div>
          )}
          <div className="flex items-center gap-2 text-sm text-purple-900">
            <Calendar size={16} />
            <span className="font-semibold">{selectedLabel}</span>
            <span className="text-purple-500">·</span>
            <span>{totalPickups.toLocaleString()} pickups</span>
          </div>
        </div>

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">
            {error}
          </div>
        )}
        {warnings.length > 0 && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            {warnings.map(warning => <div key={warning}>{warning}</div>)}
          </div>
        )}

        {monthOptions.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-bold uppercase tracking-wide text-gray-400">Show</span>
            {(['latest', 'all', 'custom'] as MonthMode[]).map(mode => (
              <button
                key={mode}
                type="button"
                onClick={() => setMonthMode(mode)}
                className={`rounded-full border px-3 py-1 text-xs font-bold transition-colors ${
                  monthMode === mode
                    ? 'border-purple-300 bg-purple-100 text-purple-700'
                    : 'border-gray-200 bg-white text-gray-500 hover:bg-gray-50'
                }`}
              >
                {mode === 'latest' ? 'Latest month' : mode === 'all' ? 'All months' : 'Some months'}
              </button>
            ))}
            {monthMode === 'custom' && (
              <div className="ml-1 flex flex-wrap gap-1.5">
                {monthOptions.map(month => (
                  <button
                    key={month}
                    type="button"
                    onClick={() => toggleCustomMonth(month)}
                    className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${
                      customMonths.includes(month)
                        ? 'border-purple-300 bg-purple-600 text-white'
                        : 'border-gray-200 bg-white text-gray-500 hover:bg-gray-50'
                    }`}
                  >
                    {formatMonth(month)}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {isLoading ? (
          <div className="grid h-64 place-items-center text-sm font-semibold text-gray-500">
            <span className="inline-flex items-center gap-2"><Loader2 size={16} className="animate-spin" /> Loading TOD pickup data...</span>
          </div>
        ) : monthOptions.length === 0 ? (
          <div className="grid h-64 place-items-center rounded-lg border border-dashed border-gray-300 bg-gray-50 p-6 text-center">
            <div>
              <div className="text-sm font-bold text-gray-700">No TOD pickup data uploaded yet</div>
              <p className="mt-1 text-sm text-gray-500">Choose a month and upload the monthly pickup CSV to create the map.</p>
            </div>
          </div>
        ) : (
          <TodPickupMap stops={stops} />
        )}
      </div>
    </ChartCard>
  );
};
