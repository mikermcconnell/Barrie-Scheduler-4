/**
 * RoundTripTableView Component
 *
 * Displays schedules in a combined North/South round-trip format.
 * Shows trips paired by block with metrics and interline connections.
 *
 * Extracted from ScheduleEditor.tsx for maintainability.
 */

import React, { useMemo } from 'react';
import {
    ChevronDown,
    ChevronUp,
    Plus,
    Pencil,
    Trash2,
    ArrowRight,
    ArrowLeft
} from 'lucide-react';
import {
    MasterRouteTable,
    MasterTrip,
    RoundTripTable,
    buildRoundTripView
} from '../../utils/masterScheduleParser';
import { TimeUtils } from '../../utils/timeUtils';
import {
    calculateHeadways,
    getRatioColor,
    getRecoveryStatus,
    calculatePeakVehicles,
    calculateServiceSpan,
    analyzeHeadways,
    calculateTripsPerHour,
    getBandRowColor,
    parseTimeInput,
    validateSchedule
} from '../../utils/scheduleEditorUtils';
import {
    FilterState,
    shouldGrayOutTrip,
    shouldHighlightTrip,
    matchesSearch
} from '../NewSchedule/QuickActionsBar';
import { StackedTimeCell, StackedTimeInput } from '../ui/StackedTimeInput';

// --- Types ---

export interface RoundTripTableViewProps {
    schedules: MasterRouteTable[];
    onCellEdit?: (tripId: string, col: string, val: string) => void;
    onTimeAdjust?: (tripId: string, stopName: string, delta: number) => void;
    onRecoveryEdit?: (tripId: string, stopName: string, delta: number) => void;
    originalSchedules?: MasterRouteTable[];
    onDeleteTrip?: (tripId: string) => void;
    onDuplicateTrip?: (tripId: string) => void;
    onAddTrip?: (blockId: string, afterTripId: string) => void;
    onTripRightClick?: (
        e: React.MouseEvent,
        tripId: string,
        tripDirection: 'North' | 'South',
        blockId: string,
        stops: string[],
        stopName?: string,
        stopIndex?: number
    ) => void;
    onMenuOpen?: (tripId: string, x: number, y: number, direction: 'North' | 'South', blockId: string, stops: string[]) => void;
    draftName?: string;
    filter?: FilterState;
    targetCycleTime?: number;
    targetHeadway?: number;
    readOnly?: boolean;
}

// --- Component ---

