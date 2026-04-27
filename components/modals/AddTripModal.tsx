import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Bus, Calendar, ChevronDown, ChevronUp, Clock, GitBranch, Plus, X } from 'lucide-react';
import { TimeUtils } from '../../utils/timeUtils';
import {
  applyAddTripResultToSchedules,
  applyEditTripResultToSchedules,
  buildAddTripModalContext,
  buildAddTripPresets,
  buildEditTripSuggestions,
  buildAddTripSuggestions,
  type AddTripBlockMode,
  type AddTripModalContext,
  type AddTripPlacement,
  type AddTripResult,
  type AddTripServiceMode,
  type AddTripStartPreset
} from '../../utils/schedule/addTripPlanner';
import { AddTripSchedulePreview } from './AddTripSchedulePreview';

export type { AddTripModalContext, AddTripPlacement, AddTripResult, AddTripBlockMode, AddTripServiceMode, AddTripStartPreset } from '../../utils/schedule/addTripPlanner';

interface Props {
  context: AddTripModalContext;
  onCancel: () => void;
  onConfirm: (result: AddTripResult, contextOverride?: AddTripModalContext) => void;
}

const formatMaybeMinutes = (value: number | null | undefined, suffix = 'min'): string => {
  if (value === null || value === undefined || Number.isNaN(value)) return '-';
  return `${value} ${suffix}`;
};

const formatMinuteDelta = (value: number | null | undefined): string => {
  if (value === null || value === undefined || Number.isNaN(value)) return '-';
  return `${value > 0 ? '+' : ''}${value} min`;
};

const formatCountDelta = (value: number | null | undefined, noun: string): string => {
  if (value === null || value === undefined || Number.isNaN(value)) return '-';
  return `${value > 0 ? '+' : ''}${value} ${noun}${Math.abs(value) === 1 ? '' : 's'}`;
};

const formatTimeOrDash = (value: number | null | undefined): string => {
  if (value === null || value === undefined || Number.isNaN(value)) return '-';
  return TimeUtils.fromMinutes(value);
};

const formatTripWindow = (startTime: number | null | undefined, endTime: number | null | undefined): string => (
  `${formatTimeOrDash(startTime)} → ${formatTimeOrDash(endTime)}`
);

const getDayTypeLabel = (routeName: string): 'Weekday' | 'Saturday' | 'Sunday' => {
  if (routeName.includes('(Saturday)')) return 'Saturday';
  if (routeName.includes('(Sunday)')) return 'Sunday';
  return 'Weekday';
};

const getDefaultDirection = (context: AddTripModalContext, availableDirections: Array<'North' | 'South'>): 'North' | 'South' => {
  if (availableDirections.includes(context.referenceTrip.direction)) return context.referenceTrip.direction;
  return availableDirections[0] ?? 'North';
};

const getDefaultBlockMode = (
  blockChoices: Array<{ mode: AddTripBlockMode }>
): AddTripBlockMode => {
  if (blockChoices.some(choice => choice.mode === 'existing')) return 'existing';
  if (blockChoices.some(choice => choice.mode === 'reference')) return 'reference';
  return 'new';
};

const getOppositeDirection = (direction: 'North' | 'South'): 'North' | 'South' => (
  direction === 'North' ? 'South' : 'North'
);

const getSeedStopSelection = (
  context: AddTripModalContext,
  direction: 'North' | 'South',
  serviceMode: AddTripServiceMode
): { startStopName: string; endStopName: string } => {
  if (context.actionMode === 'edit' && context.initialStopSelection) {
    return context.initialStopSelection;
  }

  const startTable = direction === 'North'
    ? context.allSchedules.find(table => table.routeName === `${context.routeBaseName} (North)`) ?? context.targetTable
    : context.allSchedules.find(table => table.routeName === `${context.routeBaseName} (South)`) ?? context.targetTable;
  const returnDirection = getOppositeDirection(direction);
  const returnTable = returnDirection === 'North'
    ? context.allSchedules.find(table => table.routeName === `${context.routeBaseName} (North)`) ?? startTable
    : context.allSchedules.find(table => table.routeName === `${context.routeBaseName} (South)`) ?? startTable;

  return {
    startStopName: startTable.stops[0] ?? '',
    endStopName: serviceMode === 'custom'
      ? returnTable.stops[Math.max(0, returnTable.stops.length - 1)] ?? startTable.stops[Math.max(0, startTable.stops.length - 1)] ?? ''
      : startTable.stops[Math.max(0, startTable.stops.length - 1)] ?? ''
  };
};

const getCombinedStopOptions = (...tables: Array<{ stops: string[] } | null | undefined>): string[] => {
  const seen = new Set<string>();
  const combined: string[] = [];

  tables.forEach(table => {
    table?.stops.forEach(stop => {
      if (seen.has(stop)) return;
      seen.add(stop);
      combined.push(stop);
    });
  });

  return combined;
};

const SERVICE_MODE_COPY: Record<AddTripServiceMode, { label: string; description: string; countLabel: string; confirmLabel: string }> = {
  trip: {
    label: 'One-way trip',
    description: 'Add one direction only at the selected insertion point.',
    countLabel: 'One-way trips to add',
    confirmLabel: 'One-way Trip',
  },
  custom: {
    label: 'Custom pair / short-turn',
    description: 'Choose the outbound start and return end for a paired movement.',
    countLabel: 'Custom pairs to add',
    confirmLabel: 'Custom Pair',
  },
  cycle: {
    label: 'Full cycle',
    description: 'Add the northbound trip and linked southbound return together.',
    countLabel: 'Full cycles to add',
    confirmLabel: 'Full Cycle',
  },
};

const makeGeneratedTripSummary = (trip: { direction?: string; startTime?: number; endTime?: number; blockId?: string; recoveryTime?: number }): string => (
  `${trip.direction ?? 'Trip'} ${formatTripWindow(trip.startTime, trip.endTime)} · block ${trip.blockId ?? '-'} · rec ${trip.recoveryTime ?? 0}m`
);

