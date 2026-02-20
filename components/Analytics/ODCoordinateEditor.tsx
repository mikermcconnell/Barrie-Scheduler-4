import React, { useMemo, useState } from 'react';
import { ArrowLeft, AlertTriangle, Loader2, CheckCircle2, ExternalLink, RotateCcw } from 'lucide-react';
import { applyGeocodesToStations, isWithinCanada } from '../../utils/od-matrix/odMatrixGeocoder';
import { saveGeocodeCache, saveODMatrixData } from '../../utils/od-matrix/odMatrixService';
import {
    parseLatLonInput,
    parseManualCoordinateEntry,
    buildGoogleMapsSearchUrl,
} from '../../utils/od-matrix/coordinateParsing';
import type { GeocodeCache, GeocodedLocation, ODMatrixDataSummary, ODStation } from '../../utils/od-matrix/odMatrixTypes';

type FilterMode = 'missing' | 'all';

interface ODCoordinateEditorProps {
    teamId: string;
    userId: string;
    data: ODMatrixDataSummary;
    geocodeCache: GeocodeCache | null;
    onComplete: () => void;
    onCancel: () => void;
}

interface CoordInput {
    lat: string;
    lon: string;
}

interface ParseFeedback {
    state: 'empty' | 'valid' | 'invalid' | 'outside';
    message: string;
}

function buildValidLookup(stations: ODStation[], cache: GeocodeCache | null): Record<string, GeocodedLocation> {
    const lookup: Record<string, GeocodedLocation> = {};

    Object.entries(cache?.stations || {}).forEach(([name, loc]) => {
        if (isWithinCanada(loc.lat, loc.lon)) {
            lookup[name] = loc;
        }
    });

    stations.forEach((station) => {
        if (station.geocode && isWithinCanada(station.geocode.lat, station.geocode.lon)) {
            lookup[station.name] = station.geocode;
        }
    });

    return lookup;
}

function getParseFeedback(entry?: CoordInput): ParseFeedback {
    if (!entry) return { state: 'empty', message: '' };

    const hasInput = !!entry.lat.trim() || !!entry.lon.trim();
    if (!hasInput) return { state: 'empty', message: '' };

    const parsed = parseManualCoordinateEntry(entry);
    if (!parsed) {
        return {
            state: 'invalid',
            message: 'Could not parse coordinates yet. Use decimal, Google Maps coordinate text, or a full Google Maps URL.',
        };
    }

    if (!isWithinCanada(parsed.lat, parsed.lon)) {
        return {
            state: 'outside',
            message: `Parsed as ${parsed.lat.toFixed(6)}, ${parsed.lon.toFixed(6)} but outside Canada (will not be saved).`,
        };
    }

    return {
        state: 'valid',
        message: `Parsed successfully: ${parsed.lat.toFixed(6)}, ${parsed.lon.toFixed(6)}`,
    };
}

