import React, { useMemo, useState } from 'react';
import { ArrowLeft, AlertTriangle, Loader2, CheckCircle2, ExternalLink } from 'lucide-react';
import { applyGeocodesToStations, isWithinCanada } from '../../utils/od-matrix/odMatrixGeocoder';
import { saveGeocodeCache, saveODMatrixData } from '../../utils/od-matrix/odMatrixService';
import {
    parseLatLonInput,
    parseManualCoordinateEntry,
    buildGoogleMapsSearchUrl,
} from '../../utils/od-matrix/coordinateParsing';
import type { GeocodeCache, GeocodedLocation, ODMatrixDataSummary, ODStation } from '../../utils/od-matrix/odMatrixTypes';

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

    const validLookup = useMemo(
        () => buildValidLookup(data.stations, geocodeCache),
        [data.stations, geocodeCache],
    );

    const missingStations = useMemo(
        () => data.stations.filter(station => !validLookup[station.name]).map(station => station.name),
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
                        <h2 className="text-xl font-bold text-gray-900">Fix Missing Coordinates</h2>
                        <p className="text-sm text-gray-500">
                            No file upload needed. Add coordinates and refresh this imported OD dataset.
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

                <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                    <p className="text-sm text-blue-700">
                        <span className="font-semibold">{missingStations.length}</span> stop
                        {missingStations.length === 1 ? '' : 's'} need coordinates.
                    </p>
                    <p className="text-xs text-blue-700 mt-1">
                        Tip: accepts decimal coordinates, Google Maps coordinate text, or full Google Maps URL in either field. Coordinates are saved and reused automatically.
                    </p>
                    <p className="text-xs text-blue-700 mt-1">
                        Example (Pearson): <span className="font-mono">43°40&apos;56.3&quot;N 79°37&apos;48.8&quot;W</span>
                    </p>
                </div>

                {missingStations.length === 0 ? (
                    <div className="bg-white border border-gray-200 rounded-xl p-8 text-center">
                        <CheckCircle2 size={40} className="mx-auto mb-3 text-emerald-500" />
                        <p className="font-semibold text-gray-800">No missing coordinates</p>
                        <p className="text-sm text-gray-500 mt-1">All stops already have valid coordinates in Canada.</p>
                    </div>
                ) : (
                    <div className="bg-white border border-gray-200 rounded-xl p-4 mb-4">
                        <div className="max-h-[60vh] overflow-y-auto pr-1 space-y-3">
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
                                            placeholder={`Latitude or paste lat, lon / URL`}
                                            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent"
                                        />
                                        <input
                                            type="text"
                                            inputMode="text"
                                            value={manualCoords[stationName]?.lon || ''}
                                            onChange={(e) => handleCoordChange(stationName, 'lon', e.target.value)}
                                            placeholder={`Longitude or paste Google Maps format`}
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
