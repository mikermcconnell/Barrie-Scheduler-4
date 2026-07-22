import { updateRoutePlanner2SegmentRuntimeEstimates } from './routePlanner2Authoring';
import { deriveRoutePlanner2Feasibility } from './routePlanner2Feasibility';
import { buildRoutePlanner2StopSegmentPaths } from './routePlanner2Segments';
import type {
    RoutePlanner2Project,
    RoutePlanner2RuntimeSnapshot,
    RoutePlanner2Scenario,
    RoutePlanner2SegmentRuntime,
} from './routePlanner2Types';

export const ROUTE_PLANNER_RUNTIME_SNAPSHOT_LIMIT = 12;

export interface RoutePlanner2RuntimeSegmentChange {
    segmentId: string;
    fromStopId: string;
    toStopId: string;
    previousMinutes: number | null;
    candidateMinutes: number | null;
    deltaMinutes: number | null;
    previousDurationSeconds?: number;
    candidateDurationSeconds?: number;
}

export interface RoutePlanner2RuntimeRefreshComparison {
    scenarioId: string;
    calculatedAt: string;
    previousTotalRuntimeMinutes: number | null;
    candidateTotalRuntimeMinutes: number | null;
    deltaMinutes: number | null;
    changedSegments: RoutePlanner2RuntimeSegmentChange[];
    estimates: RoutePlanner2SegmentRuntime[];
}

