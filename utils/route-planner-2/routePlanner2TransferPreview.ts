import { reassignRoutePlanner2StopRange } from './routePlanner2Authoring';
import { deriveRoutePlanner2Feasibility } from './routePlanner2Feasibility';
import { buildRoutePlanner2StopSegmentPairs, getRoutePlanner2SegmentId, sortRoutePlanner2Stops } from './routePlanner2Segments';
import { summarizeRoutePlanner2Project, summarizeRoutePlanner2Scenario, type RoutePlanner2RouteFamilySummary } from './routePlanner2Summary';
import type {
    RoutePlanner2Project,
    RoutePlanner2Scenario,
    RoutePlanner2SegmentRuntime,
    RoutePlanner2Stop,
    RoutePlanner2WarningSeverity,
} from './routePlanner2Types';

const TRANSFERRED_STOP_ID_PREFIX = 'transfer-';
const CARRIED_RUNTIME_SOURCES = new Set<RoutePlanner2SegmentRuntime['source']>([
    'observed-proxy',
    'observed-scheduled-blend',
    'partial-scheduled-proxy',
    'scheduled-proxy',
]);

export interface RoutePlanner2StopTransferPreviewOptions {
    sourceScenarioId: string;
    targetScenarioId: string;
    fromSequence: number;
    toSequence: number;
    insertAfterStopId?: string | null;
    mode: 'copy' | 'move';
    reverseOrder?: boolean;
    now?: string;
}

export interface RoutePlanner2StopTransferPreviewWarning {
    id: string;
    severity: RoutePlanner2WarningSeverity;
    message: string;
    action?: string;
}

export interface RoutePlanner2StopTransferPreview {
    sourceScenarioName: string;
    targetScenarioName: string;
    mode: 'copy' | 'move';
    reverseOrder: boolean;
    transferredStopCount: number;
    carriedRuntimeEstimateCount: number;
    carriedScheduledSegmentCount: number;
    carriedManualOverrideCount: number;
    droppedDirectionalRuntimeEstimateCount: number;
    matchedRoutes: string[];
    connectorSegmentCount: number;
    fallbackConnectorCount: number;
    duplicateJoinCount: number;
    sourceRuntimeBeforeMinutes: number | null;
    sourceRuntimeAfterMinutes: number | null;
    targetRuntimeBeforeMinutes: number | null;
    targetRuntimeAfterMinutes: number | null;
    sourceRuntimeDeltaMinutes: number | null;
    targetRuntimeDeltaMinutes: number | null;
    transferredRuntimeMinutes: number;
    sourceAccountingRuntimeAfterMinutes: number | null;
    targetAccountingRuntimeAfterMinutes: number | null;
    sourceAccountingRuntimeDeltaMinutes: number | null;
    targetAccountingRuntimeDeltaMinutes: number | null;
    sourceFamilyBefore?: RoutePlanner2RouteFamilySummary;
    sourceFamilyAfter?: RoutePlanner2RouteFamilySummary;
    targetFamilyBefore?: RoutePlanner2RouteFamilySummary;
    targetFamilyAfter?: RoutePlanner2RouteFamilySummary;
    warnings: RoutePlanner2StopTransferPreviewWarning[];
}

function createStableIdPart(value: string): string {
    return value.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40) || 'stop';
}

function getTransferStopIdPrefix(sourceStopId: string, now: string): string {
    return `${TRANSFERRED_STOP_ID_PREFIX}${createStableIdPart(sourceStopId)}-${createStableIdPart(now)}-`;
}

function getRuntimeDelta(before: number | null, after: number | null): number | null {
    if (before == null || after == null) return null;
    return Math.round(after - before);
}

