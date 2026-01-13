/**
 * SingleRouteView Component
 *
 * Displays a single route schedule table with:
 * - Stop columns with time editing
 * - Recovery time columns
 * - Summary columns (Travel, Recovery, Ratio, Headway, Cycle)
 * - Trip actions (duplicate, delete)
 * - Interline badge display
 *
 * Extracted from ScheduleEditor.tsx for better maintainability.
 */

import React, { useMemo } from 'react';
import {
    Plus,
    ChevronUp,
    ChevronDown,
    ArrowRight,
    ArrowLeft,
    Copy,
    Trash2
} from 'lucide-react';
import { MasterRouteTable, MasterTrip } from '../../utils/masterScheduleParser';
import { TimeUtils } from '../../utils/timeUtils';
import { getRouteConfig, extractDirectionFromName } from '../../utils/routeDirectionConfig';
import {
    calculateHeadways,
    getRatioColor,
    parseTimeInput,
    sanitizeInput
} from '../../utils/scheduleEditorUtils';

export interface SingleRouteViewProps {
    table: MasterRouteTable;
    showSummary?: boolean;
    originalTable?: MasterRouteTable;
    onCellEdit?: (tripId: string, col: string, val: string) => void;
    onRecoveryEdit?: (tripId: string, stopName: string, delta: number) => void;
    onTimeAdjust?: (tripId: string, stopName: string, delta: number) => void;
    onDeleteTrip?: (tripId: string) => void;
    onDuplicateTrip?: (tripId: string) => void;
    onAddTrip?: (blockId: string, afterTripId: string) => void;
    onDirectionChange?: (tableRouteName: string, direction: 'North' | 'South') => void;
    readOnly?: boolean;
}

