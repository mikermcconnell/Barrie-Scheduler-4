
import React from 'react';
import { TimeBand } from '../../../utils/runtimeAnalysis';
import { Clock, Bus, Plus, Trash2, LayoutGrid, Loader2, Database } from 'lucide-react';
import { getMasterSchedule } from '../../../utils/masterScheduleService';
import type { RouteIdentity } from '../../../utils/masterScheduleTypes';
import { resolveBlockStartDirection, shouldShowStartDirectionForRoute, normalizeDirectionHint, inferBlockStartDirection } from '../utils/blockStartDirection';

// Configuration Constants
export const SCHEDULE_DEFAULTS = {
    CYCLE_TIME: 60,           // Default cycle time in minutes
    RECOVERY_RATIO: 15,       // Default floating recovery ratio (%)
    START_TIME: '06:00',      // Default block start time
    END_TIME: '22:00',        // Default block end time
    ROUTE_NUMBER: '10'        // Default route number
} as const;

export interface BlockConfig {
    id: string; // "100-1"
    startTime: string; // "06:00"
    endTime: string; // "20:00"
    startStop?: string; // "Park Place" — first stop of block's earliest trip
    endStop?: string; // "RVH Main" — last stop of block's latest trip
    startDirection?: 'North' | 'South'; // Parser hint from earliest trip in block
}

export interface BandRecoveryDefault {
    bandId: string;           // 'A', 'B', 'C', etc.
    avgCycleTime: number;     // Full round-trip cycle time (for Strict mode)
    avgRecoveryRatio: number; // Recovery % (for Floating mode)
    tripCount: number;        // Number of master trips that contributed
}

export interface ScheduleConfig {
    routeNumber: string;
    cycleMode?: 'Strict' | 'Floating'; // New
    cycleTime: number;
    recoveryRatio?: number; // percent, e.g. 15
    recoveryDistribution?: 'End' | 'Proportional';
    // Headway is now calculated
    blocks: BlockConfig[];
    bandRecoveryDefaults?: BandRecoveryDefault[];
}

interface Step3Props {
    dayType: string;
    bands: TimeBand[];
    config: ScheduleConfig;
    setConfig: (c: ScheduleConfig) => void;
    teamId?: string;
    stopSuggestions?: string[];
}

const START_STOP_SUGGESTIONS_ID = 'start-stop-suggestions';

