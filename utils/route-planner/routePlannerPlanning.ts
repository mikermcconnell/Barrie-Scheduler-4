import { deriveRouteCoverageMetrics } from './routePlannerCoverage';
import type { RouteProject, RouteScenario, RouteStop } from './routePlannerTypes';

const EARTH_RADIUS_KM = 6371;
const DEFAULT_FALLBACK_SPEED_KMH = 22;
export const MIN_RELIABLE_ROUTE_RUNTIME_SAMPLES = 8;

function roundToOneDecimal(value: number): number {
    return Math.round(value * 10) / 10;
}

function toRadians(value: number): number {
    return (value * Math.PI) / 180;
}

function haversineDistanceKm(
    latitudeA: number,
    longitudeA: number,
    latitudeB: number,
    longitudeB: number
): number {
    const dLat = toRadians(latitudeB - latitudeA);
    const dLon = toRadians(longitudeB - longitudeA);
    const lat1 = toRadians(latitudeA);
    const lat2 = toRadians(latitudeB);

    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2)
        + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);

    return 2 * EARTH_RADIUS_KM * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function coordinatesEqual(first: [number, number], second: [number, number]): boolean {
    return Math.abs(first[0] - second[0]) < 0.000001 && Math.abs(first[1] - second[1]) < 0.000001;
}

function normalizeWaypoints(scenario: RouteScenario): [number, number][] {
    const rawWaypoints = scenario.waypoints.length > 0 ? scenario.waypoints : scenario.geometry.coordinates;
    const coordinates = rawWaypoints.filter((coordinate) =>
        Array.isArray(coordinate) && coordinate.length >= 2
    ) as [number, number][];

    if (scenario.pattern === 'loop' && coordinates.length > 1 && coordinatesEqual(coordinates[0], coordinates[coordinates.length - 1])) {
        return coordinates.slice(0, -1);
    }

    return coordinates;
}

function buildOutAndBackCoordinates(waypoints: [number, number][]): [number, number][] {
    if (waypoints.length < 2) return waypoints;
    return [...waypoints, ...waypoints.slice(0, -1).reverse()];
}

function normalizeGeometry(scenario: RouteScenario, waypoints: [number, number][]): GeoJSON.LineString {
    const coordinates = scenario.geometry.coordinates.filter((coordinate) =>
        Array.isArray(coordinate) && coordinate.length >= 2
    ) as [number, number][];

    if (coordinates.length > 1) {
        if (scenario.pattern === 'loop' && coordinates.length === waypoints.length) {
            return {
                type: 'LineString',
                coordinates: [...coordinates, coordinates[0]],
            };
        }
        if (scenario.pattern === 'out-and-back' && coordinates.length <= waypoints.length) {
            return {
                type: 'LineString',
                coordinates: buildOutAndBackCoordinates(waypoints),
            };
        }
        return { type: 'LineString', coordinates };
    }

    if (scenario.pattern === 'out-and-back') {
        return {
            type: 'LineString',
            coordinates: buildOutAndBackCoordinates(waypoints),
        };
    }

    if (scenario.pattern !== 'loop' || waypoints.length < 3) {
        return { type: 'LineString', coordinates: waypoints };
    }

    return {
        type: 'LineString',
        coordinates: [...waypoints, waypoints[0]],
    };
}

function calculateDistanceKm(coordinates: [number, number][]): number {
    if (coordinates.length < 2) return 0;

    let total = 0;
    for (let index = 1; index < coordinates.length; index += 1) {
        const [previousLon, previousLat] = coordinates[index - 1];
        const [nextLon, nextLat] = coordinates[index];
        total += haversineDistanceKm(previousLat, previousLon, nextLat, nextLon);
    }

    return roundToOneDecimal(total);
}

function clampMinutes(value: number | null | undefined, fallback: number): number {
    if (!Number.isFinite(value) || value === undefined || value === null || value <= 0) return fallback;
    return Math.round(value);
}

function parseClockToMinutes(value: string): number | null {
    const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
    if (!match) return null;

    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
    return (hours * 60) + minutes;
}

function formatMinutesToClock(totalMinutes: number): string {
    const normalized = ((totalMinutes % 1440) + 1440) % 1440;
    const hours = Math.floor(normalized / 60);
    const minutes = normalized % 60;
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
}

function normalizeServiceWindow(firstDeparture: string, lastDeparture: string): { start: number; end: number } | null {
    const start = parseClockToMinutes(firstDeparture);
    const end = parseClockToMinutes(lastDeparture);
    if (start === null || end === null) return null;

    return {
        start,
        end: end < start ? end + 1440 : end,
    };
}

