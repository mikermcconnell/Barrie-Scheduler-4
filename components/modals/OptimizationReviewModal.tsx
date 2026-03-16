import React, { useState, useMemo } from 'react';
import { Shift, Requirement, TimeSlot, Zone, ZoneFilterType, type OnDemandChangeoffSettings } from '../../utils/demandTypes';
import { GapChart } from '../GapChart';
import { calculateSchedule, formatSlotToTime, calculateMetrics } from '../../utils/dataGenerator';
import { Check, X, ArrowRight, AlertTriangle, Sparkles, CheckSquare, Square, Eye, EyeOff, BarChart } from 'lucide-react';
import { SummaryCards } from '../SummaryCards';

interface Props {
    currentShifts: Shift[];
    optimizedShifts: Shift[];
    requirements: Requirement[];
    changeoffSettings?: Partial<OnDemandChangeoffSettings>;
    onApply: (finalShifts: Shift[]) => void;
    onCancel: () => void;
}

type ChangeType = 'ADD' | 'REMOVE' | 'MODIFY' | 'NONE';

interface ShiftChange {
    id: string; // Unique ID for the change itself
    shiftId: string;
    type: ChangeType;
    description: string;
    impact?: string;
    original?: Shift;
    optimized?: Shift;
}

type ViewMode = 'original' | 'custom' | 'optimized';

