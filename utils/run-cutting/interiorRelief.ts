import type { MasterRouteTable, MasterTrip } from '../parsers/masterScheduleParser';
import type { DailyRun, OperationsPlanningInputV1, OperationsPlanningProposalV1, PlanningStopEvent, PlanningTrip, RunPiece, ValidationFinding } from './types';
import { fingerprintValue } from './masterAdapter';

const base = (name: string) => name.replace(/\s+\(\d+\)\s*$/, '').replace(/\s+Platform\s+\d+\s*$/i, '').trim();
const location = (name: string) => {
    const value = base(name);
    if (/^(Barrie\s+)?Allandale(?:\s+GO|\s+Transit\s+Terminal)?$/i.test(value)) return 'B.A.T.T.';
    if (/^Downtown(?:\s+Hub|\s+Terminal|\s+Transit\s+Terminal)?$/i.test(value)) return 'Downtown Hub';
    return value;
};

const clock = (value: string | undefined, start: number): number | null => {
    const match = value?.trim().match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)?$/i);
    if (!match) return null;
    let hour = Number(match[1]);
    const minute = Number(match[2]);
    if (minute > 59 || hour > 47) return null;
    if (match[3]) {
        if (hour < 1 || hour > 12) return null;
        hour = hour % 12 + (match[3].toUpperCase() === 'PM' ? 12 : 0);
    }
    let result = hour * 60 + minute;
    while (result < start) result += 1440;
    return result;
};

/** Read source visits, including legacy adjacent ARR/DEP columns. No timing interpolation. */
export const buildPlanningStopEvents = (table: MasterRouteTable, raw: MasterTrip, trip: PlanningTrip): PlanningStopEvent[] => {
    const names = table.stops.slice(raw.startStopIndex ?? 0, (raw.endStopIndex ?? table.stops.length - 1) + 1)
        .filter(name => Boolean(raw.stops?.[name]) || Number.isFinite(raw.stopMinutes?.[name]));
    const groups: string[][] = [];
    const legacyArrivalColumns = table.stops.some((name, index) => index > 0 && location(name) === location(table.stops[index - 1]));
    for (const name of names) {
        const previous = groups.at(-1);
        if (previous && location(previous[0]) === location(name)) previous.push(name);
        else groups.push([name]);
    }
    const minute = (name: string) => {
        const numeric = raw.stopMinutes?.[name];
        if (typeof numeric !== 'number' || !Number.isFinite(numeric)) return clock(raw.stops?.[name], trip.startTime);
        let result = numeric;
        while (result < trip.startTime) result += 1440;
        return result;
    };
    const events = groups.map((group, index) => {
        const first = group[0];
        const last = group.at(-1)!;
        let departureTime = minute(last);
        let arrivalTime: number | null = null;
        let arrivalResolution: PlanningStopEvent['arrivalResolution'] = 'unresolved';
        const explicit = clock(raw.arrivalTimes?.[first], trip.startTime);
        if (group.length === 2) {
            const arrival = minute(first);
            const recovery = raw.recoveryTimes?.[first];
            // Legacy paired columns explicitly record both instants. Extra occupied
            // dwell (including historical interlining waits) is not driver rest.
            if (arrival !== null && departureTime !== null
                && departureTime >= arrival && (recovery === undefined || Number.isFinite(recovery) && recovery >= 0 && departureTime - arrival >= recovery)) {
                arrivalTime = arrival;
                arrivalResolution = 'legacy-arrival-column';
            }
        } else if (group.length === 1 && explicit !== null) {
            arrivalTime = explicit;
            arrivalResolution = 'explicit-arrival';
            // Current GTFS Master stores arrivals in both maps and the dwell separately.
            // An independently later departure remains authoritative when present.
            const recovery = raw.recoveryTimes?.[first] ?? 0;
            if (departureTime === explicit && Number.isFinite(recovery) && recovery >= 0)
                departureTime = explicit + recovery;
        } else if (group.length === 1 && departureTime !== null && legacyArrivalColumns) {
            arrivalTime = departureTime;
            arrivalResolution = 'legacy-arrival-column';
        } else if (group.length === 1 && departureTime !== null && raw.recoveryTimes) {
            const recovery = raw.recoveryTimes[first] ?? 0;
            if (Number.isFinite(recovery) && recovery >= 0) {
                arrivalTime = departureTime - recovery;
                arrivalResolution = 'departure-minus-recovery';
            }
        }
        if (index === 0) {
            arrivalTime = trip.startTime;
            departureTime = trip.startTime;
            arrivalResolution = 'trip-start';
        } else if (index === groups.length - 1 && !legacyArrivalColumns) {
            // Preserve the existing, source-resolved terminal semantics exactly.
            if (arrivalTime === null && group.length === 1 || arrivalTime === trip.arrivalTime) {
                arrivalTime = trip.arrivalTime;
                arrivalResolution = 'trip-end';
            }
        }
        return { id: `${trip.id}:event:${index}`, stopName: location(first), sourceStopNames: group,
            arrivalTime, departureTime, arrivalResolution };
    });
    const last = events.at(-1);
    if (legacyArrivalColumns && last?.sourceStopNames.length === 1 && last.arrivalTime !== null) {
        const recovery = raw.recoveryTimes?.[last.sourceStopNames[0]];
        const driving = events.slice(0, -1).reduce((sum, event, index) =>
            sum + (events[index + 1].arrivalTime ?? NaN) - (event.departureTime ?? NaN), 0);
        // An unpaired terminal may be ARR-only or a departure. Resolve only when
        // its exact own recovery and original driving total select one meaning.
        if (recovery !== undefined && recovery > 0 && driving !== trip.travelTime && driving - recovery === trip.travelTime) {
            last.arrivalTime -= recovery;
            last.arrivalResolution = 'departure-minus-recovery';
        }
    }
    return events;
};

