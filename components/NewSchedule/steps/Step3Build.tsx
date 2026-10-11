
import React from 'react';
import { TimeBand, TripBucketAnalysis } from '../../../utils/ai/runtimeAnalysis';
import { AlertTriangle, Clock, Bus, Plus, Trash2, LayoutGrid, Loader2, Database, RefreshCw, RotateCcw, FilePlus2, Info, Lock } from 'lucide-react';
import { getMasterSchedule } from '../../../utils/services/masterScheduleService';
import type { MasterScheduleEntry, RouteIdentity } from '../../../utils/masterScheduleTypes';
import { shouldShowStartDirectionForRoute, normalizeDirectionHint, inferBlockStartDirection } from '../utils/blockStartDirection';
import { computeSuggestedStrictCycle } from '../../../utils/schedule/strictCycleSuggestion';
import { detectMasterCycleMode, type MasterCycleModeDetection } from '../../../utils/schedule/masterCycleMode';
import { buildStep2ApprovedRuntimeModelFromContract } from '../utils/step2ApprovedRuntimeModelAdapter';
import type { ApprovedRuntimeContract } from '../utils/step2ReviewTypes';
import type { ApprovedRuntimeModel } from '../utils/wizardState';
import { getStep3RouteDefaults } from '../utils/step3RouteDefaults';
import {
    MAX_RECOVERY_RATIO_PERCENT,
    validateScheduleGenerationConfig,
} from '../../../utils/schedule/scheduleGenerator';

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
    analysis?: TripBucketAnalysis[];
    approvedRuntimeContract?: ApprovedRuntimeContract | null;
    approvedRuntimeModel?: ApprovedRuntimeModel | null;
    config: ScheduleConfig;
    setConfig: (c: ScheduleConfig) => void;
    teamId?: string;
    stopSuggestions?: string[];
    autofillFromMaster: boolean;
    onAutofillFromMasterChange: (value: boolean) => void;
    onChangeRoute?: () => void;
}

const START_STOP_SUGGESTIONS_ID = 'start-stop-suggestions';

const blocksMatch = (left: BlockConfig, right: BlockConfig): boolean => (
    left.id === right.id
    && left.startTime === right.startTime
    && left.endTime === right.endTime
    && (left.startStop || '') === (right.startStop || '')
    && (left.endStop || '') === (right.endStop || '')
    && (left.startDirection || '') === (right.startDirection || '')
);

const isNextDayBlockEnd = (startTime: string, endTime: string): boolean => {
    const toMinutes = (value: string): number | null => {
        const match = value.match(/^(\d{2}):(\d{2})$/);
        if (!match) return null;
        return (Number(match[1]) * 60) + Number(match[2]);
    };
    const start = toMinutes(startTime);
    const end = toMinutes(endTime);
    return start !== null && end !== null && end < 240 && end < start;
};

