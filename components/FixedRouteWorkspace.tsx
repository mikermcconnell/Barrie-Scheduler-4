
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
  Settings2
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
                 if(!val) return;
                 const isRec = stop.toLowerCase().includes('recovery') || stop.toLowerCase().includes('(rec)');
                 if(isRec) {
                     tripRec += parseInt(val) || 0;
                 } else if (val.includes(':')) {
                     const m = TimeUtils.toMinutes(val);
                     if(m !== null) {
                         if(start === null) start = m;
                         end = m;
                     }
                 }
             });

             if(start !== null && end !== null) {
                 let cycle = end - start;
                 if(cycle < 0) cycle += 1440; // Midnight crossing
                 
                 totalCycle += cycle;
                 totalTravel += (cycle - tripRec);
                 totalRec += tripRec;
                 count++;
             }
        });

        return {
            totalRevenueHours: parseFloat((totalTravel / 60).toFixed(1)),
            totalCycleTime: parseFloat((totalCycle / 60).toFixed(1)),
            totalRecoveryTime: parseFloat((totalRec / 60).toFixed(1)),
            avgRecoveryRatio: totalCycle > 0 ? parseFloat(((totalRec / totalCycle) * 100).toFixed(1)) : 0,
            totalTrips: count
        };
    }, [table]);

    return (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
             <div className="bg-blue-50 p-4 rounded-2xl border border-blue-100">
                 <div className="text-xs font-bold text-blue-400 uppercase">Total Trips</div>
                 <div className="text-2xl font-black text-brand-blue">{stats.totalTrips}</div>
             </div>
             <div className="bg-white p-4 rounded-2xl border border-gray-200">
                 <div className="text-xs font-bold text-gray-400 uppercase">Rev. Hours</div>
                 <div className="text-2xl font-black text-gray-700">{stats.totalRevenueHours}h</div>
             </div>
             <div className="bg-white p-4 rounded-2xl border border-gray-200">
                 <div className="text-xs font-bold text-gray-400 uppercase">Cycle Hours</div>
                 <div className="text-2xl font-black text-gray-700">{stats.totalCycleTime}h</div>
             </div>
             <div className="bg-white p-4 rounded-2xl border border-gray-200">
                 <div className="text-xs font-bold text-gray-400 uppercase">Total Recovery</div>
                 <div className="text-2xl font-black text-orange-500">{stats.totalRecoveryTime}h</div>
             </div>
             <div className="bg-white p-4 rounded-2xl border border-gray-200">
                 <div className="text-xs font-bold text-gray-400 uppercase">Avg Ratio</div>
                 <div className={`text-2xl font-black ${stats.avgRecoveryRatio < 10 ? 'text-brand-red' : 'text-brand-green'}`}>
                     {stats.avgRecoveryRatio}%
                 </div>
             </div>
        </div>
    );
};

