import React, { useState, useMemo, useEffect } from 'react';
import {
    Bus,
    TrendingUp,
    Plus,
    FileSpreadsheet,
    Download,
    Trash2,
    Copy,
    Zap,
    CheckCircle2,
    Check,
    ChevronDown,
    ChevronRight,
    ChevronUp,
    ArrowRight,
    ArrowLeft,
    Loader2,
    AlertCircle,
    Sparkles,
    XCircle,
    BarChart2,
    Settings2,
    CalendarPlus,
    Timer,
    MousePointerClick,
    FileText,
    Save,
    Cloud,
    CloudOff,
    History,
    Maximize2,
    Minimize2,
    Undo2,
    Redo2,
    Minus
} from 'lucide-react';
import * as XLSX from 'xlsx';
import ExcelJS from 'exceljs';
import {
    MasterRouteTable,
    MasterTrip,
    validateRouteTable,
    RoundTripTable,
    buildRoundTripView
} from '../utils/masterScheduleParser';
import { RouteSummary } from './RouteSummary';
import { WorkspaceHeader } from './WorkspaceHeader';
import { AutoSaveStatus } from '../hooks/useAutoSave';
import { TimeUtils } from '../utils/timeUtils';
import { getRouteColor, getRouteTextColor } from '../utils/routeColors';
import { AddTripModal, AddTripModalContext } from './AddTripModal';
import { useAddTrip } from '../hooks/useAddTrip';
import { TravelTimeGrid } from './TravelTimeGrid';

// --- Shared Helpers (Moved from Workspace) ---
const deepCloneSchedules = (schedules: MasterRouteTable[]): MasterRouteTable[] => {
    return JSON.parse(JSON.stringify(schedules));
};

const findTableAndTrip = (
    schedules: MasterRouteTable[],
    tripId: string
): { table: MasterRouteTable; trip: MasterTrip; tableIdx: number } | null => {
    for (let i = 0; i < schedules.length; i++) {
        const trip = schedules[i].trips.find(t => t.id === tripId);
        if (trip) return { table: schedules[i], trip, tableIdx: i };
    }
    return null;
};

const calculateHeadways = (trips: MasterTrip[]): Record<string, number> => {
    const headways: Record<string, number> = {};
    const byDir: Record<string, MasterTrip[]> = {};

    trips.forEach(t => {
        const dir = t.direction || 'Loop';
        if (!byDir[dir]) byDir[dir] = [];
        byDir[dir].push(t);
    });

    Object.values(byDir).forEach(dirTrips => {
        dirTrips.sort((a, b) => a.startTime - b.startTime);
        for (let i = 1; i < dirTrips.length; i++) {
            const current = dirTrips[i];
            const prev = dirTrips[i - 1];
            headways[current.id] = current.startTime - prev.startTime;
        }
    });

    return headways;
};

const getRatioColor = (ratio: number) => {
    const target = 15;
    const diff = Math.abs(ratio - target);
    if (diff < 2) return 'bg-emerald-50 text-emerald-700';
    if (diff < 5) return 'bg-yellow-50 text-yellow-700';
    if (diff < 10) return 'bg-orange-100 text-orange-800';
    return 'bg-red-100 text-red-800 font-bold';
};

// --- Subcomponents (Copied to isolate editor) ---
// Ideally these would be in separate files, but for now we keep them bundled with the Editor
// to match the previous structure and ensure no logic is lost during the move.

// [Insert RoundTripTableView Here - Placeholder for implementation step]
// [Insert SingleRouteView Here - Placeholder for implementation step]
// I will implement these fully in the replace/update step to keep the file write manageable or just write them now.
// Actually, I'll write the FULL file content now to avoid partial states.

interface RoundTripTableViewProps {
    schedules: MasterRouteTable[];
    onCellEdit: (tripId: string, col: string, val: string) => void;
    originalSchedules?: MasterRouteTable[];
    onDeleteTrip?: (tripId: string) => void;
    onAddTrip?: (blockId: string, afterTripId: string) => void;
}

