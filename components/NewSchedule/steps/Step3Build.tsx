
import React from 'react';
import { TimeBand } from '../../../utils/runtimeAnalysis';
import { Clock, Bus, Plus, Trash2, LayoutGrid, Loader2, Database } from 'lucide-react';
import { getMasterSchedule } from '../../../utils/masterScheduleService';
import type { RouteIdentity } from '../../../utils/masterScheduleTypes';

// Configuration Constants
export const SCHEDULE_DEFAULTS = {
    CYCLE_TIME: 60,           // Default cycle time in minutes
    RECOVERY_RATIO: 0,        // Default recovery ratio (0% since GTFS times are complete)
    START_TIME: '06:00',      // Default block start time
    END_TIME: '22:00',        // Default block end time
    ROUTE_NUMBER: '10'        // Default route number
} as const;

export interface BlockConfig {
    id: string; // "100-1"
    startTime: string; // "06:00"
    endTime: string; // "20:00"
}

export interface ScheduleConfig {
    routeNumber: string;
    cycleMode?: 'Strict' | 'Floating'; // New
    cycleTime: number;
    recoveryRatio?: number; // percent, e.g. 15
    recoveryDistribution?: 'End' | 'Proportional';
    // Headway is now calculated
    blocks: BlockConfig[];
}

interface Step3Props {
    dayType: string;
    bands: TimeBand[];
    config: ScheduleConfig;
    setConfig: (c: ScheduleConfig) => void;
    teamId?: string;
}