export class InteriorReliefError extends Error {}
const fail = (message: string): never => { throw new InteriorReliefError(message); };
const strictUnitsForTrip = (trip: PlanningTrip): PlanningTrip[] => {
    const events = trip.stopEvents;
    if (!events || events.length < 2) return fail(`Trip ${trip.id} has no source-backed stop-event sequence.`);
    if (new Set(events.map(event => event.id)).size !== events.length) return fail(`Trip ${trip.id} repeats a stop event.`);
    if (events[0].departureTime !== trip.startTime || events.at(-1)!.arrivalTime !== trip.arrivalTime)
        return fail(`Trip ${trip.id} stop events do not preserve its source endpoints.`);
    const units = events.slice(0, -1).map((event, index): PlanningTrip => {
        const next = events[index + 1];
        if (event.arrivalTime === null || event.departureTime === null || next.arrivalTime === null
            || !Number.isFinite(event.arrivalTime) || !Number.isFinite(event.departureTime) || !Number.isFinite(next.arrivalTime)
            || event.departureTime < event.arrivalTime || next.arrivalTime < event.departureTime
            || event.arrivalResolution === 'unresolved' || next.arrivalResolution === 'unresolved')
            return fail(`Trip ${trip.id} has unresolved or non-chronological stop events at ${event.id}.`);
        return { ...trip, id: `${trip.id}:unit:${index}`, startTime: event.departureTime,
            arrivalTime: next.arrivalTime, occupiedEndTime: next.arrivalTime,
            travelTime: next.arrivalTime - event.departureTime, recoveryTime: 0,
            startStop: event.stopName, endStop: next.stopName, stopEvents: undefined };
    });
    const total = units.reduce((sum, unit) => sum + unit.travelTime, 0);
    if (total !== trip.travelTime) return fail(`Trip ${trip.id} stop-derived driving ${total} does not equal source driving ${trip.travelTime}; no prorating is permitted.`);
    return units;
};

export const assessInteriorReliefSources = (input: OperationsPlanningInputV1): ValidationFinding[] => input.schemaVersion !== 2 ? [] : input.trips.flatMap(trip => {
    try { strictUnitsForTrip(trip); return []; } catch (error) {
        return [{ id: `source:${trip.id}:source-stop-events-unresolved`, category: 'integrity' as const, severity: 'error' as const,
            code: 'source-stop-events-unresolved', message: error instanceof Error ? error.message : 'Invalid source stop events.',
            tripId: trip.id, blockId: trip.vehicleBlockKey, dayType: trip.dayType }];
    }
});

const unitsForTrip = (trip: PlanningTrip): PlanningTrip[] => {
    try { return strictUnitsForTrip(trip); } catch {
        // Keep source coverage inspectable, without authorizing an interior cut.
        // projectOperationsPlanningInput always attaches the blocking source finding.
        return [{ ...trip, id: `${trip.id}:unit:whole`, stopEvents: undefined }];
    }
};

