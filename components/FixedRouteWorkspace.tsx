import React, { useState, useRef, useMemo } from 'react';
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
    ChevronRight,
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
    FileText
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { FileUpload } from './FileUpload';
import { parseMasterSchedule, MasterRouteTable, MasterTrip, validateRouteTable } from '../utils/masterScheduleParser';
import { OTPAnalysis } from './OTPAnalysis';
import { useAuth } from './AuthContext';
import { getAllFiles, uploadFile, downloadFileArrayBuffer, SavedFile } from '../utils/dataService';

// --- Sub-Components ---

// --- Utils ---
const TimeUtils = {
    toMinutes: (timeStr: string): number | null => {
        if (!timeStr) return null;
        if (typeof timeStr === 'number') return Math.round(timeStr * 1440);
        const normalized = String(timeStr).toLowerCase().trim();
        if (!normalized.includes(':') && !isNaN(Number(normalized))) return Number(normalized);
        let [hStr, mStr] = normalized.split(':');
        if (!mStr) return null;
        let m = parseInt(mStr.replace(/\D+$/g, ''));
        let h = parseInt(hStr);
        if (normalized.includes('pm') && h !== 12) h += 12;
        if (normalized.includes('am') && h === 12) h = 0;
        return (h * 60) + m;
    },
    fromMinutes: (totalMinutes: number): string => {
        let h = Math.floor(totalMinutes / 60);
        const m = Math.round(totalMinutes % 60);
        if (m === 60) { h++; }
        const period = h >= 12 && h < 24 ? 'PM' : 'AM';
        if (h > 12) h -= 12;
        if (h === 0 || h === 24) h = 12;
        if (h > 24) h -= 24;
        return `${h}:${(m % 60).toString().padStart(2, '0')} ${period}`;
    },
    addMinutes: (timeStr: string, minutes: number): string => {
        const m = TimeUtils.toMinutes(timeStr);
        if (m === null) return timeStr;
        return TimeUtils.fromMinutes(m + minutes);
    }
};