function calculateServiceSpanHours(firstDeparture: string, lastDeparture: string, frequencyMinutes: number): number {
    const window = normalizeServiceWindow(firstDeparture, lastDeparture);
    if (!window) return 0;

    const serviceMinutes = Math.max(0, window.end - window.start) + Math.max(0, frequencyMinutes);
    return roundToOneDecimal(serviceMinutes / 60);
}

function buildDepartures(firstDeparture: string, lastDeparture: string, frequencyMinutes: number): string[] {
    const window = normalizeServiceWindow(firstDeparture, lastDeparture);
    const safeFrequency = clampMinutes(frequencyMinutes, 15);

    if (!window) return [];

    const departures: string[] = [];
    for (let cursor = window.start; cursor <= window.end; cursor += safeFrequency) {
        departures.push(formatMinutesToClock(cursor));
    }

    return departures;
}

function normalizeTimingProfile(
    value: RouteScenario['timingProfile'] | undefined
): RouteScenario['timingProfile'] {
    if (value === 'front_loaded' || value === 'back_loaded') return value;
    return 'balanced';
}

function applyTimingProfile(position: number, profile: RouteScenario['timingProfile']): number {
    if (profile === 'front_loaded') return Math.pow(position, 0.8);
    if (profile === 'back_loaded') return Math.pow(position, 1.25);
    return position;
}

function buildDefaultStopOffsets(
    stopCount: number,
    runtimeMinutes: number,
    timingProfile: RouteScenario['timingProfile'],
    startTerminalHoldMinutes: number,
    endTerminalHoldMinutes: number
): number[] {
    if (stopCount <= 1) return [0];
    if (stopCount === 2) return [0, runtimeMinutes];

    const availableRuntime = Math.max(0, runtimeMinutes - startTerminalHoldMinutes - endTerminalHoldMinutes);
    const offsets = Array.from({ length: stopCount }, (_, index) => {
        if (index === 0) return 0;
        if (index === stopCount - 1) return runtimeMinutes;

        const position = index / (stopCount - 1);
        return Math.round(
            startTerminalHoldMinutes
            + (applyTimingProfile(position, timingProfile) * availableRuntime)
        );
    });

    for (let index = 1; index < offsets.length; index += 1) {
        offsets[index] = Math.min(runtimeMinutes, Math.max(offsets[index], offsets[index - 1]));
    }

    offsets[offsets.length - 1] = runtimeMinutes;
    return offsets;
}

function deriveStopTimes(
    stops: RouteStop[],
    firstDeparture: string,
    runtimeMinutes: number,
    timingProfile: RouteScenario['timingProfile'],
    startTerminalHoldMinutes: number,
    endTerminalHoldMinutes: number
): RouteStop[] {
    if (stops.length === 0) return stops;

    const departureMinutes = parseClockToMinutes(firstDeparture);
    if (departureMinutes === null) return stops;

    if (stops.length === 1) {
        return [{
            ...stops[0],
            timeLabel: firstDeparture,
        }];
    }

    const defaultOffsets = buildDefaultStopOffsets(
        stops.length,
        runtimeMinutes,
        timingProfile,
        startTerminalHoldMinutes,
        endTerminalHoldMinutes
    );
    const anchorOffsets = new Map<number, number>();
    anchorOffsets.set(0, 0);
    anchorOffsets.set(stops.length - 1, runtimeMinutes);
    let lastAnchorOffset = 0;
    const latestInteriorOffset = Math.max(1, runtimeMinutes - Math.max(0, endTerminalHoldMinutes) - 1);

    for (let index = 1; index < stops.length - 1; index += 1) {
        const rawOffset = stops[index]?.plannedOffsetMinutes;
        if (!Number.isFinite(rawOffset) || rawOffset === null || rawOffset === undefined) continue;

        const earliestOffset = Math.max(lastAnchorOffset + 1, Math.max(1, startTerminalHoldMinutes));
        const sanitizedOffset = Math.max(earliestOffset, Math.min(latestInteriorOffset, Math.round(rawOffset)));
        anchorOffsets.set(index, sanitizedOffset);
        lastAnchorOffset = sanitizedOffset;
    }

    const anchorIndices = [...anchorOffsets.keys()].sort((left, right) => left - right);
    const offsetsByIndex = new Map<number, number>();

    for (let anchorIndex = 0; anchorIndex < anchorIndices.length - 1; anchorIndex += 1) {
        const startIndex = anchorIndices[anchorIndex];
        const endIndex = anchorIndices[anchorIndex + 1];
        const startOffset = anchorOffsets.get(startIndex) ?? 0;
        const endOffset = anchorOffsets.get(endIndex) ?? runtimeMinutes;
        const defaultStartOffset = defaultOffsets[startIndex] ?? startOffset;
        const defaultEndOffset = defaultOffsets[endIndex] ?? endOffset;
        const defaultSpan = defaultEndOffset - defaultStartOffset;

        for (let index = startIndex; index <= endIndex; index += 1) {
            const defaultOffset = defaultOffsets[index] ?? startOffset;
            const ratio = defaultSpan <= 0
                ? (endIndex === startIndex ? 0 : (index - startIndex) / (endIndex - startIndex))
                : (defaultOffset - defaultStartOffset) / defaultSpan;
            offsetsByIndex.set(index, Math.round(startOffset + ((endOffset - startOffset) * ratio)));
        }
    }

    return stops.map((stop, index) => {
        const offsetMinutes = offsetsByIndex.get(index) ?? defaultOffsets[index] ?? Math.round((runtimeMinutes * index) / (stops.length - 1));
        return {
            ...stop,
            timeLabel: formatMinutesToClock(departureMinutes + offsetMinutes),
        };
    });
}

