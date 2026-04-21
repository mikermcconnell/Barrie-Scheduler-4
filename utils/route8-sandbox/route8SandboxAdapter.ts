import { TimeUtils } from '../timeUtils';
import type { MasterRouteTable, MasterTrip } from '../parsers/masterScheduleParser';
import type {
    Route8BlockFlowRow,
    Route8Branch,
    Route8DirectionSummary,
    Route8FamilyModel,
    Route8SandboxContent,
    Route8TerminalEvent,
    Route8TimepointSummary,
} from './types';

interface SandboxTripRef {
    branch: Route8Branch;
    direction: 'North' | 'South';
    routeName: string;
    trip: MasterTrip;
    stops: string[];
    allandaleStop: string | null;
}

const ALLANDALE_PATTERN = /allandale/i;

const tripTimeSort = (left: MasterTrip, right: MasterTrip): number => {
    const leftValue = left.startTime;
    const rightValue = right.startTime;
    return leftValue - rightValue;
};

const safeTimeFromMinutes = (minutes: number | null | undefined): string | null =>
    typeof minutes === 'number' && Number.isFinite(minutes) ? TimeUtils.fromMinutes(minutes) : null;

function getFirstStop(stops: string[]): string | null {
    return stops[0] ?? null;
}

function getLastStop(stops: string[]): string | null {
    return stops[stops.length - 1] ?? null;
}

function findAllandaleStop(stops: string[]): string | null {
    return stops.find((stop) => ALLANDALE_PATTERN.test(stop)) ?? null;
}

function getStopValue<T>(record: Record<string, T> | undefined, stopName: string | null): T | undefined {
    if (!record || !stopName) return undefined;
    return record[stopName];
}

function getTerminalArrivalTime(trip: MasterTrip, stopName: string | null): string | null {
    if (!stopName) return null;
    return getStopValue(trip.arrivalTimes, stopName) || getStopValue(trip.stops, stopName) || null;
}

function getTerminalDepartureTime(trip: MasterTrip, stopName: string | null): string | null {
    if (!stopName) return null;
    const arrival = getTerminalArrivalTime(trip, stopName);
    const departure = getStopValue(trip.stops, stopName) || null;
    const recovery = getStopValue(trip.recoveryTimes, stopName) || 0;

    if (!arrival) return departure;
    if (departure && departure !== arrival) return departure;
    if (recovery <= 0) return arrival;
    return TimeUtils.addMinutes(arrival, recovery);
}

function buildTripRefs(content: Route8SandboxContent): SandboxTripRef[] {
    return (['8A', '8B'] as Route8Branch[]).flatMap((branch) => {
        const workingCopy = content.workingCopies[branch];

        return ([
            { direction: 'North' as const, table: workingCopy.northTable },
            { direction: 'South' as const, table: workingCopy.southTable },
        ]).flatMap(({ direction, table }) => {
            if (!table || ((table.trips?.length ?? 0) === 0 && (table.stops?.length ?? 0) === 0)) {
                return [];
            }

            const allandaleStop = findAllandaleStop(table.stops);
            return [...table.trips]
                .sort(tripTimeSort)
                .map((trip) => ({
                    branch,
                    direction,
                    routeName: table.routeName,
                    trip,
                    stops: table.stops,
                    allandaleStop,
                }));
        });
    });
}

function buildDirectionSummaries(content: Route8SandboxContent): Route8DirectionSummary[] {
    return (['8A', '8B'] as Route8Branch[]).flatMap((branch) => {
        const workingCopy = content.workingCopies[branch];
        return ([
            { direction: 'North' as const, table: workingCopy.northTable },
            { direction: 'South' as const, table: workingCopy.southTable },
        ]).map(({ direction, table }) => {
            const trips = [...(table?.trips ?? [])].sort(tripTimeSort);
            const allandaleStop = findAllandaleStop(table?.stops ?? []);
            return {
                id: `${branch}-${direction}`,
                branch,
                direction,
                routeName: table?.routeName ?? `${branch} (${content.dayType}) (${direction})`,
                tripCount: trips.length,
                firstDeparture: safeTimeFromMinutes(trips[0]?.startTime),
                lastDeparture: safeTimeFromMinutes(trips[trips.length - 1]?.startTime),
                firstBlockId: trips[0]?.blockId ?? null,
                lastBlockId: trips[trips.length - 1]?.blockId ?? null,
                startStop: getFirstStop(table?.stops ?? []),
                allandaleStop,
                endStop: getLastStop(table?.stops ?? []),
            };
        });
    });
}

