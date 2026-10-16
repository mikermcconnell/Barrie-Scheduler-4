import React from 'react';
import type { MasterRouteTable } from '../../../utils/parsers/masterScheduleParser';

const toOp = (minutes: number) => (minutes < 240 ? minutes + 1440 : minutes);

export const formatClock = (minutes: number): string => {
    const total = Math.round(minutes);
    const h = Math.floor(total / 60) % 24;
    const m = ((total % 60) + 60) % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
};

export interface GuidedBlockLane {
    blockId: string;
    pullOut: number;
    pullIn: number;
    trips: number;
}

/** One lane per vehicle: pull-out, pull-in and trip count, in operating-day order. */
export const buildBlockLanes = (tables: MasterRouteTable[]): GuidedBlockLane[] => {
    const lanes = new Map<string, GuidedBlockLane>();
    for (const table of tables) {
        for (const trip of table.trips) {
            const lane = lanes.get(trip.blockId);
            if (!lane) {
                lanes.set(trip.blockId, { blockId: trip.blockId, pullOut: trip.startTime, pullIn: trip.endTime, trips: 1 });
                continue;
            }
            if (toOp(trip.startTime) < toOp(lane.pullOut)) lane.pullOut = trip.startTime;
            if (toOp(trip.endTime) > toOp(lane.pullIn)) lane.pullIn = trip.endTime;
            lane.trips += 1;
        }
    }
    return [...lanes.values()].sort((a, b) => toOp(a.pullOut) - toOp(b.pullOut) || a.blockId.localeCompare(b.blockId, undefined, { numeric: true }));
};

/** Read-only summary of a generated schedule: totals per direction and a lane per block. */
export const GuidedBuildSummary: React.FC<{ tables: MasterRouteTable[] }> = ({ tables }) => {
    const lanes = buildBlockLanes(tables);
    const dayStart = Math.min(...lanes.map(lane => toOp(lane.pullOut)));
    const dayEnd = Math.max(...lanes.map(lane => toOp(lane.pullIn)));
    const span = Math.max(1, dayEnd - dayStart);

    return (
        <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
                {tables.map(table => {
                    const starts = table.trips.map(trip => trip.startTime).sort((a, b) => toOp(a) - toOp(b));
                    return (
                        <div key={table.routeName} className="rounded-xl border border-gray-200 p-3">
                            <div className="text-xs font-bold uppercase tracking-wide text-gray-500">{table.routeName}</div>
                            <div className="mt-1 text-2xl font-bold text-gray-900">{table.trips.length} <span className="text-sm font-semibold text-gray-500">trips</span></div>
                            {starts.length > 0 && <div className="text-xs text-gray-500">First {formatClock(starts[0])} · last {formatClock(starts[starts.length - 1])}</div>}
                        </div>
                    );
                })}
                <div className="rounded-xl border border-gray-200 p-3">
                    <div className="text-xs font-bold uppercase tracking-wide text-gray-500">Vehicles</div>
                    <div className="mt-1 text-2xl font-bold text-gray-900">{lanes.length} <span className="text-sm font-semibold text-gray-500">blocks</span></div>
                    {lanes.length > 0 && <div className="text-xs text-gray-500">Service {formatClock(dayStart)}–{formatClock(dayEnd)}</div>}
                </div>
            </div>

            <section className="rounded-xl border border-gray-200 p-4" aria-label="Blocks">
                <h3 className="mb-2 text-sm font-bold text-gray-900">Blocks</h3>
                <div className="space-y-1.5">
                    {lanes.map(lane => (
                        <div key={lane.blockId} className="grid grid-cols-[4rem_1fr_9rem] items-center gap-2 text-xs">
                            <span className="font-mono font-bold text-gray-800">{lane.blockId}</span>
                            <div className="relative h-4 rounded bg-gray-100">
                                <div
                                    className="absolute inset-y-0 rounded bg-gray-800"
                                    style={{
                                        left: `${((toOp(lane.pullOut) - dayStart) / span) * 100}%`,
                                        width: `${Math.max(1, ((toOp(lane.pullIn) - toOp(lane.pullOut)) / span) * 100)}%`,
                                    }}
                                />
                            </div>
                            <span className="text-right text-gray-600">{formatClock(lane.pullOut)}–{formatClock(lane.pullIn)} · {lane.trips} trips</span>
                        </div>
                    ))}
                </div>
            </section>
        </div>
    );
};
