import React, { useMemo, useState } from 'react';
import { Timer, ArrowRight, Plus, Minus, Info, Clock, TrendingUp, Pause, Maximize2, Minimize2, ChevronUp, ChevronDown } from 'lucide-react';
import { MasterRouteTable } from '../utils/parsers/masterScheduleParser';
import { getRouteColor, getRouteTextColor } from '../utils/config/routeColors';
import { calculateGridTravelMinutes, isSamePhysicalStop, isStationaryTravelSegment } from '../utils/schedule/travelTimeGridUtils';

// Time Band type
interface TimeBandDisplay {
    id: string;
    color: string;
    avg: number;
}

// Analysis bucket type
interface TripBucketAnalysisDisplay {
    timeBucket: string;
    totalP50: number;
    totalP80: number;
    assignedBand?: string;
    ignored?: boolean;
    details?: Array<{
        segmentName: string;
        p50: number;
        p80: number;
    }>;
}

interface TravelTimeGridProps {
    schedules: MasterRouteTable[];
    onBulkAdjust?: (fromStop: string, toStop: string, delta: number, routeName: string) => void;
    onRecoveryAdjust?: (stopName: string, delta: number, routeName: string) => void;
    onSingleTripAdjust?: (tripId: string, fromStop: string, delta: number, routeName: string) => void;
    onSingleRecoveryAdjust?: (tripId: string, stopName: string, delta: number, routeName: string) => void;
    bands?: TimeBandDisplay[];
    analysis?: TripBucketAnalysisDisplay[];
    segmentNames?: string[];
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

export const TravelTimeGrid: React.FC<TravelTimeGridProps> = ({ schedules, onBulkAdjust, onRecoveryAdjust, onSingleTripAdjust, onSingleRecoveryAdjust, bands, analysis, segmentNames }) => {
    const [expandedRoute, setExpandedRoute] = useState<string | null>(null);
    const [isFullScreen, setIsFullScreen] = useState(false);
    const displaySegmentNames = useMemo(
        () => (segmentNames || []).filter(segmentName => !isStationaryTravelSegment(segmentName)),
        [segmentNames]
    );
    const formatHourLabel = (hour: number) => {
        if (hour >= 24) return `${hour}:00`;

        const normalized = hour % 24;
        if (normalized === 0) return '12 AM';
        if (normalized < 12) return `${normalized} AM`;
        if (normalized === 12) return '12 PM';
        return `${normalized - 12} PM`;
    };

    // Process schedules into grid data
    const routeGrids = useMemo(() => {
        return schedules.map(table => {
            const rawPairs: { from: string; to: string; isStationary: boolean }[] = [];
            for (let i = 0; i < table.stops.length - 1; i++) {
                const from = table.stops[i];
                const to = table.stops[i + 1];
                rawPairs.push({ from, to, isStationary: isSamePhysicalStop(from, to) });
            }

            const stopPairs = rawPairs.filter(p => !p.isStationary);

            // hour -> stopPairIndex -> first trip found
            const hourlyData: Record<number, Record<number, { travel: number; recovery: number; tripId: string }>> = {};

            const orderedTrips = [...table.trips].sort((a, b) => a.startTime - b.startTime);
            const selectedHourSources: Record<number, string> = {};

            orderedTrips.forEach(trip => {
                const hour = Math.floor(trip.startTime / 60);
                if (selectedHourSources[hour]) return;

                const tripRowData: Record<number, { travel: number; recovery: number; tripId: string }> = {};

                stopPairs.forEach((pair, filteredIdx) => {
                    const travel = calculateGridTravelMinutes(trip, pair.from, pair.to);
                    if (travel === null) return;

                    const recovery = trip.recoveryTimes?.[pair.to] || 0;
                    tripRowData[filteredIdx] = { travel, recovery, tripId: trip.id };
                });

                if (Object.keys(tripRowData).length > 0) {
                    selectedHourSources[hour] = trip.id;
                    hourlyData[hour] = tripRowData;
                }
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
                hourlyData,
                hours: Array.from(
                    { length: Math.max(25, Math.max(0, ...Object.keys(hourlyData).map(Number)) + 1) },
                    (_, hour) => hour
                )
            };
        });
    }, [schedules]);

    // Calculate band summary with segment breakdowns (p50 and p80)
    const bandSummary = useMemo(() => {
        if (!bands || !analysis || displaySegmentNames.length === 0) return null;

        const summary: Record<string, {
            band: TimeBandDisplay;
            segmentTotals: Record<string, { sumP50: number; sumP80: number; count: number }>;
            totalSumP50: number;
            totalSumP80: number;
            totalCount: number;
            timeSlots: string[];
        }> = {};

        // Initialize summary for each band
        bands.forEach(band => {
            summary[band.id] = {
                band,
                segmentTotals: {},
                totalSumP50: 0,
                totalSumP80: 0,
                totalCount: 0,
                timeSlots: []
            };
            displaySegmentNames.forEach(seg => {
                summary[band.id].segmentTotals[seg] = { sumP50: 0, sumP80: 0, count: 0 };
            });
        });

        // Aggregate data from each bucket into its assigned band
        analysis.forEach(bucket => {
            if (bucket.ignored || !bucket.assignedBand) return;
            const bandData = summary[bucket.assignedBand];
            if (!bandData) return;

            // Track the time slot
            const timeSlot = bucket.timeBucket.split(' - ')[0];
            bandData.timeSlots.push(timeSlot);

            bucket.details?.forEach(detail => {
                if (bandData.segmentTotals[detail.segmentName]) {
                    bandData.segmentTotals[detail.segmentName].sumP50 += detail.p50;
                    bandData.segmentTotals[detail.segmentName].sumP80 += detail.p80;
                    bandData.segmentTotals[detail.segmentName].count += 1;
                }
            });

            bandData.totalSumP50 += bucket.totalP50;
            bandData.totalSumP80 += bucket.totalP80;
            bandData.totalCount += 1;
        });

        return summary;
    }, [bands, analysis, displaySegmentNames]);

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
        <div className={`flex flex-col gap-4 ${isFullScreen ? 'fixed inset-0 z-50 bg-white overflow-auto p-4' : ''}`}>
            {/* Segment Times by Band Table */}
            {bandSummary && bands && displaySegmentNames.length > 0 && (
                <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                    <div className="p-4 border-b border-gray-200 bg-gray-50">
                        <h3 className="font-bold text-gray-900">Segment Times by Band</h3>
                        <p className="text-xs text-gray-500 mt-1">Average 50th and 80th Percentile travel times per band</p>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="bg-gray-100 border-b border-gray-200">
                                    <th className="px-4 py-3 text-left font-bold text-gray-700 min-w-[100px]">Band</th>
                                    <th className="px-4 py-3 text-left font-bold text-gray-700 min-w-[180px]">Time Slots</th>
                                    {displaySegmentNames.map(seg => (
                                        <th key={seg} className="px-3 py-3 text-center font-medium text-gray-600 min-w-[90px]">
                                            <div className="flex flex-col items-center">
                                                {seg.split(' to ').map((s, i) => (
                                                    <span key={i} className={`text-xs ${i === 1 ? 'text-gray-400' : 'font-semibold'}`}>
                                                        {i === 1 && '↓ '}
                                                        {s.length > 15 ? s.substring(0, 12) + '...' : s}
                                                    </span>
                                                ))}
                                            </div>
                                        </th>
                                    ))}
                                    <th className="px-4 py-3 text-center font-bold text-gray-700 min-w-[80px] bg-gray-200">
                                        <div className="flex flex-col">
                                            <span>Total</span>
                                            <span className="text-[10px] font-normal text-gray-500">p50 / p80</span>
                                        </div>
                                    </th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                                {bands.map(band => {
                                    const data = bandSummary[band.id];
                                    if (!data || data.totalCount === 0) return null;

                                    const avgTotalP50 = data.totalSumP50 / data.totalCount;
                                    const avgTotalP80 = data.totalSumP80 / data.totalCount;

                                    // Find min/max for color gradients
                                    const allP50s = displaySegmentNames.map(seg => {
                                        const s = data.segmentTotals[seg];
                                        return s && s.count > 0 ? s.sumP50 / s.count : 0;
                                    });
                                    const maxP50 = Math.max(...allP50s);

                                    return (
                                        <tr key={band.id} className="hover:bg-blue-50/30">
                                            <td className="px-4 py-3">
                                                <div className="flex items-center gap-3">
                                                    <span
                                                        className="px-3 py-1 rounded-lg text-sm font-bold text-white shadow-sm"
                                                        style={{ backgroundColor: band.color }}
                                                    >
                                                        {band.id}
                                                    </span>
                                                    <span className="text-xs text-gray-500">{band.avg.toFixed(0)}m</span>
                                                </div>
                                            </td>
                                            <td className="px-4 py-3">
                                                <div className="flex flex-wrap gap-1">
                                                    {data.timeSlots.slice(0, 6).map((slot, idx) => (
                                                        <span key={idx} className="px-1.5 py-0.5 bg-gray-100 rounded text-[10px] font-medium text-gray-600">
                                                            {slot}
                                                        </span>
                                                    ))}
                                                    {data.timeSlots.length > 6 && (
                                                        <span className="text-[10px] text-gray-400">+{data.timeSlots.length - 6}</span>
                                                    )}
                                                </div>
                                            </td>
                                            {displaySegmentNames.map(seg => {
                                                const segData = data.segmentTotals[seg];
                                                const avgP50 = segData && segData.count > 0 ? segData.sumP50 / segData.count : 0;
                                                const avgP80 = segData && segData.count > 0 ? segData.sumP80 / segData.count : 0;
                                                const intensity = maxP50 > 0 ? avgP50 / maxP50 : 0;
                                                const bgOpacity = Math.round(intensity * 30 + 10);

                                                return (
                                                    <td
                                                        key={seg}
                                                        className="px-2 py-2 text-center"
                                                        style={{
                                                            backgroundColor: `rgba(${Math.round(255 * intensity)}, ${Math.round(200 - 100 * intensity)}, ${Math.round(150 - 100 * intensity)}, 0.${bgOpacity})`
                                                        }}
                                                    >
                                                        <div className="flex flex-col">
                                                            <span className="font-bold text-gray-800">{Math.round(avgP50)}</span>
                                                            <span className="text-[10px] text-gray-400">{Math.round(avgP80)}</span>
                                                        </div>
                                                    </td>
                                                );
                                            })}
                                            <td className="px-3 py-2 text-center bg-gray-50 border-l border-gray-200">
                                                <div className="flex flex-col">
                                                    <span className="font-bold text-gray-900 text-lg">{Math.round(avgTotalP50)}</span>
                                                    <span className="text-xs text-gray-500">{Math.round(avgTotalP80)}</span>
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* Fullscreen Toggle + Legend Row */}
            <div className="flex items-center justify-between bg-white rounded-lg border border-gray-200 px-3 py-2">
                <div className="flex items-center gap-4 text-[10px]">
                    <span className="font-medium text-gray-500">Hourly Breakdown:</span>
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
                            <span className="text-[10px] opacity-80">First trip with data in hour</span>
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
                                    {grid.hours.map(hour => {
                                        const hasDataForHour = Object.keys(grid.hourlyData[hour] || {}).length > 0;
                                        if (!hasDataForHour) return null;

                                        return (
                                            <tr
                                                key={hour}
                                                className={`transition-colors ${hour % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'} hover:bg-blue-50/30`}
                                            >
                                                <td className="sticky left-0 z-10 bg-gray-100 p-3 border-r border-b border-gray-200 text-center shadow-[2px_0_8px_-4px_rgba(0,0,0,0.1)]">
                                                    <span className="font-mono text-sm font-bold text-gray-700">
                                                        {formatHourLabel(hour)}
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
                                                                            className="opacity-0 group-hover/cell:opacity-100 group-focus-within/cell:opacity-100 focus:opacity-100 p-0.5 hover:bg-gray-100 text-gray-400 hover:text-gray-700 rounded transition-opacity"
                                                                            title="-1 travel"
                                                                        >
                                                                            <ChevronDown size={10} />
                                                                        </button>
                                                                        <span className="text-sm font-bold text-gray-800 min-w-[20px]">
                                                                            {data.travel}
                                                                        </span>
                                                                        <button
                                                                            onClick={() => onSingleTripAdjust?.(data.tripId, pair.to, 1, grid.routeName)}
                                                                            className="opacity-0 group-hover/cell:opacity-100 group-focus-within/cell:opacity-100 focus:opacity-100 p-0.5 hover:bg-gray-100 text-gray-400 hover:text-gray-700 rounded transition-opacity"
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
                                                                                className="opacity-0 group-hover/cell:opacity-100 group-focus-within/cell:opacity-100 focus:opacity-100 p-0.5 hover:bg-indigo-100 text-indigo-400 hover:text-indigo-700 rounded transition-opacity"
                                                                                title="-1 recovery"
                                                                            >
                                                                                <ChevronDown size={8} />
                                                                            </button>
                                                                            <span className="text-[10px] font-bold text-indigo-600">
                                                                                +{data.recovery}r
                                                                            </span>
                                                                            <button
                                                                                onClick={() => onSingleRecoveryAdjust?.(data.tripId, pair.to, 1, grid.routeName)}
                                                                                className="opacity-0 group-hover/cell:opacity-100 group-focus-within/cell:opacity-100 focus:opacity-100 p-0.5 hover:bg-indigo-100 text-indigo-400 hover:text-indigo-700 rounded transition-opacity"
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