const RoundTripTableView: React.FC<RoundTripTableViewProps> = ({ schedules, onCellEdit, originalSchedules, onDeleteTrip, onAddTrip }) => {
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
        <div className="space-y-8">
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

                return (
                    <div key={combined.routeName} className="flex flex-col gap-6">
                        <div className="bg-white border border-gray-200 rounded-lg shadow-sm overflow-hidden">
                            <div className="bg-gray-50 px-4 py-3 border-b border-gray-200">
                                <h3 className="font-bold text-gray-900">{combined.routeName} - Round Trip View</h3>
                            </div>
                            <div className="overflow-auto custom-scrollbar">
                                <table className="min-w-full text-left border-collapse">
                                    <thead className="sticky top-0 z-40 bg-gray-50 shadow-sm">
                                        <tr>
                                            <th className="p-3 border-b border-gray-200 bg-gray-50 sticky left-0 z-30 min-w-[80px] text-xs font-semibold text-gray-500 uppercase tracking-wider">Block</th>
                                            {combined.northStops.map((stop, i) => (
                                                <React.Fragment key={`n-h-${stop}`}>
                                                    <th className={`p-3 border-b-2 border-blue-300 min-w-[90px] whitespace-nowrap text-xs font-semibold text-blue-600 uppercase tracking-wider ${i === 0 ? 'border-l-2' : ''}`}>{stop}</th>
                                                    {northStopsWithRecovery.has(stop) && <th className="p-3 border-b-2 border-blue-300 min-w-[40px] text-center text-xs font-semibold text-blue-500 uppercase tracking-wider bg-blue-50/50">R</th>}
                                                </React.Fragment>
                                            ))}
                                            {combined.southStops.map((stop, i) => (
                                                <React.Fragment key={`s-h-${stop}`}>
                                                    <th className={`p-3 border-b-2 border-indigo-300 min-w-[90px] whitespace-nowrap text-xs font-semibold text-indigo-600 uppercase tracking-wider ${i === 0 ? 'border-l-2' : ''}`}>{stop}</th>
                                                    {southStopsWithRecovery.has(stop) && <th className="p-3 border-b-2 border-indigo-300 min-w-[40px] text-center text-xs font-semibold text-indigo-500 uppercase tracking-wider bg-indigo-50/50">R</th>}
                                                </React.Fragment>
                                            ))}
                                            {/* Metrics headers */}
                                            <th className="p-2 border-b border-gray-200 text-center text-[10px] w-16 bg-blue-50/20 border-l">N-Trav</th>
                                            <th className="p-2 border-b border-gray-200 text-center text-[10px] w-16 bg-blue-50/20">N-Rec</th>
                                            <th className="p-2 border-b border-gray-200 text-center text-[10px] w-16 bg-blue-50/20">Ratio</th>
                                            <th className="p-2 border-b border-gray-200 text-center text-[10px] w-16 bg-blue-50/20">Hdwy</th>
                                            <th className="p-2 border-b border-gray-200 text-center text-[10px] w-16 bg-indigo-50/20 border-l">S-Trav</th>
                                            <th className="p-2 border-b border-gray-200 text-center text-[10px] w-16 bg-indigo-50/20">S-Rec</th>
                                            <th className="p-2 border-b border-gray-200 text-center text-[10px] w-16 bg-indigo-50/20">Ratio</th>
                                            <th className="p-2 border-b border-gray-200 text-center text-[10px] w-16 bg-indigo-50/20">Hdwy</th>
                                            <th className="p-3 border-b border-gray-200 text-center text-xs font-bold w-20 border-l-2">Total Cycle</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-100">
                                        {combined.rows.map((row, rowIdx) => {
                                            const northTrip = row.trips.find(t => t.direction === 'North');
                                            const southTrip = row.trips.find(t => t.direction === 'South');
                                            const lastTrip = [...row.trips].sort((a, b) => a.startTime - b.startTime).pop();

                                            return (
                                                <tr key={row.blockId} className={`group transition-colors ${rowIdx % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'} hover:bg-blue-50/30`}>
                                                    <td className="p-3 border-r border-gray-100 sticky left-0 bg-white group-hover:bg-blue-50/10 z-30 font-mono text-sm font-bold text-center min-w-[80px]">
                                                        <div className="flex flex-col items-center">
                                                            <span>{row.blockId}</span>
                                                            {onAddTrip && <button onClick={() => onAddTrip(row.blockId, lastTrip?.id || '')} className="opacity-0 group-hover:opacity-100 absolute -right-2 top-1/2 -translate-y-1/2 bg-blue-600 text-white rounded-full p-0.5"><Plus size={10} /></button>}
                                                        </div>
                                                    </td>
                                                    {/* North Cells */}
                                                    {combined.northStops.map((stop, i) => (
                                                        <React.Fragment key={`n-${stop}`}>
                                                            <td className={`p-0 relative bg-blue-50/30 ${i === 0 ? 'border-l-2 border-blue-200' : ''}`}>
                                                                <input
                                                                    type="text"
                                                                    value={northTrip?.stops[stop] || ''}
                                                                    onChange={(e) => northTrip && onCellEdit(northTrip.id, stop, e.target.value)}
                                                                    className="w-full h-full bg-transparent font-mono text-xs text-center p-1 focus:bg-white focus:outline-none"
                                                                    disabled={!northTrip}
                                                                />
                                                            </td>
                                                            {northStopsWithRecovery.has(stop) && <td className="p-2 text-center bg-blue-50"><span className="text-xs font-bold text-blue-700">{northTrip?.recoveryTimes?.[stop] || ''}</span></td>}
                                                        </React.Fragment>
                                                    ))}
                                                    {/* South Cells */}
                                                    {combined.southStops.map((stop, i) => (
                                                        <React.Fragment key={`s-${stop}`}>
                                                            <td className={`p-0 relative bg-indigo-50/30 ${i === 0 ? 'border-l-2 border-indigo-200' : ''}`}>
                                                                <input
                                                                    type="text"
                                                                    value={southTrip?.stops[stop] || ''}
                                                                    onChange={(e) => southTrip && onCellEdit(southTrip.id, stop, e.target.value)}
                                                                    className="w-full h-full bg-transparent font-mono text-xs text-center p-1 focus:bg-white focus:outline-none"
                                                                    disabled={!southTrip}
                                                                />
                                                            </td>
                                                            {southStopsWithRecovery.has(stop) && <td className="p-2 text-center bg-indigo-50"><span className="text-xs font-bold text-indigo-700">{southTrip?.recoveryTimes?.[stop] || ''}</span></td>}
                                                        </React.Fragment>
                                                    ))}
                                                    {/* Metrics... skipping minimal layout specifics for brevity but keeping structure */}
                                                    <td className="p-2 text-center text-xs font-mono text-gray-500 border-l">{northTrip?.travelTime}</td>
                                                    <td className="p-2 text-center text-xs font-mono text-gray-500 relative group/cell">
                                                        {northTrip?.recoveryTime}
                                                        {northTrip && onDeleteTrip && <button onClick={() => onDeleteTrip(northTrip.id)} className="absolute top-0 right-0 p-0.5 opacity-0 group-hover/cell:opacity-100"><Trash2 size={10} /></button>}
                                                    </td>
                                                    <td className={`p-2 text-center text-xs font-mono ${northTrip?.travelTime ? getRatioColor(northTrip.recoveryTime / northTrip.travelTime * 100) : ''}`}>{northTrip?.travelTime ? ((northTrip.recoveryTime / northTrip.travelTime) * 100).toFixed(0) + '%' : '-'}</td>
                                                    <td className="p-2 text-center text-xs text-gray-400">{northTrip ? headways[northTrip.id] : '-'}</td>

                                                    <td className="p-2 text-center text-xs font-mono text-gray-500 border-l">{southTrip?.travelTime}</td>
                                                    <td className="p-2 text-center text-xs font-mono text-gray-500 relative group/cell">
                                                        {southTrip?.recoveryTime}
                                                        {southTrip && onDeleteTrip && <button onClick={() => onDeleteTrip(southTrip.id)} className="absolute top-0 right-0 p-0.5 opacity-0 group-hover/cell:opacity-100"><Trash2 size={10} /></button>}
                                                    </td>
                                                    <td className={`p-2 text-center text-xs font-mono ${southTrip?.travelTime ? getRatioColor(southTrip.recoveryTime / southTrip.travelTime * 100) : ''}`}>{southTrip?.travelTime ? ((southTrip.recoveryTime / southTrip.travelTime) * 100).toFixed(0) + '%' : '-'}</td>
                                                    <td className="p-2 text-center text-xs text-gray-400">{southTrip ? headways[southTrip.id] : '-'}</td>

                                                    <td className="p-2 text-center font-mono text-sm font-bold border-l-2">{row.totalCycleTime}m</td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>
                );
            })}
        </div>
    );
}

interface SingleRouteViewProps {
    table: MasterRouteTable;
    showSummary?: boolean;
    originalTable?: MasterRouteTable;
    onCellEdit: (tripId: string, col: string, val: string) => void;
    onRecoveryEdit?: (tripId: string, stopName: string, delta: number) => void;
    onTimeAdjust?: (tripId: string, stopName: string, delta: number) => void;
    onDeleteTrip?: (tripId: string) => void;
    onAddTrip?: (blockId: string, afterTripId: string) => void;
}