export const Step3Build: React.FC<Step3Props> = ({ dayType, bands, config, setConfig, teamId }) => {

    // Autofill from Master Schedule state
    const [autofillFromMaster, setAutofillFromMaster] = React.useState(true);
    const [isLoadingMaster, setIsLoadingMaster] = React.useState(false);
    const [masterStatus, setMasterStatus] = React.useState<'idle' | 'loaded' | 'not-found'>('idle');
    const configRef = React.useRef(config);
    React.useEffect(() => { configRef.current = config; }, [config]);

    // Convert minutes-from-midnight to "HH:MM" string
    const minutesToTimeStr = (minutes: number): string => {
        const normalized = ((minutes % 1440) + 1440) % 1440;
        const h = Math.floor(normalized / 60);
        const m = normalized % 60;
        return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    };

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

    // Extract effective min/max times from a trip by scanning all stop times
    const getEffectiveTimes = (trip: { startTime: number; endTime: number; stopMinutes?: Record<string, number>; stops?: Record<string, string> }) => {
        let start = trip.startTime;
        let end = trip.endTime;

        if (trip.stopMinutes && Object.keys(trip.stopMinutes).length > 0) {
            const times = Object.values(trip.stopMinutes) as number[];
            start = Math.min(start, ...times);
            end = Math.max(end, ...times);
        } else if (trip.stops && Object.keys(trip.stops).length > 0) {
            for (const timeStr of Object.values(trip.stops)) {
                const parsed = parseTimeToMinutes(timeStr as string);
                if (parsed !== null) {
                    if (parsed < start) start = parsed;
                    if (parsed > end) end = parsed;
                }
            }
        }

        return { start, end };
    };

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
                const allTrips = [...content.northTable.trips, ...content.southTable.trips];

                // Group by blockId, scanning all stop times for true min/max
                const blockMap = new Map<string, { startTime: number; endTime: number }>();
                for (const trip of allTrips) {
                    const { start, end } = getEffectiveTimes(trip);
                    const existing = blockMap.get(trip.blockId);
                    if (!existing) {
                        blockMap.set(trip.blockId, { startTime: start, endTime: end });
                    } else {
                        if (start < existing.startTime) existing.startTime = start;
                        if (end > existing.endTime) existing.endTime = end;
                    }
                }

                // Convert to BlockConfig, sorted by start time
                const blocks: BlockConfig[] = Array.from(blockMap.entries())
                    .sort((a, b) => a[1].startTime - b[1].startTime)
                    .map(([blockId, data]) => ({
                        id: blockId,
                        startTime: minutesToTimeStr(data.startTime),
                        endTime: minutesToTimeStr(data.endTime)
                    }));

                if (blocks.length > 0 && !cancelled) {
                    setConfig({ ...configRef.current, blocks });
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
        setConfig({ ...config, blocks: newBlocks });
    };

    const cycleTime = config.cycleTime;
    const computedHeadway = config.blocks.length > 0 ? cycleTime / config.blocks.length : 0;

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
                                    onClick={() => setConfig({ ...config, cycleMode: 'Floating' })}
                                    className={`flex-1 py-1 text-xs font-bold rounded-md transition-all ${config.cycleMode === 'Floating' ? 'bg-white text-brand-blue shadow-sm' : 'text-gray-500'}`}
                                >
                                    Floating
                                </button>
                            </div>

                            {config.cycleMode === 'Floating' ? (
                                <div className="grid grid-cols-2 gap-4 animate-in fade-in slide-in-from-top-2 duration-200">
                                    <div>
                                        <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Reference Cycle</label>
                                        <div className="relative">
                                            <input
                                                type="number"
                                                value={config.cycleTime}
                                                onChange={e => setConfig({ ...config, cycleTime: parseInt(e.target.value) || 0 })}
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
                                                onChange={e => setConfig({ ...config, recoveryRatio: parseInt(e.target.value) || 0 })}
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
                            </div>
                            <div>
                                <span className="text-xs text-blue-600 font-medium block">Blocks</span>
                                <span className="text-xl font-bold text-blue-900">{config.blocks.length}</span>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Right Column: Block Definitions */}
                <div className="lg:col-span-8 flex flex-col h-full min-h-0 bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                    <div className="p-4 border-b border-gray-200 bg-white flex items-center justify-between flex-shrink-0">
                        <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                            <LayoutGrid size={20} className="text-gray-400" />
                            Block Configuration
                        </h3>
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
                                    <th className="px-6 py-3 text-xs font-bold text-gray-500 uppercase">Block ID</th>
                                    <th className="px-6 py-3 text-xs font-bold text-gray-500 uppercase">Start Time</th>
                                    <th className="px-6 py-3 text-xs font-bold text-gray-500 uppercase">End Time</th>
                                    <th className="px-6 py-3 text-xs font-bold text-gray-500 uppercase text-right">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                                {config.blocks.map((block, idx) => (
                                    <tr key={idx} className="hover:bg-gray-50 transition-colors">
                                        <td className="px-6 py-4">
                                            <input
                                                type="text"
                                                value={block.id}
                                                onChange={e => updateBlock(idx, 'id', e.target.value)}
                                                className="bg-transparent font-bold text-gray-900 focus:outline-none focus:underline w-24"
                                            />
                                        </td>
                                        <td className="px-6 py-4">
                                            <input
                                                type="time"
                                                value={block.startTime}
                                                onChange={e => updateBlock(idx, 'startTime', e.target.value)}
                                                className={`${idx === 0 ? 'bg-white' : 'bg-gray-50'} border border-gray-200 rounded-md px-2 py-1 text-sm font-medium focus:ring-2 focus:ring-brand-blue/20 focus:border-brand-blue outline-none`}
                                                title={idx > 0 ? "Auto-filled based on headway (editable)" : "Start time for Block 1"}
                                            />
                                        </td>
                                        <td className="px-6 py-4">
                                            <input
                                                type="time"
                                                value={block.endTime}
                                                onChange={e => updateBlock(idx, 'endTime', e.target.value)}
                                                className="bg-gray-50 border border-gray-200 rounded-md px-2 py-1 text-sm font-medium focus:ring-2 focus:ring-brand-blue/20 focus:border-brand-blue outline-none"
                                            />
                                        </td>
                                        <td className="px-6 py-4 text-right">
                                            <button
                                                onClick={() => removeBlock(idx)}
                                                className="text-gray-400 hover:text-red-500 p-2 hover:bg-red-50 rounded-lg transition-colors"
                                                disabled={config.blocks.length <= 1}
                                            >
                                                <Trash2 size={16} />
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                        {config.blocks.length === 0 && (
                            <div className="p-8 text-center text-gray-400 italic">No blocks defined. Add a block to start.</div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};
