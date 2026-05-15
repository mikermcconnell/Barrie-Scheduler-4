import { buildRoutePlanner2StopSegmentPairs, buildRoutePlanner2StopVisitSequence, sortRoutePlanner2Stops } from './routePlanner2Segments';
import type { RoutePlanner2FeasibilitySummary, RoutePlanner2Scenario, RoutePlanner2Stop } from './routePlanner2Types';

export interface RoutePlanner2StopCardDetail {
    stopId: string;
    kidsAtStop: number;
    runningKidsTotal: number;
    travelMinutes: number | null;
    travelTimeLabel: string;
    arrivalMinutes: number | null;
    arrivalLabel: string;
}

function parseClockTimeToMinutes(value: string | undefined): number | null {
    const match = value?.trim().match(/^(\d{1,2}):(\d{2})$/);
    if (!match) return null;
    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    if (!Number.isInteger(hours) || !Number.isInteger(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
        return null;
    }
    return (hours * 60) + minutes;
}

function formatClockTime(minutesFromServiceStart: number | null): string {
    if (minutesFromServiceStart == null) return 'Not set';
    const minutesInDay = ((minutesFromServiceStart % 1440) + 1440) % 1440;
    const hours24 = Math.floor(minutesInDay / 60);
    const minutes = minutesInDay % 60;
    const suffix = hours24 >= 12 ? 'PM' : 'AM';
    const hours12 = hours24 % 12 || 12;
    return `${hours12}:${String(minutes).padStart(2, '0')} ${suffix}`;
}

function toPositiveWholeNumber(value: unknown): number | null {
    const count = typeof value === 'string' ? Number(value) : value;
    return typeof count === 'number' && Number.isFinite(count) && count > 0 ? Math.round(count) : null;
}

export function getRoutePlanner2KidsAtStop(stop: RoutePlanner2Stop): number {
    const riderCount = toPositiveWholeNumber(stop.riderCount);
    if (riderCount != null) return riderCount;

    const sourceRowCount = Array.isArray(stop.sourceRows)
        ? toPositiveWholeNumber(stop.sourceRows.length)
        : null;
    return sourceRowCount ?? 0;
}

function formatTravelTime(minutesFromRouteStart: number | null): string {
    if (minutesFromRouteStart == null) return 'Not estimated';
    const minutes = Math.max(0, Math.round(minutesFromRouteStart));
    return `${minutes} min`;
}

function isIntermediateDwellStop(stop: RoutePlanner2Stop): boolean {
    return stop.role !== 'start-terminal' && stop.role !== 'end-terminal' && stop.role !== 'turnaround';
}

function getSegmentRuntime(
    feasibility: RoutePlanner2FeasibilitySummary | null | undefined,
    fromStopId: string,
    toStopId: string,
): number {
    const runtime = feasibility?.segmentSummaries.find((segment) =>
        segment.fromStopId === fromStopId && segment.toStopId === toStopId,
    )?.runtimeMinutes;
    return Number.isFinite(runtime) && runtime != null ? Math.max(0, Math.round(runtime)) : 0;
}

export function buildRoutePlanner2StopArrivalMinutes(
    scenario: RoutePlanner2Scenario,
    feasibility: RoutePlanner2FeasibilitySummary | null | undefined,
): Record<string, number | null> {
    const firstTripMinutes = parseClockTimeToMinutes(scenario.service.firstTripTime);
    const arrivalMinutesByStopId: Record<string, number | null> = {};

    if (firstTripMinutes == null) {
        return Object.fromEntries(scenario.stops.map((stop): [string, null] => [stop.id, null]));
    }

    const stopVisits = buildRoutePlanner2StopVisitSequence(scenario);
    const segmentPairs = buildRoutePlanner2StopSegmentPairs(scenario);
    let currentMinutes = firstTripMinutes;
    const dwellMinutes = Math.round((scenario.service.intermediateStopDwellSeconds ?? 0) / 60);

    if (stopVisits[0]) {
        arrivalMinutesByStopId[stopVisits[0].id] = currentMinutes;
    }

    segmentPairs.forEach(({ fromStop, toStop }, index) => {
        if (index > 0 && isIntermediateDwellStop(fromStop)) {
            currentMinutes += dwellMinutes;
        }
        currentMinutes += getSegmentRuntime(feasibility, fromStop.id, toStop.id);
        if (arrivalMinutesByStopId[toStop.id] == null) {
            arrivalMinutesByStopId[toStop.id] = currentMinutes;
        }
    });

    return arrivalMinutesByStopId;
}

export function buildRoutePlanner2StopTravelMinutes(
    scenario: RoutePlanner2Scenario,
    feasibility: RoutePlanner2FeasibilitySummary | null | undefined,
): Record<string, number | null> {
    const travelMinutesByStopId: Record<string, number | null> = {};
    const stopVisits = buildRoutePlanner2StopVisitSequence(scenario);
    const segmentPairs = buildRoutePlanner2StopSegmentPairs(scenario);
    let currentMinutes = 0;

    if (stopVisits[0]) {
        travelMinutesByStopId[stopVisits[0].id] = currentMinutes;
    }

    segmentPairs.forEach(({ fromStop, toStop }) => {
        currentMinutes += getSegmentRuntime(feasibility, fromStop.id, toStop.id);
        if (travelMinutesByStopId[toStop.id] == null) {
            travelMinutesByStopId[toStop.id] = currentMinutes;
        }
    });

    scenario.stops.forEach((stop) => {
        if (!(stop.id in travelMinutesByStopId)) {
            travelMinutesByStopId[stop.id] = null;
        }
    });

    return travelMinutesByStopId;
}

export function buildRoutePlanner2StopCardDetails(
    scenario: RoutePlanner2Scenario,
    feasibility: RoutePlanner2FeasibilitySummary | null | undefined,
): RoutePlanner2StopCardDetail[] {
    const arrivalMinutesByStopId = buildRoutePlanner2StopArrivalMinutes(scenario, feasibility);
    const travelMinutesByStopId = buildRoutePlanner2StopTravelMinutes(scenario, feasibility);
    let runningKidsTotal = 0;

    return sortRoutePlanner2Stops(scenario.stops).map((stop) => {
        const kidsAtStop = getRoutePlanner2KidsAtStop(stop);
        runningKidsTotal += kidsAtStop;
        const arrivalMinutes = arrivalMinutesByStopId[stop.id] ?? null;
        const travelMinutes = travelMinutesByStopId[stop.id] ?? null;

        return {
            stopId: stop.id,
            kidsAtStop,
            runningKidsTotal,
            travelMinutes,
            travelTimeLabel: formatTravelTime(travelMinutes),
            arrivalMinutes,
            arrivalLabel: formatClockTime(arrivalMinutes),
        };
    });
}
