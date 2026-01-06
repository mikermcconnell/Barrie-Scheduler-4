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
    Minus,
    Clock,
    AlertTriangle,
    Car,
    GitCompare,
    MoreVertical,
    Pencil,
    Upload,
    Database
} from 'lucide-react';
import * as XLSX from 'xlsx';
import ExcelJS from 'exceljs';
import {
    MasterRouteTable,
    MasterTrip,
    validateRouteTable,
    RoundTripTable,
    buildRoundTripView,
    InterlineConfig,
    InterlineRule,
    applyInterlineRules,
    clearInterlineMetadata
} from '../utils/masterScheduleParser';
import { InterlineConfigPanel } from './InterlineConfigPanel';
import { RouteSummary } from './RouteSummary';
import { WorkspaceHeader } from './WorkspaceHeader';
import { AutoSaveStatus } from '../hooks/useAutoSave';
import { TimeUtils } from '../utils/timeUtils';
import { getRouteColor, getRouteTextColor } from '../utils/routeColors';
import { AddTripModal, AddTripModalContext } from './AddTripModal';
import { useAddTrip } from '../hooks/useAddTrip';
import { TravelTimeGrid } from './TravelTimeGrid';
import { ScenarioComparisonModal } from './ScenarioComparisonModal';
import { AuditLogPanel, useAuditLog } from './AuditLogPanel';
import { TripContextMenu, TripContextMenuAction } from './NewSchedule/TripContextMenu';
import { SegmentTimeEditor } from './NewSchedule/SegmentTimeEditor';
import { QuickActionsBar, FilterState, shouldGrayOutTrip, shouldHighlightTrip, matchesSearch } from './NewSchedule/QuickActionsBar';
import { TimelineView } from './NewSchedule/TimelineView';
import {
    cascadeTripTimes,
    updateSegmentTime,
    endBlockAtTrip,
    setTripStartStop,
    setTripEndStop
} from './NewSchedule/utils/timeCascade';
import { UploadToMasterModal } from './UploadToMasterModal';
import { BulkUploadToMasterModal, RouteForUpload } from './BulkUploadToMasterModal';
import {
    uploadToMasterSchedule,
    prepareUpload
} from '../utils/masterScheduleService';
import {
    extractRouteNumber,
    extractDayType,
    type DayType,
    type UploadConfirmation
} from '../utils/masterScheduleTypes';

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

// Recovery ratio color: 15% is sweet spot
// <10% = red (too little), 10-15% = yellow (marginal), 15-20% = green (ideal), 20-25% = yellow (too much), >25% = red (way too much)
const getRatioColor = (ratio: number) => {
    if (ratio < 10) return 'bg-red-100 text-red-700'; // Too little recovery
    if (ratio < 15) return 'bg-yellow-50 text-yellow-700'; // Marginal
    if (ratio <= 20) return 'bg-emerald-50 text-emerald-700'; // Sweet spot (15-20%)
    if (ratio <= 25) return 'bg-yellow-50 text-yellow-700'; // Too much
    return 'bg-red-100 text-red-700'; // Way too much (>25%)
};

// Get recovery status label
const getRecoveryStatus = (ratio: number): { label: string; color: string } => {
    if (ratio < 10) return { label: 'Low', color: 'text-red-600' };
    if (ratio < 15) return { label: 'Marginal', color: 'text-yellow-600' };
    if (ratio <= 20) return { label: 'Optimal', color: 'text-emerald-600' };
    if (ratio <= 25) return { label: 'High', color: 'text-yellow-600' };
    return { label: 'Excessive', color: 'text-red-600' };
};

// Calculate peak vehicle requirement
const calculatePeakVehicles = (trips: MasterTrip[]): number => {
    const uniqueBlocks = new Set(trips.map(t => t.blockId));
    return uniqueBlocks.size;
};

// Calculate service span (first departure to last arrival)
const calculateServiceSpan = (trips: MasterTrip[]): { start: string; end: string; hours: number } => {
    if (trips.length === 0) return { start: '-', end: '-', hours: 0 };

    const sortedByStart = [...trips].sort((a, b) => a.startTime - b.startTime);
    const sortedByEnd = [...trips].sort((a, b) => b.endTime - a.endTime);

    const startMins = sortedByStart[0].startTime;
    const endMins = sortedByEnd[0].endTime;

    const formatTime = (mins: number) => {
        const h = Math.floor(mins / 60) % 24;
        const m = mins % 60;
        const period = h >= 12 ? 'PM' : 'AM';
        const h12 = h % 12 || 12;
        return `${h12}:${m.toString().padStart(2, '0')} ${period}`;
    };

    return {
        start: formatTime(startMins),
        end: formatTime(endMins),
        hours: Number(((endMins - startMins) / 60).toFixed(1))
    };
};

// Check headway consistency and flag irregularities
const analyzeHeadways = (trips: MasterTrip[]): { avg: number; irregular: string[] } => {
    const byDir: Record<string, MasterTrip[]> = {};
    trips.forEach(t => {
        const dir = t.direction || 'Loop';
        if (!byDir[dir]) byDir[dir] = [];
        byDir[dir].push(t);
    });

    const allHeadways: number[] = [];
    const irregular: string[] = [];

    Object.entries(byDir).forEach(([dir, dirTrips]) => {
        const sorted = [...dirTrips].sort((a, b) => a.startTime - b.startTime);
        for (let i = 1; i < sorted.length; i++) {
            const headway = sorted[i].startTime - sorted[i - 1].startTime;
            allHeadways.push(headway);
        }
    });

    if (allHeadways.length > 0) {
        const avg = allHeadways.reduce((a, b) => a + b, 0) / allHeadways.length;
        allHeadways.forEach((h, idx) => {
            if (Math.abs(h - avg) > avg * 0.3) { // More than 30% deviation
                irregular.push(`Trip ${idx + 2}: ${h} min (avg: ${Math.round(avg)})`);
            }
        });
        return { avg: Math.round(avg), irregular };
    }
    return { avg: 0, irregular: [] };
};

// Calculate round trips per hour (count North departures only, since N+S = 1 round trip)
const calculateTripsPerHour = (trips: MasterTrip[]): Record<number, number> => {
    const hourCounts: Record<number, number> = {};
    // Only count North trips - each North departure represents one full round trip
    const northTrips = trips.filter(t => t.direction === 'North');
    northTrips.forEach(t => {
        const hour = Math.floor(t.startTime / 60);
        hourCounts[hour] = (hourCounts[hour] || 0) + 1;
    });
    return hourCounts;
};

// Band colors for row tinting - subtle transparent versions matching the legend
const getBandRowColor = (bandId: string | undefined): string => {
    const colors: Record<string, string> = {
        'A': 'bg-red-100/30',      // Red - subtle
        'B': 'bg-orange-100/30',   // Orange - subtle
        'C': 'bg-yellow-100/30',   // Yellow - subtle
        'D': 'bg-lime-100/30',     // Lime green - subtle
        'E': 'bg-emerald-100/30'   // Green - subtle
    };
    return bandId ? colors[bandId] || '' : '';
};

// Inline time editing - auto-format helper
// Converts shorthand input like "630" → "6:30 AM", "1430" → "2:30 PM"
// If originalValue is provided and input doesn't specify AM/PM, preserves the original period
const parseTimeInput = (input: string, originalValue?: string): string | null => {
    const inputLower = input.toLowerCase();

    // Check if user explicitly specified AM or PM in input
    const hasExplicitAM = inputLower.includes('am') || inputLower.includes('a.m');
    const hasExplicitPM = inputLower.includes('pm') || inputLower.includes('p.m');
    const hasExplicitPeriod = hasExplicitAM || hasExplicitPM;

    // Get period from original value if available (for context preservation)
    const originalPeriod = originalValue?.toLowerCase().includes('pm') ? 'PM' :
        originalValue?.toLowerCase().includes('am') ? 'AM' : null;

    // Remove all non-numeric characters except colon
    const cleaned = input.replace(/[^0-9:]/g, '');

    let hours: number;
    let minutes: number;

    if (cleaned.includes(':')) {
        // Already has colon: "6:30" or "14:30"
        const [h, m] = cleaned.split(':');
        hours = parseInt(h) || 0;
        minutes = parseInt(m) || 0;
    } else if (cleaned.length <= 2) {
        // Just hours: "6" → 6:00, "14" → 14:00
        hours = parseInt(cleaned) || 0;
        minutes = 0;
    } else if (cleaned.length === 3) {
        // "630" → 6:30
        hours = parseInt(cleaned[0]) || 0;
        minutes = parseInt(cleaned.slice(1)) || 0;
    } else if (cleaned.length >= 4) {
        // "0630" or "1430" → 6:30 or 14:30
        hours = parseInt(cleaned.slice(0, cleaned.length - 2)) || 0;
        minutes = parseInt(cleaned.slice(-2)) || 0;
    } else {
        return null;
    }

    // Validate
    if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
        return null;
    }

    // Determine AM/PM
    let period: 'AM' | 'PM';

    if (hasExplicitPM) {
        // User explicitly typed PM
        period = 'PM';
        // Convert 12-hour to 24-hour for correct calculation
        if (hours < 12) hours += 12;
    } else if (hasExplicitAM) {
        // User explicitly typed AM
        period = 'AM';
        if (hours === 12) hours = 0;
    } else if (hours >= 12 && hours <= 23) {
        // 24-hour format (13:00 - 23:00) is clearly PM
        period = 'PM';
    } else if (hours === 0) {
        // Midnight
        period = 'AM';
    } else if (!hasExplicitPeriod && originalPeriod) {
        // No explicit period, use original value's period for context
        period = originalPeriod;
    } else {
        // Default: assume PM for ambiguous times 1-11 (more common in transit schedules)
        // This prevents accidentally switching evening times to morning
        period = hours >= 1 && hours <= 11 ? 'PM' : 'AM';
    }

    // Format to 12-hour
    const h12 = hours > 12 ? hours - 12 : (hours === 0 ? 12 : hours);
    return `${h12}:${minutes.toString().padStart(2, '0')} ${period}`;
};

