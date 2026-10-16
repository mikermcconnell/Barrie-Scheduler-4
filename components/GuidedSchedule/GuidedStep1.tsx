import React, { useEffect, useState } from 'react';
import { AlertTriangle, Check, Loader2 } from 'lucide-react';
import { getContrastingTextColor, getRouteColor } from '../../utils/config/routeColors';
import { GUIDED_DAY_TYPES, type DayTypeReadiness } from './guidedSelection';
import type { GuidedPerformanceSource } from './useGuidedPerformanceSource';
import type { GuidedDateRange } from './runtimeReview/guidedRuntimeReviewTypes';

const PRESETS: { label: string; days: number }[] = [
    { label: 'Past week', days: 7 },
    { label: 'Past month', days: 30 },
    { label: 'Past 3 months', days: 90 },
];

const shiftIsoDate = (isoDate: string, days: number): string => {
    const date = new Date(`${isoDate}T12:00:00`);
    date.setDate(date.getDate() + days);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};

/** A range ending on the latest available day, clamped to the available history. */
export const buildPresetRange = (available: GuidedDateRange, days: number): GuidedDateRange => {
    const start = shiftIsoDate(available.end, -(days - 1));
    return { start: start < available.start ? available.start : start, end: available.end };
};

const pillClass = (active: boolean): string => (
    `rounded-full border px-3 py-1 text-xs font-semibold ${active ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'}`
);

const readinessLabel = (entry: DayTypeReadiness): string => {
    if (entry.status === 'no-data') return 'No data';
    if (entry.status === 'coarse-only') return 'Re-import needed';
    return `${entry.stopLevelDayCount} day${entry.stopLevelDayCount === 1 ? '' : 's'}`;
};

interface GuidedStep1Props {
    source: GuidedPerformanceSource;
}