/** Private exact-coverage units; never publish these IDs as replacement Master trips. */
export const projectOperationsPlanningInput = (input: OperationsPlanningInputV1): OperationsPlanningInputV1 => {
    if (input.schemaVersion === 1) return input;
    const unitsByTrip = new Map(input.trips.map(trip => [trip.id, unitsForTrip(trip)]));
    const sourceFindings = assessInteriorReliefSources(input);
    const trips = input.trips.flatMap(trip => unitsByTrip.get(trip.id)!);
    return { ...input, schemaVersion: 1, trips, blockAudits: input.blockAudits.map(audit => {
        const tripIds = audit.tripIds.flatMap(id => unitsByTrip.get(id)?.map(trip => trip.id) ?? fail(`Unknown source trip ${id}.`));
        return { ...audit, tripIds, membershipFingerprint: fingerprintValue(tripIds),
            findings: [...audit.findings, ...sourceFindings.filter(item => item.blockId === audit.vehicleBlockKey
                && !audit.findings.some(existing => existing.id === item.id))] };
    }) };
};

export const projectRun = (input: OperationsPlanningInputV1, run: DailyRun): DailyRun => {
    if (input.schemaVersion === 1) return run;
    const trips = new Map(input.trips.map(trip => [trip.id, trip]));
    return { ...run, pieces: run.pieces.map(piece => {
        const tripIds = piece.tripIds.flatMap((id, index) => {
            const trip = trips.get(id) ?? fail(`Piece ${piece.id} references unknown trip ${id}.`);
            const events = trip.stopEvents ?? fail(`Trip ${id} has no stop events.`);
            const start = index === 0 && piece.startEventId ? events.findIndex(event => event.id === piece.startEventId) : 0;
            const end = index === piece.tripIds.length - 1 && piece.endEventId ? events.findIndex(event => event.id === piece.endEventId) : events.length - 1;
            if (start < 0 || end < 0 || start >= end) return fail(`Piece ${piece.id} has unknown or reversed event boundaries.`);
            const units = unitsForTrip(trip);
            if (units[0]?.id.endsWith(':unit:whole')) {
                if (start !== 0 || end !== events.length - 1) return fail(`Piece ${piece.id} cannot cut an unresolved source trip.`);
                return units.map(unit => unit.id);
            }
            return units.slice(start, end).map(unit => unit.id);
        });
        const { startEventId: _start, endEventId: _end, ...rest } = piece;
        return { ...rest, tripIds };
    }) };
};

export const restoreOperationsPlanningProposal = (
    input: OperationsPlanningInputV1, proposal: OperationsPlanningProposalV1,
): OperationsPlanningProposalV1 => {
    if (input.schemaVersion === 1) return proposal;
    const byUnit = new Map(input.trips.flatMap(trip => unitsForTrip(trip).map((unit, index) => [unit.id, { trip, index,
        endIndex: unit.id.endsWith(':unit:whole') ? (trip.stopEvents?.length ?? 1) - 1 : index + 1 }] as const)));
    const restored: OperationsPlanningProposalV1 = { ...proposal, schemaVersion: 2, blockAudits: input.blockAudits, dailyRuns: proposal.dailyRuns.map(run => ({ ...run,
        pieces: run.pieces.map((piece): RunPiece => {
            const refs = piece.tripIds.map(id => byUnit.get(id) ?? fail(`Unknown unit ${id}.`));
            const first = refs[0];
            const last = refs.at(-1);
            if (!first || !last) return fail(`Piece ${piece.id} is empty.`);
            return { ...piece, tripIds: [...new Set(refs.map(ref => ref.trip.id))],
                startEventId: first.trip.stopEvents![first.index].id,
                endEventId: last.trip.stopEvents![last.endIndex].id };
        }),
    })) };
    restored.dailyRuns.forEach((run, index) => {
        const projected = projectRun(input, run);
        projected.pieces.forEach((piece, pieceIndex) => {
            if (piece.tripIds.join('|') !== proposal.dailyRuns[index].pieces[pieceIndex].tripIds.join('|'))
                fail(`Piece ${piece.id} cannot be restored without changing unit coverage; check gaps or ordering.`);
        });
    });
    return restored;
};
