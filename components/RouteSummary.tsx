
import React, { useMemo } from 'react';
import { MasterRouteTable, MasterTrip } from '../utils/masterScheduleParser';
import { TimeUtils } from '../utils/timeUtils';

interface RouteSummaryProps {
    table: MasterRouteTable;
    orientation?: 'horizontal' | 'vertical' | 'header';
}

// Interline config for 8A/8B routes - uses stop name patterns for dynamic column detection
const INTERLINE_STOP_CONFIG: Record<string, { interlineStopPattern: string }> = {
    '8A': { interlineStopPattern: 'allandale' },
    '8B': { interlineStopPattern: 'allandale' },
};

export const RouteSummary: React.FC<RouteSummaryProps> = ({ table, orientation = 'horizontal' }) => {
    const stats = useMemo(() => {
        let totalCycle = 0;
        let totalRec = 0;
        let totalTravel = 0;
        let activeTrips = 0;

        // Check if this is an interlined route
        const routeName = table.routeName || '';
        let interlineStopPattern: string | null = null;
        for (const [key, cfg] of Object.entries(INTERLINE_STOP_CONFIG)) {
            if (routeName.includes(key)) {
                interlineStopPattern = cfg.interlineStopPattern;
                break;
            }
        }

        // Build column map for interline calculation
        const buildColMap = (): Record<number, { type: string; stopName?: string }> => {
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

        const colMap = interlineStopPattern ? buildColMap() : {};

        // Dynamically find interline columns based on stop name pattern
        const findInterlineColumns = (pattern: string): { interlineArr: number; recoveryCol: number | null; resumeCol: number | null } | null => {
            let interlineArr: number | null = null;
            let recoveryCol: number | null = null;
            let resumeCol: number | null = null;

            const sortedCols = Object.entries(colMap)
                .map(([col, info]) => ({ col: parseInt(col), info }))
                .sort((a, b) => a.col - b.col);

            for (let i = 0; i < sortedCols.length; i++) {
                const { col, info } = sortedCols[i];
                if (info.type === 'stop' && info.stopName?.toLowerCase().includes(pattern.toLowerCase())) {
                    interlineArr = col;
                    // Check if next column is a recovery column for this stop
                    if (i + 1 < sortedCols.length) {
                        const next = sortedCols[i + 1];
                        if (next.info.type === 'recovery' && next.info.stopName?.toLowerCase().includes(pattern.toLowerCase())) {
                            recoveryCol = next.col;
                            // Resume is the next stop column after recovery
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

        const interlineCols = interlineStopPattern ? findInterlineColumns(interlineStopPattern) : null;

        // Helpers for interline calculation
        const getColVal = (trip: MasterTrip, col: number): number | null => {
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

        const getFirstTime = (trip: MasterTrip): number | null => {
            for (const [, info] of Object.entries(colMap).sort((a, b) => parseInt(a[0]) - parseInt(b[0]))) {
                if (info.type === 'stop' && info.stopName) {
                    const timeStr = trip.stops[info.stopName];
                    const time = timeStr ? TimeUtils.toMinutes(timeStr) : null;
                    if (time !== null) return time;
                }
            }
            return null;
        };

        const getLastTime = (trip: MasterTrip): number | null => {
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

        const timeDiff = (end: number, start: number): number => {
            const diff = end - start;
            return diff < 0 ? diff + 1440 : diff;
        };

        table.trips.forEach(trip => {
            totalRec += trip.recoveryTime || 0;
            totalTravel += trip.travelTime || 0;
            activeTrips++;

            // Calculate effective cycle time for interlined routes
            if (interlineCols) {
                const firstDep = getFirstTime(trip);
                const interlineArr = getColVal(trip, interlineCols.interlineArr);
                const recovery = interlineCols.recoveryCol ? getColVal(trip, interlineCols.recoveryCol) : null;
                const resume = interlineCols.resumeCol ? getColVal(trip, interlineCols.resumeCol) : null;
                const finalArr = getLastTime(trip);

                // Core requirement: need firstDep and interlineArr
                if (firstDep === null || interlineArr === null) {
                    totalCycle += trip.cycleTime || 0;
                } else {
                    // Check if trip ENDS at interline point (no resume data = one-way interline)
                    const endsAtInterline = resume === null;

                    if (endsAtInterline) {
                        const segment1 = timeDiff(interlineArr, firstDep);
                        totalCycle += segment1 + (recovery ?? 0);
                    } else if (resume !== null && finalArr !== null) {
                        // Full interline trip
                        const segment1 = timeDiff(interlineArr, firstDep);
                        const segment2 = timeDiff(finalArr, resume);
                        totalCycle += segment1 + (recovery ?? 0) + segment2;
                    } else {
                        // Fallback: just segment1 + recovery
                        const segment1 = timeDiff(interlineArr, firstDep);
                        totalCycle += segment1 + (recovery ?? 0);
                    }
                }
            } else {
                totalCycle += trip.cycleTime || 0;
            }
        });

        // Safe division - Recovery Ratio = Recovery / Travel Time (not Cycle)
        const avgRatio = totalTravel > 0 ? (totalRec / totalTravel) * 100 : 0;
        return { totalCycle, totalRec, totalTravel, activeTrips, avgRatio };
    }, [table]);

    if (orientation === 'vertical') {
        return (
            <div className="flex flex-col gap-3 w-full">
                <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
                    <div className="text-gray-500 text-[10px] font-bold uppercase tracking-widest mb-1">Total Trips</div>
                    <div className="text-2xl font-bold text-gray-900">{stats.activeTrips}</div>
                </div>
                <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
                    <div className="text-gray-500 text-[10px] font-bold uppercase tracking-widest mb-1">Total Travel Time</div>
                    <div className="text-2xl font-bold text-gray-900">{(stats.totalTravel / 60).toFixed(1)}<span className="text-sm font-medium text-gray-400 ml-1">hrs</span></div>
                </div>
                <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
                    <div className="text-gray-500 text-[10px] font-bold uppercase tracking-widest mb-1">Total Recovery</div>
                    <div className="text-2xl font-bold text-gray-900">{(stats.totalRec / 60).toFixed(1)}<span className="text-sm font-medium text-gray-400 ml-1">hrs</span></div>
                </div>
                <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
                    <div className="text-gray-500 text-[10px] font-bold uppercase tracking-widest mb-1">Total Cycle Time</div>
                    <div className="text-2xl font-bold text-gray-900">{(stats.totalCycle / 60).toFixed(1)}<span className="text-sm font-medium text-gray-400 ml-1">hrs</span></div>
                </div>
                <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
                    <div className="text-gray-500 text-[10px] font-bold uppercase tracking-widest mb-1">Recovery Ratio</div>
                    <div className={`text-2xl font-bold ${stats.avgRatio < 10 ? 'text-red-600' : 'text-emerald-600'}`}>
                        {stats.avgRatio.toFixed(1)}%
                    </div>
                </div>
            </div>
        );
    }

    if (orientation === 'header') {
        return (
            <div className="flex items-center gap-4 ml-2">
                <div className="flex items-center gap-1.5">
                    <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Trips</span>
                    <span className="text-sm font-bold text-gray-900">{stats.activeTrips}</span>
                </div>
                <div className="flex items-center gap-1.5">
                    <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider hidden xl:inline">Travel</span>
                    <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider xl:hidden">Trav</span>
                    <span className="text-sm font-bold text-gray-900">{(stats.totalTravel / 60).toFixed(1)}<span className="text-[10px] text-gray-400 font-normal ml-0.5">h</span></span>
                </div>
                <div className="flex items-center gap-1.5">
                    <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider hidden xl:inline">Recovery</span>
                    <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider xl:hidden">Rec</span>
                    <span className="text-sm font-bold text-gray-900">{(stats.totalRec / 60).toFixed(1)}<span className="text-[10px] text-gray-400 font-normal ml-0.5">h</span></span>
                </div>
                <div className="flex items-center gap-1.5">
                    <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider hidden xl:inline">Cycle</span>
                    <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider xl:hidden">Cyc</span>
                    <span className="text-sm font-bold text-gray-900">{(stats.totalCycle / 60).toFixed(1)}<span className="text-[10px] text-gray-400 font-normal ml-0.5">h</span></span>
                </div>
                <div className="flex items-center gap-1.5">
                    <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Ratio</span>
                    <span className={`text-sm font-bold ${stats.avgRatio < 10 ? 'text-red-600' : 'text-emerald-600'}`}>
                        {stats.avgRatio.toFixed(1)}%
                    </span>
                </div>
            </div>
        );
    }

    return (
        <div className="bg-white rounded-lg border border-gray-200 shadow-sm mb-6 flex divide-x divide-gray-100">
            <div className="px-6 py-4 flex-1">
                <div className="text-gray-500 text-[10px] font-bold uppercase tracking-widest mb-1">Total Trips</div>
                <div className="text-2xl font-bold text-gray-900">{stats.activeTrips}</div>
            </div>
            <div className="px-6 py-4 flex-1">
                <div className="text-gray-500 text-[10px] font-bold uppercase tracking-widest mb-1">Total Travel Time</div>
                <div className="text-2xl font-bold text-gray-900">{(stats.totalTravel / 60).toFixed(1)}<span className="text-sm font-medium text-gray-400 ml-1">hrs</span></div>
            </div>
            <div className="px-6 py-4 flex-1">
                <div className="text-gray-500 text-[10px] font-bold uppercase tracking-widest mb-1">Total Recovery</div>
                <div className="text-2xl font-bold text-gray-900">{(stats.totalRec / 60).toFixed(1)}<span className="text-sm font-medium text-gray-400 ml-1">hrs</span></div>
            </div>
            <div className="px-6 py-4 flex-1">
                <div className="text-gray-500 text-[10px] font-bold uppercase tracking-widest mb-1">Total Cycle Time</div>
                <div className="text-2xl font-bold text-gray-900">{(stats.totalCycle / 60).toFixed(1)}<span className="text-sm font-medium text-gray-400 ml-1">hrs</span></div>
            </div>
            <div className="px-6 py-4 flex-1">
                <div className="text-gray-500 text-[10px] font-bold uppercase tracking-widest mb-1">Recovery Ratio</div>
                <div className="flex items-center gap-2">
                    <div className={`text-2xl font-bold ${stats.avgRatio < 10 ? 'text-red-600' : 'text-emerald-600'}`}>
                        {stats.avgRatio.toFixed(1)}%
                    </div>
                </div>
            </div>
        </div>
    );
};
