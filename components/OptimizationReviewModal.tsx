import React, { useState, useMemo } from 'react';
import { Shift, Requirement, TimeSlot, Zone } from '../types';
import { GapChart } from './GapChart';
import { calculateSchedule, formatSlotToTime } from '../utils/dataGenerator';
import { Check, X, ArrowRight, AlertTriangle, Sparkles, CheckSquare, Square } from 'lucide-react';
import { ZoneFilterType } from './OnDemandWorkspace';

interface Props {
    currentShifts: Shift[];
    optimizedShifts: Shift[];
    requirements: Requirement[];
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

export const OptimizationReviewModal: React.FC<Props> = ({
    currentShifts,
    optimizedShifts,
    requirements,
    onApply,
    onCancel
}) => {
    const [selectedChangeIds, setSelectedChangeIds] = useState<Set<string>>(() => new Set());
    const [zoneFilter, setZoneFilter] = useState<ZoneFilterType>('All');

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
                    changesList.push({
                        id: `mod-${curr.id}`,
                        shiftId: curr.id,
                        type: 'MODIFY',
                        description: `Adjust ${curr.driverName}`,
                        impact: 'Efficiency Tweak',
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

    // 2. Generate Preview Data based on selection
    const previewShifts = useMemo(() => {
        // Start with current shifts
        let result = [...currentShifts];

        // Apply strict "Change Logic"
        // REMOVALS: Filter out if selected
        // ADDITIONS: Add if selected
        // MODIFICATIONS: Replace if selected

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

    const previewSlots = useMemo(() => calculateSchedule(previewShifts, requirements), [previewShifts, requirements]);

    const toggleChange = (id: string) => {
        const next = new Set(selectedChangeIds);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        setSelectedChangeIds(next);
    };

    const toggleAll = () => {
        if (selectedChangeIds.size === changes.length) {
            setSelectedChangeIds(new Set());
        } else {
            setSelectedChangeIds(new Set(changes.map(c => c.id)));
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
            <div className="bg-white w-full max-w-6xl h-[90vh] rounded-3xl shadow-2xl flex flex-col overflow-hidden border border-gray-100">

                {/* Header */}
                <div className="flex justify-between items-center px-8 py-6 border-b border-gray-100 bg-white">
                    <div>
                        <h2 className="text-2xl font-extrabold text-gray-800 flex items-center gap-2">
                            <Sparkles className="text-purple-600" /> Refined Schedule Review
                        </h2>
                        <p className="text-gray-500 font-bold text-sm">Gemini AI found {changes.length} optimizations.</p>
                    </div>
                    <button onClick={onCancel} className="p-2 hover:bg-gray-100 rounded-full text-gray-400">
                        <X size={24} />
                    </button>
                </div>

                {/* Content Grid */}
                <div className="flex-1 grid grid-cols-1 lg:grid-cols-3 min-h-0 bg-gray-50">

                    {/* Left: Change List */}
                    <div className="lg:col-span-1 bg-white border-r border-gray-200 flex flex-col min-h-0">
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

                        <div className="flex-1 overflow-y-auto p-4 space-y-3">
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
                    group p-3 rounded-xl border-2 transition-all cursor-pointer select-none
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

                    {/* Right: Chart Preview */}
                    <div className="lg:col-span-2 p-6 flex flex-col min-h-0 overflow-y-auto">
                        <div className="bg-white rounded-3xl border border-gray-200 shadow-sm p-4 mb-4 flex-shrink-0">
                            <div className="flex justify-between items-center mb-4">
                                <h3 className="font-extrabold text-gray-700">Live Preview</h3>
                                <span className="text-xs font-bold bg-yellow-100 text-yellow-700 px-3 py-1 rounded-full animate-pulse">
                                    Previewing {selectedChangeIds.size} Changes
                                </span>
                            </div>
                            {/* Gap Chart */}
                            <GapChart
                                data={previewSlots}
                                zoneFilter={zoneFilter}
                                onZoneFilterChange={setZoneFilter}
                            />
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
                        onClick={() => onApply(previewShifts)}
                        disabled={selectedChangeIds.size === 0}
                        className="px-8 py-3 bg-brand-blue hover:bg-blue-600 text-white font-bold rounded-xl shadow-lg shadow-blue-200 transition-all flex items-center gap-2 disabled:opacity-50 disabled:shadow-none"
                    >
                        <Check size={20} />
                        Apply {selectedChangeIds.size} Optimizations
                    </button>
                </div>

            </div>
        </div>
    );
};
