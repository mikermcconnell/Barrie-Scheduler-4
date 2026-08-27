import type { MasterRouteTable, MasterTrip } from '../parsers/masterScheduleParser';
import type { RouteIdentity } from '../masterScheduleTypes';
import {
    OPERATIONS_PLANNING_SCHEMA_VERSION,
    type OperationsMatrix,
    type OperationsPlanningInputV1,
    type PinnedMasterSchedule,
    type PlanningSourceManifest,
    type PlanningSourceManifestItem,
    type PlanningTrip,
    type RuleProfile,
    type ValidationFinding,
    type VehicleBlockAudit,
} from './types';
import { createDefaultBarrieOperationsMatrix, createDefaultBarrieRuleProfile } from './rules';

const normalizeOperationalMinute = (minute: number): number => minute < 240 ? minute + 1440 : minute;

export const stableStringify = (value: unknown): string => {
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`;
};

/** Deterministic non-cryptographic fingerprint used for change detection, not authentication. */
export const fingerprintValue = (value: unknown): string => {
    const input = stableStringify(value);
    let hash = 0x811c9dc5;
    for (let index = 0; index < input.length; index += 1) {
        hash ^= input.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193);
    }
    return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, '0')}`;
};

const parseClockTime = (value: string | undefined, notBefore: number): number | null => {
    if (!value) return null;
    const match = value.trim().match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)?$/i);
    if (!match) return null;
    let hour = Number(match[1]);
    const minute = Number(match[2]);
    if (!Number.isFinite(hour) || !Number.isFinite(minute) || minute > 59) return null;
    const meridiem = match[3]?.toUpperCase();
    if (meridiem) {
        if (hour < 1 || hour > 12) return null;
        hour %= 12;
        if (meridiem === 'PM') hour += 12;
    } else if (hour > 23) {
        return null;
    }
    let result = hour * 60 + minute;
    while (result < notBefore) result += 1440;
    return result;
};

const activeStops = (table: MasterRouteTable, trip: MasterTrip): { startStop: string; endStop: string } => {
    const startIndex = Math.max(0, Math.min(trip.startStopIndex ?? 0, Math.max(0, table.stops.length - 1)));
    const endIndex = Math.max(startIndex, Math.min(trip.endStopIndex ?? table.stops.length - 1, Math.max(0, table.stops.length - 1)));
    return {
        startStop: table.stops[startIndex] ?? 'Unknown',
        endStop: table.stops[endIndex] ?? 'Unknown',
    };
};

const resolveArrival = (
    trip: MasterTrip,
    endStop: string,
): Pick<PlanningTrip, 'arrivalTime' | 'arrivalResolution'> => {
    const operationalStart = normalizeOperationalMinute(trip.startTime);
    const explicitArrival = parseClockTime(trip.arrivalTimes?.[endStop], operationalStart);
    if (explicitArrival !== null) {
        return { arrivalTime: explicitArrival, arrivalResolution: 'explicit-arrival' };
    }

    const terminalRecovery = trip.recoveryTimes?.[endStop];
    const departureMinute = trip.stopMinutes?.[endStop]
        ?? parseClockTime(trip.stops[endStop], operationalStart);
    if (typeof departureMinute === 'number' && Number.isFinite(departureMinute)
        && typeof terminalRecovery === 'number' && Number.isFinite(terminalRecovery) && terminalRecovery >= 0) {
        return {
            arrivalTime: normalizeOperationalMinute(departureMinute) - terminalRecovery,
            arrivalResolution: 'departure-minus-recovery',
        };
    }

    const operationalEnd = trip.endTime < operationalStart ? trip.endTime + 1440 : trip.endTime;
    if (trip.endTimeIncludesRecovery === false) {
        return { arrivalTime: operationalEnd, arrivalResolution: 'end-time-is-arrival' };
    }
    if (trip.endTimeIncludesRecovery === true || trip.recoveryTime === 0) {
        return {
            arrivalTime: operationalEnd - trip.recoveryTime,
            arrivalResolution: 'departure-minus-recovery',
        };
    }
    return { arrivalTime: null, arrivalResolution: 'unresolved' };
};

const planningTripId = (routeIdentity: RouteIdentity, version: number, trip: MasterTrip): string =>
    `${routeIdentity}@v${version}:${trip.direction}:${trip.id}`;

const vehicleBlockKey = (schedule: PinnedMasterSchedule, trip: MasterTrip): string => trip.gtfsBlockId
    ? `gtfs:${schedule.sourceTeamId}:${schedule.entry.dayType}:${trip.gtfsBlockId}`
    : `master:${schedule.entry.id}@v${schedule.entry.currentVersion}:${trip.blockId}`;