export const SingleRouteView: React.FC<SingleRouteViewProps> = ({ table, showSummary = true, originalTable, onCellEdit, onRecoveryEdit, onTimeAdjust, onDeleteTrip, onDuplicateTrip, onAddTrip, onDirectionChange, readOnly = false }) => {
    const stopsWithRecovery = useMemo(() => {
        const set = new Set<string>();
        table.trips.forEach(t => {
            if (t.recoveryTimes) Object.entries(t.recoveryTimes).forEach(([s, m]) => { if (m != null) set.add(s); });
        });
        return set;
    }, [table]);

    const headways = useMemo(() => calculateHeadways(table.trips), [table.trips]);

    // Build column map: column index (1-based) -> { type: 'block' | 'stop' | 'recovery', stopName?: string }
    const columnMap = useMemo(() => {
        const map: { [col: number]: { type: 'block' | 'stop' | 'recovery'; stopName?: string } } = {};
        let colNum = 1;
        map[colNum++] = { type: 'block' }; // Column 1 = Block
        table.stops.forEach(stop => {
            map[colNum++] = { type: 'stop', stopName: stop };
            if (stopsWithRecovery.has(stop)) {
                map[colNum++] = { type: 'recovery', stopName: stop };
            }
        });
        return map;
    }, [table.stops, stopsWithRecovery]);

    // Helper to get value at a specific column for a trip
    const getColumnValue = (trip: MasterTrip, col: number): number | null => {
        const colInfo = columnMap[col];
        if (!colInfo) return null;

        if (colInfo.type === 'block') {
            return null; // Block ID is not a numeric time value
        } else if (colInfo.type === 'stop' && colInfo.stopName) {
            const timeStr = trip.stops[colInfo.stopName];
            return timeStr ? TimeUtils.toMinutes(timeStr) : null;
        } else if (colInfo.type === 'recovery' && colInfo.stopName) {
            return trip.recoveryTimes?.[colInfo.stopName] ?? null;
        }
        return null;
    };

    // Dynamic interline configuration by route - uses stop name patterns instead of hardcoded column indices
    // This allows the calculation to work regardless of day type (Weekday/Saturday/Sunday may have different column layouts)
    const INTERLINE_STOP_PATTERNS: { [routePattern: string]: { interlineStopPattern: string } } = {
        '8A': { interlineStopPattern: 'allandale' },
        '8B': { interlineStopPattern: 'allandale' },
    };

    // Dynamically find interline columns based on stop name pattern
    const findInterlineColumns = (pattern: string): { interlineArr: number; recoveryCol: number | null; resumeCol: number | null } | null => {
        let interlineArr: number | null = null;
        let recoveryCol: number | null = null;
        let resumeCol: number | null = null;

        const sortedCols = Object.entries(columnMap)
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

    // Helper to find the last column with a time value for a trip
    const getLastTimepointValue = (trip: MasterTrip): number | null => {
        let lastCol = 0;
        let lastTime: number | null = null;

        // Iterate through all columns to find the last one with a time value
        for (const [colStr, colInfo] of Object.entries(columnMap)) {
            const col = parseInt(colStr);
            if (colInfo.type === 'stop' && colInfo.stopName) {
                const timeStr = trip.stops[colInfo.stopName];
                const time = timeStr ? TimeUtils.toMinutes(timeStr) : null;
                if (time !== null && col > lastCol) {
                    lastCol = col;
                    lastTime = time;
                }
            }
        }
        return lastTime;
    };

    // Helper to find the FIRST column with a time value for a trip (for partial trips)
    const getFirstTimepointValue = (trip: MasterTrip): number | null => {
        let firstCol = Infinity;
        let firstTime: number | null = null;

        for (const [colStr, colInfo] of Object.entries(columnMap)) {
            const col = parseInt(colStr);
            if (colInfo.type === 'stop' && colInfo.stopName) {
                const timeStr = trip.stops[colInfo.stopName];
                const time = timeStr ? TimeUtils.toMinutes(timeStr) : null;
                if (time !== null && col < firstCol) {
                    firstCol = col;
                    firstTime = time;
                }
            }
        }
        return firstTime;
    };

    // Calculate effective cycle time for interlined trips using dynamic stop-name-based column detection
    const getEffectiveCycleTime = (trip: MasterTrip): { value: number; hasGap: boolean; gap: number } => {
        // Check if this route has an interline stop pattern
        const routeName = table.routeName || '';
        let stopPattern: string | null = null;

        for (const [pattern, cfg] of Object.entries(INTERLINE_STOP_PATTERNS)) {
            if (routeName.includes(pattern)) {
                stopPattern = cfg.interlineStopPattern;
                break;
            }
        }

        // If no interline pattern for this route, check if trip has interline markers
        if (!stopPattern) {
            if (!trip.interlineNext?.stopName) {
                return { value: trip.cycleTime, hasGap: false, gap: 0 };
            }
            // Fall back to original dynamic logic for non-configured routes
            return { value: trip.cycleTime, hasGap: false, gap: 0 };
        }

        // Dynamically find interline columns based on stop name pattern
        const interlineCols = findInterlineColumns(stopPattern);
        if (!interlineCols) {
            return { value: trip.cycleTime, hasGap: false, gap: 0 };
        }

        // Get first departure - use actual first timepoint for partial trips
        const firstDep = getFirstTimepointValue(trip);

        const interlineArr = getColumnValue(trip, interlineCols.interlineArr);
        const recovery = interlineCols.recoveryCol ? getColumnValue(trip, interlineCols.recoveryCol) : null;
        const resume = interlineCols.resumeCol ? getColumnValue(trip, interlineCols.resumeCol) : null;
        const finalArr = getLastTimepointValue(trip); // Dynamic: last column with time

        // Helper to handle midnight crossing
        const timeDiff = (end: number, start: number): number => {
            const diff = end - start;
            return diff < 0 ? diff + 1440 : diff; // 1440 = 24 hours in minutes
        };

        // Core requirement: we need firstDep and interlineArr to calculate ANY interline cycle
        if (firstDep === null || interlineArr === null) {
            return { value: trip.cycleTime, hasGap: false, gap: 0 };
        }

        // Check if trip ENDS at interline point (no resume column data = one-way interline)
        // These trips hand off to the other route and don't continue
        const endsAtInterline = resume === null;

        if (endsAtInterline) {
            // Trip ends at interline: cycle = (interlineArr - firstDep) + recovery
            // No segment 2 because trip doesn't continue after interline
            const segment1 = timeDiff(interlineArr, firstDep);
            const recoveryVal = recovery ?? 0;
            const effectiveCycle = segment1 + recoveryVal;
            return { value: effectiveCycle, hasGap: true, gap: effectiveCycle - trip.cycleTime };
        }

        // Full interline trip - calculate with whatever values we have
        // Use recovery=0 if missing, use finalArr for segment2 if we have it
        const segment1 = timeDiff(interlineArr, firstDep);
        const recoveryVal = recovery ?? 0;

        // If we have resume and finalArr, calculate segment2; otherwise just use segment1 + recovery
        if (resume !== null && finalArr !== null) {
            const segment2 = timeDiff(finalArr, resume);
            const effectiveCycle = segment1 + recoveryVal + segment2;
            return { value: effectiveCycle, hasGap: true, gap: effectiveCycle - trip.cycleTime };
        }

        // Fallback: just segment1 + recovery (treat like ends-at-interline)
        const effectiveCycle = segment1 + recoveryVal;
        return { value: effectiveCycle, hasGap: true, gap: effectiveCycle - trip.cycleTime };
    };

    return (
        <div className="flex flex-col gap-6 h-full">
            <div className="bg-white border border-gray-200 rounded-lg shadow-sm overflow-hidden flex-grow flex flex-col">
                <div className="bg-gray-50 px-4 py-3 border-b border-gray-200">
                    <h3 className="font-bold text-gray-900">{table.routeName}</h3>
                </div>
                {/* Direction Info Row */}
                {(() => {
                    // Don't strip A/B suffix - let getRouteConfig handle it
                    // (8A/8B are distinct routes, not direction variants)
                    const baseRoute = table.routeName.split(' ')[0];
                    const config = getRouteConfig(baseRoute);
                    const tableDirection = extractDirectionFromName(table.routeName);
                    const isNorth = tableDirection === 'North';
                    const isSouth = tableDirection === 'South';
                    const isLoop = config?.type === 'loop';

                    if (!config) return null;

                    return (
                        <div className="px-4 py-1.5 bg-blue-50 border-b border-blue-100 flex items-center gap-4 text-xs">
                            <span className="font-semibold text-blue-700">Direction:</span>
                            {isLoop ? (
                                <span className="flex items-center gap-2">
                                    <span className="text-blue-600">🔄</span>
                                    <code className="bg-blue-100 px-2 py-0.5 rounded font-mono text-blue-800">
                                        {config.direction}
                                    </code>
                                </span>
                            ) : config.type === 'linear' && (
                                <span className="flex items-center gap-2">
                                    {isNorth && (
                                        <>
                                            <span className="text-blue-600">↑</span>
                                            <code className="bg-green-100 px-2 py-0.5 rounded font-mono text-green-800 font-bold">
                                                {config.northVariant}
                                            </code>
                                            <span className="text-gray-500">→ {config.northTerminus}</span>
                                        </>
                                    )}
                                    {isSouth && (
                                        <>
                                            <span className="text-blue-600">↓</span>
                                            <code className="bg-orange-100 px-2 py-0.5 rounded font-mono text-orange-800 font-bold">
                                                {config.southVariant}
                                            </code>
                                            <span className="text-gray-500">→ {config.southTerminus}</span>
                                        </>
                                    )}
                                    {!isNorth && !isSouth && (
                                        onDirectionChange ? (
                                            <select
                                                className="px-2 py-0.5 border border-amber-300 rounded bg-amber-50 text-amber-800 text-xs font-medium cursor-pointer focus:outline-none focus:ring-2 focus:ring-amber-400"
                                                defaultValue=""
                                                onChange={(e) => {
                                                    const dir = e.target.value as 'North' | 'South';
                                                    if (dir) onDirectionChange(table.routeName, dir);
                                                }}
                                            >
                                                <option value="" disabled>Select direction...</option>
                                                <option value="North">↑ North → {config.northTerminus}</option>
                                                <option value="South">↓ South → {config.southTerminus}</option>
                                            </select>
                                        ) : (
                                            <span className="text-gray-500 italic">Direction not detected</span>
                                        )
                                    )}
                                </span>
                            )}
                            <span className="text-gray-400">({table.trips.length} trips)</span>
                        </div>
                    );
                })()}
                <div className="overflow-auto custom-scrollbar flex-grow">
                    <table className="w-full text-left border-collapse text-[11px]">
                        <thead className="sticky top-0 z-40 bg-gray-50 shadow-sm">
                            {/* Column Numbers Row */}
                            <tr className="bg-gray-100">
                                {(() => {
                                    let colNum = 1;
                                    const cells: React.ReactNode[] = [];
                                    // Block column
                                    cells.push(<th key="col-block" className="py-0.5 px-1 border-b border-gray-300 bg-gray-100 sticky left-0 z-30 text-[9px] font-mono font-bold text-gray-500 text-center">{colNum++}</th>);
                                    // Stop columns: DEP only, or ARR + R + DEP if has recovery
                                    table.stops.forEach((stop, i) => {
                                        if (stopsWithRecovery.has(stop)) {
                                            cells.push(<th key={`col-arr-${i}`} className="py-0.5 px-1 border-b border-gray-300 bg-blue-100 text-[9px] font-mono font-bold text-blue-700 text-center">{colNum++}</th>);
                                            cells.push(<th key={`col-rec-${i}`} className="py-0.5 px-1 border-b border-gray-300 bg-gray-100 text-[9px] font-mono font-bold text-gray-500 text-center">{colNum++}</th>);
                                            cells.push(<th key={`col-dep-${i}`} className="py-0.5 px-1 border-b border-gray-300 bg-blue-100 text-[9px] font-mono font-bold text-blue-700 text-center">{colNum++}</th>);
                                        } else {
                                            cells.push(<th key={`col-dep-${i}`} className="py-0.5 px-1 border-b border-gray-300 bg-blue-100 text-[9px] font-mono font-bold text-blue-700 text-center">{colNum++}</th>);
                                        }
                                    });
                                    // Summary columns: Trav, Rec, Ratio, Hdwy, Cycle, Actions
                                    ['Tr', 'Rc', 'Rt', 'Hw', 'Cy', 'Ac'].forEach((_, i) => {
                                        cells.push(<th key={`col-sum-${i}`} className="py-0.5 px-1 border-b border-gray-300 bg-gray-100 text-[9px] font-mono font-bold text-gray-500 text-center">{colNum++}</th>);
                                    });
                                    return cells;
                                })()}
                            </tr>
                            {/* Stop Names Row - spans ARR+R+DEP for stops with recovery */}
                            <tr>
                                <th rowSpan={2} className="p-2 border-b bg-gray-50 sticky left-0 z-30 text-xs font-semibold text-gray-500 uppercase align-middle">Block</th>
                                {table.stops.map(stop => (
                                    <th
                                        key={stop}
                                        colSpan={stopsWithRecovery.has(stop) ? 3 : 1}
                                        className="p-2 border-b border-x border-gray-200 text-[10px] font-semibold text-gray-700 uppercase text-center align-bottom bg-gray-50"
                                        style={{ minWidth: stopsWithRecovery.has(stop) ? '140px' : '60px' }}
                                        title={stop}
                                    >
                                        <div className="break-words leading-tight">{stop}</div>
                                    </th>
                                ))}
                                <th rowSpan={2} className="p-2 border-b text-center text-xs font-semibold align-middle">Trav</th>
                                <th rowSpan={2} className="p-2 border-b text-center text-xs font-semibold align-middle">Rec</th>
                                <th rowSpan={2} className="p-2 border-b text-center text-xs font-semibold align-middle">Ratio</th>
                                <th rowSpan={2} className="p-2 border-b text-center text-xs font-semibold align-middle">Hdwy</th>
                                <th rowSpan={2} className="p-2 border-b text-center text-xs font-semibold align-middle">Cycle</th>
                                <th rowSpan={2} className="p-2 border-b text-center text-xs font-semibold align-middle">Actions</th>
                            </tr>
                            {/* ARR / R / DEP Subheaders Row */}
                            <tr className="bg-gray-50">
                                {table.stops.map(stop => (
                                    <React.Fragment key={`sub-${stop}`}>
                                        {stopsWithRecovery.has(stop) ? (
                                            <>
                                                <th className="py-1 px-1 border-b border-gray-200 text-[9px] font-medium text-gray-500 text-center" style={{ minWidth: '55px', width: '55px' }}>ARR</th>
                                                <th className="py-1 px-1 border-b border-gray-200 text-[9px] font-medium text-blue-600 text-center bg-blue-50" style={{ minWidth: '28px', width: '28px' }}>R</th>
                                                <th className="py-1 px-1 border-b border-gray-200 text-[9px] font-medium text-gray-500 text-center" style={{ minWidth: '55px', width: '55px' }}>DEP</th>
                                            </>
                                        ) : (
                                            <th className="py-1 px-1 border-b border-gray-200 text-[9px] font-medium text-gray-500 text-center" style={{ minWidth: '55px', width: '55px' }}>DEP</th>
                                        )}
                                    </React.Fragment>
                                ))}
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {table.trips.map((trip, idx) => (
                                <tr key={trip.id} className={`group hover:bg-gray-50 ${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50/30'}`}>
                                    <td className="p-3 border-r sticky left-0 bg-white group-hover:bg-gray-50 z-30 font-mono text-sm font-bold text-center">
                                        <div className="flex flex-col items-center">
                                            <span>{trip.blockId}</span>
                                            {onAddTrip && <button onClick={() => onAddTrip(trip.blockId, trip.id)} className="opacity-0 group-hover:opacity-100 absolute -right-2 top-1/2 -translate-y-1/2 bg-blue-600 text-white rounded-full p-0.5"><Plus size={10} /></button>}
                                        </div>
                                    </td>
                                    {table.stops.map(stop => {
                                        // Calculate diff from original
                                        const originalTrip = originalTable?.trips.find(t => t.id === trip.id);
                                        const depMin = TimeUtils.toMinutes(trip.stops[stop]);
                                        const originalDepMin = originalTrip ? TimeUtils.toMinutes(originalTrip.stops[stop]) : null;
                                        const depDiff = (depMin !== null && originalDepMin !== null) ? depMin - originalDepMin : 0;

                                        const originalRec = originalTrip?.recoveryTimes?.[stop] || 0;
                                        const currentRec = trip.recoveryTimes?.[stop] || 0;
                                        const recDiff = currentRec - originalRec;

                                        // Calculate arrival time = departure - recovery
                                        const hasRecovery = stopsWithRecovery.has(stop);
                                        const arrMin = hasRecovery && depMin !== null ? depMin - currentRec : null;
                                        const arrTime = arrMin !== null ? TimeUtils.fromMinutes(arrMin) : '';
                                        const originalArrMin = hasRecovery && originalDepMin !== null ? originalDepMin - originalRec : null;
                                        const arrDiff = (arrMin !== null && originalArrMin !== null) ? arrMin - originalArrMin : 0;

                                        // Check if this stop is an interline point
                                        const normalizeStop = (s: string) => s.toLowerCase().trim().replace(/\s+/g, ' ');
                                        const stripSuffix = (s: string) => s.replace(/\s*\(\d+\)$/, '');
                                        const getSuffix = (s: string) => {
                                            const match = s.match(/\((\d+)\)$/);
                                            return match ? parseInt(match[1]) : 0;
                                        };

                                        const cellTime = depMin;

                                        // Outgoing: match base name (no suffix) AND verify this cell's time matches the interline time
                                        const isInterlineOutgoing = trip.interlineNext?.stopName &&
                                            stripSuffix(normalizeStop(stop)) === stripSuffix(normalizeStop(trip.interlineNext.stopName)) &&
                                            getSuffix(stop) === 0 &&
                                            cellTime !== null &&
                                            Math.abs(cellTime - trip.interlineNext.time) <= 5;

                                        // Incoming: match the (2) variant
                                        const isInterlineIncoming = trip.interlinePrev?.stopName &&
                                            stripSuffix(normalizeStop(stop)) === stripSuffix(normalizeStop(trip.interlinePrev.stopName)) &&
                                            getSuffix(stop) === 2 &&
                                            cellTime !== null &&
                                            cellTime >= trip.interlinePrev.time &&
                                            cellTime <= trip.interlinePrev.time + 15;

                                        return (
                                            <React.Fragment key={stop}>
                                                {hasRecovery ? (
                                                    <>
                                                        {/* ARR Column - same width as DEP */}
                                                        <td className={`p-0 border-r relative ${isInterlineIncoming ? 'bg-purple-50' : ''}`} style={{ minWidth: '55px', width: '55px' }}>
                                                            <div className="flex items-center justify-center">
                                                                <span className={`w-full font-mono text-xs text-center p-1 text-gray-600 ${arrDiff !== 0 ? 'font-bold' : ''}`}>
                                                                    {arrTime}
                                                                </span>
                                                                {isInterlineIncoming && (
                                                                    <span className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 z-10 inline-flex items-center gap-0.5 px-1 py-0.5 bg-purple-500 text-white rounded text-[8px] font-bold shadow-sm whitespace-nowrap" title={`Came from ${trip.interlinePrev!.route}`}>
                                                                        <ArrowLeft size={8} />{trip.interlinePrev!.route}
                                                                    </span>
                                                                )}
                                                                {arrDiff !== 0 && (
                                                                    <span className={`absolute top-0 right-0 text-[9px] font-bold px-0.5 rounded-bl ${arrDiff > 0 ? 'text-green-600 bg-green-50' : 'text-red-600 bg-red-50'}`}>
                                                                        {arrDiff > 0 ? '+' : ''}{arrDiff}
                                                                    </span>
                                                                )}
                                                            </div>
                                                        </td>
                                                        {/* R Column */}
                                                        <td className="p-1 text-center border-r bg-blue-50/30 relative group/rec" style={{ minWidth: '28px', width: '28px' }}>
                                                            <span className={`text-xs font-bold text-blue-700 ${recDiff !== 0 ? 'underline' : ''}`}>{currentRec || ''}</span>
                                                            {recDiff !== 0 && (
                                                                <span className={`absolute top-0 right-0 text-[9px] font-bold px-0.5 rounded-bl ${recDiff > 0 ? 'text-green-600 bg-green-50' : 'text-red-600 bg-red-50'}`}>
                                                                    {recDiff > 0 ? '+' : ''}{recDiff}
                                                                </span>
                                                            )}
                                                            {onRecoveryEdit && (
                                                                <div className="absolute right-0 top-0 bottom-0 flex flex-col opacity-0 group-hover/rec:opacity-100 transition-opacity">
                                                                    <button onClick={() => onRecoveryEdit(trip.id, stop, 1)} className="flex-1 px-0.5 hover:bg-blue-100 text-gray-400 hover:text-blue-600" title="+1 min recovery"><ChevronUp size={10} /></button>
                                                                    <button onClick={() => onRecoveryEdit(trip.id, stop, -1)} className="flex-1 px-0.5 hover:bg-blue-100 text-gray-400 hover:text-blue-600" title="-1 min recovery"><ChevronDown size={10} /></button>
                                                                </div>
                                                            )}
                                                        </td>
                                                        {/* DEP Column - same width as ARR */}
                                                        <td className={`p-0 border-r relative group/time ${isInterlineOutgoing ? 'bg-blue-50' : ''}`} style={{ minWidth: '55px', width: '55px' }}>
                                                            <div className="flex items-center justify-center">
                                                                <input
                                                                    type="text"
                                                                    value={trip.stops[stop] || ''}
                                                                    onChange={(e) => onCellEdit?.(trip.id, stop, sanitizeInput(e.target.value))}
                                                                    onBlur={(e) => {
                                                                        if (e.target.value && onCellEdit) {
                                                                            const originalValue = trip.stops[stop];
                                                                            const formatted = parseTimeInput(e.target.value, originalValue);
                                                                            if (formatted) onCellEdit(trip.id, stop, formatted);
                                                                        }
                                                                    }}
                                                                    disabled={readOnly}
                                                                    className={`w-full h-full bg-transparent font-mono text-xs text-center p-1 focus:bg-white focus:outline-none ${depDiff !== 0 ? 'font-bold' : ''} ${readOnly ? 'cursor-default' : ''}`}
                                                                />
                                                                {isInterlineOutgoing && (
                                                                    <span className="absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2 z-10 inline-flex items-center gap-0.5 px-1 py-0.5 bg-blue-500 text-white rounded text-[8px] font-bold shadow-sm whitespace-nowrap" title={`Continues as ${trip.interlineNext!.route}`}>
                                                                        <ArrowRight size={8} />{trip.interlineNext!.route}
                                                                    </span>
                                                                )}
                                                                {depDiff !== 0 && (
                                                                    <span className={`absolute top-0 right-0 text-[9px] font-bold px-0.5 rounded-bl ${depDiff > 0 ? 'text-green-600 bg-green-50' : 'text-red-600 bg-red-50'}`}>
                                                                        {depDiff > 0 ? '+' : ''}{depDiff}
                                                                    </span>
                                                                )}
                                                                {onTimeAdjust && trip.stops[stop] && (
                                                                    <div className="absolute right-0 top-0 bottom-0 flex flex-col opacity-0 group-hover/time:opacity-100 transition-opacity">
                                                                        <button onClick={() => onTimeAdjust(trip.id, stop, 1)} className="flex-1 px-0.5 hover:bg-blue-100 text-gray-400 hover:text-blue-600" title="+1 min"><ChevronUp size={10} /></button>
                                                                        <button onClick={() => onTimeAdjust(trip.id, stop, -1)} className="flex-1 px-0.5 hover:bg-blue-100 text-gray-400 hover:text-blue-600" title="-1 min"><ChevronDown size={10} /></button>
                                                                    </div>
                                                                )}
                                                            </div>
                                                        </td>
                                                    </>
                                                ) : (
                                                    /* DEP only (no recovery at this stop) */
                                                    <td className={`p-0 border-r relative group/time ${isInterlineOutgoing ? 'bg-blue-50' : ''} ${isInterlineIncoming ? 'bg-purple-50' : ''}`} style={{ minWidth: '55px', width: '55px' }}>
                                                        <div className="flex items-center justify-center">
                                                            <input
                                                                type="text"
                                                                value={trip.stops[stop] || ''}
                                                                onChange={(e) => onCellEdit?.(trip.id, stop, sanitizeInput(e.target.value))}
                                                                onBlur={(e) => {
                                                                    if (e.target.value && onCellEdit) {
                                                                        const originalValue = trip.stops[stop];
                                                                        const formatted = parseTimeInput(e.target.value, originalValue);
                                                                        if (formatted) onCellEdit(trip.id, stop, formatted);
                                                                    }
                                                                }}
                                                                disabled={readOnly}
                                                                className={`w-full h-full bg-transparent font-mono text-xs text-center p-1 focus:bg-white focus:outline-none ${depDiff !== 0 ? 'font-bold' : ''} ${readOnly ? 'cursor-default' : ''}`}
                                                            />
                                                            {isInterlineOutgoing && (
                                                                <span className="absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2 z-10 inline-flex items-center gap-0.5 px-1 py-0.5 bg-blue-500 text-white rounded text-[8px] font-bold shadow-sm whitespace-nowrap" title={`Continues as ${trip.interlineNext!.route}`}>
                                                                    <ArrowRight size={8} />{trip.interlineNext!.route}
                                                                </span>
                                                            )}
                                                            {isInterlineIncoming && (
                                                                <span className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 z-10 inline-flex items-center gap-0.5 px-1 py-0.5 bg-purple-500 text-white rounded text-[8px] font-bold shadow-sm whitespace-nowrap" title={`Came from ${trip.interlinePrev!.route}`}>
                                                                    <ArrowLeft size={8} />{trip.interlinePrev!.route}
                                                                </span>
                                                            )}
                                                            {depDiff !== 0 && (
                                                                <span className={`absolute top-0 right-0 text-[9px] font-bold px-0.5 rounded-bl ${depDiff > 0 ? 'text-green-600 bg-green-50' : 'text-red-600 bg-red-50'}`}>
                                                                    {depDiff > 0 ? '+' : ''}{depDiff}
                                                                </span>
                                                            )}
                                                            {onTimeAdjust && trip.stops[stop] && (
                                                                <div className="absolute right-0 top-0 bottom-0 flex flex-col opacity-0 group-hover/time:opacity-100 transition-opacity">
                                                                    <button onClick={() => onTimeAdjust(trip.id, stop, 1)} className="flex-1 px-0.5 hover:bg-blue-100 text-gray-400 hover:text-blue-600" title="+1 min"><ChevronUp size={10} /></button>
                                                                    <button onClick={() => onTimeAdjust(trip.id, stop, -1)} className="flex-1 px-0.5 hover:bg-blue-100 text-gray-400 hover:text-blue-600" title="-1 min"><ChevronDown size={10} /></button>
                                                                </div>
                                                            )}
                                                        </div>
                                                    </td>
                                                )}
                                            </React.Fragment>
                                        );
                                    })}
                                    <td className="p-2 text-center text-xs font-mono">{trip.travelTime}</td>
                                    <td className="p-2 text-center text-xs font-mono">{trip.recoveryTime}</td>
                                    <td className={`p-2 text-center text-xs font-mono ${trip.travelTime > 0 ? getRatioColor(trip.recoveryTime / trip.travelTime * 100) : ''}`}>{trip.travelTime > 0 ? ((trip.recoveryTime / trip.travelTime) * 100).toFixed(0) + '%' : '-'}</td>
                                    <td className="p-2 text-center text-xs">{headways[trip.id] ?? '-'}</td>
                                    <td className="p-2 text-center text-xs font-bold">
                                        {(() => {
                                            const { value, hasGap, gap } = getEffectiveCycleTime(trip);
                                            if (hasGap) {
                                                return (
                                                    <span className="text-blue-600" title={`${trip.cycleTime} total - ${gap} interline gap = ${value} effective`}>
                                                        {value}
                                                        <span className="text-[9px] text-gray-400 ml-0.5">*</span>
                                                    </span>
                                                );
                                            }
                                            return trip.cycleTime;
                                        })()}
                                    </td>
                                    {/* Actions Column */}
                                    <td className="p-1 text-center border-l border-gray-100">
                                        <div className="flex items-center justify-center gap-1">
                                            {onDuplicateTrip && (
                                                <button
                                                    onClick={() => onDuplicateTrip(trip.id)}
                                                    className="p-1.5 rounded hover:bg-blue-50 text-gray-400 hover:text-blue-600 transition-colors"
                                                    title="Duplicate trip"
                                                    aria-label="Duplicate trip"
                                                >
                                                    <Copy size={12} />
                                                </button>
                                            )}
                                            {onDeleteTrip && (
                                                <button
                                                    onClick={() => onDeleteTrip(trip.id)}
                                                    className="p-1.5 rounded hover:bg-red-50 text-gray-400 hover:text-red-500 transition-colors"
                                                    title="Delete trip"
                                                    aria-label="Delete trip"
                                                >
                                                    <Trash2 size={12} />
                                                </button>
                                            )}
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}