export const OptimizationReviewModal: React.FC<Props> = ({
    currentShifts,
    optimizedShifts,
    requirements,
    changeoffSettings,
    onApply,
    onCancel
}) => {
    const [selectedChangeIds, setSelectedChangeIds] = useState<Set<string>>(() => new Set());
    const [zoneFilter, setZoneFilter] = useState<ZoneFilterType>('All');
    const [viewMode, setViewMode] = useState<ViewMode>('custom');

    // 1. Calculate Diffs
    const changes = useMemo(() => {
        const changesList: ShiftChange[] = [];
        const currentMap = new Map(currentShifts.map(s => [s.id, s]));
        const optMap = new Map(optimizedShifts.map(s => [s.id, s]));

        // Identify MODIFIED and REMOVED
        currentShifts.forEach(curr => {
            const opt = optMap.get(curr.id);
            if (!opt) {
                changesList.push({
                    id: `del-${curr.id}`,
                    shiftId: curr.id,
                    type: 'REMOVE',
                    description: `Remove Shift (${formatSlotToTime(curr.startSlot)} - ${formatSlotToTime(curr.endSlot)})`,
                    impact: 'Redundant Coverage',
                    original: curr
                });
            } else {
                // Check for modifications
                const isDiff =
                    curr.startSlot !== opt.startSlot ||
                    curr.endSlot !== opt.endSlot ||
                    curr.breakStartSlot !== opt.breakStartSlot ||
                    curr.zone !== opt.zone;

                if (isDiff) {
                    let specificReason = 'Efficiency Update';
                    let impactType = 'Optimization';

                    if (curr.zone !== opt.zone) {
                        specificReason = `Zone Change: ${curr.zone} -> ${opt.zone}`;
                        impactType = 'Rebalancing';
                    } else if (Math.abs(curr.startSlot - opt.startSlot) > 0 && (curr.endSlot - curr.startSlot) === (opt.endSlot - opt.startSlot)) {
                        // Shift moved, duration same
                        const diff = opt.startSlot - curr.startSlot;
                        const timeDiff = diff * 15;
                        specificReason = `Shift Moved ${diff > 0 ? '+' : ''}${timeDiff} min`;
                        impactType = 'Gap Fix';
                    } else if ((curr.endSlot - curr.startSlot) !== (opt.endSlot - opt.startSlot)) {
                        // Duration changed
                        const oldDur = (curr.endSlot - curr.startSlot) * 15;
                        const newDur = (opt.endSlot - opt.startSlot) * 15;
                        const diff = newDur - oldDur;
                        specificReason = diff > 0 ? `Extended Shift (+${diff}m)` : `Shortened Shift (${diff}m)`;
                        impactType = diff > 0 ? 'Coverage Boost' : 'Reduce Surplus';
                    } else if (curr.breakStartSlot !== opt.breakStartSlot) {
                        specificReason = 'Break Rescheduled';
                        impactType = 'Break Compliance';
                    }

                    changesList.push({
                        id: `mod-${curr.id}`,
                        shiftId: curr.id,
                        type: 'MODIFY',
                        description: `${curr.driverName}: ${specificReason}`,
                        impact: impactType,
                        original: curr,
                        optimized: opt
                    });
                }
            }
        });

        // Identify ADDED
        optimizedShifts.forEach(opt => {
            // If it doesn't exist in current map (and wasn't just matched by ID)
            if (!currentMap.has(opt.id)) {
                changesList.push({
                    id: `add-${opt.id}`,
                    shiftId: opt.id,
                    type: 'ADD',
                    description: `Add New Shift (${formatSlotToTime(opt.startSlot)} - ${formatSlotToTime(opt.endSlot)})`,
                    impact: 'Fixes Gap',
                    optimized: opt
                });
            }
        });

        return changesList;
    }, [currentShifts, optimizedShifts]);

    // Initialize all selected by default
    React.useEffect(() => {
        setSelectedChangeIds(new Set(changes.map(c => c.id)));
    }, [changes]);

    // 2. Generate Custom Mix Data based on selection
    const customMixShifts = useMemo(() => {
        // Start with current shifts
        let result = [...currentShifts];

        // Apply strict "Change Logic"
        const selectedRemovals = new Set(changes.filter(c => c.type === 'REMOVE' && selectedChangeIds.has(c.id)).map(c => c.shiftId));
        const selectedMods = new Map(changes.filter(c => c.type === 'MODIFY' && selectedChangeIds.has(c.id)).map(c => [c.shiftId, c.optimized!]));
        const selectedAdds = changes.filter(c => c.type === 'ADD' && selectedChangeIds.has(c.id)).map(c => c.optimized!);

        // Filter removals
        result = result.filter(s => !selectedRemovals.has(s.id));

        // Apply mods
        result = result.map(s => selectedMods.has(s.id) ? selectedMods.get(s.id)! : s);

        // Add new
        result = [...result, ...selectedAdds];

        return result;
    }, [currentShifts, changes, selectedChangeIds]);

    // 3. Determine Display Data based on View Mode
    const displayedShifts = useMemo(() => {
        switch (viewMode) {
            case 'original': return currentShifts;
            case 'optimized': return optimizedShifts;
            case 'custom': return customMixShifts;
            default: return customMixShifts;
        }
    }, [viewMode, currentShifts, optimizedShifts, customMixShifts]);

    const displayedSlots = useMemo(
        () => calculateSchedule(displayedShifts, requirements, changeoffSettings),
        [changeoffSettings, displayedShifts, requirements]
    );

    // Pass displayedShifts to calculateMetrics for accurate "MVT Supply" (Payable Hours)
    const metrics = useMemo(() => calculateMetrics(displayedSlots, displayedShifts), [displayedSlots, displayedShifts]);

    const toggleChange = (id: string) => {
        const next = new Set(selectedChangeIds);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        setSelectedChangeIds(next);
        if (viewMode !== 'custom') setViewMode('custom'); // Auto-switch to custom if user tweaks
    };

    const toggleAll = () => {
        if (selectedChangeIds.size === changes.length) {
            setSelectedChangeIds(new Set());
        } else {
            setSelectedChangeIds(new Set(changes.map(c => c.id)));
        }
        if (viewMode !== 'custom') setViewMode('custom');
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
            {/* Expanded Modal Size */}
            <div className="bg-white w-full max-w-[95vw] h-[95vh] rounded-3xl shadow-2xl flex flex-col overflow-hidden border border-gray-100">

                {/* Header */}
                <div className="flex justify-between items-center px-8 py-5 border-b border-gray-100 bg-white">
                    <div>
                        <h2 className="text-2xl font-extrabold text-gray-800 flex items-center gap-2">
                            <Sparkles className="text-purple-600" /> Refined Schedule Review
                        </h2>
                        <p className="text-gray-500 font-bold text-sm">Gemini AI proposed {changes.length} optimizations.</p>
                    </div>

                    {/* View Toggle (Segmented Control) */}
                    <div className="flex bg-gray-100 p-1 rounded-xl">
                        <button
                            onClick={() => setViewMode('original')}
                            className={`px-4 py-2 rounded-lg text-sm font-bold transition-all ${viewMode === 'original' ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                        >
                            Original
                        </button>
                        <button
                            onClick={() => setViewMode('custom')}
                            className={`px-4 py-2 rounded-lg text-sm font-bold transition-all ${viewMode === 'custom' ? 'bg-white text-brand-blue shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                        >
                            Custom Mix
                        </button>
                        <button
                            onClick={() => setViewMode('optimized')}
                            className={`px-4 py-2 rounded-lg text-sm font-bold transition-all ${viewMode === 'optimized' ? 'bg-white text-purple-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                        >
                            Fully Optimized
                        </button>
                    </div>

                    <button onClick={onCancel} className="p-2 hover:bg-gray-100 rounded-full text-gray-400">
                        <X size={24} />
                    </button>
                </div>

                {/* Content Grid */}
                <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 min-h-0 bg-gray-50">

                    {/* Left: Change List (3 cols) - Only active in Custom mode essentially, but visible always */}
                    <div className="lg:col-span-3 bg-white border-r border-gray-200 flex flex-col min-h-0">
                        <div className="p-4 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
                            <span className="font-extrabold text-gray-600 text-sm">Proposed Changes</span>
                            <button
                                onClick={toggleAll}
                                className="text-xs font-bold text-brand-blue hover:text-blue-700 flex items-center gap-1"
                            >
                                {selectedChangeIds.size === changes.length ? <CheckSquare size={14} /> : <Square size={14} />}
                                {selectedChangeIds.size === changes.length ? 'Deselect All' : 'Select All'}
                            </button>
                        </div>

                        <div className={`flex-1 overflow-y-auto p-4 space-y-3 ${viewMode !== 'custom' ? 'opacity-50 pointer-events-none grayscale' : ''}`}>
                            {/* Overlay hint if not in custom mode */}
                            {viewMode !== 'custom' && (
                                <div className="absolute inset-0 z-10 flex items-center justify-center pointer-events-none">
                                    <div className="bg-black/70 text-white px-4 py-2 rounded-xl font-bold backdrop-blur-md">
                                        Viewing {viewMode === 'original' ? 'Original' : 'Optimized'} Preview
                                    </div>
                                </div>
                            )}

                            {changes.length === 0 && (
                                <div className="text-center text-gray-400 py-10 italic">
                                    No changes found. Your schedule is already optimal!
                                </div>
                            )}
                            {changes.map(change => (
                                <div
                                    key={change.id}
                                    onClick={() => toggleChange(change.id)}
                                    className={`
                                        group p-3 rounded-xl border-2 transition-all cursor-pointer select-none relative
                                        ${selectedChangeIds.has(change.id)
                                            ? 'bg-blue-50 border-blue-200 shadow-sm'
                                            : 'bg-white border-gray-100 hover:border-gray-200 opacity-60'
                                        }
                                    `}
                                >
                                    <div className="flex items-start gap-3">
                                        <div className={`mt-1 rounded-md p-0.5 ${selectedChangeIds.has(change.id) ? 'text-brand-blue' : 'text-gray-300'}`}>
                                            {selectedChangeIds.has(change.id) ? <CheckSquare size={18} /> : <Square size={18} />}
                                        </div>
                                        <div className="flex-1">
                                            <div className="flex justify-between items-center mb-1">
                                                <span className={`text-xs font-bold uppercase px-2 py-0.5 rounded-full ${change.type === 'ADD' ? 'bg-green-100 text-green-700' :
                                                    change.type === 'REMOVE' ? 'bg-red-100 text-red-700' :
                                                        'bg-purple-100 text-purple-700'
                                                    }`}>
                                                    {change.type}
                                                </span>
                                                <span className="text-xs text-gray-400 font-mono">{change.original ? change.original.zone : change.optimized?.zone}</span>
                                            </div>
                                            <p className="font-bold text-gray-800 text-sm leading-tight mb-1">{change.description}</p>
                                            {change.impact && (
                                                <p className="text-xs text-gray-500 flex items-center gap-1">
                                                    <Sparkles size={10} /> {change.impact}
                                                </p>
                                            )}

                                            {change.type === 'MODIFY' && change.original && change.optimized && (
                                                <div className="mt-2 text-xs grid grid-cols-2 gap-2 bg-white/50 p-2 rounded-lg">
                                                    <div className="text-gray-400">
                                                        {formatSlotToTime(change.original.startSlot)} - {formatSlotToTime(change.original.endSlot)}
                                                    </div>
                                                    <div className="text-purple-600 font-bold flex items-center gap-1">
                                                        <ArrowRight size={10} />
                                                        {formatSlotToTime(change.optimized.startSlot)} - {formatSlotToTime(change.optimized.endSlot)}
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Right: Chart Preview (9 cols) */}
                    <div className="lg:col-span-9 p-6 flex flex-col min-h-0 overflow-y-auto relative">
                        <div className="bg-white rounded-3xl border border-gray-200 shadow-sm p-6 mb-4 flex-shrink-0">
                            <div className="flex justify-between items-center mb-6">
                                <div>
                                    <h3 className="text-xl font-extrabold text-gray-700 flex items-center gap-2">
                                        <BarChart size={24} className="text-brand-blue" />
                                        {viewMode === 'original' ? 'Original Schedule Performance' :
                                            viewMode === 'optimized' ? 'Fully Optimized Performance' :
                                                'Projected Performance (Custom Mix)'}
                                    </h3>
                                    <p className="text-gray-400 font-medium text-sm">
                                        {viewMode === 'original' ? 'Baseline metrics before any changes.' :
                                            viewMode === 'optimized' ? 'Maximum efficiency metrics achievable.' :
                                                `Metrics based on ${selectedChangeIds.size} selected changes.`}
                                    </p>
                                </div>
                                {viewMode === 'custom' && (
                                    <span className="text-xs font-bold bg-yellow-100 text-yellow-700 px-3 py-1 rounded-full animate-pulse">
                                        Previewing Selection
                                    </span>
                                )}
                            </div>

                            <div className="mb-8">
                                <SummaryCards metrics={metrics} />
                            </div>

                            {/* Gap Chart */}
                            <div className="h-[400px]">
                                <GapChart
                                    data={displayedSlots}
                                    zoneFilter={zoneFilter}
                                    onZoneFilterChange={setZoneFilter}
                                />
                            </div>
                        </div>
                    </div>
                </div>

                {/* Footer Actions */}
                <div className="p-6 border-t border-gray-200 bg-white flex justify-end gap-4 shadow-[0_-4px_20px_rgba(0,0,0,0.05)]">
                    <button
                        onClick={onCancel}
                        className="px-6 py-3 font-bold text-gray-500 hover:bg-gray-100 rounded-xl transition-colors"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={() => onApply(customMixShifts)} // Always apply custom mix (which matches others if all/none selected)
                        disabled={selectedChangeIds.size === 0 && viewMode === 'custom'}
                        className="px-8 py-3 bg-brand-blue hover:bg-blue-600 text-white font-bold rounded-xl shadow-lg shadow-blue-200 transition-all flex items-center gap-2 disabled:opacity-50 disabled:shadow-none"
                    >
                        <Check size={20} />
                        Apply Selected Changes
                    </button>
                </div>

            </div>
        </div>
    );
};
