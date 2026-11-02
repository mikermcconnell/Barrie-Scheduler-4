import React, { useRef, useState } from 'react';
import { Bus, Clock, GripVertical, Plus, TrainFront, Trash2 } from 'lucide-react';
import type { DayType } from '../../../utils/parsers/masterScheduleParser';
import type { ConnectionTarget, RouteConnection, StopInfo } from '../../../utils/connections/connectionTypes';
import type { ConnectionTotals } from '../../../utils/connections/rankedConnections';
import { getTargetTimesForDay } from '../../../utils/connections/rankedConnections';
import { getTargetSourceKind, type ConnectionSuggestion } from '../../../utils/connections/guidedConnectionSetup';

export const ACTIVE_HOUR_PRESETS: Array<{ label: string; start?: number; end?: number }> = [
    { label: 'All day' },
    { label: '6–9 AM', start: 360, end: 540 },
    { label: '3–7 PM', start: 900, end: 1140 },
    { label: '7 AM–7 PM', start: 420, end: 1140 },
    { label: 'After 7 PM', start: 1140, end: 1440 },
];

export interface RankedCardData {
    connection: RouteConnection;
    target: ConnectionTarget | null;
    totals: ConnectionTotals;
    afterTotals?: ConnectionTotals;
}

interface ConnectionRankListProps {
    routeLabel: string;
    dayType: DayType;
    cards: RankedCardData[];
    suggestions: ConnectionSuggestion[];
    routeStops: StopInfo[];
    selectedId: string | null;
    onSelect: (connectionId: string) => void;
    onUpdate: (connectionId: string, patch: Partial<RouteConnection>) => void;
    onRemove: (connectionId: string) => void;
    /** Moves a ranked card to a new index in the ranked list. */
    onReorder: (connectionId: string, toIndex: number) => void;
    /** Adds a suggestion to the ranking at an index (end when omitted). */
    onAddSuggestion: (suggestion: ConnectionSuggestion, atIndex?: number) => void;
}

const SOURCE_LABEL: Record<string, string> = {
    'go-gtfs': 'GO GTFS',
    'linx-gtfs': 'LINX GTFS',
    'route-master': 'Route master',
    pasted: 'Entered times',
};

