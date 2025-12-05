
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
    MousePointerClick
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { FileUpload } from './FileUpload';
import { parseScheduleWithGemini, ParsedTable, ParsedTrip } from '../utils/scheduleParser';
import { OTPAnalysis } from './OTPAnalysis';

// --- Types ---

interface Route {
    id: string;
    name: string;
    number: string;
    frequencyPeak: number; // minutes
    frequencyOffPeak: number; // minutes
    busesRequired: number;
    status: 'active' | 'issue' | 'planning';
}

interface RouteSummaryMetrics {
    totalRevenueHours: number; // Hours
    totalCycleTime: number; // Hours
    totalRecoveryTime: number; // Hours
    avgRecoveryRatio: number; // %
    totalTrips: number;
}

// --- Utils ---
const TimeUtils = {
    // Converts "06:30 AM" or "14:30" to minutes from midnight
    toMinutes: (timeStr: string): number | null => {
        if (!timeStr) return null;
        const normalized = timeStr.toLowerCase().trim();

        // Handle Recovery Minutes (e.g. "5" or "10")
        if (!normalized.includes(':') && !isNaN(Number(normalized))) {
            return Number(normalized);
        }

        let [hours, minutesPart] = normalized.split(':');
        if (!minutesPart) return null;

        // Clean minutes part (remove non-digits like " PM")
        let minutes = parseInt(minutesPart.replace(/\D+$/g, ''));
        let h = parseInt(hours);

        if (normalized.includes('pm') && h !== 12) h += 12;
        if (normalized.includes('am') && h === 12) h = 0;

        // Handle raw "14:30" without AM/PM
        if (!normalized.includes('m') && h < 5 && timeStr.includes(':')) {
            // Heuristic: If it's small number but has colon, might be 24h past midnight or early morning
        }

        return (h * 60) + minutes;
    },

    // Converts minutes to "HH:MM AM/PM"
    fromMinutes: (totalMinutes: number): string => {
        let h = Math.floor(totalMinutes / 60);
        const m = totalMinutes % 60;
        const period = h >= 12 && h < 24 ? 'PM' : 'AM';

        if (h > 12) h -= 12;
        if (h === 0 || h === 24) h = 12;
        if (h > 24) h -= 24; // Handle next day spills slightly

        return `${h}:${m.toString().padStart(2, '0')} ${period}`;
    },

    // Add minutes to a time string
    addMinutes: (timeStr: string, minutesToAdd: number): string => {
        const currentMins = TimeUtils.toMinutes(timeStr);
        if (currentMins === null) return timeStr;
        return TimeUtils.fromMinutes(currentMins + minutesToAdd);
    },

    getDifference: (startStr: string, endStr: string): number => {
        const start = TimeUtils.toMinutes(startStr);
        const end = TimeUtils.toMinutes(endStr);
        if (start === null || end === null) return 0;
        return end - start;
    }
};

// --- Sub-Components ---