const adaptTableTrips = (schedule: PinnedMasterSchedule, table: MasterRouteTable): PlanningTrip[] =>
    table.trips.map(trip => {
        const { startStop, endStop } = activeStops(table, trip);
        const arrival = resolveArrival(trip, endStop);
        const operationalStart = normalizeOperationalMinute(trip.startTime);
        const operationalEnd = trip.endTime < operationalStart ? trip.endTime + 1440 : trip.endTime;
        const occupiedEndTime = trip.isBlockEnd || trip.endTimeIncludesRecovery === true
            ? operationalEnd
            : trip.endTimeIncludesRecovery === false
                ? operationalEnd + trip.recoveryTime
                : arrival.arrivalTime === null
                    ? null
                    : arrival.arrivalTime + trip.recoveryTime;
        return {
            id: planningTripId(schedule.entry.id as RouteIdentity, schedule.entry.currentVersion, trip),
            sourceTripId: trip.id,
            lineageId: trip.lineageId,
            routeIdentity: schedule.entry.id as RouteIdentity,
            sourceVersion: schedule.entry.currentVersion,
            routeNumber: schedule.entry.routeNumber,
            dayType: schedule.entry.dayType,
            vehicleBlockKey: vehicleBlockKey(schedule, trip),
            blockId: trip.blockId,
            gtfsBlockId: trip.gtfsBlockId,
            direction: trip.direction,
            tripNumber: trip.tripNumber,
            startTime: operationalStart,
            arrivalTime: arrival.arrivalTime,
            occupiedEndTime,
            travelTime: trip.travelTime,
            recoveryTime: trip.recoveryTime,
            startStop,
            endStop,
            arrivalResolution: arrival.arrivalResolution,
        } satisfies PlanningTrip;
    });

const sourceContentFingerprint = (schedule: PinnedMasterSchedule): string => fingerprintValue({
    routeIdentity: schedule.entry.id,
    version: schedule.entry.currentVersion,
    metadata: schedule.content.metadata,
    northTable: schedule.content.northTable,
    southTable: schedule.content.southTable,
});

const blockMembership = (trips: PlanningTrip[]) => trips
    .slice()
    .sort((left, right) => left.startTime - right.startTime || left.id.localeCompare(right.id))
    .map(trip => ({ blockId: trip.blockId, tripId: trip.id }));

export const buildPlanningSourceManifest = (
    schedules: PinnedMasterSchedule[],
    trips: PlanningTrip[],
): PlanningSourceManifest => {
    const items: PlanningSourceManifestItem[] = schedules.map(schedule => {
        const scheduleTrips = trips.filter(trip =>
            trip.routeIdentity === schedule.entry.id && trip.sourceVersion === schedule.entry.currentVersion,
        );
        return {
            sourceTeamId: schedule.sourceTeamId,
            routeIdentity: schedule.entry.id as RouteIdentity,
            routeNumber: schedule.entry.routeNumber,
            dayType: schedule.entry.dayType,
            version: schedule.entry.currentVersion,
            storagePath: schedule.entry.storagePath,
            contentFingerprint: sourceContentFingerprint(schedule),
            blockMembershipFingerprint: fingerprintValue(blockMembership(scheduleTrips)),
            pinnedAt: schedule.pinnedAt,
        };
    }).sort((left, right) => left.routeIdentity.localeCompare(right.routeIdentity));
    return { items, fingerprint: fingerprintValue(items) };
};

const createFinding = (
    auditId: string,
    sequence: number,
    finding: Omit<ValidationFinding, 'id'>,
): ValidationFinding => ({ ...finding, id: `${auditId}:${sequence}:${finding.code}` });

