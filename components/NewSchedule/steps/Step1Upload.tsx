
import React, { useCallback, useMemo } from 'react';
import { useDropzone } from 'react-dropzone';
import { Upload, FileUp, X, Calendar, Database, FileSpreadsheet, BarChart3, AlertTriangle } from 'lucide-react';
import { GTFSImport } from '../../GTFSImport';
import type { GTFSImportResult } from '../../../utils/gtfs/gtfsTypes';
import type { AvailableRuntimeRoute } from '../../../utils/performanceRuntimeComputer';
import type { PerformanceRuntimeDiagnostics } from '../../../utils/performanceRuntimeComputer';

export type ImportMode = 'csv' | 'gtfs' | 'performance';

export interface PerformanceConfig {
    routeId: string;
    dateRange: { start: string; end: string } | null; // null = use all data
}

interface Step1Props {
    files: File[];
    setFiles: (files: File[]) => void;
    dayType: 'Weekday' | 'Saturday' | 'Sunday';
    setDayType: (type: 'Weekday' | 'Saturday' | 'Sunday') => void;
    userId?: string;
    onGTFSImport?: (result: GTFSImportResult) => void;
    importMode: ImportMode;
    setImportMode: (mode: ImportMode) => void;
    availableRoutes?: AvailableRuntimeRoute[];
    performanceConfig?: PerformanceConfig;
    onPerformanceConfigChange?: (config: PerformanceConfig) => void;
    performanceDataLoading?: boolean;
    performanceDateRange?: { start: string; end: string };
    performanceDiagnostics?: PerformanceRuntimeDiagnostics | null;
}

type DurationPreset = 'day' | 'week' | 'month' | 'three-months';

const DURATION_PRESETS: { id: DurationPreset; label: string; days: number }[] = [
    { id: 'day', label: 'Past day', days: 1 },
    { id: 'week', label: 'Past week', days: 7 },
    { id: 'month', label: 'Past month', days: 30 },
    { id: 'three-months', label: 'Past 3 months', days: 90 },
];

const toLocalIsoDate = (date: Date): string => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
};

const parseIsoDateAtNoon = (isoDate: string): Date => new Date(`${isoDate}T12:00:00`);

const clampDate = (value: string, min: string, max: string): string => {
    if (value < min) return min;
    if (value > max) return max;
    return value;
};

const buildPresetRange = (
    availableRange: { start: string; end: string },
    days: number
): { start: string; end: string } => {
    const endDate = parseIsoDateAtNoon(availableRange.end);
    const startDate = new Date(endDate);
    startDate.setDate(startDate.getDate() - (days - 1));

    return {
        start: clampDate(toLocalIsoDate(startDate), availableRange.start, availableRange.end),
        end: availableRange.end,
    };
};