// 0. Route Summary Dashboard
const RouteSummary: React.FC<{ table: ParsedTable }> = ({ table }) => {
    // Calculate Aggregates
    const stats: RouteSummaryMetrics = useMemo(() => {
        let totalCycle = 0;
        let totalRec = 0;
        let totalTravel = 0;
        let count = 0;

        table.trips.forEach(trip => {
            let start = null;
            let end = null;
            let tripRec = 0;

            table.stops.forEach(stop => {
                const val = trip.times[stop];
                if (!val) return;
                const isRec = stop.toLowerCase().includes('recovery') || stop.toLowerCase().includes('(rec)');
                if (isRec) {
                    tripRec += parseInt(val) || 0;
                } else if (val.includes(':')) {
                    const m = TimeUtils.toMinutes(val);
                    if (m !== null) {
                        if (start === null) start = m;
                        end = m;
                    }
                }
            });

            if (start !== null && end !== null) {
                let cycle = end - start;
                if (cycle < 0) cycle += 1440; // Midnight crossing

                totalCycle += cycle;
                totalTravel += (cycle - tripRec);
                totalRec += tripRec;
                count++;
            }
        });

        return {
            totalRevenueHours: totalTravel / 60,
            totalCycleTime: totalCycle / 60,
            totalRecoveryTime: totalRec / 60,
            avgRecoveryRatio: count > 0 ? (totalRec / totalCycle) * 100 : 0,
            totalTrips: count
        };
    }, [table]);

    return (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <div className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm flex flex-col items-center justify-center text-center">
                <div className="text-gray-400 text-xs font-bold uppercase tracking-wider mb-1">Total Trips</div>
                <div className="text-2xl font-black text-gray-800">{stats.totalTrips}</div>
            </div>
            <div className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm flex flex-col items-center justify-center text-center">
                <div className="text-gray-400 text-xs font-bold uppercase tracking-wider mb-1">Rev. Hours</div>
                <div className="text-2xl font-black text-brand-blue">{stats.totalRevenueHours.toFixed(1)}h</div>
            </div>
            <div className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm flex flex-col items-center justify-center text-center">
                <div className="text-gray-400 text-xs font-bold uppercase tracking-wider mb-1">Recovery</div>
                <div className="text-2xl font-black text-orange-500">{stats.totalRecoveryTime.toFixed(1)}h</div>
            </div>
            <div className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm flex flex-col items-center justify-center text-center">
                <div className="text-gray-400 text-xs font-bold uppercase tracking-wider mb-1">Efficiency</div>
                <div className={`text-2xl font-black ${stats.avgRecoveryRatio > 20 ? 'text-red-500' : 'text-brand-green'}`}>
                    {stats.avgRecoveryRatio.toFixed(1)}%
                </div>
            </div>
        </div>
    );
};

