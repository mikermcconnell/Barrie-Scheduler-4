import { useCallback, useEffect, useMemo, useRef } from 'react';

import type {
    RouteConceptAlternative,
    RouteConceptPattern,
    RouteConceptSegmentRuntimeEvidence,
} from '../../../utils/route-concept-planner/routeConceptPlannerTypes';
import { formatRouteConceptServiceTime } from '../../../utils/route-concept-planner/routeConceptPlannerTime';
import type {
    RoutePlanner2Scenario,
    RoutePlanner2SegmentRuntime,
} from '../../../utils/route-planner-2/routePlanner2Types';
import { RoutePlanner2MapCanvas } from '../route-planner-2/RoutePlanner2MapCanvas';

function clockLabel(minutes: number): string {
    return formatRouteConceptServiceTime(minutes)?.label.slice(0, 5) ?? '00:00';
}

export function toRoutePlanner2Scenario(pattern: RouteConceptPattern, alternative: RouteConceptAlternative): RoutePlanner2Scenario {
    const routeShape = pattern.role === 'loop'
        ? 'closed-loop'
        : pattern.role === 'out-and-back'
            ? 'out-and-back'
            : 'one-way';

    return {
        id: pattern.id,
        name: pattern.name,
        status: alternative.status,
        routeShape,
        source: pattern.source?.type === 'gtfs'
            ? {
                type: 'gtfs',
                routeId: pattern.source.routeId,
                routeShortName: pattern.source.routeShortName,
                serviceId: pattern.source.serviceId,
                directionId: pattern.source.directionId,
                shapeId: pattern.source.shapeId,
                feedVersion: pattern.source.feedVersion,
                importedAt: pattern.source.importedAt,
            }
            : { type: 'blank' },
        alignment: pattern.alignment,
        stops: pattern.stops.map((stop) => ({
            ...stop,
            source: stop.source === 'gtfs' ? 'barrie-stop' : 'custom',
        })),
        service: {
            firstTripTime: clockLabel(alternative.service.firstDepartureMinutes),
            lastTripTime: clockLabel(alternative.service.lastDepartureMinutes),
            frequencyMinutes: alternative.service.frequencyMinutes,
            targetBuses: alternative.service.testedBuses,
            startTerminalLayoverMinutes: alternative.service.startTerminalLayoverMinutes,
            endTerminalLayoverMinutes: alternative.service.endTerminalLayoverMinutes,
            intermediateStopDwellSeconds: alternative.service.intermediateStopDwellSeconds,
            dayType: alternative.service.dayType,
            planningPeriod: alternative.service.planningPeriod,
        },
        runtimeSourceMode: pattern.source?.type === 'gtfs' ? 'gtfs' : 'mapbox',
        runtimeEstimates: pattern.runtimeEvidence.map((evidence) => ({
            id: evidence.id,
            fromStopId: evidence.fromStopId,
            toStopId: evidence.toStopId,
            runtimeMinutes: evidence.runtimeMinutes,
            source: evidence.source === 'gtfs' ? 'scheduled-proxy' : evidence.source,
            scheduledRuntimeMinutes: evidence.source === 'gtfs' ? evidence.runtimeMinutes : undefined,
            evidenceDayType: evidence.dayType,
            evidencePeriod: evidence.planningPeriod === 'all-day' ? 'full-day' : evidence.planningPeriod,
            confidence: evidence.source === 'gtfs' ? 'high' : evidence.source === 'mapbox' ? 'medium' : 'low',
            sampleSize: evidence.sampleSize,
            distanceKm: evidence.distanceKm,
            pathFingerprint: evidence.pathFingerprint,
            updatedAt: evidence.updatedAt,
            fallbackReason: evidence.fallbackReason,
        })),
        runtimeOverrides: Object.fromEntries(Object.entries(pattern.runtimeOverrides).map(([segmentId, override]) => [segmentId, {
            runtimeMinutes: override.runtimeMinutes,
            notes: override.notes,
            updatedAt: override.updatedAt,
        }])),
        notes: pattern.notes,
        createdAt: pattern.createdAt,
        updatedAt: pattern.updatedAt,
    };
}

export function fromRoutePlanner2RuntimeEstimate(estimate: RoutePlanner2SegmentRuntime): RouteConceptSegmentRuntimeEvidence | null {
    if (estimate.runtimeMinutes == null || estimate.source === 'manual' || estimate.source === 'missing') return null;
    const source = estimate.source === 'scheduled-proxy' || estimate.source === 'partial-scheduled-proxy'
        ? 'gtfs'
        : estimate.source === 'mapbox'
            ? 'mapbox'
            : 'fallback';

    return {
        id: estimate.id,
        fromStopId: estimate.fromStopId,
        toStopId: estimate.toStopId,
        runtimeMinutes: estimate.runtimeMinutes,
        source,
        pathFingerprint: estimate.pathFingerprint,
        dayType: estimate.evidenceDayType,
        planningPeriod: estimate.evidencePeriod === 'full-day' ? 'all-day' : estimate.evidencePeriod,
        sampleSize: estimate.sampleSize,
        distanceKm: estimate.distanceKm,
        updatedAt: estimate.updatedAt ?? new Date().toISOString(),
        fallbackReason: estimate.fallbackReason,
    };
}

