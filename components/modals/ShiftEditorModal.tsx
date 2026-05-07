import React, { useState, useMemo, useEffect, useRef } from 'react';
import {
    DEFAULT_CHANGEOFF_LOCATION,
    ON_DEMAND_CHANGEOFF_LOCATION_LABELS,
    Shift,
    Requirement,
    TimeSlot,
    Zone,
    ZoneFilterType,
    type OnDemandChangeoffLocation,
    type OnDemandChangeoffSettings,
    isSchedulableShift,
} from '../../utils/demandTypes';
import { GapChart } from '../GapChart';
import { calculateSchedule, formatSlotToTime } from '../../utils/dataGenerator';
import { validateShiftHandoffs } from '../../utils/onDemandHandoffs';
import { getShiftDayType, syncShiftHandoffInDay } from '../../utils/onDemandShiftUtils';
import { validateOnDemandShiftRules } from '../../utils/onDemandShiftRules';
import {
    MIN_SHIFT_HOURS,
    MAX_SHIFT_HOURS,
    MAX_HOURS_WITHOUT_BREAK,
    TIME_SLOTS_PER_DAY,
    hoursToSlots,
    slotDurationToHours,
    slotToMinutes,
    minutesToSlot,
} from '../../utils/demandConstants';
import { X, Save, AlertTriangle, CheckCircle2, Clock, Coffee, GripHorizontal, ChevronLeft, ChevronRight, GripVertical, Plus } from 'lucide-react';

interface Props {
    shift: Shift;
    allShifts: Shift[];
    requirements: Requirement[];
    changeoffSettings?: Partial<OnDemandChangeoffSettings>;
    requiredBreakDurationSlots: number;
    onSave: (updatedShift: Shift) => void;
    onCancel: () => void;
}

