import React, { useMemo, useState } from 'react';
import { Timer, ArrowRight, Plus, Minus, Info, Clock, TrendingUp, Pause, Maximize2, Minimize2, ChevronUp, ChevronDown } from 'lucide-react';
import { MasterRouteTable, MasterTrip } from '../utils/masterScheduleParser';
import { TimeUtils } from '../utils/timeUtils';
import { getRouteColor, getRouteTextColor } from '../utils/routeColors';

interface TravelTimeGridProps {
    schedules: MasterRouteTable[];
    onBulkAdjust?: (fromStop: string, toStop: string, delta: number, routeName: string) => void;
    onRecoveryAdjust?: (stopName: string, delta: number, routeName: string) => void;
    onSingleTripAdjust?: (tripId: string, fromStop: string, delta: number, routeName: string) => void;
    onSingleRecoveryAdjust?: (tripId: string, stopName: string, delta: number, routeName: string) => void;
}

// Clean, professional heatmap colors
const getTravelColor = (minutes: number): string => {
    if (minutes === 0) return 'bg-gray-50 text-gray-300';
    if (minutes < 5) return 'bg-sky-50 text-sky-700';
    if (minutes < 10) return 'bg-emerald-50 text-emerald-700';
    if (minutes < 15) return 'bg-amber-50 text-amber-700';
    if (minutes < 20) return 'bg-orange-50 text-orange-700';
    return 'bg-rose-50 text-rose-700';
};