export const AddTripModal: React.FC<Props> = ({ context, onCancel, onConfirm }) => {
  const [activeContext, setActiveContext] = useState<AddTripModalContext>(context);

  useEffect(() => {
    setActiveContext(context);
  }, [context]);

  const routeNumber = activeContext.routeBaseName.split(' ')[0] || activeContext.routeBaseName;
  const dayType = getDayTypeLabel(activeContext.targetTable.routeName);
  const isEditMode = activeContext.actionMode === 'edit';
  const initialServiceMode: AddTripServiceMode = isEditMode ? 'trip' : (activeContext.preferredServiceMode ?? 'trip');

  const availableDirections = useMemo<Array<'North' | 'South'>>(() => {
    const directions: Array<'North' | 'South'> = [];
    const hasNorth = activeContext.allSchedules.some(table => table.routeName === `${activeContext.routeBaseName} (North)`);
    const hasSouth = activeContext.allSchedules.some(table => table.routeName === `${activeContext.routeBaseName} (South)`);

    if (hasNorth || activeContext.targetTable.routeName.includes('(North)') || activeContext.referenceTrip.direction === 'North') {
      directions.push('North');
    }
    if (hasSouth || activeContext.targetTable.routeName.includes('(South)') || activeContext.referenceTrip.direction === 'South') {
      directions.push('South');
    }

    return directions.length > 0 ? directions : [activeContext.referenceTrip.direction ?? 'North'];
  }, [activeContext.allSchedules, activeContext.referenceTrip.direction, activeContext.routeBaseName, activeContext.targetTable.routeName]);

  const initialDirection = isEditMode
    ? activeContext.referenceTrip.direction
    : initialServiceMode === 'cycle' && availableDirections.includes('North')
    ? 'North'
    : getDefaultDirection(activeContext, availableDirections);
  const initialPresetOptions = useMemo(
    () => buildAddTripPresets(activeContext, initialDirection, activeContext.initialStartTime ?? activeContext.referenceTrip.startTime),
    [activeContext, initialDirection]
  );
  const initialStartTime = activeContext.initialStartTime
    ?? initialPresetOptions.find(option => option.preset === 'midpoint')?.startTime
    ?? activeContext.referenceTrip.startTime;
  const initialStopSelection = useMemo(
    () => getSeedStopSelection(activeContext, initialDirection, initialServiceMode),
    [activeContext, initialDirection, initialServiceMode]
  );
  const initialSuggestions = useMemo(
    () => isEditMode
      ? buildEditTripSuggestions(
        activeContext,
        initialStartTime,
        initialStopSelection
      )
      : buildAddTripSuggestions(
        activeContext,
        initialDirection,
        initialStartTime,
        1,
        initialServiceMode,
        false,
        'new',
        '',
        initialStopSelection
      ),
    [activeContext, initialDirection, initialServiceMode, initialStartTime, initialStopSelection, isEditMode]
  );
  const initialBlockMode = useMemo(
    () => isEditMode ? 'reference' : getDefaultBlockMode(initialSuggestions.blockChoices),
    [initialSuggestions.blockChoices, isEditMode]
  );
  const initialSelectedBlockId = useMemo(() => (
    initialBlockMode === 'new'
      ? initialSuggestions.newBlockId
      : initialBlockMode === 'reference'
        ? activeContext.referenceTrip.blockId
        : (initialSuggestions.blockChoices.find(choice => choice.mode === 'existing')?.blockId ?? activeContext.referenceTrip.blockId)
  ), [activeContext.referenceTrip.blockId, initialBlockMode, initialSuggestions.blockChoices, initialSuggestions.newBlockId]);

  const [selectedDirection, setSelectedDirection] = useState<'North' | 'South'>(initialDirection);
  const [serviceMode, setServiceMode] = useState<AddTripServiceMode>(initialServiceMode);
  const [startPreset, setStartPreset] = useState<AddTripStartPreset>('midpoint');
  const [startTimeInput, setStartTimeInput] = useState(TimeUtils.fromMinutes(initialStartTime));
  const [tripCount, setTripCount] = useState(1);
  const [blockMode, setBlockMode] = useState<AddTripBlockMode>(initialBlockMode);
  const [selectedBlockId, setSelectedBlockId] = useState(initialSelectedBlockId);
  const [startStopName, setStartStopName] = useState(initialSuggestions.selectedStartStopName);
  const [endStopName, setEndStopName] = useState(initialSuggestions.selectedEndStopName);
  const [absorbShortTrailingGapIntoRecovery, setAbsorbShortTrailingGapIntoRecovery] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const parsedStartTime = TimeUtils.toMinutes(startTimeInput);
  const effectiveStartTime = parsedStartTime ?? initialStartTime;

  const suggestions = useMemo(
    () => isEditMode
      ? buildEditTripSuggestions(
        activeContext,
        effectiveStartTime,
        { startStopName, endStopName }
      )
      : buildAddTripSuggestions(
        activeContext,
        selectedDirection,
        effectiveStartTime,
        tripCount,
        serviceMode,
        absorbShortTrailingGapIntoRecovery,
        blockMode,
        selectedBlockId,
        { startStopName, endStopName }
      ),
    [activeContext, selectedDirection, effectiveStartTime, tripCount, serviceMode, absorbShortTrailingGapIntoRecovery, blockMode, selectedBlockId, startStopName, endStopName, isEditMode]
  );

  const presetOptions = useMemo(
    () => buildAddTripPresets(activeContext, isEditMode ? activeContext.referenceTrip.direction : selectedDirection, effectiveStartTime),
    [activeContext, selectedDirection, effectiveStartTime, isEditMode]
  );

  const selectedTargetTable = suggestions.selectedTargetTable;
  const hasBidirectionalCycleOption = !isEditMode && availableDirections.length === 2;
  const isPairedServiceMode = hasBidirectionalCycleOption && (serviceMode === 'cycle' || serviceMode === 'custom');
  const cycleLocksNorthbound = serviceMode === 'cycle' && hasBidirectionalCycleOption;
  const actualTripCount = suggestions.actualTripCount;
  const isValidTime = parsedStartTime !== null;
  const hasAnyOverlap = suggestions.previewItems.some(item => item.hasOverlap);
  const hasBlockingBlockConflict = suggestions.impact.hasBlockingBlockConflict;
  const primaryBlockConflict = suggestions.blockConflicts[0] ?? null;
  const canConfirm = isValidTime && !hasBlockingBlockConflict;
  const isPartialTrip = suggestions.impact.isPartial;
  const blockSummaryLabel = blockMode === 'new'
    ? `new block ${suggestions.newBlockId}`
    : blockMode === 'reference'
      ? `block ${activeContext.referenceTrip.blockId}`
      : `block ${selectedBlockId || suggestions.newBlockId}`;
  const plannerSummary = isEditMode
    ? `Edit this ${activeContext.referenceTrip.direction.toLowerCase()}bound trip on block ${activeContext.referenceTrip.blockId}, starting at ${formatTimeOrDash(parsedStartTime ?? effectiveStartTime)} from ${suggestions.selectedStartStopName} to ${suggestions.selectedEndStopName}.`
    : serviceMode === 'cycle'
    ? `Add ${tripCount} full cycle${tripCount === 1 ? '' : 's'} on ${blockSummaryLabel}, starting northbound from ${suggestions.selectedStartStopName} at ${formatTimeOrDash(parsedStartTime ?? effectiveStartTime)} and returning southbound.`
    : serviceMode === 'custom'
      ? `Add ${tripCount} custom pair${tripCount === 1 ? '' : 's'} on ${blockSummaryLabel}, starting ${selectedDirection.toLowerCase()}bound from ${suggestions.selectedStartStopName} at ${formatTimeOrDash(parsedStartTime ?? effectiveStartTime)} and returning to ${suggestions.selectedEndStopName}.`
      : `Add ${tripCount} ${isPartialTrip ? 'short-turn ' : ''}${selectedDirection.toLowerCase()}bound trip${tripCount === 1 ? '' : 's'} on ${blockSummaryLabel}, departing ${suggestions.selectedStartStopName} at ${formatTimeOrDash(parsedStartTime ?? effectiveStartTime)} and ending at ${suggestions.selectedEndStopName}.`;
  const insertionPlacementLabel = activeContext.insertionPlacement === 'before' ? 'Before anchor trip' : 'After anchor trip';
  const anchorTripSummary = `${activeContext.referenceTrip.direction}bound · ${formatTripWindow(activeContext.referenceTrip.startTime, activeContext.referenceTrip.endTime)}`;
  const returnDirection = getOppositeDirection(selectedDirection);
  const returnTargetTable = useMemo(() => (
    returnDirection === 'North'
      ? activeContext.allSchedules.find(table => table.routeName === `${activeContext.routeBaseName} (North)`) ?? selectedTargetTable
      : activeContext.allSchedules.find(table => table.routeName === `${activeContext.routeBaseName} (South)`) ?? selectedTargetTable
  ), [activeContext.allSchedules, activeContext.routeBaseName, returnDirection, selectedTargetTable]);

  const tripStartStopOptions = useMemo(() => {
    const endIndex = Math.max(selectedTargetTable.stops.indexOf(endStopName), 0);
    return selectedTargetTable.stops.filter((_, index) => index <= endIndex);
  }, [selectedTargetTable.stops, endStopName]);

  const tripEndStopOptions = useMemo(() => {
    const startIndex = Math.max(selectedTargetTable.stops.indexOf(startStopName), 0);
    return selectedTargetTable.stops.filter((_, index) => index >= startIndex);
  }, [selectedTargetTable.stops, startStopName]);
  const customStopOptions = useMemo(
    () => getCombinedStopOptions(selectedTargetTable, returnTargetTable),
    [returnTargetTable, selectedTargetTable]
  );
  const startStopOptions = serviceMode === 'custom' ? customStopOptions : tripStartStopOptions;
  const endStopOptions = serviceMode === 'custom' ? customStopOptions : tripEndStopOptions;

  useEffect(() => {
    setSelectedDirection(initialDirection);
  }, [initialDirection]);

  useEffect(() => {
    setServiceMode(initialServiceMode);
  }, [initialServiceMode]);

  useEffect(() => {
    if (serviceMode === 'cycle' && availableDirections.includes('North') && selectedDirection !== 'North') {
      setSelectedDirection('North');
    }
  }, [availableDirections, selectedDirection, serviceMode]);

  useEffect(() => {
    setSelectedBlockId(previousBlockId => {
      if (blockMode === 'new') return suggestions.newBlockId;
      if (blockMode === 'reference') return activeContext.referenceTrip.blockId;

      const existingChoices = suggestions.blockChoices.filter(choice => choice.mode === 'existing');
      if (existingChoices.some(choice => choice.blockId === previousBlockId)) {
        return previousBlockId;
      }

      return existingChoices[0]?.blockId ?? suggestions.newBlockId;
    });
  }, [activeContext.referenceTrip.blockId, blockMode, suggestions.blockChoices, suggestions.newBlockId]);

  useEffect(() => {
    if (isEditMode) {
      setSelectedDirection(activeContext.referenceTrip.direction);
      return;
    }

    const nextMode = initialServiceMode;
    const nextDirection = nextMode === 'cycle' && availableDirections.includes('North')
      ? 'North'
      : getDefaultDirection(activeContext, availableDirections);
    const nextStartTime = activeContext.initialStartTime
      ?? buildAddTripPresets(activeContext, nextDirection, activeContext.initialStartTime ?? activeContext.referenceTrip.startTime)
        .find(option => option.preset === 'midpoint')?.startTime
      ?? activeContext.referenceTrip.startTime;
    const nextSeedSuggestions = buildAddTripSuggestions(
      activeContext,
      nextDirection,
      nextStartTime,
      1,
      nextMode,
      false,
      'new',
      '',
      getSeedStopSelection(activeContext, nextDirection, nextMode)
    );
    const nextBlockMode = getDefaultBlockMode(nextSeedSuggestions.blockChoices);

    setServiceMode(nextMode);
    setSelectedDirection(nextDirection);
    setStartPreset('midpoint');
    setStartTimeInput(TimeUtils.fromMinutes(nextStartTime));
    setTripCount(1);
    setBlockMode(nextBlockMode);
    setSelectedBlockId(
      nextBlockMode === 'new'
        ? nextSeedSuggestions.newBlockId
        : nextBlockMode === 'reference'
          ? activeContext.referenceTrip.blockId
          : (nextSeedSuggestions.blockChoices.find(choice => choice.mode === 'existing')?.blockId ?? activeContext.referenceTrip.blockId)
    );
    setStartStopName(nextSeedSuggestions.selectedStartStopName);
    setEndStopName(nextSeedSuggestions.selectedEndStopName);
    setAbsorbShortTrailingGapIntoRecovery(false);
  }, [activeContext, availableDirections, initialServiceMode, isEditMode]);

  useEffect(() => {
    if (startPreset === 'manual') return;
    const presetTime = presetOptions.find(option => option.preset === startPreset)?.startTime;
    if (typeof presetTime === 'number') {
      setStartTimeInput(TimeUtils.fromMinutes(presetTime));
    }
  }, [presetOptions, startPreset]);

  useEffect(() => {
    if (isEditMode || cycleLocksNorthbound) {
      setStartStopName(suggestions.selectedStartStopName);
      setEndStopName(suggestions.selectedEndStopName);
      return;
    }

    setStartStopName(current => (startStopOptions.includes(current) ? current : suggestions.selectedStartStopName));
    setEndStopName(current => (endStopOptions.includes(current) ? current : suggestions.selectedEndStopName));
  }, [cycleLocksNorthbound, endStopOptions, isEditMode, startStopOptions, suggestions.selectedEndStopName, suggestions.selectedStartStopName]);

  useEffect(() => {
    if (!suggestions.impact.canAbsorbShortTrailingGap && absorbShortTrailingGapIntoRecovery) {
      setAbsorbShortTrailingGapIntoRecovery(false);
    }
  }, [absorbShortTrailingGapIntoRecovery, suggestions.impact.canAbsorbShortTrailingGap]);

  const handlePresetSelect = (preset: AddTripStartPreset, startTime: number | null) => {
    setStartPreset(preset);
    if (typeof startTime === 'number') {
      setStartTimeInput(TimeUtils.fromMinutes(startTime));
    }
  };

  const handleDirectionChange = (direction: 'North' | 'South') => {
    const normalizedDirection = cycleLocksNorthbound && availableDirections.includes('North') ? 'North' : direction;
    setSelectedDirection(normalizedDirection);
    const midpoint = buildAddTripPresets(activeContext, normalizedDirection, effectiveStartTime).find(option => option.preset === 'midpoint')?.startTime;
    if (typeof midpoint === 'number') {
      setStartTimeInput(TimeUtils.fromMinutes(midpoint));
    }
    setStartPreset('midpoint');
  };

  const handleChooseInsertion = (tripId: string, placement: AddTripPlacement) => {
    if (isEditMode) return;
    const nextContext = buildAddTripModalContext(
      activeContext.allSchedules,
      tripId,
      placement,
      activeContext.connectionLibrary ?? null,
      serviceMode
    );
    if (!nextContext) return;
    setActiveContext(nextContext);
  };

  const handleConfirm = () => {
    if (parsedStartTime === null || hasBlockingBlockConflict) return;

    onConfirm({
      startTime: parsedStartTime,
      tripCount: isEditMode ? 1 : tripCount,
      serviceMode: isEditMode ? 'trip' : serviceMode,
      absorbShortTrailingGapIntoRecovery: isEditMode ? false : absorbShortTrailingGapIntoRecovery,
      blockMode: isEditMode ? 'reference' : blockMode,
      blockId: isEditMode ? activeContext.referenceTrip.blockId : (blockMode === 'new' ? suggestions.newBlockId : selectedBlockId),
      targetDirection: isEditMode ? activeContext.referenceTrip.direction : (cycleLocksNorthbound ? 'North' : selectedDirection),
      targetRouteName: selectedTargetTable.routeName,
      startStopName: isEditMode || cycleLocksNorthbound ? suggestions.selectedStartStopName : startStopName,
      endStopName: isEditMode || cycleLocksNorthbound ? suggestions.selectedEndStopName : endStopName
    }, activeContext);
  };

  const primaryConnection = suggestions.selectedConnections[0] ?? null;
  const primaryPreview = suggestions.previewItems[0] ?? null;
  const previewRouteGroupName = activeContext.routeBaseName.replace(/\s*\((Weekday|Saturday|Sunday)\)/gi, '').trim();
  const pendingPreviewResult = useMemo(() => {
    if (parsedStartTime === null) return null;
    if (isEditMode) {
      return applyEditTripResultToSchedules(activeContext.allSchedules, activeContext, {
        startTime: parsedStartTime,
        tripCount: 1,
        serviceMode: 'trip',
        absorbShortTrailingGapIntoRecovery: false,
        blockMode: 'reference',
        blockId: activeContext.referenceTrip.blockId,
        targetDirection: activeContext.referenceTrip.direction,
        targetRouteName: selectedTargetTable.routeName,
        startStopName: suggestions.selectedStartStopName,
        endStopName: suggestions.selectedEndStopName
      });
    }
    return applyAddTripResultToSchedules(activeContext.allSchedules, activeContext, {
      startTime: parsedStartTime,
      tripCount,
      serviceMode,
      absorbShortTrailingGapIntoRecovery,
      blockMode,
      blockId: blockMode === 'new' ? suggestions.newBlockId : selectedBlockId,
      targetDirection: cycleLocksNorthbound ? 'North' : selectedDirection,
      targetRouteName: selectedTargetTable.routeName,
      startStopName: cycleLocksNorthbound ? suggestions.selectedStartStopName : startStopName,
      endStopName: cycleLocksNorthbound ? suggestions.selectedEndStopName : endStopName
    });
  }, [
    activeContext,
    blockMode,
    cycleLocksNorthbound,
    isEditMode,
    parsedStartTime,
    selectedBlockId,
    selectedDirection,
    selectedTargetTable.routeName,
    serviceMode,
    absorbShortTrailingGapIntoRecovery,
    startStopName,
    endStopName,
    suggestions.newBlockId,
    suggestions.selectedEndStopName,
    suggestions.selectedStartStopName,
    tripCount
  ]);
  const previewSchedules = pendingPreviewResult?.schedules ?? activeContext.allSchedules;
  const highlightedPreviewTripId = pendingPreviewResult
    ? ('createdTripIds' in pendingPreviewResult
      ? pendingPreviewResult.createdTripIds[0] ?? null
      : pendingPreviewResult.updatedTripId ?? null)
    : null;
  const generatedTripSummaries = useMemo(() => {
    if (!pendingPreviewResult || !('createdTrips' in pendingPreviewResult)) return [];
    return pendingPreviewResult.createdTrips.slice(0, 4).map(makeGeneratedTripSummary);
  }, [pendingPreviewResult]);
  const generatedTripOverflow = pendingPreviewResult && 'createdTrips' in pendingPreviewResult
    ? Math.max(0, pendingPreviewResult.createdTrips.length - generatedTripSummaries.length)
    : 0;

  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="bg-white w-[min(1900px,98vw)] h-[94vh] rounded-2xl shadow-2xl overflow-hidden border border-blue-100 flex flex-col">
        <div className="px-6 py-4 bg-blue-50 border-b border-blue-100 flex justify-between items-center">
          <div>
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <h3 className="text-lg font-extrabold text-blue-900 flex items-center gap-2">
                <Plus size={20} className="text-blue-600" />
                {isEditMode ? 'Edit Trip' : 'Add Service'}
              </h3>
              <span className="bg-blue-600 text-white text-[10px] font-bold px-2 py-0.5 rounded-md">Route {routeNumber}</span>
              <span className="bg-gray-200 text-gray-700 text-[10px] font-bold px-2 py-0.5 rounded-md flex items-center gap-1">
                <Calendar size={10} />
                {dayType}
              </span>
              <span className="bg-emerald-100 text-emerald-700 text-[10px] font-bold px-2 py-0.5 rounded-md">
                {selectedDirection}bound planning
              </span>
            </div>
            <p className="text-xs font-bold text-blue-500">
              {isEditMode
                ? <>Editing bus/block <span className="font-mono text-blue-700">{activeContext.referenceTrip.blockId}</span></>
                : blockMode === 'new'
                ? <>Creating new bus/block <span className="font-mono text-blue-700">{suggestions.newBlockId}</span></>
                : blockMode === 'reference'
                  ? <>Using same bus/block <span className="font-mono text-blue-700">{activeContext.referenceTrip.blockId}</span></>
                  : <>Using existing bus/block <span className="font-mono text-blue-700">{selectedBlockId || '-'}</span></>}
            </p>
          </div>
          <button
            onClick={onCancel}
            className="p-1 rounded-full text-blue-300 hover:bg-blue-100 hover:text-blue-600 transition-colors"
            aria-label="Close add service modal"
          >
            <X size={20} />
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-hidden p-4 md:p-6">
          <div className="grid h-full min-h-0 gap-4 xl:grid-cols-[380px_minmax(0,1fr)]">
            <div className="min-h-0 overflow-auto pr-1 space-y-4">
              {showAdvanced && (
                <section className="bg-gray-50 rounded-xl p-4 border border-gray-200">
                  <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">Selected insertion context</div>
                  <div className="grid gap-2 md:grid-cols-4 text-sm text-gray-700">
                    <div>
                      <div className="text-[10px] uppercase font-bold text-gray-400">Previous trip</div>
                      <div className="font-semibold">{formatTimeOrDash(suggestions.nearbyTrips.previous?.startTime ?? null)}</div>
                    </div>
                    <div>
                      <div className="text-[10px] uppercase font-bold text-gray-400">Next trip</div>
                      <div className="font-semibold">{formatTimeOrDash(suggestions.nearbyTrips.next?.startTime ?? null)}</div>
                    </div>
                    <div>
                      <div className="text-[10px] uppercase font-bold text-gray-400">Template trip</div>
                      <div className="font-semibold font-mono">{suggestions.templateTrip?.blockId ?? activeContext.referenceTrip.blockId}</div>
                    </div>
                    <div>
                      <div className="text-[10px] uppercase font-bold text-gray-400">Selected side</div>
                      <div className="font-semibold">{selectedTargetTable.routeName}</div>
                    </div>
                  </div>
                </section>
              )}

              <section className="bg-white rounded-xl border border-blue-100 p-4 space-y-4">
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Planned change</div>
                  <p className="mt-2 text-sm font-semibold leading-6 text-slate-800">{plannerSummary}</p>
                  {generatedTripSummaries.length > 0 && (
                    <div className="mt-3 rounded-lg border border-slate-200 bg-white px-3 py-2">
                      <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Will add</div>
                      <ul className="mt-1 space-y-1 text-xs font-semibold text-slate-700">
                        {generatedTripSummaries.map(summary => (
                          <li key={summary}>{summary}</li>
                        ))}
                      </ul>
                      {generatedTripOverflow > 0 && (
                        <div className="mt-1 text-xs text-slate-500">
                          +{generatedTripOverflow} more
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {!isEditMode && (
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase mb-2">Add new trip</label>
                  <div className="rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-900">
                    <div className="font-semibold">Choose where the new trip goes in the preview.</div>
                    <p className="mt-1 text-xs text-blue-700">
                      Use <span className="font-semibold">+ Above first row</span>, <span className="font-semibold">+ Below last row</span>, or a row <span className="font-semibold">+</span> inside the preview table to place the new trip.
                    </p>
                    <div className="mt-3 grid gap-2 sm:grid-cols-3">
                      <div className="rounded-lg border border-blue-200 bg-white/80 px-3 py-2">
                        <div className="text-[10px] uppercase font-bold tracking-wider text-blue-500">Placement</div>
                        <div className="mt-1 text-xs font-semibold text-blue-900">{insertionPlacementLabel}</div>
                      </div>
                      <div className="rounded-lg border border-blue-200 bg-white/80 px-3 py-2">
                        <div className="text-[10px] uppercase font-bold tracking-wider text-blue-500">Anchor trip</div>
                        <div className="mt-1 text-xs font-semibold text-blue-900">{anchorTripSummary}</div>
                      </div>
                      <div className="rounded-lg border border-blue-200 bg-white/80 px-3 py-2">
                        <div className="text-[10px] uppercase font-bold tracking-wider text-blue-500">Anchor block</div>
                        <div className="mt-1 text-xs font-semibold font-mono text-blue-900">{activeContext.referenceTrip.blockId}</div>
                      </div>
                    </div>
                  </div>
                </div>
                )}

                {!isEditMode && (
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase mb-2 flex items-center gap-2">
                    <GitBranch size={14} /> Bus / block
                  </label>
                  <div className="grid gap-2 sm:grid-cols-3">
                    {(['new', 'reference', 'existing'] as AddTripBlockMode[]).map(mode => (
                      <button
                        key={mode}
                        type="button"
                        onClick={() => setBlockMode(mode)}
                        className={`rounded-xl border px-3 py-2 text-sm font-bold transition-all ${blockMode === mode ? 'border-blue-300 bg-blue-50 text-blue-700' : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'}`}
                      >
                        {mode === 'new' ? 'Create new block' : mode === 'reference' ? 'Use same block' : 'Choose another block'}
                      </button>
                    ))}
                  </div>
                  {blockMode === 'existing' && (
                    <select
                      value={selectedBlockId}
                      onChange={(e) => setSelectedBlockId(e.target.value)}
                      className="mt-3 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm"
                    >
                      {suggestions.blockChoices.filter(choice => choice.mode === 'existing').map(choice => (
                        <option key={choice.blockId} value={choice.blockId}>{choice.label}</option>
                      ))}
                    </select>
                  )}
                  {hasBlockingBlockConflict && primaryBlockConflict && (
                    <div className="mt-3 rounded-xl border border-orange-200 bg-orange-50 p-3 text-xs text-orange-800 space-y-2">
                      <div className="flex items-start gap-2">
                        <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                        <div>
                          <div className="font-bold">Selected block already has overlapping work.</div>
                          <div className="mt-1">
                            Block <span className="font-mono">{primaryBlockConflict.conflictingBlockId}</span> already has{' '}
                            {primaryBlockConflict.conflictingDirection.toLowerCase()}bound service on{' '}
                            <span className="font-semibold">{primaryBlockConflict.conflictingRouteName}</span>{' '}
                            from {formatTimeOrDash(primaryBlockConflict.conflictingStartTime)} to {formatTimeOrDash(primaryBlockConflict.conflictingEndTime)}.
                          </div>
                          <div className="mt-1">
                            To avoid double-booking one bus, switch this {serviceMode === 'custom' ? 'custom pair' : 'full cycle'} to a new block or pick another existing block.
                          </div>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => setBlockMode('new')}
                          className="rounded-lg bg-orange-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-orange-700 transition-colors"
                        >
                          Use new block {suggestions.newBlockId}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
                )}

                {hasBidirectionalCycleOption && (
                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase mb-2">Trip type</label>
                    <div className="grid gap-2 sm:grid-cols-3">
                      <button
                        type="button"
                        onClick={() => setServiceMode('trip')}
                        aria-pressed={serviceMode === 'trip'}
                        className={`rounded-xl border px-3 py-3 text-left transition-all ${
                          serviceMode === 'trip'
                            ? 'border-blue-300 bg-blue-50 shadow-sm text-blue-700'
                            : 'border-gray-200 bg-white text-gray-800 hover:bg-gray-50'
                        }`}
                      >
                        <div className="text-sm font-bold">{SERVICE_MODE_COPY.trip.label}</div>
                        <div className="mt-1 text-xs text-gray-500">{SERVICE_MODE_COPY.trip.description}</div>
                      </button>
                      <button
                        type="button"
                        onClick={() => setServiceMode('custom')}
                        aria-pressed={serviceMode === 'custom'}
                        className={`rounded-xl border px-3 py-3 text-left transition-all ${
                          serviceMode === 'custom'
                            ? 'border-blue-300 bg-blue-50 shadow-sm text-blue-700'
                            : 'border-gray-200 bg-white text-gray-800 hover:bg-gray-50'
                        }`}
                      >
                        <div className="text-sm font-bold">{SERVICE_MODE_COPY.custom.label}</div>
                        <div className="mt-1 text-xs text-gray-500">{SERVICE_MODE_COPY.custom.description}</div>
                      </button>
                      <button
                        type="button"
                        onClick={() => setServiceMode('cycle')}
                        aria-pressed={serviceMode === 'cycle'}
                        className={`rounded-xl border px-3 py-3 text-left transition-all ${
                          serviceMode === 'cycle'
                            ? 'border-blue-300 bg-blue-50 shadow-sm text-blue-700'
                            : 'border-gray-200 bg-white text-gray-800 hover:bg-gray-50'
                        }`}
                      >
                        <div className="text-sm font-bold">{SERVICE_MODE_COPY.cycle.label}</div>
                        <div className="mt-1 text-xs text-gray-500">{SERVICE_MODE_COPY.cycle.description}</div>
                      </button>
                    </div>
                  </div>
                )}

                {!isEditMode && (
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase mb-2 flex items-center gap-2">
                    <Bus size={14} /> Direction
                  </label>
                  <div className="grid grid-cols-2 gap-2 max-w-sm">
                    {availableDirections.map(direction => (
                      <button
                        key={direction}
                        type="button"
                        onClick={() => handleDirectionChange(direction)}
                        disabled={cycleLocksNorthbound && direction !== 'North'}
                        className={`rounded-xl border px-3 py-2 text-sm font-bold transition-all ${
                          selectedDirection === direction
                            ? 'border-blue-300 bg-blue-50 text-blue-700'
                            : cycleLocksNorthbound && direction !== 'North'
                              ? 'border-gray-100 bg-gray-50 text-gray-300 cursor-not-allowed'
                              : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
                        }`}
                      >
                        {direction}bound
                      </button>
                    ))}
                  </div>
                  {cycleLocksNorthbound && (
                    <p className="mt-2 text-xs text-gray-500">
                      Full cycle always starts northbound, then returns southbound on the same block.
                    </p>
                  )}
                </div>
                )}

                {hasBidirectionalCycleOption && !isEditMode && (
                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase mb-2">Workflow summary</label>
                    <p className="mt-2 text-xs text-gray-500">
                      {serviceMode === 'cycle'
                        ? routeNumber === '400'
                          ? `Adds a full northbound-to-southbound Route 400 cycle starting at ${TimeUtils.fromMinutes(effectiveStartTime)} on the same block.`
                          : `Adds ${tripCount === 1 ? 'one northbound and one southbound trip' : `${actualTripCount} trips`} on the same block.`
                        : serviceMode === 'custom'
                          ? `Adds ${tripCount === 1 ? 'one paired trip' : `${tripCount} paired trips`} that starts ${selectedDirection.toLowerCase()}bound at ${suggestions.selectedStartStopName} and returns ${returnDirection.toLowerCase()}bound to ${suggestions.selectedEndStopName}.`
                        : 'Adds the selected number of trips, alternating directions on bidirectional routes.'}
                    </p>
                  </div>
                )}

                <div className={`grid gap-4 ${isEditMode ? '' : 'lg:grid-cols-[1fr_auto] lg:items-end'}`}>
                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase mb-2 flex items-center gap-2">
                      <Clock size={14} /> Start time
                    </label>
                    <input
                      type="text"
                      value={startTimeInput}
                      onChange={(e) => {
                        setStartTimeInput(e.target.value);
                        setStartPreset('manual');
                      }}
                      className={`w-full text-lg font-mono p-3 rounded-xl border-2 ${isValidTime ? 'border-blue-200 focus:border-blue-400' : 'border-red-300'} bg-white focus:ring-4 focus:ring-blue-50 outline-none transition-all`}
                      placeholder="10:25 AM"
                    />
                    {!isValidTime && startTimeInput && (
                      <p className="text-xs text-red-500 mt-1">Invalid time format. Use "HH:MM AM/PM".</p>
                    )}
                  </div>
                  {!isEditMode && (
                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase mb-2">
                      {SERVICE_MODE_COPY[serviceMode].countLabel}
                    </label>
                    <div className="flex items-center gap-3 rounded-xl border border-gray-200 bg-gray-50 px-3 py-3 min-w-[180px]">
                      <input
                        type="range"
                        min={1}
                        max={isPairedServiceMode ? 5 : 10}
                        value={tripCount}
                        onChange={(e) => setTripCount(Number(e.target.value))}
                        className="flex-1 accent-blue-600"
                        aria-label={SERVICE_MODE_COPY[serviceMode].countLabel}
                      />
                      <span className="text-2xl font-bold text-blue-600 w-8 text-center">{tripCount}</span>
                    </div>
                    {isPairedServiceMode && (
                      <p className="mt-2 text-xs text-gray-500">
                        {actualTripCount} total trips will be added.
                      </p>
                    )}
                  </div>
                  )}
                </div>

                {showAdvanced && (
                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase mb-2">Planner presets</label>
                    <div className="flex flex-wrap gap-2">
                      {presetOptions.map(option => (
                        <button
                          key={option.preset}
                          type="button"
                          onClick={() => handlePresetSelect(option.preset, option.startTime)}
                          className={`rounded-full px-3 py-1.5 text-xs font-bold transition-colors border ${startPreset === option.preset ? 'border-blue-300 bg-blue-50 text-blue-700' : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'}`}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase mb-2">Service pattern</label>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">
                        {serviceMode === 'custom' ? 'Start timepoint' : 'Start stop'}
                      </label>
                      <select
                        value={startStopName}
                        onChange={(e) => setStartStopName(e.target.value)}
                        disabled={cycleLocksNorthbound}
                        className={`w-full rounded-xl border px-3 py-2 text-sm ${cycleLocksNorthbound ? 'border-gray-100 bg-gray-50 text-gray-500 cursor-not-allowed' : 'border-gray-200 bg-white'}`}
                      >
                        {startStopOptions.map(stop => (
                          <option key={stop} value={stop}>{stop}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">
                        {serviceMode === 'custom' ? 'End timepoint' : 'End stop'}
                      </label>
                      <select
                        value={endStopName}
                        onChange={(e) => setEndStopName(e.target.value)}
                        disabled={cycleLocksNorthbound}
                        className={`w-full rounded-xl border px-3 py-2 text-sm ${cycleLocksNorthbound ? 'border-gray-100 bg-gray-50 text-gray-500 cursor-not-allowed' : 'border-gray-200 bg-white'}`}
                      >
                        {endStopOptions.map(stop => (
                          <option key={stop} value={stop}>{stop}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <p className="mt-2 text-xs text-gray-500">
                    {cycleLocksNorthbound
                      ? 'Full cycle uses the complete northbound trip and automatically reverses for the southbound return.'
                      : serviceMode === 'custom'
                        ? `Choose any timepoint from either direction. The planner maps your start to the outbound leg and your end to the return leg automatically.`
                      : isPartialTrip
                        ? `Short turn selected: ${suggestions.impact.partialLabel}`
                        : 'Full trip selected.'}
                  </p>
                </div>

              </section>

              <section className="rounded-xl border border-gray-200 bg-white">
                <button
                  type="button"
                  onClick={() => setShowAdvanced(value => !value)}
                  className="w-full flex items-center justify-between px-4 py-3 text-left"
                >
                  <div>
                    <div className="text-sm font-bold text-gray-800">Advanced planner controls</div>
                    <div className="text-xs text-gray-500">Presets, insertion context, operational checks, and planning metrics.</div>
                  </div>
                  {showAdvanced ? <ChevronUp size={18} className="text-gray-400" /> : <ChevronDown size={18} className="text-gray-400" />}
                </button>
              </section>

              {showAdvanced && (
                <>
              <section className="rounded-xl border border-emerald-100 bg-emerald-50 p-4 text-sm text-emerald-900">
                <div className="text-[10px] font-bold uppercase tracking-widest text-emerald-600">Planner impact</div>
                <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  <div>
                    <div className="text-[10px] uppercase font-bold text-emerald-600">Gap before</div>
                    <div className="font-semibold">{formatMaybeMinutes(suggestions.impact.gapBeforeMinutes)}</div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase font-bold text-emerald-600">Gap after</div>
                    <div className="font-semibold">{formatMaybeMinutes(suggestions.impact.gapAfterMinutes)}</div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase font-bold text-emerald-600">Target headway</div>
                    <div className="font-semibold">{formatMaybeMinutes(suggestions.impact.targetHeadwayMinutes)}</div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase font-bold text-emerald-600">Headway delta</div>
                    <div className="font-semibold">{formatMinuteDelta(suggestions.impact.headwayDeltaMinutes)}</div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase font-bold text-emerald-600">Template travel</div>
                    <div className="font-semibold">{formatMaybeMinutes(suggestions.impact.templateTravelTimeMinutes)}</div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase font-bold text-emerald-600">Template recovery</div>
                    <div className="font-semibold">{formatMaybeMinutes(suggestions.impact.templateRecoveryTimeMinutes)}</div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase font-bold text-emerald-600">Template cycle</div>
                    <div className="font-semibold">{formatMaybeMinutes(suggestions.impact.templateCycleTimeMinutes)}</div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase font-bold text-emerald-600">Cycle delta</div>
                    <div className="font-semibold">{formatMinuteDelta(suggestions.impact.cycleDeltaMinutes)}</div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase font-bold text-emerald-600">Peak buses</div>
                    <div className="font-semibold">{suggestions.impact.peakVehiclesBefore} → {suggestions.impact.peakVehiclesAfter} ({formatCountDelta(suggestions.impact.peakVehicleDelta, 'bus')})</div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase font-bold text-emerald-600">Blocks</div>
                    <div className="font-semibold">{suggestions.impact.blockCountBefore} → {suggestions.impact.blockCountAfter} ({formatCountDelta(suggestions.impact.blockCountDelta, 'block')})</div>
                  </div>
                  <div className="sm:col-span-2 xl:col-span-2">
                    <div className="text-[10px] uppercase font-bold text-emerald-600">Trip pattern</div>
                    <div className="font-semibold">{suggestions.impact.partialLabel}</div>
                  </div>
                </div>
              </section>
              <section className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-3 text-sm text-slate-800">
                <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Operational checks</div>
                <div className="space-y-2 text-xs">
                  <p>
                    <span className="font-semibold">Selected anchor:</span>{' '}
                    {primaryPreview ? `${primaryPreview.startStopName} at ${formatTimeOrDash(primaryPreview.startTime)}` : 'No preview yet'}
                  </p>
                  {primaryConnection ? (
                    <p>
                      <span className="font-semibold">Connection check:</span>{' '}
                      {primaryConnection.targetName} ({primaryConnection.targetTimeLabel})
                    </p>
                  ) : (
                    <p><span className="font-semibold">Connection check:</span> No nearby library targets found for the selected preview.</p>
                  )}
                  {suggestions.routePlatformHints.length > 0 ? (
                    <p>
                      <span className="font-semibold">Platform check:</span>{' '}
                      {suggestions.routePlatformHints.join(' · ')}
                    </p>
                  ) : (
                    <p><span className="font-semibold">Platform check:</span> No mapped hub/platform hints for the selected stop pattern.</p>
                  )}
                  <p>
                    <span className="font-semibold">Template source:</span>{' '}
                    {suggestions.templateTrip ? `Nearby ${selectedDirection.toLowerCase()}bound trip ${formatTimeOrDash(suggestions.templateTrip.startTime)}` : 'Reference trip fallback'}
                  </p>
                  {suggestions.impact.trailingBlockGapMinutes !== null && suggestions.impact.trailingBlockGapMinutes > 0 && (
                    <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-amber-800">
                      <p>
                        <span className="font-semibold">Block continuity:</span>{' '}
                        {suggestions.impact.trailingBlockGapMinutes} min idle gap before the next trip on this block at {formatTimeOrDash(suggestions.impact.trailingBlockGapNextTripStartTime)}.
                      </p>
                      {suggestions.impact.canAbsorbShortTrailingGap && (
                        <div className="mt-2 flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => setAbsorbShortTrailingGapIntoRecovery(value => !value)}
                            className={`rounded-lg px-3 py-1.5 text-xs font-bold transition-colors ${
                              suggestions.impact.absorbedTrailingGapIntoRecovery
                                ? 'bg-emerald-600 text-white hover:bg-emerald-700'
                                : 'bg-amber-600 text-white hover:bg-amber-700'
                            }`}
                          >
                            {suggestions.impact.absorbedTrailingGapIntoRecovery
                              ? `Absorbing ${suggestions.impact.trailingBlockGapMinutes} min into recovery`
                              : `Absorb ${suggestions.impact.trailingBlockGapMinutes} min into recovery`}
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                  {(hasAnyOverlap || hasBlockingBlockConflict) && (
                    <p className="rounded-lg border border-orange-200 bg-orange-50 px-3 py-2 text-orange-700">
                      <span className="font-semibold">Conflict check:</span>{' '}
                      {hasBlockingBlockConflict
                        ? 'This block assignment would double-book one bus. Resolve the block conflict before applying the change.'
                        : 'The preview includes overlapping service. Review the schedule layout before confirming.'}
                    </p>
                  )}
                </div>
              </section>
              </>
              )}
            </div>

            <div className="min-h-0 overflow-hidden">
              <AddTripSchedulePreview
                schedules={previewSchedules}
                initialRouteGroupName={previewRouteGroupName}
                initialDay={dayType}
                connectionLibrary={activeContext.connectionLibrary ?? null}
                highlightedTripId={highlightedPreviewTripId}
                onChooseInsertion={isEditMode ? undefined : handleChooseInsertion}
                selectedInsertionTripId={activeContext.anchorTripId ?? activeContext.referenceTrip.id}
                selectedInsertionPlacement={activeContext.insertionPlacement ?? 'after'}
              />
            </div>
          </div>
        </div>

        <div className="px-6 py-4 bg-gray-50 border-t border-gray-100 flex flex-wrap justify-between gap-3 items-center">
          <div className="text-xs text-gray-500">
            {suggestions.selectedStartStopName} → {suggestions.selectedEndStopName} · {(isEditMode ? activeContext.referenceTrip.direction : selectedDirection)}bound · {isEditMode ? 'editing current trip' : serviceMode === 'cycle' ? `${tripCount} full cycle${tripCount === 1 ? '' : 's'}` : serviceMode === 'custom' ? `${tripCount} custom pair${tripCount === 1 ? '' : 's'}` : `${tripCount} trip${tripCount === 1 ? '' : 's'}`} · {selectedTargetTable.routeName}
          </div>
          <div className="flex items-center gap-3">
            <button onClick={onCancel} className="px-4 py-2 text-sm font-bold text-gray-500 hover:bg-gray-100 rounded-lg transition-colors">
              Cancel
            </button>
            <button
              onClick={handleConfirm}
              disabled={!canConfirm}
              className="px-6 py-2 bg-blue-600 text-white text-sm font-bold rounded-xl shadow-lg shadow-blue-200 hover:bg-blue-700 hover:shadow-xl active:scale-95 transition-all flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Plus size={16} />
              {hasBlockingBlockConflict
                ? 'Resolve Block Conflict'
                : isEditMode
                  ? 'Update Trip'
                  : `Add ${tripCount} ${SERVICE_MODE_COPY[serviceMode].confirmLabel}${tripCount > 1 ? 's' : ''}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
