import { normalizeRouteConceptServiceSpan } from './routeConceptPlannerTime';
import type {
    ConceptStop,
    RouteConceptAlternative,
    RouteConceptConfidence,
    RouteConceptDailyMetrics,
    RouteConceptFeasibility,
    RouteConceptIssue,
    RouteConceptPattern,
    RouteConceptResolvedSegment,
    RouteConceptSegmentRuntimeEvidence,
} from './routeConceptPlannerTypes';

interface SegmentReference {
    id: string;
    fromStopId: string;
    toStopId: string;
}

function segmentKey(fromStopId: string, toStopId: string): string {
    return `${fromStopId}->${toStopId}`;
}

function sortedStops(pattern: RouteConceptPattern): ConceptStop[] {
    return [...pattern.stops].sort((a, b) => a.sequence - b.sequence);
}

function getPatternTraversal(pattern: RouteConceptPattern): ConceptStop[] {
    const stops = sortedStops(pattern);
    if (pattern.role === 'loop' && stops.length > 1) return [...stops, stops[0]!];
    if (pattern.role === 'out-and-back' && stops.length > 1) {
        return [...stops, ...stops.slice(0, -1).reverse()];
    }
    return stops;
}

function getSegmentReferences(pattern: RouteConceptPattern): SegmentReference[] {
    const traversal = getPatternTraversal(pattern);
    return traversal.slice(0, -1).map((stop, index) => {
        const nextStop = traversal[index + 1]!;
        return {
            id: segmentKey(stop.id, nextStop.id),
            fromStopId: stop.id,
            toStopId: nextStop.id,
        };
    });
}

function isCurrentPath(
    evidenceFingerprint: string | undefined,
    currentFingerprint: string | undefined,
): boolean {
    if (currentFingerprint == null) return evidenceFingerprint == null;
    return evidenceFingerprint === currentFingerprint;
}

function selectGtfsEvidence(
    candidates: RouteConceptSegmentRuntimeEvidence[],
    alternative: RouteConceptAlternative,
): RouteConceptSegmentRuntimeEvidence | undefined {
    const forDay = candidates.filter((candidate) =>
        candidate.dayType == null || candidate.dayType === alternative.service.dayType,
    );
    return forDay.find((candidate) => candidate.planningPeriod === alternative.service.planningPeriod)
        ?? forDay.find((candidate) => candidate.planningPeriod === 'all-day')
        ?? forDay.find((candidate) => candidate.planningPeriod == null);
}

function resolveSegment(
    pattern: RouteConceptPattern,
    reference: SegmentReference,
    alternative: RouteConceptAlternative,
): RouteConceptResolvedSegment {
    const currentFingerprint = pattern.segmentFingerprints?.[reference.id];
    const override = pattern.runtimeOverrides[reference.id];
    if (override) {
        const pathMatches = isCurrentPath(override.pathFingerprint, currentFingerprint);
        return {
            ...reference,
            patternId: pattern.id,
            runtimeMinutes: Number.isFinite(override.runtimeMinutes) && override.runtimeMinutes >= 0
                ? Math.round(override.runtimeMinutes)
                : null,
            source: 'manual',
            confidence: 'medium',
            pathFingerprint: override.pathFingerprint,
            requiresManualConfirmation: !override.confirmed || !pathMatches,
        };
    }

    const candidates = pattern.runtimeEvidence.filter((evidence) =>
        evidence.fromStopId === reference.fromStopId
        && evidence.toStopId === reference.toStopId
        && Number.isFinite(evidence.runtimeMinutes)
        && evidence.runtimeMinutes >= 0
        && isCurrentPath(evidence.pathFingerprint, currentFingerprint),
    );
    const gtfs = selectGtfsEvidence(candidates.filter((candidate) => candidate.source === 'gtfs'), alternative);
    const selected = gtfs
        ?? candidates.find((candidate) => candidate.source === 'mapbox')
        ?? candidates.find((candidate) => candidate.source === 'fallback');

    if (!selected) {
        return {
            ...reference,
            patternId: pattern.id,
            runtimeMinutes: null,
            source: 'missing',
            confidence: 'missing',
            pathFingerprint: currentFingerprint,
            requiresManualConfirmation: false,
        };
    }

    return {
        ...reference,
        patternId: pattern.id,
        runtimeMinutes: Math.round(selected.runtimeMinutes),
        source: selected.source,
        confidence: selected.source === 'gtfs' ? 'high' : selected.source === 'fallback' ? 'low' : 'medium',
        pathFingerprint: selected.pathFingerprint,
        requiresManualConfirmation: false,
        fallbackReason: selected.fallbackReason,
        evidenceDayType: selected.dayType,
        evidencePlanningPeriod: selected.planningPeriod,
    };
}

