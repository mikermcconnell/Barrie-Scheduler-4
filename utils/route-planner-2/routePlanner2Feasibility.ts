import { validateRoutePlanner2Terminals } from './routePlanner2Authoring';
import { buildRoutePlanner2StopSegmentPaths } from './routePlanner2Segments';
import type {
    RoutePlanner2FeasibilitySummary,
    RoutePlanner2Project,
    RoutePlanner2Scenario,
    RoutePlanner2SegmentRuntime,
    RoutePlanner2ServiceAssumptions,
    RoutePlanner2Stop,
    RoutePlanner2Warning,
} from './routePlanner2Types';

const FALLBACK_SPEED_KMH = 22;
const MIN_TERMINAL_LAYOVER_MINUTES = 3;

function markChanged(project: RoutePlanner2Project, now: string): RoutePlanner2Project {
    return {
        ...project,
        status: project.status === 'archived' ? 'archived' : 'local-draft',
        updatedAt: now,
    };
}

function distanceKm(from: RoutePlanner2Stop, to: RoutePlanner2Stop): number {
    const radiusKm = 6371;
    const toRadians = (degrees: number) => degrees * Math.PI / 180;
    const dLat = toRadians(to.lat - from.lat);
    const dLng = toRadians(to.lng - from.lng);
    const lat1 = toRadians(from.lat);
    const lat2 = toRadians(to.lat);
    const a = Math.sin(dLat / 2) ** 2
        + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
    return 2 * radiusKm * Math.asin(Math.sqrt(a));
}

