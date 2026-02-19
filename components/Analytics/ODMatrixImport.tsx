/**
 * OD Matrix Import
 *
 * 5-phase import wizard: select → preview → geocoding → manual geocode → complete.
 * Handles Excel cross-tab OD matrix files.
 */

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { useDropzone } from 'react-dropzone';
import {
    Upload,
    CheckCircle2,
    Loader2,
    ArrowRight,
    ArrowLeft,
    X,
    AlertTriangle,
    MapPin,
} from 'lucide-react';
import { parseODMatrixFromExcel } from '../../utils/od-matrix/odMatrixParser';
import { geocodeStations, applyGeocodesToStations } from '../../utils/od-matrix/odMatrixGeocoder';
import { saveODMatrixData, saveGeocodeCache, loadGeocodeCache } from '../../utils/od-matrix/odMatrixService';
import type { ODMatrixParseResult, ODMatrixDataSummary, ODStation, GeocodeCache } from '../../utils/od-matrix/odMatrixTypes';

function formatError(prefix: string, err: unknown): string {
    return `${prefix}: ${err instanceof Error ? err.message : 'Unknown error'}`;
}

interface ODMatrixImportProps {
    teamId: string;
    userId: string;
    onImportComplete: () => void;
    onCancel: () => void;
}

type ImportPhase = 'select' | 'preview' | 'geocoding' | 'manual-geocode' | 'complete';

interface GeocodingProgress {
    current: number;
    total: number;
    stationName: string;
    status: string;
    geocoded: number;
    cached: number;
    failed: number;
}

interface PendingGeocodeResult {
    cache: GeocodeCache;
    geocoded: number;
    cached: number;
    failed: string[];
}