function buildTimepointSummaries(directionSummaries: Route8DirectionSummary[]): Route8TimepointSummary[] {
    return directionSummaries.map((summary) => ({
        id: summary.id,
        branch: summary.branch,
        direction: summary.direction,
        startStop: summary.startStop,
        allandaleStop: summary.allandaleStop,
        endStop: summary.endStop,
        firstDeparture: summary.firstDeparture,
        lastDeparture: summary.lastDeparture,
    }));
}

function buildTerminalEvents(tripRefs: SandboxTripRef[]): Route8TerminalEvent[] {
    const tripsByBlock = new Map<string, SandboxTripRef[]>();

    tripRefs.forEach((ref) => {
        const bucket = tripsByBlock.get(ref.trip.blockId) ?? [];
        bucket.push(ref);
        tripsByBlock.set(ref.trip.blockId, bucket);
    });

    tripsByBlock.forEach((refs) => refs.sort((left, right) => tripTimeSort(left.trip, right.trip)));

    return tripRefs
        .filter((ref) => Boolean(ref.allandaleStop))
        .map((ref) => {
            const blockTrips = tripsByBlock.get(ref.trip.blockId) ?? [];
            const currentIndex = blockTrips.findIndex((item) => item.trip.id === ref.trip.id);
            const nextTrip = currentIndex >= 0 ? blockTrips[currentIndex + 1] : undefined;
            const stopName = ref.allandaleStop;
            const recoveryMinutes = Number(getStopValue(ref.trip.recoveryTimes, stopName) || 0);

            return {
                id: `${ref.branch}-${ref.direction}-${ref.trip.id}`,
                branch: ref.branch,
                direction: ref.direction,
                blockId: ref.trip.blockId,
                stopName: stopName ?? 'Allandale',
                arrivalTime: getTerminalArrivalTime(ref.trip, stopName),
                departureTime: getTerminalDepartureTime(ref.trip, stopName),
                recoveryMinutes,
                nextTripSummary: nextTrip
                    ? `${nextTrip.branch} ${nextTrip.direction} · ${safeTimeFromMinutes(nextTrip.trip.startTime) ?? '—'}`
                    : null,
            };
        })
        .sort((left, right) => {
            const leftMinutes = left.departureTime ? TimeUtils.toMinutes(left.departureTime) ?? Number.MAX_SAFE_INTEGER : Number.MAX_SAFE_INTEGER;
            const rightMinutes = right.departureTime ? TimeUtils.toMinutes(right.departureTime) ?? Number.MAX_SAFE_INTEGER : Number.MAX_SAFE_INTEGER;
            return leftMinutes - rightMinutes;
        });
}

function buildBlockRows(tripRefs: SandboxTripRef[]): Route8BlockFlowRow[] {
    const grouped = new Map<string, SandboxTripRef[]>();

    tripRefs.forEach((ref) => {
        const bucket = grouped.get(ref.trip.blockId) ?? [];
        bucket.push(ref);
        grouped.set(ref.trip.blockId, bucket);
    });

    return [...grouped.entries()]
        .map(([blockId, refs]) => {
            const ordered = [...refs].sort((left, right) => tripTimeSort(left.trip, right.trip));
            return {
                blockId,
                firstStartTime: safeTimeFromMinutes(ordered[0]?.trip.startTime),
                lastEndTime: safeTimeFromMinutes(ordered[ordered.length - 1]?.trip.endTime),
                segments: ordered.map((ref) => ({
                    id: ref.trip.id,
                    branch: ref.branch,
                    direction: ref.direction,
                    routeName: ref.routeName,
                    blockId,
                    startTime: safeTimeFromMinutes(ref.trip.startTime) ?? '—',
                    endTime: safeTimeFromMinutes(ref.trip.endTime) ?? '—',
                    startStop: getFirstStop(ref.stops),
                    endStop: getLastStop(ref.stops),
                    allandaleTime: getTerminalDepartureTime(ref.trip, ref.allandaleStop),
                })),
            };
        })
        .sort((left, right) => {
            const leftTime = left.firstStartTime ? TimeUtils.toMinutes(left.firstStartTime) ?? Number.MAX_SAFE_INTEGER : Number.MAX_SAFE_INTEGER;
            const rightTime = right.firstStartTime ? TimeUtils.toMinutes(right.firstStartTime) ?? Number.MAX_SAFE_INTEGER : Number.MAX_SAFE_INTEGER;
            return leftTime - rightTime;
        });
}

export function deriveRoute8FamilyModel(content: Route8SandboxContent): Route8FamilyModel {
    const tripRefs = buildTripRefs(content);
    const directionSummaries = buildDirectionSummaries(content);

    return {
        directionSummaries,
        terminalEvents: buildTerminalEvents(tripRefs),
        blockRows: buildBlockRows(tripRefs),
        timepointSummaries: buildTimepointSummaries(directionSummaries),
    };
}