function isPositiveNumber(value: number | undefined): value is number {
    return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function buildNotReadySummary(warnings: RoutePlanner2Warning[]): RoutePlanner2FeasibilitySummary {
    return {
        oneWayRuntimeMinutes: null,
        segmentRuntimeMinutes: null,
        dwellTimeMinutes: 0,
        intermediateStopCount: 0,
        cycleTimeMinutes: null,
        busesRequired: null,
        confidence: 'not-ready',
        segmentSummaries: [],
        warnings,
    };
}

function deriveFallbackSegmentRuntime(from: RoutePlanner2Stop, to: RoutePlanner2Stop): number {
    const driveMinutes = (distanceKm(from, to) / FALLBACK_SPEED_KMH) * 60;
    return Math.max(2, Math.ceil(driveMinutes + 1));
}

function estimateMatchesCurrentPath(estimate: RoutePlanner2SegmentRuntime | undefined, pathFingerprint: string): boolean {
    if (!estimate) return false;
    if (!estimate.pathFingerprint) return estimate.source === 'manual' || estimate.source === 'observed-proxy';
    return estimate.pathFingerprint === pathFingerprint;
}

function getCurrentSegmentEstimate(
    scenario: RoutePlanner2Scenario,
    fromStopId: string,
    toStopId: string,
    pathFingerprint: string,
): RoutePlanner2SegmentRuntime | null {
    const estimate = scenario.runtimeEstimates?.find((item) =>
        item.fromStopId === fromStopId
        && item.toStopId === toStopId
        && estimateMatchesCurrentPath(item, pathFingerprint),
    );
    if (!estimate || !isPositiveNumber(estimate.runtimeMinutes ?? undefined)) return null;
    return estimate;
}

function getManualSegmentOverride(
    scenario: RoutePlanner2Scenario,
    segmentId: string,
    fromStopId: string,
    toStopId: string,
): RoutePlanner2SegmentRuntime | null {
    const override = scenario.runtimeOverrides?.[segmentId];
    if (!override || !isPositiveNumber(override.runtimeMinutes)) return null;

    return {
        id: segmentId,
        fromStopId,
        toStopId,
        runtimeMinutes: Math.round(override.runtimeMinutes),
        source: 'manual',
        confidence: 'medium',
        updatedAt: override.updatedAt,
    };
}

export function deriveRoutePlanner2Feasibility(scenario: RoutePlanner2Scenario): RoutePlanner2FeasibilitySummary {
    const warnings: RoutePlanner2Warning[] = [...validateRoutePlanner2Terminals(scenario)];
    const service = scenario.service;
    const intermediateStopDwellSeconds = service.intermediateStopDwellSeconds ?? 0;

    if (scenario.stops.length < 2) {
        warnings.push({
            id: 'fewer-than-two-stops',
            severity: 'blocking',
            message: 'Add at least two stops before estimating runtime.',
            action: 'Add a start terminal and an end terminal.',
        });
    }

    if (!isPositiveNumber(service.frequencyMinutes)) {
        warnings.push({
            id: 'invalid-frequency',
            severity: 'blocking',
            message: 'Target frequency must be greater than zero.',
            action: 'Enter a positive frequency in minutes.',
        });
    }

    if (service.startTerminalLayoverMinutes < 0 || service.endTerminalLayoverMinutes < 0) {
        warnings.push({
            id: 'invalid-layover',
            severity: 'blocking',
            message: 'Terminal layover assumptions cannot be negative.',
            action: 'Enter zero or more minutes at each terminal.',
        });
    }

    if (intermediateStopDwellSeconds < 0 || !Number.isFinite(intermediateStopDwellSeconds)) {
        warnings.push({
            id: 'invalid-dwell',
            severity: 'blocking',
            message: 'Intermediate stop dwell allowance cannot be negative.',
            action: 'Enter zero or more seconds per intermediate stop.',
        });
    }

    if (service.startTerminalLayoverMinutes < MIN_TERMINAL_LAYOVER_MINUTES || service.endTerminalLayoverMinutes < MIN_TERMINAL_LAYOVER_MINUTES) {
        warnings.push({
            id: 'low-layover',
            severity: 'warning',
            message: 'One or more terminal layovers are below the recommended minimum.',
            action: `Use at least ${MIN_TERMINAL_LAYOVER_MINUTES} minutes unless there is a planning reason.`,
        });
    }

    if (warnings.some((warning) => warning.severity === 'blocking')) {
        return buildNotReadySummary(warnings);
    }

    const segmentPaths = buildRoutePlanner2StopSegmentPaths(scenario);
    const sortedStops = [...scenario.stops].sort((a, b) => a.sequence - b.sequence);
    const segmentSummaries: RoutePlanner2SegmentRuntime[] = sortedStops.slice(0, -1).map((fromStop, index): RoutePlanner2SegmentRuntime => {
        const toStop = sortedStops[index + 1];
        if (!toStop) {
            return {
                id: `segment-${fromStop.id}-missing`,
                fromStopId: fromStop.id,
                toStopId: 'missing',
                runtimeMinutes: null,
                source: 'missing',
                confidence: 'missing',
                fallbackReason: 'Downstream stop is missing.',
            };
        }
        const segmentPath = segmentPaths.find((path) => path.fromStopId === fromStop.id && path.toStopId === toStop.id);
        const manualOverride = segmentPath
            ? getManualSegmentOverride(scenario, segmentPath.id, fromStop.id, toStop.id)
            : null;
        if (manualOverride) return manualOverride;

        const currentEstimate = segmentPath
            ? getCurrentSegmentEstimate(scenario, fromStop.id, toStop.id, segmentPath.pathFingerprint)
            : null;

        if (currentEstimate) {
            return {
                ...currentEstimate,
                id: `segment-${fromStop.id}-${toStop.id}`,
                runtimeMinutes: Math.round(currentEstimate.runtimeMinutes ?? 0),
            };
        }

        return {
            id: `segment-${fromStop.id}-${toStop.id}`,
            fromStopId: fromStop.id,
            toStopId: toStop.id,
            runtimeMinutes: deriveFallbackSegmentRuntime(fromStop, toStop),
            source: 'fallback',
            confidence: 'low',
            fallbackReason: 'Observed runtime evidence is not wired yet; using distance and default speed.',
        };
    });

    const segmentRuntimeMinutes = segmentSummaries.reduce((sum, segment) => sum + (segment.runtimeMinutes ?? 0), 0);
    const intermediateStopCount = sortedStops.filter((stop) => stop.role !== 'start-terminal' && stop.role !== 'end-terminal').length;
    const dwellTimeMinutes = Math.round((intermediateStopCount * intermediateStopDwellSeconds) / 60);
    const oneWayRuntimeMinutes = segmentRuntimeMinutes + dwellTimeMinutes;
    const cycleTimeMinutes = oneWayRuntimeMinutes * 2
        + service.startTerminalLayoverMinutes
        + service.endTerminalLayoverMinutes;
    const busesRequired = Math.ceil(cycleTimeMinutes / service.frequencyMinutes);

    const fallbackSegments = segmentSummaries.filter((segment) => segment.source === 'fallback');
    if (fallbackSegments.length > 0) {
        warnings.push({
            id: 'fallback-runtime',
            severity: 'warning',
            message: `Runtime uses fallback assumptions for ${fallbackSegments.length} segment${fallbackSegments.length === 1 ? '' : 's'}.`,
            action: 'Review results as planning estimates until Mapbox, observed evidence, or manual overrides are available.',
        });
    }

    const nextBusThreshold = busesRequired * service.frequencyMinutes;
    if (nextBusThreshold - cycleTimeMinutes <= 3) {
        warnings.push({
            id: 'near-bus-threshold',
            severity: 'warning',
            message: 'Cycle time is close to requiring another bus.',
            action: 'Review frequency or layover before treating this option as feasible.',
        });
    }

    return {
        oneWayRuntimeMinutes,
        segmentRuntimeMinutes,
        dwellTimeMinutes,
        intermediateStopCount,
        cycleTimeMinutes,
        busesRequired,
        confidence: fallbackSegments.length > 0
            ? 'low'
            : segmentSummaries.some((segment) => segment.source === 'mapbox' || segment.source === 'manual')
                ? 'medium'
                : 'low',
        segmentSummaries,
        warnings,
    };
}

export function updateRoutePlanner2Service(
    project: RoutePlanner2Project,
    scenarioId: string,
    servicePatch: Partial<RoutePlanner2ServiceAssumptions>,
    now = new Date().toISOString(),
): RoutePlanner2Project {
    let changed = false;
    const scenarios = project.scenarios.map((scenario) => {
        if (scenario.id !== scenarioId) return scenario;
        changed = true;
        return {
            ...scenario,
            service: { ...scenario.service, ...servicePatch },
            feasibility: undefined,
            updatedAt: now,
        };
    });

    return changed ? markChanged({ ...project, scenarios }, now) : project;
}