export const ODMatrixImport: React.FC<ODMatrixImportProps> = ({
    teamId,
    userId,
    onImportComplete,
    onCancel,
}) => {
    const [phase, setPhase] = useState<ImportPhase>('select');
    const [parseResult, setParseResult] = useState<ODMatrixParseResult | null>(null);
    const [fileName, setFileName] = useState('');
    const [dateRange, setDateRange] = useState('');
    const [errorMessage, setErrorMessage] = useState('');
    const [geocodeProgress, setGeocodeProgress] = useState<GeocodingProgress>({
        current: 0, total: 0, stationName: '', status: '', geocoded: 0, cached: 0, failed: 0,
    });
    const [completedStats, setCompletedStats] = useState<{
        stations: number; journeys: number; geocoded: number; cached: number; manual: number; failed: string[];
    } | null>(null);
    const [pendingGeocode, setPendingGeocode] = useState<PendingGeocodeResult | null>(null);
    const [manualCoords, setManualCoords] = useState<Record<string, { lat: string; lon: string }>>({});
    const [isSavingManualCoords, setIsSavingManualCoords] = useState(false);
    const abortRef = useRef<AbortController | null>(null);

    useEffect(() => {
        return () => {
            abortRef.current?.abort();
        };
    }, []);

    const handleFile = useCallback(async (file: File) => {
        if (!file.name.match(/\.xlsx?$/i)) {
            setErrorMessage('Please upload an Excel file (.xlsx or .xls)');
            return;
        }

        try {
            const buffer = await file.arrayBuffer();
            const result = parseODMatrixFromExcel(buffer);

            if (result.stationCount === 0) {
                setErrorMessage(result.warnings.join('. ') || 'No valid station data found in file');
                return;
            }

            setParseResult(result);
            setFileName(file.name);
            setErrorMessage('');
            setPhase('preview');
        } catch (err) {
            setErrorMessage(formatError('Failed to parse file', err));
        }
    }, []);

    const handleDrop = useCallback((acceptedFiles: File[]) => {
        if (acceptedFiles.length > 0) handleFile(acceptedFiles[0]);
    }, [handleFile]);

    const { getRootProps, getInputProps, isDragActive } = useDropzone({
        onDrop: handleDrop,
        accept: {
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
            'application/vnd.ms-excel': ['.xls'],
        },
        multiple: false,
    });

    const buildSummary = (stations: ODStation[]): ODMatrixDataSummary => ({
        schemaVersion: 1,
        stations,
        pairs: parseResult!.pairs,
        totalJourneys: parseResult!.totalJourneys,
        stationCount: parseResult!.stationCount,
        topPairs: parseResult!.topPairs,
        metadata: {
            importedAt: new Date().toISOString(),
            importedBy: userId,
            fileName,
            dateRange: dateRange || undefined,
            stationCount: parseResult!.stationCount,
            totalJourneys: parseResult!.totalJourneys,
        },
    });

    const listMissingGeocodes = (stations: ODStation[]): string[] => stations
        .filter(station => !station.geocode)
        .map(station => station.name);

    const parseCoordinate = (value: string): number | null => {
        const parsed = Number(value.trim());
        return Number.isFinite(parsed) ? parsed : null;
    };

    const isValidLatitude = (value: number): boolean => value >= -90 && value <= 90;
    const isValidLongitude = (value: number): boolean => value >= -180 && value <= 180;

    const handleStartGeocoding = async () => {
        if (!parseResult) return;
        setErrorMessage('');
        setPendingGeocode(null);
        setManualCoords({});
        setPhase('geocoding');

        const abortController = new AbortController();
        abortRef.current = abortController;

        let geocodedCount = 0;
        let cachedCount = 0;
        let failedCount = 0;

        try {
            const existingCache = await loadGeocodeCache(teamId);

            const geocodeResult = await geocodeStations(
                parseResult.stations,
                existingCache,
                (progress) => {
                    if (progress.status === 'cached') cachedCount++;
                    if (progress.status === 'success') geocodedCount++;
                    if (progress.status === 'failed') failedCount++;
                    setGeocodeProgress({
                        current: progress.current,
                        total: progress.total,
                        stationName: progress.stationName,
                        status: progress.status,
                        geocoded: geocodedCount,
                        cached: cachedCount,
                        failed: failedCount,
                    });
                },
                abortController.signal,
            );

            const geocodedStations = applyGeocodesToStations(parseResult.stations, geocodeResult.cache);
            const missingStations = listMissingGeocodes(geocodedStations);

            if (missingStations.length > 0) {
                const initialManualCoords: Record<string, { lat: string; lon: string }> = {};
                missingStations.forEach((stationName) => {
                    initialManualCoords[stationName] = { lat: '', lon: '' };
                });

                setPendingGeocode({
                    ...geocodeResult,
                    failed: missingStations,
                });
                setManualCoords(initialManualCoords);
                setPhase('manual-geocode');
                return;
            }

            await saveODMatrixData(teamId, userId, buildSummary(geocodedStations));
            await saveGeocodeCache(teamId, geocodeResult.cache);

            setCompletedStats({
                stations: parseResult.stationCount,
                journeys: parseResult.totalJourneys,
                geocoded: geocodeResult.geocoded,
                cached: geocodeResult.cached,
                manual: 0,
                failed: [],
            });
            setPhase('complete');
        } catch (err) {
            if (!abortController.signal.aborted) {
                setErrorMessage(formatError('Import failed', err));
                setPhase('preview');
            }
        }
    };

    const handleSkipGeocoding = async () => {
        if (!parseResult) return;
        setPhase('geocoding');

        try {
            await saveODMatrixData(teamId, userId, buildSummary(parseResult.stations));

            setCompletedStats({
                stations: parseResult.stationCount,
                journeys: parseResult.totalJourneys,
                geocoded: 0,
                cached: 0,
                manual: 0,
                failed: parseResult.stations.map(station => station.name),
            });
            setPhase('complete');
        } catch (err) {
            setErrorMessage(formatError('Import failed', err));
            setPhase('preview');
        }
    };

    const handleManualCoordChange = (
        stationName: string,
        field: 'lat' | 'lon',
        value: string
    ) => {
        setManualCoords(prev => ({
            ...prev,
            [stationName]: {
                lat: field === 'lat' ? value : (prev[stationName]?.lat || ''),
                lon: field === 'lon' ? value : (prev[stationName]?.lon || ''),
            },
        }));
    };

    const handleFinishWithManualCoords = async () => {
        if (!parseResult || !pendingGeocode) return;

        setErrorMessage('');
        setIsSavingManualCoords(true);

        try {
            const nextCache: GeocodeCache = {
                stations: { ...pendingGeocode.cache.stations },
                lastUpdated: new Date().toISOString(),
            };

            let manualCount = 0;
            pendingGeocode.failed.forEach((stationName) => {
                const entry = manualCoords[stationName];
                if (!entry) return;

                const lat = parseCoordinate(entry.lat);
                const lon = parseCoordinate(entry.lon);
                if (lat == null || lon == null) return;
                if (!isValidLatitude(lat) || !isValidLongitude(lon)) return;

                nextCache.stations[stationName] = {
                    lat,
                    lon,
                    displayName: `${stationName} (manual)`,
                    source: 'manual',
                    confidence: 'high',
                };
                manualCount++;
            });

            const stations = applyGeocodesToStations(parseResult.stations, nextCache);
            const stillMissing = listMissingGeocodes(stations);

            await saveODMatrixData(teamId, userId, buildSummary(stations));
            await saveGeocodeCache(teamId, nextCache);

            setCompletedStats({
                stations: parseResult.stationCount,
                journeys: parseResult.totalJourneys,
                geocoded: pendingGeocode.geocoded,
                cached: pendingGeocode.cached,
                manual: manualCount,
                failed: stillMissing,
            });
            setPendingGeocode(null);
            setManualCoords({});
            setPhase('complete');
        } catch (err) {
            setErrorMessage(formatError('Import failed', err));
        } finally {
            setIsSavingManualCoords(false);
        }
    };

    // ============ SHARED UI ============

    const PhaseHeader = ({ title, subtitle }: { title: string; subtitle: string }) => (
        <div className="flex items-center justify-between mb-6">
            <div>
                <h2 className="text-xl font-bold text-gray-900">{title}</h2>
                <p className="text-sm text-gray-500">{subtitle}</p>
            </div>
            <button onClick={onCancel} className="p-2 text-gray-400 hover:text-gray-600 transition-colors">
                <X size={20} />
            </button>
        </div>
    );

    const errorBanner = errorMessage ? (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg flex items-start gap-2">
            <AlertTriangle size={16} className="text-red-500 mt-0.5 shrink-0" />
            <p className="text-sm text-red-700">{errorMessage}</p>
        </div>
    ) : null;

    // ============ RENDER PHASES ============

    // SELECT PHASE
    if (phase === 'select') {
        return (
            <div className="max-w-2xl mx-auto">
                <PhaseHeader title="Import OD Matrix" subtitle="Upload an Excel origin-destination matrix file" />
                {errorBanner}

                <div
                    {...getRootProps()}
                    className={`border-2 border-dashed rounded-xl p-12 text-center transition-colors cursor-pointer ${
                        isDragActive
                            ? 'border-violet-400 bg-violet-50'
                            : 'border-gray-300 hover:border-violet-300 hover:bg-violet-50/30'
                    }`}
                >
                    <input {...getInputProps()} />
                    <Upload size={40} className={`mx-auto mb-4 ${isDragActive ? 'text-violet-500' : 'text-gray-400'}`} />
                    <p className="text-lg font-medium text-gray-700 mb-1">
                        {isDragActive ? 'Drop file here' : 'Drag & drop an Excel file'}
                    </p>
                    <p className="text-sm text-gray-500 mb-4">or click to browse</p>
                    <p className="text-xs text-gray-400">Supports .xlsx and .xls files with cross-tab OD matrix format</p>
                </div>
            </div>
        );
    }

    // PREVIEW PHASE
    if (phase === 'preview' && parseResult) {
        const sampleStations = parseResult.stations.slice(0, 8);
        return (
            <div className="max-w-2xl mx-auto">
                <PhaseHeader title="Preview Import" subtitle={fileName} />
                {errorBanner}

                {/* Stats */}
                <div className="grid grid-cols-3 gap-4 mb-6">
                    <div className="bg-violet-50 rounded-xl p-4 text-center">
                        <p className="text-2xl font-bold text-violet-700">{parseResult.stationCount}</p>
                        <p className="text-xs text-violet-600 font-medium">Stations</p>
                    </div>
                    <div className="bg-violet-50 rounded-xl p-4 text-center">
                        <p className="text-2xl font-bold text-violet-700">{parseResult.totalJourneys.toLocaleString()}</p>
                        <p className="text-xs text-violet-600 font-medium">Total Journeys</p>
                    </div>
                    <div className="bg-violet-50 rounded-xl p-4 text-center">
                        <p className="text-2xl font-bold text-violet-700">{parseResult.pairs.length.toLocaleString()}</p>
                        <p className="text-xs text-violet-600 font-medium">OD Pairs</p>
                    </div>
                </div>

                {/* Sample stations */}
                <div className="bg-white border border-gray-200 rounded-xl p-4 mb-6">
                    <h3 className="text-sm font-bold text-gray-700 mb-3">Sample Stations (by volume)</h3>
                    <div className="space-y-1">
                        {sampleStations.map((s, i) => (
                            <div key={i} className="flex items-center justify-between text-sm py-1">
                                <span className="text-gray-700">{s.name}</span>
                                <span className="text-gray-400 text-xs">{s.totalVolume.toLocaleString()} journeys</span>
                            </div>
                        ))}
                        {parseResult.stationCount > 8 && (
                            <p className="text-xs text-gray-400 pt-1">+ {parseResult.stationCount - 8} more stations</p>
                        )}
                    </div>
                </div>

                {/* Date range label */}
                <div className="bg-white border border-gray-200 rounded-xl p-4 mb-6">
                    <label className="block text-sm font-bold text-gray-700 mb-2">
                        Date Range Label <span className="text-gray-400 font-normal">(optional)</span>
                    </label>
                    <input
                        type="text"
                        value={dateRange}
                        onChange={(e) => setDateRange(e.target.value)}
                        placeholder="e.g. Q3 2025, Jan-Mar 2025"
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent"
                    />
                </div>

                {parseResult.warnings.length > 0 && (
                    <div className="mb-6 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                        <p className="text-sm font-medium text-amber-700 mb-1">Warnings</p>
                        {parseResult.warnings.map((w, i) => (
                            <p key={i} className="text-xs text-amber-600">{w}</p>
                        ))}
                    </div>
                )}

                {/* Actions */}
                <div className="flex items-center justify-between">
                    <button
                        onClick={() => { setPhase('select'); setParseResult(null); setErrorMessage(''); }}
                        className="flex items-center gap-1 px-4 py-2 text-sm text-gray-600 hover:text-gray-900 transition-colors"
                    >
                        <ArrowLeft size={14} /> Back
                    </button>
                    <div className="flex gap-2">
                        <button
                            onClick={handleSkipGeocoding}
                            className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
                        >
                            Skip Geocoding
                        </button>
                        <button
                            onClick={handleStartGeocoding}
                            className="flex items-center gap-1 px-4 py-2 text-sm bg-violet-600 text-white rounded-lg hover:bg-violet-700 transition-colors"
                        >
                            <MapPin size={14} /> Geocode & Import <ArrowRight size={14} />
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    // GEOCODING PHASE
    if (phase === 'geocoding') {
        const pct = geocodeProgress.total > 0
            ? Math.round((geocodeProgress.current / geocodeProgress.total) * 100)
            : 0;
        return (
            <div className="max-w-2xl mx-auto">
                <div className="mb-6">
                    <h2 className="text-xl font-bold text-gray-900">Geocoding Stations</h2>
                    <p className="text-sm text-gray-500">Looking up coordinates via OpenStreetMap</p>
                </div>

                <div className="bg-white border border-gray-200 rounded-xl p-6 mb-6">
                    {/* Progress bar */}
                    <div className="mb-4">
                        <div className="flex items-center justify-between mb-1">
                            <span className="text-sm font-medium text-gray-700">
                                {geocodeProgress.current} / {geocodeProgress.total}
                            </span>
                            <span className="text-sm text-gray-500">{pct}%</span>
                        </div>
                        <div className="w-full bg-gray-200 rounded-full h-2">
                            <div
                                className="bg-violet-500 h-2 rounded-full transition-all duration-300"
                                style={{ width: `${pct}%` }}
                            />
                        </div>
                    </div>

                    {/* Current station */}
                    <div className="flex items-center gap-2 text-sm text-gray-600">
                        <Loader2 size={14} className="animate-spin text-violet-500" />
                        <span>{geocodeProgress.stationName || 'Starting...'}</span>
                        <span className="text-gray-400">({geocodeProgress.status})</span>
                    </div>

                    {/* Stats */}
                    <div className="grid grid-cols-3 gap-4 mt-4 pt-4 border-t border-gray-100">
                        <div className="text-center">
                            <p className="text-lg font-bold text-emerald-600">{geocodeProgress.geocoded}</p>
                            <p className="text-xs text-gray-500">Geocoded</p>
                        </div>
                        <div className="text-center">
                            <p className="text-lg font-bold text-blue-600">{geocodeProgress.cached}</p>
                            <p className="text-xs text-gray-500">From Cache</p>
                        </div>
                        <div className="text-center">
                            <p className="text-lg font-bold text-gray-400">{geocodeProgress.failed}</p>
                            <p className="text-xs text-gray-500">Failed</p>
                        </div>
                    </div>
                </div>

                <p className="text-xs text-gray-400 text-center">
                    Rate-limited to ~1 request/second per OpenStreetMap policy
                </p>
            </div>
        );
    }

    // COMPLETE PHASE
    if (phase === 'manual-geocode' && parseResult && pendingGeocode) {
        return (
            <div className="max-w-3xl mx-auto">
                <PhaseHeader title="Add Missing Coordinates" subtitle="Some stops could not be geocoded automatically" />
                {errorBanner}

                <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                    <p className="text-sm text-amber-700">
                        <span className="font-semibold">{pendingGeocode.failed.length}</span> stop
                        {pendingGeocode.failed.length === 1 ? '' : 's'} still missing latitude/longitude.
                    </p>
                    <p className="text-xs text-amber-600 mt-1">
                        Enter coordinates where available, then finish import. Unfilled stops will be listed as missing.
                    </p>
                </div>

                <div className="bg-white border border-gray-200 rounded-xl p-4 mb-4">
                    <div className="max-h-96 overflow-y-auto pr-1 space-y-3">
                        {pendingGeocode.failed.map((stationName) => (
                            <div key={stationName} className="border border-gray-100 rounded-lg p-3">
                                <p className="text-sm font-medium text-gray-800 mb-2">{stationName}</p>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                    <input
                                        type="number"
                                        step="any"
                                        value={manualCoords[stationName]?.lat || ''}
                                        onChange={(e) => handleManualCoordChange(stationName, 'lat', e.target.value)}
                                        placeholder="Latitude (-90 to 90)"
                                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent"
                                    />
                                    <input
                                        type="number"
                                        step="any"
                                        value={manualCoords[stationName]?.lon || ''}
                                        onChange={(e) => handleManualCoordChange(stationName, 'lon', e.target.value)}
                                        placeholder="Longitude (-180 to 180)"
                                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent"
                                    />
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                <div className="flex items-center justify-between">
                    <button
                        onClick={() => {
                            setPendingGeocode(null);
                            setManualCoords({});
                            setPhase('preview');
                        }}
                        className="flex items-center gap-1 px-4 py-2 text-sm text-gray-600 hover:text-gray-900 transition-colors"
                    >
                        <ArrowLeft size={14} /> Back
                    </button>
                    <button
                        onClick={handleFinishWithManualCoords}
                        disabled={isSavingManualCoords}
                        className="flex items-center gap-2 px-4 py-2 text-sm bg-violet-600 text-white rounded-lg hover:bg-violet-700 transition-colors disabled:bg-violet-400 disabled:cursor-not-allowed"
                    >
                        {isSavingManualCoords && <Loader2 size={14} className="animate-spin" />}
                        Finish Import
                    </button>
                </div>
            </div>
        );
    }

    // COMPLETE PHASE
    if (phase === 'complete' && completedStats) {
        return (
            <div className="max-w-2xl mx-auto">
                <div className="bg-white border border-gray-200 rounded-xl p-8 text-center">
                    <CheckCircle2 size={48} className="mx-auto mb-4 text-emerald-500" />
                    <h2 className="text-xl font-bold text-gray-900 mb-2">Import Complete</h2>
                    <p className="text-sm text-gray-500 mb-6">{fileName}</p>

                    <div className="grid grid-cols-2 gap-4 mb-6 max-w-xs mx-auto">
                        <div className="bg-violet-50 rounded-xl p-3">
                            <p className="text-xl font-bold text-violet-700">{completedStats.stations}</p>
                            <p className="text-xs text-violet-600">Stations</p>
                        </div>
                        <div className="bg-violet-50 rounded-xl p-3">
                            <p className="text-xl font-bold text-violet-700">{completedStats.journeys.toLocaleString()}</p>
                            <p className="text-xs text-violet-600">Journeys</p>
                        </div>
                    </div>

                    {(completedStats.geocoded > 0 || completedStats.cached > 0 || completedStats.manual > 0 || completedStats.failed.length > 0) && (
                        <div className="mb-6 text-sm text-gray-500">
                            <p>
                                <span className="font-medium text-emerald-600">{completedStats.geocoded}</span> stations geocoded,{' '}
                                <span className="font-medium text-blue-600">{completedStats.cached}</span> from cache
                                {completedStats.manual > 0 && (
                                    <>
                                        , <span className="font-medium text-violet-600">{completedStats.manual}</span> entered manually
                                    </>
                                )}
                            </p>
                            {completedStats.failed.length > 0 && (
                                <div className="mt-2 p-3 bg-amber-50 border border-amber-200 rounded-lg text-left">
                                    <p className="text-amber-700 font-medium mb-2">
                                        {completedStats.failed.length} stop{completedStats.failed.length === 1 ? '' : 's'} missing latitude/longitude:
                                    </p>
                                    <div className="max-h-40 overflow-y-auto space-y-1">
                                        {completedStats.failed.map((stopName) => (
                                            <p key={stopName} className="text-amber-700 text-xs">{stopName}</p>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    <button
                        onClick={onImportComplete}
                        className="px-6 py-2.5 bg-violet-600 text-white rounded-lg hover:bg-violet-700 transition-colors font-medium"
                    >
                        View Dashboard
                    </button>
                </div>
            </div>
        );
    }

    return null;
};
