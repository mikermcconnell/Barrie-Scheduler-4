import React, { useState, useCallback } from 'react';
import { AlertTriangle, Download, Loader2, GraduationCap, Bus, ArrowRight } from 'lucide-react';
import {
    BARRIE_SCHOOLS,
    findBestTrip,
    minutesToDisplayTime,
} from '../../utils/transit-app/studentPassUtils';
import type { SchoolConfig, StudentPassResult } from '../../utils/transit-app/studentPassUtils';
import { StudentPassMap } from './StudentPassMap';

export const StudentPassModule: React.FC = () => {
    const [selectedSchoolId, setSelectedSchoolId] = useState<string>(BARRIE_SCHOOLS[0].id);
    const [bellStart, setBellStart] = useState<string>('');
    const [bellEnd, setBellEnd] = useState<string>('');
    const [polygon, setPolygon] = useState<[number, number][] | null>(null);
    const [result, setResult] = useState<StudentPassResult | null>(null);
    const [isCalculating, setIsCalculating] = useState(false);

    const selectedSchool: SchoolConfig =
        BARRIE_SCHOOLS.find((s) => s.id === selectedSchoolId) ?? BARRIE_SCHOOLS[0];

    const handlePolygonComplete = useCallback(
        (coords: [number, number][]) => {
            setPolygon(coords);
            if (selectedSchool) {
                setIsCalculating(true);
                requestAnimationFrame(() => {
                    const schoolWithOverrides: SchoolConfig = {
                        ...selectedSchool,
                        bellStart: bellStart || selectedSchool.bellStart,
                        bellEnd: bellEnd || selectedSchool.bellEnd,
                    };
                    const tripResult = findBestTrip(coords, schoolWithOverrides);
                    setResult(tripResult);
                    setIsCalculating(false);
                });
            }
        },
        [selectedSchool, bellStart, bellEnd]
    );

    const handlePolygonClear = useCallback(() => {
        setPolygon(null);
        setResult(null);
    }, []);

    const handleSchoolChange = (id: string) => {
        setSelectedSchoolId(id);
        setBellStart('');
        setBellEnd('');
        setResult(null);
    };

    const effectiveBellStart = bellStart || selectedSchool.bellStart;
    const effectiveBellEnd = bellEnd || selectedSchool.bellEnd;

    return (
        <div className="flex h-[680px] border border-gray-200 rounded-lg overflow-hidden bg-white">
            {/* Left config panel */}
            <div className="w-72 bg-gray-50 border-r border-gray-200 flex flex-col overflow-y-auto">
                <div className="p-4 border-b border-gray-200">
                    <div className="flex items-center gap-2 mb-1">
                        <GraduationCap size={18} className="text-blue-600" />
                        <h3 className="font-semibold text-gray-900 text-sm">Student Pass Planner</h3>
                    </div>
                    <p className="text-xs text-gray-500">
                        Draw a zone on the map to find transit options.
                    </p>
                </div>

                {/* School selection */}
                <div className="p-4 border-b border-gray-200">
                    <label className="block text-xs font-medium text-gray-700 mb-1.5">School</label>
                    <select
                        value={selectedSchoolId}
                        onChange={(e) => handleSchoolChange(e.target.value)}
                        className="w-full text-sm border border-gray-300 rounded-md px-3 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    >
                        {BARRIE_SCHOOLS.map((s) => (
                            <option key={s.id} value={s.id}>
                                {s.name}
                            </option>
                        ))}
                    </select>
                </div>

                {/* Bell time overrides */}
                <div className="p-4 border-b border-gray-200">
                    <p className="text-xs font-medium text-gray-700 mb-2">Bell Times</p>
                    <div className="space-y-2">
                        <div>
                            <label className="text-xs text-gray-500 mb-0.5 block">Start</label>
                            <input
                                type="time"
                                value={bellStart}
                                placeholder={selectedSchool.bellStart}
                                onChange={(e) => setBellStart(e.target.value)}
                                className="w-full text-sm border border-gray-300 rounded-md px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                            />
                            {!bellStart && (
                                <p className="text-xs text-gray-400 mt-0.5">
                                    Default: {selectedSchool.bellStart}
                                </p>
                            )}
                        </div>
                        <div>
                            <label className="text-xs text-gray-500 mb-0.5 block">End</label>
                            <input
                                type="time"
                                value={bellEnd}
                                placeholder={selectedSchool.bellEnd}
                                onChange={(e) => setBellEnd(e.target.value)}
                                className="w-full text-sm border border-gray-300 rounded-md px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                            />
                            {!bellEnd && (
                                <p className="text-xs text-gray-400 mt-0.5">
                                    Default: {selectedSchool.bellEnd}
                                </p>
                            )}
                        </div>
                    </div>
                </div>

                {/* Zone info */}
                <div className="p-4 border-b border-gray-200">
                    <p className="text-xs font-medium text-gray-700 mb-1">Zone Status</p>
                    {polygon ? (
                        <div className="text-xs text-gray-600 flex items-center gap-1.5">
                            <span className="w-2 h-2 rounded-full bg-blue-500 inline-block" />
                            Zone drawn ({polygon.length} vertices)
                        </div>
                    ) : (
                        <p className="text-xs text-gray-400 italic">
                            Use the polygon tool (top-right of map) to draw a zone.
                        </p>
                    )}
                </div>

                {/* Trip result summary */}
                <div className="p-4 flex-1">
                    {isCalculating && (
                        <div className="flex items-center gap-2 text-sm text-blue-600">
                            <Loader2 size={16} className="animate-spin" />
                            <span>Calculating...</span>
                        </div>
                    )}

                    {!isCalculating && result && !result.found && (
                        <div className="flex items-start gap-2 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-md p-3">
                            <AlertTriangle size={16} className="flex-shrink-0 mt-0.5" />
                            <div>
                                <p className="font-medium">No trip found</p>
                                <p className="text-xs mt-0.5 text-amber-600">
                                    No weekday service connects this zone to {selectedSchool.name} before{' '}
                                    {effectiveBellStart}.
                                </p>
                            </div>
                        </div>
                    )}

                    {!isCalculating && result?.found && (
                        <div className="space-y-3">
                            <div className="flex items-center gap-2">
                                <Bus size={15} className="text-green-600" />
                                <span className="text-sm font-semibold text-gray-900">
                                    {result.isDirect ? 'Direct Trip' : '1-Transfer Trip'}
                                </span>
                            </div>

                            {/* Morning legs */}
                            <div>
                                <p className="text-xs text-gray-500 mb-1.5 font-medium uppercase tracking-wide">
                                    Morning
                                </p>
                                <div className="space-y-1.5">
                                    {result.morningLegs.map((leg, i) => (
                                        <div key={i} className="text-xs bg-white border border-gray-200 rounded p-2">
                                            <div className="flex items-center gap-1.5 mb-1">
                                                <span
                                                    className="px-1.5 py-0.5 rounded text-white font-bold text-[10px]"
                                                    style={{ backgroundColor: leg.routeColor || '#6B7280' }}
                                                >
                                                    {leg.routeShortName}
                                                </span>
                                                <span className="text-gray-500">
                                                    {minutesToDisplayTime(leg.departureMinutes)}
                                                    <ArrowRight size={10} className="inline mx-0.5" />
                                                    {minutesToDisplayTime(leg.arrivalMinutes)}
                                                </span>
                                            </div>
                                            <p className="text-gray-600 truncate">
                                                {leg.fromStop} → {leg.toStop}
                                            </p>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            {/* Transfer info */}
                            {result.transfer && (
                                <div
                                    className="text-xs rounded p-2 border"
                                    style={{
                                        borderColor: result.transfer.color,
                                        backgroundColor: `${result.transfer.color}15`,
                                        color: result.transfer.color,
                                    }}
                                >
                                    <span className="font-semibold">{result.transfer.label}</span>
                                    {' — '}
                                    {result.transfer.waitMinutes} min wait
                                </div>
                            )}

                            {/* Afternoon legs */}
                            {result.afternoonLegs.length > 0 && (
                                <div>
                                    <p className="text-xs text-gray-500 mb-1.5 font-medium uppercase tracking-wide">
                                        Afternoon Return
                                    </p>
                                    <div className="space-y-1.5">
                                        {result.afternoonLegs.map((leg, i) => (
                                            <div
                                                key={i}
                                                className="text-xs bg-white border border-gray-200 rounded p-2"
                                            >
                                                <div className="flex items-center gap-1.5 mb-1">
                                                    <span
                                                        className="px-1.5 py-0.5 rounded text-white font-bold text-[10px]"
                                                        style={{ backgroundColor: leg.routeColor || '#6B7280' }}
                                                    >
                                                        {leg.routeShortName}
                                                    </span>
                                                    <span className="text-gray-500">
                                                        {minutesToDisplayTime(leg.departureMinutes)}
                                                        <ArrowRight size={10} className="inline mx-0.5" />
                                                        {minutesToDisplayTime(leg.arrivalMinutes)}
                                                    </span>
                                                </div>
                                                <p className="text-gray-600 truncate">
                                                    {leg.fromStop} → {leg.toStop}
                                                </p>
                                            </div>
                                        ))}
                                    </div>
                                    {result.nextAfternoonDepartureMinutes != null && (
                                        <p className="text-xs text-gray-400 mt-1">
                                            Next bus: {minutesToDisplayTime(result.nextAfternoonDepartureMinutes)}
                                        </p>
                                    )}
                                </div>
                            )}

                            {/* Frequency */}
                            {result.frequencyPerHour != null && (
                                <p className="text-xs text-gray-500">
                                    AM peak frequency:{' '}
                                    <span className="font-medium text-gray-700">
                                        {result.frequencyPerHour.toFixed(1)} trips/hr
                                    </span>
                                </p>
                            )}
                        </div>
                    )}

                    {!isCalculating && !result && (
                        <p className="text-xs text-gray-400 italic">
                            Draw a zone on the map to see transit options.
                        </p>
                    )}
                </div>

                {/* Export button placeholder */}
                <div className="p-4 border-t border-gray-200">
                    <button
                        disabled={!result?.found}
                        className="w-full flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium rounded-md transition-colors disabled:opacity-40 disabled:cursor-not-allowed bg-blue-600 text-white hover:bg-blue-700 disabled:hover:bg-blue-600"
                        title={result?.found ? 'Export pass details' : 'No trip result to export'}
                    >
                        <Download size={15} />
                        Export Pass Details
                    </button>
                </div>
            </div>

            {/* Right: map + preview */}
            <div className="flex-1 flex flex-col min-w-0">
                {/* Map (~60% of height) */}
                <div className="flex-[3] min-h-0">
                    <StudentPassMap
                        school={selectedSchool}
                        result={result}
                        onPolygonComplete={handlePolygonComplete}
                        onPolygonClear={handlePolygonClear}
                    />
                </div>

                {/* Preview placeholder (~40% of height) */}
                <div className="flex-[2] border-t border-gray-200 bg-gray-50 flex items-center justify-center min-h-0">
                    {result?.found ? (
                        <div className="text-center px-6">
                            <div className="w-12 h-12 rounded-full bg-blue-100 flex items-center justify-center mx-auto mb-2">
                                <GraduationCap size={24} className="text-blue-600" />
                            </div>
                            <p className="text-sm font-medium text-gray-700">Pass Preview</p>
                            <p className="text-xs text-gray-400 mt-1">
                                PDF brochure coming in Task 6
                            </p>
                        </div>
                    ) : (
                        <div className="text-center px-6">
                            <GraduationCap size={32} className="text-gray-300 mx-auto mb-2" />
                            <p className="text-sm text-gray-400">
                                Pass preview will appear here after a zone is drawn.
                            </p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};