export interface RouteConceptMapBridgeProps {
    alternative: RouteConceptAlternative;
    pattern: RouteConceptPattern;
    backgroundPatterns?: RouteConceptPattern[];
    selectedStopId: string | null;
    highlightedSegmentId?: string | null;
    metricItems?: Array<{ label: string; value: string; detail?: string; description?: string; onClick?: () => void }>;
    onSelectStop: (stopId: string) => void;
    onAddStop: (coordinate: { lat: number; lng: number; name?: string }) => void;
    onDeleteStop: (stopId: string) => void;
    onMoveStop: (stopId: string, coordinate: { lat: number; lng: number }) => void;
    onAddLineWaypoint: (placement: {
        fromStopId: string;
        toStopId: string;
        insertAfterWaypointId?: string;
        insertBeforeWaypointId?: string;
        coordinate: { lat: number; lng: number };
    }) => void;
    onInsertStopOnLine: (placement: {
        fromStopId: string;
        toStopId: string;
        insertAfterWaypointId?: string;
        insertBeforeWaypointId?: string;
        coordinate: { lat: number; lng: number };
    }) => void;
    onMoveLineWaypoint: (waypointId: string, coordinate: { lat: number; lng: number }) => void;
    onDeleteLineWaypoint: (waypointId: string) => void;
    onRuntimeEstimates: (estimates: RouteConceptSegmentRuntimeEvidence[]) => void;
    onSetRuntimeOverride: (segmentId: string, runtimeMinutes: number) => void;
    onClearRuntimeOverride: (segmentId: string) => void;
}

export function RouteConceptMapBridge({
    alternative,
    pattern,
    backgroundPatterns = [],
    selectedStopId,
    highlightedSegmentId,
    metricItems,
    onSelectStop,
    onAddStop,
    onDeleteStop,
    onMoveStop,
    onAddLineWaypoint,
    onInsertStopOnLine,
    onMoveLineWaypoint,
    onDeleteLineWaypoint,
    onRuntimeEstimates,
    onSetRuntimeOverride,
    onClearRuntimeOverride,
}: RouteConceptMapBridgeProps) {
    const onRuntimeEstimatesRef = useRef(onRuntimeEstimates);

    useEffect(() => {
        onRuntimeEstimatesRef.current = onRuntimeEstimates;
    }, [onRuntimeEstimates]);

    const handleRuntimeEstimates = useCallback((estimates: RoutePlanner2SegmentRuntime[]) => {
        onRuntimeEstimatesRef.current(
            estimates.map(fromRoutePlanner2RuntimeEstimate).filter((item): item is RouteConceptSegmentRuntimeEvidence => item != null),
        );
    }, []);

    const scenario = useMemo(() => toRoutePlanner2Scenario(pattern, alternative), [alternative, pattern]);
    const backgroundScenarios = useMemo(
        () => backgroundPatterns.map((background) => toRoutePlanner2Scenario(background, alternative)),
        [alternative, backgroundPatterns],
    );

    return (
        <RoutePlanner2MapCanvas
            scenario={scenario}
            backgroundScenarios={backgroundScenarios}
            selectedStopId={selectedStopId}
            highlightedSegmentId={highlightedSegmentId}
            onSelectStop={onSelectStop}
            onAddStop={onAddStop}
            onDeleteStop={onDeleteStop}
            onMoveStop={onMoveStop}
            onAddLineWaypoint={onAddLineWaypoint}
            onInsertStopOnLine={onInsertStopOnLine}
            onMoveLineWaypoint={onMoveLineWaypoint}
            onDeleteLineWaypoint={onDeleteLineWaypoint}
            onSegmentRuntimeEstimates={handleRuntimeEstimates}
            onSetSegmentRuntimeOverride={onSetRuntimeOverride}
            onClearSegmentRuntimeOverride={onClearRuntimeOverride}
            metricItems={metricItems}
            segmentRuntimes={scenario.runtimeEstimates}
            stopLabelDetails={[]}
            showRuntimeSourceOverlay
            showRoadNameLabels
            roadNameLabelDensity="normal"
            overlayInsets={{ left: '18rem', right: '24rem', top: '5rem' }}
        />
    );
}