function deriveRuntimeMinutes(scenario: RouteScenario, distanceKm: number): number {
    const manualRuntime = clampMinutes(scenario.runtimeInputs.manualRuntimeMinutes, 0);
    const observedRuntime = clampMinutes(scenario.runtimeInputs.observedRuntimeMinutes, 0);

    if (scenario.runtimeSourceMode === 'observed_proxy' && observedRuntime > 0) return observedRuntime;
    if (scenario.runtimeSourceMode === 'manual_override' && manualRuntime > 0) return manualRuntime;

    if (observedRuntime > 0) return observedRuntime;
    if (manualRuntime > 0) return manualRuntime;

    if (distanceKm <= 0) return 0;
    return Math.max(1, Math.round((distanceKm / DEFAULT_FALLBACK_SPEED_KMH) * 60));
}

function buildWarnings(
    scenario: RouteScenario,
    normalizedGeometry: GeoJSON.LineString,
    runtimeMinutes: number,
    cycleMinutes: number,
    busesRequired: number,
    departures: string[]
): string[] {
    const warnings: string[] = [];

    if (normalizedGeometry.coordinates.length < 2) {
        warnings.push('Add at least two route points to define an alignment.');
    }

    if (scenario.stops.length < 2) {
        warnings.push('Add at least two stops before relying on the timetable preview.');
    }

    if (departures.length === 0) {
        warnings.push('Enter a valid service span to generate departures.');
    }

    if (scenario.layoverMinutes < 5) {
        warnings.push('Recovery is tight. Consider at least 5 minutes of layover for review-ready planning.');
    }

    if (scenario.frequencyMinutes < cycleMinutes && scenario.frequencyMinutes > 0) {
        warnings.push('Cycle time is longer than the headway. A single bus cannot hold this frequency.');
    }

    if (busesRequired > 2) {
        warnings.push(`Current headway requires ${busesRequired} buses. Confirm fleet availability before advancing.`);
    }

    if (scenario.runtimeSourceMode === 'fallback_estimate') {
        warnings.push('Runtime is using fallback distance-based estimation. Replace with observed or manual planning inputs when available.');
    }

    if (scenario.runtimeSourceMode === 'observed_proxy') {
        const sampleCount = scenario.runtimeInputs.observedSampleCount ?? 0;
        if (sampleCount < MIN_RELIABLE_ROUTE_RUNTIME_SAMPLES) {
            warnings.push(`Observed proxy runtime has low confidence (${sampleCount} samples). Confirm with manual review.`);
        }

        const matchedSegments = scenario.runtimeInputs.observedMatchedSegments ?? 0;
        const totalSegments = scenario.runtimeInputs.observedTotalSegments ?? 0;
        if (totalSegments > 0 && matchedSegments < totalSegments) {
            warnings.push(`Observed proxy runtime covers ${matchedSegments} of ${totalSegments} stop segments. Remaining segments use fallback estimates.`);
        }
    }

    if (runtimeMinutes <= 0 && normalizedGeometry.coordinates.length >= 2) {
        warnings.push('Runtime is zero or invalid. Check route geometry or runtime inputs.');
    }

    if (scenario.stops[0] && scenario.stops[0].role !== 'terminal') {
        warnings.push('First stop should be marked terminal for schedule-ready timing.');
    }

    if (scenario.stops.length > 1 && scenario.stops[scenario.stops.length - 1]?.role !== 'terminal') {
        warnings.push('Last stop should be marked terminal for schedule-ready timing.');
    }

    if (
        runtimeMinutes > 0
        && scenario.stops.length > 2
        && (scenario.startTerminalHoldMinutes + scenario.endTerminalHoldMinutes) >= runtimeMinutes
    ) {
        warnings.push('Terminal hold assumptions leave no runtime for interior movement. Reduce terminal holds or increase runtime.');
    }

    let previousAnchorOffset = 0;
    scenario.stops.forEach((stop, index) => {
        const isInteriorStop = index > 0 && index < scenario.stops.length - 1;
        if (!isInteriorStop) return;

        if (stop.role === 'timed' && (stop.plannedOffsetMinutes === null || stop.plannedOffsetMinutes === undefined)) {
            warnings.push(`Timed stop "${stop.name}" is using interpolated timing. Add a timing anchor for schedule-ready handoff.`);
        }

        if (stop.role === 'regular' && stop.plannedOffsetMinutes !== null && stop.plannedOffsetMinutes !== undefined) {
            warnings.push(`Stop "${stop.name}" has a manual timing anchor but is marked regular. Consider marking it as a timed stop.`);
        }

        if (stop.plannedOffsetMinutes !== null && stop.plannedOffsetMinutes !== undefined) {
            const anchorOffset = Math.round(stop.plannedOffsetMinutes);
            if (anchorOffset <= 0 || anchorOffset >= runtimeMinutes) {
                warnings.push(`Timing anchor "${stop.name}" falls outside the trip runtime. Adjust it to sit between the terminals.`);
            }
            if (anchorOffset <= previousAnchorOffset) {
                warnings.push(`Timing anchor "${stop.name}" is not later than the previous anchor. Adjust anchor order for a valid timetable.`);
            }
            previousAnchorOffset = Math.max(previousAnchorOffset + 1, anchorOffset);
        }
    });

    return warnings;
}