// Input sanitization - prevent XSS and injection
const sanitizeInput = (input: string): string => {
    return input
        .replace(/[<>]/g, '') // Remove HTML tags
        .replace(/javascript:/gi, '') // Remove JS protocol
        .replace(/on\w+=/gi, '') // Remove event handlers
        .trim()
        .slice(0, 20); // Limit length
};

// Stacked time display helper
// Converts "6:30 AM" to { time: "6:30", period: "AM" } for stacked rendering
const parseStackedTime = (timeStr: string | undefined): { time: string; period: string } | null => {
    if (!timeStr) return null;
    const match = timeStr.match(/^(\d{1,2}:\d{2})\s*(AM|PM)$/i);
    if (match) {
        return { time: match[1], period: match[2].toUpperCase() };
    }
    return null;
};

// Stacked time cell component for consistent rendering
const StackedTimeCell: React.FC<{ timeStr: string | undefined; className?: string }> = ({ timeStr, className = '' }) => {
    const parsed = parseStackedTime(timeStr);
    if (!parsed) {
        return <span className={className}>{timeStr || '-'}</span>;
    }
    return (
        <div className={`flex flex-col items-center leading-tight ${className}`}>
            <span className="text-[11px] font-medium text-gray-700">{parsed.time}</span>
            <span className="text-[8px] font-medium text-gray-400">{parsed.period}</span>
        </div>
    );
};

// Stacked time input - shows stacked format when not editing, normal input when focused
interface StackedTimeInputProps {
    value: string;
    onChange: (value: string) => void;
    onBlur: (value: string) => void;
    disabled?: boolean;
    focusClass?: string;
    placeholder?: string;
}

const StackedTimeInput: React.FC<StackedTimeInputProps> = ({
    value,
    onChange,
    onBlur,
    disabled = false,
    focusClass = 'focus:ring-blue-100',
    placeholder = '-'
}) => {
    const [isFocused, setIsFocused] = React.useState(false);
    const [editValue, setEditValue] = React.useState(value);
    const inputRef = React.useRef<HTMLInputElement>(null);

    // Sync edit value when external value changes
    React.useEffect(() => {
        if (!isFocused) {
            setEditValue(value);
        }
    }, [value, isFocused]);

    const parsed = parseStackedTime(value);

    if (!isFocused && parsed) {
        // Show stacked display - clickable to edit
        return (
            <div
                className="flex flex-col items-center justify-center leading-tight cursor-text w-full h-full py-1"
                onClick={() => {
                    if (!disabled) {
                        setIsFocused(true);
                        setTimeout(() => inputRef.current?.focus(), 0);
                    }
                }}
            >
                <span className="text-[11px] font-medium text-gray-700">{parsed.time}</span>
                <span className="text-[8px] font-medium text-gray-400">{parsed.period}</span>
                {/* Hidden input for focus management */}
                <input
                    ref={inputRef}
                    type="text"
                    value={editValue}
                    onChange={(e) => {
                        setEditValue(e.target.value);
                        onChange(sanitizeInput(e.target.value));
                    }}
                    onFocus={() => setIsFocused(true)}
                    onBlur={(e) => {
                        setIsFocused(false);
                        onBlur(e.target.value);
                    }}
                    className="absolute opacity-0 w-0 h-0"
                    disabled={disabled}
                />
            </div>
        );
    }

    // Show regular input - for editing or when value doesn't parse as time
    return (
        <input
            ref={inputRef}
            type="text"
            value={isFocused ? editValue : (value || '')}
            onChange={(e) => {
                setEditValue(e.target.value);
                onChange(sanitizeInput(e.target.value));
            }}
            onFocus={() => setIsFocused(true)}
            onBlur={(e) => {
                setIsFocused(false);
                onBlur(e.target.value);
            }}
            className={`w-full h-full bg-transparent font-medium text-[11px] text-gray-700 text-center focus:bg-white focus:ring-2 ${focusClass} focus:outline-none transition-all placeholder-gray-200 px-2`}
            placeholder={placeholder}
            disabled={disabled}
        />
    );
};

// Validation warnings
interface ValidationWarning {
    type: 'error' | 'warning' | 'info';
    message: string;
    tripId?: string;
}

const validateSchedule = (trips: MasterTrip[]): ValidationWarning[] => {
    const warnings: ValidationWarning[] = [];

    trips.forEach(trip => {
        const ratio = trip.travelTime > 0 ? (trip.recoveryTime / trip.travelTime) * 100 : 0;

        // Tight recovery warning
        if (ratio < 10 && trip.recoveryTime < 5) {
            warnings.push({
                type: 'warning',
                message: `Block ${trip.blockId}: Very tight recovery (${trip.recoveryTime} min, ${ratio.toFixed(0)}%)`,
                tripId: trip.id
            });
        }

        // Excessive recovery warning
        if (ratio > 25) {
            warnings.push({
                type: 'warning',
                message: `Block ${trip.blockId}: Excessive recovery (${trip.recoveryTime} min, ${ratio.toFixed(0)}%)`,
                tripId: trip.id
            });
        }

        // Unrealistic segment time (travel > 90 min one way)
        if (trip.travelTime > 90) {
            warnings.push({
                type: 'info',
                message: `Block ${trip.blockId}: Long travel time (${trip.travelTime} min)`,
                tripId: trip.id
            });
        }
    });

    // Check for gaps in service (>90 min between trips in same direction)
    const byDir: Record<string, MasterTrip[]> = {};
    trips.forEach(t => {
        const dir = t.direction || 'Loop';
        if (!byDir[dir]) byDir[dir] = [];
        byDir[dir].push(t);
    });

    Object.entries(byDir).forEach(([dir, dirTrips]) => {
        const sorted = [...dirTrips].sort((a, b) => a.startTime - b.startTime);
        for (let i = 1; i < sorted.length; i++) {
            const gap = sorted[i].startTime - sorted[i - 1].endTime;
            if (gap > 90) {
                warnings.push({
                    type: 'warning',
                    message: `${dir}: ${gap} min gap between trips`,
                    tripId: sorted[i].id
                });
            }
        }
    });

    return warnings;
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
    draftName: string;
    filter?: FilterState;
    targetCycleTime?: number;
    targetHeadway?: number;
}