const SingleRouteView: React.FC<SingleRouteViewProps> = ({ table, showSummary = true, originalTable, onCellEdit, onRecoveryEdit, onTimeAdjust, onDeleteTrip, onAddTrip }) => {
    const stopsWithRecovery = useMemo(() => {
        const set = new Set<string>();
        table.trips.forEach(t => {
            if (t.recoveryTimes) Object.entries(t.recoveryTimes).forEach(([s, m]) => { if (m != null) set.add(s); });
        });
        return set;
    }, [table]);

    const headways = useMemo(() => calculateHeadways(table.trips), [table.trips]);

    return (
        <div className="flex flex-col gap-6 h-full">
            <div className="bg-white border border-gray-200 rounded-lg shadow-sm overflow-hidden flex-grow flex flex-col">
                <div className="bg-gray-50 px-4 py-3 border-b border-gray-200">
                    <h3 className="font-bold text-gray-900">{table.routeName}</h3>
                </div>
                <div className="overflow-auto custom-scrollbar flex-grow">
                    <table className="min-w-full text-left border-collapse">
                        <thead className="sticky top-0 z-40 bg-gray-50 shadow-sm">
                            <tr>
                                <th className="p-3 border-b bg-gray-50 sticky left-0 z-30 min-w-[80px] text-xs font-semibold text-gray-500 uppercase">Block</th>
                                {table.stops.map(stop => (
                                    <React.Fragment key={stop}>
                                        <th className="p-3 border-b min-w-[100px] text-xs font-semibold text-gray-700 uppercase">{stop}</th>
                                        {stopsWithRecovery.has(stop) && <th className="p-3 border-b min-w-[40px] text-center text-xs font-semibold bg-gray-50/50">R</th>}
                                    </React.Fragment>
                                ))}
                                <th className="p-3 border-b text-center text-xs font-semibold">Trav</th>
                                <th className="p-3 border-b text-center text-xs font-semibold">Rec</th>
                                <th className="p-3 border-b text-center text-xs font-semibold">Ratio</th>
                                <th className="p-3 border-b text-center text-xs font-semibold">Hdwy</th>
                                <th className="p-3 border-b text-center text-xs font-semibold">Cycle</th>
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
                                        const currentMin = TimeUtils.toMinutes(trip.stops[stop]);
                                        const originalMin = originalTrip ? TimeUtils.toMinutes(originalTrip.stops[stop]) : null;
                                        const timeDiff = (currentMin !== null && originalMin !== null) ? currentMin - originalMin : 0;

                                        const originalRec = originalTrip?.recoveryTimes?.[stop] || 0;
                                        const currentRec = trip.recoveryTimes?.[stop] || 0;
                                        const recDiff = currentRec - originalRec;

                                        return (
                                            <React.Fragment key={stop}>
                                                <td className="p-0 border-r relative group/time">
                                                    <div className="flex items-center justify-center">
                                                        <input
                                                            type="text"
                                                            value={trip.stops[stop] || ''}
                                                            onChange={(e) => onCellEdit(trip.id, stop, e.target.value)}
                                                            className={`w-full h-full bg-transparent font-mono text-xs text-center p-1 focus:bg-white focus:outline-none ${timeDiff !== 0 ? 'font-bold' : ''}`}
                                                        />
                                                        {timeDiff !== 0 && (
                                                            <span className={`absolute top-0 right-0 text-[9px] font-bold px-0.5 rounded-bl ${timeDiff > 0 ? 'text-green-600 bg-green-50' : 'text-red-600 bg-red-50'}`}>
                                                                {timeDiff > 0 ? '+' : ''}{timeDiff}
                                                            </span>
                                                        )}
                                                        {onTimeAdjust && trip.stops[stop] && (
                                                            <div className="absolute right-0 top-0 bottom-0 flex flex-col opacity-0 group-hover/time:opacity-100 transition-opacity">
                                                                <button
                                                                    onClick={() => onTimeAdjust(trip.id, stop, 1)}
                                                                    className="flex-1 px-0.5 hover:bg-blue-100 text-gray-400 hover:text-blue-600"
                                                                    title="+1 min"
                                                                >
                                                                    <ChevronUp size={10} />
                                                                </button>
                                                                <button
                                                                    onClick={() => onTimeAdjust(trip.id, stop, -1)}
                                                                    className="flex-1 px-0.5 hover:bg-blue-100 text-gray-400 hover:text-blue-600"
                                                                    title="-1 min"
                                                                >
                                                                    <ChevronDown size={10} />
                                                                </button>
                                                            </div>
                                                        )}
                                                    </div>
                                                </td>
                                                {stopsWithRecovery.has(stop) && (
                                                    <td className="p-2 text-center border-r bg-blue-50/30 relative group/rec">
                                                        <span className={`text-xs font-bold text-blue-700 ${recDiff !== 0 ? 'underline' : ''}`}>{trip.recoveryTimes?.[stop] || ''}</span>
                                                        {recDiff !== 0 && (
                                                            <span className={`absolute top-0 right-0 text-[9px] font-bold px-0.5 rounded-bl ${recDiff > 0 ? 'text-green-600 bg-green-50' : 'text-red-600 bg-red-50'}`}>
                                                                {recDiff > 0 ? '+' : ''}{recDiff}
                                                            </span>
                                                        )}
                                                        {onRecoveryEdit && (
                                                            <div className="absolute right-0 top-0 bottom-0 flex flex-col opacity-0 group-hover/rec:opacity-100 transition-opacity">
                                                                <button
                                                                    onClick={() => onRecoveryEdit(trip.id, stop, 1)}
                                                                    className="flex-1 px-0.5 hover:bg-blue-100 text-gray-400 hover:text-blue-600"
                                                                    title="+1 min recovery"
                                                                >
                                                                    <ChevronUp size={10} />
                                                                </button>
                                                                <button
                                                                    onClick={() => onRecoveryEdit(trip.id, stop, -1)}
                                                                    className="flex-1 px-0.5 hover:bg-blue-100 text-gray-400 hover:text-blue-600"
                                                                    title="-1 min recovery"
                                                                >
                                                                    <ChevronDown size={10} />
                                                                </button>
                                                            </div>
                                                        )}
                                                    </td>
                                                )}
                                            </React.Fragment>
                                        );
                                    })}
                                    <td className="p-2 text-center text-xs font-mono">{trip.travelTime}</td>
                                    <td className="p-2 text-center text-xs font-mono relative group/cell">
                                        {trip.recoveryTime}
                                        {onDeleteTrip && <button onClick={() => onDeleteTrip(trip.id)} className="absolute top-0 right-0 p-0.5 opacity-0 group-hover/cell:opacity-100"><Trash2 size={10} /></button>}
                                    </td>
                                    <td className={`p-2 text-center text-xs font-mono ${trip.travelTime > 0 ? getRatioColor(trip.recoveryTime / trip.travelTime * 100) : ''}`}>{trip.travelTime > 0 ? ((trip.recoveryTime / trip.travelTime) * 100).toFixed(0) + '%' : '-'}</td>
                                    <td className="p-2 text-center text-xs">{headways[trip.id] ?? '-'}</td>
                                    <td className="p-2 text-center text-xs font-bold">{trip.cycleTime}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}


// --- Main Editor Component ---

export interface ScheduleEditorProps {
    schedules: MasterRouteTable[];
    onSchedulesChange: (schedules: MasterRouteTable[]) => void;
    originalSchedules?: MasterRouteTable[];
    draftName: string;
    onRenameDraft: (name: string) => void;
    autoSaveStatus: AutoSaveStatus;
    lastSaved: Date | null;
    onSaveVersion: (label?: string) => Promise<void>;
    onClose: () => void;
    onNewDraft: () => void;
    onOpenDrafts: () => void;

    // Undo/Redo
    canUndo: boolean;
    canRedo: boolean;
    undo: () => void;
    redo: () => void;

    showSuccessToast: (msg: string) => void;
}

