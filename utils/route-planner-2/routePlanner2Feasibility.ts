import { validateRoutePlanner2Terminals } from './routePlanner2Authoring';
import { buildRoutePlanner2StopSegmentPairs, buildRoutePlanner2StopSegmentPaths, buildRoutePlanner2StopVisitSequence } from './routePlanner2Segments';
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
const GTFS_RUNTIME_EVIDENCE_SOURCES = new Set<RoutePlanner2SegmentRuntime['source']>([
    'observed-proxy',
    'observed-scheduled-blend',
    'partial-scheduled-proxy',
    'scheduled-proxy',
]);

function routeNamesOverlap(current: string[] | undefined, selected: string[]): boolean {
    if (!current || current.length === 0) return false;
    return current.some((route) => selected.includes(route));
}

function estimateAllowedByRuntimeRouteFilter(
    scenario: RoutePlanner2Scenario,
    estimate: RoutePlanner2SegmentRuntime,
): boolean {
    if (!GTFS_RUNTIME_EVIDENCE_SOURCES.has(estimate.source)) return true;
    if (scenario.runtimeRouteFilter?.mode !== 'selected') return true;

    const selectedRoutes = scenario.runtimeRouteFilter.routeShortNames.filter(Boolean);
    if (selectedRoutes.length === 0) return true;

    return routeNamesOverlap(estimate.matchedRoutes, selectedRoutes);
}

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
        recoveryTimeMinutes: null,
        recoveryPercent: null,
        confidence: 'not-ready',
        segmentSummaries: [],
        warnings,
    };
}

function deriveFallbackSegmentRuntime(from: RoutePlanner2Stop, to: RoutePlanner2Stop): number {
    const driveMinutes = (distanceKm(from, to) / FALLBACK_SPEED_KMH) * 60;
    return Math.max(2, Math.ceil(driveMinutes + 1));
}