function normalizeStopName(value: string): string {
    return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function stopsRepresentSamePlace(firstStop: RoutePlanner2Stop | undefined | null, secondStop: RoutePlanner2Stop | undefined | null): boolean {
    if (!firstStop || !secondStop) return false;
    const firstStopCode = firstStop.stopCode?.trim();
    const secondStopCode = secondStop.stopCode?.trim();
    if (firstStopCode && secondStopCode) return firstStopCode === secondStopCode;

    return normalizeStopName(firstStop.name) === normalizeStopName(secondStop.name)
        && Math.abs(firstStop.lat - secondStop.lat) < 0.00001
        && Math.abs(firstStop.lng - secondStop.lng) < 0.00001;
}

function getFamilySummaryForScenario(project: RoutePlanner2Project, scenarioId: string): RoutePlanner2RouteFamilySummary | undefined {
    return summarizeRoutePlanner2Project(project).routeFamilySummaries.find((familySummary) =>
        familySummary.scenarioIds.includes(scenarioId),
    );
}

function getInsertedStopIds(sourceStops: RoutePlanner2Stop[], now: string): Set<string> {
    return new Set(sourceStops.map((stop) => getTransferStopIdPrefix(stop.id, now)));
}

function isTransferredStopId(stopId: string, transferredStopPrefixes: Set<string>): boolean {
    for (const prefix of transferredStopPrefixes) {
        if (stopId.startsWith(prefix)) return true;
    }
    return false;
}

function uniqueSegmentKey(estimate: Pick<RoutePlanner2SegmentRuntime, 'fromStopId' | 'toStopId'>): string {
    return `${estimate.fromStopId}->${estimate.toStopId}`;
}

function getTransferredRuntimeEstimates(
    sourceScenario: RoutePlanner2Scenario,
    transferStopIds: Set<string>,
): RoutePlanner2SegmentRuntime[] {
    return (sourceScenario.runtimeEstimates ?? []).filter((estimate) =>
        transferStopIds.has(estimate.fromStopId) && transferStopIds.has(estimate.toStopId),
    );
}

function sumRuntimeMinutes(values: Array<number | null | undefined>): number {
    return values.reduce((sum, value) => sum + (value == null ? 0 : Math.round(value)), 0);
}

function applyRuntimeDelta(before: number | null, delta: number): number | null {
    return before == null ? null : before + delta;
}

function getTransferredRuntimeMinutes(
    sourceScenario: RoutePlanner2Scenario,
    transferStopIds: Set<string>,
): number {
    const sourceFeasibility = deriveRoutePlanner2Feasibility(sourceScenario);
    const runtimeByPair = new Map(sourceFeasibility.segmentSummaries.map((segment) => [
        uniqueSegmentKey(segment),
        segment.runtimeMinutes,
    ]));

    return sumRuntimeMinutes(buildRoutePlanner2StopSegmentPairs(sourceScenario).flatMap(({ fromStop, toStop }) => {
        if (!transferStopIds.has(fromStop.id) || !transferStopIds.has(toStop.id)) return [];
        return [runtimeByPair.get(`${fromStop.id}->${toStop.id}`)];
    }));
}

function getTransferredManualOverrideCount(
    sourceScenario: RoutePlanner2Scenario,
    transferStopIds: Set<string>,
): number {
    return buildRoutePlanner2StopSegmentPairs(sourceScenario).filter(({ fromStop, toStop }) =>
        transferStopIds.has(fromStop.id)
        && transferStopIds.has(toStop.id)
        && Boolean(sourceScenario.runtimeOverrides?.[getRoutePlanner2SegmentId(fromStop.id, toStop.id)]),
    ).length;
}

export function buildRoutePlanner2StopTransferPreview(
    project: RoutePlanner2Project,
    options: RoutePlanner2StopTransferPreviewOptions,
): RoutePlanner2StopTransferPreview | null {
    const now = options.now ?? new Date().toISOString();
    if (options.sourceScenarioId === options.targetScenarioId) return null;
    if (!Number.isFinite(options.fromSequence) || !Number.isFinite(options.toSequence)) return null;

    const sourceScenario = project.scenarios.find((scenario) => scenario.id === options.sourceScenarioId);
    const targetScenario = project.scenarios.find((scenario) => scenario.id === options.targetScenarioId);
    if (!sourceScenario || !targetScenario) return null;

    const sourceStops = sortRoutePlanner2Stops(sourceScenario.stops);
    const targetStops = sortRoutePlanner2Stops(targetScenario.stops);
    const rangeStart = Math.min(options.fromSequence, options.toSequence);
    const rangeEnd = Math.max(options.fromSequence, options.toSequence);
    const selectedStops = sourceStops.filter((stop) => stop.sequence >= rangeStart && stop.sequence <= rangeEnd);
    if (selectedStops.length === 0) return null;

    const orderedStops = options.reverseOrder ? [...selectedStops].reverse() : selectedStops;
    const transferStopIds = new Set(selectedStops.map((stop) => stop.id));
    const runtimeEstimatesInRange = getTransferredRuntimeEstimates(sourceScenario, transferStopIds);
    const scheduledEstimatesInRange = runtimeEstimatesInRange.filter((estimate) => CARRIED_RUNTIME_SOURCES.has(estimate.source));
    const scheduledSegmentKeys = new Set(scheduledEstimatesInRange.map(uniqueSegmentKey));
    const matchedRoutes = [...new Set(scheduledEstimatesInRange.flatMap((estimate) => estimate.matchedRoutes ?? []))]
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
    const manualOverrideCount = getTransferredManualOverrideCount(sourceScenario, transferStopIds);
    const transferredRuntimeMinutes = getTransferredRuntimeMinutes(sourceScenario, transferStopIds);

    const requestedInsertIndex = options.insertAfterStopId
        ? targetStops.findIndex((stop) => stop.id === options.insertAfterStopId)
        : -1;
    const normalizedInsertIndex = options.insertAfterStopId
        ? requestedInsertIndex >= 0 ? requestedInsertIndex + 1 : targetStops.length
        : 0;
    const targetStopBefore = normalizedInsertIndex > 0 ? targetStops[normalizedInsertIndex - 1] : null;
    const targetStopAfter = normalizedInsertIndex < targetStops.length ? targetStops[normalizedInsertIndex] : null;
    const firstTransferredStop = orderedStops[0];
    const lastTransferredStop = orderedStops[orderedStops.length - 1];
    const duplicateJoinCount = [
        targetStopBefore && stopsRepresentSamePlace(targetStopBefore, firstTransferredStop),
        targetStopAfter && stopsRepresentSamePlace(lastTransferredStop, targetStopAfter),
    ].filter(Boolean).length;

    const afterProject = reassignRoutePlanner2StopRange(project, {
        ...options,
        now,
    });
    if (afterProject === project) return null;

    const sourceBefore = summarizeRoutePlanner2Scenario(sourceScenario);
    const targetBefore = summarizeRoutePlanner2Scenario(targetScenario);
    const sourceAfterScenario = afterProject.scenarios.find((scenario) => scenario.id === sourceScenario.id);
    const targetAfterScenario = afterProject.scenarios.find((scenario) => scenario.id === targetScenario.id);
    if (!sourceAfterScenario || !targetAfterScenario) return null;

    const sourceAfter = summarizeRoutePlanner2Scenario(sourceAfterScenario);
    const targetAfter = summarizeRoutePlanner2Scenario(targetAfterScenario);
    const sourceAccountingDeltaMinutes = options.mode === 'move' ? -transferredRuntimeMinutes : 0;
    const targetAccountingDeltaMinutes = transferredRuntimeMinutes;
    const sourceAccountingRuntimeAfterMinutes = applyRuntimeDelta(sourceBefore.feasibility.oneWayRuntimeMinutes, sourceAccountingDeltaMinutes);
    const targetAccountingRuntimeAfterMinutes = applyRuntimeDelta(targetBefore.feasibility.oneWayRuntimeMinutes, targetAccountingDeltaMinutes);
    const transferredStopPrefixes = getInsertedStopIds(orderedStops, now);
    const targetAfterFeasibility = deriveRoutePlanner2Feasibility(targetAfterScenario);
    const connectorSegments = targetAfterFeasibility.segmentSummaries.filter((segment) => {
        const fromTransferred = isTransferredStopId(segment.fromStopId, transferredStopPrefixes);
        const toTransferred = isTransferredStopId(segment.toStopId, transferredStopPrefixes);
        return fromTransferred !== toTransferred;
    });
    const warnings: RoutePlanner2StopTransferPreviewWarning[] = [];

    if (options.reverseOrder && runtimeEstimatesInRange.length > 0) {
        warnings.push({
            id: 'reversed-runtime-dropped',
            severity: 'warning',
            message: `${runtimeEstimatesInRange.length} directional runtime estimate${runtimeEstimatesInRange.length === 1 ? '' : 's'} will not be copied because the stop order is reversed.`,
            action: 'Review recalculated runtime after applying the transfer.',
        });
    }

    if (duplicateJoinCount > 0) {
        warnings.push({
            id: 'duplicate-join-stop',
            severity: 'warning',
            message: `${duplicateJoinCount} join point${duplicateJoinCount === 1 ? '' : 's'} appear to use the same stop on both sides of the transfer.`,
            action: 'Merge duplicate join stops or review the connector runtime after applying.',
        });
    }

    if (connectorSegments.some((segment) => segment.source === 'fallback')) {
        warnings.push({
            id: 'fallback-connector',
            severity: 'warning',
            message: 'At least one connector into the transferred section has no scheduled runtime evidence.',
            action: 'Review the connector or add a manual runtime override.',
        });
    }

    return {
        sourceScenarioName: sourceScenario.name,
        targetScenarioName: targetScenario.name,
        mode: options.mode,
        reverseOrder: Boolean(options.reverseOrder),
        transferredStopCount: selectedStops.length,
        carriedRuntimeEstimateCount: options.reverseOrder ? 0 : runtimeEstimatesInRange.length,
        carriedScheduledSegmentCount: options.reverseOrder ? 0 : scheduledSegmentKeys.size,
        carriedManualOverrideCount: options.reverseOrder ? 0 : manualOverrideCount,
        droppedDirectionalRuntimeEstimateCount: options.reverseOrder ? runtimeEstimatesInRange.length : 0,
        matchedRoutes: options.reverseOrder ? [] : matchedRoutes,
        connectorSegmentCount: connectorSegments.length,
        fallbackConnectorCount: connectorSegments.filter((segment) => segment.source === 'fallback').length,
        duplicateJoinCount,
        sourceRuntimeBeforeMinutes: sourceBefore.feasibility.oneWayRuntimeMinutes,
        sourceRuntimeAfterMinutes: sourceAfter.feasibility.oneWayRuntimeMinutes,
        targetRuntimeBeforeMinutes: targetBefore.feasibility.oneWayRuntimeMinutes,
        targetRuntimeAfterMinutes: targetAfter.feasibility.oneWayRuntimeMinutes,
        sourceRuntimeDeltaMinutes: getRuntimeDelta(sourceBefore.feasibility.oneWayRuntimeMinutes, sourceAfter.feasibility.oneWayRuntimeMinutes),
        targetRuntimeDeltaMinutes: getRuntimeDelta(targetBefore.feasibility.oneWayRuntimeMinutes, targetAfter.feasibility.oneWayRuntimeMinutes),
        transferredRuntimeMinutes,
        sourceAccountingRuntimeAfterMinutes,
        targetAccountingRuntimeAfterMinutes,
        sourceAccountingRuntimeDeltaMinutes: getRuntimeDelta(sourceBefore.feasibility.oneWayRuntimeMinutes, sourceAccountingRuntimeAfterMinutes),
        targetAccountingRuntimeDeltaMinutes: getRuntimeDelta(targetBefore.feasibility.oneWayRuntimeMinutes, targetAccountingRuntimeAfterMinutes),
        sourceFamilyBefore: getFamilySummaryForScenario(project, sourceScenario.id),
        sourceFamilyAfter: getFamilySummaryForScenario(afterProject, sourceScenario.id),
        targetFamilyBefore: getFamilySummaryForScenario(project, targetScenario.id),
        targetFamilyAfter: getFamilySummaryForScenario(afterProject, targetScenario.id),
        warnings,
    };
}