export const Step3Build: React.FC<Step3Props> = ({ dayType, bands, config, setConfig, teamId, stopSuggestions = [] }) => {

    // Autofill from Master Schedule state
    const [autofillFromMaster, setAutofillFromMaster] = React.useState(true);
    const [isLoadingMaster, setIsLoadingMaster] = React.useState(false);
    const [masterStatus, setMasterStatus] = React.useState<'idle' | 'loaded' | 'not-found'>('idle');
    const [usePerBandRecovery, setUsePerBandRecovery] = React.useState(true);
    const [displayBandDefaults, setDisplayBandDefaults] = React.useState<BandRecoveryDefault[]>([]);
    const configRef = React.useRef(config);
    React.useEffect(() => { configRef.current = config; }, [config]);

    // Keep display state in sync when autofill loads new data
    React.useEffect(() => {
        if (config.bandRecoveryDefaults && config.bandRecoveryDefaults.length > 0) {
            setDisplayBandDefaults(config.bandRecoveryDefaults);
        }
    }, [config.bandRecoveryDefaults]);

    // Sync per-band toggle: when unchecked, strip bandRecoveryDefaults from config
    React.useEffect(() => {
        if (usePerBandRecovery) {
            if (displayBandDefaults.length > 0 && !config.bandRecoveryDefaults) {
                setConfig({ ...config, bandRecoveryDefaults: displayBandDefaults });
            }
        } else {
            if (config.bandRecoveryDefaults) {
                setConfig({ ...config, bandRecoveryDefaults: undefined });
            }
        }
    }, [usePerBandRecovery, displayBandDefaults, config, setConfig]);

    // Floating mode guardrail: always prefill target recovery at 15% when missing/zero.
    React.useEffect(() => {
        if (config.cycleMode !== 'Floating') return;
        if ((config.recoveryRatio ?? 0) > 0) return;
        setConfig({ ...config, recoveryRatio: SCHEDULE_DEFAULTS.RECOVERY_RATIO });
    }, [config, setConfig]);

    // Convert minutes-from-midnight to "HH:MM" string
    const minutesToTimeStr = (minutes: number): string => {
        const normalized = ((minutes % 1440) + 1440) % 1440;
        const h = Math.floor(normalized / 60);
        const m = normalized % 60;
        return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    };

    // Transit service day: times before 4 AM are late-night service (sort after 23:59)
    const toOperational = (minutes: number): number => minutes < 240 ? minutes + 1440 : minutes;

    // Parse "6:50 AM" / "10:30 PM" → minutes from midnight
    const parseTimeToMinutes = (timeStr: string): number | null => {
        const match = timeStr.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
        if (!match) return null;
        let hours = parseInt(match[1], 10);
        const minutes = parseInt(match[2], 10);
        const period = match[3].toUpperCase();
        if (period === 'AM' && hours === 12) hours = 0;
        else if (period === 'PM' && hours !== 12) hours += 12;
        return hours * 60 + minutes;
    };

    // Extract effective min/max times and their stop names from a trip
    const getEffectiveTimes = (trip: {
        startTime: number;
        endTime: number;
        stopMinutes?: Record<string, number>;
        stops?: Record<string, string>;
        stopOrder?: string[];
        startStopIndex?: number;
        endStopIndex?: number;
    }) => {
        let start = toOperational(trip.startTime);
        let end = toOperational(trip.endTime);
        let startStop = '';
        let endStop = '';

        const resolveStopTime = (stopName: string): number | null => {
            const fromMinutes = trip.stopMinutes?.[stopName];
            if (typeof fromMinutes === 'number') return toOperational(fromMinutes);
            const fromStops = trip.stops?.[stopName];
            if (typeof fromStops === 'string') {
                const parsed = parseTimeToMinutes(fromStops);
                if (parsed !== null) return toOperational(parsed);
            }
            return null;
        };

        const stopOrder = trip.stopOrder && trip.stopOrder.length > 0
            ? trip.stopOrder
            : (trip.stops ? Object.keys(trip.stops) : []);

        // Build a unified stop→minutes map from whichever source is available
        const resolvedStopTimes: [string, number][] = [];
        if (trip.stopMinutes && Object.keys(trip.stopMinutes).length > 0) {
            for (const [name, time] of Object.entries(trip.stopMinutes)) {
                resolvedStopTimes.push([name, toOperational(time)]);
            }
        } else if (trip.stops && Object.keys(trip.stops).length > 0) {
            for (const [name, timeStr] of Object.entries(trip.stops)) {
                const parsed = parseTimeToMinutes(timeStr as string);
                if (parsed !== null) resolvedStopTimes.push([name, toOperational(parsed)]);
            }
        }

        if (resolvedStopTimes.length > 0) {
            let minStopTime = Infinity;
            let minStopName = '';
            let maxStopTime = -Infinity;
            let maxStopName = '';
            for (const [name, opTime] of resolvedStopTimes) {
                if (opTime < start || (opTime === start && !startStop)) {
                    start = opTime;
                    startStop = name;
                }
                if (opTime >= end) { end = opTime; endStop = name; }
                if (opTime < minStopTime) { minStopTime = opTime; minStopName = name; }
                if (opTime > maxStopTime) { maxStopTime = opTime; maxStopName = name; }
            }
            // When trip.startTime is earlier than all stops (e.g. pullout from garage),
            // use the stop with the minimum time as a better fallback than index-based.
            if (!startStop && minStopName) startStop = minStopName;
            if (!endStop && maxStopName) endStop = maxStopName;
        }

        // Fallback to configured stop order when parsed stop times don't resolve.
        if ((!startStop || !endStop) && stopOrder.length > 0) {
            const stopNames = stopOrder;
            const fallbackStartIndex = typeof trip.startStopIndex === 'number'
                ? Math.max(0, Math.min(stopNames.length - 1, trip.startStopIndex))
                : 0;
            const fallbackEndIndex = typeof trip.endStopIndex === 'number'
                ? Math.max(0, Math.min(stopNames.length - 1, trip.endStopIndex))
                : stopNames.length - 1;

            if (!startStop && stopNames[fallbackStartIndex]) startStop = stopNames[fallbackStartIndex];
            if (!endStop && stopNames[fallbackEndIndex]) endStop = stopNames[fallbackEndIndex];
        }

        // Parser-provided stop indices are authoritative for partial trips.
        // Route 8A/8B can include duplicate terminal names (e.g., Park Place variants),
        // so raw min/max stop scans may pick the wrong terminal for pullout trips.
        if (stopOrder.length > 0 && typeof trip.startStopIndex === 'number') {
            const index = Math.max(0, Math.min(stopOrder.length - 1, trip.startStopIndex));
            const indexedStartStop = stopOrder[index];
            const indexedStartTime = resolveStopTime(indexedStartStop);
            if (indexedStartStop && indexedStartTime !== null) {
                startStop = indexedStartStop;
                start = indexedStartTime;
            }
        }

        if (stopOrder.length > 0 && typeof trip.endStopIndex === 'number') {
            const index = Math.max(0, Math.min(stopOrder.length - 1, trip.endStopIndex));
            const indexedEndStop = stopOrder[index];
            const indexedEndTime = resolveStopTime(indexedEndStop);
            if (indexedEndStop && indexedEndTime !== null) {
                endStop = indexedEndStop;
                end = indexedEndTime;
            }
        }

        return { start, end, startStop, endStop };
    };

    const combinedStopSuggestions = React.useMemo(() => {
        const seen = new Set<string>();
        const ordered: string[] = [];
        const append = (value?: string) => {
            const cleaned = value?.trim();
            if (!cleaned) return;
            const key = cleaned.toLowerCase();
            if (seen.has(key)) return;
            seen.add(key);
            ordered.push(cleaned);
        };

        stopSuggestions.forEach(append);
        config.blocks.forEach(block => {
            append(block.startStop);
            append(block.endStop);
        });
        return ordered;
    }, [stopSuggestions, config.blocks]);

    const showStartDirectionColumn = React.useMemo(
        () => shouldShowStartDirectionForRoute(config.routeNumber),
        [config.routeNumber]
    );

    // Fetch and autofill blocks from master schedule
    React.useEffect(() => {
        if (!autofillFromMaster || !teamId || !config.routeNumber) return;

        let cancelled = false;
        const fetchBlocks = async () => {
            setIsLoadingMaster(true);
            setMasterStatus('idle');
            try {
                const routeIdentity = `${config.routeNumber}-${dayType}` as RouteIdentity;
                const result = await getMasterSchedule(teamId, routeIdentity);
                if (cancelled) return;

                if (!result) {
                    setMasterStatus('not-found');
                    return;
                }

                const { content } = result;
                const allTrips = [
                    ...content.northTable.trips.map(trip => ({ ...trip, stopOrder: content.northTable.stops })),
                    ...content.southTable.trips.map(trip => ({ ...trip, stopOrder: content.southTable.stops }))
                ];

                // Transit service day: times before 4 AM are late-night (sort after 23:59)
                const toOperational = (min: number): number => min < 240 ? min + 1440 : min;

                // Group by blockId, scanning all stop times for true min/max.
                // Uses operational time so post-midnight trips (12-3:59 AM) are
                // treated as end-of-day, not start-of-day.
                const blockMap = new Map<string, {
                    startTime: number;
                    endTime: number;
                    startStop: string;
                    endStop: string;
                    startDirection?: 'North' | 'South';
                }>();
                for (const trip of allTrips) {
                    const { start, end, startStop, endStop } = getEffectiveTimes(trip);
                    const opStart = toOperational(start);
                    const opEnd = toOperational(end);
                    const directionHint = normalizeDirectionHint(trip.direction);
                    const existing = blockMap.get(trip.blockId);
                    if (!existing) {
                        blockMap.set(trip.blockId, {
                            startTime: opStart,
                            endTime: opEnd,
                            startStop,
                            endStop,
                            startDirection: directionHint || undefined
                        });
                    } else {
                        if (opStart < existing.startTime) {
                            existing.startTime = opStart;
                            if (startStop) existing.startStop = startStop;
                            if (directionHint) existing.startDirection = directionHint;
                        }
                        if (opEnd > existing.endTime) {
                            existing.endTime = opEnd;
                            if (endStop) existing.endStop = endStop;
                        }
                        if (!existing.startStop && startStop) existing.startStop = startStop;
                        if (!existing.endStop && endStop) existing.endStop = endStop;
                        if (!existing.startDirection && directionHint) existing.startDirection = directionHint;
                    }
                }

                // Convert to BlockConfig, sorted by start time
                const blocks: BlockConfig[] = Array.from(blockMap.entries())
                    .sort((a, b) => a[1].startTime - b[1].startTime)
                    .map(([blockId, data]) => ({
                        id: blockId,
                        startTime: minutesToTimeStr(data.startTime),
                        endTime: minutesToTimeStr(data.endTime),
                        startStop: data.startStop || undefined,
                        endStop: data.endStop || undefined,
                        startDirection: data.startDirection
                    }));

                // Second pass: extract per-band recovery defaults
                const bandGroups = new Map<string, { cycleTimes: number[]; recoveryRatios: number[] }>();
                for (const trip of allTrips) {
                    if (!trip.assignedBand || !trip.travelTime || trip.travelTime <= 0) continue;
                    const group = bandGroups.get(trip.assignedBand) || { cycleTimes: [], recoveryRatios: [] };
                    group.cycleTimes.push(trip.cycleTime);
                    if (trip.travelTime > 0) {
                        group.recoveryRatios.push((trip.recoveryTime / trip.travelTime) * 100);
                    }
                    bandGroups.set(trip.assignedBand, group);
                }

                const bandRecoveryDefaults: BandRecoveryDefault[] = [];
                for (const [bandId, group] of bandGroups) {
                    const avgCycleTime = Math.round(
                        group.cycleTimes.reduce((s, v) => s + v, 0) / group.cycleTimes.length * 2
                    ); // × 2 for full round-trip
                    const avgRecoveryRatio = Math.round(
                        group.recoveryRatios.reduce((s, v) => s + v, 0) / group.recoveryRatios.length
                    );
                    bandRecoveryDefaults.push({ bandId, avgCycleTime, avgRecoveryRatio, tripCount: group.cycleTimes.length });
                }
                bandRecoveryDefaults.sort((a, b) => a.bandId.localeCompare(b.bandId));

                // Compute global weighted averages from band data
                let globalCycleTime = configRef.current.cycleTime;
                let globalRecoveryRatio = configRef.current.recoveryRatio ?? SCHEDULE_DEFAULTS.RECOVERY_RATIO;
                if (bandRecoveryDefaults.length > 0) {
                    const totalTrips = bandRecoveryDefaults.reduce((s, bd) => s + bd.tripCount, 0);
                    globalCycleTime = Math.round(
                        bandRecoveryDefaults.reduce((s, bd) => s + bd.avgCycleTime * bd.tripCount, 0) / totalTrips
                    );
                    globalRecoveryRatio = Math.round(
                        bandRecoveryDefaults.reduce((s, bd) => s + bd.avgRecoveryRatio * bd.tripCount, 0) / totalTrips
                    );
                }

                if (blocks.length > 0 && !cancelled) {
                    setConfig({
                        ...configRef.current,
                        blocks,
                        cycleTime: globalCycleTime,
                        recoveryRatio: globalRecoveryRatio,
                        bandRecoveryDefaults: bandRecoveryDefaults.length > 0 ? bandRecoveryDefaults : undefined
                    });
                    setMasterStatus('loaded');
                } else {
                    setMasterStatus('not-found');
                }
            } catch (e) {
                if (!cancelled) {
                    console.error('Failed to fetch master schedule blocks:', e);
                    setMasterStatus('not-found');
                }
            } finally {
                if (!cancelled) setIsLoadingMaster(false);
            }
        };

        fetchBlocks();
        return () => { cancelled = true; };
    }, [autofillFromMaster, teamId, config.routeNumber, dayType, setConfig]);

    // Helper to add minutes to HH:MM time string
    const addMinutes = (timeStr: string, minutes: number): string => {
        const [h, m] = timeStr.split(':').map(Number);
        const date = new Date();
        date.setHours(h, m, 0, 0);
        date.setMinutes(date.getMinutes() + minutes);
        return date.toTimeString().slice(0, 5);
    };

    // Auto-calculate subsequent block start times whenever head/config changes
    // Skip when autofill is active — master schedule times are authoritative
    React.useEffect(() => {
        if (config.blocks.length <= 1) return;
        if (autofillFromMaster && masterStatus === 'loaded') return;
        if (config.cycleMode === 'Floating' && (!config.cycleTime || config.cycleTime <= 0)) return;

        const cycleTime = config.cycleTime;
        const computedHeadway = config.blocks.length > 0 ? cycleTime / config.blocks.length : 0;

        let changed = false;
        const newBlocks = [...config.blocks];
        const baseStartTime = newBlocks[0].startTime;

        for (let i = 1; i < newBlocks.length; i++) {
            const offset = Math.round(computedHeadway * i); // Use round to get nearest minute
            const expectedStart = addMinutes(baseStartTime, offset);

            if (newBlocks[i].startTime !== expectedStart) {
                newBlocks[i] = { ...newBlocks[i], startTime: expectedStart };
                changed = true;
            }
        }

        if (changed) {
            setConfig({ ...config, blocks: newBlocks });
        }
    }, [config.cycleTime, config.blocks.length, config.blocks[0]?.startTime, autofillFromMaster, masterStatus]);

    const addBlock = () => {
        const nextNum = config.blocks.length + 1;
        const newBlock: BlockConfig = {
            id: `${config.routeNumber || SCHEDULE_DEFAULTS.ROUTE_NUMBER}-${nextNum}`,
            startTime: SCHEDULE_DEFAULTS.START_TIME,
            endTime: SCHEDULE_DEFAULTS.END_TIME
        };
        setConfig({
            ...config,
            blocks: [...config.blocks, newBlock]
        });
    };

    const removeBlock = (index: number) => {
        const newBlocks = [...config.blocks];
        newBlocks.splice(index, 1);
        setConfig({ ...config, blocks: newBlocks });
    };

    const updateBlock = (index: number, field: keyof BlockConfig, value: string) => {
        const newBlocks = [...config.blocks];
        newBlocks[index] = { ...newBlocks[index], [field]: value };
        // Auto-populate startDirection when startStop changes
        if (field === 'startStop') {
            const inferred = inferBlockStartDirection(config.routeNumber, value);
            newBlocks[index].startDirection = inferred || undefined;
        }
        setConfig({ ...config, blocks: newBlocks });
    };

    const cycleTime = config.cycleTime;
    const computedHeadway = config.blocks.length > 0 ? cycleTime / config.blocks.length : 0;
    const bandsWithData = bands.filter(b => b.count > 0 && b.avg > 0);
    const suggestedStrictCycle = bandsWithData.length > 0
        ? Math.round(
            bandsWithData.reduce((sum, b) => sum + (b.avg * b.count), 0) /
            bandsWithData.reduce((sum, b) => sum + b.count, 0)
        )
        : null;
    const strictCycleDeltaPct = (suggestedStrictCycle && cycleTime > 0)
        ? Math.round(((cycleTime - suggestedStrictCycle) / suggestedStrictCycle) * 100)
        : null;
    const strictCycleSeverity: 'warning' | 'critical' | null =
        config.cycleMode === 'Floating' || strictCycleDeltaPct === null
            ? null
            : Math.abs(strictCycleDeltaPct) >= 35
                ? 'critical'
                : Math.abs(strictCycleDeltaPct) >= 20
                    ? 'warning'
                    : null;

    return (
        <div className="h-full flex flex-col animate-in fade-in duration-500 overflow-hidden">
            <div className="flex justify-between items-start mb-6 flex-shrink-0">
                <div>
                    <h2 className="text-2xl font-bold text-gray-900 tracking-tight">Build Schedule</h2>
                    <p className="text-gray-500">
                        Define your service parameters for <strong>{dayType}</strong>.
                    </p>
                </div>

                {/* Time Band Legend (Reference) */}
                <div className="flex items-center gap-4 bg-white px-4 py-2 rounded-xl border border-gray-200 shadow-sm animate-in fade-in slide-in-from-right-4 duration-500">
                    <span className="text-xs font-bold text-gray-400 uppercase mr-2">Band References</span>
                    {bands.map(band => (
                        <div key={band.id} className="flex items-center gap-1.5">
                            <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: band.color }} />
                            <span className="text-xs font-bold text-gray-700 whitespace-nowrap">
                                {band.id} <span className="text-gray-400 font-normal">({band.avg.toFixed(0)}m)</span>
                            </span>
                        </div>
                    ))}
                </div>
            </div>

            <div className="flex-grow grid grid-cols-1 lg:grid-cols-12 gap-6 min-h-0">

                {/* Left Column: Global Config */}
                <div className="lg:col-span-4 flex flex-col gap-4 overflow-y-auto pr-1">
                    <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm space-y-4">
                        <div className="flex items-center gap-2 mb-1">
                            <Bus className="text-brand-blue" size={20} />
                            <h3 className="text-md font-bold text-gray-900">Route Configuration</h3>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div className="col-span-1">
                                <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Route #</label>
                                <input
                                    type="text"
                                    value={config.routeNumber}
                                    onChange={e => setConfig({ ...config, routeNumber: e.target.value })}
                                    className="w-full px-3 py-1.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-blue/20 focus:border-brand-blue font-bold text-gray-800 text-sm"
                                    placeholder="e.g. 100"
                                />
                            </div>

                            <div className="col-span-1">
                                <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Recov. Dist.</label>
                                <select
                                    value={config.recoveryDistribution || 'End'}
                                    onChange={e => setConfig({ ...config, recoveryDistribution: e.target.value as 'End' | 'Proportional' })}
                                    className="w-full px-2 py-1.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-blue/20 focus:border-brand-blue font-bold text-gray-800 text-xs"
                                >
                                    <option value="End">End Only</option>
                                    <option value="Proportional">Proportional</option>
                                </select>
                            </div>
                        </div>

                        <div>
                            <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Cycle Mode</label>
                            <div className="flex bg-gray-100 p-1 rounded-lg mb-3">
                                <button
                                    onClick={() => setConfig({ ...config, cycleMode: 'Strict' })}
                                    className={`flex-1 py-1 text-xs font-bold rounded-md transition-all ${(!config.cycleMode || config.cycleMode === 'Strict') ? 'bg-white text-brand-blue shadow-sm' : 'text-gray-500'}`}
                                >
                                    Strict
                                </button>
                                <button
                                    onClick={() => setConfig({
                                        ...config,
                                        cycleMode: 'Floating',
                                        recoveryRatio: (config.recoveryRatio ?? 0) > 0
                                            ? config.recoveryRatio
                                            : SCHEDULE_DEFAULTS.RECOVERY_RATIO
                                    })}
                                    className={`flex-1 py-1 text-xs font-bold rounded-md transition-all ${config.cycleMode === 'Floating' ? 'bg-white text-brand-blue shadow-sm' : 'text-gray-500'}`}
                                >
                                    Floating
                                </button>
                            </div>

                            {config.cycleMode === 'Floating' ? (
                                <div className="grid grid-cols-2 gap-4 animate-in fade-in slide-in-from-top-2 duration-200">
                                    <div>
                                        <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Reference Cycle (Optional)</label>
                                        <div className="relative">
                                            <input
                                                type="number"
                                                value={config.cycleTime}
                                                onChange={e => setConfig({ ...config, cycleTime: parseInt(e.target.value) || 0 })}
                                                placeholder="Optional"
                                                className="w-full pl-8 px-2 py-1.5 border border-gray-200 bg-gray-50 rounded-lg text-gray-600 font-medium text-sm"
                                            />
                                            <Clock size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                                        </div>
                                    </div>
                                    <div>
                                        <label className="block text-[10px] font-bold text-brand-blue uppercase mb-1">Target Recov.</label>
                                        <div className="relative">
                                            <input
                                                type="number"
                                                value={config.recoveryRatio ?? SCHEDULE_DEFAULTS.RECOVERY_RATIO}
                                                onChange={e => setConfig({ ...config, recoveryRatio: parseInt(e.target.value) || SCHEDULE_DEFAULTS.RECOVERY_RATIO })}
                                                className="w-full pl-3 pr-6 py-1.5 border border-brand-blue/30 bg-blue-50/50 rounded-lg focus:ring-2 focus:ring-brand-blue/20 focus:border-brand-blue font-bold text-brand-blue text-sm"
                                            />
                                            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-brand-blue/50 font-bold text-xs">%</span>
                                        </div>
                                    </div>
                                </div>
                            ) : (
                                <div>
                                    <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Strict Cycle Time</label>
                                    <div className="relative">
                                        <input
                                            type="number"
                                            value={config.cycleTime}
                                            onChange={e => setConfig({ ...config, cycleTime: parseInt(e.target.value) || 0 })}
                                            className="w-full pl-9 px-3 py-2 border border-brand-blue/30 rounded-lg focus:ring-2 focus:ring-brand-blue/20 focus:border-brand-blue font-bold text-gray-900 text-lg shadow-sm"
                                        />
                                        <Clock size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-brand-blue" />
                                    </div>
                                    <p className="text-[10px] text-gray-400 mt-1">Total round-trip time (min)</p>
                                    {strictCycleSeverity && (
                                        <div
                                            className={`mt-2 rounded-lg px-2 py-1.5 ${
                                                strictCycleSeverity === 'critical'
                                                    ? 'border border-red-200 bg-red-50'
                                                    : 'border border-amber-200 bg-amber-50'
                                            }`}
                                        >
                                            <p
                                                className={`text-[11px] font-semibold ${
                                                    strictCycleSeverity === 'critical'
                                                        ? 'text-red-800'
                                                        : 'text-amber-800'
                                                }`}
                                            >
                                                {strictCycleSeverity === 'critical' ? 'Strongly recommended:' : 'Check strict cycle:'} {cycleTime}m is {strictCycleDeltaPct! > 0 ? `${strictCycleDeltaPct}% above` : `${Math.abs(strictCycleDeltaPct!)}% below`} observed runtime (~{suggestedStrictCycle}m).
                                            </p>
                                            <button
                                                type="button"
                                                onClick={() => setConfig({ ...config, cycleTime: suggestedStrictCycle! })}
                                                className={`mt-1 text-[11px] font-bold underline ${
                                                    strictCycleSeverity === 'critical'
                                                        ? 'text-red-700 hover:text-red-800'
                                                        : 'text-amber-700 hover:text-amber-800'
                                                }`}
                                            >
                                                Use suggested {suggestedStrictCycle}m
                                            </button>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Calculated Stats (Compact) */}
                    <div className="bg-blue-50 p-4 rounded-xl border border-blue-100 flex flex-col gap-2">
                        <h3 className="text-xs font-bold text-blue-800 uppercase">Service Metrics</h3>
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <span className="text-xs text-blue-600 font-medium block">Headway</span>
                                <span className="text-xl font-bold text-blue-900">
                                    {Number.isInteger(computedHeadway) ? computedHeadway : computedHeadway.toFixed(1)}
                                    <span className="text-xs font-normal ml-0.5">m</span>
                                </span>
                                {displayBandDefaults.length > 0 && usePerBandRecovery && (
                                    <span className="text-[10px] text-blue-500 italic">varies by band</span>
                                )}
                            </div>
                            <div>
                                <span className="text-xs text-blue-600 font-medium block">Blocks</span>
                                <span className="text-xl font-bold text-blue-900">{config.blocks.length}</span>
                            </div>
                        </div>
                    </div>

                    {/* Per-Band Recovery Defaults */}
                    {displayBandDefaults.length > 0 && (
                        <div className={`p-4 rounded-xl flex flex-col gap-2 ${usePerBandRecovery ? 'bg-emerald-50 border border-emerald-100' : 'bg-gray-50 border border-gray-200'}`}>
                            <h3 className={`text-xs font-bold uppercase ${usePerBandRecovery ? 'text-emerald-800' : 'text-gray-500'}`}>Master Recovery Defaults</h3>
                            <table className="w-full text-left text-xs">
                                <thead>
                                    <tr className={usePerBandRecovery ? 'text-emerald-600' : 'text-gray-400'}>
                                        <th className="py-1 font-bold">Band</th>
                                        <th className="py-1 font-bold text-right">Cycle</th>
                                        <th className="py-1 font-bold text-right">Recov%</th>
                                        <th className="py-1 font-bold text-right">Trips</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {displayBandDefaults.map(bd => {
                                        const bandColor = bands.find(b => b.id === bd.bandId)?.color;
                                        return (
                                            <tr key={bd.bandId} className={usePerBandRecovery ? 'text-emerald-900' : 'text-gray-500'}>
                                                <td className="py-0.5 flex items-center gap-1.5">
                                                    {bandColor && <div className="w-2 h-2 rounded-full" style={{ backgroundColor: bandColor, opacity: usePerBandRecovery ? 1 : 0.4 }} />}
                                                    <span className="font-bold">{bd.bandId}</span>
                                                </td>
                                                <td className="py-0.5 text-right font-medium">{bd.avgCycleTime}m</td>
                                                <td className="py-0.5 text-right font-medium">{bd.avgRecoveryRatio}%</td>
                                                <td className="py-0.5 text-right">{bd.tripCount}</td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                            <label className="flex items-center gap-2 mt-1 cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={usePerBandRecovery}
                                    onChange={e => setUsePerBandRecovery(e.target.checked)}
                                    className="rounded border-emerald-300 text-emerald-600 focus:ring-emerald-500"
                                />
                                <span className="text-xs font-medium text-emerald-700">Use per-band defaults</span>
                            </label>
                        </div>
                    )}
                </div>

                {/* Right Column: Block Definitions */}
                <div className="lg:col-span-8 flex flex-col h-full min-h-0 bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                    <div className="p-4 border-b border-gray-200 bg-white flex items-center justify-between flex-shrink-0">
                        <div>
                            <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                                <LayoutGrid size={20} className="text-gray-400" />
                                Block Configuration
                            </h3>
                            <p className="text-[11px] text-gray-500 mt-1">
                                Set <strong>Start Stop</strong> per block to control where each block pulls out from (for example, Park Place vs Georgian).
                            </p>
                            {showStartDirectionColumn && (
                                <p className="text-[11px] text-blue-600 mt-1">
                                    Route 8 tip: <strong>Park Place</strong> starts Northbound, <strong>Georgian College</strong> starts Southbound.
                                </p>
                            )}
                        </div>
                        <div className="flex items-center gap-3">
                            {/* Autofill from Master Toggle */}
                            {teamId && (
                                <button
                                    onClick={() => setAutofillFromMaster(!autofillFromMaster)}
                                    className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold transition-all border ${
                                        autofillFromMaster
                                            ? 'bg-emerald-50 text-emerald-700 border-emerald-200 shadow-sm'
                                            : 'bg-gray-50 text-gray-400 border-gray-200 hover:bg-gray-100'
                                    }`}
                                >
                                    {isLoadingMaster ? (
                                        <Loader2 size={14} className="animate-spin" />
                                    ) : (
                                        <Database size={14} />
                                    )}
                                    Autofill from Master
                                    {masterStatus === 'loaded' && autofillFromMaster && !isLoadingMaster && (
                                        <span className="text-emerald-500 ml-0.5">&#10003;</span>
                                    )}
                                    {masterStatus === 'not-found' && autofillFromMaster && !isLoadingMaster && (
                                        <span className="text-amber-500 text-[10px] ml-1">No master found</span>
                                    )}
                                </button>
                            )}
                            <button
                                onClick={addBlock}
                                className="flex items-center gap-2 text-brand-blue font-bold hover:bg-blue-50 px-3 py-1.5 rounded-lg transition-colors border border-transparent hover:border-blue-100"
                            >
                                <Plus size={18} /> Add Block
                            </button>
                        </div>
                    </div>

                    <div className="flex-grow overflow-y-auto">
                        <table className="w-full text-left">
                            <thead className="bg-gray-50 border-b border-gray-200 sticky top-0 z-10">
                                <tr>
                                    <th className="px-4 py-3 text-xs font-bold text-gray-500 uppercase">Block ID</th>
                                    <th className="px-4 py-3 text-xs font-bold text-gray-500 uppercase">Start Time</th>
                                    <th className="px-4 py-3 text-xs font-bold text-gray-500 uppercase">Start Stop</th>
                                    {showStartDirectionColumn && <th className="px-4 py-3 text-xs font-bold text-gray-500 uppercase">Start Dir</th>}
                                    <th className="px-4 py-3 text-xs font-bold text-gray-500 uppercase">End Time</th>
                                    <th className="px-4 py-3 text-xs font-bold text-gray-500 uppercase">End Stop</th>
                                    <th className="px-4 py-3 text-xs font-bold text-gray-500 uppercase text-right">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                                {config.blocks.map((block, idx) => {
                                    const startDirection = resolveBlockStartDirection(
                                        config.routeNumber,
                                        block.startStop,
                                        block.startDirection
                                    );
                                    return (
                                    <tr key={idx} className="hover:bg-gray-50 transition-colors">
                                        <td className="px-4 py-3">
                                            <input
                                                type="text"
                                                value={block.id}
                                                onChange={e => updateBlock(idx, 'id', e.target.value)}
                                                className="bg-transparent font-bold text-gray-900 focus:outline-none focus:underline w-24"
                                            />
                                        </td>
                                        <td className="px-4 py-3">
                                            <input
                                                type="time"
                                                value={block.startTime}
                                                onChange={e => updateBlock(idx, 'startTime', e.target.value)}
                                                className={`${idx === 0 ? 'bg-white' : 'bg-gray-50'} border border-gray-200 rounded-md px-2 py-1 text-sm font-medium focus:ring-2 focus:ring-brand-blue/20 focus:border-brand-blue outline-none`}
                                                title={idx > 0 ? "Auto-filled based on headway (editable)" : "Start time for Block 1"}
                                            />
                                        </td>
                                        <td className="px-4 py-3">
                                            <input
                                                type="text"
                                                value={block.startStop || ''}
                                                onChange={e => updateBlock(idx, 'startStop', e.target.value)}
                                                list={START_STOP_SUGGESTIONS_ID}
                                                placeholder={combinedStopSuggestions[0] || 'e.g. Park Place'}
                                                className="w-full min-w-[150px] bg-white border border-gray-200 rounded-md px-2 py-1 text-sm text-gray-700 focus:ring-2 focus:ring-brand-blue/20 focus:border-brand-blue outline-none"
                                                title="Optional: set where this block starts service"
                                            />
                                        </td>
                                        {showStartDirectionColumn && (
                                            <td className="px-4 py-3">
                                                <select
                                                    value={block.startDirection || ''}
                                                    onChange={e => {
                                                        const newBlocks = [...config.blocks];
                                                        const val = e.target.value as 'North' | 'South' | '';
                                                        newBlocks[idx] = { ...newBlocks[idx], startDirection: val || undefined };
                                                        setConfig({ ...config, blocks: newBlocks });
                                                    }}
                                                    className={`text-xs font-semibold rounded-full px-2 py-0.5 border outline-none cursor-pointer ${
                                                        block.startDirection === 'North'
                                                            ? 'bg-blue-50 text-blue-700 border-blue-200'
                                                            : block.startDirection === 'South'
                                                                ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                                                : 'bg-gray-50 text-gray-500 border-gray-200'
                                                    }`}
                                                >
                                                    <option value="">—</option>
                                                    <option value="North">North</option>
                                                    <option value="South">South</option>
                                                </select>
                                            </td>
                                        )}
                                        <td className="px-4 py-3">
                                            <input
                                                type="time"
                                                value={block.endTime}
                                                onChange={e => updateBlock(idx, 'endTime', e.target.value)}
                                                className="bg-gray-50 border border-gray-200 rounded-md px-2 py-1 text-sm font-medium focus:ring-2 focus:ring-brand-blue/20 focus:border-brand-blue outline-none"
                                            />
                                        </td>
                                        <td className="px-4 py-3">
                                            {block.endStop ? (
                                                <span className="text-xs text-gray-500 truncate block max-w-[140px]" title={block.endStop}>
                                                    {block.endStop}
                                                </span>
                                            ) : (
                                                <span className="text-xs text-gray-300">—</span>
                                            )}
                                        </td>
                                        <td className="px-4 py-3 text-right">
                                            <button
                                                onClick={() => removeBlock(idx)}
                                                className="text-gray-400 hover:text-red-500 p-2 hover:bg-red-50 rounded-lg transition-colors"
                                                disabled={config.blocks.length <= 1}
                                            >
                                                <Trash2 size={16} />
                                            </button>
                                        </td>
                                    </tr>
                                )})}
                            </tbody>
                        </table>
                        {combinedStopSuggestions.length > 0 && (
                            <datalist id={START_STOP_SUGGESTIONS_ID}>
                                {combinedStopSuggestions.map(stop => (
                                    <option key={stop} value={stop} />
                                ))}
                            </datalist>
                        )}
                        {config.blocks.length === 0 && (
                            <div className="p-8 text-center text-gray-400 italic">No blocks defined. Add a block to start.</div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};