// 0. Route Summary (Updated for MasterTable)
// 0. Route Summary (Enterprise Strip)
const RouteSummary: React.FC<{ table: MasterRouteTable }> = ({ table }) => {
    const stats = useMemo(() => {
        let totalCycle = 0;
        let totalRec = 0;
        let totalTravel = 0;
        let activeTrips = 0;

        table.trips.forEach(trip => {
            totalCycle += trip.cycleTime || 0;
            totalRec += trip.recoveryTime || 0;
            totalTravel += trip.travelTime || 0;
            activeTrips++;
        });

        const avgRatio = totalCycle > 0 ? (totalRec / totalCycle) * 100 : 0;
        return { totalCycle, totalRec, totalTravel, activeTrips, avgRatio };
    }, [table]);

    return (
        <div className="bg-white rounded-lg border border-gray-200 shadow-sm mb-6 flex divide-x divide-gray-100">
            <div className="px-6 py-4 flex-1">
                <div className="text-gray-500 text-[10px] font-bold uppercase tracking-widest mb-1">Total Trips</div>
                <div className="text-2xl font-bold text-gray-900">{stats.activeTrips}</div>
            </div>
            <div className="px-6 py-4 flex-1">
                <div className="text-gray-500 text-[10px] font-bold uppercase tracking-widest mb-1">Revenue Hours</div>
                <div className="text-2xl font-bold text-gray-900">{(stats.totalTravel / 60).toFixed(1)}<span className="text-sm font-medium text-gray-400 ml-1">hrs</span></div>
            </div>
            <div className="px-6 py-4 flex-1">
                <div className="text-gray-500 text-[10px] font-bold uppercase tracking-widest mb-1">Recovery</div>
                <div className="text-2xl font-bold text-gray-900">{(stats.totalRec / 60).toFixed(1)}<span className="text-sm font-medium text-gray-400 ml-1">hrs</span></div>
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

// 1. Tweak Schedule (Main)
const TweakSchedule: React.FC = () => {
    const { user } = useAuth();
    const [schedules, setSchedules] = useState<MasterRouteTable[]>([]);
    const [activeSheetIdx, setActiveSheetIdx] = useState(0);
    const [editorMode, setEditorMode] = useState(false);
    const [isProcessing, setIsProcessing] = useState(false);
    const [savedFiles, setSavedFiles] = useState<SavedFile[]>([]);

    // Load saved files
    React.useEffect(() => {
        if (user) loadSavedFiles();
    }, [user]);

    const loadSavedFiles = async () => {
        if (!user) return;
        try {
            const files = await getAllFiles(user.uid);
            setSavedFiles(files.filter(f => f.type === 'schedule_master'));
        } catch (error) {
            console.error("Failed to load saved files:", error);
        }
    };

    // File Upload Handler with Prompt
    const handleFile = async (files: File[]) => {
        if (!user) {
            alert("Please sign in to save and manage schedules.");
            return;
        }

        if (!files || files.length === 0) return;
        const file = files[0];

        const defaultName = file.name.replace('.xlsx', '');
        const name = window.prompt("Enter a name for this Master Schedule (e.g., 'August 2025'):", defaultName);
        if (!name) return;

        setIsProcessing(true);
        try {
            // Upload with custom name by renaming file
            const renamedFile = new File([file], name + ".xlsx", { type: file.type });
            await uploadFile(user.uid, renamedFile, 'schedule_master');
            await loadSavedFiles();

            // Parse
            const buffer = await file.arrayBuffer();
            const tables = parseMasterSchedule(buffer, 'fixed');
            setSchedules(tables);

            if (tables.length > 0) {
                setEditorMode(true);
                setActiveSheetIdx(0);
            } else {
                alert("No valid numeric sheets found (e.g. '400', '8').");
            }
        } catch (err) {
            console.error(err);
            alert("Failed to process file.");
        }
        setIsProcessing(false);
    };

    const handleLoadSavedFile = async (file: SavedFile) => {
        setIsProcessing(true);
        try {
            const buffer = await downloadFileArrayBuffer(file.downloadUrl);
            const tables = parseMasterSchedule(buffer, 'fixed');
            setSchedules(tables);

            if (tables.length > 0) {
                setEditorMode(true);
                setActiveSheetIdx(0);
            } else {
                alert("No valid numeric sheets found in saved file.");
            }
        } catch (err) {
            console.error(err);
            alert("Failed to load saved file.");
        }
        setIsProcessing(false);
    };

    const recalculateTrip = (trip: MasterTrip, cols: string[]) => {
        let start: number | null = null;
        let end: number | null = null;

        // Scan stops to find min/max
        cols.forEach(col => {
            const val = trip.stops[col];
            if (!val) return;
            const m = TimeUtils.toMinutes(val);
            if (m !== null) {
                if (start === null || m < start) start = m; // Logic: First stop is start? Or min? usually first.
                // Actually bus times always increase. First valid time is start.
                // We should iterate in order.
            }
        });

        // Re-scan in order to be safe
        start = null;
        end = null;
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
            trip.travelTime = end - start;
            trip.cycleTime = trip.travelTime + trip.recoveryTime;
        }
    };

    const handleCellEdit = (tripId: string, col: string, val: string) => {
        const newScheds = [...schedules];
        const table = newScheds[activeSheetIdx];
        const trip = table.trips.find(t => t.id === tripId);

        if (!trip) return;

        // 1. Update Cell
        const oldEndTime = trip.endTime;
        trip.stops[col] = val;

        // 2. Recalculate this trip's times
        recalculateTrip(trip, table.stops);

        const newEndTime = trip.endTime;
        const delta = newEndTime - oldEndTime;

        // 3. Ripple if End Time changed
        if (delta !== 0) {
            // Find subsequent trips in block
            const blockTrips = table.trips.filter(t => t.blockId === trip.blockId).sort((a, b) => a.tripNumber - b.tripNumber);
            const startIdx = blockTrips.findIndex(t => t.id === trip.id);

            if (startIdx !== -1) {
                for (let i = startIdx + 1; i < blockTrips.length; i++) {
                    const nextTrip = blockTrips[i];

                    // Shift entire trip by delta
                    table.stops.forEach(s => {
                        const t = nextTrip.stops[s];
                        if (t) {
                            nextTrip.stops[s] = TimeUtils.addMinutes(t, delta);
                        }
                    });

                    recalculateTrip(nextTrip, table.stops);
                    // Cycle continues automatically because we updated stops -> recalculated metrics
                }
            }
        }

        // 4. Validate Table (Safety Check)
        validateRouteTable(table);

        setSchedules(newScheds);
    };

    const handleDeleteTrip = (tripId: string) => {
        if (!confirm("Are you sure you want to delete this trip?")) return;
        const newScheds = [...schedules];
        const table = newScheds[activeSheetIdx];
        table.trips = table.trips.filter(t => t.id !== tripId);
        validateRouteTable(table);
        setSchedules(newScheds);
    };

    const handleExport = () => {
        if (schedules.length === 0) return;
        const wb = XLSX.utils.book_new();

        schedules.forEach(table => {
            const wsData: (string | number)[][] = [];

            // Header: Block | Dir | Start Time | ... | End Time | Recovery
            const header = ['Block', 'Dir', ...table.stops, 'Recovery'];
            wsData.push(header);

            table.trips.forEach(trip => {
                const row = [
                    trip.blockId,
                    trip.direction,
                    ...table.stops.map(s => trip.stops[s] || ''),
                    trip.recoveryTime
                ];
                wsData.push(row);
            });

            const ws = XLSX.utils.aoa_to_sheet(wsData);
            XLSX.utils.book_append_sheet(wb, ws, table.routeName);
        });

        XLSX.writeFile(wb, "Modified_Master_Schedule.xlsx");
    };

    if (!editorMode) {
        return (
            <div className="h-full overflow-y-auto custom-scrollbar">
                <div className="max-w-6xl mx-auto mt-8 animate-in fade-in slide-in-from-bottom-2 duration-500 px-6 pb-12">
                    <div className="flex items-center justify-between mb-8">
                        <div>
                            <h2 className="text-2xl font-bold text-gray-900 tracking-tight">Schedule Manager</h2>
                            <p className="text-gray-500 text-sm mt-1">Upload a master schedule file or load a saved version.</p>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-start">
                        {/* Upload Column */}
                        <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm col-span-1 lg:col-span-2">
                            <div className="flex items-center gap-3 mb-6">
                                <div className="bg-gray-100 p-2 rounded-lg text-gray-600">
                                    <Plus size={20} />
                                </div>
                                <h3 className="font-bold text-gray-900">Upload New Schedule</h3>
                            </div>

                            {isProcessing ? (
                                <div className="flex flex-col items-center justify-center py-16 border-2 border-dashed border-gray-100 rounded-xl bg-gray-50/50">
                                    <Loader2 className="animate-spin text-blue-600 mb-4" size={32} />
                                    <h2 className="text-sm font-semibold text-gray-900">Processing File...</h2>
                                    <p className="text-xs text-gray-500">Parsing blocks, trips, and stops.</p>
                                </div>
                            ) : (
                                <div className="h-64">
                                    <FileUpload
                                        onFileUpload={handleFile}
                                        title="Drop Master Schedule (.xlsx)"
                                        subtitle="Auto-detects routes and blocks"
                                        accept=".xlsx"
                                        allowMultiple={false}
                                    />
                                </div>
                            )}

                            <div className="mt-4 bg-blue-50 border border-blue-100 rounded-lg p-4 flex gap-3">
                                <Sparkles size={18} className="text-blue-600 flex-shrink-0 mt-0.5" />
                                <div className="text-xs text-blue-800">
                                    <span className="font-bold">Pro Tip:</span> Ensure your Excel file has sheets named by route number (e.g., "400", "8A") for automatic detection.
                                </div>
                            </div>
                        </div>

                        {/* Saved Files Column */}
                        <div className="bg-white p-0 rounded-xl border border-gray-200 shadow-sm h-full max-h-[500px] flex flex-col overflow-hidden">
                            <div className="p-4 border-b border-gray-100 bg-gray-50/50 flex justify-between items-center">
                                <h3 className="font-bold text-gray-900 text-sm">Recent Files</h3>
                                <span className="bg-gray-200 text-gray-600 text-[10px] font-bold px-2 py-0.5 rounded-full">{savedFiles.length}</span>
                            </div>

                            <div className="flex-grow overflow-y-auto custom-scrollbar p-2 space-y-1">
                                {user ? (
                                    savedFiles.length === 0 ? (
                                        <div className="text-center py-12 text-gray-400">
                                            <FileSpreadsheet className="mx-auto mb-2 opacity-20" size={32} />
                                            <p className="text-xs">No saved schedules.</p>
                                        </div>
                                    ) : (
                                        savedFiles.map(file => (
                                            <button
                                                key={file.id}
                                                onClick={() => handleLoadSavedFile(file)}
                                                disabled={isProcessing}
                                                className="w-full text-left p-3 rounded-lg border border-transparent hover:bg-gray-50 hover:border-gray-100 transition-all group flex items-center gap-3"
                                            >
                                                <div className="bg-green-50 text-green-600 w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0">
                                                    <FileSpreadsheet size={16} />
                                                </div>
                                                <div className="flex-grow min-w-0">
                                                    <h4 className="font-medium text-gray-900 text-sm truncate group-hover:text-blue-600 transition-colors">{file.name}</h4>
                                                    <div className="flex items-center gap-2 text-[10px] text-gray-400">
                                                        <span>{new Date(file.uploadedAt).toLocaleDateString()}</span>
                                                        <span>•</span>
                                                        <span>{(file.size / 1024).toFixed(0)} KB</span>
                                                    </div>
                                                </div>
                                                <ChevronRight size={14} className="text-gray-300 opacity-0 group-hover:opacity-100 transition-opacity" />
                                            </button>
                                        ))
                                    )
                                ) : (
                                    <div className="p-4 text-center">
                                        <p className="text-xs text-gray-500">Sign in to view saved files.</p>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    const table = schedules[activeSheetIdx];

    // Safety fallback if state is inconsistent
    if (!table) {
        setEditorMode(false);
        return null;
    }

    return (
        <div className="h-full flex flex-col animate-in fade-in bg-gray-50/50">
            {/* Header Section */}
            <div className="bg-white border-b border-gray-200 px-6 py-4">
                <div className="flex justify-between items-start mb-4">
                    <div className="flex flex-col gap-1">
                        <div className="flex items-center gap-2 text-xs font-medium text-gray-500">
                            <button onClick={() => setEditorMode(false)} className="hover:text-gray-900 transition-colors">Dashboard</button>
                            <ChevronRight size={12} />
                            <span>Schedule Tweaker</span>
                            <ChevronRight size={12} />
                            <span className="text-gray-900 font-semibold">{table.routeName}</span>
                        </div>
                        <h2 className="text-2xl font-bold text-gray-900 tracking-tight">Route {table.routeName}</h2>
                    </div>

                    <div className="flex items-center gap-3">
                        <button
                            onClick={handleExport}
                            className="flex items-center gap-2 bg-emerald-600 text-white px-4 py-2 rounded-lg text-sm font-semibold shadow-sm hover:bg-emerald-700 transition-all border border-transparent"
                        >
                            <Download size={16} /> Export Excel
                        </button>
                    </div>
                </div>

                <div className="flex overflow-x-auto gap-4 pb-0 scrollbar-hide border-b border-gray-100">
                    {schedules.map((s, i) => {
                        const isActive = i === activeSheetIdx;
                        return (
                            <button
                                key={s.routeName}
                                onClick={() => setActiveSheetIdx(i)}
                                className={`
                                    px-4 py-3 text-sm font-bold transition-all whitespace-nowrap border-b-2
                                    ${isActive
                                        ? 'border-brand-blue text-brand-blue'
                                        : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                                    }
                                `}
                            >
                                Route {s.routeName}
                            </button>
                        );
                    })}
                </div>
            </div>

            {/* Main Content */}
            <div className="p-6 flex-grow overflow-hidden flex flex-col">
                <RouteSummary table={table} />

                {/* Data Grid */}
                <div className="bg-white border border-gray-200 rounded-lg shadow-sm flex-grow overflow-hidden flex flex-col mt-4 relative z-0">
                    <div className="overflow-auto custom-scrollbar flex-grow relative">
                        <table className="min-w-full text-left border-collapse">
                            <thead className="sticky top-0 z-40 bg-gray-50 shadow-sm">
                                <tr>
                                    <th className="p-3 border-b border-gray-200 bg-gray-50 sticky left-0 z-30 min-w-[80px] text-xs font-semibold text-gray-500 uppercase tracking-wider">Block</th>
                                    <th className="p-3 border-b border-gray-200 min-w-[80px] text-xs font-semibold text-gray-500 uppercase tracking-wider">Dir</th>
                                    {table.stops.map(stop => (
                                        <th key={stop} className="p-3 border-b border-gray-200 min-w-[100px] whitespace-nowrap text-xs font-semibold text-gray-500 uppercase tracking-wider">{stop}</th>
                                    ))}
                                    <th className="p-3 border-b border-gray-200 text-center text-xs font-semibold text-gray-500 uppercase tracking-wider w-24">Recovery</th>
                                    <th className="p-3 border-b border-gray-200 text-center text-xs font-semibold text-gray-500 uppercase tracking-wider w-24">Cycle</th>
                                    <th className="p-3 border-b border-gray-200 w-10"></th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                                {table.trips.map((trip, idx) => {
                                    const isNewBlock = idx > 0 && trip.blockId !== table.trips[idx - 1].blockId;
                                    return (
                                        <tr key={trip.id} className={`group transition-colors ${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'} hover:bg-blue-50/30 ${isNewBlock ? 'border-t-4 border-gray-100' : ''}`}>
                                            <td className="p-3 border-r border-gray-100 sticky left-0 bg-white group-hover:bg-blue-50/10 z-30 font-mono text-sm font-bold text-gray-900 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.05)] text-center min-w-[80px]">
                                                {trip.blockId}
                                                {trip.isOverlap && <AlertCircle size={14} className="inline ml-1 text-red-500" />}
                                            </td>
                                            <td className="p-3 text-xs">
                                                <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${trip.direction === 'North'
                                                    ? 'bg-blue-50 text-blue-700 border border-blue-100'
                                                    : 'bg-indigo-50 text-indigo-700 border border-indigo-100'
                                                    }`}>
                                                    {trip.direction}
                                                </span>
                                            </td>
                                            {table.stops.map(stop => (
                                                <td key={stop} className="p-0 relative border-r border-transparent hover:border-gray-200">
                                                    <div className="relative w-full h-full p-3">
                                                        <input
                                                            type="text"
                                                            value={trip.stops[stop] || ''}
                                                            onChange={(e) => handleCellEdit(trip.id, stop, e.target.value)}
                                                            className={`w-full h-full bg-transparent font-mono text-sm focus:outline-none rounded hover:bg-gray-100/50 -m-1 p-1 transition-all focus:bg-white focus:ring-2 focus:ring-blue-500/20 ${!trip.stops[stop] ? 'text-gray-300 italic' : 'text-gray-700 font-medium'}`}
                                                            placeholder="—"
                                                        />
                                                    </div>
                                                </td>
                                            ))}
                                            {/* Metrics Columns */}
                                            <td className="p-3 text-center">
                                                <span className={`inline-block px-2 py-1 rounded text-xs font-bold ${trip.recoveryTime < 0
                                                    ? 'bg-red-50 text-red-600 border border-red-100'
                                                    : (trip.isTightRecovery
                                                        ? 'bg-amber-50 text-amber-600 border border-amber-100'
                                                        : 'text-emerald-600 bg-emerald-50 border border-emerald-100')
                                                    }`}>
                                                    {trip.recoveryTime}m
                                                </span>
                                            </td>
                                            <td className="p-3 text-center text-sm font-medium text-gray-500 font-mono">
                                                {trip.cycleTime}
                                            </td>
                                            <td className="p-3 text-center">
                                                <button
                                                    onClick={() => handleDeleteTrip(trip.id)}
                                                    className="text-gray-300 hover:text-red-600 transition-colors p-1 rounded-md hover:bg-red-50 opacity-0 group-hover:opacity-100"
                                                    title="Delete Trip"
                                                >
                                                    <Trash2 size={16} />
                                                </button>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                    {/* Table Footer / Visual Balance */}
                    <div className="bg-gray-50 border-t border-gray-200 px-4 py-2 text-[10px] text-gray-400 uppercase font-medium flex justify-between">
                        <span>{table.trips.length} Trips Loaded</span>
                        <span>Editable Mode Active</span>
                    </div>
                </div>
            </div>
        </div>
    );
};

// 2. New Schedule Component (Placeholder)
const NewSchedule: React.FC = () => {
    return (
        <div className="flex flex-col items-center justify-center h-96 space-y-6 animate-in fade-in duration-500">
            <div className="bg-blue-50 p-8 rounded-full">
                <CalendarPlus size={64} className="text-brand-blue" />
            </div>
            <div className="text-center space-y-2">
                <h3 className="text-2xl font-extrabold text-gray-800">New Schedule Builder</h3>
                <p className="text-gray-500 font-bold max-w-md">Create brand new schedules from scratch using AI-assisted block generation.</p>
                <div className="inline-block bg-gray-100 text-gray-500 text-xs font-black px-3 py-1 rounded-full uppercase tracking-wider mt-4">
                    Coming Soon
                </div>
            </div>
        </div>
    );
};

// 3. Dwell Assessment Component (Placeholder)
const DwellAssessment: React.FC = () => {
    return (
        <div className="flex flex-col items-center justify-center h-96 space-y-6 animate-in fade-in duration-500">
            <div className="bg-orange-50 p-8 rounded-full">
                <Timer size={64} className="text-orange-500" />
            </div>
            <div className="text-center space-y-2">
                <h3 className="text-2xl font-extrabold text-gray-800">Dwell Time Analysis</h3>
                <p className="text-gray-500 font-bold max-w-md">Analyze stop-level dwell times to optimize schedule padding and improve on-time performance.</p>
                <div className="inline-block bg-gray-100 text-gray-500 text-xs font-black px-3 py-1 rounded-full uppercase tracking-wider mt-4">
                    Coming Soon
                </div>
            </div>
        </div>
    );
};

export const FixedRouteWorkspace: React.FC = () => {
    const [viewMode, setViewMode] = useState<'dashboard' | 'schedule' | 'new-schedule' | 'dwell' | 'otp'>('dashboard');

    const renderContent = () => {
        switch (viewMode) {
            case 'schedule': return <TweakSchedule />;
            case 'new-schedule': return <NewSchedule />;
            case 'dwell': return <DwellAssessment />;
            case 'otp': return <OTPAnalysis />;
            default: return null;
        }
    };

    if (viewMode === 'dashboard') {
        return (
            <div className="animate-in fade-in slide-in-from-bottom-2 duration-500 max-w-6xl mx-auto pt-8">
                <div className="mb-8 px-4">
                    <h2 className="text-2xl font-bold text-gray-900 tracking-tight mb-2">Fixed Route Operations</h2>
                    <p className="text-gray-500">Select a tool to manage schedules or analyze performance.</p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 px-4">

                    {/* 1. Schedule Tweak */}
                    <button
                        onClick={() => setViewMode('schedule')}
                        className="group bg-white p-6 rounded-xl border border-gray-200 shadow-sm hover:shadow-md hover:border-blue-300 transition-all text-left flex flex-col h-full active:scale-[0.99]"
                    >
                        <div className="flex items-center justify-between mb-4">
                            <div className="bg-blue-50/50 p-2.5 rounded-lg text-blue-600 group-hover:bg-blue-100 transition-colors">
                                <Settings2 size={20} />
                            </div>
                            <ArrowRight size={16} className="text-gray-300 group-hover:text-blue-500 transition-colors" />
                        </div>
                        <h3 className="text-lg font-bold text-gray-900 mb-1">Schedule Tweaker</h3>
                        <p className="text-sm text-gray-500 leading-relaxed">
                            Fine-tune master schedules, adjust timepoints, and manage block recovery times.
                        </p>
                    </button>

                    {/* 2. New Schedules */}
                    <button
                        onClick={() => setViewMode('new-schedule')}
                        className="group bg-white p-6 rounded-xl border border-gray-200 shadow-sm hover:shadow-md hover:border-emerald-300 transition-all text-left flex flex-col h-full active:scale-[0.99]"
                    >
                        <div className="flex items-center justify-between mb-4">
                            <div className="bg-emerald-50/50 p-2.5 rounded-lg text-emerald-600 group-hover:bg-emerald-100 transition-colors">
                                <CalendarPlus size={20} />
                            </div>
                            <ArrowRight size={16} className="text-gray-300 group-hover:text-emerald-500 transition-colors" />
                        </div>
                        <h3 className="text-lg font-bold text-gray-900 mb-1">New Schedules</h3>
                        <p className="text-sm text-gray-500 leading-relaxed">
                            Generate optimized schedules from scratch using AI-powered run cutting.
                        </p>
                    </button>

                    {/* 3. Dwell Assessment */}
                    <button
                        onClick={() => setViewMode('dwell')}
                        className="group bg-white p-6 rounded-xl border border-gray-200 shadow-sm hover:shadow-md hover:border-amber-300 transition-all text-left flex flex-col h-full active:scale-[0.99]"
                    >
                        <div className="flex items-center justify-between mb-4">
                            <div className="bg-amber-50/50 p-2.5 rounded-lg text-amber-600 group-hover:bg-amber-100 transition-colors">
                                <Timer size={20} />
                            </div>
                            <ArrowRight size={16} className="text-gray-300 group-hover:text-amber-500 transition-colors" />
                        </div>
                        <h3 className="text-lg font-bold text-gray-900 mb-1">Dwell Assessment</h3>
                        <p className="text-sm text-gray-500 leading-relaxed">
                            Analyze stop-level dwell times to identify bottlenecks and optimize padding.
                        </p>
                    </button>

                    {/* 4. OTP Assessment */}
                    <button
                        onClick={() => setViewMode('otp')}
                        className="group bg-white p-6 rounded-xl border border-gray-200 shadow-sm hover:shadow-md hover:border-red-300 transition-all text-left flex flex-col h-full active:scale-[0.99]"
                    >
                        <div className="flex items-center justify-between mb-4">
                            <div className="bg-red-50/50 p-2.5 rounded-lg text-red-600 group-hover:bg-red-100 transition-colors">
                                <BarChart2 size={20} />
                            </div>
                            <ArrowRight size={16} className="text-gray-300 group-hover:text-red-500 transition-colors" />
                        </div>
                        <h3 className="text-lg font-bold text-gray-900 mb-1">OTP Analysis</h3>
                        <p className="text-sm text-gray-500 leading-relaxed">
                            Monitor On-Time Performance metrics, track adherence, and flag late routes.
                        </p>
                    </button>

                </div>
            </div>
        );
    }

    return (
        <div className="flex flex-col h-full">
            {/* Navigation Header */}
            <div className="flex items-center gap-4 mb-6 px-4">
                <button
                    onClick={() => setViewMode('dashboard')}
                    className="flex items-center gap-2 text-gray-400 hover:text-gray-600 font-bold transition-colors"
                >
                    <ArrowLeft size={20} /> Back to Dashboard
                </button>
                <div className="h-6 w-px bg-gray-300"></div>
                <div className="text-sm font-bold text-gray-500 uppercase tracking-wider">
                    {viewMode === 'schedule' && 'Schedule Tweaker'}
                    {viewMode === 'new-schedule' && 'New Schedules'}
                    {viewMode === 'dwell' && 'Dwell Assessment'}
                    {viewMode === 'otp' && 'OTP Assessment'}
                </div>
            </div>


            <div className={`flex-grow overflow-hidden relative ${viewMode === 'schedule' ? '' : 'bg-white rounded-3xl border-2 border-gray-100 shadow-sm min-h-[600px]'}`}>
                <div className={`absolute inset-0 ${viewMode === 'schedule' ? '' : 'overflow-auto custom-scrollbar p-6'}`}>
                    {renderContent()}
                </div>
            </div>
        </div>
    );
};
