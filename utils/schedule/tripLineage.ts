import type { MasterRouteTable, MasterTrip } from '../parsers/masterScheduleParser';

const LINEAGE_PREFIX = 'ln';
const LEGACY_LINEAGE_PREFIX = 'legacy-ln';

const sanitizeLineageToken = (value: string): string => value
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[^a-zA-Z0-9:_\-|() ]+/g, '')
    .replace(/ /g, '_');

export const createTripLineageId = (): string => {
    const randomUuid = globalThis.crypto?.randomUUID?.();
    if (randomUuid) return `${LINEAGE_PREFIX}:${randomUuid}`;

    return `${LINEAGE_PREFIX}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 10)}`;
};

export const buildLegacyTripLineageId = (
    routeName: string,
    tripId: string
): string => `${LEGACY_LINEAGE_PREFIX}:${sanitizeLineageToken(routeName)}:${sanitizeLineageToken(tripId)}`;

export const ensureTripLineage = (
    trip: MasterTrip,
    routeName: string
): MasterTrip => {
    if (trip.lineageId) return trip;

    return {
        ...trip,
        lineageId: buildLegacyTripLineageId(routeName, trip.id),
    };
};

export const normalizeSchedulesForLineage = (
    schedules: MasterRouteTable[] | undefined
): MasterRouteTable[] => {
    if (!schedules || schedules.length === 0) return [];

    return schedules.map(table => ({
        ...table,
        trips: table.trips.map(trip => ensureTripLineage(trip, table.routeName)),
    }));
};

export const normalizeScheduleBaselinesForLineage = (
    generatedSchedules: MasterRouteTable[] | undefined,
    originalGeneratedSchedules: MasterRouteTable[] | undefined
): {
    generatedSchedules: MasterRouteTable[];
    originalGeneratedSchedules: MasterRouteTable[];
} => ({
    generatedSchedules: normalizeSchedulesForLineage(generatedSchedules),
    originalGeneratedSchedules: normalizeSchedulesForLineage(originalGeneratedSchedules),
});

export const getTripLineageLookupKey = (
    routeName: string,
    trip: Pick<MasterTrip, 'id' | 'lineageId'>
): string => trip.lineageId || buildLegacyTripLineageId(routeName, trip.id);