export const TravelTimeGrid: React.FC<TravelTimeGridProps> = ({ schedules, onBulkAdjust, onRecoveryAdjust, onSingleTripAdjust, onSingleRecoveryAdjust }) => {
    const [expandedRoute, setExpandedRoute] = useState<string | null>(null);
    const [isFullScreen, setIsFullScreen] = useState(false);

    // Process schedules into grid data
    const routeGrids = useMemo(() => {
        return schedules.map(table => {
            const isStationary = (from: string, to: string) =>
                from.split('(')[0].trim() === to.split('(')[0].trim();

            const rawPairs: { from: string; to: string; isStationary: boolean }[] = [];
            for (let i = 0; i < table.stops.length - 1; i++) {
                const from = table.stops[i];
                const to = table.stops[i + 1];
                rawPairs.push({ from, to, isStationary: isStationary(from, to) });
            }

            const stopPairs = rawPairs.filter(p => !p.isStationary);

            // hour -> stopPairIndex -> first trip found
            const hourlyData: Record<number, Record<number, { travel: number; recovery: number; tripId: string }>> = {};

            table.trips.forEach(trip => {
                const hour = Math.floor(trip.startTime / 60);
                if (!hourlyData[hour]) hourlyData[hour] = {};

                stopPairs.forEach((pair, filteredIdx) => {
                    if (hourlyData[hour][filteredIdx]) return;

                    const fromTimeStr = trip.stops[pair.from];
                    const toTimeStr = trip.stops[pair.to];

                    if (fromTimeStr && toTimeStr) {
                        const fromMins = TimeUtils.toMinutes(fromTimeStr);
                        const toMins = TimeUtils.toMinutes(toTimeStr);

                        if (fromMins !== null && toMins !== null) {
                            const travel = toMins - fromMins;
                            const recovery = trip.recoveryTimes?.[pair.to] || 0;

                            hourlyData[hour][filteredIdx] = { travel, recovery, tripId: trip.id };
                        }
                    }
                });
            });

            // Extract base route name for color
            const baseName = table.routeName
                .replace(/\s*\((North|South)\)/gi, '')
                .replace(/\s*\((Weekday|Saturday|Sunday)\)/gi, '')
                .trim();

            return {
                routeName: table.routeName,
                baseName,
                stopPairs,
                hourlyData
            };
        });
    }, [schedules]);

    if (schedules.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center py-20 text-gray-400">
                <Timer size={64} className="mb-4 opacity-20" />
                <p className="text-xl font-bold">No Schedule Data Loaded</p>
                <p className="text-sm">Upload a schedule file to view travel time analysis.</p>
            </div>
        );
    }

    return (
        <div className={`flex flex-col gap-3 ${isFullScreen ? 'fixed inset-0 z-50 bg-white overflow-auto p-4' : ''}`}>
            {/* Fullscreen Toggle + Legend Row */}
            <div className="flex items-center justify-between bg-white rounded-lg border border-gray-200 px-3 py-2">
                <div className="flex items-center gap-4 text-[10px]">
                    <span className="font-medium text-gray-500">Legend:</span>
                    <div className="flex items-center gap-1">
                        <div className="w-2 h-2 rounded bg-gray-100 border border-gray-300"></div>
                        <span className="text-gray-500">Travel</span>
                    </div>
                    <div className="flex items-center gap-1">
                        <div className="w-2 h-2 rounded bg-indigo-100 border border-indigo-300"></div>
                        <span className="text-indigo-600">Recovery</span>
                    </div>
                </div>
                <button
                    onClick={() => setIsFullScreen(!isFullScreen)}
                    className="flex items-center gap-1.5 px-2 py-1 bg-gray-100 hover:bg-gray-200 rounded text-xs font-medium text-gray-600 transition-colors"
                >
                    {isFullScreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
                    {isFullScreen ? 'Exit' : 'Fullscreen'}
                </button>
            </div>

            {routeGrids.map((grid, gridIdx) => {
                const routeColor = getRouteColor(grid.baseName);
                const textColor = getRouteTextColor(grid.baseName);

                return (
                    <div key={grid.routeName + gridIdx} className="bg-white rounded-lg border border-gray-200 overflow-hidden">
                        {/* Route Header - Compact */}
                        <div
                            className="px-4 py-2 flex justify-between items-center"
                            style={{ backgroundColor: routeColor, color: textColor }}
                        >
                            <div className="flex items-center gap-2">
                                <Timer size={16} />
                                <h3 className="text-sm font-bold">{grid.routeName}</h3>
                                <span className="text-[10px] opacity-70 uppercase">Travel Matrix</span>
                            </div>
                            <span className="text-[10px] opacity-80">First trip/hour</span>
                        </div>

                        {/* Table Container */}
                        <div className="overflow-auto">
                            <table className="w-full border-collapse text-sm">
                                <thead className="sticky top-0 z-30">
                                    <tr className="bg-gray-50">
                                        <th className="sticky left-0 z-20 bg-gray-100 p-2 border-b border-r border-gray-200 text-[10px] font-bold text-gray-500 uppercase min-w-[50px] text-center">
                                            Hour
                                        </th>
                                        {grid.stopPairs.map((pair, idx) => {
                                            const prevPair = idx > 0 ? grid.stopPairs[idx - 1] : null;
                                            const showFromStop = !prevPair || prevPair.to !== pair.from;

                                            return (
                                                <th key={idx} className="p-2 border-b border-gray-200 min-w-[100px] bg-gray-50">
                                                    <div className="flex flex-col gap-1 items-center text-center">
                                                        <div className="text-[10px] font-semibold text-gray-700 leading-tight" title={`${pair.from} → ${pair.to}`}>
                                                            {showFromStop && (
                                                                <span className="text-gray-400">{pair.from.split('(')[0].trim()} → </span>
                                                            )}
                                                            <span className="text-gray-800 font-bold">{pair.to.split('(')[0].trim()}</span>
                                                        </div>
                                                        <div className="flex items-center gap-1">
                                                            <div className="flex border border-gray-200 rounded overflow-hidden bg-white">
                                                                <button onClick={() => onBulkAdjust?.(pair.from, pair.to, -1, grid.routeName)} className="px-1 py-0.5 hover:bg-gray-100 text-gray-500" title="-1 travel">
                                                                    <Minus size={10} />
                                                                </button>
                                                                <span className="px-1 text-[8px] font-bold text-gray-400 border-x border-gray-100">T</span>
                                                                <button onClick={() => onBulkAdjust?.(pair.from, pair.to, 1, grid.routeName)} className="px-1 py-0.5 hover:bg-gray-100 text-gray-500" title="+1 travel">
                                                                    <Plus size={10} />
                                                                </button>
                                                            </div>
                                                            <div className="flex border border-indigo-200 rounded overflow-hidden bg-indigo-50">
                                                                <button onClick={() => onRecoveryAdjust?.(pair.to, -1, grid.routeName)} className="px-1 py-0.5 hover:bg-indigo-100 text-indigo-500" title="-1 recovery">
                                                                    <Minus size={10} />
                                                                </button>
                                                                <span className="px-1 text-[8px] font-bold text-indigo-500 border-x border-indigo-200">R</span>
                                                                <button onClick={() => onRecoveryAdjust?.(pair.to, 1, grid.routeName)} className="px-1 py-0.5 hover:bg-indigo-100 text-indigo-500" title="+1 recovery">
                                                                    <Plus size={10} />
                                                                </button>
                                                            </div>
                                                        </div>
                                                    </div>
                                                </th>
                                            );
                                        })}
                                    </tr>
                                </thead>
                                <tbody>
                                    {Array.from({ length: 24 }).map((_, hour) => {
                                        const hasDataForHour = Object.keys(grid.hourlyData[hour] || {}).length > 0;
                                        if (!hasDataForHour) return null;

                                        return (
                                            <tr
                                                key={hour}
                                                className={`transition-colors ${hour % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'} hover:bg-blue-50/30`}
                                            >
                                                <td className="sticky left-0 z-10 bg-gray-100 p-3 border-r border-b border-gray-200 text-center shadow-[2px_0_8px_-4px_rgba(0,0,0,0.1)]">
                                                    <span className="font-mono text-sm font-bold text-gray-700">
                                                        {hour.toString().padStart(2, '0')}:00
                                                    </span>
                                                </td>
                                                {grid.stopPairs.map((pair, idx) => {
                                                    const data = grid.hourlyData[hour][idx];

                                                    return (
                                                        <td
                                                            key={idx}
                                                            className="p-1 border-b border-gray-100 text-center bg-white group/cell"
                                                        >
                                                            {data ? (
                                                                <div className="flex flex-col items-center gap-0.5">
                                                                    {/* Travel Time Row */}
                                                                    <div className="flex items-center gap-0.5">
                                                                        <button
                                                                            onClick={() => onSingleTripAdjust?.(data.tripId, pair.to, -1, grid.routeName)}
                                                                            className="opacity-0 group-hover/cell:opacity-100 p-0.5 hover:bg-gray-100 text-gray-400 hover:text-gray-700 rounded transition-opacity"
                                                                            title="-1 travel"
                                                                        >
                                                                            <ChevronDown size={10} />
                                                                        </button>
                                                                        <span className="text-sm font-bold text-gray-800 min-w-[20px]">
                                                                            {data.travel}
                                                                        </span>
                                                                        <button
                                                                            onClick={() => onSingleTripAdjust?.(data.tripId, pair.to, 1, grid.routeName)}
                                                                            className="opacity-0 group-hover/cell:opacity-100 p-0.5 hover:bg-gray-100 text-gray-400 hover:text-gray-700 rounded transition-opacity"
                                                                            title="+1 travel"
                                                                        >
                                                                            <ChevronUp size={10} />
                                                                        </button>
                                                                    </div>
                                                                    {/* Recovery Time Row */}
                                                                    {data.recovery > 0 && (
                                                                        <div className="flex items-center gap-0.5">
                                                                            <button
                                                                                onClick={() => onSingleRecoveryAdjust?.(data.tripId, pair.to, -1, grid.routeName)}
                                                                                className="opacity-0 group-hover/cell:opacity-100 p-0.5 hover:bg-indigo-100 text-indigo-400 hover:text-indigo-700 rounded transition-opacity"
                                                                                title="-1 recovery"
                                                                            >
                                                                                <ChevronDown size={8} />
                                                                            </button>
                                                                            <span className="text-[10px] font-bold text-indigo-600">
                                                                                +{data.recovery}r
                                                                            </span>
                                                                            <button
                                                                                onClick={() => onSingleRecoveryAdjust?.(data.tripId, pair.to, 1, grid.routeName)}
                                                                                className="opacity-0 group-hover/cell:opacity-100 p-0.5 hover:bg-indigo-100 text-indigo-400 hover:text-indigo-700 rounded transition-opacity"
                                                                                title="+1 recovery"
                                                                            >
                                                                                <ChevronUp size={8} />
                                                                            </button>
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            ) : (
                                                                <span className="text-gray-200">—</span>
                                                            )}
                                                        </td>
                                                    );
                                                })}
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </div>
                );
            })
            }
        </div >
    );
};
