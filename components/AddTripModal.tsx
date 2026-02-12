import React, { useState, useMemo } from 'react';
import { Plus, X, Clock, Eye, Bus, AlertTriangle, Calendar, MapPin } from 'lucide-react';
import { MasterTrip, MasterRouteTable } from '../utils/parsers/masterScheduleParser';
import { TimeUtils } from '../utils/timeUtils';
import { getDayTypeSuffix, getDayTypeLabel, DaySuffix } from '../utils/config/routeNameParser';

export interface AddTripModalContext {
    referenceTrip: MasterTrip;
    nextTrip: MasterTrip | null;
    targetTable: MasterRouteTable;
    allSchedules: MasterRouteTable[];
    routeBaseName: string;
}

export interface AddTripResult {
    startTime: number;
    tripCount: number;
    newBlockId: string;
}

interface Props {
    context: AddTripModalContext;
    onCancel: () => void;
    onConfirm: (result: AddTripResult) => void;
}

// --- Trip Preview Type ---
interface TripPreview {
    startTime: number;
    endTime: number;
    direction: string;
    hasOverlap?: boolean; // NEW: overlap warning
}

export const AddTripModal: React.FC<Props> = ({ context, onCancel, onConfirm }) => {
    const { referenceTrip, nextTrip, targetTable, allSchedules, routeBaseName } = context;

    // Extract route and day info for display
    const routeNumber = routeBaseName.split(' ')[0];
    const dayTypeLabel = getDayTypeLabel(targetTable.routeName);
    const daySuffix = getDayTypeSuffix(targetTable.routeName);

    // Calculate default start time (midpoint between two trips' START times)
    const defaultStartTime = useMemo(() => {
        const refStart = referenceTrip.startTime;
        if (nextTrip) {
            const nextStart = nextTrip.startTime;
            // Midpoint between the two START times
            return Math.round((refStart + nextStart) / 2);
        }
        // No next trip - use the reference end time as fallback
        return referenceTrip.endTime;
    }, [referenceTrip, nextTrip]);

    const [startTimeInput, setStartTimeInput] = useState(TimeUtils.fromMinutes(defaultStartTime));
    const [tripCount, setTripCount] = useState(1);

    // Calculate new block ID with DAY-SCOPED suffix (e.g., 400-WD-1, 400-SA-1)
    const newBlockId = useMemo(() => {
        const routePrefix = routeBaseName.split(' ')[0]; // e.g., "10" from "10 (Weekday)"
        const existingBlockNums: number[] = [];

        // Only look at schedules for the SAME day type to scope block IDs
        allSchedules.forEach(table => {
            if (table.routeName.startsWith(routePrefix) && getDayTypeSuffix(table.routeName) === daySuffix) {
                table.trips.forEach(trip => {
                    // Match both old format (10-1) and new format (10-WD-1)
                    const oldMatch = trip.blockId.match(new RegExp(`^${routePrefix}-(\\d+)$`));
                    const newMatch = trip.blockId.match(new RegExp(`^${routePrefix}-${daySuffix}-(\\d+)$`));
                    if (oldMatch) {
                        existingBlockNums.push(parseInt(oldMatch[1]));
                    }
                    if (newMatch) {
                        existingBlockNums.push(parseInt(newMatch[1]));
                    }
                });
            }
        });

        const maxNum = existingBlockNums.length > 0 ? Math.max(...existingBlockNums) : 0;
        return `${routePrefix}-${daySuffix}-${maxNum + 1}`;
    }, [allSchedules, routeBaseName, daySuffix]);

    // Get all existing trips for overlap detection - ONLY from the target table (same route)
    const existingTrips = useMemo(() => {
        const trips: Array<{ startTime: number, endTime: number, direction: string }> = [];
        // Only check trips in the target table (not all routes with same day)
        targetTable.trips.forEach(t => {
            trips.push({ startTime: t.startTime, endTime: t.endTime, direction: t.direction });
        });
        return trips;
    }, [targetTable]);

    // Generate trip previews with overlap detection
    const tripPreviews = useMemo((): TripPreview[] => {
        const startMin = TimeUtils.toMinutes(startTimeInput);
        if (startMin === null) return [];

        const previews: TripPreview[] = [];
        const travelTime = referenceTrip.travelTime || 30;
        const recoveryTime = referenceTrip.recoveryTime || 0;

        let currentTime = startMin;
        let currentDirection = referenceTrip.direction || 'North';

        for (let i = 0; i < tripCount; i++) {
            const tripEnd = currentTime + travelTime;

            // Check for overlaps with existing trips
            const hasOverlap = existingTrips.some(existing => {
                // Overlaps if new trip's range intersects existing trip's range
                return currentTime < existing.endTime && tripEnd > existing.startTime;
            });

            previews.push({
                startTime: currentTime,
                endTime: tripEnd,
                direction: currentDirection,
                hasOverlap
            });

            // Next trip starts after recovery
            currentTime = tripEnd + recoveryTime;

            // Alternate direction for bidirectional routes
            if (currentDirection === 'North') {
                currentDirection = 'South';
            } else if (currentDirection === 'South') {
                currentDirection = 'North';
            }
        }

        return previews;
    }, [startTimeInput, tripCount, referenceTrip, existingTrips]);

    // Check if any previewed trips have overlaps
    const hasAnyOverlap = tripPreviews.some(p => p.hasOverlap);

    const handleConfirm = () => {
        const startMin = TimeUtils.toMinutes(startTimeInput);
        if (startMin === null) return;

        onConfirm({
            startTime: startMin,
            tripCount,
            newBlockId
        });
    };

    const parsedStartTime = TimeUtils.toMinutes(startTimeInput);
    const isValidTime = parsedStartTime !== null;

    return (
        // z-[10000] ensures modal appears above fullscreen container (z-[9999])
        <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4 animate-in fade-in duration-200">
            <div className="bg-white w-full max-w-lg rounded-2xl shadow-2xl overflow-hidden border border-blue-100 flex flex-col">

                {/* Header with Route/Day Context */}
                <div className="px-6 py-4 bg-blue-50 border-b border-blue-100 flex justify-between items-center">
                    <div>
                        <div className="flex items-center gap-2 mb-1">
                            <h3 className="text-lg font-extrabold text-blue-900 flex items-center gap-2">
                                <Plus size={20} className="text-blue-600" />
                                Add New Trips
                            </h3>
                            <span className="bg-blue-600 text-white text-[10px] font-bold px-2 py-0.5 rounded-md">
                                Route {routeNumber}
                            </span>
                            <span className="bg-gray-200 text-gray-700 text-[10px] font-bold px-2 py-0.5 rounded-md flex items-center gap-1">
                                <Calendar size={10} />
                                {dayTypeLabel}
                            </span>
                        </div>
                        <p className="text-xs font-bold text-blue-400">
                            Creating new block: <span className="font-mono text-blue-600">{newBlockId}</span>
                        </p>
                    </div>
                    <button
                        onClick={onCancel}
                        className="p-1 rounded-full text-blue-300 hover:bg-blue-100 hover:text-blue-600 transition-colors"
                    >
                        <X size={20} />
                    </button>
                </div>

                {/* Body */}
                <div className="p-6 space-y-6">
                    {/* Reference Info */}
                    <div className="bg-gray-50 rounded-xl p-4 border border-gray-200">
                        <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">
                            Adding after trip
                        </div>
                        <div className="flex items-center gap-4">
                            <div className="flex items-center gap-2">
                                <Bus size={16} className="text-gray-400" />
                                <span className="font-mono font-bold text-gray-700">{referenceTrip.blockId}</span>
                            </div>
                            <div className="text-sm text-gray-600">
                                Ends at <span className="font-mono font-bold">{TimeUtils.fromMinutes(referenceTrip.endTime)}</span>
                            </div>
                            {nextTrip && (
                                <div className="text-sm text-gray-500">
                                    → Next trip at <span className="font-mono">{TimeUtils.fromMinutes(nextTrip.startTime)}</span>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Start Time Input */}
                    <div>
                        <label className="block text-xs font-bold text-gray-500 uppercase mb-2 flex items-center gap-2">
                            <Clock size={14} />
                            Start Time (First Trip)
                        </label>
                        <input
                            type="text"
                            value={startTimeInput}
                            onChange={(e) => setStartTimeInput(e.target.value)}
                            className={`w-full text-lg font-mono p-3 rounded-xl border-2 ${isValidTime ? 'border-blue-200 focus:border-blue-400' : 'border-red-300'} bg-white focus:ring-4 focus:ring-blue-50 outline-none transition-all`}
                            placeholder="10:25 AM"
                        />
                        {!isValidTime && startTimeInput && (
                            <p className="text-xs text-red-500 mt-1">Invalid time format. Use "HH:MM AM/PM"</p>
                        )}
                    </div>

                    {/* Trip Count */}
                    <div>
                        <label className="block text-xs font-bold text-gray-500 uppercase mb-2">
                            Number of Trips to Add
                        </label>
                        <div className="flex items-center gap-4">
                            <input
                                type="range"
                                min={1}
                                max={10}
                                value={tripCount}
                                onChange={(e) => setTripCount(parseInt(e.target.value))}
                                className="flex-1 accent-blue-600"
                            />
                            <span className="text-2xl font-bold text-blue-600 w-12 text-center">{tripCount}</span>
                        </div>
                    </div>

                    {/* Preview */}
                    <div>
                        <label className="block text-xs font-bold text-gray-500 uppercase mb-2 flex items-center gap-2">
                            <Eye size={14} />
                            Preview
                            {hasAnyOverlap && (
                                <span className="text-orange-500 flex items-center gap-1">
                                    <AlertTriangle size={12} />
                                    Overlap detected
                                </span>
                            )}
                        </label>
                        <div className={`rounded-xl border divide-y max-h-48 overflow-auto ${hasAnyOverlap ? 'bg-orange-50/50 border-orange-200 divide-orange-100' : 'bg-blue-50/50 border-blue-100 divide-blue-100'}`}>
                            {tripPreviews.length > 0 ? (
                                tripPreviews.map((preview, idx) => (
                                    <div key={idx} className={`flex items-center justify-between p-3 ${preview.hasOverlap ? 'bg-orange-100/50' : ''}`}>
                                        <div className="flex items-center gap-3">
                                            <span className={`text-xs font-bold ${preview.hasOverlap ? 'text-orange-600' : 'text-blue-400'}`}>Trip {idx + 1}</span>
                                            <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${preview.direction === 'North' ? 'bg-blue-100 text-blue-600' : 'bg-indigo-100 text-indigo-600'}`}>
                                                {preview.direction}
                                            </span>
                                            {preview.hasOverlap && (
                                                <span className="text-[10px] font-bold text-orange-600 flex items-center gap-0.5">
                                                    <AlertTriangle size={10} />
                                                    Overlaps existing
                                                </span>
                                            )}
                                        </div>
                                        <div className={`font-mono text-sm ${preview.hasOverlap ? 'text-orange-700' : 'text-gray-700'}`}>
                                            {TimeUtils.fromMinutes(preview.startTime)} → {TimeUtils.fromMinutes(preview.endTime)}
                                        </div>
                                    </div>
                                ))
                            ) : (
                                <div className="p-4 text-center text-gray-400 text-sm">
                                    Enter a valid start time to see preview
                                </div>
                            )}
                        </div>
                        {hasAnyOverlap && (
                            <div className="mt-2 p-2 bg-orange-100 border border-orange-200 rounded-lg text-xs text-orange-700 flex items-center gap-2">
                                <AlertTriangle size={14} />
                                <span>Some trips overlap with existing schedule. You can still add them, but this may cause conflicts.</span>
                            </div>
                        )}
                    </div>
                </div>

                {/* Footer */}
                <div className="px-6 py-4 bg-gray-50 border-t border-gray-100 flex justify-end gap-3">
                    <button
                        onClick={onCancel}
                        className="px-4 py-2 text-sm font-bold text-gray-500 hover:bg-gray-100 rounded-lg transition-colors"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleConfirm}
                        disabled={!isValidTime}
                        className="px-6 py-2 bg-blue-600 text-white text-sm font-bold rounded-xl shadow-lg shadow-blue-200 hover:bg-blue-700 hover:shadow-xl active:scale-95 transition-all flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        <Plus size={16} />
                        Add {tripCount} Trip{tripCount > 1 ? 's' : ''}
                    </button>
                </div>

            </div>
        </div>
    );
};
