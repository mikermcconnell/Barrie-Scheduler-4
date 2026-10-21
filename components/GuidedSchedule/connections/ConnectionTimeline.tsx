import React, { useMemo, useState } from 'react';
import type { ConnectionEvaluation, EvaluatedEvent } from '../../../utils/connections/rankedConnections';
import { getConnectionWindow } from '../../../utils/connections/rankedConnections';
import { formatConnectionTime } from '../../../utils/connections/connectionTypes';

interface ConnectionTimelineProps {
    routeLabel: string;
    evaluation: ConnectionEvaluation | null;
    /** Every enabled connection, for "this trip also serves". */
    allEvaluations: ConnectionEvaluation[];
    /** Trips the pending optimizer result would move, with minutes. */
    movedTrips: Record<string, number>;
    showingAfter: boolean;
}

const COLOR: Record<string, string> = { met: '#059669', tight: '#d97706', long: '#d97706', missed: '#dc2626', risk: '#7c3aed' };
const eventColor = (event: EvaluatedEvent) => (event.atRisk ? COLOR.risk : COLOR[event.status]);

const statusText = (event: EvaluatedEvent, window: { min: number; max: number }): string => {
    if (event.atRisk) {
        const left = event.gap - event.lateness;
        return `At risk. Met on paper (${event.gap} min), but when the bus runs ${event.lateness} min late ${left < 0 ? `the rider misses it by ${-left} min` : left === 0 ? 'there is no time to transfer' : `the rider has ${left} min`}.`;
    }
    if (event.status === 'met') return `Met. Wait ${event.gap} min.`;
    if (event.status === 'missed') return `Missed by ${-event.gap} min.`;
    if (event.status === 'tight') return `Too tight: ${event.gap} min (needs ${window.min}).`;
    return `Long wait: ${event.gap} min (more than ${window.max}).`;
};

