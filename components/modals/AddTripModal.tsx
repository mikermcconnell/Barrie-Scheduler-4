import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Bus, Calendar, Clock, Eye, GitBranch, MapPin, Plus, X } from 'lucide-react';
import { TimeUtils } from '../../utils/timeUtils';
import {
  buildAddTripPresets,
  buildAddTripSuggestions,
  type AddTripBlockMode,
  type AddTripModalContext,
  type AddTripResult,
  type AddTripStartPreset
} from '../../utils/schedule/addTripPlanner';

export type { AddTripModalContext, AddTripResult, AddTripBlockMode, AddTripStartPreset } from '../../utils/schedule/addTripPlanner';

interface Props {
  context: AddTripModalContext;
  onCancel: () => void;
  onConfirm: (result: AddTripResult) => void;
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

const getDayTypeLabel = (routeName: string): 'Weekday' | 'Saturday' | 'Sunday' => {
  if (routeName.includes('(Saturday)')) return 'Saturday';
  if (routeName.includes('(Sunday)')) return 'Sunday';
  return 'Weekday';
};

const getDefaultDirection = (context: AddTripModalContext, availableDirections: Array<'North' | 'South'>): 'North' | 'South' => {
  if (availableDirections.includes(context.referenceTrip.direction)) return context.referenceTrip.direction;
  return availableDirections[0] ?? 'North';
};

export const AddTripModal: React.FC<Props> = ({ context, onCancel, onConfirm }) => {
  const routeNumber = context.routeBaseName.split(' ')[0] || context.routeBaseName;
  const dayType = getDayTypeLabel(context.targetTable.routeName);

  const availableDirections = useMemo<Array<'North' | 'South'>>(() => {
    const directions: Array<'North' | 'South'> = [];
    const hasNorth = context.allSchedules.some(table => table.routeName === `${context.routeBaseName} (North)`);
    const hasSouth = context.allSchedules.some(table => table.routeName === `${context.routeBaseName} (South)`);

    if (hasNorth || context.targetTable.routeName.includes('(North)') || context.referenceTrip.direction === 'North') {
      directions.push('North');
    }
    if (hasSouth || context.targetTable.routeName.includes('(South)') || context.referenceTrip.direction === 'South') {
      directions.push('South');
    }

    return directions.length > 0 ? directions : [context.referenceTrip.direction ?? 'North'];
  }, [context.allSchedules, context.referenceTrip.direction, context.routeBaseName, context.targetTable.routeName]);

  const initialDirection = getDefaultDirection(context, availableDirections);
  const initialPresetOptions = useMemo(
    () => buildAddTripPresets(context, initialDirection, context.referenceTrip.startTime),
    [context, initialDirection]
  );
  const initialStartTime = initialPresetOptions.find(option => option.preset === 'midpoint')?.startTime ?? context.referenceTrip.startTime;
  const initialSuggestions = useMemo(
    () => buildAddTripSuggestions(
      context,
      initialDirection,
      initialStartTime,
      1,
      'new',
      '',
      {
        startStopName: context.targetTable.stops[0] ?? '',
        endStopName: context.targetTable.stops[context.targetTable.stops.length - 1] ?? ''
      }
    ),
    [context, initialDirection, initialStartTime]
  );

  const [selectedDirection, setSelectedDirection] = useState<'North' | 'South'>(initialDirection);
  const [startPreset, setStartPreset] = useState<AddTripStartPreset>('midpoint');
  const [startTimeInput, setStartTimeInput] = useState(TimeUtils.fromMinutes(initialStartTime));
  const [tripCount, setTripCount] = useState(1);
  const [blockMode, setBlockMode] = useState<AddTripBlockMode>('new');
  const [selectedBlockId, setSelectedBlockId] = useState(initialSuggestions.newBlockId);
  const [startStopName, setStartStopName] = useState(initialSuggestions.selectedStartStopName);
  const [endStopName, setEndStopName] = useState(initialSuggestions.selectedEndStopName);

  const parsedStartTime = TimeUtils.toMinutes(startTimeInput);
  const effectiveStartTime = parsedStartTime ?? initialStartTime;

  const suggestions = useMemo(
    () => buildAddTripSuggestions(
      context,
      selectedDirection,
      effectiveStartTime,
      tripCount,
      blockMode,
      selectedBlockId,
      { startStopName, endStopName }
    ),
    [context, selectedDirection, effectiveStartTime, tripCount, blockMode, selectedBlockId, startStopName, endStopName]
  );

  const presetOptions = useMemo(
    () => buildAddTripPresets(context, selectedDirection, effectiveStartTime),
    [context, selectedDirection, effectiveStartTime]
  );

  const selectedTargetTable = suggestions.selectedTargetTable;
  const isValidTime = parsedStartTime !== null;
  const hasAnyOverlap = suggestions.previewItems.some(item => item.hasOverlap);
  const isPartialTrip = suggestions.impact.isPartial;

  const startStopOptions = useMemo(() => {
    const endIndex = Math.max(selectedTargetTable.stops.indexOf(endStopName), 0);
    return selectedTargetTable.stops.filter((_, index) => index <= endIndex);
  }, [selectedTargetTable.stops, endStopName]);

  const endStopOptions = useMemo(() => {
    const startIndex = Math.max(selectedTargetTable.stops.indexOf(startStopName), 0);
    return selectedTargetTable.stops.filter((_, index) => index >= startIndex);
  }, [selectedTargetTable.stops, startStopName]);

  useEffect(() => {
    setSelectedDirection(initialDirection);
  }, [initialDirection]);

  useEffect(() => {
    const nextBlockId = blockMode === 'new'
      ? suggestions.newBlockId
      : blockMode === 'reference'
        ? context.referenceTrip.blockId
        : (suggestions.blockChoices.find(choice => choice.mode === 'existing')?.blockId ?? suggestions.newBlockId);
    setSelectedBlockId(nextBlockId);
  }, [blockMode, context.referenceTrip.blockId, suggestions.blockChoices, suggestions.newBlockId]);

  useEffect(() => {
    const presetTime = presetOptions.find(option => option.preset === startPreset)?.startTime;
    if (typeof presetTime === 'number') {
      setStartTimeInput(TimeUtils.fromMinutes(presetTime));
    }
  }, [presetOptions, startPreset]);

  useEffect(() => {
    setStartStopName(suggestions.selectedStartStopName);
    setEndStopName(suggestions.selectedEndStopName);
  }, [suggestions.selectedStartStopName, suggestions.selectedEndStopName]);

  const handlePresetSelect = (preset: AddTripStartPreset, startTime: number | null) => {
    setStartPreset(preset);
    if (typeof startTime === 'number') {
      setStartTimeInput(TimeUtils.fromMinutes(startTime));
    }
  };

  const handleDirectionChange = (direction: 'North' | 'South') => {
    setSelectedDirection(direction);
    const midpoint = buildAddTripPresets(context, direction, effectiveStartTime).find(option => option.preset === 'midpoint')?.startTime;
    if (typeof midpoint === 'number') {
      setStartTimeInput(TimeUtils.fromMinutes(midpoint));
    }
    setStartPreset('midpoint');
  };

  const handleConfirm = () => {
    if (parsedStartTime === null) return;

    onConfirm({
      startTime: parsedStartTime,
      tripCount,
      blockMode,
      blockId: blockMode === 'new' ? suggestions.newBlockId : selectedBlockId,
      targetDirection: selectedDirection,
      targetRouteName: selectedTargetTable.routeName,
      startStopName,
      endStopName
    });
  };

  const primaryConnection = suggestions.selectedConnections[0] ?? null;
  const primaryPreview = suggestions.previewItems[0] ?? null;

  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="bg-white w-full max-w-6xl max-h-[92vh] rounded-2xl shadow-2xl overflow-hidden border border-blue-100 flex flex-col">
        <div className="px-6 py-4 bg-blue-50 border-b border-blue-100 flex justify-between items-center">
          <div>
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <h3 className="text-lg font-extrabold text-blue-900 flex items-center gap-2">
                <Plus size={20} className="text-blue-600" />
                Add Service
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
              {blockMode === 'new'
                ? <>Creating new block <span className="font-mono text-blue-700">{suggestions.newBlockId}</span></>
                : blockMode === 'reference'
                  ? <>Continuing reference block <span className="font-mono text-blue-700">{context.referenceTrip.blockId}</span></>
                  : <>Using existing block <span className="font-mono text-blue-700">{selectedBlockId || '-'}</span></>}
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

        <div className="flex-1 min-h-0 overflow-auto p-6 space-y-6">
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
                <div className="font-semibold font-mono">{suggestions.templateTrip?.blockId ?? context.referenceTrip.blockId}</div>
              </div>
              <div>
                <div className="text-[10px] uppercase font-bold text-gray-400">Selected side</div>
                <div className="font-semibold">{selectedTargetTable.routeName}</div>
              </div>
            </div>
          </section>

          <div className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
            <div className="space-y-4">
              <section className="bg-white rounded-xl border border-blue-100 p-4 space-y-4">
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
                        className={`rounded-xl border px-3 py-2 text-sm font-bold transition-all ${selectedDirection === direction ? 'border-blue-300 bg-blue-50 text-blue-700' : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'}`}
                      >
                        {direction}bound
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid gap-4 lg:grid-cols-[1fr_auto] lg:items-end">
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
                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase mb-2">Trips to add</label>
                    <div className="flex items-center gap-3 rounded-xl border border-gray-200 bg-gray-50 px-3 py-3 min-w-[180px]">
                      <input
                        type="range"
                        min={1}
                        max={10}
                        value={tripCount}
                        onChange={(e) => setTripCount(Number(e.target.value))}
                        className="flex-1 accent-blue-600"
                        aria-label="Number of trips to add"
                      />
                      <span className="text-2xl font-bold text-blue-600 w-8 text-center">{tripCount}</span>
                    </div>
                  </div>
                </div>

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

                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase mb-2">Service pattern</label>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Start stop</label>
                      <select
                        value={startStopName}
                        onChange={(e) => setStartStopName(e.target.value)}
                        className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm"
                      >
                        {startStopOptions.map(stop => (
                          <option key={stop} value={stop}>{stop}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">End stop</label>
                      <select
                        value={endStopName}
                        onChange={(e) => setEndStopName(e.target.value)}
                        className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm"
                      >
                        {endStopOptions.map(stop => (
                          <option key={stop} value={stop}>{stop}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <p className="mt-2 text-xs text-gray-500">
                    {isPartialTrip ? `Short turn selected: ${suggestions.impact.partialLabel}` : 'Full trip selected.'}
                  </p>
                </div>

                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase mb-2 flex items-center gap-2">
                    <GitBranch size={14} /> Block assignment
                  </label>
                  <div className="grid gap-2 sm:grid-cols-3">
                    {(['new', 'reference', 'existing'] as AddTripBlockMode[]).map(mode => (
                      <button
                        key={mode}
                        type="button"
                        onClick={() => setBlockMode(mode)}
                        className={`rounded-xl border px-3 py-2 text-sm font-bold transition-all ${blockMode === mode ? 'border-blue-300 bg-blue-50 text-blue-700' : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'}`}
                      >
                        {mode === 'new' ? 'New block' : mode === 'reference' ? 'Reference block' : 'Existing block'}
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
                </div>
              </section>

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
            </div>

            <div className="space-y-4">
              <section className="rounded-xl border border-gray-200 bg-white p-4 space-y-3">
                <div className="flex items-center gap-2 text-sm font-bold text-gray-700">
                  <Eye size={14} /> Preview
                  {hasAnyOverlap && (
                    <span className="text-orange-600 flex items-center gap-1">
                      <AlertTriangle size={12} /> Overlap detected
                    </span>
                  )}
                </div>

                <div className={`rounded-xl border divide-y max-h-[340px] overflow-auto ${hasAnyOverlap ? 'bg-orange-50/50 border-orange-200 divide-orange-100' : 'bg-blue-50/50 border-blue-100 divide-blue-100'}`}>
                  {suggestions.previewItems.length > 0 ? suggestions.previewItems.map(item => (
                    <div key={`${item.index}-${item.direction}-${item.startTime}`} className={`p-3 ${item.hasOverlap ? 'bg-orange-100/50' : ''}`}>
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={`text-xs font-bold ${item.hasOverlap ? 'text-orange-600' : 'text-blue-500'}`}>Trip {item.index}</span>
                          <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${item.direction === 'North' ? 'bg-blue-100 text-blue-700' : 'bg-indigo-100 text-indigo-700'}`}>{item.direction}</span>
                          <span className="text-[10px] font-mono text-gray-500">{item.blockId}</span>
                        </div>
                        <div className={`font-mono text-sm ${item.hasOverlap ? 'text-orange-700' : 'text-gray-700'}`}>
                          {formatTimeOrDash(item.startTime)} → {formatTimeOrDash(item.endTime)}
                        </div>
                      </div>
                      <div className="mt-1 text-xs text-gray-600 flex flex-wrap gap-3">
                        <span>{item.startStopName} → {item.endStopName}</span>
                        <span>Gap before: {formatMaybeMinutes(item.gapBeforeMinutes)}</span>
                        <span>Gap after: {formatMaybeMinutes(item.gapAfterMinutes)}</span>
                      </div>
                      {item.connectionMatches.length > 0 && (
                        <div className="mt-2 text-xs text-emerald-700">
                          Connection check: {item.connectionMatches.map(match => match.targetName).join(' · ')}
                        </div>
                      )}
                      {item.platformLabel && (
                        <div className="mt-1 text-xs text-sky-700">Local platform hint: {item.platformLabel}</div>
                      )}
                    </div>
                  )) : (
                    <div className="p-4 text-center text-gray-400 text-sm">Enter a valid start time to see the preview.</div>
                  )}
                </div>

                {hasAnyOverlap && (
                  <div className="p-2 bg-orange-100 border border-orange-200 rounded-lg text-xs text-orange-700 flex items-center gap-2">
                    <AlertTriangle size={14} />
                    Some preview trips overlap existing service or other preview trips in the same direction.
                  </div>
                )}
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
                </div>
              </section>
            </div>
          </div>
        </div>

        <div className="px-6 py-4 bg-gray-50 border-t border-gray-100 flex flex-wrap justify-between gap-3 items-center">
          <div className="text-xs text-gray-500">
            {suggestions.selectedStartStopName} → {suggestions.selectedEndStopName} · {selectedDirection}bound · {selectedTargetTable.routeName}
          </div>
          <div className="flex items-center gap-3">
            <button onClick={onCancel} className="px-4 py-2 text-sm font-bold text-gray-500 hover:bg-gray-100 rounded-lg transition-colors">
              Cancel
            </button>
            <button
              onClick={handleConfirm}
              disabled={!isValidTime}
              className="px-6 py-2 bg-blue-600 text-white text-sm font-bold rounded-xl shadow-lg shadow-blue-200 hover:bg-blue-700 hover:shadow-xl active:scale-95 transition-all flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Plus size={16} />
              Add {tripCount} Trip{tripCount > 1 ? 's' : ''}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