function requiredPatternRoles(alternative: RouteConceptAlternative): RouteConceptPattern['role'][] {
    if (alternative.structure === 'bidirectional') return ['outbound', 'inbound'];
    if (alternative.structure === 'loop') return ['loop'];
    // Keep schema-v1 legacy projects readable while all newly created out-and-back
    // alternatives use separately editable outbound and return patterns.
    return alternative.patterns.some((pattern) => pattern.role === 'out-and-back')
        ? ['out-and-back']
        : ['outbound', 'inbound'];
}

function activePatterns(alternative: RouteConceptAlternative): RouteConceptPattern[] {
    return requiredPatternRoles(alternative)
        .map((role) => alternative.patterns.find((pattern) => pattern.role === role))
        .filter((pattern): pattern is RouteConceptPattern => pattern != null);
}

function deriveDwellMinutes(patterns: RouteConceptPattern[], dwellSeconds: number): number {
    if (!Number.isFinite(dwellSeconds) || dwellSeconds < 0) return 0;
    const dwellVisits = patterns.reduce((total, pattern) => {
        const traversal = getPatternTraversal(pattern);
        return total + traversal.slice(1, -1).filter((stop) => stop.role === 'regular' || stop.role === 'timed').length;
    }, 0);
    return Math.round((dwellVisits * dwellSeconds) / 60);
}

function deriveConfidence(segments: RouteConceptResolvedSegment[], blocking: boolean): RouteConceptConfidence {
    if (blocking || segments.length === 0 || segments.some((segment) => segment.source === 'missing')) return 'not-ready';
    if (segments.some((segment) => segment.source === 'fallback')) return 'low';
    if (segments.every((segment) => segment.source === 'gtfs')) return 'high';
    return 'medium';
}

function rounded(value: number, decimals = 1): number {
    const factor = 10 ** decimals;
    return Math.round(value * factor) / factor;
}

function deriveDailyMetrics(
    alternative: RouteConceptAlternative,
    patterns: RouteConceptPattern[],
    completeRouteRuntimeMinutes: number,
    scheduledCycleWindowMinutes: number,
): RouteConceptDailyMetrics | null {
    const span = normalizeRouteConceptServiceSpan(
        alternative.service.firstDepartureMinutes,
        alternative.service.lastDepartureMinutes,
    );
    const frequency = alternative.service.frequencyMinutes;
    if (!span || !Number.isFinite(frequency) || frequency <= 0) return null;

    const departures = Math.floor(span.serviceSpanMinutes / frequency) + 1;
    const revenueMinutes = completeRouteRuntimeMinutes * departures;
    return {
        serviceSpanMinutes: span.serviceSpanMinutes,
        departuresPerStartingTerminal: departures,
        totalDepartures: departures * patterns.length,
        revenueHours: rounded(revenueMinutes / 60, 2),
        vehicleHours: rounded((departures * scheduledCycleWindowMinutes) / 60, 2),
    };
}