export const RoundTripTableView: React.FC<RoundTripTableViewProps> = ({
    schedules,
    onCellEdit,
    onTimeAdjust,
    onRecoveryEdit,
    originalSchedules,
    onDeleteTrip,
    onDuplicateTrip,
    onAddTrip,
    onTripRightClick,
    onMenuOpen,
    draftName,
    filter,
    targetCycleTime,
    targetHeadway,
    readOnly = false
}) => {
    console.log('RoundTripTableView targetCycleTime:', targetCycleTime, 'targetHeadway:', targetHeadway);

    const roundTripData = useMemo(() => {
        const pairs: { north: MasterRouteTable; south: MasterRouteTable; combined: RoundTripTable }[] = [];
        const routeGroups: Record<string, { north?: MasterRouteTable; south?: MasterRouteTable }> = {};

        schedules.forEach(table => {
            const baseName = table.routeName.replace(/ \(North\).*$/, '').replace(/ \(South\).*$/, '');
            if (!routeGroups[baseName]) routeGroups[baseName] = {};
            if (table.routeName.includes('(North)')) routeGroups[baseName].north = table;
            else if (table.routeName.includes('(South)')) routeGroups[baseName].south = table;
        });

        Object.entries(routeGroups).forEach(([baseName, group]) => {
            if (group.north && group.south) {
                const combined = buildRoundTripView(group.north, group.south);
                pairs.push({ north: group.north, south: group.south, combined });
            }
        });
        return pairs;
    }, [schedules]);

    if (roundTripData.length === 0) return <div className="text-center p-8 text-gray-400">No matching North/South pairs found.</div>;

    return (
        <div className="space-y-8 h-full flex flex-col">
            {roundTripData.map(({ combined, north, south }) => {
                const allNorthTrips = north?.trips || [];
                const allSouthTrips = south?.trips || [];
                const headways = calculateHeadways([...allNorthTrips, ...allSouthTrips]);
                const northStopsWithRecovery = new Set<string>();
                const southStopsWithRecovery = new Set<string>();

                combined.rows.forEach(row => {
                    row.trips.forEach(t => {
                        if (t.recoveryTimes) {
                            Object.entries(t.recoveryTimes).forEach(([stop, min]) => {
                                if (min !== undefined && min !== null) {
                                    (t.direction === 'North' ? northStopsWithRecovery : southStopsWithRecovery).add(stop);
                                }
                            });
                        }
                    });
                });

                const summaryTable: MasterRouteTable = {
                    routeName: combined.routeName,
                    trips: [...allNorthTrips, ...allSouthTrips],
                    stops: [], stopIds: {}
                };

                const hideInterline = combined.routeName.includes('8A') || combined.routeName.includes('8B');
                const isInterlinedRoute = combined.routeName.includes('8A') || combined.routeName.includes('8B');

                // Calculate Route Totals for the Header
                const totalTrips = combined.rows.length;
                const allTrips = [...allNorthTrips, ...allSouthTrips];
                const totalTravelSum = combined.rows.reduce((sum, r) => sum + r.totalTravelTime, 0);
                const totalRecoverySum = combined.rows.reduce((sum, r) => sum + r.totalRecoveryTime, 0);
                const avgTravel = totalTrips > 0 ? (totalTravelSum / totalTrips).toFixed(1) : '0';
                const avgRecovery = totalTrips > 0 ? (totalRecoverySum / totalTrips).toFixed(1) : '0';

                // For interlined routes (8A/8B), calculate effective cycle time that accounts for interline gaps
                const calculateEffectiveCycleSum = (): number => {
                    if (!isInterlinedRoute) {
                        return combined.rows.reduce((sum, r) => sum + r.totalCycleTime, 0);
                    }

                    const interlineStopPattern = 'allandale';

                    const timeDiff = (end: number, start: number): number => {
                        const diff = end - start;
                        return diff < 0 ? diff + 1440 : diff;
                    };

                    const buildColMap = (table: MasterRouteTable): Record<number, { type: string; stopName?: string }> => {
                        const colMap: Record<number, { type: string; stopName?: string }> = {};
                        let colNum = 1;
                        colMap[colNum++] = { type: 'block' };
                        table.stops.forEach(stop => {
                            colMap[colNum++] = { type: 'stop', stopName: stop };
                            const hasRecovery = table.trips.some(t => t.recoveryTimes?.[stop] !== undefined && t.recoveryTimes[stop] !== null);
                            if (hasRecovery) {
                                colMap[colNum++] = { type: 'recovery', stopName: stop };
                            }
                        });
                        return colMap;
                    };

                    const findInterlineColumns = (colMap: Record<number, { type: string; stopName?: string }>): { interlineArr: number; recoveryCol: number | null; resumeCol: number | null } | null => {
                        let interlineArr: number | null = null;
                        let recoveryCol: number | null = null;
                        let resumeCol: number | null = null;

                        const sortedCols = Object.entries(colMap)
                            .map(([col, info]) => ({ col: parseInt(col), info }))
                            .sort((a, b) => a.col - b.col);

                        for (let i = 0; i < sortedCols.length; i++) {
                            const { col, info } = sortedCols[i];
                            if (info.type === 'stop' && info.stopName?.toLowerCase().includes(interlineStopPattern)) {
                                interlineArr = col;
                                if (i + 1 < sortedCols.length) {
                                    const next = sortedCols[i + 1];
                                    if (next.info.type === 'recovery' && next.info.stopName?.toLowerCase().includes(interlineStopPattern)) {
                                        recoveryCol = next.col;
                                        if (i + 2 < sortedCols.length) {
                                            const nextStop = sortedCols[i + 2];
                                            if (nextStop.info.type === 'stop') {
                                                resumeCol = nextStop.col;
                                            }
                                        }
                                    }
                                }
                                break;
                            }
                        }

                        if (interlineArr === null) return null;
                        return { interlineArr, recoveryCol, resumeCol };
                    };

                    const getColVal = (trip: MasterTrip, col: number, colMap: Record<number, { type: string; stopName?: string }>): number | null => {
                        const info = colMap[col];
                        if (!info) return null;
                        if (info.type === 'stop' && info.stopName) {
                            const timeStr = trip.stops[info.stopName];
                            return timeStr ? TimeUtils.toMinutes(timeStr) : null;
                        }
                        if (info.type === 'recovery' && info.stopName) {
                            return trip.recoveryTimes?.[info.stopName] ?? null;
                        }
                        return null;
                    };

                    const getFirstTime = (trip: MasterTrip, colMap: Record<number, { type: string; stopName?: string }>): number | null => {
                        for (const [, info] of Object.entries(colMap).sort((a, b) => parseInt(a[0]) - parseInt(b[0]))) {
                            if (info.type === 'stop' && info.stopName) {
                                const timeStr = trip.stops[info.stopName];
                                const time = timeStr ? TimeUtils.toMinutes(timeStr) : null;
                                if (time !== null) return time;
                            }
                        }
                        return null;
                    };

                    const getLastTime = (trip: MasterTrip, colMap: Record<number, { type: string; stopName?: string }>): number | null => {
                        let lastTime: number | null = null;
                        for (const [, info] of Object.entries(colMap)) {
                            if (info.type === 'stop' && info.stopName) {
                                const timeStr = trip.stops[info.stopName];
                                const time = timeStr ? TimeUtils.toMinutes(timeStr) : null;
                                if (time !== null) lastTime = time;
                            }
                        }
                        return lastTime;
                    };

                    const calcTripEffectiveCycle = (trip: MasterTrip, colMap: Record<number, { type: string; stopName?: string }>, interlineCols: { interlineArr: number; recoveryCol: number | null; resumeCol: number | null } | null): number => {
                        if (!interlineCols) {
                            return trip.cycleTime;
                        }

                        const firstDep = getFirstTime(trip, colMap);
                        const interlineArr = getColVal(trip, interlineCols.interlineArr, colMap);
                        const recovery = interlineCols.recoveryCol ? getColVal(trip, interlineCols.recoveryCol, colMap) : null;
                        const resume = interlineCols.resumeCol ? getColVal(trip, interlineCols.resumeCol, colMap) : null;
                        const finalArr = getLastTime(trip, colMap);

                        if (firstDep === null || interlineArr === null) {
                            return trip.cycleTime;
                        }

                        const endsAtInterline = resume === null;

                        if (endsAtInterline) {
                            const segment1 = timeDiff(interlineArr, firstDep);
                            return segment1 + (recovery ?? 0);
                        }

                        const segment1 = timeDiff(interlineArr, firstDep);
                        const recoveryVal = recovery ?? 0;

                        if (resume !== null && finalArr !== null) {
                            const segment2 = timeDiff(finalArr, resume);
                            return segment1 + recoveryVal + segment2;
                        }

                        return segment1 + recoveryVal;
                    };

                    let totalEffective = 0;

                    if (north) {
                        const northColMap = buildColMap(north);
                        const northInterlineCols = findInterlineColumns(northColMap);
                        for (const trip of north.trips) {
                            totalEffective += calcTripEffectiveCycle(trip, northColMap, northInterlineCols);
                        }
                    }

                    if (south) {
                        const southColMap = buildColMap(south);
                        const southInterlineCols = findInterlineColumns(southColMap);
                        for (const trip of south.trips) {
                            totalEffective += calcTripEffectiveCycle(trip, southColMap, southInterlineCols);
                        }
                    }

                    return totalEffective;
                };

                const totalCycleSum = calculateEffectiveCycleSum();

                const overallRatio = totalTravelSum > 0 ? ((totalRecoverySum / totalTravelSum) * 100) : 0;
                const ratioStatus = getRecoveryStatus(overallRatio);

                const peakVehicles = calculatePeakVehicles(allTrips);
                const serviceSpan = calculateServiceSpan(allTrips);
                const headwayAnalysis = analyzeHeadways(allTrips);
                const tripsPerHour = calculateTripsPerHour(allTrips);
                const warnings = validateSchedule(allTrips);

                const hours = Object.keys(tripsPerHour).map(Number).sort((a, b) => a - b);
                const minHour = hours.length > 0 ? hours[0] : 6;
                const maxHour = hours.length > 0 ? hours[hours.length - 1] : 22;
                const maxTripsInHour = Math.max(...Object.values(tripsPerHour), 1);

                return (
                    <div key={combined.routeName} className="flex flex-col bg-white rounded-xl shadow-sm border border-gray-100 h-full min-h-0">

                        {/* Header Area */}
                        <div className={`${readOnly ? 'px-4 py-2' : 'px-6 py-5'} border-b border-gray-100 flex-shrink-0`}>
                            <div className={`flex items-stretch ${readOnly ? 'gap-4' : 'gap-6'}`}>
                                <div className="flex flex-col justify-center">
                                    <span className="text-[10px] font-medium text-gray-400 uppercase tracking-wide mb-1">Service Window</span>
                                    <div className="flex items-baseline gap-2">
                                        <span className="text-lg font-semibold text-gray-800">{serviceSpan.start} – {serviceSpan.end}</span>
                                        <span className="text-xs text-gray-400">{serviceSpan.hours}h</span>
                                    </div>
                                </div>

                                <div className="w-px bg-gray-200" />

                                <div className="flex flex-col justify-center">
                                    <span className="text-[10px] font-medium text-gray-400 uppercase tracking-wide mb-1">Vehicles</span>
                                    <span className="text-lg font-semibold text-gray-800">{peakVehicles}</span>
                                </div>

                                <div className="w-px bg-gray-200" />

                                <div className="flex flex-col justify-center">
                                    <span className="text-[10px] font-medium text-gray-400 uppercase tracking-wide mb-1">Trips</span>
                                    <span className="text-lg font-semibold text-gray-800">{totalTrips}</span>
                                </div>

                                <div className="w-px bg-gray-200" />

                                <div className="flex flex-col justify-center">
                                    <span className="text-[10px] font-medium text-gray-400 uppercase tracking-wide mb-1">Service Hours</span>
                                    <div className="flex items-baseline gap-3">
                                        <span className="text-lg font-semibold text-gray-800">{Math.round(totalCycleSum / 60)}h</span>
                                        <span className="text-xs text-gray-400">
                                            {Math.round(totalTravelSum / 60)}h travel + {Math.round(totalRecoverySum / 60)}h recovery
                                        </span>
                                        {isInterlinedRoute && (
                                            <span className="text-[10px] text-blue-500 font-mono">
                                                ({totalCycleSum} min)
                                            </span>
                                        )}
                                    </div>
                                </div>

                                <div className="w-px bg-gray-200" />

                                <div className="flex flex-col justify-center">
                                    <span className="text-[10px] font-medium text-gray-400 uppercase tracking-wide mb-1">Recovery Ratio</span>
                                    <span className={`text-lg font-semibold ${overallRatio > 25 ? 'text-amber-600' : overallRatio < 10 ? 'text-red-600' : 'text-gray-800'}`}>
                                        {overallRatio.toFixed(0)}%
                                    </span>
                                </div>

                                <div className="w-px bg-gray-200" />

                                <div className="flex flex-col justify-center">
                                    <span className="text-[10px] font-medium text-gray-400 uppercase tracking-wide mb-1">Avg Headway</span>
                                    <div className="flex items-baseline gap-1">
                                        <span className="text-lg font-semibold text-gray-800">{headwayAnalysis.avg}</span>
                                        <span className="text-xs text-gray-400">min</span>
                                    </div>
                                </div>

                                <div className="flex-1" />

                                {!readOnly && <div className="flex flex-col justify-center">
                                    <span className="text-[10px] font-medium text-gray-400 uppercase tracking-wide mb-1">Frequency</span>
                                    {(() => {
                                        const hourCounts = Object.values(tripsPerHour).filter(c => c > 0);
                                        const avgTrips = hourCounts.length > 0
                                            ? (hourCounts.reduce((a, b) => a + b, 0) / hourCounts.length).toFixed(1)
                                            : '0';

                                        const peakHours = Object.entries(tripsPerHour)
                                            .filter(([_, count]) => count === maxTripsInHour && count > 0)
                                            .map(([hour]) => parseInt(hour))
                                            .sort((a, b) => a - b);

                                        const formatPeakHours = (hours: number[]) => {
                                            if (hours.length === 0) return '';
                                            if (hours.length <= 2) return hours.map(h => `${h}:00`).join(', ');
                                            const ranges: string[] = [];
                                            let start = hours[0];
                                            let end = hours[0];
                                            for (let i = 1; i <= hours.length; i++) {
                                                if (i < hours.length && hours[i] === end + 1) {
                                                    end = hours[i];
                                                } else {
                                                    ranges.push(start === end ? `${start}:00` : `${start}-${end}:00`);
                                                    if (i < hours.length) {
                                                        start = hours[i];
                                                        end = hours[i];
                                                    }
                                                }
                                            }
                                            return ranges.slice(0, 2).join(', ');
                                        };

                                        return (
                                            <div className="flex items-baseline gap-2">
                                                <span className="text-lg font-semibold text-gray-800">{avgTrips}</span>
                                                <span className="text-xs text-gray-400">round trips/hr</span>
                                                {peakHours.length > 0 && maxTripsInHour > 1 && (
                                                    <span className="text-xs text-gray-400 ml-2">
                                                        Peak: {maxTripsInHour}/hr <span className="text-gray-300">({formatPeakHours(peakHours)})</span>
                                                    </span>
                                                )}
                                            </div>
                                        );
                                    })()}
                                </div>}
                            </div>
                        </div>

                        {/* Main Table Area */}
                        <div className="overflow-auto custom-scrollbar relative w-full flex-1 min-h-0">
                            <div className="absolute right-0 top-0 bottom-0 w-12 bg-gradient-to-l from-white to-transparent pointer-events-none z-50" />

                            <table className="w-full text-left border-collapse text-[11px]" style={{ tableLayout: 'fixed' }}>
                                <colgroup>
                                    {!readOnly && <col className="w-16" />}
                                    <col className="w-14" />
                                    {combined.northStops.map((stop, i) => (
                                        <React.Fragment key={`n-col-${i}`}>
                                            {i > 0 && northStopsWithRecovery.has(stop) && <col className="w-14" />}
                                            {i > 0 && northStopsWithRecovery.has(stop) && <col className="w-8" />}
                                            <col style={{ width: '70px' }} />
                                        </React.Fragment>
                                    ))}
                                    {combined.southStops.map((stop, i) => (
                                        <React.Fragment key={`s-col-${i}`}>
                                            {i > 0 && southStopsWithRecovery.has(stop) && <col className="w-14" />}
                                            {i > 0 && southStopsWithRecovery.has(stop) && <col className="w-8" />}
                                            <col style={{ width: '70px' }} />
                                        </React.Fragment>
                                    ))}
                                    <col className="w-10" />
                                    <col className="w-8" />
                                    <col className="w-10" />
                                    <col className="w-10" />
                                    <col className="w-10" />
                                    <col className="w-10" />
                                </colgroup>
                                <thead className="sticky top-0 z-40 bg-white shadow-sm">
                                    {/* Column Numbers Row */}
                                    <tr className="bg-gray-50 text-gray-400">
                                        {(() => {
                                            let colNum = 1;
                                            const cells: React.ReactNode[] = [];
                                            if (!readOnly) {
                                                cells.push(<th key="col-actions" className="py-0.5 px-1 border-b border-gray-200 bg-gray-100 sticky left-0 z-50 text-[8px] font-mono text-gray-400 text-center">{colNum++}</th>);
                                            }
                                            cells.push(<th key="col-block" className={`py-0.5 px-1 border-b border-gray-200 bg-gray-100 sticky ${readOnly ? 'left-0' : 'left-16'} z-50 text-[8px] font-mono text-gray-400 text-center`}>{colNum++}</th>);
                                            combined.northStops.forEach((stop, i) => {
                                                if (i > 0 && northStopsWithRecovery.has(stop)) {
                                                    cells.push(<th key={`col-n-arr-${i}`} className="py-0.5 px-1 border-b border-gray-200 text-[8px] font-mono text-gray-400 text-center">{colNum++}</th>);
                                                    cells.push(<th key={`col-n-rec-${i}`} className="py-0.5 px-1 border-b border-gray-200 text-[8px] font-mono text-gray-400 text-center">{colNum++}</th>);
                                                }
                                                cells.push(<th key={`col-n-stop-${i}`} className="py-0.5 px-1 border-b border-gray-200 bg-blue-50/30 text-[8px] font-mono text-blue-600 text-center">{colNum++}</th>);
                                            });
                                            combined.southStops.forEach((stop, i) => {
                                                if (i > 0 && southStopsWithRecovery.has(stop)) {
                                                    cells.push(<th key={`col-s-arr-${i}`} className="py-0.5 px-1 border-b border-gray-200 text-[8px] font-mono text-gray-400 text-center">{colNum++}</th>);
                                                    cells.push(<th key={`col-s-rec-${i}`} className="py-0.5 px-1 border-b border-gray-200 text-[8px] font-mono text-gray-400 text-center">{colNum++}</th>);
                                                }
                                                cells.push(<th key={`col-s-stop-${i}`} className="py-0.5 px-1 border-b border-gray-200 bg-orange-50/30 text-[8px] font-mono text-orange-600 text-center">{colNum++}</th>);
                                            });
                                            ['Tr', 'Bd', 'Rc', 'Rt', 'Hw', 'Cy', 'Lk'].forEach((label, i) => {
                                                cells.push(<th key={`col-sum-${i}`} className="py-0.5 px-1 border-b border-gray-200 bg-gray-50 text-[8px] font-mono text-gray-400 text-center">{colNum++}</th>);
                                            });
                                            return cells;
                                        })()}
                                    </tr>
                                    {/* Stop Names Row */}
                                    <tr className="bg-white">
                                        {!readOnly && <th rowSpan={2} className="p-2 border-b border-gray-200 bg-gray-100 sticky left-0 z-50 text-[9px] font-medium text-gray-400 uppercase text-center align-middle"></th>}
                                        <th rowSpan={2} className={`p-2 border-b border-gray-200 bg-gray-100 sticky ${readOnly ? 'left-0' : 'left-16'} z-50 text-[10px] font-semibold text-gray-500 uppercase tracking-wide text-center align-middle`}>Block</th>
                                        {combined.northStops.map((stop, i) => {
                                            const hasRecovery = i > 0 && northStopsWithRecovery.has(stop);
                                            const colSpan = i === 0 ? 1 : (hasRecovery ? 3 : 1);
                                            return (
                                                <th
                                                    key={`n-name-${stop}`}
                                                    colSpan={colSpan}
                                                    className="px-1 py-2 border-b border-l border-gray-200 bg-blue-50/50 text-[8px] font-semibold text-blue-700 uppercase tracking-tight text-center"
                                                    title={stop}
                                                >
                                                    <div className="leading-tight break-words" style={{ wordBreak: 'break-word' }}>
                                                        {stop}
                                                    </div>
                                                </th>
                                            );
                                        })}
                                        {combined.southStops.map((stop, i) => {
                                            const hasRecovery = i > 0 && southStopsWithRecovery.has(stop);
                                            const colSpan = i === 0 ? 1 : (hasRecovery ? 3 : 1);
                                            return (
                                                <th
                                                    key={`s-name-${stop}`}
                                                    colSpan={colSpan}
                                                    className="px-1 py-2 border-b border-l border-gray-200 bg-orange-50/50 text-[8px] font-semibold text-orange-700 uppercase tracking-tight text-center"
                                                    title={stop}
                                                >
                                                    <div className="leading-tight break-words" style={{ wordBreak: 'break-word' }}>
                                                        {stop}
                                                    </div>
                                                </th>
                                            );
                                        })}
                                        <th rowSpan={2} className="py-2 px-1 border-b border-gray-200 bg-gray-50 text-center text-[9px] font-medium text-gray-400 uppercase align-middle">Travel</th>
                                        <th rowSpan={2} className="py-2 px-1 border-b border-gray-200 bg-gray-50 text-center text-[9px] font-medium text-gray-400 uppercase align-middle">Band</th>
                                        <th rowSpan={2} className="py-2 px-1 border-b border-gray-200 bg-gray-50 text-center text-[9px] font-medium text-gray-400 uppercase align-middle">Rec</th>
                                        <th rowSpan={2} className="py-2 px-1 border-b border-gray-200 bg-gray-50 text-center text-[9px] font-medium text-gray-400 uppercase align-middle">Ratio</th>
                                        <th rowSpan={2} className="py-2 px-1 border-b border-gray-200 bg-gray-50 text-center text-[9px] font-medium text-gray-400 uppercase align-middle">Hdwy</th>
                                        <th rowSpan={2} className="py-2 px-1 border-b border-gray-200 bg-gray-50 text-center text-[9px] font-medium text-gray-400 uppercase align-middle">Cycle</th>
                                        <th rowSpan={2} className="py-2 px-1 border-b border-gray-200 bg-gray-50 text-center text-[9px] font-medium text-blue-500 uppercase align-middle" title="Interline connections">Link</th>
                                    </tr>
                                    {/* Sub-headers Row */}
                                    <tr className="bg-gray-50 text-gray-500">
                                        {combined.northStops.map((stop, i) => (
                                            <React.Fragment key={`n-sub-${stop}`}>
                                                {i > 0 && northStopsWithRecovery.has(stop) && <th className="py-1 px-1 border-b border-gray-200 bg-blue-50/30 text-center text-[8px] font-medium text-gray-400 uppercase">Arr</th>}
                                                {i > 0 && northStopsWithRecovery.has(stop) && <th className="py-1 px-1 border-b border-gray-200 bg-blue-50/30 text-center text-[8px] font-medium text-gray-400">R</th>}
                                                <th className="py-1 px-1 border-b border-gray-200 bg-blue-50/30 text-center text-[8px] font-medium text-gray-400 uppercase">Dep</th>
                                            </React.Fragment>
                                        ))}
                                        {combined.southStops.map((stop, i) => (
                                            <React.Fragment key={`s-sub-${stop}`}>
                                                {i > 0 && southStopsWithRecovery.has(stop) && <th className="py-1 px-1 border-b border-gray-200 bg-orange-50/30 text-center text-[8px] font-medium text-gray-400 uppercase">Arr</th>}
                                                {i > 0 && southStopsWithRecovery.has(stop) && <th className="py-1 px-1 border-b border-gray-200 bg-orange-50/30 text-center text-[8px] font-medium text-gray-400">R</th>}
                                                <th className="py-1 px-1 border-b border-gray-200 bg-orange-50/30 text-center text-[8px] font-medium text-gray-400 uppercase">Dep</th>
                                            </React.Fragment>
                                        ))}
                                    </tr>
                                </thead>

                                <tbody className="divide-y divide-gray-100">
                                    {combined.rows.map((row, rowIdx) => {
                                        const northTrip = row.trips.find(t => t.direction === 'North');
                                        const southTrip = row.trips.find(t => t.direction === 'South');
                                        const lastTrip = [...row.trips].sort((a, b) => a.startTime - b.startTime).pop();

                                        const uniqueRowKey = `${row.blockId}-${northTrip?.id || 'n'}-${southTrip?.id || 's'}-${rowIdx}`;

                                        const totalTravel = (northTrip?.travelTime || 0) + (southTrip?.travelTime || 0);
                                        const totalRec = (northTrip?.recoveryTime || 0) + (southTrip?.recoveryTime || 0);
                                        const ratio = totalTravel > 0 ? (totalRec / totalTravel) * 100 : 0;

                                        const headway = northTrip ? headways[northTrip.id] : (southTrip ? headways[southTrip.id] : '-');

                                        const ratioColorClass = getRatioColor(ratio);

                                        const assignedBand = northTrip?.assignedBand || southTrip?.assignedBand;
                                        const bandColor = getBandRowColor(assignedBand);
                                        const rowBg = bandColor || (rowIdx % 2 === 0 ? 'bg-white' : 'bg-gray-50/50');

                                        const tripStartTime = northTrip?.startTime || southTrip?.startTime || 0;
                                        const tripEndTime = northTrip?.endTime || southTrip?.endTime || 0;
                                        const isGrayedOut = filter ? shouldGrayOutTrip(tripStartTime, tripEndTime, filter) : false;
                                        const isHighlighted = filter ? shouldHighlightTrip(totalTravel, totalRec, typeof headway === 'number' ? headway : null, filter) : false;
                                        const matchesSearchFilter = filter ? matchesSearch(row.blockId, [...combined.northStops, ...combined.southStops], filter.search) : true;

                                        const grayOutClass = isGrayedOut ? 'opacity-40' : '';
                                        const filterHighlightClass = isHighlighted ? 'bg-amber-50 ring-2 ring-inset ring-amber-200' : '';
                                        const searchHideClass = !matchesSearchFilter ? 'hidden' : '';

                                        return (
                                            <tr
                                                key={uniqueRowKey}
                                                className={`group hover:bg-blue-50/50 ${rowBg} ${grayOutClass} ${filterHighlightClass} ${searchHideClass}`}
                                                onContextMenu={(e) => {
                                                    if (onTripRightClick && northTrip) {
                                                        onTripRightClick(e, northTrip.id, 'North', row.blockId, combined.northStops);
                                                    }
                                                }}
                                            >
                                                {/* Actions Column */}
                                                {!readOnly && (
                                                    <td className={`p-1 border-r border-gray-100 sticky left-0 ${rowBg} group-hover:bg-gray-100 z-30`}>
                                                        <div className="flex items-center justify-center gap-0.5">
                                                            {onAddTrip && (
                                                                <button
                                                                    onClick={() => onAddTrip(row.blockId, lastTrip?.id || '')}
                                                                    className="p-1 rounded hover:bg-green-50 text-gray-400 hover:text-green-600 transition-colors"
                                                                    title="Add trip to block"
                                                                    aria-label="Add trip"
                                                                >
                                                                    <Plus size={12} />
                                                                </button>
                                                            )}
                                                            {northTrip && (
                                                                <button
                                                                    onClick={(e) => {
                                                                        if (onMenuOpen) {
                                                                            const rect = e.currentTarget.getBoundingClientRect();
                                                                            onMenuOpen(northTrip.id, rect.left, rect.bottom + 4, 'North', row.blockId, combined.northStops);
                                                                        }
                                                                    }}
                                                                    className="p-1 rounded hover:bg-blue-50 text-gray-400 hover:text-blue-600 transition-colors"
                                                                    title="Edit trip"
                                                                    aria-label="Edit trip"
                                                                >
                                                                    <Pencil size={12} />
                                                                </button>
                                                            )}
                                                            {onDeleteTrip && northTrip && (
                                                                <button
                                                                    onClick={() => onDeleteTrip(northTrip.id)}
                                                                    className="p-1 rounded hover:bg-red-50 text-gray-400 hover:text-red-500 transition-colors"
                                                                    title="Delete trip"
                                                                    aria-label="Delete trip"
                                                                >
                                                                    <Trash2 size={12} />
                                                                </button>
                                                            )}
                                                        </div>
                                                    </td>
                                                )}

                                                {/* Block ID */}
                                                <td className={`p-3 border-r border-gray-100 sticky ${readOnly ? 'left-0' : 'left-16'} ${rowBg} group-hover:bg-gray-100 z-30 font-medium text-xs text-gray-700 text-center`}>
                                                    <span>{row.blockId}</span>
                                                </td>

                                                {/* North Cells */}
                                                {combined.northStops.map((stop, i) => (
                                                    <React.Fragment key={`n-${stop}`}>
                                                        {i > 0 && northStopsWithRecovery.has(stop) && (
                                                            <td className="p-0 relative h-8 group/arr text-center font-mono text-[10px] text-gray-400">
                                                                <div className="flex items-center justify-center h-full">
                                                                    {onTimeAdjust && northTrip && (
                                                                        <button
                                                                            onClick={() => onTimeAdjust(northTrip.id, stop, -1)}
                                                                            className="absolute left-0 top-0 bottom-0 w-3 opacity-0 group-hover/arr:opacity-100 flex items-center justify-center text-gray-300 hover:text-blue-500 transition-all"
                                                                            title="-1 min"
                                                                        >
                                                                            <ChevronDown size={10} />
                                                                        </button>
                                                                    )}
                                                                    <StackedTimeCell timeStr={northTrip?.stops[stop]} />
                                                                    {onTimeAdjust && northTrip && (
                                                                        <button
                                                                            onClick={() => onTimeAdjust(northTrip.id, stop, 1)}
                                                                            className="absolute right-0 top-0 bottom-0 w-3 opacity-0 group-hover/arr:opacity-100 flex items-center justify-center text-gray-300 hover:text-blue-500 transition-all"
                                                                            title="+1 min"
                                                                        >
                                                                            <ChevronUp size={10} />
                                                                        </button>
                                                                    )}
                                                                </div>
                                                            </td>
                                                        )}
                                                        {i > 0 && northStopsWithRecovery.has(stop) && (
                                                            <td className="p-0 relative h-8 group/rec text-center font-mono text-[10px] text-gray-500 font-medium">
                                                                <div className="flex items-center justify-center h-full">
                                                                    {onRecoveryEdit && northTrip && (
                                                                        <button
                                                                            onClick={() => onRecoveryEdit(northTrip.id, stop, -1)}
                                                                            className="absolute left-0 top-0 bottom-0 w-3 opacity-0 group-hover/rec:opacity-100 flex items-center justify-center text-gray-300 hover:text-green-500 transition-all"
                                                                            title="-1 min recovery"
                                                                        >
                                                                            <ChevronDown size={10} />
                                                                        </button>
                                                                    )}
                                                                    <span className="px-2">{northTrip?.recoveryTimes?.[stop] ?? ''}</span>
                                                                    {onRecoveryEdit && northTrip && (
                                                                        <button
                                                                            onClick={() => onRecoveryEdit(northTrip.id, stop, 1)}
                                                                            className="absolute right-0 top-0 bottom-0 w-3 opacity-0 group-hover/rec:opacity-100 flex items-center justify-center text-gray-300 hover:text-green-500 transition-all"
                                                                            title="+1 min recovery"
                                                                        >
                                                                            <ChevronUp size={10} />
                                                                        </button>
                                                                    )}
                                                                </div>
                                                            </td>
                                                        )}
                                                        <td className={`p-0 relative h-10 group/cell ${i === 0 ? 'border-l border-dashed border-gray-100' : ''}`}>
                                                            <div className="flex items-center justify-center h-full">
                                                                {onTimeAdjust && northTrip && (
                                                                    <button
                                                                        onClick={() => onTimeAdjust(northTrip.id, stop, -1)}
                                                                        className="absolute left-0 top-0 bottom-0 w-4 opacity-0 group-hover/cell:opacity-100 flex items-center justify-center text-gray-300 hover:text-blue-500 hover:bg-blue-50 transition-all"
                                                                        title="-1 min"
                                                                    >
                                                                        <ChevronDown size={12} />
                                                                    </button>
                                                                )}
                                                                <StackedTimeInput
                                                                    value={(() => {
                                                                        const arrival = northTrip?.stops[stop];
                                                                        if (!arrival) return '';
                                                                        const recovery = northTrip?.recoveryTimes?.[stop] || 0;
                                                                        if (recovery === 0) return arrival;
                                                                        return TimeUtils.addMinutes(arrival, recovery);
                                                                    })()}
                                                                    onChange={(val) => northTrip && onCellEdit?.(northTrip.id, stop, val)}
                                                                    onBlur={(val) => {
                                                                        if (northTrip && val && onCellEdit) {
                                                                            const originalValue = northTrip.stops[stop];
                                                                            const formatted = parseTimeInput(val, originalValue);
                                                                            if (formatted) onCellEdit(northTrip.id, stop, formatted);
                                                                        }
                                                                    }}
                                                                    disabled={readOnly || !northTrip}
                                                                    focusClass="focus:ring-blue-100"
                                                                />
                                                                {onTimeAdjust && northTrip && (
                                                                    <button
                                                                        onClick={() => onTimeAdjust(northTrip.id, stop, 1)}
                                                                        className="absolute right-0 top-0 bottom-0 w-4 opacity-0 group-hover/cell:opacity-100 flex items-center justify-center text-gray-300 hover:text-blue-500 hover:bg-blue-50 transition-all"
                                                                        title="+1 min"
                                                                    >
                                                                        <ChevronUp size={12} />
                                                                    </button>
                                                                )}
                                                            </div>
                                                        </td>
                                                    </React.Fragment>
                                                ))}

                                                {/* South Cells */}
                                                {combined.southStops.map((stop, i) => (
                                                    <React.Fragment key={`s-${stop}`}>
                                                        {i > 0 && southStopsWithRecovery.has(stop) && (
                                                            <td className="p-0 relative h-8 group/arr text-center font-mono text-[10px] text-gray-400">
                                                                <div className="flex items-center justify-center h-full">
                                                                    {onTimeAdjust && southTrip && (
                                                                        <button
                                                                            onClick={() => onTimeAdjust(southTrip.id, stop, -1)}
                                                                            className="absolute left-0 top-0 bottom-0 w-3 opacity-0 group-hover/arr:opacity-100 flex items-center justify-center text-gray-300 hover:text-indigo-500 transition-all"
                                                                            title="-1 min"
                                                                        >
                                                                            <ChevronDown size={10} />
                                                                        </button>
                                                                    )}
                                                                    <StackedTimeCell timeStr={southTrip?.stops[stop]} />
                                                                    {onTimeAdjust && southTrip && (
                                                                        <button
                                                                            onClick={() => onTimeAdjust(southTrip.id, stop, 1)}
                                                                            className="absolute right-0 top-0 bottom-0 w-3 opacity-0 group-hover/arr:opacity-100 flex items-center justify-center text-gray-300 hover:text-indigo-500 transition-all"
                                                                            title="+1 min"
                                                                        >
                                                                            <ChevronUp size={10} />
                                                                        </button>
                                                                    )}
                                                                </div>
                                                            </td>
                                                        )}
                                                        {i > 0 && southStopsWithRecovery.has(stop) && (
                                                            <td className="p-0 relative h-8 group/rec text-center font-mono text-[10px] text-gray-500 font-medium">
                                                                <div className="flex items-center justify-center h-full">
                                                                    {onRecoveryEdit && southTrip && (
                                                                        <button
                                                                            onClick={() => onRecoveryEdit(southTrip.id, stop, -1)}
                                                                            className="absolute left-0 top-0 bottom-0 w-3 opacity-0 group-hover/rec:opacity-100 flex items-center justify-center text-gray-300 hover:text-green-500 transition-all"
                                                                            title="-1 min recovery"
                                                                        >
                                                                            <ChevronDown size={10} />
                                                                        </button>
                                                                    )}
                                                                    <span className="px-2">{southTrip?.recoveryTimes?.[stop] ?? ''}</span>
                                                                    {onRecoveryEdit && southTrip && (
                                                                        <button
                                                                            onClick={() => onRecoveryEdit(southTrip.id, stop, 1)}
                                                                            className="absolute right-0 top-0 bottom-0 w-3 opacity-0 group-hover/rec:opacity-100 flex items-center justify-center text-gray-300 hover:text-green-500 transition-all"
                                                                            title="+1 min recovery"
                                                                        >
                                                                            <ChevronUp size={10} />
                                                                        </button>
                                                                    )}
                                                                </div>
                                                            </td>
                                                        )}
                                                        <td className={`p-0 relative h-10 group/cell ${i === 0 ? 'border-l border-dashed border-gray-100' : ''}`}>
                                                            <div className="flex items-center justify-center h-full">
                                                                {onTimeAdjust && southTrip && (
                                                                    <button
                                                                        onClick={() => onTimeAdjust(southTrip.id, stop, -1)}
                                                                        className="absolute left-0 top-0 bottom-0 w-4 opacity-0 group-hover/cell:opacity-100 flex items-center justify-center text-gray-300 hover:text-indigo-500 hover:bg-indigo-50 transition-all"
                                                                        title="-1 min"
                                                                    >
                                                                        <ChevronDown size={12} />
                                                                    </button>
                                                                )}
                                                                <StackedTimeInput
                                                                    value={(() => {
                                                                        const arrival = southTrip?.stops[stop];
                                                                        if (!arrival) return '';
                                                                        const recovery = southTrip?.recoveryTimes?.[stop] || 0;
                                                                        if (recovery === 0) return arrival;
                                                                        return TimeUtils.addMinutes(arrival, recovery);
                                                                    })()}
                                                                    onChange={(val) => southTrip && onCellEdit?.(southTrip.id, stop, val)}
                                                                    onBlur={(val) => {
                                                                        if (southTrip && val && onCellEdit) {
                                                                            const originalValue = southTrip.stops[stop];
                                                                            const formatted = parseTimeInput(val, originalValue);
                                                                            if (formatted) onCellEdit(southTrip.id, stop, formatted);
                                                                        }
                                                                    }}
                                                                    disabled={readOnly || !southTrip}
                                                                    focusClass="focus:ring-indigo-100"
                                                                />
                                                                {onTimeAdjust && southTrip && (
                                                                    <button
                                                                        onClick={() => onTimeAdjust(southTrip.id, stop, 1)}
                                                                        className="absolute right-0 top-0 bottom-0 w-4 opacity-0 group-hover/cell:opacity-100 flex items-center justify-center text-gray-300 hover:text-indigo-500 hover:bg-indigo-50 transition-all"
                                                                        title="+1 min"
                                                                    >
                                                                        <ChevronUp size={12} />
                                                                    </button>
                                                                )}
                                                            </div>
                                                        </td>
                                                    </React.Fragment>
                                                ))}

                                                {/* Metrics Columns */}
                                                <td className="p-2 text-center text-xs font-medium text-gray-600 border-l border-gray-100">{totalTravel}</td>
                                                <td className="p-1 text-center">
                                                    {(() => {
                                                        const displayBand = northTrip?.assignedBand || southTrip?.assignedBand || '-';
                                                        return (
                                                            <span className="inline-block px-2 py-0.5 rounded-full text-[10px] font-medium bg-gray-100 text-gray-600">
                                                                {displayBand}
                                                            </span>
                                                        );
                                                    })()}
                                                </td>
                                                <td className="p-2 text-center text-xs text-gray-500">{totalRec}</td>

                                                <td className={`p-2 text-center text-xs font-medium ${ratio > 25 ? 'text-amber-600' : ratio < 10 ? 'text-red-500' : 'text-gray-600'}`}>
                                                    {ratio.toFixed(0)}%
                                                </td>

                                                <td className={`p-2 text-center text-xs ${targetHeadway && typeof headway === 'number' && headway !== targetHeadway
                                                    ? 'text-amber-700 bg-amber-100 font-bold ring-1 ring-amber-300'
                                                    : 'text-gray-400'
                                                    }`}>
                                                    {headway}
                                                    {targetHeadway && typeof headway === 'number' && headway !== targetHeadway && (
                                                        <span className="ml-1 text-[9px] font-semibold">({headway > targetHeadway ? '+' : ''}{headway - targetHeadway})</span>
                                                    )}
                                                </td>

                                                <td className={`p-2 text-center text-xs font-semibold ${targetCycleTime && Math.round(row.totalCycleTime) !== targetCycleTime
                                                    ? 'text-amber-700 bg-amber-100 font-bold ring-1 ring-amber-300'
                                                    : 'text-gray-700'
                                                    }`}>
                                                    {Math.round(row.totalCycleTime)}
                                                    {targetCycleTime && Math.round(row.totalCycleTime) !== targetCycleTime && (
                                                        <span className="ml-1 text-[9px] font-semibold">({Math.round(row.totalCycleTime) > targetCycleTime ? '+' : ''}{Math.round(row.totalCycleTime) - targetCycleTime})</span>
                                                    )}
                                                </td>

                                                {/* Interline Badge */}
                                                <td className="p-1 text-center">
                                                    {(() => {
                                                        const nNext = northTrip?.interlineNext;
                                                        const nPrev = northTrip?.interlinePrev;
                                                        const sNext = southTrip?.interlineNext;
                                                        const sPrev = southTrip?.interlinePrev;

                                                        const badges: React.ReactNode[] = [];

                                                        if (nNext) {
                                                            badges.push(
                                                                <span key="n-next" className="inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded text-[9px] font-medium" title={`North continues as ${nNext.route} at ${nNext.stopName}`}>
                                                                    <ArrowRight size={10} />{nNext.route}
                                                                </span>
                                                            );
                                                        }
                                                        if (nPrev) {
                                                            badges.push(
                                                                <span key="n-prev" className="inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-purple-100 text-purple-700 rounded text-[9px] font-medium" title={`North came from ${nPrev.route} at ${nPrev.stopName}`}>
                                                                    <ArrowLeft size={10} />{nPrev.route}
                                                                </span>
                                                            );
                                                        }
                                                        if (sNext) {
                                                            badges.push(
                                                                <span key="s-next" className="inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded text-[9px] font-medium" title={`South continues as ${sNext.route} at ${sNext.stopName}`}>
                                                                    <ArrowRight size={10} />{sNext.route}
                                                                </span>
                                                            );
                                                        }
                                                        if (sPrev) {
                                                            badges.push(
                                                                <span key="s-prev" className="inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-purple-100 text-purple-700 rounded text-[9px] font-medium" title={`South came from ${sPrev.route} at ${sPrev.stopName}`}>
                                                                    <ArrowLeft size={10} />{sPrev.route}
                                                                </span>
                                                            );
                                                        }

                                                        return badges.length > 0 ? (
                                                            <div className="flex flex-wrap gap-0.5 justify-center">
                                                                {badges}
                                                            </div>
                                                        ) : (
                                                            <span className="text-gray-300">-</span>
                                                        );
                                                    })()}
                                                </td>

                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </div>
                );
            })}
        </div>
    );
};