const RoundTripTableView: React.FC<RoundTripTableViewProps> = ({ schedules, onCellEdit, onTimeAdjust, onRecoveryEdit, originalSchedules, onDeleteTrip, onDuplicateTrip, onAddTrip, onTripRightClick, onMenuOpen, draftName, filter, targetCycleTime, targetHeadway }) => {
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
                const isInterlinedRoute = combined.routeName.includes('8A') || combined.routeName.includes('8B');

                // Calculate Route Totals for the Header
                const totalTrips = combined.rows.length;
                const allTrips = [...allNorthTrips, ...allSouthTrips];
                const totalTravelSum = combined.rows.reduce((sum, r) => sum + r.totalTravelTime, 0);
                const totalRecoverySum = combined.rows.reduce((sum, r) => sum + r.totalRecoveryTime, 0);
                const avgTravel = totalTrips > 0 ? (totalTravelSum / totalTrips).toFixed(1) : '0';
                const avgRecovery = totalTrips > 0 ? (totalRecoverySum / totalTrips).toFixed(1) : '0';

                // For interlined routes (8A/8B), calculate effective cycle time that accounts for interline gaps
                // This matches the per-trip calculation in RouteTableView
                const calculateEffectiveCycleSum = (): number => {
                    if (!isInterlinedRoute) {
                        return combined.rows.reduce((sum, r) => sum + r.totalCycleTime, 0);
                    }

                    // For 8A/8B, calculate effective cycle for each trip
                    const is8A = combined.routeName.includes('8A');
                    const table = is8A ? north : south; // Get the actual table for column mapping
                    if (!table) return combined.rows.reduce((sum, r) => sum + r.totalCycleTime, 0);

                    // Build column map for this table
                    const stops = table.stops;
                    const colMap: Record<number, { type: string; stopName?: string }> = {};
                    let colNum = 1;
                    colMap[colNum++] = { type: 'block' };
                    stops.forEach(stop => {
                        colMap[colNum++] = { type: 'stop', stopName: stop };
                        // Check if this stop has recovery data
                        const hasRecovery = table.trips.some(t => t.recoveryTimes?.[stop] !== undefined && t.recoveryTimes[stop] !== null);
                        if (hasRecovery) {
                            colMap[colNum++] = { type: 'recovery', stopName: stop };
                        }
                    });

                    // Config for 8A/8B
                    const config = is8A
                        ? { firstDep: 2, interlineArr: 12, recoveryCol: 13, resumeCol: 14 }
                        : { firstDep: 2, interlineArr: 3, recoveryCol: 4, resumeCol: 5 };

                    // Helper to get column value
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

                    // Helper to get first/last timepoint
                    const getFirstTime = (trip: MasterTrip): number | null => {
                        for (const [colStr, info] of Object.entries(colMap)) {
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
                        for (const [colStr, info] of Object.entries(colMap)) {
                            if (info.type === 'stop' && info.stopName) {
                                const timeStr = trip.stops[info.stopName];
                                const time = timeStr ? TimeUtils.toMinutes(timeStr) : null;
                                if (time !== null) lastTime = time;
                            }
                        }
                        return lastTime;
                    };

                    // Time diff helper for midnight crossing
                    const timeDiff = (end: number, start: number): number => {
                        const diff = end - start;
                        return diff < 0 ? diff + 1440 : diff;
                    };

                    // Calculate effective cycle for each trip
                    let totalEffective = 0;
                    for (const trip of table.trips) {
                        let firstDep = getColVal(trip, config.firstDep);
                        if (firstDep === null) firstDep = getFirstTime(trip);

                        const interlineArr = getColVal(trip, config.interlineArr);
                        const recovery = getColVal(trip, config.recoveryCol);
                        const resume = getColVal(trip, config.resumeCol);
                        const finalArr = getLastTime(trip);

                        // Check if trip ends at interline (no resume)
                        const endsAtInterline = resume === null && interlineArr !== null;

                        if (endsAtInterline && firstDep !== null && interlineArr !== null) {
                            // Trip ends at interline
                            const segment1 = timeDiff(interlineArr, firstDep);
                            totalEffective += segment1 + (recovery ?? 0);
                        } else if (firstDep !== null && interlineArr !== null && recovery !== null && resume !== null && finalArr !== null) {
                            // Full interline trip
                            const segment1 = timeDiff(interlineArr, firstDep);
                            const segment2 = timeDiff(finalArr, resume);
                            totalEffective += segment1 + recovery + segment2;
                        } else {
                            // Fallback to raw cycle time
                            totalEffective += trip.cycleTime;
                        }
                    }
                    return totalEffective;
                };

                const totalCycleSum = calculateEffectiveCycleSum();

                const overallRatio = totalTravelSum > 0 ? ((totalRecoverySum / totalTravelSum) * 100) : 0;
                const ratioStatus = getRecoveryStatus(overallRatio);

                // New metrics
                const peakVehicles = calculatePeakVehicles(allTrips);
                const serviceSpan = calculateServiceSpan(allTrips);
                const headwayAnalysis = analyzeHeadways(allTrips);
                const tripsPerHour = calculateTripsPerHour(allTrips);
                const warnings = validateSchedule(allTrips);

                // Get hours range for histogram
                const hours = Object.keys(tripsPerHour).map(Number).sort((a, b) => a - b);
                const minHour = hours.length > 0 ? hours[0] : 6;
                const maxHour = hours.length > 0 ? hours[hours.length - 1] : 22;
                const maxTripsInHour = Math.max(...Object.values(tripsPerHour), 1);

                return (
                    <div key={combined.routeName} className="flex flex-col bg-white rounded-xl shadow-sm border border-gray-100">

                        {/* 1. Header Area: Clean Card-Based Metrics */}
                        <div className="px-6 py-5 border-b border-gray-100">
                            {/* Metrics Cards Row */}
                            <div className="flex items-stretch gap-6">
                                {/* Service Card */}
                                <div className="flex flex-col justify-center">
                                    <span className="text-[10px] font-medium text-gray-400 uppercase tracking-wide mb-1">Service Window</span>
                                    <div className="flex items-baseline gap-2">
                                        <span className="text-lg font-semibold text-gray-800">{serviceSpan.start} – {serviceSpan.end}</span>
                                        <span className="text-xs text-gray-400">{serviceSpan.hours}h</span>
                                    </div>
                                </div>

                                <div className="w-px bg-gray-200" />

                                {/* Fleet Card */}
                                <div className="flex flex-col justify-center">
                                    <span className="text-[10px] font-medium text-gray-400 uppercase tracking-wide mb-1">Vehicles</span>
                                    <span className="text-lg font-semibold text-gray-800">{peakVehicles}</span>
                                </div>

                                <div className="w-px bg-gray-200" />

                                {/* Trips Card */}
                                <div className="flex flex-col justify-center">
                                    <span className="text-[10px] font-medium text-gray-400 uppercase tracking-wide mb-1">Trips</span>
                                    <span className="text-lg font-semibold text-gray-800">{totalTrips}</span>
                                </div>

                                <div className="w-px bg-gray-200" />

                                {/* Service Hours Card - Consolidated */}
                                <div className="flex flex-col justify-center">
                                    <span className="text-[10px] font-medium text-gray-400 uppercase tracking-wide mb-1">Service Hours</span>
                                    <div className="flex items-baseline gap-3">
                                        <span className="text-lg font-semibold text-gray-800">{Math.round(totalCycleSum / 60)}h</span>
                                        <span className="text-xs text-gray-400">
                                            {Math.round(totalTravelSum / 60)}h travel + {Math.round(totalRecoverySum / 60)}h recovery
                                        </span>
                                    </div>
                                </div>

                                <div className="w-px bg-gray-200" />

                                {/* Efficiency Card */}
                                <div className="flex flex-col justify-center">
                                    <span className="text-[10px] font-medium text-gray-400 uppercase tracking-wide mb-1">Recovery Ratio</span>
                                    <span className={`text-lg font-semibold ${overallRatio > 25 ? 'text-amber-600' : overallRatio < 10 ? 'text-red-600' : 'text-gray-800'}`}>
                                        {overallRatio.toFixed(0)}%
                                    </span>
                                </div>

                                <div className="w-px bg-gray-200" />

                                {/* Headway Card */}
                                <div className="flex flex-col justify-center">
                                    <span className="text-[10px] font-medium text-gray-400 uppercase tracking-wide mb-1">Avg Headway</span>
                                    <div className="flex items-baseline gap-1">
                                        <span className="text-lg font-semibold text-gray-800">{headwayAnalysis.avg}</span>
                                        <span className="text-xs text-gray-400">min</span>
                                    </div>
                                </div>

                                {/* Spacer */}
                                <div className="flex-1" />

                                {/* Round Trips/Hour Summary - Text-based */}
                                <div className="flex flex-col justify-center">
                                    <span className="text-[10px] font-medium text-gray-400 uppercase tracking-wide mb-1">Frequency</span>
                                    {(() => {
                                        // Calculate average and peak (tripsPerHour now counts round trips)
                                        const hourCounts = Object.values(tripsPerHour).filter(c => c > 0);
                                        const avgTrips = hourCounts.length > 0
                                            ? (hourCounts.reduce((a, b) => a + b, 0) / hourCounts.length).toFixed(1)
                                            : '0';

                                        // Find peak hours (hours with max trips)
                                        const peakHours = Object.entries(tripsPerHour)
                                            .filter(([_, count]) => count === maxTripsInHour && count > 0)
                                            .map(([hour]) => parseInt(hour))
                                            .sort((a, b) => a - b);

                                        // Format peak hours into ranges
                                        const formatPeakHours = (hours: number[]) => {
                                            if (hours.length === 0) return '';
                                            if (hours.length <= 2) return hours.map(h => `${h}:00`).join(', ');
                                            // Group consecutive hours
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
                                </div>
                            </div>
                        </div>



                        {/* 3. Main Table Area */}
                        <div className="overflow-auto custom-scrollbar relative w-full max-h-[70vh]">
                            {/* Scroll fade indicator */}
                            <div className="absolute right-0 top-0 bottom-0 w-12 bg-gradient-to-l from-white to-transparent pointer-events-none z-50" />

                            <table className="w-full text-left border-collapse text-[11px]" style={{ tableLayout: 'fixed' }}>
                                <colgroup>
                                    <col className="w-16" /> {/* Actions column - first */}
                                    <col className="w-14" /> {/* Block column */}
                                    {combined.northStops.map((_, i) => (
                                        <React.Fragment key={`n-col-${i}`}>
                                            {i > 0 && <col className="w-12" />}
                                            {i > 0 && <col className="w-10" />}
                                            <col />
                                        </React.Fragment>
                                    ))}
                                    {combined.southStops.map((_, i) => (
                                        <React.Fragment key={`s-col-${i}`}>
                                            {i > 0 && <col className="w-12" />}
                                            {i > 0 && <col className="w-10" />}
                                            <col />
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
                                            // Actions column
                                            cells.push(<th key="col-actions" className="py-0.5 px-1 border-b border-gray-200 bg-gray-100 sticky left-0 z-50 text-[8px] font-mono text-gray-400 text-center">{colNum++}</th>);
                                            // Block column
                                            cells.push(<th key="col-block" className="py-0.5 px-1 border-b border-gray-200 bg-gray-100 sticky left-16 z-50 text-[8px] font-mono text-gray-400 text-center">{colNum++}</th>);
                                            // North stops
                                            combined.northStops.forEach((stop, i) => {
                                                if (i > 0) {
                                                    cells.push(<th key={`col-n-arr-${i}`} className="py-0.5 px-1 border-b border-gray-200 text-[8px] font-mono text-gray-400 text-center">{colNum++}</th>);
                                                    cells.push(<th key={`col-n-rec-${i}`} className="py-0.5 px-1 border-b border-gray-200 text-[8px] font-mono text-gray-400 text-center">{colNum++}</th>);
                                                }
                                                cells.push(<th key={`col-n-stop-${i}`} className="py-0.5 px-1 border-b border-gray-200 bg-blue-50/30 text-[8px] font-mono text-blue-600 text-center">{colNum++}</th>);
                                            });
                                            // South stops
                                            combined.southStops.forEach((stop, i) => {
                                                if (i > 0) {
                                                    cells.push(<th key={`col-s-arr-${i}`} className="py-0.5 px-1 border-b border-gray-200 text-[8px] font-mono text-gray-400 text-center">{colNum++}</th>);
                                                    cells.push(<th key={`col-s-rec-${i}`} className="py-0.5 px-1 border-b border-gray-200 text-[8px] font-mono text-gray-400 text-center">{colNum++}</th>);
                                                }
                                                cells.push(<th key={`col-s-stop-${i}`} className="py-0.5 px-1 border-b border-gray-200 bg-orange-50/30 text-[8px] font-mono text-orange-600 text-center">{colNum++}</th>);
                                            });
                                            // Summary columns: Travel, Band, Rec, Ratio, Hdwy, Cycle, Link
                                            ['Tr', 'Bd', 'Rc', 'Rt', 'Hw', 'Cy', 'Lk'].forEach((label, i) => {
                                                cells.push(<th key={`col-sum-${i}`} className="py-0.5 px-1 border-b border-gray-200 bg-gray-50 text-[8px] font-mono text-gray-400 text-center">{colNum++}</th>);
                                            });
                                            return cells;
                                        })()}
                                    </tr>
                                    {/* Stop Names Row */}
                                    <tr className="bg-white text-gray-500">
                                        <th className="p-2 border-b border-gray-200 bg-gray-100 sticky left-0 z-50 text-[9px] font-medium text-gray-400 uppercase text-center align-bottom"></th>
                                        <th className="p-2 border-b border-gray-200 bg-gray-100 sticky left-16 z-50 text-[10px] font-semibold text-gray-500 uppercase tracking-wide text-center align-bottom">Block</th>
                                        {/* North Stops */}
                                        {combined.northStops.map((stop, i) => (
                                            <React.Fragment key={`n-h-${stop}`}>
                                                {i > 0 && <th className="py-2 px-1 border-b border-gray-200 bg-white text-center text-[9px] font-medium text-gray-400 uppercase align-bottom">Arr</th>}
                                                {i > 0 && <th className="py-2 px-1 border-b border-gray-200 bg-white text-center text-[9px] font-medium text-gray-400 align-bottom">R</th>}
                                                <th className="p-2 border-b border-gray-200 bg-blue-50/50 text-[9px] font-semibold text-blue-700 uppercase tracking-tight text-center align-bottom" style={{ width: '80px', minWidth: '80px', maxWidth: '80px' }} title={stop}>
                                                    <div className="break-words leading-tight">
                                                        {stop}
                                                    </div>
                                                </th>
                                            </React.Fragment>
                                        ))}

                                        {/* South Stops */}
                                        {combined.southStops.map((stop, i) => (
                                            <React.Fragment key={`s-h-${stop}`}>
                                                {i > 0 && <th className="py-2 px-1 border-b border-gray-200 bg-white text-center text-[9px] font-medium text-gray-400 uppercase align-bottom">Arr</th>}
                                                {i > 0 && <th className="py-2 px-1 border-b border-gray-200 bg-white text-center text-[9px] font-medium text-gray-400 align-bottom">R</th>}
                                                <th className="p-2 border-b border-gray-200 bg-orange-50/50 text-[9px] font-semibold text-orange-700 uppercase tracking-tight text-center align-bottom" style={{ width: '80px', minWidth: '80px', maxWidth: '80px' }} title={stop}>
                                                    <div className="break-words leading-tight">
                                                        {stop}
                                                    </div>
                                                </th>
                                            </React.Fragment>
                                        ))}

                                        <th className="py-2 px-1 border-b border-gray-200 bg-gray-50 text-center text-[9px] font-medium text-gray-400 uppercase align-bottom">Travel</th>
                                        <th className="py-2 px-1 border-b border-gray-200 bg-gray-50 text-center text-[9px] font-medium text-gray-400 uppercase align-bottom">Band</th>
                                        <th className="py-2 px-1 border-b border-gray-200 bg-gray-50 text-center text-[9px] font-medium text-gray-400 uppercase align-bottom">Rec</th>
                                        <th className="py-2 px-1 border-b border-gray-200 bg-gray-50 text-center text-[9px] font-medium text-gray-400 uppercase align-bottom">Ratio</th>
                                        <th className="py-2 px-1 border-b border-gray-200 bg-gray-50 text-center text-[9px] font-medium text-gray-400 uppercase align-bottom">Hdwy</th>
                                        <th className="py-2 px-1 border-b border-gray-200 bg-gray-50 text-center text-[9px] font-medium text-gray-400 uppercase align-bottom">Cycle</th>
                                        <th className="py-2 px-1 border-b border-gray-200 bg-gray-50 text-center text-[9px] font-medium text-blue-500 uppercase align-bottom" title="Interline connections">Link</th>
                                    </tr>
                                </thead>

                                <tbody className="divide-y divide-gray-100">
                                    {combined.rows.map((row, rowIdx) => {
                                        const northTrip = row.trips.find(t => t.direction === 'North');
                                        const southTrip = row.trips.find(t => t.direction === 'South');
                                        const lastTrip = [...row.trips].sort((a, b) => a.startTime - b.startTime).pop();

                                        // Fix Unique Key: Combined blocks span multiple trips, so blockId alone is duplicated. Use composite key.
                                        const uniqueRowKey = `${row.blockId}-${northTrip?.id || 'n'}-${southTrip?.id || 's'}-${rowIdx}`;

                                        // Combined Metrics
                                        const totalTravel = (northTrip?.travelTime || 0) + (southTrip?.travelTime || 0);
                                        const totalRec = (northTrip?.recoveryTime || 0) + (southTrip?.recoveryTime || 0);
                                        const ratio = totalTravel > 0 ? (totalRec / totalTravel) * 100 : 0;

                                        // Headway from first trip in block (usually North start)
                                        const headway = northTrip ? headways[northTrip.id] : (southTrip ? headways[southTrip.id] : '-');

                                        // Ratio Color Logic using new thresholds
                                        const ratioColorClass = getRatioColor(ratio);

                                        // Apply band color to row, falling back to alternating gray
                                        const assignedBand = northTrip?.assignedBand || southTrip?.assignedBand;
                                        const bandColor = getBandRowColor(assignedBand);
                                        const rowBg = bandColor || (rowIdx % 2 === 0 ? 'bg-white' : 'bg-gray-50/50');

                                        // Apply filters
                                        const tripStartTime = northTrip?.startTime || southTrip?.startTime || 0;
                                        const tripEndTime = northTrip?.endTime || southTrip?.endTime || 0;
                                        const isGrayedOut = filter ? shouldGrayOutTrip(tripStartTime, tripEndTime, filter) : false;
                                        const isHighlighted = filter ? shouldHighlightTrip(totalTravel, totalRec, typeof headway === 'number' ? headway : null, filter) : false;
                                        const matchesSearchFilter = filter ? matchesSearch(row.blockId, [...combined.northStops, ...combined.southStops], filter.search) : true;

                                        // Gray out class
                                        const grayOutClass = isGrayedOut ? 'opacity-40' : '';
                                        // Highlight class for filter matches
                                        const filterHighlightClass = isHighlighted ? 'bg-amber-50 ring-2 ring-inset ring-amber-200' : '';
                                        // Search match - hide rows that don't match
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
                                                {/* Actions Column - First */}
                                                <td className={`p-1 border-r border-gray-100 sticky left-0 ${rowBg} group-hover:bg-gray-100 z-30`}>
                                                    <div className="flex items-center justify-center gap-0.5">
                                                        {/* Add Trip Button */}
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
                                                        {/* Edit Button */}
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
                                                        {/* Delete Button */}
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

                                                {/* Sticky Block ID */}
                                                <td className={`p-3 border-r border-gray-100 sticky left-16 ${rowBg} group-hover:bg-gray-100 z-30 font-medium text-xs text-gray-700 text-center`}>
                                                    <span>{row.blockId}</span>
                                                </td>

                                                {/* North Cells */}
                                                {combined.northStops.map((stop, i) => (
                                                    <React.Fragment key={`n-${stop}`}>
                                                        {i > 0 && (
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
                                                                    <span className="px-2">{northTrip?.arrivalTimes?.[stop] || ''}</span>
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
                                                        {i > 0 && (
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
                                                                {/* Down Arrow */}
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
                                                                    value={northTrip?.stops[stop] || ''}
                                                                    onChange={(val) => northTrip && onCellEdit(northTrip.id, stop, val)}
                                                                    onBlur={(val) => {
                                                                        if (northTrip && val) {
                                                                            const originalValue = northTrip.stops[stop];
                                                                            const formatted = parseTimeInput(val, originalValue);
                                                                            if (formatted) onCellEdit(northTrip.id, stop, formatted);
                                                                        }
                                                                    }}
                                                                    disabled={!northTrip}
                                                                    focusClass="focus:ring-blue-100"
                                                                />
                                                                {/* Up Arrow */}
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
                                                        {i > 0 && (
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
                                                                    <span className="px-2">{southTrip?.arrivalTimes?.[stop] || ''}</span>
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
                                                        {i > 0 && (
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
                                                                {/* Down Arrow */}
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
                                                                    value={southTrip?.stops[stop] || ''}
                                                                    onChange={(val) => southTrip && onCellEdit(southTrip.id, stop, val)}
                                                                    onBlur={(val) => {
                                                                        if (southTrip && val) {
                                                                            const originalValue = southTrip.stops[stop];
                                                                            const formatted = parseTimeInput(val, originalValue);
                                                                            if (formatted) onCellEdit(southTrip.id, stop, formatted);
                                                                        }
                                                                    }}
                                                                    disabled={!southTrip}
                                                                    focusClass="focus:ring-indigo-100"
                                                                />
                                                                {/* Up Arrow */}
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
                                                    {/* Band indicator - subtle pill */}
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

                                                {/* Ratio - only highlight if out of range */}
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

                                                        // Show badges for any interline connections
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
        </div >
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
    onDuplicateTrip?: (tripId: string) => void;
    onAddTrip?: (blockId: string, afterTripId: string) => void;
}

const SingleRouteView: React.FC<SingleRouteViewProps> = ({ table, showSummary = true, originalTable, onCellEdit, onRecoveryEdit, onTimeAdjust, onDeleteTrip, onDuplicateTrip, onAddTrip }) => {
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

    // Hardcoded interline cycle configurations by route
    // Format: { firstDep, interlineArr, recoveryCol, resumeCol }
    // Formula: (interlineArr - firstDep) + recoveryCol + (lastTimepoint - resumeCol)
    // Note: lastTimepoint is dynamically found as the last column with a time value
    const INTERLINE_CYCLE_CONFIG: { [routePattern: string]: { firstDep: number; interlineArr: number; recoveryCol: number; resumeCol: number } } = {
        '8A': { firstDep: 2, interlineArr: 12, recoveryCol: 13, resumeCol: 14 },
        '8B': { firstDep: 2, interlineArr: 3, recoveryCol: 4, resumeCol: 5 },
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

    // Calculate effective cycle time for interlined trips using hardcoded column indices
    const getEffectiveCycleTime = (trip: MasterTrip): { value: number; hasGap: boolean; gap: number } => {
        // Check if this route has a hardcoded interline config
        const routeName = table.routeName || '';
        let config: typeof INTERLINE_CYCLE_CONFIG[string] | null = null;

        for (const [pattern, cfg] of Object.entries(INTERLINE_CYCLE_CONFIG)) {
            if (routeName.includes(pattern)) {
                config = cfg;
                break;
            }
        }

        // If no hardcoded config, check if trip has interline markers
        if (!config) {
            if (!trip.interlineNext?.stopName) {
                return { value: trip.cycleTime, hasGap: false, gap: 0 };
            }
            // Fall back to original dynamic logic for non-hardcoded routes
            return { value: trip.cycleTime, hasGap: false, gap: 0 };
        }

        // Use hardcoded column-based calculation
        // For partial trips (starting mid-route), use dynamic first timepoint instead of hardcoded column
        let firstDep = getColumnValue(trip, config.firstDep);
        if (firstDep === null) {
            // Trip doesn't start at the expected column - use actual first departure
            firstDep = getFirstTimepointValue(trip);
        }

        const interlineArr = getColumnValue(trip, config.interlineArr);
        const recovery = getColumnValue(trip, config.recoveryCol);
        const resume = getColumnValue(trip, config.resumeCol);
        const finalArr = getLastTimepointValue(trip); // Dynamic: last column with time

        // Helper to handle midnight crossing
        const timeDiff = (end: number, start: number): number => {
            const diff = end - start;
            return diff < 0 ? diff + 1440 : diff; // 1440 = 24 hours in minutes
        };

        // Check if trip ENDS at interline point (no resume column = one-way interline)
        // These trips hand off to the other route and don't continue
        const endsAtInterline = resume === null && interlineArr !== null;

        if (endsAtInterline) {
            // Trip ends at interline: cycle = (interlineArr - firstDep) + recovery
            // No segment 2 because trip doesn't continue after interline
            if (firstDep === null || interlineArr === null) {
                return { value: trip.cycleTime, hasGap: false, gap: 0 };
            }
            const segment1 = timeDiff(interlineArr, firstDep);
            const recoveryVal = recovery ?? 0;
            const effectiveCycle = segment1 + recoveryVal;
            return { value: effectiveCycle, hasGap: true, gap: effectiveCycle - trip.cycleTime };
        }

        // If any required value is missing for full interline calculation, fall back
        if (firstDep === null || interlineArr === null || recovery === null || resume === null || finalArr === null) {
            return { value: trip.cycleTime, hasGap: false, gap: 0 };
        }

        // Full interline: (interlineArr - firstDep) + recovery + (lastTimepoint - resume)
        const segment1 = timeDiff(interlineArr, firstDep);
        const segment2 = timeDiff(finalArr, resume);
        const effectiveCycle = segment1 + recovery + segment2;

        return { value: effectiveCycle, hasGap: true, gap: effectiveCycle - trip.cycleTime };
    };

    return (
        <div className="flex flex-col gap-6 h-full">
            <div className="bg-white border border-gray-200 rounded-lg shadow-sm overflow-hidden flex-grow flex flex-col">
                <div className="bg-gray-50 px-4 py-3 border-b border-gray-200">
                    <h3 className="font-bold text-gray-900">{table.routeName}</h3>
                </div>
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
                                    // Stop columns with optional recovery
                                    table.stops.forEach((stop, i) => {
                                        cells.push(<th key={`col-stop-${i}`} className="py-0.5 px-1 border-b border-gray-300 bg-blue-100 text-[9px] font-mono font-bold text-blue-700 text-center">{colNum++}</th>);
                                        if (stopsWithRecovery.has(stop)) {
                                            cells.push(<th key={`col-rec-${i}`} className="py-0.5 px-1 border-b border-gray-300 bg-gray-100 text-[9px] font-mono font-bold text-gray-500 text-center">{colNum++}</th>);
                                        }
                                    });
                                    // Summary columns: Trav, Rec, Ratio, Hdwy, Cycle, Actions
                                    ['Tr', 'Rc', 'Rt', 'Hw', 'Cy', 'Ac'].forEach((_, i) => {
                                        cells.push(<th key={`col-sum-${i}`} className="py-0.5 px-1 border-b border-gray-300 bg-gray-100 text-[9px] font-mono font-bold text-gray-500 text-center">{colNum++}</th>);
                                    });
                                    return cells;
                                })()}
                            </tr>
                            {/* Header Labels Row */}
                            <tr>
                                <th className="p-2 border-b bg-gray-50 sticky left-0 z-30 text-xs font-semibold text-gray-500 uppercase align-bottom">Block</th>
                                {table.stops.map(stop => (
                                    <React.Fragment key={stop}>
                                        <th className="p-2 border-b text-[10px] font-semibold text-gray-700 uppercase text-center align-bottom" style={{ width: '80px', minWidth: '80px', maxWidth: '80px' }} title={stop}>
                                            <div className="break-words leading-tight">
                                                {stop}
                                            </div>
                                        </th>
                                        {stopsWithRecovery.has(stop) && <th className="p-2 border-b text-center text-xs font-semibold bg-gray-50/50 align-bottom">R</th>}
                                    </React.Fragment>
                                ))}
                                <th className="p-2 border-b text-center text-xs font-semibold align-bottom">Trav</th>
                                <th className="p-2 border-b text-center text-xs font-semibold align-bottom">Rec</th>
                                <th className="p-2 border-b text-center text-xs font-semibold align-bottom">Ratio</th>
                                <th className="p-2 border-b text-center text-xs font-semibold align-bottom">Hdwy</th>
                                <th className="p-2 border-b text-center text-xs font-semibold align-bottom">Cycle</th>
                                <th className="p-2 border-b text-center text-xs font-semibold align-bottom">Actions</th>
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

                                        // Check if this stop is an interline point
                                        // Only match the FIRST occurrence (base name or (2) variant) - not (3), (4) etc. which are southbound
                                        // Also verify the cell time matches the interline time (respects time range from rule)
                                        const normalizeStop = (s: string) => s.toLowerCase().trim().replace(/\s+/g, ' ');
                                        const stripSuffix = (s: string) => s.replace(/\s*\(\d+\)$/, '');
                                        const getSuffix = (s: string) => {
                                            const match = s.match(/\((\d+)\)$/);
                                            return match ? parseInt(match[1]) : 0;
                                        };

                                        const cellTime = TimeUtils.toMinutes(trip.stops[stop]);

                                        // Outgoing: match base name (no suffix) AND verify this cell's time matches the interline time
                                        const isInterlineOutgoing = trip.interlineNext?.stopName &&
                                            stripSuffix(normalizeStop(stop)) === stripSuffix(normalizeStop(trip.interlineNext.stopName)) &&
                                            getSuffix(stop) === 0 && // Only the base stop (no number suffix)
                                            cellTime !== null &&
                                            Math.abs(cellTime - trip.interlineNext.time) <= 5; // Time must match within 5 min

                                        // Incoming: match the (2) variant - this is where bus departs after receiving handoff
                                        // Verify cell time is close to interline time + dwell (within 10 min)
                                        const isInterlineIncoming = trip.interlinePrev?.stopName &&
                                            stripSuffix(normalizeStop(stop)) === stripSuffix(normalizeStop(trip.interlinePrev.stopName)) &&
                                            getSuffix(stop) === 2 && // Only the (2) variant
                                            cellTime !== null &&
                                            cellTime >= trip.interlinePrev.time && // Cell time must be after interline time
                                            cellTime <= trip.interlinePrev.time + 15; // Within 15 min of interline (dwell + buffer)

                                        return (
                                            <React.Fragment key={stop}>
                                                <td className={`p-0 border-r relative group/time ${isInterlineOutgoing ? 'bg-blue-50' : ''} ${isInterlineIncoming ? 'bg-purple-50' : ''}`}>
                                                    <div className="flex items-center justify-center">
                                                        <input
                                                            type="text"
                                                            value={trip.stops[stop] || ''}
                                                            onChange={(e) => onCellEdit(trip.id, stop, sanitizeInput(e.target.value))}
                                                            onBlur={(e) => {
                                                                if (e.target.value) {
                                                                    const originalValue = trip.stops[stop];
                                                                    const formatted = parseTimeInput(e.target.value, originalValue);
                                                                    if (formatted) onCellEdit(trip.id, stop, formatted);
                                                                }
                                                            }}
                                                            className={`w-full h-full bg-transparent font-mono text-xs text-center p-1 focus:bg-white focus:outline-none ${timeDiff !== 0 ? 'font-bold' : ''}`}
                                                        />
                                                        {/* Interline badge at the stop where it occurs */}
                                                        {isInterlineOutgoing && (
                                                            <span
                                                                className="absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2 z-10 inline-flex items-center gap-0.5 px-1 py-0.5 bg-blue-500 text-white rounded text-[8px] font-bold shadow-sm whitespace-nowrap"
                                                                title={`Continues as ${trip.interlineNext!.route} at ${trip.interlineNext!.stopName}`}
                                                            >
                                                                <ArrowRight size={8} />{trip.interlineNext!.route}
                                                            </span>
                                                        )}
                                                        {isInterlineIncoming && (
                                                            <span
                                                                className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 z-10 inline-flex items-center gap-0.5 px-1 py-0.5 bg-purple-500 text-white rounded text-[8px] font-bold shadow-sm whitespace-nowrap"
                                                                title={`Came from ${trip.interlinePrev!.route} at ${trip.interlinePrev!.stopName}`}
                                                            >
                                                                <ArrowLeft size={8} />{trip.interlinePrev!.route}
                                                            </span>
                                                        )}
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


// --- Main Editor Component ---

// Time Band type for display
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

    // Optional time bands for display
    bands?: TimeBandDisplay[];

    // Optional analysis data for Travel Times view
    analysis?: TripBucketAnalysisDisplay[];
    segmentNames?: string[];

    // Target values for strict mode highlighting (in minutes)
    targetCycleTime?: number;
    targetHeadway?: number;
    // Hide autosave when parent handles it
    hideAutoSave?: boolean;
    // Force simple view even when both North/South tables exist
    forceSimpleView?: boolean;

    // Upload to Master Schedule (optional - only shown if teamId is provided)
    teamId?: string;
    userId?: string;
    uploaderName?: string;

    // Interline configuration (optional - for persistence)
    initialInterlineConfig?: InterlineConfig;
    onInterlineConfigChange?: (config: InterlineConfig) => void;
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
    showSuccessToast,
    bands,
    analysis,
    segmentNames,
    targetCycleTime,
    targetHeadway,
    hideAutoSave,
    forceSimpleView,
    teamId,
    userId,
    uploaderName,
    initialInterlineConfig,
    onInterlineConfigChange
}) => {
    const [activeRouteIdx, setActiveRouteIdx] = useState(0);
    const [activeDay, setActiveDay] = useState<string>('Weekday');
    const [subView, setSubView] = useState<'editor' | 'matrix' | 'timeline'>('editor');
    const [selectedTripId, setSelectedTripId] = useState<string | null>(null);
    const [isFullScreen, setIsFullScreen] = useState(false);
    const [showComparisonModal, setShowComparisonModal] = useState(false);
    const [showAuditLog, setShowAuditLog] = useState(false);

    // Upload to Master State
    const [showUploadModal, setShowUploadModal] = useState(false);
    const [showBulkUploadModal, setShowBulkUploadModal] = useState(false);
    const [uploadConfirmation, setUploadConfirmation] = useState<UploadConfirmation | null>(null);
    const [isUploading, setIsUploading] = useState(false);
    const [uploadRouteKey, setUploadRouteKey] = useState<{ routeNumber: string; dayType: DayType } | null>(null);

    // Interline Configuration State
    const [showInterlineConfig, setShowInterlineConfig] = useState(false);
    const [interlineConfig, setInterlineConfigInternal] = useState<InterlineConfig>(
        initialInterlineConfig || { rules: [] }
    );

    // Wrapper to notify parent when interline config changes
    const setInterlineConfig = (config: InterlineConfig) => {
        setInterlineConfigInternal(config);
        onInterlineConfigChange?.(config);
    };

    // Handler to apply interline rules to schedules
    const handleApplyInterlineRules = () => {
        const cloned = deepCloneSchedules(schedules);
        clearInterlineMetadata(cloned);
        const result = applyInterlineRules(cloned, interlineConfig.rules);
        onSchedulesChange(cloned);
        showSuccessToast(`Applied ${result.applied} interline connection(s)`);
        setShowInterlineConfig(false);
    };

    // Auto-initialize and auto-apply interline rules for 8A/8B routes
    const [hasAutoAppliedInterline, setHasAutoAppliedInterline] = useState(false);

    useEffect(() => {
        // Only run once when schedules are loaded and we haven't auto-applied yet
        if (hasAutoAppliedInterline || schedules.length === 0) return;

        // Extract route names
        const routeNames = new Set<string>();
        schedules.forEach(t => {
            const match = t.routeName.match(/^([\dA-Za-z]+)/);
            if (match) routeNames.add(match[1]);
        });

        const has8A = routeNames.has('8A');
        const has8B = routeNames.has('8B');

        // Only proceed if both 8A and 8B exist
        if (!has8A || !has8B) return;

        // Find the interline stop
        const allStops = new Set<string>();
        schedules.forEach(t => t.stops.forEach(s => allStops.add(s)));
        const stopsArray = Array.from(allStops);
        const atStop = stopsArray.find(s => s.toLowerCase().includes('barrie allandale transit terminal'))
            || stopsArray.find(s => s.toLowerCase().includes('allandale'))
            || stopsArray[0] || '';

        if (!atStop) return;

        // Create default rules if config is empty
        const needsDefaultRules = interlineConfig.rules.length === 0;

        const defaultRules: InterlineRule[] = needsDefaultRules ? [
            // Weekday/Saturday rules (8 PM to 1:35 AM)
            {
                id: 'rule-8a-8b-weekday',
                fromRoute: '8A',
                fromDirection: 'North' as const,
                toRoute: '8B',
                toDirection: 'North' as const,
                atStop,
                timeRange: { start: 1200, end: 1535 },
                days: ['Weekday', 'Saturday'] as ('Weekday' | 'Saturday' | 'Sunday')[],
                enabled: true
            },
            {
                id: 'rule-8b-8a-weekday',
                fromRoute: '8B',
                fromDirection: 'North' as const,
                toRoute: '8A',
                toDirection: 'North' as const,
                atStop,
                timeRange: { start: 1200, end: 1535 },
                days: ['Weekday', 'Saturday'] as ('Weekday' | 'Saturday' | 'Sunday')[],
                enabled: true
            },
            // Sunday rules (All Day)
            {
                id: 'rule-8a-8b-sunday',
                fromRoute: '8A',
                fromDirection: 'North' as const,
                toRoute: '8B',
                toDirection: 'North' as const,
                atStop,
                timeRange: { start: 0, end: 1535 },
                days: ['Sunday'] as ('Weekday' | 'Saturday' | 'Sunday')[],
                enabled: true
            },
            {
                id: 'rule-8b-8a-sunday',
                fromRoute: '8B',
                fromDirection: 'North' as const,
                toRoute: '8A',
                toDirection: 'North' as const,
                atStop,
                timeRange: { start: 0, end: 1535 },
                days: ['Sunday'] as ('Weekday' | 'Saturday' | 'Sunday')[],
                enabled: true
            }
        ] : interlineConfig.rules;

        // Update config with default rules if needed
        if (needsDefaultRules) {
            setInterlineConfig({
                ...interlineConfig,
                rules: defaultRules,
                lastUpdated: new Date().toISOString()
            });
        }

        // Auto-apply rules (only enabled ones)
        const enabledRules = defaultRules.filter(r => r.enabled);
        if (enabledRules.length > 0) {
            const cloned = deepCloneSchedules(schedules);
            clearInterlineMetadata(cloned);
            const result = applyInterlineRules(cloned, enabledRules);
            if (result.applied > 0) {
                onSchedulesChange(cloned);
            }
        }

        setHasAutoAppliedInterline(true);
    }, [schedules, interlineConfig.rules.length, hasAutoAppliedInterline]);

    // Quick Actions Bar Filter State
    const [filter, setFilter] = useState<FilterState>({
        timeRange: { start: null, end: null },
        highlight: null,
        search: ''
    });

    // Context Menu State
    const [contextMenu, setContextMenu] = useState<{
        x: number;
        y: number;
        tripId: string;
        tripDirection: 'North' | 'South';
        blockId: string;
        stopName?: string;
        stopIndex?: number;
        stops: string[];
    } | null>(null);

    // Audit Log
    const { entries: auditEntries, logAction } = useAuditLog();

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
        }).sort((a, b) => {
            // Sort numerically, largest to smallest
            const numA = parseInt(a.name.replace(/\D/g, '')) || 0;
            const numB = parseInt(b.name.replace(/\D/g, '')) || 0;
            return numB - numA; // Descending order
        });
    }, [schedules]);

    console.log('ScheduleEditor consolidatedRoutes:', consolidatedRoutes.length, consolidatedRoutes.map(r => ({
        name: r.name,
        days: Object.keys(r.days),
        hasNorth: !!r.days['Weekday']?.north,
        hasSouth: !!r.days['Weekday']?.south,
        hasCombined: !!r.days['Weekday']?.combined,
        northTrips: r.days['Weekday']?.north?.trips?.length || 0,
        southTrips: r.days['Weekday']?.south?.trips?.length || 0
    })));



    // Auto-select day if current is invalid
    useEffect(() => {
        if (!consolidatedRoutes.length) return;
        const group = consolidatedRoutes[activeRouteIdx];
        if (!group) return;

        if (!group.days[activeDay]) {
            // Pick first available day
            const firstAvailable = Object.keys(group.days)[0];
            if (firstAvailable) setActiveDay(firstAvailable);
        }
    }, [consolidatedRoutes, activeRouteIdx, activeDay]);

    // Keyboard shortcuts: Ctrl+S (save), Ctrl+Z (undo), Ctrl+Y (redo), Escape (exit fullscreen)
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            // Ctrl+S: Save version
            if (e.ctrlKey && e.key === 's') {
                e.preventDefault();
                onSaveVersion();
                showSuccessToast('Version saved');
            }
            // Ctrl+Z: Undo
            if (e.ctrlKey && e.key === 'z' && !e.shiftKey) {
                e.preventDefault();
                if (canUndo) undo();
            }
            // Ctrl+Y or Ctrl+Shift+Z: Redo
            if ((e.ctrlKey && e.key === 'y') || (e.ctrlKey && e.shiftKey && e.key === 'z')) {
                e.preventDefault();
                if (canRedo) redo();
            }
            // Escape: Exit fullscreen
            if (e.key === 'Escape' && isFullScreen) {
                setIsFullScreen(false);
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [canUndo, canRedo, undo, redo, onSaveVersion, showSuccessToast, isFullScreen]);

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

                // For generated schedules, endTime is already the departure time from the last stop
                // (includes recovery). For imported schedules, endTime may be arrival time.
                // Use endTime directly as the expected start of the next trip.
                const expectedStart = currentEndTime;

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

        const oldValue = trip.stops[col];
        const oldTime = TimeUtils.toMinutes(oldValue);
        const newTime = TimeUtils.toMinutes(val);
        const colIdx = table.stops.indexOf(col);

        // Log the edit to audit log
        if (oldValue !== val) {
            logAction('edit', `Edited ${col} time`, {
                tripId,
                blockId: trip.blockId,
                field: col,
                oldValue: oldValue || '-',
                newValue: val || '-'
            });
        }

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
            const tripToDelete = t.trips.find(x => x.id === tripId);
            if (tripToDelete) {
                // Log deletion to audit log
                logAction('delete', `Deleted trip from Block ${tripToDelete.blockId}`, {
                    tripId,
                    blockId: tripToDelete.blockId,
                    field: 'trip'
                });
                t.trips = t.trips.filter(x => x.id !== tripId);
                validateRouteTable(t);
                break;
            }
        }
        onSchedulesChange(newScheds);
    };

    // Context Menu Action Handler
    const handleContextMenuAction = (action: TripContextMenuAction) => {
        switch (action.type) {
            case 'deleteTrip':
                handleDeleteTrip(action.tripId);
                break;

            case 'addTripAfter':
                // Find the trip and open add modal
                const addResult = findTableAndTrip(schedules, action.tripId);
                if (addResult) {
                    // openModal expects (afterTripId, routeData)
                    openAddTripModal(action.tripId, { north: undefined, south: undefined });
                }
                break;

            case 'endBlockHere':
                if (action.stopIndex !== undefined) {
                    // Set endStopIndex on this trip
                    let newScheds = setTripEndStop(schedules, action.tripId, action.stopIndex);

                    // Also remove all subsequent trips in this block
                    newScheds = endBlockAtTrip(newScheds, action.tripId);

                    logAction('edit', `Ended block at stop ${action.stopName}`, {
                        tripId: action.tripId,
                        field: 'endStopIndex',
                        newValue: action.stopIndex
                    });

                    onSchedulesChange(newScheds);
                    showSuccessToast('Block ended - subsequent trips removed');
                }
                break;

            case 'startBlockHere':
                if (action.stopIndex !== undefined) {
                    const newScheds = setTripStartStop(schedules, action.tripId, action.stopIndex);

                    logAction('edit', `Started block at stop ${action.stopName}`, {
                        tripId: action.tripId,
                        field: 'startStopIndex',
                        newValue: action.stopIndex
                    });

                    onSchedulesChange(newScheds);
                    showSuccessToast('Block start point updated');
                }
                break;

            case 'duplicateTrip':
                handleDuplicateTrip(action.tripId);
                break;
        }
        setContextMenu(null);
    };

    // Duplicate trip handler - clones a trip with +1 minute offset
    const handleDuplicateTrip = (tripId: string) => {
        const newScheds = deepCloneSchedules(schedules);
        const result = findTableAndTrip(newScheds, tripId);
        if (!result) return;

        const { table, trip } = result;

        // Create a new trip as a clone
        const newTrip: MasterTrip = {
            ...JSON.parse(JSON.stringify(trip)),
            id: `${trip.id}-dup-${Date.now()}`,
            tripNumber: table.trips.length + 1,
            startTime: trip.startTime + 1, // Offset by 1 minute
            endTime: trip.endTime + 1,
        };

        // Shift all stop times by 1 minute
        Object.keys(newTrip.stops).forEach(stop => {
            if (newTrip.stops[stop]) {
                newTrip.stops[stop] = TimeUtils.addMinutes(newTrip.stops[stop], 1);
            }
        });

        // Insert after the source trip
        const tripIndex = table.trips.findIndex(t => t.id === tripId);
        table.trips.splice(tripIndex + 1, 0, newTrip);

        // Re-sort by start time
        table.trips.sort((a, b) => a.startTime - b.startTime);

        // Reassign trip numbers
        table.trips.forEach((t, i) => { t.tripNumber = i + 1; });

        validateRouteTable(table);

        logAction('add', `Duplicated trip from Block ${trip.blockId}`, {
            tripId: newTrip.id,
            blockId: newTrip.blockId,
            field: 'trip'
        });

        onSchedulesChange(newScheds);
        showSuccessToast('Trip duplicated');
    };

    // Right-click handler for trip rows
    const handleTripRightClick = (
        e: React.MouseEvent,
        tripId: string,
        tripDirection: 'North' | 'South',
        blockId: string,
        stops: string[],
        stopName?: string,
        stopIndex?: number
    ) => {
        e.preventDefault();
        setContextMenu({
            x: e.clientX,
            y: e.clientY,
            tripId,
            tripDirection,
            blockId,
            stopName,
            stopIndex,
            stops
        });
    };

    // Menu open handler for kebab button click
    const handleMenuOpen = (
        tripId: string,
        x: number,
        y: number,
        tripDirection: 'North' | 'South',
        blockId: string,
        stops: string[]
    ) => {
        setContextMenu({
            x,
            y,
            tripId,
            tripDirection,
            blockId,
            stops
        });
    };

    // Timeline drag handler - updates trip times from timeline view
    const handleTimelineTripTimeChange = (tripId: string, newStartTime: number, newDuration: number) => {
        const newScheds = deepCloneSchedules(schedules);
        const result = findTableAndTrip(newScheds, tripId);
        if (!result) return;

        const { table, trip } = result;
        const oldStartTime = trip.startTime;
        const delta = newStartTime - oldStartTime;

        // Shift all stop times by the delta
        Object.keys(trip.stops).forEach(stop => {
            const t = TimeUtils.toMinutes(trip.stops[stop]);
            if (t !== null) {
                trip.stops[stop] = TimeUtils.fromMinutes(t + delta);
            }
        });

        // Update trip computed values
        trip.startTime = newStartTime;
        trip.endTime = newStartTime + newDuration;
        trip.travelTime = newDuration;

        // Recalculate derived values
        recalculateTrip(trip, table.stops);
        validateRouteTable(table);

        logAction('edit', `Timeline: Moved trip to ${TimeUtils.fromMinutes(newStartTime)}`, {
            tripId,
            blockId: trip.blockId,
            field: 'startTime',
            oldValue: TimeUtils.fromMinutes(oldStartTime),
            newValue: TimeUtils.fromMinutes(newStartTime)
        });

        onSchedulesChange(newScheds);
    };

    // Handle trip selection from timeline
    const handleTripSelect = (tripId: string) => {
        setSelectedTripId(tripId);
    };

    const handleBulkAdjustTravelTime = (fromStop: string, toStop: string, delta: number, routeName: string) => {
        const newScheds = deepCloneSchedules(schedules);
        const targetTable = newScheds.find(t => t.routeName === routeName);
        if (!targetTable) return;

        const toIdx = targetTable.stops.indexOf(toStop);
        if (toIdx === -1) return;

        // Log bulk adjustment
        logAction('bulk_adjust', `Bulk travel time ${delta > 0 ? '+' : ''}${delta} min`, {
            field: `${fromStop} → ${toStop}`,
            newValue: delta,
            count: targetTable.trips.length
        });

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

    // --- Upload to Master Handlers ---

    // Get routes available for upload (combines North/South tables for each route-day)
    const routesForUpload = useMemo((): RouteForUpload[] => {
        const result: RouteForUpload[] = [];
        consolidatedRoutes.forEach(group => {
            Object.entries(group.days).forEach(([dayType, dayData]) => {
                const north = dayData.north;
                const south = dayData.south;
                if (north || south) {
                    result.push({
                        routeNumber: group.name,
                        dayType: dayType as DayType,
                        displayName: `Route ${group.name} (${dayType})`,
                        tripCount: (north?.trips.length || 0) + (south?.trips.length || 0),
                        northStopCount: north?.stops.length || 0,
                        southStopCount: south?.stops.length || 0
                    });
                }
            });
        });
        return result;
    }, [consolidatedRoutes]);

    // Get North/South tables for a specific route-day
    const getTablesForRoute = (routeNumber: string, dayType: DayType): { north: MasterRouteTable | null; south: MasterRouteTable | null } => {
        const group = consolidatedRoutes.find(g => g.name === routeNumber);
        if (!group) return { north: null, south: null };
        const dayData = group.days[dayType];
        if (!dayData) return { north: null, south: null };
        return { north: dayData.north || null, south: dayData.south || null };
    };

    // Initiate single route upload
    const handleInitiateUpload = async (routeNumber: string, dayType: DayType) => {
        if (!teamId || !userId) {
            showSuccessToast('Please join a team to upload to Master Schedule');
            return;
        }

        const { north, south } = getTablesForRoute(routeNumber, dayType);
        if (!north && !south) {
            showSuccessToast('No schedule data found for this route');
            return;
        }

        try {
            // Use empty table if one direction is missing
            const northTable = north || { routeName: `${routeNumber} (${dayType}) (North)`, stops: [], stopIds: {}, trips: [] };
            const southTable = south || { routeName: `${routeNumber} (${dayType}) (South)`, stops: [], stopIds: {}, trips: [] };

            const confirmation = await prepareUpload(teamId, northTable, southTable, routeNumber, dayType);
            setUploadConfirmation(confirmation);
            setUploadRouteKey({ routeNumber, dayType });
            setShowUploadModal(true);
        } catch (error) {
            console.error('Error preparing upload:', error);
            showSuccessToast('Failed to prepare upload');
        }
    };

    // Confirm single route upload
    const handleConfirmUpload = async () => {
        if (!teamId || !userId || !uploaderName || !uploadRouteKey) return;

        setIsUploading(true);
        try {
            const { north, south } = getTablesForRoute(uploadRouteKey.routeNumber, uploadRouteKey.dayType);
            const northTable = north || { routeName: `${uploadRouteKey.routeNumber} (${uploadRouteKey.dayType}) (North)`, stops: [], stopIds: {}, trips: [] };
            const southTable = south || { routeName: `${uploadRouteKey.routeNumber} (${uploadRouteKey.dayType}) (South)`, stops: [], stopIds: {}, trips: [] };

            await uploadToMasterSchedule(
                teamId,
                userId,
                uploaderName,
                northTable,
                southTable,
                uploadRouteKey.routeNumber,
                uploadRouteKey.dayType,
                'tweaker'
            );

            showSuccessToast(`Route ${uploadRouteKey.routeNumber} (${uploadRouteKey.dayType}) uploaded to Master`);
            setShowUploadModal(false);
            setUploadConfirmation(null);
            setUploadRouteKey(null);
        } catch (error) {
            console.error('Error uploading to master:', error);
            showSuccessToast('Failed to upload to Master Schedule');
        } finally {
            setIsUploading(false);
        }
    };

    // Bulk upload handler
    const handleBulkUpload = async (selectedRoutes: RouteForUpload[]) => {
        if (!teamId || !userId || !uploaderName) return [];

        const results: Array<{ routeNumber: string; dayType: DayType; success: boolean; error?: string; newVersion?: number }> = [];

        for (const route of selectedRoutes) {
            try {
                const { north, south } = getTablesForRoute(route.routeNumber, route.dayType);
                const northTable = north || { routeName: `${route.routeNumber} (${route.dayType}) (North)`, stops: [], stopIds: {}, trips: [] };
                const southTable = south || { routeName: `${route.routeNumber} (${route.dayType}) (South)`, stops: [], stopIds: {}, trips: [] };

                const entry = await uploadToMasterSchedule(
                    teamId,
                    userId,
                    uploaderName,
                    northTable,
                    southTable,
                    route.routeNumber,
                    route.dayType,
                    'tweaker'
                );

                results.push({
                    routeNumber: route.routeNumber,
                    dayType: route.dayType,
                    success: true,
                    newVersion: entry.currentVersion
                });
            } catch (error) {
                results.push({
                    routeNumber: route.routeNumber,
                    dayType: route.dayType,
                    success: false,
                    error: error instanceof Error ? error.message : 'Unknown error'
                });
            }
        }

        const successCount = results.filter(r => r.success).length;
        if (successCount > 0) {
            showSuccessToast(`${successCount} route(s) uploaded to Master Schedule`);
        }

        return results;
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

            {/* Trip Context Menu (right-click) */}
            {contextMenu && (
                <TripContextMenu
                    x={contextMenu.x}
                    y={contextMenu.y}
                    tripId={contextMenu.tripId}
                    tripDirection={contextMenu.tripDirection}
                    blockId={contextMenu.blockId}
                    currentStopName={contextMenu.stopName}
                    currentStopIndex={contextMenu.stopIndex}
                    stops={contextMenu.stops}
                    onAction={handleContextMenuAction}
                    onClose={() => setContextMenu(null)}
                />
            )}

            {/* Scenario Comparison Modal */}
            <ScenarioComparisonModal
                isOpen={showComparisonModal}
                onClose={() => setShowComparisonModal(false)}
                currentSchedules={schedules}
                baselineSchedules={originalSchedules || null}
                currentLabel={draftName}
                baselineLabel="Original"
            />

            {/* Upload to Master Modal (Single Route) */}
            <UploadToMasterModal
                isOpen={showUploadModal}
                confirmation={uploadConfirmation}
                onConfirm={handleConfirmUpload}
                onCancel={() => {
                    setShowUploadModal(false);
                    setUploadConfirmation(null);
                    setUploadRouteKey(null);
                }}
                isUploading={isUploading}
            />

            {/* Bulk Upload to Master Modal */}
            <BulkUploadToMasterModal
                isOpen={showBulkUploadModal}
                routes={routesForUpload}
                onConfirm={handleBulkUpload}
                onCancel={() => setShowBulkUploadModal(false)}
            />

            <div className={`h-full flex flex-col bg-gray-50/30 overflow-hidden ${isFullScreen ? 'fixed inset-0 z-[9999] bg-white' : ''}`}>
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
                    bands={bands}
                    canUndo={canUndo}
                    canRedo={canRedo}
                    onUndo={undo}
                    onRedo={redo}
                    hideAutoSave={hideAutoSave}
                />

                <div className="flex-grow flex overflow-hidden">
                    {/* Sidebar */}
                    {!isFullScreen && (
                        <div className="w-80 min-w-[320px] flex-shrink-0 bg-white border-r border-gray-200 flex flex-col overflow-hidden z-20">
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
                                                    <div key={day} className="flex items-center gap-1">
                                                        <button
                                                            onClick={() => setActiveDay(day)}
                                                            className={`flex-1 text-left px-3 py-1.5 rounded text-xs flex items-center gap-2 ${activeDay === day ? 'bg-blue-100 font-bold text-blue-800' : 'text-gray-500 hover:bg-gray-50'}`}
                                                        >
                                                            <div className={`w-1.5 h-1.5 rounded-full ${activeDay === day ? 'bg-blue-600' : 'bg-gray-300'}`} />
                                                            {day}
                                                        </button>
                                                        {teamId && (
                                                            <button
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    handleInitiateUpload(route.name, day as DayType);
                                                                }}
                                                                className="p-1.5 rounded text-gray-400 hover:text-green-600 hover:bg-green-50 transition-colors"
                                                                title={`Upload Route ${route.name} (${day}) to Master`}
                                                            >
                                                                <Upload size={12} />
                                                            </button>
                                                        )}
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>

                            {/* Footer Actions */}
                            <div className="border-t border-gray-100">
                                {/* Upload to Master Button */}
                                {teamId && (
                                    <div className="p-3 border-b border-gray-100">
                                        <button
                                            onClick={() => setShowBulkUploadModal(true)}
                                            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-green-600 text-white font-bold rounded-lg hover:bg-green-700 transition-colors shadow-sm"
                                        >
                                            <Database size={16} />
                                            Upload to Master
                                        </button>
                                        <p className="text-xs text-gray-500 text-center mt-2">
                                            {routesForUpload.length} route{routesForUpload.length !== 1 ? 's' : ''} available
                                        </p>
                                    </div>
                                )}

                                {/* Editor Actions */}
                                {subView === 'editor' && (
                                    <div className="p-4 flex gap-2 justify-center">
                                        <button onClick={undo} disabled={!canUndo} className="p-2 bg-gray-100 rounded hover:bg-gray-200 disabled:opacity-50" title="Undo (Ctrl+Z)"><Undo2 size={16} /></button>
                                        <button onClick={redo} disabled={!canRedo} className="p-2 bg-gray-100 rounded hover:bg-gray-200 disabled:opacity-50" title="Redo (Ctrl+Y)"><Redo2 size={16} /></button>
                                        <div className="w-px bg-gray-200 mx-1" />
                                        <button
                                            onClick={() => setShowComparisonModal(true)}
                                            disabled={!originalSchedules}
                                            className="flex items-center gap-1.5 px-3 py-1.5 bg-purple-100 text-purple-700 rounded hover:bg-purple-200 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium"
                                            title="Compare with original"
                                        >
                                            <GitCompare size={14} /> Compare
                                        </button>
                                        <button
                                            onClick={() => setShowInterlineConfig(true)}
                                            className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-100 text-blue-700 rounded hover:bg-blue-200 text-sm font-medium"
                                            title="Configure route interlining"
                                        >
                                            <ArrowRight size={14} /> Interline
                                        </button>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {/* Editor Content */}
                    <div className="flex-grow min-w-0 overflow-auto flex flex-col p-4">
                        {subView === 'matrix' ? (
                            <TravelTimeGrid
                                schedules={[activeRoute.north, activeRoute.south].filter((t): t is MasterRouteTable => !!t)}
                                onBulkAdjust={handleBulkAdjustTravelTime}
                                onRecoveryAdjust={handleBulkAdjustRecoveryTime}
                                onSingleTripAdjust={handleSingleTripTravelAdjust}
                                onSingleRecoveryAdjust={handleSingleRecoveryAdjust}
                                bands={bands}
                                analysis={analysis}
                                segmentNames={segmentNames}
                            />
                        ) : subView === 'timeline' ? (
                            <TimelineView
                                schedules={[activeRoute.north, activeRoute.south].filter((t): t is MasterRouteTable => !!t)}
                                onTripTimeChange={handleTimelineTripTimeChange}
                                onTripSelect={handleTripSelect}
                                selectedTripId={selectedTripId}
                            />
                        ) : (
                            (activeRoute.combined && !forceSimpleView) ? (
                                <>
                                    {!isFullScreen && <QuickActionsBar filter={filter} onFilterChange={setFilter} />}
                                    <RoundTripTableView
                                        schedules={schedules}
                                        onCellEdit={handleCellEdit}
                                        onTimeAdjust={handleTimeAdjust}
                                        onRecoveryEdit={handleRecoveryEdit}
                                        originalSchedules={originalSchedules}
                                        onDeleteTrip={handleDeleteTrip}
                                        onDuplicateTrip={handleDuplicateTrip}
                                        onAddTrip={(_, tripId) => openAddTripModal(tripId, {})}
                                        onTripRightClick={handleTripRightClick}
                                        onMenuOpen={handleMenuOpen}
                                        draftName={draftName}
                                        filter={filter}
                                        targetCycleTime={targetCycleTime}
                                        targetHeadway={targetHeadway}
                                    />
                                </>
                            ) : (
                                <SingleRouteView
                                    table={activeRoute.north || activeRoute.south!}
                                    originalTable={originalSchedules?.find(t => t.routeName === (activeRoute.north?.routeName || activeRoute.south?.routeName))}
                                    onCellEdit={handleCellEdit}
                                    onRecoveryEdit={handleRecoveryEdit}
                                    onTimeAdjust={handleTimeAdjust}
                                    onDeleteTrip={handleDeleteTrip}
                                    onDuplicateTrip={handleDuplicateTrip}
                                    onAddTrip={(_, tripId) => openAddTripModal(tripId, {})}
                                />
                            )
                        )}
                    </div>
                </div>
            </div>

            {/* Interline Config Panel */}
            <InterlineConfigPanel
                isOpen={showInterlineConfig}
                onClose={() => setShowInterlineConfig(false)}
                config={interlineConfig}
                onConfigChange={setInterlineConfig}
                tables={schedules}
                onApplyRules={handleApplyInterlineRules}
            />

            {/* Audit Log Panel */}
            <AuditLogPanel
                entries={auditEntries}
                isOpen={showAuditLog}
                onToggle={() => setShowAuditLog(!showAuditLog)}
            />

        </>
    );
};