const formatDay = (iso?: string) => {
    if (!iso) return '';
    const date = new Date(iso);
    return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

export const TargetIcon: React.FC<{ target: ConnectionTarget | null; className?: string }> = ({ target, className = 'h-4 w-4' }) => {
    const kind = target ? getTargetSourceKind(target) : 'other';
    if (kind === 'go') return <TrainFront className={`${className} text-green-700`} aria-hidden />;
    if (kind === 'route' || kind === 'linx') return <Bus className={`${className} ${kind === 'linx' ? 'text-indigo-600' : 'text-violet-600'}`} aria-hidden />;
    return <Clock className={`${className} text-teal-600`} aria-hidden />;
};

const sourceTag = (target: ConnectionTarget | null): string => {
    if (!target) return 'Missing service';
    if (target.source) return [SOURCE_LABEL[target.source] ?? target.source, formatDay(target.sourceFetchedAt)].filter(Boolean).join(' · ');
    const kind = getTargetSourceKind(target);
    return kind === 'route' ? 'Route master' : kind === 'go' ? 'GO' : kind === 'linx' ? 'LINX' : 'Saved service';
};

const TotalsBar: React.FC<{ totals: ConnectionTotals }> = ({ totals }) => {
    const pct = (value: number) => (totals.total ? `${(value / totals.total) * 100}%` : '0%');
    return (
        <div className="mt-2 flex h-1.5 flex-1 overflow-hidden rounded bg-gray-100" aria-hidden>
            <i className="block bg-emerald-600" style={{ width: pct(totals.met - totals.atRisk) }} />
            <i className="block bg-violet-500" style={{ width: pct(totals.atRisk) }} />
            <i className="block bg-amber-500" style={{ width: pct(totals.tight + totals.long) }} />
            <i className="block bg-red-600" style={{ width: pct(totals.missed) }} />
        </div>
    );
};

const NumberField: React.FC<{ value: number; label: string; onChange: (value: number) => void }> = ({ value, label, onChange }) => (
    <input
        type="number"
        min={0}
        max={60}
        value={value}
        aria-label={label}
        onClick={event => event.stopPropagation()}
        onChange={event => onChange(Math.max(0, Math.min(60, parseInt(event.target.value, 10) || 0)))}
        className="w-12 rounded border border-gray-200 bg-white px-1 py-0.5 text-xs"
    />
);

export const ConnectionRankList: React.FC<ConnectionRankListProps> = ({
    routeLabel,
    dayType,
    cards,
    suggestions,
    routeStops,
    selectedId,
    onSelect,
    onUpdate,
    onRemove,
    onReorder,
    onAddSuggestion,
}) => {
    const rankZoneRef = useRef<HTMLDivElement>(null);
    const [drag, setDrag] = useState<{ kind: 'card' | 'suggestion'; id: string } | null>(null);
    const [dropIndex, setDropIndex] = useState<number | null>(null);

    const computeDropIndex = (clientY: number): number => {
        const zone = rankZoneRef.current;
        if (!zone) return cards.length;
        const others = Array.from(zone.querySelectorAll<HTMLElement>('[data-rank-card]'))
            .filter(element => element.dataset.rankCard !== (drag?.kind === 'card' ? drag.id : ''));
        const index = others.findIndex(element => {
            const box = element.getBoundingClientRect();
            return clientY < box.top + box.height / 2;
        });
        return index === -1 ? others.length : index;
    };

    const finishDrop = () => {
        if (drag && dropIndex !== null) {
            if (drag.kind === 'card') onReorder(drag.id, dropIndex);
            else {
                const suggestion = suggestions.find(item => item.target.id === drag.id);
                if (suggestion) onAddSuggestion(suggestion, dropIndex);
            }
        }
        setDrag(null);
        setDropIndex(null);
    };

    const dragProps = (kind: 'card' | 'suggestion', id: string) => ({
        draggable: true,
        onDragStart: (event: React.DragEvent) => {
            if ((event.target as HTMLElement).closest('input,select,button')) {
                event.preventDefault();
                return;
            }
            event.dataTransfer.effectAllowed = 'move';
            event.dataTransfer.setData('text/plain', id);
            setDrag({ kind, id });
        },
        onDragEnd: () => {
            setDrag(null);
            setDropIndex(null);
        },
    });

    const dropLine = <div className="mx-2 h-0 rounded border-t-[3px] border-blue-600" data-testid="rank-drop-line" />;

    return (
        <div>
            <div className="flex items-center gap-2 px-3 pb-1 pt-2 text-[11px] font-extrabold uppercase tracking-wide text-gray-500">
                In priority order
                <span className="ml-auto font-semibold normal-case tracking-normal text-gray-400">Drag cards to rank them</span>
            </div>
            <div
                ref={rankZoneRef}
                onDragOver={event => {
                    if (!drag) return;
                    event.preventDefault();
                    setDropIndex(computeDropIndex(event.clientY));
                }}
                onDrop={event => {
                    event.preventDefault();
                    finishDrop();
                }}
                className="min-h-[3rem] space-y-2 px-2 pb-2"
            >
                {cards.length === 0 && (
                    <div className="rounded-lg border-2 border-dashed border-gray-200 p-4 text-center text-xs text-gray-500">
                        No connections yet. Add a suggestion or use "Add connection".
                    </div>
                )}
                {cards.map((card, index) => {
                    const { connection, target, totals, afterTotals } = card;
                    const name = target?.name ?? 'Missing service';
                    const preset = ACTIVE_HOUR_PRESETS.findIndex(item => item.start === connection.timeFilterStart && item.end === connection.timeFilterEnd);
                    const dayTimes = target ? getTargetTimesForDay(target, dayType).length : 0;
                    const isMeet = connection.connectionType === 'meet_departing';
                    const hiddenIndex = drag?.kind === 'card' ? cards.findIndex(item => item.connection.id === drag.id) : -1;
                    const lineBefore = dropIndex !== null && drag && dropIndex === (hiddenIndex !== -1 && index > hiddenIndex ? index - 1 : index)
                        && !(drag.kind === 'card' && drag.id === connection.id);
                    return (
                        <React.Fragment key={connection.id}>
                            {lineBefore && dropLine}
                            <div
                                data-rank-card={connection.id}
                                {...dragProps('card', connection.id)}
                                onClick={() => onSelect(connection.id)}
                                className={`flex cursor-grab gap-2 rounded-lg border bg-white p-2.5 ${selectedId === connection.id ? 'border-blue-500 ring-2 ring-blue-500/15' : 'border-gray-200 hover:border-gray-300'} ${connection.enabled ? '' : 'opacity-60'} ${drag?.kind === 'card' && drag.id === connection.id ? 'opacity-40' : ''}`}
                            >
                                <div className="flex flex-none items-start gap-1 pt-0.5">
                                    <GripVertical className="h-4 w-4 text-gray-300" aria-hidden />
                                    <span className="grid h-6 w-6 place-items-center rounded-full bg-gray-900 text-xs font-extrabold text-white" aria-label={`Rank ${index + 1}`}>{index + 1}</span>
                                </div>
                                <div className="min-w-0 flex-1">
                                    <div className="flex items-start gap-2">
                                        <TargetIcon target={target} />
                                        <div className="min-w-0 flex-1">
                                            <p className="truncate text-sm font-bold text-gray-900">{name}</p>
                                            <label className="flex items-center gap-1 text-xs text-gray-500">
                                                at
                                                <select
                                                    value={connection.stopCode}
                                                    onClick={event => event.stopPropagation()}
                                                    onChange={event => {
                                                        const stop = routeStops.find(item => item.code === event.target.value);
                                                        onUpdate(connection.id, { stopCode: event.target.value, stopName: stop?.name });
                                                    }}
                                                    className="max-w-[11rem] truncate rounded border border-gray-200 bg-white px-1 py-0.5 text-xs"
                                                    aria-label={`${name} stop`}
                                                >
                                                    {routeStops.map(stop => <option key={stop.code} value={stop.code}>{stop.name}</option>)}
                                                    {!routeStops.some(stop => stop.code === connection.stopCode) && (
                                                        <option value={connection.stopCode}>{connection.stopName || `Stop ${connection.stopCode}`}</option>
                                                    )}
                                                </select>
                                            </label>
                                        </div>
                                        <span className="whitespace-nowrap rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-extrabold uppercase tracking-wide text-gray-600">{sourceTag(target)}</span>
                                        <button
                                            type="button"
                                            role="switch"
                                            aria-checked={connection.enabled}
                                            aria-label={`${connection.enabled ? 'Turn off' : 'Turn on'} ${name}`}
                                            onClick={event => {
                                                event.stopPropagation();
                                                onUpdate(connection.id, { enabled: !connection.enabled });
                                            }}
                                            className={`relative h-5 w-9 flex-none rounded-full transition-colors ${connection.enabled ? 'bg-emerald-600' : 'bg-gray-300'}`}
                                        >
                                            <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${connection.enabled ? 'left-[18px]' : 'left-0.5'}`} />
                                        </button>
                                        <button
                                            type="button"
                                            aria-label={`Remove ${name}`}
                                            onClick={event => {
                                                event.stopPropagation();
                                                onRemove(connection.id);
                                            }}
                                            className="p-0.5 text-gray-300 hover:text-red-600"
                                        >
                                            <Trash2 className="h-4 w-4" />
                                        </button>
                                    </div>
                                    <div className="mt-1.5 flex flex-wrap items-center gap-1 text-xs text-gray-700">
                                        <select
                                            value={connection.connectionType}
                                            onClick={event => event.stopPropagation()}
                                            onChange={event => onUpdate(connection.id, { connectionType: event.target.value as RouteConnection['connectionType'] })}
                                            className="rounded border border-gray-200 bg-white px-1 py-0.5 text-xs"
                                            aria-label={`${name} direction`}
                                        >
                                            <option value="meet_departing">{routeLabel} arrives</option>
                                            <option value="feed_arriving">{routeLabel} leaves</option>
                                        </select>
                                        <NumberField value={connection.bufferMinutes} label={`${name} shortest wait`} onChange={value => onUpdate(connection.id, { bufferMinutes: value, maxWaitMinutes: Math.max(value, connection.maxWaitMinutes ?? value + 10) })} />
                                        –
                                        <NumberField value={connection.maxWaitMinutes ?? Math.max(15, connection.bufferMinutes + 10)} label={`${name} longest wait`} onChange={value => onUpdate(connection.id, { maxWaitMinutes: Math.max(value, connection.bufferMinutes) })} />
                                        <span>min {isMeet ? 'before it leaves' : 'after it arrives'}</span>
                                    </div>
                                    <div className="mt-1.5 flex items-center gap-1.5 text-xs text-gray-600">
                                        Active
                                        {preset !== 0 && <span className="rounded bg-sky-100 px-1.5 py-0.5 text-[10px] font-extrabold uppercase text-sky-700">Limited</span>}
                                        <select
                                            value={preset === -1 ? 'custom' : String(preset)}
                                            onClick={event => event.stopPropagation()}
                                            onChange={event => {
                                                const chosen = ACTIVE_HOUR_PRESETS[Number(event.target.value)];
                                                if (chosen) onUpdate(connection.id, { timeFilterStart: chosen.start, timeFilterEnd: chosen.end });
                                            }}
                                            className="rounded border border-gray-200 bg-white px-1 py-0.5 text-xs"
                                            aria-label={`${name} active hours`}
                                        >
                                            {ACTIVE_HOUR_PRESETS.map((item, presetIndex) => <option key={item.label} value={presetIndex}>{item.label}</option>)}
                                            {preset === -1 && <option value="custom">Custom hours</option>}
                                        </select>
                                    </div>
                                    {target && dayTimes === 0 && (
                                        <p className="mt-1 text-xs font-semibold text-amber-700">No {dayType} times for this service.</p>
                                    )}
                                    <div className="flex items-center gap-2">
                                        <TotalsBar totals={totals} />
                                        <span className="mt-2 whitespace-nowrap text-xs font-bold text-gray-800" data-testid={`met-${connection.id}`}>
                                            {afterTotals && afterTotals.met !== totals.met
                                                ? <>{totals.met} → <span className={afterTotals.met < totals.met ? 'text-red-600' : 'text-emerald-700'}>{afterTotals.met}</span>/{totals.total} met</>
                                                : <>{totals.met}/{totals.total} met</>}
                                            {totals.atRisk > 0 && <span className="text-violet-700"> · {totals.atRisk} at risk</span>}
                                        </span>
                                    </div>
                                    {totals.unserved > 0 && (
                                        <p className="mt-0.5 text-[11px] text-gray-500">{totals.unserved} {totals.unserved === 1 ? 'time has' : 'times have'} no {routeLabel} trip nearby.</p>
                                    )}
                                </div>
                            </div>
                        </React.Fragment>
                    );
                })}
                {dropIndex !== null && drag && dropIndex >= cards.filter(card => !(drag.kind === 'card' && drag.id === card.connection.id)).length && dropLine}
            </div>

            {suggestions.length > 0 && (
                <>
                    <div className="flex items-center gap-2 px-3 pb-1 pt-2 text-[11px] font-extrabold uppercase tracking-wide text-gray-500">
                        Suggested for {routeLabel}
                        <span className="ml-auto font-semibold normal-case tracking-normal text-gray-400">Drag up or add</span>
                    </div>
                    <div className="space-y-2 px-2 pb-2">
                        {suggestions.map(suggestion => (
                            <div
                                key={suggestion.target.id}
                                {...dragProps('suggestion', suggestion.target.id)}
                                className="flex cursor-grab items-center gap-2 rounded-lg border border-dashed border-gray-300 bg-gray-50/60 p-2.5"
                            >
                                <GripVertical className="h-4 w-4 text-gray-300" aria-hidden />
                                <TargetIcon target={suggestion.target} />
                                <div className="min-w-0 flex-1">
                                    <p className="truncate text-sm font-bold text-gray-700">{suggestion.target.name}</p>
                                    <p className="text-xs text-gray-500">
                                        at {suggestion.stop.name} · {suggestion.reason === 'same-hub' ? 'same hub' : 'same stop'}
                                    </p>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => onAddSuggestion(suggestion)}
                                    className="flex items-center gap-1 rounded-md border border-gray-200 bg-white px-2 py-1 text-xs font-bold text-gray-700 hover:bg-gray-50"
                                >
                                    <Plus className="h-3.5 w-3.5" /> Add
                                </button>
                            </div>
                        ))}
                    </div>
                </>
            )}
        </div>
    );
};