export const Step1Upload: React.FC<Step1Props> = ({
    files,
    setFiles,
    dayType,
    setDayType,
    userId,
    onGTFSImport,
    importMode,
    setImportMode,
    availableRoutes,
    performanceConfig,
    onPerformanceConfigChange,
    performanceDataLoading,
    performanceDateRange,
    performanceDiagnostics,
}) => {
    const onDrop = useCallback((acceptedFiles: File[]) => {
        // Limit to 2 files max (North/South or Single Loop)
        const newFiles = [...files, ...acceptedFiles].slice(0, 2);
        setFiles(newFiles);
    }, [files, setFiles]);

    const { getRootProps, getInputProps, isDragActive } = useDropzone({
        onDrop,
        accept: { 'text/csv': ['.csv'], 'application/vnd.ms-excel': ['.csv'] },
        maxFiles: 2
    });

    const removeFile = (index: number) => {
        const newFiles = [...files];
        newFiles.splice(index, 1);
        setFiles(newFiles);
    };

    const handleGTFSImportComplete = (result: GTFSImportResult) => {
        if (onGTFSImport) {
            onGTFSImport(result);
        }
    };

    const activeDurationPreset = useMemo<DurationPreset | null>(() => {
        const currentRange = performanceConfig?.dateRange;
        if (!performanceDateRange || !currentRange) return null;
        const matchedPreset = DURATION_PRESETS.find((preset) => {
            const range = buildPresetRange(performanceDateRange, preset.days);
            return range.start === currentRange.start && range.end === currentRange.end;
        });
        return matchedPreset?.id || null;
    }, [performanceDateRange, performanceConfig?.dateRange]);

    const applyDurationPreset = (preset: { id: DurationPreset; days: number }) => {
        if (!performanceDateRange) return;
        const nextRange = buildPresetRange(performanceDateRange, preset.days);
        onPerformanceConfigChange?.({
            routeId: performanceConfig?.routeId || '',
            dateRange: nextRange,
        });
    };

    const setPerformanceDateRange = (dateRange: { start: string; end: string } | null) => {
        onPerformanceConfigChange?.({
            routeId: performanceConfig?.routeId || '',
            dateRange,
        });
    };

    return (
        <div className="space-y-8 animate-in fade-in duration-500">
            <div className="text-center space-y-2">
                <h2 className="text-2xl font-bold text-gray-900">Let's Get Started</h2>
                <p className="text-gray-500">Choose how you want to create your schedule.</p>
            </div>

            {/* Import Mode Selector */}
            <div className="grid grid-cols-3 gap-4 max-w-3xl mx-auto">
                <button
                    onClick={() => setImportMode('csv')}
                    className={`flex flex-col items-center p-6 rounded-xl border-2 transition-all duration-200 ${
                        importMode === 'csv'
                            ? 'border-brand-blue bg-blue-50 text-brand-blue shadow-md scale-[1.02]'
                            : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300 hover:bg-gray-50'
                    }`}
                >
                    <FileSpreadsheet className={`mb-3 ${importMode === 'csv' ? 'text-brand-blue' : 'text-gray-400'}`} size={32} />
                    <span className="font-bold text-lg">Create from Runtime CSV</span>
                    <span className="text-sm text-gray-500 mt-1">Build a new optimized schedule</span>
                </button>
                <button
                    onClick={() => setImportMode('performance')}
                    className={`flex flex-col items-center p-6 rounded-xl border-2 transition-all duration-200 ${
                        importMode === 'performance'
                            ? 'border-teal-500 bg-teal-50 text-teal-600 shadow-md scale-[1.02]'
                            : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300 hover:bg-gray-50'
                    }`}
                >
                    <BarChart3 className={`mb-3 ${importMode === 'performance' ? 'text-teal-600' : 'text-gray-400'}`} size={32} />
                    <span className="font-bold text-lg">Create from Performance Data</span>
                    <span className="text-sm text-gray-500 mt-1">Use imported STREETS runtimes</span>
                </button>
                <button
                    onClick={() => setImportMode('gtfs')}
                    className={`flex flex-col items-center p-6 rounded-xl border-2 transition-all duration-200 ${
                        importMode === 'gtfs'
                            ? 'border-indigo-500 bg-indigo-50 text-indigo-600 shadow-md scale-[1.02]'
                            : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300 hover:bg-gray-50'
                    }`}
                >
                    <Database className={`mb-3 ${importMode === 'gtfs' ? 'text-indigo-600' : 'text-gray-400'}`} size={32} />
                    <span className="font-bold text-lg">Import from GTFS</span>
                    <span className="text-sm text-gray-500 mt-1">Import existing Barrie Transit schedule</span>
                </button>
            </div>

            {/* CSV Upload Mode */}
            {importMode === 'csv' && (
                <>
                    {/* Day Type Selector */}
                    <div className="grid grid-cols-3 gap-4 max-w-2xl mx-auto">
                        {(['Weekday', 'Saturday', 'Sunday'] as const).map((type) => (
                            <button
                                key={type}
                                onClick={() => setDayType(type)}
                                className={`flex flex-col items-center p-4 rounded-xl border-2 transition-all duration-200 ${dayType === type
                                        ? 'border-brand-blue bg-blue-50 text-brand-blue shadow-md scale-[1.02]'
                                        : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300 hover:bg-gray-50'
                                    }`}
                            >
                                <Calendar className={`mb-2 ${dayType === type ? 'text-brand-blue' : 'text-gray-400'}`} size={24} />
                                <span className="font-bold text-lg">{type}</span>
                            </button>
                        ))}
                    </div>

                    {/* File Upload */}
                    <div className="max-w-2xl mx-auto">
                        <div
                            {...getRootProps()}
                            className={`border-2 border-dashed rounded-2xl p-10 text-center cursor-pointer transition-all duration-200 ${isDragActive
                                    ? 'border-brand-blue bg-blue-50 scale-[1.01]'
                                    : 'border-gray-300 hover:border-brand-blue/50 hover:bg-gray-50'
                                }`}
                        >
                            <input {...getInputProps()} />
                            <div className="flex flex-col items-center space-y-4">
                                <div className="bg-gray-100 p-4 rounded-full">
                                    <Upload className="text-gray-500" size={32} />
                                </div>
                                <div>
                                    <p className="text-lg font-bold text-gray-700">Click to upload or drag and drop</p>
                                    <p className="text-sm text-gray-500">Upload your Observed Runtime CSVs (Max 2 files)</p>
                                </div>
                            </div>
                        </div>

                        {/* File List */}
                        {files.length > 0 && (
                            <div className="mt-6 space-y-3">
                                {files.map((file, idx) => (
                                    <div key={idx} className="flex items-center justify-between p-3 bg-white border border-gray-200 rounded-lg shadow-sm">
                                        <div className="flex items-center gap-3">
                                            <div className="bg-emerald-50 p-2 rounded-lg"><FileUp size={20} className="text-emerald-600" /></div>
                                            <div>
                                                <p className="text-sm font-bold text-gray-800">{file.name}</p>
                                                <p className="text-xs text-gray-500">{(file.size / 1024).toFixed(1)} KB</p>
                                            </div>
                                        </div>
                                        <button
                                            onClick={() => removeFile(idx)}
                                            className="p-1 text-gray-400 hover:text-red-500 rounded-md hover:bg-red-50 transition-colors"
                                        >
                                            <X size={18} />
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </>
            )}

            {/* Performance Data Mode */}
            {importMode === 'performance' && (
                <div className="max-w-4xl mx-auto space-y-6">
                    {/* Day Type Selector */}
                    <div className="grid grid-cols-3 gap-4">
                        {(['Weekday', 'Saturday', 'Sunday'] as const).map((type) => (
                            <button
                                key={type}
                                onClick={() => setDayType(type)}
                                className={`flex flex-col items-center p-4 rounded-xl border-2 transition-all duration-200 ${dayType === type
                                        ? 'border-teal-500 bg-teal-50 text-teal-600 shadow-md scale-[1.02]'
                                        : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300 hover:bg-gray-50'
                                    }`}
                            >
                                <Calendar className={`mb-2 ${dayType === type ? 'text-teal-600' : 'text-gray-400'}`} size={24} />
                                <span className="font-bold text-lg">{type}</span>
                            </button>
                        ))}
                    </div>

                    {performanceDataLoading ? (
                        <div className="text-center p-8 bg-gray-50 rounded-xl border border-gray-200">
                            <div className="animate-spin w-8 h-8 border-2 border-teal-500 border-t-transparent rounded-full mx-auto mb-3" />
                            <p className="text-gray-600 font-medium">Loading performance data...</p>
                        </div>
                    ) : !availableRoutes || availableRoutes.length === 0 ? (
                        <div className="text-center p-8 bg-amber-50 rounded-xl border border-amber-200">
                            <AlertTriangle className="mx-auto text-amber-400 mb-3" size={40} />
                            <p className="text-amber-800 font-medium">No segment runtime data available</p>
                            <p className="text-amber-600 text-sm mt-1">
                                Step 2 now uses clean post-fix STREETS history only. Import or re-import current-format daily data from the Performance Dashboard to start the clean history window.
                            </p>
                        </div>
                    ) : (
                        <>
                            {/* Route Selector */}
                            <div>
                                <div className="flex items-center justify-between gap-3 mb-3">
                                    <label className="block text-sm font-bold text-gray-700">Route</label>
                                    <span className="text-xs font-medium text-gray-500">
                                        {availableRoutes.length} available
                                    </span>
                                </div>
                                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                                    {availableRoutes.map((route) => {
                                        const isSelected = performanceConfig?.routeId === route.routeId;
                                        return (
                                            <button
                                                key={route.routeId}
                                                type="button"
                                                onClick={() => onPerformanceConfigChange?.({
                                                    routeId: route.routeId,
                                                    dateRange: performanceConfig?.dateRange ?? null,
                                                })}
                                                className={`rounded-2xl border-2 p-4 text-left transition-all duration-200 ${
                                                    isSelected
                                                        ? 'border-teal-500 bg-teal-50 shadow-md shadow-teal-100'
                                                        : 'border-gray-200 bg-white hover:border-teal-300 hover:bg-teal-50/40'
                                                }`}
                                                aria-pressed={isSelected}
                                            >
                                                <div className="flex items-start justify-between gap-3">
                                                    <div className="min-w-0">
                                                        <p className={`text-base font-bold ${isSelected ? 'text-teal-800' : 'text-gray-900'}`}>
                                                            Route {route.routeId}
                                                        </p>
                                                        <p className={`mt-1 text-sm leading-snug ${isSelected ? 'text-teal-700' : 'text-gray-600'}`}>
                                                            {route.routeName}
                                                        </p>
                                                    </div>
                                                    <span className={`shrink-0 rounded-full px-2 py-1 text-[11px] font-bold ${
                                                        isSelected ? 'bg-teal-100 text-teal-700' : 'bg-gray-100 text-gray-600'
                                                    }`}>
                                                        {route.dayCount} days
                                                    </span>
                                                </div>
                                                <div className="mt-3 flex flex-wrap gap-2">
                                                    <span className={`rounded-full px-2 py-1 text-[11px] font-semibold ${
                                                        isSelected ? 'bg-white text-teal-700' : 'bg-gray-50 text-gray-600'
                                                    }`}>
                                                        {route.totalObs.toLocaleString()} obs
                                                    </span>
                                                    <span className={`rounded-full px-2 py-1 text-[11px] font-semibold ${
                                                        isSelected ? 'bg-white text-teal-700' : 'bg-gray-50 text-gray-600'
                                                    }`}>
                                                        {route.segmentDayCount} runtime days
                                                    </span>
                                                    <span className={`rounded-full px-2 py-1 text-[11px] font-semibold ${
                                                        route.stopLevelDayCount > 0
                                                            ? (isSelected ? 'bg-white text-teal-700' : 'bg-gray-50 text-gray-600')
                                                            : 'bg-amber-100 text-amber-700'
                                                    }`}>
                                                        {route.stopLevelDayCount} stop-level days
                                                    </span>
                                                    {route.directions.length > 0 && (
                                                        <span className={`rounded-full px-2 py-1 text-[11px] font-semibold ${
                                                            isSelected ? 'bg-white text-teal-700' : 'bg-gray-50 text-gray-600'
                                                        }`}>
                                                            {route.directions.join(' • ')}
                                                        </span>
                                                    )}
                                                </div>
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>

                            {/* Date Range */}
                            <div>
                                <div className="flex items-center justify-between mb-2">
                                    <label className="block text-sm font-bold text-gray-700">Date Range</label>
                                    <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
                                        <input
                                            type="checkbox"
                                            checked={performanceConfig?.dateRange === null}
                                            onChange={(e) => {
                                                if (e.target.checked) {
                                                    setPerformanceDateRange(null);
                                                } else {
                                                    setPerformanceDateRange(performanceDateRange || { start: '', end: '' });
                                                }
                                            }}
                                            className="rounded border-gray-300 text-teal-600 focus:ring-teal-500"
                                        />
                                        Use All Data
                                    </label>
                                </div>
                                {performanceConfig?.dateRange !== null && (
                                    <div className="space-y-3">
                                        {performanceDateRange && (
                                            <div className="flex flex-wrap gap-2">
                                                {DURATION_PRESETS.map((preset) => (
                                                    <button
                                                        key={preset.id}
                                                        type="button"
                                                        onClick={() => applyDurationPreset(preset)}
                                                        className={`px-3 py-1.5 text-xs font-bold rounded-full border transition-colors ${
                                                            activeDurationPreset === preset.id
                                                                ? 'bg-teal-100 text-teal-700 border-teal-200'
                                                                : 'bg-white text-gray-600 border-gray-200 hover:border-teal-200 hover:text-teal-700'
                                                        }`}
                                                    >
                                                        {preset.label}
                                                    </button>
                                                ))}
                                            </div>
                                        )}
                                        <div className="grid grid-cols-2 gap-4">
                                            <input
                                                type="date"
                                                value={performanceConfig?.dateRange?.start || ''}
                                                onChange={(e) => setPerformanceDateRange({
                                                    start: e.target.value,
                                                    end: performanceConfig?.dateRange?.end || '',
                                                })}
                                                min={performanceDateRange?.start}
                                                max={performanceDateRange?.end}
                                                className="px-4 py-2.5 border-2 border-gray-200 rounded-xl text-gray-800 focus:border-teal-500 focus:ring-0 focus:outline-none"
                                            />
                                            <input
                                                type="date"
                                                value={performanceConfig?.dateRange?.end || ''}
                                                onChange={(e) => setPerformanceDateRange({
                                                    start: performanceConfig?.dateRange?.start || '',
                                                    end: e.target.value,
                                                })}
                                                min={performanceDateRange?.start}
                                                max={performanceDateRange?.end}
                                                className="px-4 py-2.5 border-2 border-gray-200 rounded-xl text-gray-800 focus:border-teal-500 focus:ring-0 focus:outline-none"
                                            />
                                        </div>
                                    </div>
                                )}
                            </div>

                            {/* Data Preview */}
                            {performanceConfig?.routeId && (
                                <div className="bg-teal-50 border border-teal-200 rounded-xl p-4">
                                    <h4 className="text-sm font-bold text-teal-800 mb-2">Data Preview</h4>
                                    {(() => {
                                        const route = availableRoutes.find(r => r.routeId === performanceConfig.routeId);
                                        if (!route) return null;
                                        return (
                                            <>
                                                <div className="grid grid-cols-3 gap-4 text-sm">
                                                    <div>
                                                        <span className="text-teal-600">Directions</span>
                                                        <p className="font-bold text-teal-900">{route.directions.join(', ')}</p>
                                                    </div>
                                                    <div>
                                                        <span className="text-teal-600">Days of Data</span>
                                                        <p className="font-bold text-teal-900">{route.dayCount}</p>
                                                    </div>
                                                    <div>
                                                        <span className="text-teal-600">Observations</span>
                                                        <p className="font-bold text-teal-900">{route.totalObs.toLocaleString()}</p>
                                                    </div>
                                                </div>
                                                {route.stopLevelDayCount === 0 && (
                                                    <p className="mt-2 text-xs text-amber-700">
                                                        This route only has older coarse runtime summaries right now. Re-import STREETS data to compute stop-level runtimes for New Schedule.
                                                    </p>
                                                )}
                                                {route.segmentDayCount < route.dayCount && (
                                                    <p className="mt-2 text-xs text-amber-700">
                                                        Segment runtimes available for {route.segmentDayCount} of {route.dayCount} days.
                                                        Re-import STREETS data to compute runtimes for all days.
                                                    </p>
                                                )}
                                                {performanceDiagnostics && (
                                                    <div className="mt-3 rounded-lg border border-teal-200 bg-white/70 p-3 text-xs text-teal-900">
                                                        <p className="font-bold text-teal-800 mb-1">Runtime Readiness Check</p>
                                                        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                                                            <div>
                                                                <span className="text-teal-600">Days in range</span>
                                                                <p className="font-bold">{performanceDiagnostics.filteredDayCount}</p>
                                                            </div>
                                                            <div>
                                                                <span className="text-teal-600">Matched days</span>
                                                                <p className="font-bold">{performanceDiagnostics.matchedRouteDayCount}</p>
                                                            </div>
                                                            <div>
                                                                <span className="text-teal-600">Stop-level rows</span>
                                                                <p className="font-bold">{performanceDiagnostics.stopEntryCount}</p>
                                                            </div>
                                                            <div>
                                                                <span className="text-teal-600">Trip-leg rows</span>
                                                                <p className="font-bold">{performanceDiagnostics.tripEntryCount}</p>
                                                            </div>
                                                        </div>
                                                        <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-2">
                                                            <div>
                                                                <span className="text-teal-600">Matched route IDs</span>
                                                                <p className="font-medium">{performanceDiagnostics.matchedRouteIds.join(', ') || 'None'}</p>
                                                            </div>
                                                            <div>
                                                                <span className="text-teal-600">Directions seen</span>
                                                                <p className="font-medium">{performanceDiagnostics.directions.join(', ') || 'None'}</p>
                                                            </div>
                                                        </div>
                                                        {performanceDiagnostics.cleanHistoryStartDate && (
                                                            <div className="mt-2 rounded-md border border-teal-100 bg-teal-50/60 px-3 py-2">
                                                                <span className="text-teal-600">Clean history window</span>
                                                                <p className="font-medium">
                                                                    Using {performanceDiagnostics.cleanHistoryStartDate} onward
                                                                    {performanceDiagnostics.excludedLegacyDayCount > 0
                                                                        ? ` • ${performanceDiagnostics.excludedLegacyDayCount} older day${performanceDiagnostics.excludedLegacyDayCount === 1 ? '' : 's'} ignored`
                                                                        : ''}
                                                                </p>
                                                            </div>
                                                        )}
                                                    </div>
                                                )}
                                            </>
                                        );
                                    })()}
                                </div>
                            )}
                        </>
                    )}
                </div>
            )}

            {/* GTFS Import Mode */}
            {importMode === 'gtfs' && userId && (
                <div className="max-w-2xl mx-auto">
                    <GTFSImport
                        userId={userId}
                        onImportComplete={handleGTFSImportComplete}
                        showHeader={false}
                        className="border-2 border-indigo-200"
                    />
                </div>
            )}

            {/* GTFS Import Mode - No User */}
            {importMode === 'gtfs' && !userId && (
                <div className="max-w-2xl mx-auto text-center p-8 bg-gray-50 rounded-xl border border-gray-200">
                    <Database className="mx-auto text-gray-300 mb-4" size={48} />
                    <p className="text-gray-600 font-medium">Sign in to import from GTFS</p>
                    <p className="text-gray-400 text-sm mt-1">
                        You need to be signed in to import schedules from the GTFS feed
                    </p>
                </div>
            )}
        </div>
    );
};