export const ConnectionTimeline: React.FC<ConnectionTimelineProps> = ({ routeLabel, evaluation, allEvaluations, movedTrips, showingAfter }) => {
    const [selectedKey, setSelectedKey] = useState<string | null>(null);
    const events = evaluation?.events ?? [];
    const domain = useMemo(() => {
        const times = events.flatMap(event => [event.busTime, event.targetTime]);
        if (times.length === 0) return { start: 360, end: 1380 };
        const start = Math.floor((Math.min(...times) - 30) / 60) * 60;
        const end = Math.ceil((Math.max(...times) + 30) / 60) * 60;
        return { start, end: Math.max(end, start + 120) };
    }, [events]);

    if (!evaluation) {
        return <p className="px-4 py-6 text-sm text-gray-500">Select a connection to see it on the timeline.</p>;
    }

    const width = 900;
    const x = (minutes: number) => 40 + ((minutes - domain.start) / (domain.end - domain.start)) * (width - 60);
    const hours: number[] = [];
    for (let hour = Math.ceil(domain.start / 60); hour * 60 <= domain.end; hour += 2) hours.push(hour * 60);
    const window = getConnectionWindow(evaluation.connection);
    const serviceLabel = (evaluation.target?.name ?? 'Service').replace(/^Route\s+/i, 'Rt ').slice(0, 12);
    const selected = events.find(event => `${event.tripId}|${event.targetTime}` === selectedKey) ?? null;
    const alsoServes = selected
        ? allEvaluations
            .filter(item => item.connection.id !== evaluation.connection.id)
            .flatMap(item => item.events.filter(event => event.tripId === selected.tripId).map(event => ({ item, event })))
        : [];

    return (
        <div>
            <svg viewBox={`0 0 ${width} 150`} className="block w-full" role="img" aria-label={`${evaluation.target?.name ?? 'Connection'} timeline`}>
                {hours.map(hour => (
                    <g key={hour}>
                        <line x1={x(hour)} y1={20} x2={x(hour)} y2={128} stroke="#f1f2f4" />
                        <text x={x(hour)} y={144} fontSize={10} fill="#9ca3af" textAnchor="middle">{formatConnectionTime(hour).replace(':00', '')}</text>
                    </g>
                ))}
                <text x={4} y={42} fontSize={10} fill="#6b7280">{routeLabel.replace(/^Route\s+/i, 'Rt ')}</text>
                <text x={4} y={112} fontSize={10} fill="#6b7280">{serviceLabel}</text>
                {events.map(event => {
                    const key = `${event.tripId}|${event.targetTime}`;
                    const color = eventColor(event);
                    const moved = !!movedTrips[event.tripId];
                    return (
                        <g key={key} onClick={() => setSelectedKey(key)} style={{ cursor: 'pointer' }} data-testid="timeline-event" data-status={event.atRisk ? 'risk' : event.status}>
                            <line x1={x(event.busTime)} y1={40} x2={x(event.targetTime)} y2={105} stroke={color} strokeWidth={event.status === 'missed' ? 2 : 1.4} opacity={0.85} />
                            <circle cx={x(event.busTime)} cy={38} r={moved ? 7 : 5.5} fill={color} stroke={moved ? '#2563eb' : undefined} strokeWidth={moved ? 2.5 : undefined}>
                                <title>{`${routeLabel} ${formatConnectionTime(event.busTime)}`}</title>
                            </circle>
                            <rect x={x(event.targetTime) - 4.5} y={103.5} width={9} height={9} rx={2} fill={color}>
                                <title>{`${evaluation.target?.name ?? 'Service'} ${formatConnectionTime(event.targetTime)}`}</title>
                            </rect>
                        </g>
                    );
                })}
            </svg>
            <div className="mx-3 mb-3 min-h-[64px] rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm" data-testid="timeline-detail">
                {!selected ? (
                    <>
                        <p className="font-bold text-gray-900">Click a dot on the timeline</p>
                        <p className="text-gray-600">See the bus, the connecting service, the wait, and the other connections the same trip serves.</p>
                    </>
                ) : (
                    <>
                        <p className="font-bold text-gray-900">
                            {statusText(selected, window)}
                            {movedTrips[selected.tripId] ? (
                                <span className="ml-2 rounded-full bg-blue-50 px-2 py-0.5 text-xs font-bold text-blue-700">
                                    {showingAfter ? 'moved' : 'would move'} {movedTrips[selected.tripId] > 0 ? '+' : ''}{movedTrips[selected.tripId]} min
                                </span>
                            ) : null}
                        </p>
                        <p className="text-gray-700">
                            {evaluation.connection.connectionType === 'meet_departing'
                                ? <>Block {selected.blockId} arrives {selected.stopName} at <b>{formatConnectionTime(selected.busTime)}</b>. {evaluation.target?.name} leaves at <b>{formatConnectionTime(selected.targetTime)}</b>.</>
                                : <>{evaluation.target?.name} arrives at <b>{formatConnectionTime(selected.targetTime)}</b>. Block {selected.blockId} leaves {selected.stopName} at <b>{formatConnectionTime(selected.busTime)}</b>.</>}
                        </p>
                        {alsoServes.length > 0 && (
                            <>
                                <p className="mt-1.5 font-semibold text-gray-800">This trip also serves:</p>
                                <ul className="ml-5 list-disc text-gray-700">
                                    {alsoServes.map(({ item, event }) => (
                                        <li key={`${item.connection.id}|${event.targetTime}`}>
                                            #{item.rank} {item.target?.name} at {formatConnectionTime(event.targetTime)}:{' '}
                                            <span className={`font-bold ${event.atRisk ? 'text-violet-700' : event.status === 'met' ? 'text-emerald-700' : event.status === 'missed' ? 'text-red-600' : 'text-amber-700'}`}>
                                                {event.atRisk ? 'at risk' : event.status === 'long' ? 'long wait' : event.status}
                                            </span>{' '}({event.gap} min)
                                        </li>
                                    ))}
                                </ul>
                            </>
                        )}
                    </>
                )}
            </div>
        </div>
    );
};