export const ShiftEditorModal: React.FC<Props> = ({
    shift,
    allShifts,
    requirements,
    changeoffSettings,
    requiredBreakDurationSlots,
    onSave,
    onCancel,
}) => {
    const [currentShift, setCurrentShift] = useState<Shift>({ ...shift });
    const [validationMsg, setValidationMsg] = useState<string | null>(null);
    const trackRef = useRef<HTMLDivElement>(null);
    const [isDragging, setIsDragging] = useState<'shift' | 'break' | 'start' | 'end' | 'breakStart' | 'breakEnd' | null>(null);
    const [dragOffset, setDragOffset] = useState(0);
    const [editingShiftBoundary, setEditingShiftBoundary] = useState<'startSlot' | 'endSlot' | null>(null);
    const [focusedShiftTimeField, setFocusedShiftTimeField] = useState<'startSlot' | 'endSlot' | null>(null);
    const [shiftTimeDrafts, setShiftTimeDrafts] = useState<Record<'startSlot' | 'endSlot', string>>({
        startSlot: '',
        endSlot: '',
    });
    const isPlaceholder = currentShift.isPlaceholder === true;
    const changeoffLocations = Object.keys(ON_DEMAND_CHANGEOFF_LOCATION_LABELS) as OnDemandChangeoffLocation[];

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

    const canUseShiftHandoffs = !isPlaceholder;
    const handoffOptions = useMemo(() => (
        allShifts
            .filter(candidate => candidate.id !== currentShift.id)
            .filter(isSchedulableShift)
            .sort((a, b) => {
                if (a.startSlot !== b.startSlot) {
                    return a.startSlot - b.startSlot;
                }

                return a.driverName.localeCompare(b.driverName, undefined, { numeric: true, sensitivity: 'base' });
            })
    ), [allShifts, currentShift.id]);

    const formatSlotForInput = (slot: number): string => {
        if (!Number.isFinite(slot)) return '';
        const minutes = slotToMinutes(slot);
        const hours = Math.floor(minutes / 60) % 24;
        const mins = Math.round(minutes % 60);
        return `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`;
    };

    const parseTimeInputToSlot = (value: string): number | null => {
        const normalized = value.trim().toLowerCase().replace(/\s+/g, '');
        if (!normalized) return null;

        const meridiemMatch = normalized.match(/(am|pm)$/);
        const meridiem = meridiemMatch?.[1] as 'am' | 'pm' | undefined;
        const timeText = meridiem ? normalized.slice(0, -meridiem.length) : normalized;
        let hours: number;
        let minutes = 0;

        if (timeText.includes(':')) {
            const match = timeText.match(/^(\d{1,2}):(\d{1,2})$/);
            if (!match) return null;
            hours = Number(match[1]);
            minutes = Number(match[2]);
        } else if (/^\d{1,2}$/.test(timeText)) {
            hours = Number(timeText);
        } else if (/^\d{3,4}$/.test(timeText)) {
            hours = Number(timeText.slice(0, -2));
            minutes = Number(timeText.slice(-2));
        } else {
            return null;
        }

        if (!Number.isFinite(hours) || !Number.isFinite(minutes) || minutes > 59) return null;

        if (meridiem) {
            if (hours < 1 || hours > 12) return null;
            if (meridiem === 'am') {
                hours = hours === 12 ? 0 : hours;
            } else {
                hours = hours === 12 ? 12 : hours + 12;
            }
        }

        if (hours < 0 || hours > 23) return null;
        return minutesToSlot((hours * 60) + minutes);
    };

    const setShiftBoundaryFromInput = (field: 'startSlot' | 'endSlot', value: string): boolean => {
        const slot = parseTimeInputToSlot(value);
        if (slot === null) return false;

        setCurrentShift(prev => ({
            ...prev,
            [field]: slot,
        }));
        setShiftTimeDrafts(prev => ({
            ...prev,
            [field]: formatSlotForInput(slot),
        }));
        return true;
    };

    const resetShiftTimeDraft = (field: 'startSlot' | 'endSlot') => {
        setShiftTimeDrafts(prev => ({
            ...prev,
            [field]: getShiftTimeInputValue(field),
        }));
    };

    const commitShiftTimeDraft = (field: 'startSlot' | 'endSlot') => {
        const committed = setShiftBoundaryFromInput(field, shiftTimeDrafts[field]);
        if (!committed) {
            resetShiftTimeDraft(field);
        }
        setFocusedShiftTimeField(null);
        setEditingShiftBoundary(null);
    };

    const handleShiftTimeKeyDown = (field: 'startSlot' | 'endSlot', event: React.KeyboardEvent<HTMLInputElement>) => {
        if (event.key === 'Enter') {
            commitShiftTimeDraft(field);
            event.currentTarget.blur();
        } else if (event.key === 'Escape') {
            resetShiftTimeDraft(field);
            setFocusedShiftTimeField(null);
            setEditingShiftBoundary(null);
            event.currentTarget.blur();
        }
    };

    const getShiftTimeInputValue = (field: 'startSlot' | 'endSlot'): string => {
        if (!currentShift.isPlaceholder) {
            return formatSlotForInput(currentShift[field]);
        }

        if (currentShift.startSlot === currentShift.endSlot) {
            return '';
        }

        if (field === 'endSlot' && currentShift.endSlot <= currentShift.startSlot) {
            return '';
        }

        return formatSlotForInput(currentShift[field]);
    };

    useEffect(() => {
        setShiftTimeDrafts(prev => ({
            startSlot: focusedShiftTimeField === 'startSlot' ? prev.startSlot : getShiftTimeInputValue('startSlot'),
            endSlot: focusedShiftTimeField === 'endSlot' ? prev.endSlot : getShiftTimeInputValue('endSlot'),
        }));
    }, [currentShift.startSlot, currentShift.endSlot, currentShift.isPlaceholder, focusedShiftTimeField]);

    const renderShiftBoundaryControl = (field: 'startSlot' | 'endSlot') => {
        const alignmentClass = field === 'startSlot' ? 'left-4' : 'right-4';
        const label = field === 'startSlot' ? 'Shift start time' : 'Shift end time';

        if (editingShiftBoundary === field) {
            return (
                <input
                    type="text"
                    inputMode="numeric"
                    autoFocus
                    value={shiftTimeDrafts[field]}
                    onChange={(e) => setShiftTimeDrafts(prev => ({ ...prev, [field]: e.target.value }))}
                    onFocus={() => setFocusedShiftTimeField(field)}
                    onBlur={() => commitShiftTimeDraft(field)}
                    onKeyDown={(e) => handleShiftTimeKeyDown(field, e)}
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={(e) => e.stopPropagation()}
                    placeholder="08:30"
                    className={`absolute ${alignmentClass} top-1/2 z-40 w-[72px] -translate-y-1/2 rounded-md border border-white/70 bg-white px-1 py-0.5 font-mono text-[11px] font-bold text-gray-900 shadow-sm outline-none focus:border-white focus:ring-2 focus:ring-white/60`}
                    aria-label={label}
                />
            );
        }

        return (
            <button
                type="button"
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                    e.stopPropagation();
                    setShiftTimeDrafts(prev => ({ ...prev, [field]: formatSlotForInput(currentShift[field]) }));
                    setFocusedShiftTimeField(field);
                    setEditingShiftBoundary(field);
                }}
                className={`absolute ${alignmentClass} top-1/2 z-40 -translate-y-1/2 rounded px-1.5 py-0.5 font-mono text-[10px] font-bold text-white/95 hover:bg-white/20 focus:outline-none focus:ring-2 focus:ring-white/70`}
                title={`Click to type ${field === 'startSlot' ? 'start' : 'end'} time`}
                aria-label={`Edit ${label.toLowerCase()}`}
            >
                {formatSlotToTime(currentShift[field])}
            </button>
        );
    };

    const saveCurrentShift = () => {
        onSave({
            ...currentShift,
            isPlaceholder: false,
            handoffFromLocation: currentShift.handoffFromShiftId
                ? (currentShift.handoffFromLocation ?? DEFAULT_CHANGEOFF_LOCATION)
                : undefined,
            handoffToLocation: currentShift.handoffToShiftId
                ? (currentShift.handoffToLocation ?? DEFAULT_CHANGEOFF_LOCATION)
                : undefined,
        });
    };


    // Calculate chart data with ghost line
    const chartData = useMemo(() => {
        const originalSlots = calculateSchedule(allShifts, requirements, changeoffSettings);
        const previewShift = currentShift.isPlaceholder && currentShift.endSlot > currentShift.startSlot
            ? { ...currentShift, isPlaceholder: false }
            : currentShift;
        const tempShifts = syncShiftHandoffInDay(
            allShifts,
            previewShift,
            getShiftDayType(previewShift),
        );
        const newSlots = calculateSchedule(tempShifts, requirements, changeoffSettings);

        return newSlots.map((slot, i) => ({
            ...slot,
            originalActiveCoverage: originalSlots[i].totalActiveCoverage,
            originalEffectiveCoverage: originalSlots[i].totalEffectiveCoverage
        }));
    }, [changeoffSettings, currentShift, allShifts, requirements, shift.id]);

    // Validation Logic
    useEffect(() => {
        const durationSlots = currentShift.endSlot - currentShift.startSlot;
        const durationHours = slotDurationToHours(durationSlots);

        if (isPlaceholder && durationSlots <= 0) {
            setValidationMsg('New driver is a placeholder. Set a valid shift time to activate it.');
            return;
        }

        if (!canUseShiftHandoffs && (currentShift.handoffFromShiftId || currentShift.handoffToShiftId)) {
            setValidationMsg('Placeholder shifts cannot use shift handoffs.');
            return;
        }

        if (durationHours < MIN_SHIFT_HOURS) {
            setValidationMsg(`Shift too short (Min ${MIN_SHIFT_HOURS}h)`);
            return;
        }
        if (durationHours > MAX_SHIFT_HOURS) {
            setValidationMsg(`Shift too long (Max ${MAX_SHIFT_HOURS}h)`);
            return;
        }

        const validationShift = isPlaceholder
            ? { ...currentShift, isPlaceholder: false }
            : currentShift;
        const shiftRuleIssue = validateOnDemandShiftRules([validationShift], requiredBreakDurationSlots)[0];
        if (shiftRuleIssue) {
            setValidationMsg(shiftRuleIssue.message);
            return;
        }

        const shiftsWithDraftEdit = syncShiftHandoffInDay(
            allShifts,
            currentShift,
            getShiftDayType(currentShift),
        );
        const handoffIssue = validateShiftHandoffs(shiftsWithDraftEdit)
            .find(issue => issue.shiftId === currentShift.id);
        if (handoffIssue) {
            setValidationMsg(handoffIssue.message);
            return;
        }

        setValidationMsg(null);
    }, [allShifts, canUseShiftHandoffs, currentShift, isPlaceholder, requiredBreakDurationSlots, shift.id]);

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
            if (clampedSlot < updated.endSlot - hoursToSlots(1)) {
                updated.startSlot = clampedSlot;
                if (updated.breakDurationSlots > 0 && updated.breakStartSlot < updated.startSlot) {
                    updated.breakStartSlot = updated.startSlot + hoursToSlots(1);
                }
                setCurrentShift(updated);
            }
        } else if (isDragging === 'end') {
            if (clampedSlot > updated.startSlot + hoursToSlots(1)) {
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
        const nextValue = currentShift[field] + delta;
        const updated = {
            ...currentShift,
            [field]: field === 'breakDurationSlots'
                ? nextValue
                : Math.max(0, Math.min(TIME_SLOTS_PER_DAY, nextValue)),
        };

        // Basic integrity checks
        if (updated.startSlot >= updated.endSlot) return;
        if (field === 'breakStartSlot' || field === 'breakDurationSlots') {
            if (updated.breakDurationSlots < 1) return;
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
            // Add break using the configured duration at the 5th hour.
            updated.breakDurationSlots = requiredBreakDurationSlots;
            const latestCompliantStart = updated.startSlot + hoursToSlots(MAX_HOURS_WITHOUT_BREAK);
            const earliestCompliantStart = updated.endSlot - requiredBreakDurationSlots - hoursToSlots(MAX_HOURS_WITHOUT_BREAK);
            updated.breakStartSlot = Math.max(updated.startSlot, Math.min(
                latestCompliantStart,
                Math.max(earliestCompliantStart, updated.startSlot),
            ));
        }
        setCurrentShift(updated);
    };

    const shiftDurationHours = slotDurationToHours(currentShift.endSlot - currentShift.startSlot);
    const hasBreak = currentShift.breakDurationSlots > 0;
    const breakEndSlot = currentShift.breakStartSlot + currentShift.breakDurationSlots;
    const zoneBadgeClass = currentShift.zone === Zone.NORTH
        ? 'bg-blue-50 text-blue-700 border-blue-200'
        : currentShift.zone === Zone.SOUTH
            ? 'bg-indigo-50 text-indigo-700 border-indigo-200'
            : 'bg-purple-50 text-purple-700 border-purple-200';
    const timeStepButtonClass = 'inline-flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-500 transition-colors hover:border-gray-300 hover:bg-gray-50 hover:text-gray-700';
    const orangeStepButtonClass = 'inline-flex h-8 w-8 items-center justify-center rounded-lg border border-orange-200 bg-white text-orange-500 transition-colors hover:border-orange-300 hover:bg-orange-50 hover:text-orange-600';
    const selectClass = 'mt-2 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-800 shadow-sm focus:border-brand-blue focus:outline-none focus:ring-2 focus:ring-blue-100 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-400';
    const fieldLabelClass = 'text-[11px] font-bold uppercase tracking-wider text-gray-500';

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-gray-950/60 p-4 backdrop-blur-sm animate-in fade-in duration-200"
            onMouseUp={handleMouseUp}
            onMouseMove={handleMouseMove}
        >
            <div className="flex h-[94vh] w-full max-w-7xl flex-col overflow-hidden rounded-2xl border border-gray-200 bg-gray-50 shadow-2xl">
                <div className="border-b border-gray-200 bg-white px-6 py-4">
                    <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0 flex-1">
                            <div className="mb-2 text-xs font-bold uppercase tracking-wider text-gray-400">Shift editor</div>
                            <input
                                type="text"
                                value={currentShift.driverName}
                                onChange={(e) => setCurrentShift({ ...currentShift, driverName: e.target.value })}
                                className="w-full max-w-xl rounded-xl border border-transparent bg-transparent px-0 py-1 text-2xl font-extrabold text-gray-900 transition-all hover:border-gray-200 hover:bg-gray-50 hover:px-3 focus:border-brand-blue focus:bg-white focus:px-3 focus:outline-none focus:ring-2 focus:ring-blue-100"
                                aria-label="Driver name"
                            />
                            <div className="mt-3 flex flex-wrap items-center gap-2">
                                <span className={`rounded-full border px-3 py-1 text-xs font-bold uppercase tracking-wider ${zoneBadgeClass}`}>
                                    {currentShift.zone} Zone
                                </span>
                                <span className="rounded-full border border-gray-200 bg-gray-50 px-3 py-1 text-xs font-bold uppercase tracking-wider text-gray-600">
                                    {shiftDurationHours.toFixed(2)} hrs
                                </span>
                                {hasBreak && (
                                    <span className="rounded-full border border-orange-200 bg-orange-50 px-3 py-1 text-xs font-bold uppercase tracking-wider text-orange-700">
                                        Lunch {formatSlotToTime(currentShift.breakStartSlot)}-{formatSlotToTime(breakEndSlot)} for {slotToMinutes(currentShift.breakDurationSlots)}m
                                    </span>
                                )}
                                {currentShift.isPlaceholder && (
                                    <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-bold uppercase tracking-wider text-amber-700">
                                        New driver
                                    </span>
                                )}
                            </div>
                        </div>

                        <div className="flex shrink-0 items-start gap-3">
                            <div className={`flex max-w-md items-center gap-2 rounded-xl border px-3 py-2 text-sm font-bold ${validationMsg ? 'border-red-200 bg-red-50 text-red-700' : 'border-emerald-200 bg-emerald-50 text-emerald-700'}`}>
                                {validationMsg ? <AlertTriangle size={16} strokeWidth={3} /> : <CheckCircle2 size={16} strokeWidth={3} />}
                                <span>{validationMsg ?? 'Schedule compliant'}</span>
                            </div>
                            <button
                                type="button"
                                onClick={onCancel}
                                className="rounded-xl border border-gray-200 bg-white p-2 text-gray-400 transition-colors hover:bg-gray-50 hover:text-gray-700"
                                aria-label="Close shift editor"
                            >
                                <X size={22} />
                            </button>
                        </div>
                    </div>
                </div>

                <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-y-auto p-4 xl:grid-cols-[minmax(0,1fr)_360px] xl:overflow-hidden">
                    <div className="min-h-[360px] rounded-2xl border border-gray-200 bg-white p-4 shadow-sm xl:min-h-0">
                        <div className="mb-3 flex items-center justify-between gap-3">
                            <div>
                                <h3 className="text-sm font-extrabold text-gray-900">Gap impact preview</h3>
                                <p className="text-xs font-semibold text-gray-500">Compare coverage while you adjust this shift.</p>
                            </div>
                            <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-bold text-gray-600">{localZoneFilter} view</span>
                        </div>
                        <div className="h-[calc(100%-3.5rem)] min-h-0">
                            <GapChart
                                data={chartData}
                                zoneFilter={localZoneFilter}
                                onZoneFilterChange={setLocalZoneFilter}
                                fillHeight={true}
                            />
                        </div>
                    </div>

                    <aside className="flex min-h-0 flex-col gap-4 pr-1 xl:overflow-y-auto">
                        <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
                            <div className="mb-4 flex items-center gap-2">
                                <Clock size={18} className="text-gray-400" />
                                <h3 className="text-sm font-extrabold text-gray-900">Shift time</h3>
                            </div>
                            <div className="space-y-3">
                                <label className="block">
                                    <div className={fieldLabelClass}>Start</div>
                                    <div className="mt-2 flex items-center gap-2">
                                        <button type="button" onClick={() => adjustTime('startSlot', -1)} className={timeStepButtonClass} aria-label="Move shift start earlier">
                                            <ChevronLeft size={16} strokeWidth={3} />
                                        </button>
                                        <input
                                            type="text"
                                            inputMode="numeric"
                                            value={shiftTimeDrafts.startSlot}
                                            onChange={(e) => setShiftTimeDrafts(prev => ({ ...prev, startSlot: e.target.value }))}
                                            onFocus={() => setFocusedShiftTimeField('startSlot')}
                                            onBlur={() => commitShiftTimeDraft('startSlot')}
                                            onKeyDown={(e) => handleShiftTimeKeyDown('startSlot', e)}
                                            placeholder="08:30"
                                            className="min-w-0 flex-1 rounded-xl border border-gray-200 bg-white px-3 py-2 font-mono text-base font-bold text-gray-900 shadow-sm focus:border-brand-blue focus:outline-none focus:ring-2 focus:ring-blue-100"
                                            aria-label="Shift start time"
                                        />
                                        <button type="button" onClick={() => adjustTime('startSlot', 1)} className={timeStepButtonClass} aria-label="Move shift start later">
                                            <ChevronRight size={16} strokeWidth={3} />
                                        </button>
                                    </div>
                                </label>

                                <label className="block">
                                    <div className={fieldLabelClass}>End</div>
                                    <div className="mt-2 flex items-center gap-2">
                                        <button type="button" onClick={() => adjustTime('endSlot', -1)} className={timeStepButtonClass} aria-label="Move shift end earlier">
                                            <ChevronLeft size={16} strokeWidth={3} />
                                        </button>
                                        <input
                                            type="text"
                                            inputMode="numeric"
                                            value={shiftTimeDrafts.endSlot}
                                            onChange={(e) => setShiftTimeDrafts(prev => ({ ...prev, endSlot: e.target.value }))}
                                            onFocus={() => setFocusedShiftTimeField('endSlot')}
                                            onBlur={() => commitShiftTimeDraft('endSlot')}
                                            onKeyDown={(e) => handleShiftTimeKeyDown('endSlot', e)}
                                            placeholder="16:30"
                                            className="min-w-0 flex-1 rounded-xl border border-gray-200 bg-white px-3 py-2 font-mono text-base font-bold text-gray-900 shadow-sm focus:border-brand-blue focus:outline-none focus:ring-2 focus:ring-blue-100"
                                            aria-label="Shift end time"
                                        />
                                        <button type="button" onClick={() => adjustTime('endSlot', 1)} className={timeStepButtonClass} aria-label="Move shift end later">
                                            <ChevronRight size={16} strokeWidth={3} />
                                        </button>
                                    </div>
                                </label>
                            </div>
                        </section>

                        <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
                            <div className="mb-4 flex items-start justify-between gap-3">
                                <div className="flex items-center gap-2">
                                    <Coffee size={18} className="text-orange-500" />
                                    <div>
                                        <h3 className="text-sm font-extrabold text-gray-900">Lunch break</h3>
                                        <p className="text-xs font-semibold text-gray-500">Edit start and duration per shift.</p>
                                    </div>
                                </div>
                                <label className="flex shrink-0 items-center gap-2 rounded-lg bg-gray-50 px-2.5 py-1.5 text-xs font-bold text-gray-600">
                                    <input
                                        type="checkbox"
                                        checked={currentShift.isStraightShift === true}
                                        onChange={(e) => setCurrentShift({ ...currentShift, isStraightShift: e.target.checked })}
                                        className="h-4 w-4 accent-brand-blue"
                                    />
                                    Straight
                                </label>
                            </div>

                            {hasBreak ? (
                                <div className="space-y-4">
                                    <div className="rounded-xl border border-orange-200 bg-orange-50 px-3 py-2 text-sm font-bold text-orange-800">
                                        {formatSlotToTime(currentShift.breakStartSlot)} - {formatSlotToTime(breakEndSlot)} for {slotToMinutes(currentShift.breakDurationSlots)} minutes
                                    </div>
                                    <div className="grid grid-cols-2 gap-3">
                                        <div>
                                            <div className={fieldLabelClass}>Break start</div>
                                            <div className="mt-2 flex items-center gap-2">
                                                <button type="button" onClick={() => adjustTime('breakStartSlot', -1)} className={orangeStepButtonClass} aria-label="Move break earlier">
                                                    <ChevronLeft size={16} strokeWidth={3} />
                                                </button>
                                                <span className="flex-1 rounded-xl border border-gray-200 bg-white px-3 py-2 text-center font-mono text-sm font-bold text-gray-800">
                                                    {formatSlotToTime(currentShift.breakStartSlot)}
                                                </span>
                                                <button type="button" onClick={() => adjustTime('breakStartSlot', 1)} className={orangeStepButtonClass} aria-label="Move break later">
                                                    <ChevronRight size={16} strokeWidth={3} />
                                                </button>
                                            </div>
                                        </div>
                                        <div>
                                            <div className={fieldLabelClass}>Duration</div>
                                            <div className="mt-2 flex items-center gap-2">
                                                <button type="button" onClick={() => adjustTime('breakDurationSlots', -1)} className={orangeStepButtonClass} aria-label="Shorten break">
                                                    <ChevronLeft size={16} strokeWidth={3} />
                                                </button>
                                                <span className="flex-1 rounded-xl border border-gray-200 bg-white px-3 py-2 text-center font-mono text-sm font-bold text-gray-800">
                                                    {slotToMinutes(currentShift.breakDurationSlots)}m
                                                </span>
                                                <button type="button" onClick={() => adjustTime('breakDurationSlots', 1)} className={orangeStepButtonClass} aria-label="Lengthen break">
                                                    <ChevronRight size={16} strokeWidth={3} />
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={toggleBreak}
                                        className="w-full rounded-xl border border-red-200 bg-white px-4 py-2 text-sm font-bold text-red-600 transition-colors hover:bg-red-50"
                                    >
                                        Remove lunch
                                    </button>
                                </div>
                            ) : (
                                <button
                                    type="button"
                                    onClick={toggleBreak}
                                    className="flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-orange-200 bg-orange-50/60 px-4 py-3 text-sm font-bold text-orange-700 transition-colors hover:bg-orange-50"
                                >
                                    <Plus size={18} strokeWidth={3} /> Add lunch break
                                </button>
                            )}

                            <p className="mt-3 text-xs font-semibold leading-5 text-gray-500">
                                Non-straight shifts need lunch before any driver exceeds {MAX_HOURS_WITHOUT_BREAK} consecutive driving hours.
                            </p>
                        </section>

                        <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
                            <h3 className="mb-3 text-sm font-extrabold text-gray-900">Shift handoff</h3>
                            <div className="space-y-3">
                                <label className="block">
                                    <div className={fieldLabelClass}>Handoff from</div>
                                    <select
                                        value={currentShift.handoffFromShiftId ?? ''}
                                        onChange={(e) => setCurrentShift({
                                            ...currentShift,
                                            handoffFromShiftId: e.target.value || undefined,
                                            handoffFromLocation: e.target.value
                                                ? (currentShift.handoffFromLocation ?? DEFAULT_CHANGEOFF_LOCATION)
                                                : undefined,
                                        })}
                                        disabled={!canUseShiftHandoffs}
                                        className={selectClass}
                                    >
                                        <option value="">None</option>
                                        {handoffOptions
                                            .filter(candidate => candidate.id !== currentShift.handoffToShiftId)
                                            .map(candidate => (
                                                <option key={candidate.id} value={candidate.id}>
                                                    {candidate.driverName} ({formatSlotToTime(candidate.startSlot)} - {formatSlotToTime(candidate.endSlot)})
                                                </option>
                                            ))}
                                    </select>
                                    <select
                                        value={currentShift.handoffFromLocation ?? DEFAULT_CHANGEOFF_LOCATION}
                                        onChange={(e) => setCurrentShift({
                                            ...currentShift,
                                            handoffFromLocation: e.target.value as OnDemandChangeoffLocation,
                                        })}
                                        disabled={!canUseShiftHandoffs || !currentShift.handoffFromShiftId}
                                        className={selectClass}
                                    >
                                        {changeoffLocations.map(location => (
                                            <option key={location} value={location}>
                                                Changeoff at {ON_DEMAND_CHANGEOFF_LOCATION_LABELS[location]}
                                            </option>
                                        ))}
                                    </select>
                                </label>

                                <label className="block">
                                    <div className={fieldLabelClass}>Handoff to</div>
                                    <select
                                        value={currentShift.handoffToShiftId ?? ''}
                                        onChange={(e) => setCurrentShift({
                                            ...currentShift,
                                            handoffToShiftId: e.target.value || undefined,
                                            handoffToLocation: e.target.value
                                                ? (currentShift.handoffToLocation ?? DEFAULT_CHANGEOFF_LOCATION)
                                                : undefined,
                                        })}
                                        disabled={!canUseShiftHandoffs}
                                        className={selectClass}
                                    >
                                        <option value="">None</option>
                                        {handoffOptions
                                            .filter(candidate => candidate.id !== currentShift.handoffFromShiftId)
                                            .map(candidate => (
                                                <option key={candidate.id} value={candidate.id}>
                                                    {candidate.driverName} ({formatSlotToTime(candidate.startSlot)} - {formatSlotToTime(candidate.endSlot)})
                                                </option>
                                            ))}
                                    </select>
                                    <select
                                        value={currentShift.handoffToLocation ?? DEFAULT_CHANGEOFF_LOCATION}
                                        onChange={(e) => setCurrentShift({
                                            ...currentShift,
                                            handoffToLocation: e.target.value as OnDemandChangeoffLocation,
                                        })}
                                        disabled={!canUseShiftHandoffs || !currentShift.handoffToShiftId}
                                        className={selectClass}
                                    >
                                        {changeoffLocations.map(location => (
                                            <option key={location} value={location}>
                                                Changeoff at {ON_DEMAND_CHANGEOFF_LOCATION_LABELS[location]}
                                            </option>
                                        ))}
                                    </select>
                                </label>
                            </div>
                        </section>
                    </aside>
                </div>

                <div className="border-t border-gray-200 bg-white px-6 py-4 shadow-[0_-8px_30px_rgba(15,23,42,0.05)]">
                    <div className="mb-3 flex items-center justify-between">
                        <div>
                            <h3 className="text-sm font-extrabold text-gray-900">Timeline</h3>
                            <p className="text-xs font-semibold text-gray-500">Drag the blue bar to move the shift. Drag the orange block to move lunch.</p>
                        </div>
                        <div className="hidden items-center gap-4 text-xs font-bold text-gray-500 sm:flex">
                            <span className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-brand-blue" /> Shift</span>
                            <span className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-orange-400" /> Lunch</span>
                        </div>
                    </div>

                    <div className="mb-4" style={{ marginLeft: 38, marginRight: 30 }}>
                        <div
                            ref={trackRef}
                            className="relative h-16 cursor-pointer select-none rounded-xl border border-gray-200 bg-gray-100"
                        >
                            <div className="absolute inset-0 pointer-events-none">
                                {Array.from({ length: 25 }).map((_, i) => (
                                    <div
                                        key={i}
                                        className="absolute top-0 bottom-0 flex flex-col justify-end border-l border-gray-200 pb-1"
                                        style={{ left: `${(i / 24) * 100}%` }}
                                    >
                                        <span className="pl-1 text-[10px] font-bold text-gray-300">{i}</span>
                                    </div>
                                ))}
                            </div>

                            <div
                                className="absolute top-3 bottom-3 cursor-grab rounded-lg bg-brand-blue shadow-sm transition-all hover:brightness-110 active:cursor-grabbing group"
                                style={{
                                    left: `${(currentShift.startSlot / TIME_SLOTS_PER_DAY) * 100}%`,
                                    width: `${((currentShift.endSlot - currentShift.startSlot) / TIME_SLOTS_PER_DAY) * 100}%`
                                }}
                                onMouseDown={(e) => handleMouseDown(e, 'shift')}
                            >
                                <div className="absolute inset-0 flex items-center justify-center opacity-0 transition-opacity group-hover:opacity-100 pointer-events-none">
                                    <GripHorizontal className="text-white/60" size={20} />
                                </div>

                                {renderShiftBoundaryControl('startSlot')}
                                {renderShiftBoundaryControl('endSlot')}

                                <div
                                    className="absolute left-0 top-0 bottom-0 z-20 flex w-4 cursor-ew-resize items-center justify-center rounded-l-lg transition-colors hover:bg-white/20"
                                    onMouseDown={(e) => handleMouseDown(e, 'start')}
                                    title="Drag to resize start"
                                >
                                    <GripVertical size={12} className="text-white/60" />
                                </div>

                                <div
                                    className="absolute right-0 top-0 bottom-0 z-20 flex w-4 cursor-ew-resize items-center justify-center rounded-r-lg transition-colors hover:bg-white/20"
                                    onMouseDown={(e) => handleMouseDown(e, 'end')}
                                    title="Drag to resize end"
                                >
                                    <GripVertical size={12} className="text-white/60" />
                                </div>
                            </div>

                            {hasBreak && (
                                <div
                                    className="absolute top-3 bottom-3 z-30 cursor-grab rounded-md border-2 border-white/40 bg-orange-400 shadow-sm transition-colors hover:bg-orange-300 active:cursor-grabbing"
                                    style={{
                                        left: `${(currentShift.breakStartSlot / TIME_SLOTS_PER_DAY) * 100}%`,
                                        width: `${(currentShift.breakDurationSlots / TIME_SLOTS_PER_DAY) * 100}%`
                                    }}
                                    onMouseDown={(e) => handleMouseDown(e, 'break')}
                                    title="Drag to move lunch"
                                >
                                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                                        <Coffee size={12} className="text-white/90" />
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>

                    <div className="flex items-center justify-end gap-3">
                        <button
                            type="button"
                            onClick={onCancel}
                            className="rounded-xl border border-gray-200 bg-white px-5 py-3 text-sm font-bold text-gray-600 transition-colors hover:bg-gray-50"
                        >
                            Discard
                        </button>
                        <button
                            type="button"
                            onClick={saveCurrentShift}
                            disabled={validationMsg !== null}
                            className="flex items-center gap-2 rounded-xl bg-brand-blue px-6 py-3 text-sm font-bold text-white shadow-sm shadow-blue-200 transition-all hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-60 disabled:shadow-none disabled:hover:bg-brand-blue"
                        >
                            <Save size={18} /> Save changes
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};
