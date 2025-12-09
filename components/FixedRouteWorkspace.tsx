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
const RouteSummary: React.FC<{ table: MasterRouteTable }> = ({ table }) => {
    const stats = useMemo(() => {
        let totalCycle = 0;
        let totalRec = 0;
        let totalTravel = 0;
        let activeTrips = 0;

        table.trips.forEach(trip => {
            // Only count "Revenue" trips for metrics? Or all?
            // "Master Schedule" usually implies all revenue trips.
            totalCycle += trip.cycleTime || 0;
            totalRec += trip.recoveryTime || 0;
            totalTravel += trip.travelTime || 0;
            activeTrips++;
        });

        // Avoid infinite ratio
        const avgRatio = totalCycle > 0 ? (totalRec / totalCycle) * 100 : 0;

        return { totalCycle, totalRec, totalTravel, activeTrips, avgRatio };
    }, [table]);

    return (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <div className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm text-center">
                <div className="text-gray-400 text-xs font-bold uppercase mb-1">Total Trips</div>
                <div className="text-2xl font-black text-gray-800">{stats.activeTrips}</div>
            </div>
            <div className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm text-center">
                <div className="text-gray-400 text-xs font-bold uppercase mb-1">Rev. Hours</div>
                <div className="text-2xl font-black text-brand-blue">{(stats.totalTravel / 60).toFixed(1)}h</div>
            </div>
            <div className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm text-center">
                <div className="text-gray-400 text-xs font-bold uppercase mb-1">Recovery</div>
                <div className="text-2xl font-black text-orange-500">{(stats.totalRec / 60).toFixed(1)}h</div>
            </div>
            <div className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm text-center">
                <div className="text-gray-400 text-xs font-bold uppercase mb-1">Avg Rec. Ratio</div>
                <div className={`text-2xl font-black ${stats.avgRatio < 10 ? 'text-red-500' : 'text-brand-green'}`}>
                    {stats.avgRatio.toFixed(1)}%
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
    const handleFile = async (file: File) => {
        if (!user) {
            alert("Please sign in to save and manage schedules.");
            return;
        }

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
            const tables = parseMasterSchedule(buffer);
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
            const tables = parseMasterSchedule(buffer);
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
            <div className="max-w-4xl mx-auto mt-12 animate-in fade-in slide-in-from-bottom-4 duration-500">
                <div className="text-center mb-10">
                    <h2 className="text-4xl font-extrabold text-gray-800 mb-3">Master Schedule Management</h2>
                    <p className="text-gray-500 font-medium text-lg">Upload a new master schedule or load a previous version to begin tweaking.</p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-start">
                    {/* Upload Column */}
                    <div className="bg-white p-8 rounded-3xl border-2 border-dashed border-gray-200 hover:border-brand-green transition-colors">
                        <div className="mb-6 text-center">
                            <div className="bg-green-50 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 text-brand-green">
                                <Plus size={32} />
                            </div>
                            <h3 className="text-xl font-bold text-gray-800">Upload New</h3>
                            <p className="text-sm text-gray-400 mt-1">Parses .xlsx Master Files</p>
                        </div>

                        {isProcessing ? (
                            <div className="flex flex-col items-center animate-pulse py-12">
                                <Loader2 className="animate-spin text-brand-green mb-4" size={48} />
                                <h2 className="text-xl font-bold text-gray-700">Processing Schedule...</h2>
                            </div>
                        ) : (
                            <FileUpload
                                onFileUpload={handleFile}
                                title="Drop Master Schedule"
                                subtitle="Supports .xlsx only"
                                accept=".xlsx"
                                allowMultiple={false}
                            />
                        )}
                    </div>

                    {/* Saved Files Column */}
                    <div className="bg-white p-8 rounded-3xl border border-gray-100 shadow-sm h-full max-h-[500px] flex flex-col">
                        <div className="flex items-center gap-3 mb-6">
                            <div className="bg-blue-50 w-12 h-12 rounded-xl flex items-center justify-center text-brand-blue">
                                <FileSpreadsheet size={24} />
                            </div>
                            <div>
                                <h3 className="text-xl font-bold text-gray-800">Saved Schedules</h3>
                                <p className="text-xs font-bold text-gray-400 uppercase tracking-wider">Cloud Storage</p>
                            </div>
                        </div>

                        <div className="flex-grow overflow-y-auto custom-scrollbar space-y-3 pr-2">
                            {user ? (
                                savedFiles.length === 0 ? (
                                    <div className="text-center py-10 text-gray-400">
                                        <p className="text-sm">No saved schedules found.</p>
                                    </div>
                                ) : (
                                    savedFiles.map(file => (
                                        <button
                                            key={file.id}
                                            onClick={() => handleLoadSavedFile(file)}
                                            disabled={isProcessing}
                                            className="w-full text-left p-4 rounded-xl border border-gray-100 hover:border-brand-blue hover:bg-blue-50 transition-all group"
                                        >
                                            <div className="flex justify-between items-start mb-1">
                                                <h4 className="font-bold text-gray-700 group-hover:text-brand-blue">{file.name}</h4>
                                                <span className="text-[10px] font-bold bg-gray-100 text-gray-500 px-2 py-1 rounded-full uppercase">
                                                    {(file.size / 1024).toFixed(0)} KB
                                                </span>
                                            </div>
                                            <div className="flex items-center gap-2 text-xs text-gray-400 font-medium">
                                                <CalendarPlus size={12} />
                                                <span>{new Date(file.uploadedAt).toLocaleDateString()}</span>
                                                <span className="text-gray-300">•</span>
                                                <span>{new Date(file.uploadedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                                            </div>
                                        </button>
                                    ))
                                )
                            ) : (
                                <div className="text-center py-10 bg-gray-50 rounded-xl border-dashed border-2 border-gray-200">
                                    <p className="text-sm font-bold text-gray-500 mb-2">Sign in to view saved schedules.</p>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    const table = schedules[activeSheetIdx];

    return (
        <div className="h-full flex flex-col animate-in fade-in">
            {/* Header */}
            <div className="flex justify-between items-center mb-6">
                <div className="flex items-center gap-4">
                    <button onClick={() => setEditorMode(false)} className="bg-gray-100 p-2 rounded-full hover:bg-gray-200">
                        <ArrowLeft size={20} /> Back to Upload
                    </button>
                    <div>
                        <h2 className="text-2xl font-extrabold text-gray-800">Route {table.routeName}</h2>
                        <div className="flex gap-2 mt-1">
                            {schedules.map((s, i) => (
                                <button
                                    key={s.routeName}
                                    onClick={() => setActiveSheetIdx(i)}
                                    className={`text-xs font-bold px-2 py-1 rounded ${i === activeSheetIdx ? 'bg-black text-white' : 'bg-gray-100 text-gray-500'}`}
                                >
                                    {s.routeName}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>

                <button
                    onClick={handleExport}
                    className="flex items-center gap-2 bg-brand-green text-white px-4 py-2 rounded-xl font-bold shadow-lg shadow-green-900/10 hover:shadow-xl transition-all active:scale-95"
                >
                    <Download size={18} /> Export Excel
                </button>
            </div>

            <RouteSummary table={table} />

            {/* Grid */}
            <div className="bg-white border border-gray-200 rounded-2xl shadow-sm flex-grow overflow-hidden flex flex-col">
                <div className="overflow-auto custom-scrollbar flex-grow">
                    <table className="w-full text-left border-collapse relative">
                        <thead className="sticky top-0 z-20 shadow-sm">
                            <tr className="bg-gray-50 text-gray-500 text-xs font-extrabold uppercase tracking-wider">
                                <th className="p-3 border-b sticky left-0 bg-gray-50 z-30 min-w-[80px]">Block</th>
                                <th className="p-3 border-b min-w-[80px]">Dir</th>
                                {table.stops.map(stop => (
                                    <th key={stop} className="p-3 border-b min-w-[100px] whitespace-nowrap">{stop}</th>
                                ))}
                                <th className="p-3 border-b text-center bg-orange-50 text-orange-600">Recovery</th>
                                <th className="p-3 border-b text-center bg-blue-50 text-blue-600">Cycle</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {table.trips.map(trip => (
                                <tr key={trip.id} className={`hover:bg-blue-50/50 transition-colors group ${trip.isOverlap ? 'bg-red-50' : ''}`}>
                                    <td className={`p-3 sticky left-0 group-hover:bg-blue-50/50 z-10 font-black ${trip.isOverlap ? 'bg-red-50 text-red-600' : 'bg-white text-gray-700'}`}>
                                        {trip.blockId}
                                        {trip.isOverlap && <AlertCircle size={14} className="inline ml-1 text-red-500" />}
                                    </td>
                                    <td className="p-3 font-bold text-gray-400 text-xs">
                                        <span className={`px-2 py-1 rounded-full ${trip.direction === 'North' ? 'bg-blue-100 text-blue-600' : 'bg-purple-100 text-purple-600'}`}>
                                            {trip.direction}
                                        </span>
                                    </td>
                                    {table.stops.map(stop => (
                                        <td key={stop} className="p-3 relative">
                                            <input
                                                type="text"
                                                value={trip.stops[stop] || ''}
                                                onChange={(e) => handleCellEdit(trip.id, stop, e.target.value)}
                                                className="w-full bg-transparent font-medium text-gray-700 text-sm focus:outline-none focus:text-brand-blue focus:font-bold"
                                            />
                                        </td>
                                    ))}
                                    <td className={`p-3 font-bold text-center ${trip.recoveryTime < 0 ? 'bg-red-100 text-red-600' : (trip.isTightRecovery ? 'bg-orange-100 text-orange-600' : 'text-orange-500')}`}>
                                        {trip.recoveryTime}
                                    </td>
                                    <td className="p-3 font-bold text-center text-blue-500 border-l border-dashed border-gray-100">
                                        {trip.cycleTime}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
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
            <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
                <div className="text-center mb-12 mt-4">
                    <h2 className="text-3xl font-extrabold text-gray-800 mb-2">Fixed Route Operations</h2>
                    <p className="text-gray-500 font-bold">Manage schedules, analyze performance, and optimize routes.</p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-5xl mx-auto">

                    {/* 1. Schedule Tweak */}
                    <button
                        onClick={() => setViewMode('schedule')}
                        className="group bg-white p-8 rounded-3xl border-b-8 border-gray-200 hover:border-brand-blue hover:-translate-y-1 transition-all text-left flex flex-col h-full"
                    >
                        <div className="bg-blue-50 w-14 h-14 rounded-2xl flex items-center justify-center text-brand-blue mb-6 group-hover:scale-110 transition-transform">
                            <Settings2 size={28} />
                        </div>
                        <h3 className="text-xl font-extrabold text-gray-800 mb-2">Schedule Tweak</h3>
                        <p className="text-gray-500 font-bold text-sm mb-6 flex-grow">
                            Adjust existing timetables, modify timepoints, and manage blocks for active routes.
                        </p>
                        <div className="flex items-center gap-2 text-brand-blue font-extrabold uppercase tracking-wide text-xs">
                            Open Tool <ArrowRight size={14} />
                        </div>
                    </button>

                    {/* 2. New Schedules */}
                    <button
                        onClick={() => setViewMode('new-schedule')}
                        className="group bg-white p-8 rounded-3xl border-b-8 border-gray-200 hover:border-brand-green hover:-translate-y-1 transition-all text-left flex flex-col h-full"
                    >
                        <div className="bg-green-50 w-14 h-14 rounded-2xl flex items-center justify-center text-brand-green mb-6 group-hover:scale-110 transition-transform">
                            <CalendarPlus size={28} />
                        </div>
                        <h3 className="text-xl font-extrabold text-gray-800 mb-2">New Schedules</h3>
                        <p className="text-gray-500 font-bold text-sm mb-6 flex-grow">
                            Build new route schedules from scratch with AI-assisted blocking and run-cutting.
                        </p>
                        <div className="flex items-center gap-2 text-brand-green font-extrabold uppercase tracking-wide text-xs">
                            Create New <ArrowRight size={14} />
                        </div>
                    </button>

                    {/* 3. Dwell Assessment */}
                    <button
                        onClick={() => setViewMode('dwell')}
                        className="group bg-white p-8 rounded-3xl border-b-8 border-gray-200 hover:border-brand-yellow hover:-translate-y-1 transition-all text-left flex flex-col h-full"
                    >
                        <div className="bg-yellow-50 w-14 h-14 rounded-2xl flex items-center justify-center text-brand-yellow mb-6 group-hover:scale-110 transition-transform">
                            <Timer size={28} />
                        </div>
                        <h3 className="text-xl font-extrabold text-gray-800 mb-2">Dwell Assessment</h3>
                        <p className="text-gray-500 font-bold text-sm mb-6 flex-grow">
                            Analyze stop-level dwell times to identify bottlenecks and optimize recovery time.
                        </p>
                        <div className="flex items-center gap-2 text-brand-yellow font-extrabold uppercase tracking-wide text-xs">
                            Analyze Dwell <ArrowRight size={14} />
                        </div>
                    </button>

                    {/* 4. OTP Assessment */}
                    <button
                        onClick={() => setViewMode('otp')}
                        className="group bg-white p-8 rounded-3xl border-b-8 border-gray-200 hover:border-brand-red hover:-translate-y-1 transition-all text-left flex flex-col h-full"
                    >
                        <div className="bg-red-50 w-14 h-14 rounded-2xl flex items-center justify-center text-brand-red mb-6 group-hover:scale-110 transition-transform">
                            <BarChart2 size={28} />
                        </div>
                        <h3 className="text-xl font-extrabold text-gray-800 mb-2">OTP Assessment</h3>
                        <p className="text-gray-500 font-bold text-sm mb-6 flex-grow">
                            Monitor On-Time Performance, track schedule adherence, and identify late routes.
                        </p>
                        <div className="flex items-center gap-2 text-brand-red font-extrabold uppercase tracking-wide text-xs">
                            View Report <ArrowRight size={14} />
                        </div>
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

            {/* Content Area */}
            <div className="flex-grow overflow-hidden bg-white rounded-3xl border-2 border-gray-100 shadow-sm relative min-h-[600px]">
                <div className="absolute inset-0 overflow-auto custom-scrollbar p-6">
                    {renderContent()}
                </div>
            </div>
        </div>
    );
};