export const GuidedStep1: React.FC<GuidedStep1Props> = ({ source }) => {
    const { selection, readiness, availableDateRange } = source;
    const range = selection.dateRange;
    const isPreset = (days: number) => !!range && !!availableDateRange
        && JSON.stringify(range) === JSON.stringify(buildPresetRange(availableDateRange, days));
    const [customRange, setCustomRange] = useState<GuidedDateRange>({ start: '', end: '' });
    useEffect(() => {
        if (availableDateRange && !customRange.start && !customRange.end) setCustomRange(availableDateRange);
    }, [availableDateRange, customRange.end, customRange.start]);
    const customRangeValid = !!customRange.start && !!customRange.end && customRange.start <= customRange.end;
    const isCustomApplied = !!range && range.start === customRange.start && range.end === customRange.end;

    return (
        <div className="mx-auto max-w-5xl space-y-5">
            <div>
                <h2 className="text-lg font-bold text-gray-900">Select data</h2>
                <p className="text-sm text-gray-500">Pick a route, choose the window of observed STREETS data, then choose which day types to build.</p>
            </div>

            <section aria-labelledby="guided-route-heading">
                <h3 id="guided-route-heading" className="mb-2 text-xs font-bold uppercase tracking-wide text-gray-500">Route</h3>
                {source.metadataLoading && (
                    <div className="flex items-center gap-2 text-sm text-gray-500"><Loader2 size={14} className="animate-spin" /> Loading routes…</div>
                )}
                {source.metadataError && (
                    <div className="flex items-center gap-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                        Could not load the route list: {source.metadataError}
                        <button type="button" onClick={source.retryMetadata} className="font-bold underline">Retry</button>
                    </div>
                )}
                {!source.metadataLoading && !source.metadataError && source.routeIds.length === 0 && (
                    <p className="text-sm text-gray-500">No STREETS performance data has been imported yet.</p>
                )}
                <div className="grid grid-cols-4 gap-2 sm:grid-cols-6 lg:grid-cols-8" role="group" aria-label="Routes">
                    {source.routeIds.map(routeId => {
                        const selected = selection.routeId === routeId;
                        const dimmed = !!selection.routeId && !selected;
                        const color = getRouteColor(routeId);
                        return (
                            <button
                                key={routeId}
                                type="button"
                                aria-pressed={selected}
                                onClick={() => source.selectRoute(routeId)}
                                style={{
                                    backgroundColor: color,
                                    color: getContrastingTextColor(color),
                                    boxShadow: selected ? `0 0 0 2px #fff, 0 0 0 4px ${color}` : undefined,
                                }}
                                className={`flex items-center justify-center gap-1 rounded-lg px-2 py-2.5 text-base font-bold transition hover:brightness-110 ${
                                    dimmed ? 'opacity-50 hover:opacity-90' : ''
                                } ${selected ? 'shadow-md' : ''}`}
                            >
                                {selected && <Check size={14} strokeWidth={3} />}
                                {routeId}
                            </button>
                        );
                    })}
                </div>
            </section>

            {selection.routeId && (
                <section aria-labelledby="guided-range-heading">
                    <h3 id="guided-range-heading" className="mb-2 text-xs font-bold uppercase tracking-wide text-gray-500">Time frame</h3>
                    {!selection.timeFrameSet && (
                        <p className="mb-2 text-xs text-gray-500">Choose a time frame. Only the data for that window is loaded.</p>
                    )}
                    <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Time frame">
                        {availableDateRange && PRESETS.map(preset => (
                            <button
                                key={preset.label}
                                type="button"
                                aria-pressed={isPreset(preset.days)}
                                onClick={() => source.setTimeFrame(buildPresetRange(availableDateRange, preset.days))}
                                className={pillClass(isPreset(preset.days))}
                            >
                                {preset.label}
                            </button>
                        ))}
                        <button
                            type="button"
                            aria-pressed={selection.timeFrameSet && !range}
                            onClick={() => source.setTimeFrame(null)}
                            className={pillClass(selection.timeFrameSet && !range)}
                        >
                            All data
                        </button>
                        {availableDateRange && (
                            <span className="flex flex-wrap items-center gap-1 text-xs text-gray-600">
                                <span className="ml-1">or</span>
                                <input
                                    type="date"
                                    aria-label="Start date"
                                    className="rounded border border-gray-300 px-2 py-1"
                                    min={availableDateRange.start}
                                    max={availableDateRange.end}
                                    value={customRange.start}
                                    onChange={event => setCustomRange(current => ({ ...current, start: event.target.value }))}
                                />
                                to
                                <input
                                    type="date"
                                    aria-label="End date"
                                    className="rounded border border-gray-300 px-2 py-1"
                                    min={availableDateRange.start}
                                    max={availableDateRange.end}
                                    value={customRange.end}
                                    onChange={event => setCustomRange(current => ({ ...current, end: event.target.value }))}
                                />
                                <button
                                    type="button"
                                    disabled={!customRangeValid || isCustomApplied}
                                    onClick={() => source.setTimeFrame({ ...customRange })}
                                    className="rounded-full border border-gray-900 px-3 py-1 font-semibold text-gray-900 hover:bg-gray-50 disabled:cursor-not-allowed disabled:border-gray-300 disabled:text-gray-400"
                                >
                                    Apply
                                </button>
                            </span>
                        )}
                    </div>
                    {availableDateRange && (
                        <p className="mt-2 text-xs text-gray-500">
                            Clean history available {availableDateRange.start} to {availableDateRange.end}.
                            {source.historyStatus ? ` Loaded ${source.historyStatus.cleanDays} clean day${source.historyStatus.cleanDays === 1 ? '' : 's'}.` : ''}
                        </p>
                    )}
                </section>
            )}

            {selection.routeId && selection.timeFrameSet && (
                <section aria-labelledby="guided-daytype-heading">
                    <h3 id="guided-daytype-heading" className="mb-2 text-xs font-bold uppercase tracking-wide text-gray-500">
                        Day types · Route {selection.routeId}
                    </h3>
                    {source.dataError && (
                        <div className="mb-2 flex items-center gap-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                            Could not load Route {selection.routeId} data: {source.dataError}
                            <button type="button" onClick={source.retryData} className="font-bold underline">Retry</button>
                        </div>
                    )}
                    <div className="flex flex-wrap gap-2" role="group" aria-label="Day types">
                        {GUIDED_DAY_TYPES.map(dayType => {
                            const entry = readiness.find(item => item.dayType === dayType);
                            const selected = selection.dayTypes.includes(dayType);
                            const warn = !source.dataLoading && entry && entry.status !== 'ready';
                            return (
                                <button
                                    key={dayType}
                                    type="button"
                                    aria-pressed={selected}
                                    onClick={() => source.toggleDayType(dayType)}
                                    className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-semibold ${
                                        selected ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-300 bg-white text-gray-500 line-through'
                                    }`}
                                >
                                    {selected && <Check size={14} />}
                                    {dayType}
                                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold no-underline ${
                                        source.dataLoading
                                            ? 'bg-gray-100 text-gray-500'
                                            : warn ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'
                                    }`}>
                                        {source.dataLoading ? '…' : entry ? readinessLabel(entry) : ''}
                                    </span>
                                </button>
                            );
                        })}
                    </div>
                    {!source.dataLoading && readiness.some(entry => selection.dayTypes.includes(entry.dayType) && entry.status !== 'ready') && (
                        <p className="mt-2 flex items-center gap-1.5 text-xs text-amber-800">
                            <AlertTriangle size={13} /> Day types without stop-level data will be skipped. Untick them if the route does not run that day.
                        </p>
                    )}
                </section>
            )}

        </div>
    );
};