function validateStructure(alternative: RouteConceptAlternative, issues: RouteConceptIssue[]): RouteConceptPattern[] {
    const roles = requiredPatternRoles(alternative);
    const patterns = activePatterns(alternative);
    for (const role of roles) {
        const matches = alternative.patterns.filter((pattern) => pattern.role === role);
        if (matches.length !== 1) {
            issues.push({
                id: `pattern-${role}-${matches.length === 0 ? 'missing' : 'duplicate'}`,
                severity: 'blocking',
                message: matches.length === 0 ? `The ${role} pattern is missing.` : `More than one ${role} pattern is assigned.`,
                action: 'Assign exactly one required pattern to this complete-route alternative.',
            });
        }
    }
    for (const pattern of patterns) {
        if (pattern.stops.length < 2) {
            issues.push({
                id: `pattern-${pattern.id}-stops`,
                severity: 'blocking',
                message: `${pattern.name} needs at least two stops.`,
                action: 'Add stops in travel order.',
                patternId: pattern.id,
            });
            continue;
        }

        const orderedStops = sortedStops(pattern);
        if (orderedStops[0]?.role !== 'start-terminal') {
            issues.push({
                id: `pattern-${pattern.id}-start-terminal`,
                severity: 'blocking',
                message: `${pattern.name} needs a start terminal at its first stop.`,
                action: 'Mark the first stop as the start terminal.',
                patternId: pattern.id,
            });
        }
        if ((pattern.role === 'outbound' || pattern.role === 'inbound') && orderedStops.at(-1)?.role !== 'end-terminal') {
            issues.push({
                id: `pattern-${pattern.id}-end-terminal`,
                severity: 'blocking',
                message: `${pattern.name} needs an end terminal at its final stop.`,
                action: 'Mark the final stop as the end terminal.',
                patternId: pattern.id,
            });
        }
        if (pattern.role === 'out-and-back' && orderedStops.at(-1)?.role !== 'turnaround') {
            issues.push({
                id: `pattern-${pattern.id}-turnaround`,
                severity: 'blocking',
                message: `${pattern.name} needs a bus turnaround at its far end.`,
                action: 'Mark the final stop as a bus-safe turnaround.',
                patternId: pattern.id,
            });
        }
    }
    if (alternative.structure === 'out-and-back' && !patterns.some((pattern) => pattern.role === 'out-and-back')) {
        const outbound = patterns.find((pattern) => pattern.role === 'outbound');
        const inbound = patterns.find((pattern) => pattern.role === 'inbound');
        const outboundEnd = outbound ? sortedStops(outbound).at(-1) : undefined;
        const returnStart = inbound ? sortedStops(inbound)[0] : undefined;
        if (outboundEnd && outboundEnd.role !== 'turnaround') {
            issues.push({ id: 'out-and-back-outbound-turnaround', severity: 'blocking', message: 'Outbound must end at the turnaround.', action: 'Mark the final outbound stop as the turnaround.', patternId: outbound?.id });
        }
        if (returnStart && returnStart.role !== 'turnaround') {
            issues.push({ id: 'out-and-back-return-turnaround', severity: 'blocking', message: 'Return must begin at the turnaround.', action: 'Mark the first return stop as the turnaround.', patternId: inbound?.id });
        }
    }
    return patterns;
}