export const auditVehicleBlocks = (trips: PlanningTrip[]): VehicleBlockAudit[] => {
    const groups = new Map<string, PlanningTrip[]>();
    for (const trip of trips) {
        const key = trip.vehicleBlockKey;
        groups.set(key, [...(groups.get(key) ?? []), trip]);
    }
    return [...groups.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([id, blockTrips]) => {
        const ordered = blockTrips.slice().sort((left, right) => left.startTime - right.startTime || left.id.localeCompare(right.id));
        const findings: ValidationFinding[] = [];
        ordered.forEach((trip, index) => {
            if (trip.arrivalTime === null) {
                findings.push(createFinding(id, findings.length, {
                    category: 'integrity',
                    severity: 'error',
                    code: 'arrival-time-unresolved',
                    message: `Trip ${trip.sourceTripId} has no explicit arrival or unambiguous departure/recovery semantics.`,
                    dayType: trip.dayType,
                    blockId: trip.blockId,
                    tripId: trip.id,
                }));
            }
            if (trip.startTime >= (trip.arrivalTime ?? Number.POSITIVE_INFINITY)) {
                findings.push(createFinding(id, findings.length, {
                    category: 'integrity',
                    severity: 'error',
                    code: 'invalid-trip-time',
                    message: `Trip ${trip.sourceTripId} does not have a positive departure-to-arrival span.`,
                    dayType: trip.dayType,
                    blockId: trip.blockId,
                    tripId: trip.id,
                }));
            }
            const previous = ordered[index - 1];
            if (previous?.occupiedEndTime !== null && previous && previous.occupiedEndTime > trip.startTime) {
                findings.push(createFinding(id, findings.length, {
                    category: 'integrity',
                    severity: 'error',
                    code: 'block-overlap',
                    message: `Block ${trip.blockId} overlaps by ${previous.occupiedEndTime - trip.startTime} minute(s).`,
                    dayType: trip.dayType,
                    blockId: trip.blockId,
                    tripId: trip.id,
                }));
            }
            if (previous && previous.endStop.trim().toLocaleLowerCase() !== trip.startStop.trim().toLocaleLowerCase()) {
                findings.push(createFinding(id, findings.length, {
                    category: 'exception',
                    severity: 'warning',
                    code: 'block-location-transition-review',
                    message: `Block ${trip.blockId} moves from ${previous.endStop} to ${trip.startStop}; confirm an allowed operations-matrix transition.`,
                    dayType: trip.dayType,
                    blockId: trip.blockId,
                    tripId: trip.id,
                }));
            }
        });
        const first = ordered[0];
        const last = ordered[ordered.length - 1];
        return {
            id,
            routeIdentity: first.routeIdentity,
            routeIdentities: [...new Set(ordered.map(trip => trip.routeIdentity))].sort(),
            sourceVersion: first.sourceVersion,
            dayType: first.dayType,
            vehicleBlockKey: first.vehicleBlockKey,
            blockId: first.blockId,
            sourceBlockIds: [...new Set(ordered.map(trip => trip.blockId))].sort(),
            tripIds: ordered.map(trip => trip.id),
            membershipFingerprint: fingerprintValue(ordered.map(trip => trip.id)),
            firstDeparture: first.startTime,
            finalArrival: last.arrivalTime,
            findings,
        };
    });
};

export interface BuildOperationsPlanningInputOptions {
    scenarioId: string;
    scenarioName: string;
    exportedAt: string;
    pinnedSchedules: PinnedMasterSchedule[];
    ruleProfile?: RuleProfile;
    operationsMatrix?: OperationsMatrix;
}

export const buildOperationsPlanningInput = (
    options: BuildOperationsPlanningInputOptions,
): OperationsPlanningInputV1 => {
    const trips = options.pinnedSchedules.flatMap(schedule => [
        ...adaptTableTrips(schedule, schedule.content.northTable),
        ...adaptTableTrips(schedule, schedule.content.southTable),
    ]).sort((left, right) =>
        left.dayType.localeCompare(right.dayType)
        || left.startTime - right.startTime
        || left.id.localeCompare(right.id),
    );
    const sourceManifest = buildPlanningSourceManifest(options.pinnedSchedules, trips);
    return {
        schemaVersion: OPERATIONS_PLANNING_SCHEMA_VERSION,
        kind: 'operations-planning-input',
        scenarioId: options.scenarioId,
        scenarioName: options.scenarioName,
        exportedAt: options.exportedAt,
        sourceManifest,
        ruleProfile: options.ruleProfile ?? createDefaultBarrieRuleProfile(),
        operationsMatrix: options.operationsMatrix ?? createDefaultBarrieOperationsMatrix(),
        trips,
        blockAudits: auditVehicleBlocks(trips),
    };
};

export const assessSourceFreshness = (
    manifest: PlanningSourceManifest,
    currentVersions: Record<string, number | undefined>,
): ValidationFinding[] => manifest.items.flatMap((item, index) => {
    const currentVersion = currentVersions[item.routeIdentity];
    if (currentVersion === item.version) return [];
    return [{
        id: `source:${index}:stale-source`,
        category: 'integrity' as const,
        severity: 'error' as const,
        code: currentVersion === undefined ? 'source-version-unverifiable' : 'source-version-stale',
        message: currentVersion === undefined
            ? `${item.routeIdentity} version ${item.version} cannot be verified against the current Master Schedule.`
            : `${item.routeIdentity} is pinned to version ${item.version}, but Master Schedule is version ${currentVersion}.`,
        details: { sourceVersion: item.version, currentVersion: currentVersion ?? null },
    }];
});
