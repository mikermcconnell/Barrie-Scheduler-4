import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Shift, Requirement, TimeSlot, Zone, ZoneFilterType } from '../../utils/demandTypes';
import { GapChart } from '../GapChart';
import { calculateSchedule, formatSlotToTime } from '../../utils/dataGenerator';
import {
    MIN_SHIFT_HOURS,
    MAX_SHIFT_HOURS,
    BREAK_THRESHOLD_HOURS,
    BREAK_DURATION_SLOTS,
    TIME_SLOTS_PER_DAY
} from '../../utils/demandConstants';
import { X, Save, AlertTriangle, CheckCircle2, Clock, Coffee, GripHorizontal, ChevronLeft, ChevronRight, GripVertical, Plus, Trash2 } from 'lucide-react';

interface Props {
    shift: Shift;
    allShifts: Shift[];
    requirements: Requirement[];
    onSave: (updatedShift: Shift) => void;
    onCancel: () => void;
}

export const ShiftEditorModal: React.FC<Props> = ({ shift, allShifts, requirements, onSave, onCancel }) => {
    const [currentShift, setCurrentShift] = useState<Shift>({ ...shift });
    const [validationMsg, setValidationMsg] = useState<string | null>(null);
    const trackRef = useRef<HTMLDivElement>(null);
    const [isDragging, setIsDragging] = useState<'shift' | 'break' | 'start' | 'end' | 'breakStart' | 'breakEnd' | null>(null);
    const [dragOffset, setDragOffset] = useState(0);

    // Initialize local chart filter based on the shift's zone
    // This satisfies the user request: "if it's a north zone shift, have the north gap analysis chart"
    const [localZoneFilter, setLocalZoneFilter] = useState<ZoneFilterType>(() => {
        // Map Shift 'Zone' enum to ZoneFilterType
        // The enum values match the string types (North, South, Floater), so this cast is safe mostly
        // but explicit mapping is better for safety.
        if (shift.zone === Zone.NORTH) return 'North';
        if (shift.zone === Zone.SOUTH) return 'South';
        if (shift.zone === Zone.FLOATER) return 'Floater';
        return 'All';
    });

    // Update filter if shift zone changes during edit (e.g. if we add zone changing later, good to have)
    useEffect(() => {
        if (currentShift.zone === Zone.NORTH) setLocalZoneFilter('North');
        else if (currentShift.zone === Zone.SOUTH) setLocalZoneFilter('South');
        else if (currentShift.zone === Zone.FLOATER) setLocalZoneFilter('Floater');
    }, [currentShift.zone]);


    // Calculate chart data with ghost line
    const chartData = useMemo(() => {
        const originalSlots = calculateSchedule(allShifts, requirements);
        const tempShifts = allShifts.map(s => s.id === shift.id ? currentShift : s);
        const newSlots = calculateSchedule(tempShifts, requirements);

        return newSlots.map((slot, i) => ({
            ...slot,
            originalEffectiveCoverage: originalSlots[i].totalEffectiveCoverage
        }));
    }, [currentShift, allShifts, requirements, shift.id]);

    // Validation Logic
    useEffect(() => {
        const durationSlots = currentShift.endSlot - currentShift.startSlot;
        const durationHours = durationSlots / 4;

        if (durationHours < MIN_SHIFT_HOURS) {
            setValidationMsg(`Shift too short (Min ${MIN_SHIFT_HOURS}h)`);
            return;
        }
        if (durationHours > MAX_SHIFT_HOURS) {
            setValidationMsg(`Shift too long (Max ${MAX_SHIFT_HOURS}h)`);
            return;
        }

        if (durationHours > BREAK_THRESHOLD_HOURS) {
            if (currentShift.breakDurationSlots < BREAK_DURATION_SLOTS) {
                setValidationMsg(`Shift > ${BREAK_THRESHOLD_HOURS}h requires a break`);
                return;
            }
            const shiftStart = currentShift.startSlot;
            const breakStart = currentShift.breakStartSlot;
            const fourthHour = shiftStart + 16;
            const sixthHour = shiftStart + 24;

            if (breakStart < fourthHour || breakStart > sixthHour) {
                const fourthHourTime = formatSlotToTime(fourthHour);
                const sixthHourTime = formatSlotToTime(sixthHour);
                setValidationMsg(`Break must be between 4th and 6th hour (${fourthHourTime} - ${sixthHourTime})`);
                return;
            }
        }

        setValidationMsg(null);
    }, [currentShift]);

    // Mouse/Touch Handling for Dragging
    const handleMouseDown = (e: React.MouseEvent, type: 'shift' | 'break' | 'start' | 'end' | 'breakStart' | 'breakEnd') => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(type);

        if (trackRef.current) {
            const rect = trackRef.current.getBoundingClientRect();
            const slotWidth = rect.width / TIME_SLOTS_PER_DAY;
            const relativeX = e.clientX - rect.left;
            const clickedSlot = Math.floor(relativeX / slotWidth);

            if (type === 'shift') {
                setDragOffset(clickedSlot - currentShift.startSlot);
            } else if (type === 'break') {
                setDragOffset(clickedSlot - currentShift.breakStartSlot);
            }
        }
    };

    const handleMouseMove = (e: React.MouseEvent) => {
        if (!isDragging || !trackRef.current) return;

        const rect = trackRef.current.getBoundingClientRect();
        const slotWidth = rect.width / TIME_SLOTS_PER_DAY;
        const relativeX = e.clientX - rect.left;
        const slotIndex = Math.floor(relativeX / slotWidth);
        const clampedSlot = Math.max(0, Math.min(TIME_SLOTS_PER_DAY, slotIndex));

        const updated = { ...currentShift };

        if (isDragging === 'shift') {
            const duration = updated.endSlot - updated.startSlot;
            const newStart = clampedSlot - dragOffset;
            const newEnd = newStart + duration;

            if (newStart >= 0 && newEnd <= TIME_SLOTS_PER_DAY) {
                updated.startSlot = newStart;
                updated.endSlot = newEnd;
                if (updated.breakDurationSlots > 0) {
                    updated.breakStartSlot = newStart + (currentShift.breakStartSlot - currentShift.startSlot);
                }
                setCurrentShift(updated);
            }
        } else if (isDragging === 'break') {
            const newBreakStart = clampedSlot - dragOffset;
            if (newBreakStart >= updated.startSlot && newBreakStart <= updated.endSlot - updated.breakDurationSlots) {
                updated.breakStartSlot = newBreakStart;
                setCurrentShift(updated);
            }
        } else if (isDragging === 'start') {
            if (clampedSlot < updated.endSlot - 4) {
                updated.startSlot = clampedSlot;
                if (updated.breakDurationSlots > 0 && updated.breakStartSlot < updated.startSlot) {
                    updated.breakStartSlot = updated.startSlot + 4;
                }
                setCurrentShift(updated);
            }
        } else if (isDragging === 'end') {
            if (clampedSlot > updated.startSlot + 4) {
                updated.endSlot = clampedSlot;
                if (updated.breakDurationSlots > 0 && updated.breakStartSlot > updated.endSlot - updated.breakDurationSlots) {
                    updated.breakStartSlot = updated.endSlot - updated.breakDurationSlots;
                }
                setCurrentShift(updated);
            }
        } else if (isDragging === 'breakStart') {
            // Resize break start
            if (clampedSlot < updated.breakStartSlot + updated.breakDurationSlots && clampedSlot >= updated.startSlot) {
                const oldEnd = updated.breakStartSlot + updated.breakDurationSlots;
                updated.breakStartSlot = clampedSlot;
                updated.breakDurationSlots = oldEnd - clampedSlot;
                setCurrentShift(updated);
            }
        } else if (isDragging === 'breakEnd') {
            // Resize break end
            const newEnd = clampedSlot;
            if (newEnd > updated.breakStartSlot && newEnd <= updated.endSlot) {
                updated.breakDurationSlots = newEnd - updated.breakStartSlot;
                setCurrentShift(updated);
            }
        }
    };

    const handleMouseUp = () => {
        setIsDragging(null);
    };

    const adjustTime = (field: 'startSlot' | 'endSlot' | 'breakStartSlot' | 'breakDurationSlots', delta: number) => {
        const updated = { ...currentShift, [field]: currentShift[field] + delta };

        // Basic integrity checks
        if (updated.startSlot >= updated.endSlot) return;
        if (field === 'breakStartSlot' || field === 'breakDurationSlots') {
            if (updated.breakDurationSlots < 0) return;
            if (updated.breakStartSlot < updated.startSlot) return;
            if (updated.breakStartSlot + updated.breakDurationSlots > updated.endSlot) return;
        }

        setCurrentShift(updated);
    };

    const toggleBreak = () => {
        const updated = { ...currentShift };
        if (updated.breakDurationSlots > 0) {
            // Remove break
            updated.breakDurationSlots = 0;
        } else {
            // Add break (default 45 mins, 5th hour)
            updated.breakDurationSlots = BREAK_DURATION_SLOTS;
            updated.breakStartSlot = updated.startSlot + 20;
        }
        setCurrentShift(updated);
    };

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200"
            onMouseUp={handleMouseUp}
            onMouseMove={handleMouseMove}
        >
            <div className="bg-white w-full max-w-6xl h-[90vh] rounded-3xl shadow-2xl flex flex-col overflow-hidden border border-gray-100">

                {/* Header */}
                <div className="flex justify-between items-center px-8 py-6 border-b border-gray-100 bg-white">
                    <div>
                        <div className="flex items-center gap-3 mb-1">
                            <input
                                type="text"
                                value={currentShift.driverName}
                                onChange={(e) => setCurrentShift({ ...currentShift, driverName: e.target.value })}
                                className="text-3xl font-extrabold text-gray-800 bg-transparent border-b-2 border-transparent hover:border-gray-200 focus:border-brand-blue focus:outline-none transition-all w-full max-w-md"
                            />
                            <span className={`px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider ${currentShift.zone === 'North' ? 'bg-blue-100 text-blue-700' :
                                currentShift.zone === 'South' ? 'bg-green-100 text-green-700' :
                                    'bg-purple-100 text-purple-700'
                                }`}>
                                {currentShift.zone} Zone
                            </span>
                            <span className="px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider bg-gray-100 text-gray-600">
                                {((currentShift.endSlot - currentShift.startSlot) / 4).toFixed(2)} Hrs
                            </span>
                        </div>
                        <div className="flex items-center gap-2 h-6">
                            {validationMsg ? (
                                <div className="flex items-center gap-2 text-red-500 bg-red-50 px-3 py-1 rounded-lg animate-in fade-in slide-in-from-left-2">
                                    <AlertTriangle size={14} strokeWidth={3} />
                                    <span className="text-sm font-bold">{validationMsg}</span>
                                </div>
                            ) : (
                                <div className="flex items-center gap-2 text-emerald-600 bg-emerald-50 px-3 py-1 rounded-lg animate-in fade-in slide-in-from-left-2">
                                    <CheckCircle2 size={14} strokeWidth={3} />
                                    <span className="text-sm font-bold">Schedule Compliant</span>
                                </div>
                            )}
                        </div>
                    </div>
                    <button
                        onClick={onCancel}
                        className="p-2 hover:bg-gray-100 rounded-full transition-all text-gray-400 hover:text-gray-600"
                    >
                        <X size={32} />
                    </button>
                </div>

                {/* Main Content */}
                <div className="flex-1 flex flex-col bg-gray-50/50 overflow-hidden">

                    {/* Chart Section */}
                    {/* Updated to use local zone filter from shift */}
                    <div className="flex-1 p-6 min-h-0">
                        <div className="h-full">
                            <GapChart
                                data={chartData}
                                zoneFilter={localZoneFilter}
                                onZoneFilterChange={setLocalZoneFilter}
                                fillHeight={true}
                            />
                        </div>
                    </div>

                    {/* Controls Section (Fixed at Bottom) */}
                    <div className="bg-white border-t border-gray-200 p-8 shadow-[0_-4px_20px_rgba(0,0,0,0.02)] z-10">

                        {/* Timeline Visualizer - Aligned with Chart */}
                        {/* Chart has: margin={{ top: 20, right: 30, left: 0, bottom: 20 }} and padding inside container */}
                        {/* Y-axis takes ~30-40px, plus container padding. Right side has 30px margin */}
                        <div className="mb-10" style={{ marginLeft: 38, marginRight: 30 }}>
                            <div
                                ref={trackRef}
                                className="relative h-14 bg-gray-100 rounded-xl border border-gray-200 select-none cursor-pointer"
                            >
                                {/* Grid Lines - Fixed Alignment */}
                                <div className="absolute inset-0 pointer-events-none">
                                    {Array.from({ length: 25 }).map((_, i) => (
                                        <div
                                            key={i}
                                            className="absolute top-0 bottom-0 border-l border-gray-200 flex flex-col justify-end pb-1"
                                            style={{ left: `${(i / 24) * 100}%` }}
                                        >
                                            <span className="text-[10px] font-bold text-gray-300 pl-1">{i}</span>
                                        </div>
                                    ))}
                                </div>

                                {/* Shift Bar */}
                                <div
                                    className="absolute top-2 bottom-2 bg-brand-blue rounded-lg shadow-sm cursor-grab active:cursor-grabbing group hover:brightness-110 transition-all"
                                    style={{
                                        left: `${(currentShift.startSlot / TIME_SLOTS_PER_DAY) * 100}%`,
                                        width: `${((currentShift.endSlot - currentShift.startSlot) / TIME_SLOTS_PER_DAY) * 100}%`
                                    }}
                                    onMouseDown={(e) => handleMouseDown(e, 'shift')}
                                >
                                    {/* Grip Handle (Center) */}
                                    <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                                        <GripHorizontal className="text-white/50" size={20} />
                                    </div>

                                    {/* Time Labels on Bar */}
                                    <div className="absolute left-4 top-1/2 -translate-y-1/2 text-[10px] font-bold text-white/90 pointer-events-none">
                                        {formatSlotToTime(currentShift.startSlot)}
                                    </div>
                                    <div className="absolute right-4 top-1/2 -translate-y-1/2 text-[10px] font-bold text-white/90 pointer-events-none">
                                        {formatSlotToTime(currentShift.endSlot)}
                                    </div>

                                    {/* Resize Handle (Start) */}
                                    <div
                                        className="absolute left-0 top-0 bottom-0 w-4 cursor-ew-resize flex items-center justify-center hover:bg-white/20 rounded-l-lg transition-colors z-20"
                                        onMouseDown={(e) => handleMouseDown(e, 'start')}
                                        title="Drag to resize start"
                                    >
                                        <GripVertical size={12} className="text-white/50" />
                                    </div>

                                    {/* Resize Handle (End) */}
                                    <div
                                        className="absolute right-0 top-0 bottom-0 w-4 cursor-ew-resize flex items-center justify-center hover:bg-white/20 rounded-r-lg transition-colors z-20"
                                        onMouseDown={(e) => handleMouseDown(e, 'end')}
                                        title="Drag to resize end"
                                    >
                                        <GripVertical size={12} className="text-white/50" />
                                    </div>
                                </div>

                                {/* Break Bar */}
                                {currentShift.breakDurationSlots > 0 && (
                                    <div
                                        className="absolute top-2 bottom-2 bg-orange-400 rounded-md shadow-sm cursor-grab active:cursor-grabbing hover:bg-orange-300 transition-colors border-2 border-white/20 z-30 group/break"
                                        style={{
                                            left: `${(currentShift.breakStartSlot / TIME_SLOTS_PER_DAY) * 100}%`,
                                            width: `${(currentShift.breakDurationSlots / TIME_SLOTS_PER_DAY) * 100}%`
                                        }}
                                        onMouseDown={(e) => handleMouseDown(e, 'break')}
                                        title="Drag to move break"
                                    >
                                        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                                            <Coffee size={12} className="text-white/80" />
                                        </div>

                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Control Grid */}
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-center">

                            {/* Time Controls */}
                            <div className="flex items-center gap-8 justify-center lg:justify-start">

                                {/* Shift Time */}
                                <div className="flex items-center gap-4 bg-gray-50 px-6 py-3 rounded-2xl border border-gray-100">
                                    <div className="flex items-center gap-2 text-gray-400">
                                        <Clock size={18} />
                                        <span className="text-xs font-bold uppercase tracking-wider">Shift</span>
                                    </div>
                                    <div className="h-8 w-px bg-gray-200"></div>
                                    <div className="flex items-center gap-3">
                                        <button onClick={() => adjustTime('startSlot', -1)} className="p-1 hover:bg-gray-200 rounded-md text-gray-400 hover:text-gray-600 transition-colors"><ChevronLeft size={18} strokeWidth={3} /></button>
                                        <span className="font-mono text-xl font-bold text-gray-700">{formatSlotToTime(currentShift.startSlot)}</span>
                                        <button onClick={() => adjustTime('startSlot', 1)} className="p-1 hover:bg-gray-200 rounded-md text-gray-400 hover:text-gray-600 transition-colors"><ChevronRight size={18} strokeWidth={3} /></button>
                                    </div>
                                    <span className="text-gray-300 font-bold">-</span>
                                    <div className="flex items-center gap-3">
                                        <button onClick={() => adjustTime('endSlot', -1)} className="p-1 hover:bg-gray-200 rounded-md text-gray-400 hover:text-gray-600 transition-colors"><ChevronLeft size={18} strokeWidth={3} /></button>
                                        <span className="font-mono text-xl font-bold text-gray-700">{formatSlotToTime(currentShift.endSlot)}</span>
                                        <button onClick={() => adjustTime('endSlot', 1)} className="p-1 hover:bg-gray-200 rounded-md text-gray-400 hover:text-gray-600 transition-colors"><ChevronRight size={18} strokeWidth={3} /></button>
                                    </div>
                                </div>

                                {/* Break Time */}
                                {currentShift.breakDurationSlots > 0 ? (
                                    <div className="flex items-center gap-4 bg-orange-50/50 px-6 py-3 rounded-2xl border border-orange-100/50 relative group">
                                        <div className="flex items-center gap-2 text-orange-400">
                                            <Coffee size={18} />
                                            <span className="text-xs font-bold uppercase tracking-wider">Break</span>
                                        </div>
                                        <div className="h-8 w-px bg-orange-200/50"></div>
                                        <div className="flex items-center gap-3">
                                            <button onClick={() => adjustTime('breakStartSlot', -1)} className="p-1 hover:bg-orange-100 rounded-md text-orange-300 hover:text-orange-500 transition-colors"><ChevronLeft size={18} strokeWidth={3} /></button>
                                            <span className="font-mono text-xl font-bold text-gray-700">{formatSlotToTime(currentShift.breakStartSlot)}</span>
                                            <button onClick={() => adjustTime('breakStartSlot', 1)} className="p-1 hover:bg-orange-100 rounded-md text-orange-300 hover:text-orange-500 transition-colors"><ChevronRight size={18} strokeWidth={3} /></button>
                                        </div>

                                        <button
                                            onClick={toggleBreak}
                                            className="absolute -top-2 -right-2 bg-white text-red-400 border border-red-100 p-1 rounded-full shadow-sm hover:bg-red-50 hover:text-red-600 hover:border-red-200 transition-all"
                                            title="Remove Break"
                                        >
                                            <X size={12} strokeWidth={3} />
                                        </button>
                                    </div>
                                ) : (
                                    <button
                                        onClick={toggleBreak}
                                        className="flex items-center gap-2 px-6 py-3 rounded-2xl border-2 border-dashed border-gray-300 text-gray-400 font-bold hover:border-orange-300 hover:text-orange-500 hover:bg-orange-50 transition-all"
                                    >
                                        <Plus size={18} strokeWidth={3} /> Add Break
                                    </button>
                                )}
                            </div>

                            {/* Actions */}
                            <div className="flex justify-end gap-4">
                                <button
                                    onClick={onCancel}
                                    className="px-8 py-4 rounded-xl font-bold text-gray-500 hover:bg-gray-100 transition-colors"
                                >
                                    Discard
                                </button>
                                <button
                                    onClick={() => onSave(currentShift)}
                                    className="px-10 py-4 rounded-xl font-bold text-white bg-brand-blue hover:bg-blue-600 shadow-lg shadow-blue-200/50 flex items-center gap-3 transition-all transform hover:-translate-y-0.5 active:translate-y-0"
                                >
                                    <Save size={20} /> Save Changes
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};