// 1. Tweak Schedule Component (Recreated)
const TweakSchedule: React.FC = () => {
    const [activeSheetName, setActiveSheetName] = useState<string | null>(null);
    const [activeTableIndex, setActiveTableIndex] = useState<number>(0);
    const [allRoutesData, setAllRoutesData] = useState<Record<string, ParsedTable[]>>({});
    const [isParsing, setIsParsing] = useState(false);
    const [parsingProgress, setParsingProgress] = useState<string>("");
    const [editorMode, setEditorMode] = useState(false);
    const [showSheetSelector, setShowSheetSelector] = useState(false);
    const [detectedSheets, setDetectedSheets] = useState<string[]>([]);
    const [selectedSheets, setSelectedSheets] = useState<Set<string>>(new Set());
    const [fileToProcess, setFileToProcess] = useState<File | null>(null);

    const processFile = (file: File) => {
        setFileToProcess(file);
        const reader = new FileReader();
        reader.onload = (e) => {
            const data = new Uint8Array(e.target?.result as ArrayBuffer);
            const workbook = XLSX.read(data, { type: 'array' });
            setDetectedSheets(workbook.SheetNames);
            setShowSheetSelector(true);
        };
        reader.readAsArrayBuffer(file);
    };

    const handleStartParsing = async () => {
        if (!fileToProcess || selectedSheets.size === 0) return;

        setIsParsing(true);
        setParsingProgress("Reading Excel file...");

        try {
            const reader = new FileReader();
            reader.onload = async (e) => {
                const data = new Uint8Array(e.target?.result as ArrayBuffer);
                const workbook = XLSX.read(data, { type: 'array' });

                const newRoutesData: Record<string, ParsedTable[]> = {};

                for (const sheetName of Array.from(selectedSheets)) {
                    setParsingProgress(`Analyzing route: ${sheetName}...`);
                    const worksheet = workbook.Sheets[sheetName];
                    const csv = XLSX.utils.sheet_to_csv(worksheet);

                    const tables = await parseScheduleWithGemini(csv);
                    newRoutesData[sheetName] = tables;
                }

                setAllRoutesData(newRoutesData);
                setActiveSheetName(Array.from(selectedSheets)[0]);
                setEditorMode(true);
                setIsParsing(false);
            };
            reader.readAsArrayBuffer(fileToProcess);
        } catch (error) {
            console.error("Parsing failed", error);
            setIsParsing(false);
            alert("Failed to parse schedule. Please check the file format.");
        }
    };

    const handleSmartAddTrip = () => {
        if (!activeSheetName) return;
        const currentTable = allRoutesData[activeSheetName][activeTableIndex];
        if (!currentTable) return;

        // 1. Find Earliest Available Block
        const blockAvailability: Record<string, number> = {};
        const lastTripForBlock: Record<string, ParsedTrip> = {};

        currentTable.trips.forEach(trip => {
            let lastTimeMins = 0;
            currentTable.stops.forEach(stop => {
                const time = trip.times[stop];
                const m = TimeUtils.toMinutes(time);
                if (m) lastTimeMins = m;
            });

            if (lastTimeMins > (blockAvailability[trip.block] || 0)) {
                blockAvailability[trip.block] = lastTimeMins;
                lastTripForBlock[trip.block] = trip;
            }
        });

        let bestBlock = Object.keys(blockAvailability).sort((a, b) => blockAvailability[a] - blockAvailability[b])[0];
        if (!bestBlock) bestBlock = "1";

        const prevTrip = lastTripForBlock[bestBlock];
        const availableAt = blockAvailability[bestBlock] || (8 * 60); // Default 8am

        // 2. Create New Trip (Start 5 mins after previous arrival)
        const startMins = availableAt + 5;
        const newTimes: Record<string, string> = {};
        let runningMins = startMins;

        currentTable.stops.forEach((stop, idx) => {
            let duration = 0;
            if (prevTrip && idx > 0) {
                const prevStop = currentTable.stops[idx - 1];
                const t1 = TimeUtils.toMinutes(prevTrip.times[prevStop]);
                const t2 = TimeUtils.toMinutes(prevTrip.times[stop]);

                const isRec = stop.includes('(Recovery)');
                if (isRec) {
                    duration = parseInt(prevTrip.times[stop]) || 0;
                    newTimes[stop] = duration.toString();
                    return;
                } else if (stop.includes('(Dep)') && idx > 0) {
                    const recStop = currentTable.stops[idx - 1];
                    if (recStop.includes('(Recovery)')) {
                        const recTime = parseInt(newTimes[recStop] || "0");
                        runningMins += recTime;
                    }
                } else if (t1 !== null && t2 !== null) {
                    duration = t2 - t1;
                }
            }

            if (!stop.includes('(Recovery)')) {
                if (duration > 0) runningMins += duration;
                newTimes[stop] = TimeUtils.fromMinutes(runningMins);
            }
        });

        const newTrip: ParsedTrip = {
            tripId: `new-trip-${Date.now()}`,
            block: bestBlock,
            tripName: TimeUtils.fromMinutes(startMins),
            times: newTimes
        };

        const updatedRoutes = { ...allRoutesData };
        updatedRoutes[activeSheetName][activeTableIndex].trips.push(newTrip);
        setAllRoutesData(updatedRoutes);
    };

    const handleCellEdit = (tripId: string, stop: string, newValue: string) => {
        if (!activeSheetName) return;
        const routes = { ...allRoutesData };
        const table = routes[activeSheetName][activeTableIndex];
        const tripIndex = table.trips.findIndex(t => t.tripId === tripId);
        if (tripIndex === -1) return;

        const trip = table.trips[tripIndex];
        const oldValue = trip.times[stop];

        trip.times[stop] = newValue;

        // Cascading Update Logic
        const oldMins = TimeUtils.toMinutes(oldValue);
        const newMins = TimeUtils.toMinutes(newValue);

        if (oldMins !== null && newMins !== null) {
            const delta = newMins - oldMins;
            if (delta !== 0) {
                let startShifting = false;
                table.stops.forEach(s => {
                    if (s === stop) {
                        startShifting = true;
                        return;
                    }
                    if (startShifting) {
                        const isRec = s.includes('(Recovery)');
                        if (!isRec) {
                            trip.times[s] = TimeUtils.addMinutes(trip.times[s], delta);
                        }
                    }
                });

                const blockId = trip.block;
                table.trips.forEach((t, idx) => {
                    if (idx > tripIndex && t.block === blockId) {
                        table.stops.forEach(s => {
                            const isRec = s.includes('(Recovery)');
                            if (!isRec) {
                                t.times[s] = TimeUtils.addMinutes(t.times[s], delta);
                            }
                        });
                        t.tripName = TimeUtils.addMinutes(t.tripName, delta);
                    }
                });
            }
        }
        setAllRoutesData(routes);
    };

    const handleDeleteTrip = (tripId: string) => {
        if (!activeSheetName) return;
        const routes = { ...allRoutesData };
        const table = routes[activeSheetName][activeTableIndex];
        table.trips = table.trips.filter(t => t.tripId !== tripId);
        setAllRoutesData(routes);
    };

    const calculateTripMetrics = (trip: ParsedTrip, stops: string[]) => {
        let startTime: number | null = null;
        let endTime: number | null = null;
        let recoveryMins = 0;

        stops.forEach(stop => {
            const val = trip.times[stop];
            if (!val) return;

            if (stop.includes('(Recovery)')) {
                recoveryMins += parseInt(val) || 0;
            } else {
                const m = TimeUtils.toMinutes(val);
                if (m !== null) {
                    if (startTime === null) startTime = m;
                    endTime = m;
                }
            }
        });

        if (startTime !== null && endTime !== null) {
            let cycle = endTime - startTime;
            if (cycle < 0) cycle += 1440;
            const travel = cycle - recoveryMins;
            const ratio = cycle > 0 ? (recoveryMins / cycle) * 100 : 0;
            return { travel, cycle, recovery: recoveryMins, ratio };
        }
        return { travel: 0, cycle: 0, recovery: 0, ratio: 0 };
    };

    if (isParsing) {
        return (
            <div className="flex flex-col items-center justify-center h-96 space-y-6 animate-in fade-in duration-500">
                <div className="relative">
                    <div className="w-24 h-24 border-8 border-gray-100 rounded-full"></div>
                    <div className="w-24 h-24 border-8 border-brand-green border-t-transparent rounded-full animate-spin absolute top-0 left-0"></div>
                    <div className="absolute inset-0 flex items-center justify-center text-brand-green">
                        <Sparkles size={32} />
                    </div>
                </div>
                <div className="text-center space-y-2">
                    <h3 className="text-2xl font-extrabold text-gray-800">Digitizing Schedule</h3>
                    <p className="text-gray-500 font-bold">{parsingProgress || "Gemini AI is analyzing the spreadsheet structure..."}</p>
                </div>
            </div>
        );
    }

    if (!editorMode) {
        return (
            <div className="max-w-2xl mx-auto mt-10">
                <div className="text-center mb-8">
                    <h2 className="text-3xl font-extrabold text-gray-800">Tweak Schedule</h2>
                    <p className="text-gray-500 font-bold mt-2">Upload a Master Schedule Excel file to begin.</p>
                </div>

                {!showSheetSelector ? (
                    <FileUpload onFileUpload={processFile} />
                ) : (
                    <div className="bg-white p-8 rounded-3xl border-2 border-gray-200 shadow-xl">
                        <div className="flex items-center gap-3 mb-6">
                            <FileSpreadsheet className="text-brand-green" size={32} />
                            <div>
                                <h3 className="text-xl font-extrabold text-gray-800">Select Routes</h3>
                                <p className="text-gray-500 text-sm font-bold">Which sheets do you want to import?</p>
                            </div>
                        </div>

                        <div className="max-h-60 overflow-y-auto mb-6 pr-2 custom-scrollbar space-y-2">
                            {/* Routes (Numeric Sheets) */}
                            {detectedSheets.filter(s => !isNaN(Number(s))).length > 0 && (
                                <div className="mb-4">
                                    <h4 className="text-xs font-extrabold text-gray-400 uppercase tracking-wider mb-2">Routes</h4>
                                    <div className="grid grid-cols-3 gap-2">
                                        {detectedSheets.filter(s => !isNaN(Number(s))).map(sheet => (
                                            <div
                                                key={sheet}
                                                onClick={() => {
                                                    const newSet = new Set(selectedSheets);
                                                    if (newSet.has(sheet)) newSet.delete(sheet);
                                                    else newSet.add(sheet);
                                                    setSelectedSheets(newSet);
                                                }}
                                                className={`
                                                p-2 rounded-lg border-2 cursor-pointer flex items-center justify-center transition-all text-center
                                                ${selectedSheets.has(sheet) ? 'bg-green-50 border-brand-green text-brand-green' : 'bg-gray-50 border-gray-100 text-gray-500 hover:border-gray-300'}
                                            `}
                                            >
                                                <span className="font-black text-lg">{sheet}</span>
                                                {selectedSheets.has(sheet) && <div className="absolute top-1 right-1"><CheckCircle2 size={12} /></div>}
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* Other Sheets */}
                            {detectedSheets.filter(s => isNaN(Number(s))).length > 0 && (
                                <div>
                                    <h4 className="text-xs font-extrabold text-gray-400 uppercase tracking-wider mb-2">Other Sheets</h4>
                                    <div className="space-y-2">
                                        {detectedSheets.filter(s => isNaN(Number(s))).map(sheet => (
                                            <div
                                                key={sheet}
                                                onClick={() => {
                                                    const newSet = new Set(selectedSheets);
                                                    if (newSet.has(sheet)) newSet.delete(sheet);
                                                    else newSet.add(sheet);
                                                    setSelectedSheets(newSet);
                                                }}
                                                className={`
                                                p-3 rounded-xl border-2 cursor-pointer flex items-center justify-between transition-all
                                                ${selectedSheets.has(sheet) ? 'bg-green-50 border-brand-green text-brand-green' : 'bg-gray-50 border-gray-100 text-gray-500 hover:border-gray-300'}
                                            `}
                                            >
                                                <span className="font-bold">{sheet}</span>
                                                {selectedSheets.has(sheet) && <CheckCircle2 size={20} />}
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>

                        <div className="flex gap-2 mb-4">
                            <button
                                onClick={() => setSelectedSheets(new Set(detectedSheets))}
                                className="flex-1 py-2 rounded-xl font-bold text-xs text-gray-500 bg-gray-50 hover:bg-gray-100 transition-colors border border-gray-200 flex items-center justify-center gap-2"
                            >
                                <Check size={14} /> Select All
                            </button>
                            <button
                                onClick={() => setSelectedSheets(new Set())}
                                className="flex-1 py-2 rounded-xl font-bold text-xs text-gray-500 bg-gray-50 hover:bg-gray-100 transition-colors border border-gray-200 flex items-center justify-center gap-2"
                            >
                                <XCircle size={14} /> Deselect All
                            </button>
                        </div>

                        <button
                            onClick={handleStartParsing}
                            disabled={selectedSheets.size === 0}
                            className={`
                            w-full py-3 rounded-xl font-extrabold text-white flex items-center justify-center gap-2
                            ${selectedSheets.size === 0 ? 'bg-gray-300 cursor-not-allowed' : 'bg-brand-green btn-bouncy'}
                        `}
                        >
                            Import {selectedSheets.size} Routes <ArrowRight size={18} />
                        </button>
                    </div>
                )}
            </div>
        );
    }

    const activeTable = allRoutesData[activeSheetName || '']?.[activeTableIndex];

    return (
        <div className="h-full flex flex-col animate-in fade-in duration-500">
            {/* Header & Controls */}
            <div className="flex justify-between items-start mb-6">
                <div>
                    <div className="flex items-center gap-2 mb-2">
                        <button onClick={() => setEditorMode(false)} className="text-gray-400 hover:text-gray-600 transition-colors">
                            <ArrowLeft size={24} />
                        </button>
                        <h2 className="text-3xl font-extrabold text-gray-800">
                            {activeSheetName}
                            {activeTable && <span className="text-gray-400 text-xl ml-2 font-bold">/ {activeTable.tableName}</span>}
                        </h2>
                    </div>
                    <div className="flex gap-2">
                        {Object.keys(allRoutesData).map(sheet => (
                            <button
                                key={sheet}
                                onClick={() => { setActiveSheetName(sheet); setActiveTableIndex(0); }}
                                className={`px-3 py-1 rounded-lg text-sm font-bold transition-all ${activeSheetName === sheet ? 'bg-gray-800 text-white' : 'bg-white text-gray-500 hover:bg-gray-100'}`}
                            >
                                {sheet}
                            </button>
                        ))}
                    </div>
                </div>

                <div className="flex gap-2">
                    <button
                        onClick={handleSmartAddTrip}
                        className="btn-bouncy bg-brand-blue text-white px-4 py-2 rounded-xl font-bold border-b-4 border-blue-600 flex items-center gap-2"
                    >
                        <Zap size={18} /> Smart Add Trip
                    </button>
                    <button className="btn-bouncy bg-white text-gray-600 px-4 py-2 rounded-xl font-bold border-b-4 border-gray-200 flex items-center gap-2 hover:bg-gray-50">
                        <Download size={18} /> Export
                    </button>
                </div>
            </div>

            {activeTable && (
                <>
                    <RouteSummary table={activeTable} />

                    {/* Sub-Tabs for Directions (North/South) */}
                    {allRoutesData[activeSheetName!].length > 1 && (
                        <div className="flex border-b border-gray-200 mb-4">
                            {allRoutesData[activeSheetName!].map((table, idx) => (
                                <button
                                    key={idx}
                                    onClick={() => setActiveTableIndex(idx)}
                                    className={`px-6 py-3 font-bold text-sm border-b-2 transition-colors ${idx === activeTableIndex ? 'border-brand-green text-brand-green' : 'border-transparent text-gray-400 hover:text-gray-600'}`}
                                >
                                    {table.tableName}
                                </button>
                            ))}
                        </div>
                    )}

                    {/* Spreadsheet Grid */}
                    <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden flex flex-col flex-grow relative">
                        <div className="overflow-auto custom-scrollbar flex-grow">
                            <table className="w-full text-left border-collapse">
                                <thead className="bg-gray-50 sticky top-0 z-10 shadow-sm">
                                    <tr>
                                        <th className="p-4 border-b border-r border-gray-200 min-w-[200px] bg-gray-50 sticky left-0 z-20 font-extrabold text-gray-600 text-xs uppercase tracking-wider">
                                            Stop
                                        </th>
                                        {activeTable.trips.map(trip => (
                                            <th key={trip.tripId} className="p-2 border-b border-gray-200 min-w-[100px] text-center group relative">
                                                {/* Block Header */}
                                                <div className="text-[10px] font-bold text-gray-400 uppercase mb-1">
                                                    Block {trip.block}
                                                </div>
                                                <div className="font-extrabold text-gray-800">{trip.tripName}</div>

                                                {/* Column Actions */}
                                                <button
                                                    onClick={() => handleDeleteTrip(trip.tripId)}
                                                    className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 text-gray-300 hover:text-red-500 transition-all"
                                                >
                                                    <Trash2 size={14} />
                                                </button>
                                            </th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {activeTable.stops.map((stop, rIdx) => {
                                        const isRecovery = stop.toLowerCase().includes('(recovery)');

                                        return (
                                            <tr key={rIdx} className={`hover:bg-blue-50 transition-colors ${isRecovery ? 'bg-orange-50/30' : ''}`}>
                                                <td className={`p-3 border-b border-r border-gray-200 bg-white sticky left-0 z-10 font-bold text-sm text-gray-700 ${isRecovery ? 'text-orange-600' : ''}`}>
                                                    {stop}
                                                </td>
                                                {activeTable.trips.map(trip => (
                                                    <td key={`${trip.tripId}-${rIdx}`} className="p-0 border-b border-gray-100 border-r text-center relative">
                                                        <input
                                                            type="text"
                                                            className={`
                                                            w-full h-full p-3 text-center text-sm font-semibold focus:outline-none focus:bg-blue-100 transition-colors
                                                            ${isRecovery ? 'text-orange-600 font-extrabold' : 'text-gray-800'}
                                                        `}
                                                            value={trip.times[stop] || ''}
                                                            onChange={(e) => handleCellEdit(trip.tripId, stop, e.target.value)}
                                                        />
                                                    </td>
                                                ))}
                                            </tr>
                                        );
                                    })}

                                    {/* --- CALCULATED METRICS FOOTER --- */}
                                    <tr className="bg-gray-100 border-t-4 border-gray-200">
                                        <td className="p-3 border-r border-gray-200 bg-gray-100 sticky left-0 z-10 font-extrabold text-xs text-gray-500 uppercase tracking-wider">
                                            Travel Time (min)
                                        </td>
                                        {activeTable.trips.map(trip => {
                                            const m = calculateTripMetrics(trip, activeTable.stops);
                                            return (
                                                <td key={`travel-${trip.tripId}`} className="p-3 border-r border-gray-200 text-center font-bold text-sm text-gray-700">
                                                    {m.travel}
                                                </td>
                                            );
                                        })}
                                    </tr>
                                    <tr className="bg-gray-100">
                                        <td className="p-3 border-r border-gray-200 bg-gray-100 sticky left-0 z-10 font-extrabold text-xs text-gray-500 uppercase tracking-wider">
                                            Recovery Time (min)
                                        </td>
                                        {activeTable.trips.map(trip => {
                                            const m = calculateTripMetrics(trip, activeTable.stops);
                                            return (
                                                <td key={`rec-${trip.tripId}`} className="p-3 border-r border-gray-200 text-center font-bold text-sm text-orange-600">
                                                    {m.recovery}
                                                </td>
                                            );
                                        })}
                                    </tr>
                                    <tr className="bg-gray-100">
                                        <td className="p-3 border-r border-gray-200 bg-gray-100 sticky left-0 z-10 font-extrabold text-xs text-gray-500 uppercase tracking-wider">
                                            Cycle Time (min)
                                        </td>
                                        {activeTable.trips.map(trip => {
                                            const m = calculateTripMetrics(trip, activeTable.stops);
                                            return (
                                                <td key={`cycle-${trip.tripId}`} className="p-3 border-r border-gray-200 text-center font-extrabold text-sm text-gray-800">
                                                    {m.cycle}
                                                </td>
                                            );
                                        })}
                                    </tr>
                                    <tr className="bg-gray-100 border-b border-gray-200">
                                        <td className="p-3 border-r border-gray-200 bg-gray-100 sticky left-0 z-10 font-extrabold text-xs text-gray-500 uppercase tracking-wider">
                                            Recovery Ratio
                                        </td>
                                        {activeTable.trips.map(trip => {
                                            const m = calculateTripMetrics(trip, activeTable.stops);
                                            let colorClass = "text-brand-green";
                                            if (m.ratio < 10) colorClass = "text-brand-red";
                                            else if (m.ratio > 20) colorClass = "text-brand-yellow";

                                            return (
                                                <td key={`ratio-${trip.tripId}`} className={`p-3 border-r border-gray-200 text-center font-black text-sm ${colorClass}`}>
                                                    {m.ratio.toFixed(0)}%
                                                </td>
                                            );
                                        })}
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                    </div>
                </>
            )}
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