// 1. Tweak Schedule Component
const TweakSchedule: React.FC = () => {
  // File Parsing State
  const [isParsing, setIsParsing] = useState(false);
  const [parsingProgress, setParsingProgress] = useState<string>('');
  
  // Data Structure: Sheet Name -> Array of Tables (Directions)
  const [allRoutesData, setAllRoutesData] = useState<Record<string, ParsedTable[]>>({});
  
  // Navigation State
  const [activeSheetName, setActiveSheetName] = useState<string | null>(null);
  const [activeTableIndex, setActiveTableIndex] = useState(0);
  const [editorMode, setEditorMode] = useState(false);

  // Sheet Selection State
  const [workbook, setWorkbook] = useState<any>(null); // Using any for XLSX.WorkBook
  const [detectedSheets, setDetectedSheets] = useState<string[]>([]);
  const [selectedSheets, setSelectedSheets] = useState<Set<string>>(new Set());
  const [showSheetSelector, setShowSheetSelector] = useState(false);
  
  const processFile = async (file: File) => {
    const reader = new FileReader();
    reader.onload = async (e) => {
        try {
            const data = e.target?.result;
            
            // 1. Handle Excel
            if (file.name.endsWith('.xlsx') || file.name.endsWith('.xls')) {
                const wb = XLSX.read(data, { type: 'array' });
                
                // Identify target sheets (contain numbers)
                const targets = wb.SheetNames.filter(name => /\d/.test(name));
                
                if (targets.length === 0) {
                    alert("No sheets with route numbers (e.g. 'Route 400') found.");
                    return;
                }

                setWorkbook(wb);
                setDetectedSheets(targets);
                setSelectedSheets(new Set(targets)); 
                setShowSheetSelector(true);

            } else {
                // 2. Handle CSV
                const dec = new TextDecoder("utf-8");
                const csvContent = dec.decode(data as ArrayBuffer);
                
                setIsParsing(true);
                setEditorMode(true);
                setParsingProgress("Parsing CSV file...");
                
                const tables = await parseScheduleWithGemini(csvContent);
                if (tables && tables.length > 0) {
                    const sheetName = "Imported CSV";
                    setAllRoutesData({ [sheetName]: tables });
                    setActiveSheetName(sheetName);
                }
                setIsParsing(false);
            }

        } catch (error) {
            console.error(error);
            alert("Error reading file.");
            setIsParsing(false);
        }
    };
    reader.readAsArrayBuffer(file);
  };

  const handleStartParsing = async () => {
      setShowSheetSelector(false);
      setEditorMode(true);
      setIsParsing(true);

      const sheetsToParse = Array.from(selectedSheets) as string[];
      const newRoutesData: Record<string, ParsedTable[]> = {};

      for (let i = 0; i < sheetsToParse.length; i++) {
          const sheetName = sheetsToParse[i];
          setParsingProgress(`Digitizing ${sheetName} (${i + 1}/${sheetsToParse.length})...`);
          
          try {
              const ws = (workbook as any).Sheets[sheetName];
              const csv = XLSX.utils.sheet_to_csv(ws);
              const tables = await parseScheduleWithGemini(csv);
              
              if (tables.length > 0) {
                  // Post-process table name to match sheet if generic
                  tables.forEach(t => {
                      if (t.tableName === "Route Schedule") t.tableName = `${sheetName} Schedule`;
                  });
                  newRoutesData[sheetName] = tables;
              }
          } catch (e) {
              console.error(`Failed to parse ${sheetName}`, e);
          }
      }

      setAllRoutesData(newRoutesData);
      const firstSheet = Object.keys(newRoutesData)[0];
      if (firstSheet) setActiveSheetName(firstSheet);
      
      setIsParsing(false);
  };

  // --- ACTIONS ---

  const handleSmartAddTrip = () => {
    if (!activeSheetName) return;
    const currentTable = allRoutesData[activeSheetName][activeTableIndex];
    if (!currentTable) return;

    // 1. Find Earliest Available Block
    // Logic: Look at the last stop time of every trip. Group by Block.
    const blockAvailability: Record<string, number> = {};
    const lastTripForBlock: Record<string, ParsedTrip> = {};

    currentTable.trips.forEach(trip => {
        // Find last valid time in this trip
        let lastTimeMins = 0;
        currentTable.stops.forEach(stop => {
            const time = trip.times[stop];
            const m = TimeUtils.toMinutes(time);
            if (m) lastTimeMins = m;
        });
        
        // Update availability if this trip ends later
        if (lastTimeMins > (blockAvailability[trip.block] || 0)) {
            blockAvailability[trip.block] = lastTimeMins;
            lastTripForBlock[trip.block] = trip;
        }
    });

    // Find the block that finishes earliest (and thus is ready for a new trip)
    // Filter out blocks that finish very late (e.g. after midnight) unless it's early morning
    let bestBlock = Object.keys(blockAvailability).sort((a, b) => blockAvailability[a] - blockAvailability[b])[0];

    if (!bestBlock) bestBlock = "1";

    const prevTrip = lastTripForBlock[bestBlock];
    const availableAt = blockAvailability[bestBlock] || (8 * 60); // Default 8am

    // 2. Create New Trip
    // Start 5 mins after previous arrival (Layover)
    const startMins = availableAt + 5; 
    
    // Create empty times object
    const newTimes: Record<string, string> = {};
    
    // Calculate new times based on duration of the previous trip
    // If no previous trip, just add 0
    let runningMins = startMins;
    
    currentTable.stops.forEach((stop, idx) => {
        // Find duration from previous trip for this segment
        let duration = 0;
        if (prevTrip && idx > 0) {
            const prevStop = currentTable.stops[idx - 1];
            const t1 = TimeUtils.toMinutes(prevTrip.times[prevStop]);
            const t2 = TimeUtils.toMinutes(prevTrip.times[stop]);
            
            // Check if current stop is recovery
            const isRec = stop.includes('(Recovery)');
            if (isRec) {
                // Keep same recovery duration
                duration = parseInt(prevTrip.times[stop]) || 0;
                // Recovery row value is just minutes, not a clock time
                newTimes[stop] = duration.toString();
                // Do not advance runningMins yet, recovery is dwell.
                // Wait, typically structure is Arrive -> Recovery -> Depart.
                // Depart = Arrive + Recovery.
                return; 
            } else if (stop.includes('(Dep)') && idx > 0) {
                 // Depart time = Arrive Time + Recovery Time
                 // Find the recovery row before this
                 const recStop = currentTable.stops[idx - 1];
                 const arrStop = currentTable.stops[idx - 2];
                 if (recStop.includes('(Recovery)')) {
                     const recTime = parseInt(newTimes[recStop] || "0");
                     // runningMins is currently at Arrival time
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

    // Update State
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

    // 1. Update the specific cell
    trip.times[stop] = newValue;

    // 2. CASCADING UPDATE LOGIC
    // If a time changed, shift all subsequent times for this trip AND future trips of this block
    const oldMins = TimeUtils.toMinutes(oldValue);
    const newMins = TimeUtils.toMinutes(newValue);

    if (oldMins !== null && newMins !== null) {
        const delta = newMins - oldMins;
        
        if (delta !== 0) {
            // A. Shift downstream stops in CURRENT trip
            let startShifting = false;
            table.stops.forEach(s => {
                if (s === stop) {
                    startShifting = true;
                    return; // Don't double shift the edited cell
                }
                if (startShifting) {
                    const isRec = s.includes('(Recovery)');
                    if (!isRec) {
                        trip.times[s] = TimeUtils.addMinutes(trip.times[s], delta);
                    }
                }
            });

            // B. Shift FUTURE trips for SAME BLOCK
            // Find trips with same block that start AFTER this trip
            const blockId = trip.block;
            table.trips.forEach((t, idx) => {
                if (idx > tripIndex && t.block === blockId) {
                    // Shift every time in this trip
                    table.stops.forEach(s => {
                        const isRec = s.includes('(Recovery)');
                        if (!isRec) {
                            t.times[s] = TimeUtils.addMinutes(t.times[s], delta);
                        }
                    });
                    // Update Trip Name if it's based on start time
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
          if (cycle < 0) cycle += 1440; // Over midnight
          
          const travel = cycle - recoveryMins;
          const ratio = cycle > 0 ? (recoveryMins / cycle) * 100 : 0;

          return {
              travel, // minutes
              cycle, // minutes
              recovery: recoveryMins,
              ratio
          };
      }
      return { travel: 0, cycle: 0, recovery: 0, ratio: 0 };
  };

  // --- RENDER ---

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
                <div className="text-xs text-gray-400 max-w-md mx-auto mt-4">
                    Identifying routes, detecting blocks, and calculating recovery times.
                </div>
            </div>
        </div>
    );
  }

  if (!editorMode) {
    return (
        <div className="animate-in fade-in zoom-in-95 duration-500 max-w-2xl mx-auto mt-10">
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
                        {detectedSheets.map(sheet => (
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

export const FixedRouteWorkspace: React.FC = () => {
    const [viewMode, setViewMode] = useState<'schedule' | 'otp'>('schedule');

    return (
        <div className="flex flex-col h-full">
            {/* Sub-Navigation for Fixed Route Workspace */}
            <div className="flex justify-center mb-8">
                <div className="bg-white p-1 rounded-2xl border-2 border-gray-200 flex gap-1 shadow-sm">
                    <button
                        onClick={() => setViewMode('schedule')}
                        className={`
                            px-6 py-2 rounded-xl font-extrabold flex items-center gap-2 transition-all
                            ${viewMode === 'schedule' ? 'bg-brand-blue text-white shadow-md' : 'text-gray-400 hover:text-gray-600 hover:bg-gray-50'}
                        `}
                    >
                        <Settings2 size={18} /> Schedule Tweaker
                    </button>
                    <button
                        onClick={() => setViewMode('otp')}
                        className={`
                            px-6 py-2 rounded-xl font-extrabold flex items-center gap-2 transition-all
                            ${viewMode === 'otp' ? 'bg-brand-green text-white shadow-md' : 'text-gray-400 hover:text-gray-600 hover:bg-gray-50'}
                        `}
                    >
                        <BarChart2 size={18} /> OTP Analysis
                    </button>
                </div>
            </div>

            {viewMode === 'schedule' ? <TweakSchedule /> : <OTPAnalysis />}
        </div>
    );
};
