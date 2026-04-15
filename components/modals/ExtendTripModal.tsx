import React, { useMemo, useState } from 'react';
import { AlertTriangle, Calendar, ChevronDown, ChevronUp, MapPin, MoveHorizontal, Pencil, X } from 'lucide-react';
import { TimeUtils } from '../../utils/timeUtils';
import {
  buildExtendTripPreview,
  type ExtendTripModalContext,
  type ExtendTripMode,
  type ExtendTripResult
} from '../../utils/schedule/extendTripPlanner';
import { AddTripSchedulePreview } from './AddTripSchedulePreview';

interface Props {
  context: ExtendTripModalContext;
  onCancel: () => void;
  onConfirm: (result: ExtendTripResult, context: ExtendTripModalContext) => void;
}

const getDayTypeLabel = (routeName: string): 'Weekday' | 'Saturday' | 'Sunday' => {
  if (routeName.includes('(Saturday)')) return 'Saturday';
  if (routeName.includes('(Sunday)')) return 'Sunday';
  return 'Weekday';
};

const formatTime = (value: number): string => TimeUtils.fromMinutes(value);

const pluralize = (count: number, noun: string): string => `${count} ${noun}${count === 1 ? '' : 's'}`;

export const ExtendTripModal: React.FC<Props> = ({ context, onCancel, onConfirm }) => {
  const dayType = getDayTypeLabel(context.targetTable.routeName);
  const routeNumber = context.routeBaseName.split(' ')[0] || context.routeBaseName;
  const canExtendEarlier = context.currentStartIndex > 0;
  const canExtendLater = context.currentEndIndex < context.targetTable.stops.length - 1;
  const defaultMode: ExtendTripMode = canExtendLater ? 'later' : 'earlier';
  const [mode, setMode] = useState<ExtendTripMode>(defaultMode);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const earlierStops = useMemo(
    () => context.targetTable.stops.slice(0, context.currentStartIndex),
    [context.currentStartIndex, context.targetTable.stops]
  );
  const laterStops = useMemo(
    () => context.targetTable.stops.slice(context.currentEndIndex + 1),
    [context.currentEndIndex, context.targetTable.stops]
  );

  const defaultStopName = mode === 'earlier'
    ? earlierStops[earlierStops.length - 1] ?? context.targetTable.stops[context.currentStartIndex]
    : laterStops[0] ?? context.targetTable.stops[context.currentEndIndex];
  const [selectedStopName, setSelectedStopName] = useState(defaultStopName);

  React.useEffect(() => {
    const nextDefaultStopName = mode === 'earlier'
      ? earlierStops[earlierStops.length - 1] ?? context.targetTable.stops[context.currentStartIndex]
      : laterStops[0] ?? context.targetTable.stops[context.currentEndIndex];
    setSelectedStopName(nextDefaultStopName);
  }, [context.currentEndIndex, context.currentStartIndex, context.targetTable.stops, earlierStops, laterStops, mode]);

  const preview = useMemo(
    () => buildExtendTripPreview(context, { mode, stopName: selectedStopName }),
    [context, mode, selectedStopName]
  );

  const currentStartStopName = context.targetTable.stops[context.currentStartIndex] ?? '';
  const currentEndStopName = context.targetTable.stops[context.currentEndIndex] ?? '';
  const plannerSummary = mode === 'earlier'
    ? `Bring this ${context.trip.direction.toLowerCase()}bound trip earlier from ${currentStartStopName} back to ${selectedStopName}.`
    : `Extend this ${context.trip.direction.toLowerCase()}bound trip later from ${currentEndStopName} through ${selectedStopName}.`;
  const canConfirm = !!selectedStopName && !preview.blockConflict;
  const updatedStartStopName = context.targetTable.stops[preview.updatedTrip.startStopIndex ?? context.currentStartIndex] ?? currentStartStopName;
  const updatedEndStopName = context.targetTable.stops[preview.updatedTrip.endStopIndex ?? context.currentEndIndex] ?? currentEndStopName;
  const addedStopCount = mode === 'earlier'
    ? Math.max(0, context.currentStartIndex - (preview.updatedTrip.startStopIndex ?? context.currentStartIndex))
    : Math.max(0, (preview.updatedTrip.endStopIndex ?? context.currentEndIndex) - context.currentEndIndex);
  const addedStopLabel = `${pluralize(addedStopCount, 'stop')} ${mode === 'earlier' ? 'upstream' : 'downstream'}`;

  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="bg-white w-[min(1850px,98vw)] h-[92vh] rounded-2xl shadow-2xl overflow-hidden border border-blue-100 flex flex-col">
        <div className="px-6 py-4 bg-blue-50 border-b border-blue-100 flex justify-between items-center">
          <div>
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <h3 className="text-lg font-extrabold text-blue-900 flex items-center gap-2">
                <Pencil size={20} className="text-blue-600" />
                Extend Trip
              </h3>
              <span className="bg-blue-600 text-white text-[10px] font-bold px-2 py-0.5 rounded-md">Route {routeNumber}</span>
              <span className="bg-gray-200 text-gray-700 text-[10px] font-bold px-2 py-0.5 rounded-md flex items-center gap-1">
                <Calendar size={10} />
                {dayType}
              </span>
              <span className="bg-emerald-100 text-emerald-700 text-[10px] font-bold px-2 py-0.5 rounded-md">
                {context.trip.direction}bound
              </span>
            </div>
            <p className="text-xs font-bold text-blue-500">
              Editing block <span className="font-mono text-blue-700">{context.trip.blockId}</span> · trip {formatTime(context.trip.startTime)} → {formatTime(context.trip.endTime)}
            </p>
          </div>
          <button
            onClick={onCancel}
            className="p-1 rounded-full text-blue-300 hover:bg-blue-100 hover:text-blue-600 transition-colors"
            aria-label="Close extend trip modal"
          >
            <X size={20} />
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-hidden p-4 md:p-6">
          <div className="grid h-full min-h-0 gap-4 xl:grid-cols-[360px_minmax(0,1fr)]">
            <div className="min-h-0 overflow-auto pr-1 space-y-4">
              <section className="bg-white rounded-xl border border-blue-100 p-4 space-y-4">
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Planned change</div>
                  <p className="mt-2 text-sm font-semibold leading-6 text-slate-800">{plannerSummary}</p>
                  <div className="mt-3 grid gap-2 sm:grid-cols-3">
                    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                      <div className="text-[10px] uppercase font-bold tracking-wider text-slate-500">Current span</div>
                      <div className="mt-1 text-xs font-semibold text-slate-900">{currentStartStopName} → {currentEndStopName}</div>
                    </div>
                    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                      <div className="text-[10px] uppercase font-bold tracking-wider text-slate-500">Result if applied</div>
                      <div className="mt-1 text-xs font-semibold text-slate-900">{updatedStartStopName} → {updatedEndStopName}</div>
                      <div className="mt-1 text-[11px] text-slate-500">{formatTime(preview.updatedTrip.startTime)} → {formatTime(preview.updatedTrip.endTime)}</div>
                    </div>
                    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                      <div className="text-[10px] uppercase font-bold tracking-wider text-slate-500">Stops added</div>
                      <div className="mt-1 text-xs font-semibold text-slate-900">{addedStopLabel}</div>
                    </div>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase mb-2">Extend trip</label>
                  <div className="grid gap-2">
                    <button
                      type="button"
                      disabled={!canExtendEarlier}
                      onClick={() => setMode('earlier')}
                      className={`rounded-xl border px-3 py-3 text-left transition-all ${
                        mode === 'earlier'
                          ? 'border-blue-300 bg-blue-50 shadow-sm text-blue-700'
                          : canExtendEarlier
                            ? 'border-gray-200 bg-white text-gray-800 hover:bg-gray-50'
                            : 'border-gray-100 bg-gray-50 text-gray-400 cursor-not-allowed'
                      }`}
                    >
                      <div className="text-sm font-bold">Bring earlier</div>
                      <div className="mt-1 text-xs text-gray-500">Add the missing upstream stops before the current trip start.</div>
                    </button>
                    <button
                      type="button"
                      disabled={!canExtendLater}
                      onClick={() => setMode('later')}
                      className={`rounded-xl border px-3 py-3 text-left transition-all ${
                        mode === 'later'
                          ? 'border-blue-300 bg-blue-50 shadow-sm text-blue-700'
                          : canExtendLater
                            ? 'border-gray-200 bg-white text-gray-800 hover:bg-gray-50'
                            : 'border-gray-100 bg-gray-50 text-gray-400 cursor-not-allowed'
                      }`}
                    >
                      <div className="text-sm font-bold">Extend later</div>
                      <div className="mt-1 text-xs text-gray-500">Carry the same trip through the missing downstream stops.</div>
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase mb-2 flex items-center gap-2">
                    <MapPin size={14} /> {mode === 'earlier' ? 'New start stop' : 'New end stop'}
                  </label>
                  <select
                    value={selectedStopName}
                    onChange={(event) => setSelectedStopName(event.target.value)}
                    className="w-full rounded-xl border border-gray-200 bg-white px-3 py-3 text-sm"
                  >
                    {(mode === 'earlier' ? earlierStops : laterStops).map(stopName => (
                      <option key={stopName} value={stopName}>{stopName}</option>
                    ))}
                  </select>
                  <p className="mt-2 text-xs text-gray-500">
                    Current trip: {currentStartStopName} → {currentEndStopName}
                  </p>
                </div>

                {preview.blockConflict && (
                  <div className="rounded-xl border border-orange-200 bg-orange-50 p-3 text-xs text-orange-800 space-y-2">
                    <div className="flex items-start gap-2">
                      <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                      <div>
                        <div className="font-bold">This extension would overlap other work on the same block.</div>
                        <div className="mt-1">
                          Block <span className="font-mono">{preview.blockConflict.blockId}</span> already has service on{' '}
                          <span className="font-semibold">{preview.blockConflict.routeName}</span> from{' '}
                          {formatTime(preview.blockConflict.startTime)} to {formatTime(preview.blockConflict.endTime)}.
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </section>

              <section className="rounded-xl border border-gray-200 bg-white">
                <button
                  type="button"
                  onClick={() => setShowAdvanced(value => !value)}
                  className="w-full flex items-center justify-between px-4 py-3 text-left"
                >
                  <div>
                    <div className="text-sm font-bold text-gray-800">Advanced trip details</div>
                    <div className="text-xs text-gray-500">Current range, proposed range, and template source.</div>
                  </div>
                  {showAdvanced ? <ChevronUp size={18} className="text-gray-400" /> : <ChevronDown size={18} className="text-gray-400" />}
                </button>
              </section>

              {showAdvanced && (
                <section className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-3 text-sm text-slate-800">
                  <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Extension details</div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <div className="text-[10px] uppercase font-bold text-slate-500">Current span</div>
                      <div className="font-semibold">{currentStartStopName} → {currentEndStopName}</div>
                    </div>
                    <div>
                      <div className="text-[10px] uppercase font-bold text-slate-500">Proposed span</div>
                      <div className="font-semibold">
                        {preview.updatedTrip.startStopIndex ?? 0} / {preview.updatedTrip.endStopIndex ?? (context.targetTable.stops.length - 1)}
                        <span className="ml-2 text-slate-500">
                          ({context.targetTable.stops[preview.updatedTrip.startStopIndex ?? 0]} → {context.targetTable.stops[preview.updatedTrip.endStopIndex ?? (context.targetTable.stops.length - 1)]})
                        </span>
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] uppercase font-bold text-slate-500">Updated trip window</div>
                      <div className="font-semibold">{formatTime(preview.updatedTrip.startTime)} → {formatTime(preview.updatedTrip.endTime)}</div>
                    </div>
                    <div>
                      <div className="text-[10px] uppercase font-bold text-slate-500">Template source</div>
                      <div className="font-semibold font-mono">{context.templateTrip?.id ?? context.trip.id}</div>
                    </div>
                  </div>
                </section>
              )}
            </div>

            <div className="min-h-0 overflow-hidden">
              <AddTripSchedulePreview
                schedules={preview.schedules}
                initialRouteGroupName={context.routeBaseName.replace(/\s*\((Weekday|Saturday|Sunday)\)/gi, '').trim()}
                initialDay={dayType}
                highlightedTripId={context.trip.id}
              />
            </div>
          </div>
        </div>

        <div className="px-6 py-4 bg-gray-50 border-t border-gray-100 flex flex-wrap justify-between gap-3 items-center">
          <div className="text-xs text-gray-500 flex items-center gap-2">
            <MoveHorizontal size={14} />
            {mode === 'earlier' ? `Bring trip earlier to ${selectedStopName}` : `Extend trip later to ${selectedStopName}`}
          </div>
          <div className="flex items-center gap-3">
            <button onClick={onCancel} className="px-4 py-2 text-sm font-bold text-gray-500 hover:bg-gray-100 rounded-lg transition-colors">
              Cancel
            </button>
            <button
              onClick={() => onConfirm({ mode, stopName: selectedStopName }, context)}
              disabled={!canConfirm}
              className="px-6 py-2 bg-blue-600 text-white text-sm font-bold rounded-xl shadow-lg shadow-blue-200 hover:bg-blue-700 hover:shadow-xl active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Apply extension
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
