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
    Copy,
    Trash2
} from 'lucide-react';
import { MasterRouteTable, MasterTrip } from '../../utils/parsers/masterScheduleParser';
import { TimeUtils } from '../../utils/timeUtils';
import { getRouteConfig, extractDirectionFromName } from '../../utils/config/routeDirectionConfig';
import {
    calculateSequentialHeadways,
    getRatioColor,
    parseTimeInput,
    sanitizeInput,
    sortTripsByBlockFlow
} from '../../utils/schedule/scheduleEditorUtils';
import type { ConnectionLibrary } from '../../utils/connections/connectionTypes';
import type { DayType } from '../../utils/parsers/masterScheduleParser';
import { getConnectionsForStop } from '../../utils/connections/connectionUtils';
import { ConnectionIndicator } from './ConnectionIndicator';

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
    connectionLibrary?: ConnectionLibrary | null;
    dayType?: DayType;
}

export const SingleRouteView: React.FC<SingleRouteViewProps> = ({ table, showSummary = true, originalTable, onCellEdit, onRecoveryEdit, onTimeAdjust, onDeleteTrip, onDuplicateTrip, onAddTrip, onDirectionChange, readOnly = false, connectionLibrary, dayType = 'Weekday' }) => {
    const stopsWithRecovery = useMemo(() => {
        const set = new Set<string>();
        table.trips.forEach(t => {
            if (t.recoveryTimes) Object.entries(t.recoveryTimes).forEach(([s, m]) => { if (m != null) set.add(s); });
        });
        return set;
    }, [table]);

    const sortedTrips = useMemo(() => sortTripsByBlockFlow(table.trips), [table.trips]);
    const headways = useMemo(() => calculateSequentialHeadways(sortedTrips, trip => trip.startTime), [sortedTrips]);

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
                    const isLoop = config?.segments.length === 1;
                    const northSegment = config?.segments.find(s => s.name === 'North');
                    const southSegment = config?.segments.find(s => s.name === 'South');

                    if (!config) return null;

                    return (
                        <div className="px-4 py-1.5 bg-blue-50 border-b border-blue-100 flex items-center gap-4 text-xs">
                            <span className="font-semibold text-blue-700">Direction:</span>
                            {isLoop ? (
                                <span className="flex items-center gap-2">
                                    <span className="text-blue-600">🔄</span>
                                    <code className="bg-blue-100 px-2 py-0.5 rounded font-mono text-blue-800">
                                        {config.segments[0].name}
                                    </code>
                                </span>
                            ) : config.segments.length === 2 && (
                                <span className="flex items-center gap-2">
                                    {isNorth && northSegment && (
                                        <>
                                            <span className="text-blue-600">↑</span>
                                            <code className="bg-green-100 px-2 py-0.5 rounded font-mono text-green-800 font-bold">
                                                {northSegment.variant}
                                            </code>
                                            <span className="text-gray-500">→ {northSegment.terminus}</span>
                                        </>
                                    )}
                                    {isSouth && southSegment && (
                                        <>
                                            <span className="text-blue-600">↓</span>
                                            <code className="bg-orange-100 px-2 py-0.5 rounded font-mono text-orange-800 font-bold">
                                                {southSegment.variant}
                                            </code>
                                            <span className="text-gray-500">→ {southSegment.terminus}</span>
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
                                                <option value="North">↑ North → {northSegment?.terminus}</option>
                                                <option value="South">↓ South → {southSegment?.terminus}</option>
                                            </select>
                                        ) : (
                                            <span className="text-gray-500 italic">Direction not detected</span>
                                        )
                                    )}
                                </span>
                            )}
                            <span className="text-gray-600">({table.trips.length} trips)</span>
                        </div>
                    );
                })()}
                <div className="overflow-auto custom-scrollbar flex-grow">
                    <table className="w-full text-left border-collapse text-sm" style={{ tableLayout: 'fixed' }}>
                        <thead className="sticky top-0 z-40 bg-gray-50 shadow-sm">
                            {/* Stop Names Row - spans ARR+R+DEP for stops with recovery */}
                            <tr>
                                <th rowSpan={2} className="p-2 border-b bg-gray-50 text-sm font-semibold text-gray-700 align-middle text-left">Pattern</th>
                                <th rowSpan={2} className="p-2 border-b bg-gray-50 text-sm font-semibold text-gray-700 uppercase align-middle">Block</th>
                                {table.stops.map(stop => {
                                    const stopCode = table.stopIds?.[stop];
                                    return (
                                        <th
                                            key={stop}
                                            colSpan={stopsWithRecovery.has(stop) ? 3 : 1}
                                            className="p-2 border-b border-x border-gray-200 text-xs font-semibold text-gray-800 uppercase text-center align-bottom bg-gray-50"
                                            style={{ minWidth: stopsWithRecovery.has(stop) ? '168px' : '80px' }}
                                            title={stopCode ? `${stop} (Stop #${stopCode})` : stop}
                                        >
                                            <div className="break-words leading-tight">{stop}</div>
                                            {stopCode && (
                                                <div className="text-[10px] font-normal text-gray-600 mt-0.5">
                                                    #{stopCode}
                                                </div>
                                            )}
                                        </th>
                                    );
                                })}
                                <th rowSpan={2} className="p-2 border-b text-center text-sm font-semibold text-gray-700 align-middle">Travel</th>
                                <th rowSpan={2} className="p-2 border-b text-center text-sm font-semibold text-gray-700 align-middle">Recovery</th>
                                <th rowSpan={2} className="p-2 border-b text-center text-sm font-semibold text-gray-700 align-middle">Ratio</th>
                                <th rowSpan={2} className="p-2 border-b text-center text-sm font-semibold text-gray-700 align-middle">Headway</th>
                                <th rowSpan={2} className="p-2 border-b text-center text-sm font-semibold text-gray-700 align-middle">Cycle</th>
                                <th rowSpan={2} className="p-2 border-b text-center text-sm font-semibold text-gray-700 align-middle">Actions</th>
                                <th rowSpan={2} className="p-2 border-b text-center text-sm font-semibold text-gray-700 align-middle">Trip #</th>
                            </tr>
                            {/* ARR / R / DEP Subheaders Row */}
                            <tr className="bg-gray-50">
                                {table.stops.map(stop => (
                                    <React.Fragment key={`sub-${stop}`}>
                                        {stopsWithRecovery.has(stop) ? (
                                            <>
                                                <th className="py-1 px-1 border-b border-gray-200 text-xs font-medium text-gray-700 text-center" style={{ minWidth: '56px', width: '56px' }}>ARR</th>
                                                <th className="py-1 px-1 border-b border-gray-200 text-xs font-semibold text-blue-700 text-center bg-blue-50" style={{ minWidth: '32px', width: '32px' }}>R</th>
                                                <th className="py-1 px-1 border-b border-gray-200 text-xs font-medium text-gray-700 text-center" style={{ minWidth: '80px', width: '80px' }}>DEP</th>
                                            </>
                                        ) : (
                                            <th className="py-1 px-1 border-b border-gray-200 text-xs font-medium text-gray-700 text-center" style={{ minWidth: '80px', width: '80px' }}>DEP</th>
                                        )}
                                    </React.Fragment>
                                ))}
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {sortedTrips.map((trip, idx) => (
                                <tr key={trip.id} className={`group hover:bg-gray-50 ${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50/30'}`}>
                                    <td className="p-2 text-left text-xs text-gray-500 truncate max-w-[200px]" title={trip.patternLabel || '-'}>{trip.patternLabel || '-'}</td>
                                    <td className="p-3 border-r bg-white group-hover:bg-gray-50 font-mono text-sm font-bold text-center">
                                        <div className="flex flex-col items-center">
                                            <span>{trip.blockId}</span>
                                            {onAddTrip && <button onClick={() => onAddTrip(trip.blockId, trip.id)} className="opacity-70 group-hover:opacity-100 absolute -right-2 top-1/2 -translate-y-1/2 bg-blue-600 text-white rounded-full p-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300"><Plus size={10} /></button>}
                                        </div>
                                    </td>
                                    {table.stops.map(stop => {
                                        // Calculate diff from original
                                        const originalTrip = originalTable?.trips.find(t => t.id === trip.id);

                                        // NOTE: trip.stops[stop] contains ARRIVAL time (consistent with RoundTripTableView)
                                        // We ADD recovery to get departure time
                                        const arrMin = TimeUtils.toMinutes(trip.stops[stop]);
                                        const originalArrMin = originalTrip ? TimeUtils.toMinutes(originalTrip.stops[stop]) : null;
                                        const arrDiff = (arrMin !== null && originalArrMin !== null) ? arrMin - originalArrMin : 0;

                                        const originalRec = originalTrip?.recoveryTimes?.[stop] || 0;
                                        const currentRec = trip.recoveryTimes?.[stop] || 0;
                                        const recDiff = currentRec - originalRec;

                                        // Calculate departure time = arrival + recovery
                                        const hasRecovery = stopsWithRecovery.has(stop);
                                        const depMin = hasRecovery && arrMin !== null ? arrMin + currentRec : arrMin;
                                        const depDiff = (depMin !== null && originalArrMin !== null)
                                            ? depMin - (originalArrMin + originalRec)
                                            : 0;
                                        const arrTime = arrMin !== null ? TimeUtils.fromMinutes(arrMin) : '';
                                        const depTime = depMin !== null ? TimeUtils.fromMinutes(depMin) : '';

                                        // Check if this stop is an interline point
                                        const normalizeStop = (s: string) => s.toLowerCase().trim().replace(/\s+/g, ' ');
                                        const stripSuffix = (s: string) => s.replace(/\s*\(\d+\)$/, '');
                                        const getSuffix = (s: string) => {
                                            const match = s.match(/\((\d+)\)$/);
                                            return match ? parseInt(match[1]) : 0;
                                        };

                                        // Get connection info for this stop
                                        const stopCode = table.stopIds?.[stop] || '';
                                        const connections = connectionLibrary && stopCode && (arrMin !== null || depMin !== null)
                                            ? getConnectionsForStop(
                                                stopCode,
                                                {
                                                    arrival: arrMin,
                                                    departure: depMin
                                                },
                                                connectionLibrary,
                                                dayType
                                            )
                                            : [];
                                        const arrivalConnections = hasRecovery
                                            ? connections.filter(connection => connection.eventType === 'departure')
                                            : [];
                                        const departureConnections = hasRecovery
                                            ? connections.filter(connection => connection.eventType === 'arrival')
                                            : connections;

                                        return (
                                            <React.Fragment key={stop}>
                                                {hasRecovery ? (
                                                    <>
                                                        {/* ARR Column */}
                                                        <td className="p-0 border-r relative" style={{ minWidth: '56px', width: '56px' }}>
                                                            <div className={`flex ${arrivalConnections.length > 0 ? 'flex-col' : 'items-center'} justify-center`}>
                                                                <span className={`w-full font-mono text-sm text-center p-1 text-gray-700 ${arrDiff !== 0 ? 'font-bold' : ''}`}>
                                                                    {arrTime}
                                                                </span>
                                                                {arrivalConnections.length > 0 && (
                                                                    <ConnectionIndicator connections={arrivalConnections} />
                                                                )}
                                                                {arrDiff !== 0 && (
                                                                    <span className={`absolute top-0 right-0 text-[9px] font-bold px-0.5 rounded-bl ${arrDiff > 0 ? 'text-green-600 bg-green-50' : 'text-red-600 bg-red-50'}`}>
                                                                        {arrDiff > 0 ? '+' : ''}{arrDiff}
                                                                    </span>
                                                                )}
                                                            </div>
                                                        </td>
                                                        {/* R Column */}
                                                        <td className="p-1 text-center border-r bg-blue-50/30 relative group/rec" style={{ minWidth: '32px', width: '32px' }}>
                                                            <span className={`text-sm font-bold text-blue-800 ${recDiff !== 0 ? 'underline' : ''}`}>{currentRec || ''}</span>
                                                            {recDiff !== 0 && (
                                                                <span className={`absolute top-0 right-0 text-[9px] font-bold px-0.5 rounded-bl ${recDiff > 0 ? 'text-green-600 bg-green-50' : 'text-red-600 bg-red-50'}`}>
                                                                    {recDiff > 0 ? '+' : ''}{recDiff}
                                                                </span>
                                                            )}
                                                            {onRecoveryEdit && (
                                                                <div className="absolute right-0 top-0 bottom-0 flex flex-col opacity-40 group-hover/rec:opacity-100 transition-opacity">
                                                                    <button onClick={() => onRecoveryEdit(trip.id, stop, 1)} className="flex-1 px-0.5 hover:bg-blue-100 text-gray-400 hover:text-blue-600" title="+1 min recovery"><ChevronUp size={10} /></button>
                                                                    <button onClick={() => onRecoveryEdit(trip.id, stop, -1)} className="flex-1 px-0.5 hover:bg-blue-100 text-gray-400 hover:text-blue-600" title="-1 min recovery"><ChevronDown size={10} /></button>
                                                                </div>
                                                            )}
                                                        </td>
                                                        {/* DEP Column */}
                                                        <td className="p-0 border-r relative group/time" style={{ minWidth: '80px', width: '80px' }}>
                                                            <div className={`flex ${departureConnections.length > 0 ? 'flex-col' : 'items-center'} justify-center`}>
                                                                <input
                                                                    type="text"
                                                                    key={`${trip.id}-${stop}-${depTime}`}
                                                                    defaultValue={depTime}
                                                                    onBlur={(e) => {
                                                                        const val = e.target.value.trim();
                                                                        if (!val) {
                                                                            // Restore original value if empty
                                                                            e.target.value = depTime || '';
                                                                            return;
                                                                        }
                                                                        if (onCellEdit) {
                                                                            const formatted = parseTimeInput(val, depTime);
                                                                            if (formatted && formatted !== depTime) {
                                                                                onCellEdit(trip.id, stop, formatted);
                                                                            }
                                                                        }
                                                                    }}
                                                                    disabled={readOnly}
                                                                    className={`w-full bg-transparent font-mono text-sm text-center p-1 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-200 ${depDiff !== 0 ? 'font-bold' : ''} ${readOnly ? 'cursor-default' : ''}`}
                                                                />
                                                                {departureConnections.length > 0 && (
                                                                    <ConnectionIndicator connections={departureConnections} />
                                                                )}
                                                                {depDiff !== 0 && (
                                                                    <span className={`absolute top-0 right-0 text-[9px] font-bold px-0.5 rounded-bl ${depDiff > 0 ? 'text-green-600 bg-green-50' : 'text-red-600 bg-red-50'}`}>
                                                                        {depDiff > 0 ? '+' : ''}{depDiff}
                                                                    </span>
                                                                )}
                                                                {onTimeAdjust && trip.stops[stop] && (
                                                                    <div className="absolute right-0 top-0 bottom-0 flex flex-col opacity-40 group-hover/time:opacity-100 transition-opacity">
                                                                        <button onClick={() => onTimeAdjust(trip.id, stop, 1)} className="flex-1 px-0.5 hover:bg-blue-100 text-gray-400 hover:text-blue-600" title="+1 min"><ChevronUp size={10} /></button>
                                                                        <button onClick={() => onTimeAdjust(trip.id, stop, -1)} className="flex-1 px-0.5 hover:bg-blue-100 text-gray-400 hover:text-blue-600" title="-1 min"><ChevronDown size={10} /></button>
                                                                    </div>
                                                                )}
                                                            </div>
                                                        </td>
                                                    </>
                                                ) : (
                                                    /* DEP only (no recovery at this stop) */
                                                    <td className="p-0 border-r relative group/time" style={{ minWidth: '80px', width: '80px' }}>
                                                        <div className={`flex ${connections.length > 0 ? 'flex-col' : 'items-center'} justify-center`}>
                                                            <input
                                                                type="text"
                                                                key={`${trip.id}-${stop}-${depTime}`}
                                                                defaultValue={depTime}
                                                                onBlur={(e) => {
                                                                    const val = e.target.value.trim();
                                                                    if (!val) {
                                                                        // Restore original value if empty
                                                                        e.target.value = depTime || '';
                                                                        return;
                                                                    }
                                                                    if (onCellEdit) {
                                                                        const formatted = parseTimeInput(val, depTime);
                                                                        if (formatted && formatted !== depTime) {
                                                                            onCellEdit(trip.id, stop, formatted);
                                                                        }
                                                                    }
                                                                }}
                                                                disabled={readOnly}
                                                                className={`w-full bg-transparent font-mono text-sm text-center p-1 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-200 ${depDiff !== 0 ? 'font-bold' : ''} ${readOnly ? 'cursor-default' : ''}`}
                                                            />
                                                            {connections.length > 0 && (
                                                                <ConnectionIndicator connections={connections} />
                                                            )}
                                                            {depDiff !== 0 && (
                                                                <span className={`absolute top-0 right-0 text-[9px] font-bold px-0.5 rounded-bl ${depDiff > 0 ? 'text-green-600 bg-green-50' : 'text-red-600 bg-red-50'}`}>
                                                                    {depDiff > 0 ? '+' : ''}{depDiff}
                                                                </span>
                                                            )}
                                                            {onTimeAdjust && trip.stops[stop] && (
                                                                <div className="absolute right-0 top-0 bottom-0 flex flex-col opacity-40 group-hover/time:opacity-100 transition-opacity">
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
                                    <td className="p-2 text-center text-sm font-mono text-gray-700">{trip.travelTime}</td>
                                    <td className="p-2 text-center text-sm font-mono text-gray-700">{trip.recoveryTime}</td>
                                    <td className={`p-2 text-center text-sm font-mono ${trip.travelTime > 0 ? getRatioColor(trip.recoveryTime / trip.travelTime * 100) : ''}`}>{trip.travelTime > 0 ? ((trip.recoveryTime / trip.travelTime) * 100).toFixed(0) + '%' : '-'}</td>
                                    <td className="p-2 text-center text-sm text-gray-700">{headways[trip.id] ?? '-'}</td>
                                    <td className="p-2 text-center text-sm font-bold text-gray-800">
                                        {trip.cycleTime}
                                    </td>
                                    {/* Actions Column */}
                                    <td className="p-1 text-center border-l border-gray-100">
                                        <div className="flex items-center justify-center gap-1">
                                            {onDuplicateTrip && (
                                                <button
                                                    onClick={() => onDuplicateTrip(trip.id)}
                                                    className="p-1.5 rounded hover:bg-blue-50 text-gray-600 hover:text-blue-700 transition-colors"
                                                    title="Duplicate trip"
                                                    aria-label="Duplicate trip"
                                                >
                                                    <Copy size={12} />
                                                </button>
                                            )}
                                            {onDeleteTrip && (
                                                <button
                                                    onClick={() => onDeleteTrip(trip.id)}
                                                    className="p-1.5 rounded hover:bg-red-50 text-gray-600 hover:text-red-600 transition-colors"
                                                    title="Delete trip"
                                                    aria-label="Delete trip"
                                                >
                                                    <Trash2 size={12} />
                                                </button>
                                            )}
                                        </div>
                                    </td>
                                    <td className="p-2 text-center text-sm font-mono text-gray-700">{idx + 1}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}