function createSnapshotId(): string {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
        return `runtime-snapshot-${crypto.randomUUID()}`;
    }
    return `runtime-snapshot-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function isAutomaticRoadEstimate(estimate: RoutePlanner2SegmentRuntime): boolean {
    return estimate.source === 'mapbox' || estimate.source === 'fallback';
}

function getAutomaticEstimate(
    scenario: RoutePlanner2Scenario,
    estimate: RoutePlanner2SegmentRuntime,
): RoutePlanner2SegmentRuntime | undefined {
    return scenario.runtimeEstimates?.find((current) =>
        current.id === estimate.id && isAutomaticRoadEstimate(current),
    );
}

function totalDurationSeconds(estimates: RoutePlanner2SegmentRuntime[]): number | undefined {
    if (!estimates.every((estimate) => typeof estimate.durationSeconds === 'number')) return undefined;
    return estimates.reduce((sum, estimate) => sum + (estimate.durationSeconds ?? 0), 0);
}

function snapshotPathFingerprint(scenario: RoutePlanner2Scenario): string {
    return buildRoutePlanner2StopSegmentPaths(scenario)
        .map((segment) => `${segment.id}:${segment.pathFingerprint}`)
        .join('||');
}

function appendSnapshot(
    scenario: RoutePlanner2Scenario,
    snapshot: RoutePlanner2RuntimeSnapshot,
): RoutePlanner2RuntimeSnapshot[] {
    return [
        snapshot,
        ...(scenario.runtimeSnapshots ?? []).filter((item) => item.id !== snapshot.id),
    ].slice(0, ROUTE_PLANNER_RUNTIME_SNAPSHOT_LIMIT);
}

function scenarioWithCandidateEstimates(
    scenario: RoutePlanner2Scenario,
    estimates: RoutePlanner2SegmentRuntime[],
): RoutePlanner2Scenario {
    const candidateIds = new Set(estimates.map((estimate) => estimate.id));
    const retained = (scenario.runtimeEstimates ?? []).filter((estimate) =>
        !(candidateIds.has(estimate.id) && isAutomaticRoadEstimate(estimate)),
    );
    return {
        ...scenario,
        runtimeEstimates: [...retained, ...estimates],
        feasibility: undefined,
    };
}

export function hasRoutePlanner2AcceptedRuntime(scenario: RoutePlanner2Scenario): boolean {
    return Boolean(
        scenario.runtimeAcceptedAt
        || scenario.acceptedRuntimeSnapshotId
        || scenario.runtimeLocked,
    );
}

export function hasRoutePlanner2UsableRoadRuntime(scenario: RoutePlanner2Scenario): boolean {
    return (scenario.runtimeEstimates ?? []).some((estimate) =>
        estimate.source === 'mapbox'
        && typeof estimate.runtimeMinutes === 'number'
        && estimate.runtimeMinutes > 0,
    );
}

export function buildRoutePlanner2RuntimeRefreshComparison(
    scenario: RoutePlanner2Scenario,
    estimates: RoutePlanner2SegmentRuntime[],
    calculatedAt = new Date().toISOString(),
): RoutePlanner2RuntimeRefreshComparison {
    const previousFeasibility = deriveRoutePlanner2Feasibility(scenario);
    const candidateScenario = scenarioWithCandidateEstimates(scenario, estimates);
    const candidateFeasibility = deriveRoutePlanner2Feasibility(candidateScenario);
    const changedSegments = estimates.flatMap((estimate): RoutePlanner2RuntimeSegmentChange[] => {
        const previous = getAutomaticEstimate(scenario, estimate);
        const previousMinutes = previous?.runtimeMinutes ?? null;
        const candidateMinutes = estimate.runtimeMinutes ?? null;
        const changed = previousMinutes !== candidateMinutes
            || previous?.durationSeconds !== estimate.durationSeconds
            || previous?.pathFingerprint !== estimate.pathFingerprint;
        if (!changed) return [];
        return [{
            segmentId: estimate.id,
            fromStopId: estimate.fromStopId,
            toStopId: estimate.toStopId,
            previousMinutes,
            candidateMinutes,
            deltaMinutes: previousMinutes != null && candidateMinutes != null
                ? candidateMinutes - previousMinutes
                : null,
            previousDurationSeconds: previous?.durationSeconds,
            candidateDurationSeconds: estimate.durationSeconds,
        }];
    });
    const previousTotalRuntimeMinutes = previousFeasibility.oneWayRuntimeMinutes;
    const candidateTotalRuntimeMinutes = candidateFeasibility.oneWayRuntimeMinutes;

    return {
        scenarioId: scenario.id,
        calculatedAt,
        previousTotalRuntimeMinutes,
        candidateTotalRuntimeMinutes,
        deltaMinutes: previousTotalRuntimeMinutes != null && candidateTotalRuntimeMinutes != null
            ? candidateTotalRuntimeMinutes - previousTotalRuntimeMinutes
            : null,
        changedSegments,
        estimates,
    };
}

function createSnapshot(
    scenario: RoutePlanner2Scenario,
    comparison: RoutePlanner2RuntimeRefreshComparison,
    decision: RoutePlanner2RuntimeSnapshot['decision'],
    decidedBy: string | undefined,
    decidedAt: string,
): RoutePlanner2RuntimeSnapshot {
    return {
        id: createSnapshotId(),
        decision,
        provider: 'mapbox',
        profile: 'mapbox/driving',
        calculatedAt: comparison.calculatedAt,
        decidedAt,
        decidedBy,
        pathFingerprint: snapshotPathFingerprint(scenario),
        previousTotalRuntimeMinutes: comparison.previousTotalRuntimeMinutes,
        candidateTotalRuntimeMinutes: comparison.candidateTotalRuntimeMinutes,
        segmentRuntimeMinutes: comparison.estimates.reduce(
            (sum, estimate) => sum + Math.round(estimate.runtimeMinutes ?? 0),
            0,
        ),
        totalDurationSeconds: totalDurationSeconds(comparison.estimates),
        segmentEstimates: comparison.estimates.map((estimate) => ({ ...estimate })),
    };
}

export function acceptRoutePlanner2RuntimeRefresh(
    project: RoutePlanner2Project,
    comparison: RoutePlanner2RuntimeRefreshComparison,
    decidedBy?: string,
    decidedAt = new Date().toISOString(),
): RoutePlanner2Project {
    const scenario = project.scenarios.find((item) => item.id === comparison.scenarioId);
    if (!scenario || scenario.runtimeLocked) return project;

    const snapshot = createSnapshot(scenario, comparison, 'accepted', decidedBy, decidedAt);
    const withEstimates = updateRoutePlanner2SegmentRuntimeEstimates(
        project,
        scenario.id,
        comparison.estimates,
        decidedAt,
        {
            replaceForSegmentIds: comparison.estimates.map((estimate) => estimate.id),
            replaceSources: ['mapbox', 'fallback'],
        },
    );

    return {
        ...withEstimates,
        status: withEstimates.status === 'archived' ? 'archived' : 'local-draft',
        updatedAt: decidedAt,
        scenarios: withEstimates.scenarios.map((item) => item.id === scenario.id
            ? {
                ...item,
                runtimeAcceptedAt: decidedAt,
                runtimeAcceptedBy: decidedBy,
                acceptedRuntimeSnapshotId: snapshot.id,
                runtimeSnapshots: appendSnapshot(item, snapshot),
                updatedAt: decidedAt,
            }
            : item),
    };
}

export function rejectRoutePlanner2RuntimeRefresh(
    project: RoutePlanner2Project,
    comparison: RoutePlanner2RuntimeRefreshComparison,
    decidedBy?: string,
    decidedAt = new Date().toISOString(),
): RoutePlanner2Project {
    const scenario = project.scenarios.find((item) => item.id === comparison.scenarioId);
    if (!scenario) return project;
    const snapshot = createSnapshot(scenario, comparison, 'rejected', decidedBy, decidedAt);

    return {
        ...project,
        status: project.status === 'archived' ? 'archived' : 'local-draft',
        updatedAt: decidedAt,
        scenarios: project.scenarios.map((item) => item.id === scenario.id
            ? {
                ...item,
                runtimeSnapshots: appendSnapshot(item, snapshot),
                updatedAt: decidedAt,
            }
            : item),
    };
}

export function setRoutePlanner2RuntimeLocked(
    project: RoutePlanner2Project,
    scenarioId: string,
    locked: boolean,
    now = new Date().toISOString(),
): RoutePlanner2Project {
    const scenario = project.scenarios.find((item) => item.id === scenarioId);
    if (!scenario || Boolean(scenario.runtimeLocked) === locked) return project;
    return {
        ...project,
        status: project.status === 'archived' ? 'archived' : 'local-draft',
        updatedAt: now,
        scenarios: project.scenarios.map((item) => item.id === scenarioId
            ? { ...item, runtimeLocked: locked, updatedAt: now }
            : item),
    };
}

export function prepareRoutePlanner2ProjectRuntimeForSave(
    project: RoutePlanner2Project,
    userId: string,
    now = new Date().toISOString(),
): RoutePlanner2Project {
    return {
        ...project,
        scenarios: project.scenarios.map((scenario) => {
            if (hasRoutePlanner2AcceptedRuntime(scenario) || !hasRoutePlanner2UsableRoadRuntime(scenario)) {
                return scenario;
            }
            const estimates = (scenario.runtimeEstimates ?? []).filter((estimate) => estimate.source === 'mapbox');
            const comparison = buildRoutePlanner2RuntimeRefreshComparison(scenario, estimates, now);
            const snapshot = createSnapshot(scenario, comparison, 'accepted', userId, now);
            return {
                ...scenario,
                runtimeAcceptedAt: now,
                runtimeAcceptedBy: userId,
                acceptedRuntimeSnapshotId: snapshot.id,
                runtimeSnapshots: appendSnapshot(scenario, snapshot),
            };
        }),
    };
}