function deriveSegmentSummaries(scenario: RoutePlanner2Scenario): RoutePlanner2SegmentRuntime[] {
    const segmentPaths = buildRoutePlanner2StopSegmentPaths(scenario);
    const segmentPairs = buildRoutePlanner2StopSegmentPairs(scenario);

    return segmentPairs.map(({ fromStop, toStop }): RoutePlanner2SegmentRuntime => {
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
}

function estimateMatchesCurrentPath(estimate: RoutePlanner2SegmentRuntime | undefined, pathFingerprint: string): boolean {
    if (!estimate) return false;
    if (!estimate.pathFingerprint) {
        return estimate.source === 'manual'
            || estimate.source === 'observed-proxy'
            || estimate.source === 'observed-scheduled-blend'
            || estimate.source === 'partial-scheduled-proxy'
            || estimate.source === 'scheduled-proxy';
    }
    return estimate.pathFingerprint === pathFingerprint;
}

function getExpectedEvidencePeriod(service: RoutePlanner2ServiceAssumptions): RoutePlanner2SegmentRuntime['evidencePeriod'] {
    if (!service.planningPeriod || service.planningPeriod === 'all-day') return 'full-day';
    return service.planningPeriod;
}

function getScheduledCycleWindowMinutes(service: RoutePlanner2ServiceAssumptions): number | null {
    const planningPeriod = service.planningPeriod ?? 'all-day';
    const scheduledCycleWindow = service.scheduledCycleWindows?.[planningPeriod]
        ?? service.scheduledCycleWindows?.['all-day'];
    const cycleTimeMinutes = scheduledCycleWindow?.cycleTimeMinutes;
    return isPositiveNumber(cycleTimeMinutes) ? cycleTimeMinutes : null;
}

function normalizeStopName(value: string): string {
    return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function stopsRepresentSamePlace(firstStop: RoutePlanner2Stop | undefined, lastStop: RoutePlanner2Stop | undefined): boolean {
    if (!firstStop || !lastStop) return false;
    const firstStopCode = firstStop.stopCode?.trim();
    const lastStopCode = lastStop.stopCode?.trim();
    if (firstStopCode && lastStopCode) return firstStopCode === lastStopCode;

    return normalizeStopName(firstStop.name) === normalizeStopName(lastStop.name)
        && Math.abs(firstStop.lat - lastStop.lat) < 0.00001
        && Math.abs(firstStop.lng - lastStop.lng) < 0.00001;
}

function isGtfsSinglePatternLoop(scenario: RoutePlanner2Scenario): boolean {
    if (scenario.source?.type !== 'gtfs' || scenario.routeShape !== 'one-way') return false;
    const sortedStops = [...scenario.stops].sort((a, b) => a.sequence - b.sequence);
    return sortedStops.length >= 2 && stopsRepresentSamePlace(sortedStops[0], sortedStops[sortedStops.length - 1]);
}

function scoreEstimateForServicePeriod(
    estimate: RoutePlanner2SegmentRuntime,
    service: RoutePlanner2ServiceAssumptions,
): number {
    let score = 0;
    const expectedDayType = service.dayType;
    const expectedPeriod = getExpectedEvidencePeriod(service);

    if (estimate.evidenceDayType) {
        if (expectedDayType && estimate.evidenceDayType !== expectedDayType) return -1;
        score += expectedDayType ? 4 : 1;
    } else {
        score += 1;
    }

    if (estimate.evidencePeriod) {
        if (estimate.evidencePeriod === expectedPeriod) return score + 8;
        if (estimate.evidencePeriod === 'full-day') return score + 3;
        return -1;
    }

    return score + 2;
}

function getCurrentSegmentEstimate(
    scenario: RoutePlanner2Scenario,
    fromStopId: string,
    toStopId: string,
    pathFingerprint: string,
): RoutePlanner2SegmentRuntime | null {
    const candidates = (scenario.runtimeEstimates ?? []).filter((item) =>
        item.fromStopId === fromStopId
        && item.toStopId === toStopId
        && estimateMatchesCurrentPath(item, pathFingerprint)
        && isPositiveNumber(item.runtimeMinutes ?? undefined)
        && (
            (scenario.runtimeSourceMode ?? 'gtfs') !== 'mapbox'
            || !GTFS_RUNTIME_EVIDENCE_SOURCES.has(item.source)
        )
        && estimateAllowedByRuntimeRouteFilter(scenario, item),
    );

    const rankedCandidates = candidates
        .map((estimate, index) => ({
            estimate,
            index,
            score: scoreEstimateForServicePeriod(estimate, scenario.service),
        }))
        .filter((candidate) => candidate.score >= 0)
        .sort((a, b) => b.score - a.score || a.index - b.index);

    return rankedCandidates[0]?.estimate ?? null;
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
    const hasTargetBusCount = service.targetBuses != null;
    const targetBuses = hasTargetBusCount && isPositiveNumber(service.targetBuses)
        ? Math.max(1, Math.ceil(service.targetBuses))
        : null;

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

    if (hasTargetBusCount && targetBuses == null) {
        warnings.push({
            id: 'invalid-target-buses',
            severity: 'blocking',
            message: 'Target bus count must be greater than zero.',
            action: 'Enter a positive bus count or leave the field blank to calculate it.',
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

    const suppressGtfsLayoverWarning = scenario.source?.type === 'gtfs' && targetBuses != null;
    if (!suppressGtfsLayoverWarning && (service.startTerminalLayoverMinutes < MIN_TERMINAL_LAYOVER_MINUTES || service.endTerminalLayoverMinutes < MIN_TERMINAL_LAYOVER_MINUTES)) {
        warnings.push({
            id: 'low-layover',
            severity: 'warning',
            message: 'One or more terminal layovers are below the recommended minimum.',
            action: `Use at least ${MIN_TERMINAL_LAYOVER_MINUTES} minutes unless there is a planning reason.`,
        });
    }

    const canEstimateOneWayRuntime = scenario.stops.length >= 2 && intermediateStopDwellSeconds >= 0 && Number.isFinite(intermediateStopDwellSeconds);

    if (!canEstimateOneWayRuntime) {
        return buildNotReadySummary(warnings);
    }

    const segmentSummaries = deriveSegmentSummaries(scenario);

    const segmentRuntimeMinutes = segmentSummaries.reduce((sum, segment) => sum + (segment.runtimeMinutes ?? 0), 0);
    const stopVisits = buildRoutePlanner2StopVisitSequence(scenario);
    const intermediateStopCount = stopVisits.filter((stop) =>
        stop.role !== 'start-terminal'
        && stop.role !== 'end-terminal'
        && stop.role !== 'turnaround',
    ).length;
    const dwellTimeMinutes = Math.round((intermediateStopCount * intermediateStopDwellSeconds) / 60);
    const oneWayRuntimeMinutes = segmentRuntimeMinutes + dwellTimeMinutes;
    const fallbackSegments = segmentSummaries.filter((segment) => segment.source === 'fallback');
    const evidenceSegments = segmentSummaries.filter((segment) =>
        segment.source === 'observed-proxy'
        || segment.source === 'observed-scheduled-blend'
        || segment.source === 'partial-scheduled-proxy'
        || segment.source === 'scheduled-proxy',
    );
    const evidenceSegmentRatio = segmentSummaries.length > 0
        ? evidenceSegments.length / segmentSummaries.length
        : 0;
    const fallbackSegmentRatio = segmentSummaries.length > 0
        ? fallbackSegments.length / segmentSummaries.length
        : 0;
    const allHighEvidence = segmentSummaries.length > 0
        && segmentSummaries.every((segment) =>
            segment.confidence === 'high'
            && (
                segment.source === 'observed-proxy'
                || segment.source === 'observed-scheduled-blend'
                || segment.source === 'partial-scheduled-proxy'
                || segment.source === 'scheduled-proxy'
            ),
        );
    if (fallbackSegments.length > 0) {
        warnings.push({
            id: 'fallback-runtime',
            severity: 'warning',
            message: `Runtime uses fallback assumptions for ${fallbackSegments.length} segment${fallbackSegments.length === 1 ? '' : 's'}.`,
            action: 'Review results as planning estimates until Mapbox, observed evidence, or manual overrides are available.',
        });
    }

    const hasBlockingWarnings = warnings.some((warning) => warning.severity === 'blocking');
    let cycleTimeMinutes: number | null = null;
    let busesRequired: number | null = null;
    let recoveryTimeMinutes: number | null = null;
    let recoveryPercent: number | null = null;
    let busThresholdBasisMinutes: number | null = null;

    if (!hasBlockingWarnings) {
        const scheduledCycleWindowMinutes = targetBuses != null ? getScheduledCycleWindowMinutes(service) : null;
        if (scenario.routeShape === 'closed-loop' || scenario.routeShape === 'out-and-back') {
            const fullRouteRuntimeMinutes = oneWayRuntimeMinutes;
            busesRequired = targetBuses ?? Math.max(1, Math.ceil(fullRouteRuntimeMinutes / service.frequencyMinutes));
            cycleTimeMinutes = scheduledCycleWindowMinutes ?? busesRequired * service.frequencyMinutes;
            busThresholdBasisMinutes = fullRouteRuntimeMinutes;
            recoveryTimeMinutes = cycleTimeMinutes - fullRouteRuntimeMinutes;
            recoveryPercent = fullRouteRuntimeMinutes > 0
                ? Math.round((recoveryTimeMinutes / fullRouteRuntimeMinutes) * 100)
                : null;
        } else {
            const gtfsSinglePatternLoop = isGtfsSinglePatternLoop(scenario);
            const estimatedFullRuntimeMinutes = gtfsSinglePatternLoop
                ? oneWayRuntimeMinutes
                : oneWayRuntimeMinutes * 2
                    + service.startTerminalLayoverMinutes
                    + service.endTerminalLayoverMinutes;
            busesRequired = targetBuses ?? Math.ceil(estimatedFullRuntimeMinutes / service.frequencyMinutes);
            const calculatedCycleWindowMinutes = busesRequired * service.frequencyMinutes;
            const activeCycleWindowMinutes = scheduledCycleWindowMinutes ?? calculatedCycleWindowMinutes;
            cycleTimeMinutes = targetBuses != null ? activeCycleWindowMinutes : estimatedFullRuntimeMinutes;
            busThresholdBasisMinutes = estimatedFullRuntimeMinutes;
            recoveryTimeMinutes = activeCycleWindowMinutes - estimatedFullRuntimeMinutes;
            recoveryPercent = estimatedFullRuntimeMinutes > 0
                ? Math.round((recoveryTimeMinutes / estimatedFullRuntimeMinutes) * 100)
                : null;
        }
    }

    if (recoveryTimeMinutes != null && recoveryTimeMinutes < 0) {
        warnings.push({
            id: 'target-bus-deficit',
            severity: 'warning',
            message: 'The target bus count is below the estimated runtime need.',
            action: 'Review frequency, runtime, layover, or bus count before treating this option as feasible.',
        });
    }

    if (busThresholdBasisMinutes != null && busesRequired != null) {
        const nextBusThreshold = targetBuses != null && cycleTimeMinutes != null
            ? cycleTimeMinutes
            : busesRequired * service.frequencyMinutes;
        if (nextBusThreshold - busThresholdBasisMinutes <= 3) {
            warnings.push({
                id: 'near-bus-threshold',
                severity: 'warning',
                message: 'Cycle time is close to requiring another bus.',
                action: 'Review frequency or layover before treating this option as feasible.',
            });
        }
    }

    return {
        oneWayRuntimeMinutes,
        segmentRuntimeMinutes,
        dwellTimeMinutes,
        intermediateStopCount,
        cycleTimeMinutes,
        busesRequired,
        recoveryTimeMinutes,
        recoveryPercent,
        confidence: hasBlockingWarnings
            ? 'not-ready'
            : allHighEvidence
                ? 'high'
                : evidenceSegmentRatio >= 0.5
                    ? 'medium'
                    : fallbackSegmentRatio > 0.5
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