export const ScheduleEditor: React.FC<ScheduleEditorProps> = ({
    schedules,
    onSchedulesChange,
    originalSchedules,
    draftName,
    onRenameDraft,
    autoSaveStatus,
    lastSaved,
    onSaveVersion,
    onClose,
    onNewDraft,
    onOpenDrafts,
    canUndo, canRedo, undo, redo,
    showSuccessToast
}) => {
    const [activeRouteIdx, setActiveRouteIdx] = useState(0);
    const [activeDay, setActiveDay] = useState<string>('Weekday');
    const [subView, setSubView] = useState<'editor' | 'matrix'>('editor');
    const [isFullScreen, setIsFullScreen] = useState(false);

    // Add Trip
    const {
        modalContext: addTripModalContext,
        openModal: openAddTripModal,
        closeModal: closeAddTripModal,
        handleConfirm: handleAddTripFromModal
    } = useAddTrip({
        schedules,
        setSchedules: onSchedulesChange,
        onSuccess: showSuccessToast
    });

    // Consolidate Routes
    const consolidatedRoutes = useMemo(() => {
        const routeGroups: Record<string, {
            name: string;
            days: Record<string, {
                north?: MasterRouteTable;
                south?: MasterRouteTable;
                combined?: RoundTripTable;
            }>;
        }> = {};

        schedules.forEach(table => {
            let dayType = 'Weekday';
            if (table.routeName.includes('(Saturday)')) dayType = 'Saturday';
            else if (table.routeName.includes('(Sunday)')) dayType = 'Sunday';

            const baseName = table.routeName
                .replace(/\s?\((Weekday|Saturday|Sunday)\)/g, '')
                .replace(/\s?\((North|South)\)/g, '')
                .trim();

            if (!routeGroups[baseName]) routeGroups[baseName] = { name: baseName, days: {} };
            if (!routeGroups[baseName].days[dayType]) routeGroups[baseName].days[dayType] = {};

            const dayGroup = routeGroups[baseName].days[dayType];
            if (table.routeName.includes('(North)')) dayGroup.north = table;
            else if (table.routeName.includes('(South)')) dayGroup.south = table;
            else dayGroup.north = table;
        });

        return Object.values(routeGroups).map(group => {
            Object.keys(group.days).forEach(d => {
                const day = group.days[d];
                if (day.north && day.south) day.combined = buildRoundTripView(day.north, day.south);
            });
            return group;
        }).sort((a, b) => a.name.localeCompare(b.name));
    }, [schedules]);


    // Handlers
    const recalculateTrip = (trip: MasterTrip, cols: string[]) => {
        let start: number | null = null;
        let end: number | null = null;
        cols.forEach(col => {
            const m = TimeUtils.toMinutes(trip.stops[col]);
            if (m !== null) {
                if (start === null) start = m;
                end = m;
            }
        });
        if (start !== null && end !== null) {
            trip.startTime = start;
            trip.endTime = end;
            trip.cycleTime = end - start;
            trip.travelTime = Math.max(0, trip.cycleTime - trip.recoveryTime);
        }
    };

    // Re-assign blocks for related tables based on time matching
    // Trips are linked when: endTime + recovery at last stop ≈ next trip's startTime (within 1 min)
    const reassignBlocksForRelatedTables = (
        tables: MasterRouteTable[],
        baseName: string
    ) => {
        // Find all related tables (same route, different directions)
        const relatedTables = tables.filter(t => {
            const tBase = t.routeName
                .replace(/\s*\((North|South)\)/gi, '')
                .replace(/\s*\((Weekday|Saturday|Sunday)\)/gi, '')
                .trim();
            return tBase === baseName;
        });

        if (relatedTables.length === 0) return;

        // Collect all trips with their table reference
        interface TripWithTable {
            trip: MasterTrip;
            table: MasterRouteTable;
            assigned: boolean;
        }

        const allTrips: TripWithTable[] = [];
        relatedTables.forEach(table => {
            table.trips.forEach(trip => {
                allTrips.push({ trip, table, assigned: false });
            });
        });

        // Sort by start time for consistent block assignment
        const getOperationalSortTime = (minutes: number): number => {
            const DAY_START = 240; // 4:00 AM
            return minutes < DAY_START ? minutes + 1440 : minutes;
        };
        allTrips.sort((a, b) =>
            getOperationalSortTime(a.trip.startTime) - getOperationalSortTime(b.trip.startTime)
        );

        // Assign blocks based on time matching
        let blockCounter = 1;
        for (const item of allTrips) {
            if (item.assigned) continue;

            const blockId = `${baseName}-${blockCounter}`;
            let currentItem: TripWithTable | undefined = item;
            let tripNumberInBlock = 1;

            while (currentItem) {
                currentItem.assigned = true;
                currentItem.trip.blockId = blockId;
                currentItem.trip.tripNumber = tripNumberInBlock++;

                // Find next matching trip in opposite direction
                const currentEndTime = currentItem.trip.endTime;
                const currentDirection = currentItem.trip.direction;

                // Get recovery time at the last stop
                const lastStop = currentItem.table.stops[currentItem.table.stops.length - 1];
                const recoveryAtEnd = currentItem.trip.recoveryTimes?.[lastStop] ?? 0;
                const expectedStart = currentEndTime + recoveryAtEnd;

                const oppositeDirection = currentDirection === 'North' ? 'South' : 'North';

                // Find next trip in opposite direction with matching start time
                currentItem = allTrips.find(t =>
                    !t.assigned &&
                    t.trip.direction === oppositeDirection &&
                    Math.abs(t.trip.startTime - expectedStart) <= 1
                );

                // If no opposite direction match, try same direction (for loop routes)
                if (!currentItem) {
                    currentItem = allTrips.find(t =>
                        !t.assigned &&
                        Math.abs(t.trip.startTime - expectedStart) <= 1
                    );
                }
            }

            blockCounter++;
        }
    };

    const handleCellEdit = (tripId: string, col: string, val: string) => {
        const newScheds = deepCloneSchedules(schedules);
        const result = findTableAndTrip(newScheds, tripId);
        if (!result) return;
        const { table, trip } = result;

        const oldTime = TimeUtils.toMinutes(trip.stops[col]);
        const newTime = TimeUtils.toMinutes(val);
        const colIdx = table.stops.indexOf(col);

        trip.stops[col] = val;

        if (oldTime !== null && newTime !== null && colIdx !== -1) {
            const delta = newTime - oldTime;
            if (delta !== 0) {
                for (let i = colIdx + 1; i < table.stops.length; i++) {
                    const nextStop = table.stops[i];
                    const nextTime = TimeUtils.toMinutes(trip.stops[nextStop]);
                    if (nextTime !== null) trip.stops[nextStop] = TimeUtils.fromMinutes(nextTime + delta);
                }
            }
        }

        const oldEndTime = trip.endTime;
        recalculateTrip(trip, table.stops);
        const newEndTime = trip.endTime;
        const deltaEnd = newEndTime - oldEndTime;

        if (deltaEnd !== 0) {
            // Ripple to subsequent trips in the same block
            // Extract base route name (remove direction and day type suffixes)
            const baseName = table.routeName
                .replace(/\s*\((North|South)\)/gi, '')
                .replace(/\s*\((Weekday|Saturday|Sunday)\)/gi, '')
                .trim();

            // Find all tables for this route (both directions if bidirectional)
            const relatedTables = newScheds.filter(t => {
                const tBase = t.routeName
                    .replace(/\s*\((North|South)\)/gi, '')
                    .replace(/\s*\((Weekday|Saturday|Sunday)\)/gi, '')
                    .trim();
                return tBase === baseName;
            });

            // Collect all trips in this block from all related tables
            const allBlockTrips: { trip: MasterTrip; table: MasterRouteTable }[] = [];
            relatedTables.forEach(t => {
                t.trips.filter(tr => tr.blockId === trip.blockId).forEach(tr => {
                    allBlockTrips.push({ trip: tr, table: t });
                });
            });

            // Sort by tripNumber to maintain proper sequence
            allBlockTrips.sort((a, b) => a.trip.tripNumber - b.trip.tripNumber);

            // Find where the edited trip is in the sequence
            const startIdx = allBlockTrips.findIndex(item => item.trip.id === trip.id);

            if (startIdx !== -1) {
                // Ripple changes to all subsequent trips in the block
                for (let i = startIdx + 1; i < allBlockTrips.length; i++) {
                    const { trip: nextTrip, table: nextTable } = allBlockTrips[i];
                    // Shift all stop times by the delta
                    nextTable.stops.forEach(s => {
                        const stopTime = nextTrip.stops[s];
                        if (stopTime) {
                            nextTrip.stops[s] = TimeUtils.addMinutes(stopTime, deltaEnd);
                        }
                    });
                    recalculateTrip(nextTrip, nextTable.stops);
                }
            }
        }

        newScheds.forEach(t => validateRouteTable(t));

        // Re-assign blocks after time changes to maintain proper linking
        const baseName = table.routeName
            .replace(/\s*\((North|South)\)/gi, '')
            .replace(/\s*\((Weekday|Saturday|Sunday)\)/gi, '')
            .trim();
        reassignBlocksForRelatedTables(newScheds, baseName);

        onSchedulesChange(newScheds);
    };

    const handleRecoveryEdit = (tripId: string, stopName: string, delta: number) => {
        const newScheds = deepCloneSchedules(schedules);
        const result = findTableAndTrip(newScheds, tripId);
        if (!result) return;
        const { table, trip } = result;
        const stopIdx = table.stops.indexOf(stopName);
        if (stopIdx === -1) return;

        const oldRec = trip.recoveryTimes?.[stopName] || 0;
        const newRec = Math.max(0, oldRec + delta);
        if (!trip.recoveryTimes) trip.recoveryTimes = {};
        trip.recoveryTimes[stopName] = newRec;
        trip.recoveryTime = Object.values(trip.recoveryTimes).reduce((sum, v) => sum + (v || 0), 0);

        for (let i = stopIdx + 1; i < table.stops.length; i++) {
            const nextStop = table.stops[i];
            const t = TimeUtils.toMinutes(trip.stops[nextStop]);
            if (t !== null) trip.stops[nextStop] = TimeUtils.fromMinutes(t + delta);
        }
        recalculateTrip(trip, table.stops);
        validateRouteTable(table);

        // Re-assign blocks after recovery time changes
        const baseName = table.routeName
            .replace(/\s*\((North|South)\)/gi, '')
            .replace(/\s*\((Weekday|Saturday|Sunday)\)/gi, '')
            .trim();
        reassignBlocksForRelatedTables(newScheds, baseName);

        onSchedulesChange(newScheds);
    };

    const handleTimeAdjust = (tripId: string, stopName: string, delta: number) => {
        const newScheds = deepCloneSchedules(schedules);
        const result = findTableAndTrip(newScheds, tripId);
        if (!result) return;
        const { table, trip } = result;

        const currentTime = trip.stops[stopName];
        if (!currentTime) return;

        const newTime = TimeUtils.addMinutes(currentTime, delta);
        handleCellEdit(tripId, stopName, newTime);
    };

    const handleDeleteTrip = (tripId: string) => {
        if (!confirm("Delete trip?")) return;
        const newScheds = deepCloneSchedules(schedules);
        for (const t of newScheds) {
            if (t.trips.find(x => x.id === tripId)) {
                t.trips = t.trips.filter(x => x.id !== tripId);
                validateRouteTable(t);
                break;
            }
        }
        onSchedulesChange(newScheds);
    };

    const handleBulkAdjustTravelTime = (fromStop: string, toStop: string, delta: number, routeName: string) => {
        const newScheds = deepCloneSchedules(schedules);
        const targetTable = newScheds.find(t => t.routeName === routeName);
        if (!targetTable) return;

        const toIdx = targetTable.stops.indexOf(toStop);
        if (toIdx === -1) return;

        targetTable.trips.forEach(trip => {
            for (let i = toIdx; i < targetTable.stops.length; i++) {
                const stop = targetTable.stops[i];
                const t = TimeUtils.toMinutes(trip.stops[stop]);
                if (t !== null) {
                    trip.stops[stop] = TimeUtils.fromMinutes(t + delta);
                }
            }
            recalculateTrip(trip, targetTable.stops);
        });

        newScheds.forEach(t => validateRouteTable(t));
        onSchedulesChange(newScheds);
    };

    const handleSingleTripTravelAdjust = (tripId: string, fromStop: string, delta: number, routeName: string) => {
        const newScheds = deepCloneSchedules(schedules);
        const targetTable = newScheds.find(t => t.routeName === routeName);
        if (!targetTable) return;

        const trip = targetTable.trips.find(t => t.id === tripId);
        if (!trip) return;

        const fromIdx = targetTable.stops.indexOf(fromStop);
        if (fromIdx === -1) return;

        // Adjust this stop and all subsequent stops for this trip only
        for (let i = fromIdx; i < targetTable.stops.length; i++) {
            const stop = targetTable.stops[i];
            const t = TimeUtils.toMinutes(trip.stops[stop]);
            if (t !== null) {
                trip.stops[stop] = TimeUtils.fromMinutes(t + delta);
            }
        }
        recalculateTrip(trip, targetTable.stops);

        newScheds.forEach(t => validateRouteTable(t));
        onSchedulesChange(newScheds);
    };

    const handleBulkAdjustRecoveryTime = (stopName: string, delta: number, routeName: string) => {
        const newScheds = deepCloneSchedules(schedules);
        const targetTable = newScheds.find(t => t.routeName === routeName);
        if (!targetTable) return;

        const stopIdx = targetTable.stops.indexOf(stopName);

        targetTable.trips.forEach(trip => {
            const oldRec = trip.recoveryTimes?.[stopName] || 0;
            const newRec = Math.max(0, oldRec + delta);
            if (!trip.recoveryTimes) trip.recoveryTimes = {};
            trip.recoveryTimes[stopName] = newRec;

            if (stopIdx !== -1) {
                for (let i = stopIdx + 1; i < targetTable.stops.length; i++) {
                    const s = targetTable.stops[i];
                    const t = TimeUtils.toMinutes(trip.stops[s]);
                    if (t !== null) trip.stops[s] = TimeUtils.fromMinutes(t + delta);
                }
            }
            recalculateTrip(trip, targetTable.stops);
        });

        newScheds.forEach(t => validateRouteTable(t));
        onSchedulesChange(newScheds);
    };

    const handleSingleRecoveryAdjust = (tripId: string, stopName: string, delta: number, routeName: string) => {
        const newScheds = deepCloneSchedules(schedules);
        const targetTable = newScheds.find(t => t.routeName === routeName);
        if (!targetTable) return;

        const trip = targetTable.trips.find(t => t.id === tripId);
        if (!trip) return;

        const stopIdx = targetTable.stops.indexOf(stopName);

        // Adjust recovery for this trip
        const oldRec = trip.recoveryTimes?.[stopName] || 0;
        const newRec = Math.max(0, oldRec + delta);
        if (!trip.recoveryTimes) trip.recoveryTimes = {};
        trip.recoveryTimes[stopName] = newRec;

        // Cascade time changes to subsequent stops
        if (stopIdx !== -1) {
            for (let i = stopIdx + 1; i < targetTable.stops.length; i++) {
                const s = targetTable.stops[i];
                const t = TimeUtils.toMinutes(trip.stops[s]);
                if (t !== null) trip.stops[s] = TimeUtils.fromMinutes(t + delta);
            }
        }
        recalculateTrip(trip, targetTable.stops);

        newScheds.forEach(t => validateRouteTable(t));
        onSchedulesChange(newScheds);
    };

    const handleExport = async () => {
        const workbook = new ExcelJS.Workbook();
        workbook.creator = 'Barrie Transit Scheduler';
        workbook.created = new Date();

        // Helper: minutes to hours
        const toHours = (min: number) => (min / 60).toFixed(1);

        // Helper: convert hex color to ARGB
        const hexToArgb = (hex: string) => 'FF' + hex.replace('#', '').toUpperCase();

        // Helper: determine if text should be light or dark based on background
        const getContrastTextColor = (bgHex: string): string => {
            const hex = bgHex.replace('#', '');
            const r = parseInt(hex.substr(0, 2), 16);
            const g = parseInt(hex.substr(2, 2), 16);
            const b = parseInt(hex.substr(4, 2), 16);
            const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
            return luminance > 0.5 ? 'FF1F2937' : 'FFFFFFFF';
        };

        // Annual multipliers
        const WEEKDAY_DAYS = 260; // 5 days × 52 weeks
        const SATURDAY_DAYS = 52;
        const SUNDAY_DAYS = 52;

        // Collect summary data
        const routeSummaries: { route: string; dayType: string; cycleHours: number }[] = [];

        // Common styles
        const headerAlignment: Partial<ExcelJS.Alignment> = { horizontal: 'center', vertical: 'middle' };
        const cellAlignment: Partial<ExcelJS.Alignment> = { horizontal: 'center', vertical: 'middle' };
        const thinBorder: Partial<ExcelJS.Border> = { style: 'thin', color: { argb: 'FFE5E7EB' } };
        const allBorders: Partial<ExcelJS.Borders> = { top: thinBorder, bottom: thinBorder, left: thinBorder, right: thinBorder };

        // Create summary sheet FIRST so it appears first in workbook
        const summarySheet = workbook.addWorksheet('Service Hours Summary');

        // Process each schedule table
        for (const table of schedules) {
            const ws = workbook.addWorksheet(table.routeName.substring(0, 31));

            // Extract info
            const direction = table.routeName.includes('(North)') ? 'NORTHBOUND' :
                table.routeName.includes('(South)') ? 'SOUTHBOUND' : 'ALL TRIPS';
            const dayType = table.routeName.includes('Saturday') ? 'Saturday' :
                table.routeName.includes('Sunday') ? 'Sunday' : 'Weekday';
            const baseName = table.routeName
                .replace(/\s*\((North|South)\)/gi, '')
                .replace(/\s*\((Weekday|Saturday|Sunday)\)/gi, '')
                .trim();

            // Get route color
            const routeColor = getRouteColor(baseName);
            const routeTextColor = getContrastTextColor(routeColor);
            const routeColorArgb = hexToArgb(routeColor);

            // Calculate summary stats
            const totalTrips = table.trips.length;
            const totalTravelTime = table.trips.reduce((sum, t) => sum + t.travelTime, 0);
            const totalRecovery = table.trips.reduce((sum, t) => sum + t.recoveryTime, 0);
            const totalCycleTime = totalTravelTime + totalRecovery;
            const recoveryRatio = totalTravelTime > 0 ? ((totalRecovery / totalTravelTime) * 100).toFixed(1) + '%' : '0%';

            // Store for summary sheet
            routeSummaries.push({ route: baseName, dayType, cycleHours: totalCycleTime / 60 });

            // Build column structure
            const columnDefs: { name: string; isRecovery: boolean }[] = [];
            columnDefs.push({ name: 'Block', isRecovery: false });

            table.stops.forEach((stop, idx) => {
                columnDefs.push({ name: stop, isRecovery: false });
                if (idx < table.stops.length - 1) {
                    const hasRecovery = table.trips.some(t => t.recoveryTimes?.[stop] && t.recoveryTimes[stop] > 0);
                    if (hasRecovery) {
                        columnDefs.push({ name: 'R', isRecovery: true });
                    }
                }
            });
            columnDefs.push({ name: 'Travel', isRecovery: false });
            columnDefs.push({ name: 'Recovery', isRecovery: false });
            columnDefs.push({ name: 'Cycle', isRecovery: false });
            columnDefs.push({ name: 'Ratio', isRecovery: false });

            // Row 1: Route header with route color
            const routeRow = ws.addRow([`ROUTE ${baseName} - ${dayType.toUpperCase()}`]);
            ws.mergeCells(1, 1, 1, columnDefs.length);
            routeRow.height = 28;
            routeRow.getCell(1).font = { bold: true, size: 16, color: { argb: routeTextColor } };
            routeRow.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: routeColorArgb } };
            routeRow.getCell(1).alignment = headerAlignment;
            routeRow.getCell(1).border = allBorders;

            // Row 2: Direction subheader
            const dirRow = ws.addRow([direction]);
            ws.mergeCells(2, 1, 2, columnDefs.length);
            dirRow.height = 22;
            dirRow.getCell(1).font = { bold: true, size: 12, color: { argb: 'FF374151' } };
            dirRow.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF9FAFB' } };
            dirRow.getCell(1).alignment = headerAlignment;
            dirRow.getCell(1).border = allBorders;

            // Row 3: Column headers
            const headerRow = ws.addRow(columnDefs.map(c => c.name));
            headerRow.height = 20;
            headerRow.eachCell((cell, colNumber) => {
                cell.font = { bold: true, size: 10, color: { argb: 'FF1F2937' } };
                cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE5E7EB' } };
                cell.alignment = headerAlignment;
                cell.border = allBorders;
                if (columnDefs[colNumber - 1]?.isRecovery) {
                    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDBEAFE' } };
                    cell.font = { bold: true, size: 10, color: { argb: 'FF1D4ED8' } };
                }
            });

            // Data rows
            table.trips.forEach((trip, tripIdx) => {
                const rowData: (string | number)[] = [trip.blockId];

                table.stops.forEach((stop, idx) => {
                    rowData.push(trip.stops[stop] || '');
                    if (idx < table.stops.length - 1) {
                        const hasRecovery = table.trips.some(t => t.recoveryTimes?.[stop] && t.recoveryTimes[stop] > 0);
                        if (hasRecovery) {
                            rowData.push(trip.recoveryTimes?.[stop] || '');
                        }
                    }
                });

                const ratio = trip.travelTime > 0 ? ((trip.recoveryTime / trip.travelTime) * 100).toFixed(0) + '%' : '-';
                rowData.push(trip.travelTime);
                rowData.push(trip.recoveryTime);
                rowData.push(trip.cycleTime);
                rowData.push(ratio);

                const row = ws.addRow(rowData);
                row.height = 18;
                row.eachCell((cell, colNumber) => {
                    cell.font = { size: 10 };
                    cell.alignment = cellAlignment;
                    cell.border = allBorders;
                    const bgColor = tripIdx % 2 === 0 ? 'FFFFFFFF' : 'FFF9FAFB';
                    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bgColor } };
                    if (columnDefs[colNumber - 1]?.isRecovery) {
                        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFF6FF' } };
                        cell.font = { size: 10, color: { argb: 'FF1D4ED8' }, bold: true };
                    }
                });
            });

            // Summary card (offset to right)
            const summaryCol = columnDefs.length + 3;
            const summaryStartRow = 2;

            // Summary header
            ws.getCell(summaryStartRow, summaryCol).value = 'DAY SUMMARY';
            ws.mergeCells(summaryStartRow, summaryCol, summaryStartRow, summaryCol + 1);
            ws.getCell(summaryStartRow, summaryCol).font = { bold: true, size: 12, color: { argb: 'FFFFFFFF' } };
            ws.getCell(summaryStartRow, summaryCol).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: routeColorArgb } };
            ws.getCell(summaryStartRow, summaryCol).alignment = headerAlignment;

            const summaryItems = [
                ['Total Trips', totalTrips],
                ['Total Travel', toHours(totalTravelTime) + ' hrs'],
                ['Total Recovery', toHours(totalRecovery) + ' hrs'],
                ['Total Cycle', toHours(totalCycleTime) + ' hrs'],
                ['Recovery Ratio', recoveryRatio]
            ];

            summaryItems.forEach((item, idx) => {
                const r = summaryStartRow + 1 + idx;
                ws.getCell(r, summaryCol).value = item[0];
                ws.getCell(r, summaryCol).font = { size: 10, color: { argb: 'FF6B7280' } };
                ws.getCell(r, summaryCol).alignment = { horizontal: 'right', vertical: 'middle' };
                ws.getCell(r, summaryCol + 1).value = item[1];
                ws.getCell(r, summaryCol + 1).font = { bold: true, size: 10 };
                ws.getCell(r, summaryCol + 1).alignment = cellAlignment;
                if (idx === 3) { // Total Cycle row
                    ws.getCell(r, summaryCol + 1).font = { bold: true, size: 11, color: { argb: hexToArgb(routeColor) } };
                }
            });

            // Column widths
            columnDefs.forEach((col, idx) => {
                ws.getColumn(idx + 1).width = col.isRecovery ? 5 : col.name === 'Block' ? 10 : Math.max(col.name.length + 2, 10);
            });
            ws.getColumn(summaryCol).width = 14;
            ws.getColumn(summaryCol + 1).width = 10;
        }

        // ========================================
        // Populate Service Hours Summary Sheet
        // ========================================
        const routes = [...new Set(routeSummaries.map(r => r.route))].sort();

        // Title row
        const titleRow = summarySheet.addRow(['SERVICE HOURS SUMMARY']);
        summarySheet.mergeCells(1, 1, 1, 10);
        titleRow.height = 32;
        titleRow.getCell(1).font = { bold: true, size: 18, color: { argb: 'FF1F2937' } };
        titleRow.getCell(1).alignment = headerAlignment;

        // Subtitle
        const subtitleRow = summarySheet.addRow(['Annual metrics based on: Weekday × 260 days | Saturday × 52 days | Sunday × 52 days']);
        summarySheet.mergeCells(2, 1, 2, 10);
        subtitleRow.getCell(1).font = { size: 10, italic: true, color: { argb: 'FF6B7280' } };
        subtitleRow.getCell(1).alignment = headerAlignment;

        // Empty row
        summarySheet.addRow([]);

        // Daily Hours section header
        const dailyHeader = summarySheet.addRow(['', 'DAILY SERVICE HOURS', '', '', '', 'ANNUAL SERVICE HOURS']);
        dailyHeader.height = 24;
        summarySheet.mergeCells(4, 2, 4, 5);
        summarySheet.mergeCells(4, 6, 4, 9);
        dailyHeader.getCell(2).font = { bold: true, size: 12, color: { argb: 'FFFFFFFF' } };
        dailyHeader.getCell(2).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2563EB' } };
        dailyHeader.getCell(2).alignment = headerAlignment;
        dailyHeader.getCell(6).font = { bold: true, size: 12, color: { argb: 'FFFFFFFF' } };
        dailyHeader.getCell(6).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF059669' } };
        dailyHeader.getCell(6).alignment = headerAlignment;

        // Column headers
        const colHeader = summarySheet.addRow(['Route', 'Weekday', 'Saturday', 'Sunday', 'Total', 'Weekday', 'Saturday', 'Sunday', 'Total']);
        colHeader.height = 22;
        colHeader.eachCell((cell, col) => {
            if (col === 1) {
                cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F4F6' } };
            } else if (col <= 5) {
                cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDBEAFE' } };
            } else {
                cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD1FAE5' } };
            }
            cell.font = { bold: true, size: 10 };
            cell.alignment = headerAlignment;
            cell.border = allBorders;
        });

        let totalWeekday = 0, totalSaturday = 0, totalSunday = 0;

        routes.forEach((route, idx) => {
            const weekday = routeSummaries.filter(r => r.route === route && r.dayType === 'Weekday').reduce((sum, r) => sum + r.cycleHours, 0);
            const saturday = routeSummaries.filter(r => r.route === route && r.dayType === 'Saturday').reduce((sum, r) => sum + r.cycleHours, 0);
            const sunday = routeSummaries.filter(r => r.route === route && r.dayType === 'Sunday').reduce((sum, r) => sum + r.cycleHours, 0);
            const dailyTotal = weekday + saturday + sunday;

            const annualWeekday = weekday * WEEKDAY_DAYS;
            const annualSaturday = saturday * SATURDAY_DAYS;
            const annualSunday = sunday * SUNDAY_DAYS;
            const annualTotal = annualWeekday + annualSaturday + annualSunday;

            totalWeekday += weekday;
            totalSaturday += saturday;
            totalSunday += sunday;

            // Get route color
            const routeColor = getRouteColor(route);
            const routeColorArgb = hexToArgb(routeColor);
            const routeTextColor = getContrastTextColor(routeColor);

            const row = summarySheet.addRow([
                route,
                weekday.toFixed(1),
                saturday.toFixed(1),
                sunday.toFixed(1),
                dailyTotal.toFixed(1),
                annualWeekday.toFixed(0),
                annualSaturday.toFixed(0),
                annualSunday.toFixed(0),
                annualTotal.toFixed(0)
            ]);
            row.height = 20;
            row.eachCell((cell, col) => {
                cell.alignment = col === 1 ? { horizontal: 'left', vertical: 'middle' } : cellAlignment;
                cell.border = allBorders;
                cell.font = { size: 10 };
                const bgColor = idx % 2 === 0 ? 'FFFFFFFF' : 'FFF9FAFB';
                cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bgColor } };
                if (col === 1) {
                    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: routeColorArgb } };
                    cell.font = { bold: true, size: 10, color: { argb: routeTextColor } };
                }
                if (col === 5 || col === 9) {
                    cell.font = { bold: true, size: 10 };
                }
            });
        });

        // Total row
        const grandTotal = totalWeekday + totalSaturday + totalSunday;
        const annualGrandTotal = (totalWeekday * WEEKDAY_DAYS) + (totalSaturday * SATURDAY_DAYS) + (totalSunday * SUNDAY_DAYS);

        const totalRow = summarySheet.addRow([
            'TOTAL',
            totalWeekday.toFixed(1),
            totalSaturday.toFixed(1),
            totalSunday.toFixed(1),
            grandTotal.toFixed(1),
            (totalWeekday * WEEKDAY_DAYS).toFixed(0),
            (totalSaturday * SATURDAY_DAYS).toFixed(0),
            (totalSunday * SUNDAY_DAYS).toFixed(0),
            annualGrandTotal.toFixed(0)
        ]);
        totalRow.height = 24;
        totalRow.eachCell((cell, col) => {
            cell.font = { bold: true, size: 11 };
            cell.alignment = cellAlignment;
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F2937' } };
            cell.font = { bold: true, size: 11, color: { argb: 'FFFFFFFF' } };
            cell.border = allBorders;
        });

        // Column widths
        summarySheet.getColumn(1).width = 12;
        [2, 3, 4, 5].forEach(c => summarySheet.getColumn(c).width = 11);
        [6, 7, 8, 9].forEach(c => summarySheet.getColumn(c).width = 11);

        // Write file
        const buffer = await workbook.xlsx.writeBuffer();
        const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = 'Bus_Schedule_Export.xlsx';
        link.click();
    };


    // Active Data
    const activeRouteGroup = consolidatedRoutes[activeRouteIdx];
    const activeRoute = activeRouteGroup?.days[activeDay] || activeRouteGroup?.days[Object.keys(activeRouteGroup?.days || {})[0]];
    const summaryTable = useMemo(() => {
        if (!activeRoute) return { routeName: 'Unknown', trips: [], stops: [], stopIds: {} };
        if (activeRoute.combined) return { routeName: activeRouteGroup.name, trips: [...(activeRoute.north?.trips || []), ...(activeRoute.south?.trips || [])], stops: [], stopIds: {} };
        return activeRoute.north || activeRoute.south || { routeName: 'Unknown', trips: [], stops: [], stopIds: {} };
    }, [activeRoute]);

    if (!activeRouteGroup || !activeRoute) return <div className="p-8 text-center text-gray-400">No Routes Loaded</div>;

    return (
        <>
            {addTripModalContext && (
                <AddTripModal
                    context={addTripModalContext}
                    onCancel={closeAddTripModal}
                    onConfirm={handleAddTripFromModal}
                />
            )}

            <div className={`h-full flex flex-col bg-gray-50/30 overflow-hidden ${isFullScreen ? 'fixed inset-0 z-50 bg-white' : ''}`}>
                <WorkspaceHeader
                    routeGroupName={activeRouteGroup.name}
                    dayLabel={activeDay}
                    isRoundTrip={!!activeRoute.combined}
                    subView={subView}
                    onViewChange={setSubView}
                    onSaveVersion={onSaveVersion}
                    autoSaveStatus={autoSaveStatus}
                    lastSaved={lastSaved}
                    hasUnsavedChanges={schedules.length > 0}
                    summaryTable={summaryTable}
                    draftName={draftName}
                    onRenameDraft={onRenameDraft}
                    onOpenDrafts={onOpenDrafts}
                    onNewDraft={onNewDraft}
                    onClose={onClose}
                    onExport={handleExport}
                    isFullScreen={isFullScreen}
                    onToggleFullScreen={() => setIsFullScreen(!isFullScreen)}
                />

                <div className="flex-grow flex overflow-hidden">
                    {/* Sidebar */}
                    {!isFullScreen && (
                        <div className="w-80 bg-white border-r border-gray-200 flex flex-col overflow-hidden z-20">
                            {/* Header */}
                            <div className="p-4 border-b border-gray-100 flex justify-between items-center">
                                <h2 className="text-sm font-bold uppercase tracking-wider">Route Tweaker</h2>
                                <button onClick={onClose} className="text-xs text-blue-600 flex items-center gap-1"><ArrowLeft size={10} /> Back</button>
                            </div>

                            {/* Route List */}
                            <div className="overflow-y-auto custom-scrollbar flex-grow p-4 space-y-2">
                                {consolidatedRoutes.map((route, i) => (
                                    <div key={route.name} className="space-y-1">
                                        <button
                                            onClick={() => setActiveRouteIdx(i)}
                                            className={`w-full text-left px-3 py-2 rounded-lg text-sm font-bold flex justify-between items-center ${i === activeRouteIdx ? 'bg-blue-50 text-blue-800' : 'text-gray-600 hover:bg-gray-50'}`}
                                            style={i === activeRouteIdx ? { backgroundColor: getRouteColor(route.name), color: getRouteTextColor(route.name) } : undefined}
                                        >
                                            Route {route.name}
                                            {i === activeRouteIdx ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                                        </button>

                                        {i === activeRouteIdx && (
                                            <div className="pl-3 space-y-1">
                                                {['Weekday', 'Saturday', 'Sunday'].filter(d => Object.keys(route.days).includes(d)).map(day => (
                                                    <button
                                                        key={day}
                                                        onClick={() => setActiveDay(day)}
                                                        className={`w-full text-left px-3 py-1.5 rounded text-xs flex items-center gap-2 ${activeDay === day ? 'bg-blue-100 font-bold text-blue-800' : 'text-gray-500 hover:bg-gray-50'}`}
                                                    >
                                                        <div className={`w-1.5 h-1.5 rounded-full ${activeDay === day ? 'bg-blue-600' : 'bg-gray-300'}`} />
                                                        {day}
                                                    </button>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>

                            {subView === 'editor' && (
                                <div className="p-4 border-t border-gray-100 flex gap-2 justify-center">
                                    <button onClick={undo} disabled={!canUndo} className="p-2 bg-gray-100 rounded hover:bg-gray-200 disabled:opacity-50"><Undo2 size={16} /></button>
                                    <button onClick={redo} disabled={!canRedo} className="p-2 bg-gray-100 rounded hover:bg-gray-200 disabled:opacity-50"><Redo2 size={16} /></button>
                                </div>
                            )}
                        </div>
                    )}

                    {/* Editor Content */}
                    <div className="flex-grow overflow-auto flex flex-col p-4">
                        {subView === 'matrix' ? (
                            <TravelTimeGrid
                                schedules={[activeRoute.north, activeRoute.south].filter((t): t is MasterRouteTable => !!t)}
                                onBulkAdjust={handleBulkAdjustTravelTime}
                                onRecoveryAdjust={handleBulkAdjustRecoveryTime}
                                onSingleTripAdjust={handleSingleTripTravelAdjust}
                                onSingleRecoveryAdjust={handleSingleRecoveryAdjust}
                            />
                        ) : (
                            activeRoute.combined ? (
                                <RoundTripTableView
                                    schedules={schedules}
                                    onCellEdit={handleCellEdit}
                                    originalSchedules={originalSchedules}
                                    onDeleteTrip={handleDeleteTrip}
                                    onAddTrip={(_, tripId) => openAddTripModal(tripId, {})}
                                />
                            ) : (
                                <SingleRouteView
                                    table={activeRoute.north || activeRoute.south!}
                                    originalTable={originalSchedules?.find(t => t.routeName === (activeRoute.north?.routeName || activeRoute.south?.routeName))}
                                    onCellEdit={handleCellEdit}
                                    onRecoveryEdit={handleRecoveryEdit}
                                    onTimeAdjust={handleTimeAdjust}
                                    onDeleteTrip={handleDeleteTrip}
                                    onAddTrip={(_, tripId) => openAddTripModal(tripId, {})}
                                />
                            )
                        )}
                    </div>
                </div>
            </div>

        </>
    );
};