export function deriveRouteConceptFeasibility(alternative: RouteConceptAlternative): RouteConceptFeasibility {
    const issues: RouteConceptIssue[] = [];
    const patterns = validateStructure(alternative, issues);
    const service = alternative.service;
    if (!Number.isFinite(service.frequencyMinutes) || service.frequencyMinutes <= 0) {
        issues.push({ id: 'invalid-frequency', severity: 'blocking', message: 'Frequency must be greater than zero.', action: 'Enter a valid frequency.' });
    }
    if (
        !Number.isFinite(service.startTerminalLayoverMinutes)
        || service.startTerminalLayoverMinutes < 0
        || !Number.isFinite(service.endTerminalLayoverMinutes)
        || service.endTerminalLayoverMinutes < 0
    ) {
        issues.push({ id: 'invalid-layover', severity: 'blocking', message: 'Terminal layovers must be zero or greater.', action: 'Enter valid terminal layovers.' });
    }
    if (!normalizeRouteConceptServiceSpan(service.firstDepartureMinutes, service.lastDepartureMinutes)) {
        issues.push({ id: 'invalid-service-span', severity: 'blocking', message: 'The service span is invalid.', action: 'Enter valid first and last departures.' });
    }
    if (service.testedBuses != null && (!Number.isInteger(service.testedBuses) || service.testedBuses <= 0)) {
        issues.push({ id: 'invalid-tested-buses', severity: 'blocking', message: 'Buses being tested must be a whole number greater than zero.', action: 'Enter a valid bus count or clear it.' });
    }

    const segments = patterns.flatMap((pattern) =>
        getSegmentReferences(pattern).map((reference) => resolveSegment(pattern, reference, alternative)),
    );
    for (const segment of segments) {
        if (segment.source === 'missing') {
            issues.push({ id: `missing-runtime-${segment.patternId}-${segment.id}`, severity: 'blocking', message: 'A segment has no usable runtime.', action: 'Calculate or enter a runtime.', patternId: segment.patternId, segmentId: segment.id });
        } else if (segment.requiresManualConfirmation) {
            issues.push({ id: `confirm-runtime-${segment.patternId}-${segment.id}`, severity: 'blocking', message: 'A planner override must be reconfirmed after the path changed.', action: 'Review and confirm the override.', patternId: segment.patternId, segmentId: segment.id });
        }
    }
    if (segments.some((segment) => segment.source === 'fallback')) {
        issues.push({ id: 'fallback-runtime', severity: 'warning', message: 'One or more segments use fallback travel times.', action: 'Review the fallback assumptions before selecting this option.' });
    }

    const patternRuntimes = new Map<string, number>();
    for (const pattern of patterns) {
        const patternSegments = segments.filter((segment) => segment.patternId === pattern.id);
        if (patternSegments.length > 0 && patternSegments.every((segment) => segment.runtimeMinutes != null)) {
            patternRuntimes.set(pattern.id, patternSegments.reduce((sum, segment) => sum + (segment.runtimeMinutes ?? 0), 0));
        }
    }
    const dwellTimeMinutes = deriveDwellMinutes(patterns, service.intermediateStopDwellSeconds);
    const runtimeComplete = patterns.length === requiredPatternRoles(alternative).length
        && patterns.every((pattern) => patternRuntimes.has(pattern.id));
    const completeRouteRuntimeMinutes = runtimeComplete
        ? Array.from(patternRuntimes.values()).reduce((sum, value) => sum + value, 0) + dwellTimeMinutes
        : null;
    const validFrequency = Number.isFinite(service.frequencyMinutes) && service.frequencyMinutes > 0;
    const validLayovers = Number.isFinite(service.startTerminalLayoverMinutes) && service.startTerminalLayoverMinutes >= 0
        && Number.isFinite(service.endTerminalLayoverMinutes) && service.endTerminalLayoverMinutes >= 0;
    const cycleRequirementMinutes = completeRouteRuntimeMinutes != null && validLayovers
        ? completeRouteRuntimeMinutes + Math.round(service.startTerminalLayoverMinutes) + Math.round(service.endTerminalLayoverMinutes)
        : null;
    const minimumBusesRequired = cycleRequirementMinutes != null && validFrequency
        ? Math.ceil(cycleRequirementMinutes / service.frequencyMinutes)
        : null;
    const testedBuses = service.testedBuses ?? null;
    const scheduledCycleWindowMinutes = minimumBusesRequired != null
        ? (testedBuses ?? minimumBusesRequired) * service.frequencyMinutes
        : null;
    const recoveryTimeMinutes = scheduledCycleWindowMinutes != null && cycleRequirementMinutes != null
        ? scheduledCycleWindowMinutes - cycleRequirementMinutes
        : null;
    const recoveryPercent = recoveryTimeMinutes != null && cycleRequirementMinutes != null && cycleRequirementMinutes > 0
        ? rounded((recoveryTimeMinutes / cycleRequirementMinutes) * 100)
        : null;

    if (recoveryTimeMinutes != null && recoveryPercent != null) {
        if (recoveryTimeMinutes < 0) {
            issues.push({ id: 'negative-recovery', severity: 'blocking', message: 'The tested buses do not provide enough cycle time.', action: 'Add a bus, reduce runtime, or reduce frequency.' });
        } else if (recoveryPercent < 10) {
            issues.push({ id: 'fragile-recovery', severity: 'warning', message: 'Recovery is below 10%, so the service may be fragile.', action: 'Add recovery or test a different frequency.' });
        } else if (recoveryPercent > 25) {
            issues.push({ id: 'high-recovery', severity: 'warning', message: 'Recovery is above 25%, which may be inefficient.', action: 'Review frequency, runtime, and bus assumptions.' });
        }
        if (minimumBusesRequired != null) {
            const margin = (minimumBusesRequired * service.frequencyMinutes) - cycleRequirementMinutes!;
            if (margin >= 0 && margin <= 3) {
                issues.push({ id: 'near-bus-threshold', severity: 'warning', message: 'The route is within three minutes of needing another bus.', action: 'Stress-test runtime and recovery assumptions.' });
            }
        }
    }

    const blocking = issues.some((issue) => issue.severity === 'blocking');
    const comparisonReady = !blocking
        && completeRouteRuntimeMinutes != null
        && minimumBusesRequired != null
        && scheduledCycleWindowMinutes != null;
    const readiness = blocking ? 'not-ready' : issues.some((issue) => issue.severity === 'warning') ? 'needs-review' : 'ready-for-review';
    const daily = scheduledCycleWindowMinutes != null
        && completeRouteRuntimeMinutes != null
        ? deriveDailyMetrics(alternative, patterns, completeRouteRuntimeMinutes, scheduledCycleWindowMinutes)
        : null;

    return {
        completeRouteRuntimeMinutes,
        dwellTimeMinutes,
        cycleRequirementMinutes,
        minimumBusesRequired,
        testedBuses,
        scheduledCycleWindowMinutes,
        recoveryTimeMinutes,
        recoveryPercent,
        daily,
        confidence: deriveConfidence(segments, blocking),
        readiness,
        comparisonReady,
        segments,
        issues,
    };
}