export const ODCoordinateEditor: React.FC<ODCoordinateEditorProps> = ({
    teamId,
    userId,
    data,
    geocodeCache,
    onComplete,
    onCancel,
}) => {
    const [manualCoords, setManualCoords] = useState<Record<string, CoordInput>>({});
    const [isSaving, setIsSaving] = useState(false);
    const [errorMessage, setErrorMessage] = useState('');
    const [filterMode, setFilterMode] = useState<FilterMode>('missing');
    const [resetStations, setResetStations] = useState<Set<string>>(new Set());

    const validLookup = useMemo(
        () => buildValidLookup(data.stations, geocodeCache),
        [data.stations, geocodeCache],
    );

    const missingStations = useMemo(
        () => data.stations.filter(station => !validLookup[station.name]).map(station => station.name),
        [data.stations, validLookup],
    );

    const geocodedStations = useMemo(
        () => data.stations.filter(station => !!validLookup[station.name]).map(station => station.name),
        [data.stations, validLookup],
    );

    const handleCoordChange = (stationName: string, field: 'lat' | 'lon', value: string) => {
        const paired = parseLatLonInput(value);
        if (paired) {
            setManualCoords(prev => ({
                ...prev,
                [stationName]: {
                    lat: paired.lat.toFixed(6),
                    lon: paired.lon.toFixed(6),
                },
            }));
            return;
        }

        setManualCoords(prev => ({
            ...prev,
            [stationName]: {
                lat: field === 'lat' ? value : (prev[stationName]?.lat || ''),
                lon: field === 'lon' ? value : (prev[stationName]?.lon || ''),
            },
        }));
    };

    const handleSave = async () => {
        setErrorMessage('');
        setIsSaving(true);

        try {
            const nextStations: Record<string, GeocodedLocation> = { ...validLookup };
            const invalidEntries: string[] = [];

            // Process missing stations
            missingStations.forEach((stationName) => {
                const entry = manualCoords[stationName];
                if (!entry) return;
                const hasInput = !!entry.lat.trim() || !!entry.lon.trim();
                if (!hasInput) return;

                const parsed = parseManualCoordinateEntry(entry);
                if (!parsed || !isWithinCanada(parsed.lat, parsed.lon)) {
                    invalidEntries.push(stationName);
                    return;
                }

                nextStations[stationName] = {
                    lat: parsed.lat,
                    lon: parsed.lon,
                    displayName: `${stationName} (manual)`,
                    source: 'manual',
                    confidence: 'high',
                };
            });

            // Process edits to already-geocoded stations
            geocodedStations.forEach((stationName) => {
                // Handle reset-to-auto requests: remove manual override
                if (resetStations.has(stationName)) {
                    const existing = validLookup[stationName];
                    if (existing && existing.source === 'manual') {
                        // Remove from nextStations so it gets re-geocoded on next import
                        delete nextStations[stationName];
                    }
                    return;
                }

                const entry = manualCoords[stationName];
                if (!entry) return;

                const existing = validLookup[stationName];
                // Check if the user actually changed the values
                const latChanged = entry.lat.trim() !== (existing?.lat.toFixed(6) ?? '');
                const lonChanged = entry.lon.trim() !== (existing?.lon.toFixed(6) ?? '');
                if (!latChanged && !lonChanged) return;

                const parsed = parseManualCoordinateEntry(entry);
                if (!parsed || !isWithinCanada(parsed.lat, parsed.lon)) {
                    invalidEntries.push(stationName);
                    return;
                }

                nextStations[stationName] = {
                    lat: parsed.lat,
                    lon: parsed.lon,
                    displayName: `${stationName} (manual)`,
                    source: 'manual',
                    confidence: 'high',
                };
            });

            const nextCache: GeocodeCache = {
                stations: nextStations,
                lastUpdated: new Date().toISOString(),
            };

            const updatedStations = applyGeocodesToStations(data.stations, nextCache);
            const unresolved = updatedStations.filter(station => !station.geocode).map(station => station.name);

            const updatedSummary: ODMatrixDataSummary = {
                ...data,
                stations: updatedStations,
                metadata: {
                    ...data.metadata,
                    importedAt: new Date().toISOString(),
                    importedBy: userId,
                },
            };

            await saveODMatrixData(teamId, userId, updatedSummary);
            await saveGeocodeCache(teamId, nextCache);

            if (invalidEntries.length > 0) {
                setErrorMessage(
                    `Ignored ${invalidEntries.length} invalid entry${invalidEntries.length === 1 ? '' : 'ies'} (must be valid coordinates in Canada).`
                );
            }

            if (unresolved.length > 0) {
                setErrorMessage(prev => {
                    const unresolvedMessage = `${unresolved.length} stop${unresolved.length === 1 ? '' : 's'} still missing coordinates after save.`;
                    return prev ? `${prev} ${unresolvedMessage}` : unresolvedMessage;
                });
            }

            onComplete();
        } catch (err) {
            setErrorMessage(err instanceof Error ? err.message : 'Failed to save coordinates');
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <div className="h-full overflow-auto custom-scrollbar p-6">
            <div className="max-w-4xl mx-auto">
                <div className="flex items-center justify-between mb-6">
                    <div>
                        <h2 className="text-xl font-bold text-gray-900">Manage Station Coordinates</h2>
                        <p className="text-sm text-gray-500">
                            Add or edit station coordinates for this imported OD dataset.
                        </p>
                    </div>
                    <button
                        onClick={onCancel}
                        className="flex items-center gap-1 px-4 py-2 text-sm text-gray-600 hover:text-gray-900 transition-colors"
                    >
                        <ArrowLeft size={14} /> Back
                    </button>
                </div>

                {errorMessage && (
                    <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg flex items-start gap-2">
                        <AlertTriangle size={16} className="text-amber-500 mt-0.5 shrink-0" />
                        <p className="text-sm text-amber-700">{errorMessage}</p>
                    </div>
                )}

                {/* Info bar + filter toggle */}
                <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                    <div className="flex items-center justify-between gap-4 flex-wrap">
                        <p className="text-sm text-blue-700">
                            <span className="font-semibold">{missingStations.length}</span> stop{missingStations.length === 1 ? '' : 's'} missing coordinates
                            {' · '}
                            <span className="font-semibold">{geocodedStations.length}</span> stop{geocodedStations.length === 1 ? '' : 's'} geocoded
                        </p>
                        <div className="inline-flex rounded-lg border border-blue-300 overflow-hidden text-xs">
                            <button
                                onClick={() => setFilterMode('missing')}
                                className={`px-3 py-1.5 transition-colors ${
                                    filterMode === 'missing'
                                        ? 'bg-blue-600 text-white'
                                        : 'bg-white text-blue-700 hover:bg-blue-50'
                                }`}
                            >
                                Missing Only ({missingStations.length})
                            </button>
                            <button
                                onClick={() => setFilterMode('all')}
                                className={`px-3 py-1.5 transition-colors ${
                                    filterMode === 'all'
                                        ? 'bg-blue-600 text-white'
                                        : 'bg-white text-blue-700 hover:bg-blue-50'
                                }`}
                            >
                                All Stations ({missingStations.length + geocodedStations.length})
                            </button>
                        </div>
                    </div>
                    <p className="text-xs text-blue-700 mt-2">
                        Tip: accepts decimal coordinates, Google Maps coordinate text, or full Google Maps URL in either field.
                    </p>
                </div>

                {/* Missing stations section */}
                {missingStations.length === 0 && filterMode === 'missing' ? (
                    <div className="bg-white border border-gray-200 rounded-xl p-8 text-center mb-4">
                        <CheckCircle2 size={40} className="mx-auto mb-3 text-emerald-500" />
                        <p className="font-semibold text-gray-800">No missing coordinates</p>
                        <p className="text-sm text-gray-500 mt-1">All stops already have valid coordinates in Canada.</p>
                    </div>
                ) : missingStations.length > 0 ? (
                    <div className="bg-white border border-gray-200 rounded-xl p-4 mb-4">
                        {filterMode === 'all' && (
                            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Missing Coordinates ({missingStations.length})</p>
                        )}
                        <div className="max-h-[40vh] overflow-y-auto pr-1 space-y-3">
                            {missingStations.map((stationName) => {
                                const parseFeedback = getParseFeedback(manualCoords[stationName]);
                                return (
                                <div key={stationName} className="border border-gray-100 rounded-lg p-3">
                                    <div className="mb-2 flex items-center justify-between gap-2">
                                        <p className="text-sm font-medium text-gray-800">{stationName}</p>
                                        <a
                                            href={buildGoogleMapsSearchUrl(stationName)}
                                            target="_blank"
                                            rel="noreferrer"
                                            className="inline-flex items-center gap-1 text-xs text-violet-700 hover:text-violet-900 underline"
                                        >
                                            Find in Google Maps <ExternalLink size={12} />
                                        </a>
                                    </div>
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                        <input
                                            type="text"
                                            inputMode="text"
                                            value={manualCoords[stationName]?.lat || ''}
                                            onChange={(e) => handleCoordChange(stationName, 'lat', e.target.value)}
                                            placeholder="Latitude or paste lat, lon / URL"
                                            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent"
                                        />
                                        <input
                                            type="text"
                                            inputMode="text"
                                            value={manualCoords[stationName]?.lon || ''}
                                            onChange={(e) => handleCoordChange(stationName, 'lon', e.target.value)}
                                            placeholder="Longitude or paste Google Maps format"
                                            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent"
                                        />
                                    </div>
                                    {parseFeedback.state !== 'empty' && (
                                        <p
                                            className={`mt-2 text-xs ${
                                                parseFeedback.state === 'valid'
                                                    ? 'text-emerald-700'
                                                    : parseFeedback.state === 'outside'
                                                        ? 'text-amber-700'
                                                        : 'text-red-700'
                                            }`}
                                        >
                                            {parseFeedback.message}
                                        </p>
                                    )}
                                </div>
                                );
                            })}
                        </div>
                    </div>
                ) : null}

                {/* Geocoded stations section (only when filter = 'all') */}
                {filterMode === 'all' && geocodedStations.length > 0 && (
                    <div className="bg-white border border-gray-200 rounded-xl p-4 mb-4">
                        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Geocoded Stations ({geocodedStations.length})</p>
                        <div className="max-h-[40vh] overflow-y-auto pr-1 space-y-3">
                            {geocodedStations.map((stationName) => {
                                const existing = validLookup[stationName];
                                const isManual = existing?.source === 'manual';
                                const isMarkedForReset = resetStations.has(stationName);
                                const coordEntry = manualCoords[stationName] ?? {
                                    lat: existing?.lat.toFixed(6) ?? '',
                                    lon: existing?.lon.toFixed(6) ?? '',
                                };
                                const parseFeedback = getParseFeedback(manualCoords[stationName]);

                                return (
                                <div key={stationName} className={`border rounded-lg p-3 ${isMarkedForReset ? 'border-amber-200 bg-amber-50/50' : 'border-gray-100'}`}>
                                    <div className="mb-2 flex items-center justify-between gap-2">
                                        <div className="flex items-center gap-2">
                                            <p className="text-sm font-medium text-gray-800">{stationName}</p>
                                            <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${
                                                isManual
                                                    ? 'bg-violet-100 text-violet-700'
                                                    : 'bg-gray-100 text-gray-500'
                                            }`}>
                                                {isManual ? 'Manual' : 'Auto-geocoded'}
                                            </span>
                                            {isMarkedForReset && (
                                                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-100 text-amber-700">
                                                    Will reset on save
                                                </span>
                                            )}
                                        </div>
                                        <div className="flex items-center gap-2">
                                            {isManual && !isMarkedForReset && (
                                                <button
                                                    onClick={() => setResetStations(prev => new Set([...prev, stationName]))}
                                                    className="inline-flex items-center gap-1 text-xs text-amber-600 hover:text-amber-800 transition-colors"
                                                    title="Remove manual override, re-geocode on next import"
                                                >
                                                    <RotateCcw size={12} /> Reset
                                                </button>
                                            )}
                                            {isMarkedForReset && (
                                                <button
                                                    onClick={() => setResetStations(prev => {
                                                        const next = new Set(prev);
                                                        next.delete(stationName);
                                                        return next;
                                                    })}
                                                    className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 transition-colors"
                                                >
                                                    Undo reset
                                                </button>
                                            )}
                                            <a
                                                href={buildGoogleMapsSearchUrl(stationName)}
                                                target="_blank"
                                                rel="noreferrer"
                                                className="inline-flex items-center gap-1 text-xs text-violet-700 hover:text-violet-900 underline"
                                            >
                                                Find in Google Maps <ExternalLink size={12} />
                                            </a>
                                        </div>
                                    </div>
                                    {!isMarkedForReset && (
                                        <>
                                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                                <input
                                                    type="text"
                                                    inputMode="text"
                                                    value={coordEntry.lat}
                                                    onChange={(e) => handleCoordChange(stationName, 'lat', e.target.value)}
                                                    placeholder="Latitude or paste lat, lon / URL"
                                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent"
                                                />
                                                <input
                                                    type="text"
                                                    inputMode="text"
                                                    value={coordEntry.lon}
                                                    onChange={(e) => handleCoordChange(stationName, 'lon', e.target.value)}
                                                    placeholder="Longitude or paste Google Maps format"
                                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent"
                                                />
                                            </div>
                                            {parseFeedback.state !== 'empty' && (
                                                <p
                                                    className={`mt-2 text-xs ${
                                                        parseFeedback.state === 'valid'
                                                            ? 'text-emerald-700'
                                                            : parseFeedback.state === 'outside'
                                                                ? 'text-amber-700'
                                                                : 'text-red-700'
                                                    }`}
                                                >
                                                    {parseFeedback.message}
                                                </p>
                                            )}
                                        </>
                                    )}
                                </div>
                                );
                            })}
                        </div>
                    </div>
                )}

                <div className="flex items-center justify-end gap-2">
                    <button
                        onClick={onCancel}
                        className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleSave}
                        disabled={isSaving}
                        className="flex items-center gap-2 px-4 py-2 text-sm bg-violet-600 text-white rounded-lg hover:bg-violet-700 transition-colors disabled:bg-violet-400 disabled:cursor-not-allowed"
                    >
                        {isSaving && <Loader2 size={14} className="animate-spin" />}
                        Save Coordinates
                    </button>
                </div>
            </div>
        </div>
    );
};