export const Step3Build: React.FC<Step3Props> = ({
    dayType,
    bands,
    analysis,
    approvedRuntimeContract,
    config,
    setConfig,
    teamId,
    stopSuggestions = [],
    autofillFromMaster,
    onAutofillFromMasterChange,
    onChangeRoute,
}) => {

    // Autofill from Master Schedule state
    const [isLoadingMaster, setIsLoadingMaster] = React.useState(false);
    const [masterStatus, setMasterStatus] = React.useState<'idle' | 'loaded' | 'not-found'>('idle');
    const [usePerBandRecovery, setUsePerBandRecovery] = React.useState(true);
    const [displayBandDefaults, setDisplayBandDefaults] = React.useState<BandRecoveryDefault[]>([]);
    const [masterCycleModeDetection, setMasterCycleModeDetection] = React.useState<MasterCycleModeDetection | null>(null);
    const [masterEntry, setMasterEntry] = React.useState<MasterScheduleEntry | null>(null);
    const [masterBaselineBlocks, setMasterBaselineBlocks] = React.useState<BlockConfig[]>([]);
    const [masterReloadRequest, setMasterReloadRequest] = React.useState(0);
    const configRef = React.useRef(config);
    const lastRouteDefaultsKeyRef = React.useRef<string | null>(null);
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

    // Floating mode guardrail: prefill target recovery only when it is missing.
    // Explicit zero is valid; invalid negative/out-of-range values stay visible
    // so the planner can correct them instead of being silently rewritten.
    React.useEffect(() => {
        if (config.cycleMode !== 'Floating') return;
        if (config.recoveryRatio !== undefined) return;
        setConfig({ ...config, recoveryRatio: SCHEDULE_DEFAULTS.RECOVERY_RATIO });
    }, [config, setConfig]);

    React.useEffect(() => {
        const normalizedRouteKey = config.routeNumber
            .replace(/^route\s*/i, '')
            .replace(/\s*-\s*/g, '-')
            .trim()
            .toUpperCase();
        if (!normalizedRouteKey) {
            lastRouteDefaultsKeyRef.current = null;
            return;
        }

        if (lastRouteDefaultsKeyRef.current === normalizedRouteKey) {
            return;
        }
        lastRouteDefaultsKeyRef.current = normalizedRouteKey;

        const routeDefaults = getStep3RouteDefaults(config.routeNumber);
        if (!routeDefaults) return;

        const currentConfig = configRef.current;
        const nextConfig: ScheduleConfig = {
            ...currentConfig,
            cycleMode: routeDefaults.cycleMode,
            ...(routeDefaults.cycleTime !== undefined ? { cycleTime: routeDefaults.cycleTime } : {}),
            ...(routeDefaults.cycleMode === 'Floating'
                ? {
                    recoveryRatio: (currentConfig.recoveryRatio ?? 0) > 0
                        ? currentConfig.recoveryRatio
                        : SCHEDULE_DEFAULTS.RECOVERY_RATIO,
                }
                : {}),
        };

        const changed = nextConfig.cycleMode !== currentConfig.cycleMode
            || nextConfig.cycleTime !== currentConfig.cycleTime
            || nextConfig.recoveryRatio !== currentConfig.recoveryRatio;

        if (changed) {
            setConfig(nextConfig);
        }
    }, [config.routeNumber, setConfig]);

    const resolvedApprovedRuntimeModel = React.useMemo(
        () => buildStep2ApprovedRuntimeModelFromContract(approvedRuntimeContract),
        [approvedRuntimeContract]
    );

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
            setMasterCycleModeDetection(null);
            try {
                const routeIdentity = `${config.routeNumber}-${dayType}` as RouteIdentity;
                const result = await getMasterSchedule(teamId, routeIdentity);
                if (cancelled) return;

                if (!result) {
                    setMasterEntry(null);
                    setMasterBaselineBlocks([]);
                    setConfig({
                        ...configRef.current,
                        blocks: [],
                        bandRecoveryDefaults: undefined
                    });
                    setMasterStatus('not-found');
                    return;
                }

                const { content, entry } = result;
                const cycleModeDetection = detectMasterCycleMode(content);
                setMasterCycleModeDetection(cycleModeDetection);
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
                    setMasterEntry(entry);
                    setMasterBaselineBlocks(blocks);
                    setConfig({
                        ...configRef.current,
                        blocks,
                        cycleMode: cycleModeDetection.cycleMode,
                        cycleTime: globalCycleTime,
                        recoveryRatio: globalRecoveryRatio,
                        bandRecoveryDefaults: bandRecoveryDefaults.length > 0 ? bandRecoveryDefaults : undefined
                    });
                    setMasterStatus('loaded');
                } else {
                    setMasterEntry(entry);
                    setMasterBaselineBlocks([]);
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
    }, [autofillFromMaster, teamId, config.routeNumber, dayType, masterReloadRequest, setConfig]);

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
        if (autofillFromMaster && masterStatus === 'loaded' && config.cycleMode === 'Floating') return;
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
    }, [config.cycleMode, config.cycleTime, config.blocks.length, config.blocks[0]?.startTime, autofillFromMaster, masterStatus]);

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

    const baselineById = React.useMemo(
        () => new Map(masterBaselineBlocks.map(block => [block.id, block])),
        [masterBaselineBlocks]
    );
    const blockChangeSummary = React.useMemo(() => {
        let unchanged = 0;
        let edited = 0;
        let added = 0;

        config.blocks.forEach(block => {
            const baseline = baselineById.get(block.id);
            if (!baseline) {
                added += 1;
            } else if (blocksMatch(block, baseline)) {
                unchanged += 1;
            } else {
                edited += 1;
            }
        });

        const currentIds = new Set(config.blocks.map(block => block.id));
        const removed = masterBaselineBlocks.filter(block => !currentIds.has(block.id)).length;
        return { unchanged, edited, added, removed };
    }, [baselineById, config.blocks, masterBaselineBlocks]);
    const hasBlockChanges = blockChangeSummary.edited > 0
        || blockChangeSummary.added > 0
        || blockChangeSummary.removed > 0;

    const resetBlockToMaster = (blockId: string) => {
        const baseline = baselineById.get(blockId);
        if (!baseline) return;
        setConfig({
            ...config,
            blocks: config.blocks.map(block => block.id === blockId ? { ...baseline } : block),
        });
    };

    const resetAllBlocksToMaster = () => {
        if (masterBaselineBlocks.length === 0) return;
        setConfig({ ...config, blocks: masterBaselineBlocks.map(block => ({ ...block })) });
    };

    const reloadMasterBaseline = () => {
        if (hasBlockChanges && !window.confirm('Reloading the Master will replace your block changes. Continue?')) return;
        if (!autofillFromMaster) {
            onAutofillFromMasterChange(true);
            return;
        }
        setMasterReloadRequest(request => request + 1);
    };

    const startBlank = () => {
        if (config.blocks.length > 0 && !window.confirm('Start with a blank block configuration? Your current block rows will be removed.')) return;
        onAutofillFromMasterChange(false);
        setMasterStatus('idle');
        setMasterEntry(null);
        setMasterBaselineBlocks([]);
        setMasterCycleModeDetection(null);
        setDisplayBandDefaults([]);
        setConfig({ ...config, blocks: [], bandRecoveryDefaults: undefined });
    };

    const masterPublishedLabel = masterEntry?.publishedAt
        ? new Intl.DateTimeFormat('en-CA', { month: 'short', day: 'numeric', year: 'numeric' }).format(masterEntry.publishedAt)
        : null;

    const cycleTime = config.cycleTime;
    const computedHeadway = config.blocks.length > 0 ? cycleTime / config.blocks.length : 0;
    const strictCycleAnalysis = resolvedApprovedRuntimeModel?.buckets ?? analysis;
    const strictCycleBands = resolvedApprovedRuntimeModel?.bands ?? bands;
    const strictCycleSuggestion = React.useMemo(
        () => computeSuggestedStrictCycle(strictCycleAnalysis, strictCycleBands),
        [strictCycleAnalysis, strictCycleBands]
    );
    const suggestedStrictCycle = strictCycleSuggestion.minutes;
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
    const isHighConfidenceStrictCycle = strictCycleSuggestion.quality === 'high';
    const strictCycleLead = isHighConfidenceStrictCycle
        ? (strictCycleSeverity === 'critical' ? 'Strongly recommended:' : 'Check strict cycle:')
        : 'Reference only:';
    const strictCycleButtonLabel = isHighConfidenceStrictCycle
        ? `Use suggested ${suggestedStrictCycle}m`
        : `Use reference ${suggestedStrictCycle}m`;
    const configValidationIssues = React.useMemo(
        () => validateScheduleGenerationConfig(config),
        [config]
    );
    const blockValidationIssues = React.useMemo(() => {
        const byIndex = new Map<number, string[]>();
        configValidationIssues.forEach(issue => {
            if (issue.blockIndex === undefined) return;
            const messages = byIndex.get(issue.blockIndex) || [];
            messages.push(issue.message);
            byIndex.set(issue.blockIndex, messages);
        });
        return byIndex;
    }, [configValidationIssues]);

    return (
        <div className="h-full flex flex-col animate-in fade-in duration-500 overflow-hidden">
            <div className="flex justify-between items-start mb-4 flex-shrink-0">
                <div>
                    <h2 className="text-2xl font-bold text-gray-900 tracking-tight">Set the Service Plan</h2>
                    <p className="text-gray-500">
                        Carry the existing schedule forward, then adjust the proposed service for <strong>{dayType}</strong>.
                    </p>
                    {resolvedApprovedRuntimeModel && (
                        <p className="mt-1 text-xs text-gray-400">
                            Using the approved Step 2 runtime model: {resolvedApprovedRuntimeModel.usableBucketCount} active bucket{resolvedApprovedRuntimeModel.usableBucketCount === 1 ? '' : 's'} across {resolvedApprovedRuntimeModel.usableBandCount} band{resolvedApprovedRuntimeModel.usableBandCount === 1 ? '' : 's'}.
                        </p>
                    )}
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

            {/* The Master is an explicit baseline, not an incidental autofill utility. */}
            <div className={`mb-4 flex-shrink-0 rounded-xl border px-4 py-2.5 ${
                masterStatus === 'not-found' && autofillFromMaster
                    ? 'border-amber-200 bg-amber-50'
                    : autofillFromMaster
                        ? 'border-blue-200 bg-blue-50/70'
                        : 'border-gray-200 bg-white'
            }`} data-testid="step3-starting-schedule">
                <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
                    <div className="flex min-w-0 items-center gap-3">
                        <div className={`rounded-lg p-2 ${autofillFromMaster ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-500'}`}>
                            {isLoadingMaster ? <Loader2 size={18} className="animate-spin" /> : <Database size={18} />}
                        </div>
                        <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                                <span className="text-[10px] font-bold uppercase tracking-wide text-gray-500">Starting schedule</span>
                                {masterStatus === 'loaded' && autofillFromMaster && (
                                    <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700">Loaded</span>
                                )}
                            </div>
                            <p className="mt-0.5 font-bold text-gray-900">
                                {!autofillFromMaster
                                    ? 'Blank / manually configured'
                                    : masterStatus === 'not-found'
                                        ? `No current Master found for Route ${config.routeNumber} · ${dayType}`
                                        : isLoadingMaster
                                            ? `Loading current Master for Route ${config.routeNumber} · ${dayType}…`
                                            : `Current Master${masterEntry?.currentVersion ? ` v${masterEntry.currentVersion}` : ''} · Route ${config.routeNumber} · ${dayType}`}
                            </p>
                            <p className="mt-0.5 text-xs text-gray-600">
                                {masterStatus === 'loaded' && autofillFromMaster
                                    ? `${masterBaselineBlocks.length} block${masterBaselineBlocks.length === 1 ? '' : 's'} carried forward${masterPublishedLabel ? ` from ${masterPublishedLabel}` : ''}. Changes below affect only this working schedule.`
                                    : masterStatus === 'not-found' && autofillFromMaster
                                        ? 'You can configure the schedule manually or try loading the Master again.'
                                        : !autofillFromMaster
                                            ? 'This working schedule is not linked to a Master baseline.'
                                            : 'The current published schedule will be used as the editable starting point.'}
                            </p>
                        </div>
                    </div>

                    <div className="flex shrink-0 items-center gap-2 lg:justify-end">
                        <button
                            type="button"
                            onClick={reloadMasterBaseline}
                            disabled={!teamId || isLoadingMaster}
                            className="flex items-center gap-1.5 rounded-lg border border-blue-200 bg-white px-3 py-1.5 text-xs font-bold text-blue-700 transition-colors hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            <RefreshCw size={14} className={isLoadingMaster ? 'animate-spin' : ''} />
                            {autofillFromMaster ? 'Reload Master' : 'Use current Master'}
                        </button>
                        {autofillFromMaster && (
                            <button
                                type="button"
                                onClick={startBlank}
                                className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold text-gray-600 transition-colors hover:bg-white hover:text-gray-900"
                            >
                                <FilePlus2 size={14} /> Start blank
                            </button>
                        )}
                    </div>
                </div>
            </div>

            <div className="flex-grow min-h-0 overflow-y-auto pr-1 space-y-4">
                <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
                    <div className="mb-3 flex items-center gap-2">
                        <Bus className="text-brand-blue" size={18} />
                        <h3 className="font-bold text-gray-900">Service Settings</h3>
                    </div>

                    <div className="grid grid-cols-2 items-start gap-3 md:grid-cols-3 xl:grid-cols-10">
                        <div className="xl:col-span-2">
                            <label className="mb-1 block text-[11px] font-bold uppercase text-gray-500">Route</label>
                            {masterStatus === 'loaded' && autofillFromMaster ? (
                                <div className="flex h-[34px] items-center justify-between rounded-lg border border-gray-200 bg-gray-50 px-3">
                                    <span className="text-sm font-bold text-gray-800">{config.routeNumber}</span>
                                    {onChangeRoute && (
                                        <button type="button" onClick={onChangeRoute} className="text-[10px] font-semibold text-brand-blue hover:underline">
                                            Change in Step 1
                                        </button>
                                    )}
                                </div>
                            ) : (
                                <input
                                    type="text"
                                    value={config.routeNumber}
                                    onChange={e => setConfig({ ...config, routeNumber: e.target.value })}
                                    className="w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-bold text-gray-800 focus:border-brand-blue focus:ring-2 focus:ring-brand-blue/20"
                                    placeholder="e.g. 100"
                                />
                            )}
                        </div>

                        <div className="xl:col-span-2">
                            <label className="mb-1 block text-[11px] font-bold uppercase text-gray-500">Recovery distribution</label>
                            <select
                                value={config.recoveryDistribution || 'End'}
                                onChange={e => setConfig({ ...config, recoveryDistribution: e.target.value as 'End' | 'Proportional' })}
                                className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-xs font-bold text-gray-800 focus:border-brand-blue focus:ring-2 focus:ring-brand-blue/20"
                            >
                                <option value="End">End Only</option>
                                <option value="Proportional">Proportional</option>
                            </select>
                        </div>

                        <div className="xl:col-span-2">
                            <label className="mb-1 block text-[11px] font-bold uppercase text-gray-500">Cycle mode</label>
                            <div className="flex rounded-lg bg-gray-100 p-1">
                                <button
                                    type="button"
                                    onClick={() => setConfig({ ...config, cycleMode: 'Strict' })}
                                    className={`flex-1 rounded-md py-1 text-xs font-bold transition-all ${(!config.cycleMode || config.cycleMode === 'Strict') ? 'bg-white text-brand-blue shadow-sm' : 'text-gray-500'}`}
                                >
                                    Strict
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setConfig({
                                        ...config,
                                        cycleMode: 'Floating',
                                        recoveryRatio: (config.recoveryRatio ?? 0) > 0
                                            ? config.recoveryRatio
                                            : SCHEDULE_DEFAULTS.RECOVERY_RATIO
                                    })}
                                    className={`flex-1 rounded-md py-1 text-xs font-bold transition-all ${config.cycleMode === 'Floating' ? 'bg-white text-brand-blue shadow-sm' : 'text-gray-500'}`}
                                >
                                    Floating
                                </button>
                            </div>
                            {autofillFromMaster && masterStatus === 'loaded' && masterCycleModeDetection && (
                                <details className={`mt-1 rounded-md border px-2 py-1 text-[10px] ${masterCycleModeDetection.source !== 'metadata' && masterCycleModeDetection.confidence === 'low' ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-blue-100 bg-blue-50 text-blue-800'}`}>
                                    <summary className="cursor-pointer font-semibold">
                                        Master: {masterCycleModeDetection.cycleMode}
                                        <span className="ml-1 font-normal opacity-80">· {masterCycleModeDetection.source === 'metadata' ? 'saved setting' : `${masterCycleModeDetection.confidence} confidence`} · Why?</span>
                                    </summary>
                                    <p className="mt-1 text-[10px] opacity-90">{masterCycleModeDetection.summary}</p>
                                    {config.cycleMode !== 'Floating' && config.blocks.length > 1 && (
                                        <p className="mt-1 text-[10px] opacity-90">Strict mode keeps block starts on a fixed clockface grid based on cycle ÷ buses.</p>
                                    )}
                                </details>
                            )}
                        </div>

                        <div>
                            <label className="mb-1 block text-[11px] font-bold uppercase text-gray-500">
                                {config.cycleMode === 'Floating' ? 'Reference cycle' : 'Strict cycle'}
                            </label>
                            <div className="relative">
                                <input
                                    type="number"
                                    min={config.cycleMode === 'Floating' ? 0 : 1}
                                    step={1}
                                    value={config.cycleTime}
                                    onChange={e => setConfig({ ...config, cycleTime: Number(e.target.value) })}
                                    placeholder={config.cycleMode === 'Floating' ? 'Optional' : undefined}
                                    className={`w-full rounded-lg border py-1.5 pl-8 pr-8 text-sm font-bold focus:border-brand-blue focus:ring-2 focus:ring-brand-blue/20 ${config.cycleMode === 'Floating' ? 'border-gray-200 bg-gray-50 text-gray-600' : 'border-brand-blue/30 bg-white text-gray-900'}`}
                                />
                                <Clock size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                                <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] font-bold text-gray-400">MIN</span>
                            </div>
                        </div>

                        {config.cycleMode === 'Floating' && (
                            <div>
                                <label className="mb-1 block text-[11px] font-bold uppercase text-brand-blue">Target recovery</label>
                                <div className="relative">
                                    <input
                                        type="number"
                                        min={0}
                                        max={MAX_RECOVERY_RATIO_PERCENT}
                                        step={1}
                                        value={config.recoveryRatio ?? SCHEDULE_DEFAULTS.RECOVERY_RATIO}
                                        onChange={e => setConfig({ ...config, recoveryRatio: Number(e.target.value) })}
                                        className="w-full rounded-lg border border-brand-blue/30 bg-blue-50/50 py-1.5 pl-3 pr-7 text-sm font-bold text-brand-blue focus:border-brand-blue focus:ring-2 focus:ring-brand-blue/20"
                                    />
                                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-brand-blue/50">%</span>
                                </div>
                            </div>
                        )}

                        <div className={`rounded-lg border border-blue-100 bg-blue-50 px-3 py-1.5 ${config.cycleMode === 'Floating' ? 'xl:col-span-2' : 'xl:col-span-3'}`}>
                            <span className="block text-[10px] font-bold uppercase text-blue-600">Service metrics</span>
                            <div className="mt-0.5 grid grid-cols-2 gap-3">
                                <div className="flex items-baseline justify-between gap-1 whitespace-nowrap">
                                    <span className="text-[10px] font-medium text-blue-600">Headway</span>
                                    <strong className="text-sm text-blue-900">{Number.isInteger(computedHeadway) ? computedHeadway : computedHeadway.toFixed(1)} min</strong>
                                </div>
                                <div className="flex items-baseline justify-between gap-1 whitespace-nowrap border-l border-blue-200 pl-3">
                                    <span className="text-[10px] font-medium text-blue-600">Blocks</span>
                                    <strong className="text-sm text-blue-900">{config.blocks.length}</strong>
                                </div>
                            </div>
                            {displayBandDefaults.length > 0 && usePerBandRecovery && (
                                <span className="block text-[9px] text-blue-600">Recovery varies by band</span>
                            )}
                        </div>
                    </div>

                    {strictCycleSeverity && (
                        <div className={`mt-3 rounded-lg border px-3 py-2 ${strictCycleSeverity === 'critical' ? 'border-red-200 bg-red-50' : 'border-amber-200 bg-amber-50'}`}>
                            <p className={`text-[11px] font-semibold ${strictCycleSeverity === 'critical' ? 'text-red-800' : 'text-amber-800'}`}>
                                {strictCycleLead} {cycleTime}m is {strictCycleDeltaPct! > 0 ? `${strictCycleDeltaPct}% above` : `${Math.abs(strictCycleDeltaPct!)}% below`} {strictCycleSuggestion.basisLabel} (~{suggestedStrictCycle}m).
                                {' '}
                                <button
                                    type="button"
                                    onClick={() => setConfig({ ...config, cycleTime: suggestedStrictCycle! })}
                                    className="font-bold underline"
                                >
                                    {strictCycleButtonLabel}
                                </button>
                            </p>
                            {!isHighConfidenceStrictCycle && (
                                <p className="mt-1 text-[10px] text-gray-600">This is reference evidence, not a high-confidence planner default.</p>
                            )}
                        </div>
                    )}

                    {configValidationIssues.length > 0 && (
                        <div
                            role="alert"
                            data-testid="step3-config-validation"
                            className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-red-800"
                        >
                            <div className="flex items-center gap-2 text-xs font-bold">
                                <AlertTriangle size={14} /> Fix the service plan before generating
                            </div>
                            <ul className="mt-1 list-disc space-y-0.5 pl-5 text-[11px] font-medium">
                                {configValidationIssues.map((issue, index) => (
                                    <li key={`${issue.code}-${issue.blockIndex ?? 'global'}-${index}`}>{issue.message}</li>
                                ))}
                            </ul>
                        </div>
                    )}

                    {displayBandDefaults.length > 0 && (
                        <details className="mt-3 border-t border-gray-100 pt-2">
                            <summary className="cursor-pointer text-xs font-semibold text-gray-700">
                                Master recovery defaults · {displayBandDefaults.length} band{displayBandDefaults.length === 1 ? '' : 's'} · {usePerBandRecovery ? 'In use' : 'Not in use'}
                            </summary>
                            <div className="mt-2 max-w-xl rounded-lg bg-gray-50 p-3">
                                {config.cycleMode !== 'Floating' && (
                                    <p className="mb-2 text-[11px] text-gray-600">These defaults affect Floating mode only.</p>
                                )}
                                <table className="w-full text-left text-xs">
                                    <thead className="text-gray-500">
                                        <tr>
                                            <th className="py-1 font-bold">Band</th>
                                            <th className="py-1 text-right font-bold">Cycle</th>
                                            <th className="py-1 text-right font-bold">Recovery</th>
                                            <th className="py-1 text-right font-bold">Trips</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {displayBandDefaults.map(bd => {
                                            const bandColor = bands.find(b => b.id === bd.bandId)?.color;
                                            return (
                                                <tr key={bd.bandId} className="text-gray-700">
                                                    <td className="flex items-center gap-1.5 py-0.5">
                                                        {bandColor && <div className="h-2 w-2 rounded-full" style={{ backgroundColor: bandColor, opacity: usePerBandRecovery ? 1 : 0.4 }} />}
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
                                <label className="mt-2 flex cursor-pointer items-center gap-2">
                                    <input
                                        type="checkbox"
                                        checked={usePerBandRecovery}
                                        onChange={e => setUsePerBandRecovery(e.target.checked)}
                                        className="rounded border-emerald-300 text-emerald-600 focus:ring-emerald-500"
                                    />
                                    <span className="text-xs font-medium text-gray-700">Use per-band defaults</span>
                                </label>
                            </div>
                        </details>
                    )}
                </div>

                <div className="min-h-0 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
                    <div className="flex flex-col gap-3 border-b border-gray-200 bg-white p-4 md:flex-row md:items-center md:justify-between">
                        <div>
                            <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                                <LayoutGrid size={20} className="text-gray-400" />
                                Proposed Block Configuration
                            </h3>
                            <p className="text-[11px] text-gray-500 mt-1">
                                Edit the start location and service span as needed. End locations are calculated from the generated trips.
                            </p>
                            {showStartDirectionColumn && (
                                <p className="text-[11px] text-blue-600 mt-1">
                                    Route 8 tip: <strong>Park Place</strong> starts Northbound, <strong>Georgian College</strong> starts Southbound.
                                </p>
                            )}
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                            {masterStatus === 'loaded' && autofillFromMaster && (
                                <div className="mr-1 flex flex-wrap items-center gap-1.5 text-[10px] font-bold">
                                    {!hasBlockChanges ? (
                                        <span className="rounded-full bg-gray-100 px-2 py-1 text-gray-600">Matches Master · {config.blocks.length} block{config.blocks.length === 1 ? '' : 's'}</span>
                                    ) : (
                                        <span className="rounded-full bg-gray-100 px-2 py-1 text-gray-600">{blockChangeSummary.unchanged} unchanged</span>
                                    )}
                                    {blockChangeSummary.edited > 0 && <span className="rounded-full bg-blue-100 px-2 py-1 text-blue-700">{blockChangeSummary.edited} edited</span>}
                                    {blockChangeSummary.added > 0 && <span className="rounded-full bg-emerald-100 px-2 py-1 text-emerald-700">{blockChangeSummary.added} new</span>}
                                    {blockChangeSummary.removed > 0 && <span className="rounded-full bg-red-100 px-2 py-1 text-red-700">{blockChangeSummary.removed} removed</span>}
                                </div>
                            )}
                            {masterStatus === 'loaded' && hasBlockChanges && (
                                <button
                                    type="button"
                                    onClick={resetAllBlocksToMaster}
                                    className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900"
                                >
                                    <RotateCcw size={14} /> Reset blocks
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

                    <div className="overflow-x-auto">
                        <table className={`w-full text-left ${showStartDirectionColumn ? 'min-w-[1040px]' : 'min-w-[900px]'}`}>
                            <thead className="bg-gray-50 border-b border-gray-200 sticky top-0 z-10">
                                <tr>
                                    <th className="px-4 py-3 text-xs font-bold text-gray-500 uppercase">Block ID</th>
                                    <th className="px-4 py-3 text-xs font-bold text-gray-500 uppercase">Start Time</th>
                                    <th className="px-4 py-3 text-xs font-bold text-gray-500 uppercase">Start Location</th>
                                    {showStartDirectionColumn && <th className="px-4 py-3 text-xs font-bold text-gray-500 uppercase">Start Dir</th>}
                                    <th className="px-4 py-3 text-xs font-bold text-gray-500 uppercase">End Time</th>
                                    <th className="px-4 py-3 text-xs font-bold text-gray-500 uppercase">
                                        <span className="inline-flex items-center gap-1">
                                            End Location
                                            <Info size={12} className="text-gray-400" aria-label="Calculated from generated trips" />
                                        </span>
                                    </th>
                                    <th className="px-4 py-3 text-xs font-bold text-gray-500 uppercase text-right">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                                {config.blocks.map((block, idx) => {
                                    const masterBlock = baselineById.get(block.id);
                                    const blockStatus = !masterBlock
                                        ? 'new'
                                        : blocksMatch(block, masterBlock)
                                            ? 'master'
                                            : 'edited';
                                    const fieldChanged = (field: keyof BlockConfig): boolean => (
                                        Boolean(masterBlock)
                                        && String(block[field] ?? '') !== String(masterBlock?.[field] ?? '')
                                    );
                                    const rowValidationMessages = blockValidationIssues.get(idx) || [];
                                    const hasBlockIdError = rowValidationMessages.some(message => (
                                        message.includes('block ID') || message.includes('Block ID')
                                    ));
                                    return (
                                    <tr
                                        key={idx}
                                        className={`transition-colors ${
                                            blockStatus === 'edited'
                                                ? 'bg-blue-50/40 hover:bg-blue-50/70'
                                                : blockStatus === 'new'
                                                    ? 'bg-emerald-50/30 hover:bg-emerald-50/60'
                                                    : 'hover:bg-gray-50'
                                        }`}
                                    >
                                        <td className="px-4 py-3">
                                            <input
                                                type="text"
                                                value={block.id}
                                                onChange={e => updateBlock(idx, 'id', e.target.value)}
                                                aria-invalid={hasBlockIdError}
                                                aria-describedby={hasBlockIdError ? `block-${idx}-id-error` : undefined}
                                                className={`w-24 bg-transparent font-bold focus:outline-none focus:underline ${hasBlockIdError ? 'text-red-700 underline decoration-red-400' : 'text-gray-900'}`}
                                            />
                                            {hasBlockIdError && (
                                                <span id={`block-${idx}-id-error`} className="mt-1 block max-w-40 text-[10px] font-semibold text-red-700">
                                                    {rowValidationMessages.find(message => message.includes('block ID') || message.includes('Block ID'))}
                                                </span>
                                            )}
                                            {blockStatus !== 'master' && (
                                                <span className={`mt-1 block w-fit rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide ${blockStatus === 'edited' ? 'bg-blue-100 text-blue-700' : 'bg-emerald-100 text-emerald-700'}`}>
                                                    {blockStatus}
                                                </span>
                                            )}
                                        </td>
                                        <td className="px-4 py-3">
                                            <input
                                                type="time"
                                                value={block.startTime}
                                                onChange={e => updateBlock(idx, 'startTime', e.target.value)}
                                                className={`${fieldChanged('startTime') ? 'border-blue-300 bg-blue-50 text-blue-900' : idx === 0 ? 'border-gray-200 bg-white' : 'border-gray-200 bg-gray-50'} w-[126px] rounded-md border px-2 py-1 text-sm font-medium outline-none focus:border-brand-blue focus:ring-2 focus:ring-brand-blue/20`}
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
                                                className={`w-full min-w-[190px] rounded-md border px-2 py-1 text-sm outline-none focus:border-brand-blue focus:ring-2 focus:ring-brand-blue/20 ${fieldChanged('startStop') ? 'border-blue-300 bg-blue-50 text-blue-900' : 'border-gray-200 bg-white text-gray-700'}`}
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
                                                    className={`text-xs font-semibold rounded-full px-2 py-0.5 border outline-none cursor-pointer ${fieldChanged('startDirection') ? 'ring-2 ring-blue-200 ' : ''}${
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
                                            <div className="flex items-center gap-2">
                                                <input
                                                    type="time"
                                                    value={block.endTime}
                                                    onChange={e => updateBlock(idx, 'endTime', e.target.value)}
                                                    className={`w-[126px] rounded-md border px-2 py-1 text-sm font-medium outline-none focus:border-brand-blue focus:ring-2 focus:ring-brand-blue/20 ${fieldChanged('endTime') ? 'border-blue-300 bg-blue-50 text-blue-900' : 'border-gray-200 bg-gray-50'}`}
                                                />
                                                {isNextDayBlockEnd(block.startTime, block.endTime) && (
                                                    <span className="whitespace-nowrap rounded-full bg-indigo-50 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-indigo-700">+1 day</span>
                                                )}
                                            </div>
                                        </td>
                                        <td className="px-4 py-3">
                                            {block.endStop ? (
                                                <div className="flex min-w-[180px] items-center gap-2 rounded-md bg-gray-50 px-2 py-1 text-sm text-gray-600" title="Calculated from generated trips">
                                                    <Lock size={12} className="shrink-0 text-gray-400" />
                                                    <span>{block.endStop}</span>
                                                </div>
                                            ) : (
                                                <span className="text-xs text-gray-300">—</span>
                                            )}
                                        </td>
                                        <td className="px-4 py-3 text-right">
                                            <div className="flex items-center justify-end gap-1">
                                                {blockStatus === 'edited' && (
                                                    <button
                                                        type="button"
                                                        onClick={() => resetBlockToMaster(block.id)}
                                                        className="rounded-lg p-2 text-blue-500 transition-colors hover:bg-blue-100 hover:text-blue-700"
                                                        title="Reset this block to the Master"
                                                        aria-label={`Reset ${block.id} to Master`}
                                                    >
                                                        <RotateCcw size={15} />
                                                    </button>
                                                )}
                                                <button
                                                    type="button"
                                                    onClick={() => removeBlock(idx)}
                                                    className="rounded-lg p-2 text-gray-500 transition-colors hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-40"
                                                    disabled={config.blocks.length <= 1}
                                                    title="Remove block from the proposed schedule"
                                                    aria-label={`Remove ${block.id}`}
                                                >
                                                    <Trash2 size={16} />
                                                </button>
                                            </div>
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