export function deriveRouteScenario(scenario: RouteScenario): RouteScenario {
    const waypoints = normalizeWaypoints(scenario);
    const geometry = normalizeGeometry(scenario, waypoints);
    const distanceKm = calculateDistanceKm(geometry.coordinates as [number, number][]);
    const runtimeMinutes = deriveRuntimeMinutes(scenario, distanceKm);
    const layoverMinutes = clampMinutes(scenario.layoverMinutes, 5);
    const frequencyMinutes = clampMinutes(scenario.frequencyMinutes, 15);
    const timingProfile = normalizeTimingProfile(scenario.timingProfile);
    const startTerminalHoldMinutes = clampMinutes(scenario.startTerminalHoldMinutes, 0);
    const endTerminalHoldMinutes = clampMinutes(scenario.endTerminalHoldMinutes, 0);
    const cycleMinutes = scenario.pattern === 'out-and-back'
        ? (runtimeMinutes * 2) + layoverMinutes
        : runtimeMinutes + layoverMinutes;
    const busesRequired = Math.max(1, Math.ceil(cycleMinutes / frequencyMinutes));
    const departures = buildDepartures(scenario.firstDeparture, scenario.lastDeparture, frequencyMinutes);
    const stops = deriveStopTimes(
        scenario.stops,
        scenario.firstDeparture,
        runtimeMinutes,
        timingProfile,
        startTerminalHoldMinutes,
        endTerminalHoldMinutes
    );
    const warnings = buildWarnings(
        {
            ...scenario,
            stops,
            layoverMinutes,
            frequencyMinutes,
            timingProfile,
            startTerminalHoldMinutes,
            endTerminalHoldMinutes,
            runtimeMinutes,
        },
        geometry,
        runtimeMinutes,
        cycleMinutes,
        busesRequired,
        departures
    );
    const serviceHours = calculateServiceSpanHours(scenario.firstDeparture, scenario.lastDeparture, frequencyMinutes);
    const coverage = deriveRouteCoverageMetrics({
        ...scenario,
        waypoints,
        geometry,
        distanceKm,
        runtimeMinutes,
        cycleMinutes,
        busesRequired,
        serviceHours,
        frequencyMinutes,
        layoverMinutes,
        timingProfile,
        startTerminalHoldMinutes,
        endTerminalHoldMinutes,
        departures,
        stops,
        warnings,
    });
    const status = warnings.length > 0
        ? 'draft'
        : scenario.status === 'ready_for_review'
            ? 'ready_for_review'
            : 'draft';

    return {
        ...scenario,
        waypoints,
        geometry,
        distanceKm,
        runtimeMinutes,
        cycleMinutes,
        busesRequired,
        serviceHours,
        frequencyMinutes,
        layoverMinutes,
        timingProfile,
        startTerminalHoldMinutes,
        endTerminalHoldMinutes,
        coverage,
        departures,
        stops,
        warnings,
        status,
    };
}

export function deriveRouteProject(project: RouteProject): RouteProject {
    const scenarios = project.scenarios.map((scenario) => deriveRouteScenario(scenario));
    const preferredScenarioId = scenarios.some((scenario) => scenario.id === project.preferredScenarioId)
        ? project.preferredScenarioId
        : scenarios[0]?.id ?? null;

    return {
        ...project,
        preferredScenarioId,
        scenarios,
    };
}
