import React, { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { ArrowLeft, ArrowRightLeft, BoxSelect, ClipboardList, Copy, Database, Eye, FileDown, FileSpreadsheet, FolderOpen, LassoSelect, Layers3, Loader2, MapPin, MapPinned, MousePointer2, PanelRightOpen, PencilRuler, Plus, Redo2, Save, Search, Star, Trash2, Undo2, X } from 'lucide-react';
import {
    addRoutePlanner2LineWaypoint,
    addRoutePlanner2Stop,
    addRoutePlanner2Stops,
    clearRoutePlanner2Stops,
    clearRoutePlanner2SegmentRuntimeOverride,
    deleteRoutePlanner2LineWaypoint,
    deleteRoutePlanner2Stop,
    insertRoutePlanner2StopBetween,
    moveRoutePlanner2LineWaypointInOrder,
    moveRoutePlanner2Stop,
    reassignRoutePlanner2StopRange,
    renameRoutePlanner2Stop,
    setRoutePlanner2SegmentRuntimeOverride,
    updateRoutePlanner2RouteShape,
    updateRoutePlanner2LineWaypointCoordinate,
    updateRoutePlanner2RuntimeSourceMode,
    updateRoutePlanner2SegmentRuntimeEstimates,
    updateRoutePlanner2StopCoordinate,
    updateRoutePlanner2StopRole,
} from '../../utils/route-planner-2/routePlanner2Authoring';
import { updateRoutePlanner2Service } from '../../utils/route-planner-2/routePlanner2Feasibility';
import {
    addRoutePlanner2Scenario,
    createRoutePlanner2BackDirection,
    deleteRoutePlanner2Scenario,
    duplicateRoutePlanner2Scenario,
    importRoutePlanner2Scenario,
    markRoutePlanner2PreferredScenario,
    renameRoutePlanner2Project,
    renameRoutePlanner2Scenario,
    selectRoutePlanner2Scenario,
} from '../../utils/route-planner-2/routePlanner2ProjectController';
import { createRoutePlanner2Project } from '../../utils/route-planner-2/routePlanner2ProjectFactory';
import { exportRoutePlanner2OperatorDirectionsPdf } from '../../utils/route-planner-2/routePlanner2OperatorExport';
import { buildRoutePlanner2MapBookSections, exportRoutePlanner2MapPdf } from '../../utils/route-planner-2/routePlanner2MapExport';
import type { RoutePlanner2MapBookPage } from '../../utils/route-planner-2/routePlanner2MapExport';
import { loadRoutePlanner2GtfsImportPatterns } from '../../utils/route-planner-2/routePlanner2GtfsClient';
import {
    createRoutePlanner2ScenarioFromGtfsPattern,
    type RoutePlanner2GtfsImportPattern,
} from '../../utils/route-planner-2/routePlanner2GtfsImport';
import { summarizeRoutePlanner2Project } from '../../utils/route-planner-2/routePlanner2Summary';
import {
    listRoutePlanner2SavedProjects,
    loadRoutePlanner2Project,
    saveRoutePlanner2Project,
    type RoutePlanner2SavedProjectSummary,
} from '../../utils/route-planner-2/routePlanner2ProjectPersistence';
import { usePerformanceDataQuery, usePerformanceMetadataQuery } from '../../hooks/usePerformanceData';
import { buildCorridorSpeedIndex } from '../../utils/gtfs/corridorSpeed';
import { DAY_TYPES, TIME_PERIODS, type DayType, type TimePeriod } from '../../utils/gtfs/corridorHeadway';
import {
    deriveRoutePlanner2EvidenceRuntimeEstimates,
    type RoutePlanner2RuntimeEvidenceDiagnostic,
} from '../../utils/route-planner-2/routePlanner2RuntimeEvidence';
import {
    buildRoutePlanner2StopTransferPreview,
    type RoutePlanner2StopTransferPreview,
    type RoutePlanner2StopTransferPreviewOptions,
    type RoutePlanner2StopTransferRouteScheduleImpact,
} from '../../utils/route-planner-2/routePlanner2TransferPreview';
import {
    buildRoutePlanner2OppositeStopTransferSuggestion,
    type RoutePlanner2OppositeStopTransferSuggestion,
} from '../../utils/route-planner-2/routePlanner2OppositeTransfer';
import {
    buildRoutePlanner2StopCardDetails,
    buildRoutePlanner2StopVisitRuntimeDetails,
    type RoutePlanner2StopCardDetail,
    type RoutePlanner2StopVisitRuntimeDetail,
} from '../../utils/route-planner-2/routePlanner2StopTimes';
import { RoutePlanner2MapCanvas, type RoutePlanner2MapCanvasHandle, type RoutePlanner2RoadNameLabelDensity, type RoutePlanner2TransferPreviewMarker } from './route-planner-2/RoutePlanner2MapCanvas';
import type { RoutePlanner2MapSelection, RoutePlanner2MapSelectionMode } from '../../utils/route-planner-2/routePlanner2MapSelection';
import { RoutePlanner2GtfsImportModal } from './route-planner-2/RoutePlanner2GtfsImportModal';
import {
    RoutePlanner2AddressImportModal,
} from './route-planner-2/RoutePlanner2AddressImportModal';
import type { RoutePlanner2GeocodedAddressStop } from '../../utils/route-planner-2/routePlanner2AddressImport';
import {
    searchRoutePlanner2Addresses,
    type RoutePlanner2AddressSuggestion,
} from '../../utils/route-planner-2/routePlanner2AddressSearch';
import {
    buildRoutePlanner2StopSegmentPairs,
    buildRoutePlanner2StopVisitSequence,
    getRoutePlanner2LineWaypointsForSegment,
} from '../../utils/route-planner-2/routePlanner2Segments';
import type {
    RoutePlanner2Project,
    RoutePlanner2RouteShape,
    RoutePlanner2RoutePoint,
    RoutePlanner2RuntimeRouteFilterMode,
    RoutePlanner2Scenario,
    RoutePlanner2RuntimeSourceMode,
    RoutePlanner2SegmentRuntime,
    RoutePlanner2ServiceAssumptions,
    RoutePlanner2StopRole,
} from '../../utils/route-planner-2/routePlanner2Types';

interface RoutePlanner2WorkspaceProps {
    onBack: () => void;
    userId?: string | null;
    teamId?: string | null;
}

interface PendingStopTransferReview {
    mode: 'copy' | 'move';
    preview: RoutePlanner2StopTransferPreview;
    options: RoutePlanner2StopTransferPreviewOptions;
    oppositeSuggestion: RoutePlanner2OppositeStopTransferSuggestion | null;
    oppositePreview: RoutePlanner2StopTransferPreview | null;
    applyOpposite: boolean;
}

type SegmentSwitchStep = 'idle' | 'select-source-start' | 'select-source-end' | 'select-target' | 'select-insertion' | 'review';

interface SegmentSwitchSourceSelectionState {
    step: SegmentSwitchStep;
    fromSequence: number;
    toSequence: number;
    startSelected: boolean;
    endSelected: boolean;
}

export function getNextRoutePlanner2SegmentSwitchSourceSelection(
    state: SegmentSwitchSourceSelectionState,
    stopSequence: number,
    hasTargetScenario: boolean,
): SegmentSwitchSourceSelectionState {
    if (state.step === 'select-source-start') {
        return {
            ...state,
            step: 'select-source-end',
            fromSequence: stopSequence,
            startSelected: true,
        };
    }

    if (state.step === 'select-source-end') {
        return {
            ...state,
            step: hasTargetScenario ? 'select-insertion' : 'select-target',
            toSequence: stopSequence,
            startSelected: true,
            endSelected: true,
        };
    }

    return state;
}

const EMPTY_MAP_SELECTION: RoutePlanner2MapSelection = { stopIds: [], waypointIds: [] };

interface RoutePlanner2ConceptGroup {
    key: string;
    label: string;
    scenarios: RoutePlanner2Scenario[];
}

function getRoutePlanner2ConceptGroupKey(scenario: RoutePlanner2Scenario): string {
    if (!scenario.routeFamily) return `scenario-${scenario.id}`;
    const serviceId = scenario.source?.type === 'gtfs' ? scenario.source.serviceId ?? '' : '';
    return `family-${scenario.routeFamily.key}-${serviceId}`;
}

function getRoutePlanner2ConceptGroupLabel(scenario: RoutePlanner2Scenario): string {
    return scenario.routeFamily?.name ?? scenario.name;
}

function getRoutePlanner2FamilyDirectionOrder(scenario: RoutePlanner2Scenario): number {
    if (scenario.routeFamily?.directionRole === 'out') return 0;
    if (scenario.routeFamily?.directionRole === 'back') return 1;
    return 2;
}

function getRoutePlanner2ScenarioDirectionLabel(scenario: RoutePlanner2Scenario): string {
    if (!scenario.routeFamily) return scenario.name;
    return `${scenario.routeFamily.directionLabel} · ${scenario.routeFamily.memberShortName}`;
}

function getGeneratedDirectionParts(name: string): { baseName: string; role: 'out' | 'back' } | null {
    const match = name.trim().match(/^(.*?)\s+(Out|Back)$/i);
    if (!match?.[1] || !match[2]) return null;

    return {
        baseName: match[1].trim().toLocaleLowerCase(),
        role: match[2].toLocaleLowerCase() === 'out' ? 'out' : 'back',
    };
}

export function isRoutePlanner2PairedDirectionScenario(
    selectedScenario: RoutePlanner2Scenario | null | undefined,
    candidateScenario: RoutePlanner2Scenario,
): boolean {
    if (!selectedScenario || selectedScenario.id === candidateScenario.id) return false;

    const selectedFamily = selectedScenario.routeFamily;
    const candidateFamily = candidateScenario.routeFamily;
    if (
        selectedFamily?.key
        && candidateFamily?.key === selectedFamily.key
        && selectedFamily.directionRole
        && candidateFamily.directionRole
        && selectedFamily.directionRole !== candidateFamily.directionRole
    ) {
        return true;
    }

    const selectedGeneratedDirection = getGeneratedDirectionParts(selectedScenario.name);
    const candidateGeneratedDirection = getGeneratedDirectionParts(candidateScenario.name);
    return Boolean(
        selectedGeneratedDirection
        && candidateGeneratedDirection
        && selectedGeneratedDirection.baseName === candidateGeneratedDirection.baseName
        && selectedGeneratedDirection.role !== candidateGeneratedDirection.role,
    );
}

function buildRoutePlanner2ConceptGroups(scenarios: RoutePlanner2Scenario[]): RoutePlanner2ConceptGroup[] {
    const groups = new Map<string, RoutePlanner2ConceptGroup>();

    scenarios.forEach((scenario) => {
        const key = getRoutePlanner2ConceptGroupKey(scenario);
        const current = groups.get(key);
        if (current) {
            current.scenarios.push(scenario);
            return;
        }
        groups.set(key, {
            key,
            label: getRoutePlanner2ConceptGroupLabel(scenario),
            scenarios: [scenario],
        });
    });

    return Array.from(groups.values()).map((group) => ({
        ...group,
        scenarios: [...group.scenarios].sort((a, b) => getRoutePlanner2FamilyDirectionOrder(a) - getRoutePlanner2FamilyDirectionOrder(b)),
    }));
}

function formatRuntime(minutes: number | null | undefined): string {
    return minutes != null ? `${minutes} min` : 'Not estimated';
}

function formatBuses(value: number | null | undefined): string {
    return value != null ? String(value) : '-';
}

function formatRecovery(minutes: number | null | undefined, percent: number | null | undefined): string {
    if (minutes == null) return 'Not ready';
    return percent != null ? `${minutes} min (${percent}%)` : `${minutes} min`;
}

function formatRuntimeDelta(before: number | null | undefined, after: number | null | undefined): string {
    if (before == null || after == null) return 'not estimated';
    const delta = Math.round(after - before);
    return `${delta >= 0 ? '+' : ''}${delta} min`;
}

function formatRuntimeTransition(before: number | null | undefined, after: number | null | undefined): string {
    const delta = before != null && after != null ? ` (${formatRuntimeDelta(before, after)})` : '';
    return `${formatRuntime(before)} -> ${formatRuntime(after)}${delta}`;
}

function formatMovedRuntimeTransition(before: number | null | undefined, after: number | null | undefined): string {
    const delta = before != null && after != null ? ` (${formatRuntimeDelta(before, after)} moved runtime)` : '';
    return `${formatRuntime(before)} -> ${formatRuntime(after)}${delta}`;
}

function formatMetricDelta(delta: number | null | undefined, unit = 'min'): string {
    if (delta == null) return '—';
    return `${delta >= 0 ? '+' : ''}${delta} ${unit}`;
}

function formatBusTransition(before: number | null | undefined, after: number | null | undefined): string {
    return `${formatBuses(before)} -> ${formatBuses(after)}`;
}

function runtimeDeltaDiffers(first: number | null | undefined, second: number | null | undefined): boolean {
    return first != null && second != null && Math.round(first) !== Math.round(second);
}

function formatTransferCount(count: number, singular: string, plural = `${singular}s`): string {
    return `${count} ${count === 1 ? singular : plural}`;
}

function getStopTransferInsertAfterStopId(
    insertSelection: string,
    targetStops: Array<{ id: string }>,
): string | null {
    if (insertSelection === '__start') return null;
    if (insertSelection === '__end') return targetStops[targetStops.length - 1]?.id ?? null;
    return insertSelection || null;
}

function buildSegmentTransferImpactMessage(
    preview: RoutePlanner2StopTransferPreview | null,
    mode: 'copy' | 'move',
): string | null {
    if (!preview) return null;

    const action = mode === 'move' ? 'Moved' : 'Copied';
    const stopsLabel = preview.transferredStopCount === 1 ? '1 stop' : `${preview.transferredStopCount} stops`;
    const sourceDelta = preview.sourceAccountingRuntimeDeltaMinutes;
    const targetDelta = preview.targetAccountingRuntimeDeltaMinutes;
    const sourceRuntimeText = mode === 'move' && sourceDelta != null
        ? `Source runtime ${sourceDelta >= 0 ? '+' : ''}${sourceDelta} min`
        : 'Source runtime unchanged';
    const targetRuntimeText = targetDelta != null
        ? `target runtime ${targetDelta >= 0 ? '+' : ''}${targetDelta} min`
        : 'target runtime not estimated';

    return `${action} ${stopsLabel} from ${preview.sourceScenarioName} to ${preview.targetScenarioName}. ${sourceRuntimeText}; ${targetRuntimeText}.`;
}

function SegmentSwitchImpactCard({ impact }: { impact: RoutePlanner2StopTransferRouteScheduleImpact }) {
    const runtimeTone = impact.role === 'target' ? 'text-emerald-700' : 'text-red-700';
    return (
        <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
            <div className="flex items-start justify-between gap-3">
                <div>
                    <div className="text-[10px] font-black uppercase tracking-wide text-slate-500">
                        {impact.role === 'source' ? 'Source route' : 'Target route'}
                    </div>
                    <div className="mt-1 text-sm font-black text-slate-950">{impact.routeName}</div>
                </div>
                <span className={`rounded-full px-2 py-1 text-[10px] font-black ${runtimeTone} bg-slate-50`}>
                    {formatMetricDelta(impact.runtime.delta)}
                </span>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                <div className="rounded-xl bg-slate-50 px-2.5 py-2">
                    <div className="font-black uppercase tracking-wide text-slate-500">Runtime</div>
                    <div className="mt-1 font-bold text-slate-900">{formatRuntime(impact.runtime.before)} → {formatRuntime(impact.runtime.after)}</div>
                </div>
                <div className="rounded-xl bg-slate-50 px-2.5 py-2">
                    <div className="font-black uppercase tracking-wide text-slate-500">Cycle</div>
                    <div className="mt-1 font-bold text-slate-900">{formatRuntime(impact.cycleTime.before)} → {formatRuntime(impact.cycleTime.after)}</div>
                    <div className="text-[11px] font-black text-slate-500">{formatMetricDelta(impact.cycleTime.delta)}</div>
                </div>
                <div className="rounded-xl bg-slate-50 px-2.5 py-2">
                    <div className="font-black uppercase tracking-wide text-slate-500">Recovery</div>
                    <div className="mt-1 font-bold text-slate-900">{formatRuntime(impact.recoveryTime.before)} → {formatRuntime(impact.recoveryTime.after)}</div>
                    <div className="text-[11px] font-semibold text-slate-500">{impact.recoveryPercentBefore ?? '—'}% → {impact.recoveryPercentAfter ?? '—'}%</div>
                </div>
                <div className="rounded-xl bg-slate-50 px-2.5 py-2">
                    <div className="font-black uppercase tracking-wide text-slate-500">Buses</div>
                    <div className="mt-1 font-bold text-slate-900">{formatBusTransition(impact.busesRequired.before, impact.busesRequired.after)}</div>
                    <div className="text-[11px] font-black text-slate-500">{formatMetricDelta(impact.busesRequired.delta, 'bus')}</div>
                </div>
            </div>
        </div>
    );
}

function getRoutePlanner2SaveErrorMessage(error: unknown): string {
    const code = error && typeof error === 'object' && 'code' in error
        ? String((error as { code?: unknown }).code)
        : '';
    const message = error instanceof Error ? error.message : '';

    if (code.includes('permission-denied')) {
        return 'Save failed: your account does not have access to save route plans for this workspace.';
    }

    if (code.includes('unavailable')) {
        return 'Save failed: Firebase is temporarily unavailable. Please try again.';
    }

    if (code.includes('resource-exhausted') || /too large|maximum size|1\s*MiB/i.test(message)) {
        return 'Save failed: this route plan is too large to save. Try removing unused route concepts.';
    }

    return 'Save failed. Please try again.';
}

function getDrawingGuide(scenario: RoutePlanner2Scenario | null | undefined): { title: string; body?: string; actionLabel: string } {
    const stopCount = scenario?.stops.length ?? 0;
    const hasStartTerminal = scenario?.stops.some((stop) => stop.role === 'start-terminal') ?? false;
    const hasEndTerminal = scenario?.stops.some((stop) => stop.role === 'end-terminal') ?? false;

    if (stopCount === 0) {
        return {
            title: 'Move the mouse over the map and press 1 to place Stop 1',
            actionLabel: 'Add Stop 1',
        };
    }

    if (stopCount === 1) {
        return {
            title: 'Add the next stop',
            body: 'Mark terminals after adding at least two stops.',
            actionLabel: 'Add next stop',
        };
    }

    if (scenario?.routeShape === 'closed-loop') {
        return {
            title: 'Closed loop route',
            body: `The route returns from Stop ${stopCount} to Stop 1. Press 2 near the route to add a bend, then drag the + handle to shape it.`,
            actionLabel: `Add Stop ${stopCount + 1}`,
        };
    }

    if (scenario?.routeShape === 'out-and-back') {
        const turnaroundStop = scenario.stops.find((stop) => stop.id === scenario.turnaroundStopId) ?? null;
        return {
            title: turnaroundStop ? `Out and back to ${turnaroundStop.name}` : 'Out and back route',
            body: turnaroundStop
                ? 'The return trip is added only from the marked bus turnaround. Use a real loop, terminal, or safe turning location.'
                : 'The far end stop is used as the turnaround when you choose Out and back.',
            actionLabel: `Add Stop ${stopCount + 1}`,
        };
    }

    if (!hasStartTerminal || !hasEndTerminal) {
        return {
            title: 'Mark start and end terminals',
            body: 'Press 1 to add stops at the mouse pointer. Press 2 near a route segment to add a bend.',
            actionLabel: `Add Stop ${stopCount + 1}`,
        };
    }

    return {
        title: 'Review feasibility',
        body: 'Press 1 to add stops at the mouse pointer. Press 2 near a route segment to add a bend.',
        actionLabel: `Add Stop ${stopCount + 1}`,
    };
}

function stopRoleLabel(role: RoutePlanner2StopRole): string {
    if (role === 'start-terminal') return 'Start terminal';
    if (role === 'end-terminal') return 'End terminal';
    if (role === 'turnaround') return 'Bus turnaround';
    if (role === 'timed') return 'Timed stop';
    return 'Regular stop';
}

function confidenceClass(confidence: string): string {
    if (confidence === 'low') return 'bg-amber-100 text-amber-700';
    if (confidence === 'not-ready') return 'bg-slate-100 text-slate-600';
    return 'bg-emerald-100 text-emerald-700';
}

function confidenceDescription(confidence: string | null | undefined): string {
    if (confidence === 'high') return 'High confidence: scheduled GTFS runtimes or strong observed evidence support most route segments.';
    if (confidence === 'medium') return 'Medium confidence: Mapbox estimates or planner-entered runtimes support the estimate.';
    if (confidence === 'low') return 'Low confidence: the route is mostly using fallback planning assumptions.';
    return 'Not ready: required route inputs are missing before the estimate can be trusted.';
}

function runtimeSourceLabel(source: RoutePlanner2SegmentRuntime['source']): string {
    if (source === 'observed-proxy') return 'Observed runtime';
    if (source === 'observed-scheduled-blend') return 'Observed + schedule blend';
    if (source === 'scheduled-proxy') return 'Scheduled runtime';
    if (source === 'partial-scheduled-proxy') return 'Partial scheduled runtime';
    if (source === 'mapbox') return 'Mapbox planning estimate';
    if (source === 'manual') return 'Planner override';
    if (source === 'fallback') return 'Distance fallback';
    return 'Missing runtime';
}

function conciseRuntimeSourceLabel(source: RoutePlanner2SegmentRuntime['source']): string {
    if (source === 'scheduled-proxy') return 'Scheduled GTFS';
    if (source === 'partial-scheduled-proxy') return 'Partial GTFS + estimate';
    if (source === 'observed-proxy') return 'Observed';
    if (source === 'observed-scheduled-blend') return 'Observed + schedule';
    if (source === 'mapbox') return 'Mapbox';
    if (source === 'manual') return 'Planner override';
    if (source === 'fallback') return 'Distance fallback';
    return 'Source not ready';
}

function formatRouteSource(routes: string[]): string {
    const uniqueRoutes = [...new Set(routes.filter(Boolean))]
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
    if (uniqueRoutes.length === 0) return '';
    if (uniqueRoutes.length === 1) return `Route ${uniqueRoutes[0]}`;
    return `Routes ${uniqueRoutes.join(', ')}`;
}

function formatSavedProjectLabel(project: RoutePlanner2SavedProjectSummary): string {
    const savedAt = new Date(project.updatedAt);
    const savedLabel = Number.isNaN(savedAt.getTime())
        ? 'recent save'
        : savedAt.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    const scenarioLabel = project.scenarioCount === 1 ? '1 route' : `${project.scenarioCount} routes`;
    return `${project.name} · ${scenarioLabel} · ${savedLabel}`;
}

function getRuntimeSourceDetail(
    feasibility: RoutePlanner2Project['scenarios'][number]['feasibility'] | null | undefined,
    dayType: DayType,
    period: TimePeriod,
): string {
    const segments = feasibility?.segmentSummaries ?? [];
    if (segments.length === 0) return 'Source not ready';
    const sources = [...new Set(segments.map((segment) => segment.source))];
    const sourceLabel = sources.length === 1 ? conciseRuntimeSourceLabel(sources[0]!) : 'Mixed sources';
    const matchedRoutes = segments.flatMap((segment) => segment.matchedRoutes ?? []);
    const routeLabel = formatRouteSource(matchedRoutes);
    const timeLabel = getRuntimeEvidencePeriodDetail(segments, dayType, period);
    return [sourceLabel, routeLabel, timeLabel].filter(Boolean).join(' · ');
}

function getRuntimePeriodDetail(dayType: DayType, period: TimePeriod): string {
    const dayLabel = DAY_TYPES.find((day) => day.id === dayType)?.label ?? dayType;
    const periodLabel = TIME_PERIODS.find((item) => item.id === period)?.label ?? period;
    return `${dayLabel} · ${periodLabel}`;
}

function getRuntimeEvidencePeriodDetail(
    segments: RoutePlanner2SegmentRuntime[],
    dayType: DayType,
    period: TimePeriod,
): string {
    const evidencePairs = [...new Set(segments
        .filter((segment) => segment.evidenceDayType && segment.evidencePeriod)
        .map((segment) => `${segment.evidenceDayType}|${segment.evidencePeriod}`))];
    if (evidencePairs.length === 1) {
        const [evidenceDayType, evidencePeriod] = evidencePairs[0]!.split('|') as [DayType, TimePeriod];
        return getRuntimePeriodDetail(evidenceDayType, evidencePeriod);
    }
    return getRuntimePeriodDetail(dayType, period);
}

function getRuntimeBandDisclosure(
    feasibility: RoutePlanner2Project['scenarios'][number]['feasibility'] | null | undefined,
    dayType: DayType,
    period: TimePeriod,
): string {
    const selectedLabel = getRuntimePeriodDetail(dayType, period);
    const actualLabel = getRuntimeEvidencePeriodDetail(feasibility?.segmentSummaries ?? [], dayType, period);
    if (actualLabel === selectedLabel) return actualLabel;
    return `${actualLabel} (fallback for selected ${selectedLabel})`;
}

function getRuntimeSourceBadgeClass(source: RoutePlanner2SegmentRuntime['source']): string {
    if (source === 'scheduled-proxy') return 'border-emerald-200 bg-emerald-50 text-emerald-800';
    if (source === 'partial-scheduled-proxy') return 'border-lime-200 bg-lime-50 text-lime-800';
    if (source === 'mapbox') return 'border-cyan-200 bg-cyan-50 text-cyan-800';
    if (source === 'manual') return 'border-indigo-200 bg-indigo-50 text-indigo-800';
    if (source === 'fallback') return 'border-amber-200 bg-amber-50 text-amber-800';
    if (source === 'observed-proxy' || source === 'observed-scheduled-blend') return 'border-blue-200 bg-blue-50 text-blue-800';
    return 'border-slate-200 bg-slate-50 text-slate-700';
}

function getSegmentSourceBadgeText(segment: RoutePlanner2SegmentRuntime, dayType: DayType, period: TimePeriod): string {
    const routeLabel = formatRouteSource(segment.matchedRoutes ?? []);
    const timeLabel = segment.evidenceDayType && segment.evidencePeriod
        ? getRuntimePeriodDetail(segment.evidenceDayType, segment.evidencePeriod)
        : getRuntimePeriodDetail(dayType, period);
    if (segment.source === 'scheduled-proxy') {
        return [
            segment.evidenceMethod === 'shape-overlap'
                ? 'Scheduled GTFS shape match'
                : segment.evidenceMethod === 'corridor-path'
                    ? 'Scheduled GTFS corridor estimate'
                    : 'Scheduled GTFS',
            routeLabel,
            timeLabel,
        ].filter(Boolean).join(' · ');
    }
    if (segment.source === 'partial-scheduled-proxy') {
        const coverageLabel = segment.scheduledCoverageRatio != null
            ? `${Math.round(segment.scheduledCoverageRatio * 100)}% covered`
            : 'partial coverage';
        return ['Partial GTFS + estimate', routeLabel, coverageLabel].filter(Boolean).join(' · ');
    }
    if (segment.source === 'mapbox') return 'Mapbox estimate';
    if (segment.source === 'manual') return 'Planner override';
    if (segment.source === 'fallback') return 'Fallback estimate';
    return [conciseRuntimeSourceLabel(segment.source), routeLabel, timeLabel].filter(Boolean).join(' · ');
}

function getRuntimeRouteBreakdownNote(segment: RoutePlanner2SegmentRuntime, isSelectedRouteMode: boolean): string | null {
    const breakdown = segment.runtimeRouteBreakdown ?? [];
    if ((segment.source !== 'scheduled-proxy' && segment.source !== 'partial-scheduled-proxy') || breakdown.length === 0) return null;
    if (breakdown.length === 1) {
        const routeLabel = `Route ${breakdown[0]!.routeShortName}`;
        return isSelectedRouteMode
            ? `Runtime basis: selected ${routeLabel}.`
            : `Runtime basis: ${routeLabel} only.`;
    }
    return `Runtime basis: median of ${breakdown.length} matching GTFS routes.`;
}

function getRuntimeSourceSummaryItems(
    segments: RoutePlanner2SegmentRuntime[],
    dayType: DayType,
    period: TimePeriod,
): Array<{ key: string; label: string; count: number; source: RoutePlanner2SegmentRuntime['source'] }> {
    const summary = new Map<string, { label: string; count: number; source: RoutePlanner2SegmentRuntime['source'] }>();
    segments.forEach((segment) => {
        const label = getSegmentSourceBadgeText(segment, dayType, period);
        const existing = summary.get(label);
        if (existing) {
            existing.count += 1;
            return;
        }
        summary.set(label, { label, count: 1, source: segment.source });
    });
    return Array.from(summary.entries()).map(([key, value]) => ({ key, ...value }));
}

function getScheduledGapMessage(
    segment: RoutePlanner2SegmentRuntime,
    scenario: RoutePlanner2Project['scenarios'][number] | null | undefined,
    dayType: DayType,
    period: TimePeriod,
): string | null {
    if (segment.source === 'scheduled-proxy' || segment.source === 'partial-scheduled-proxy' || segment.source === 'manual') return null;
    if ((scenario?.runtimeSourceMode ?? 'mapbox') === 'mapbox') {
        return `GTFS route runtime is off; using ${segment.source === 'mapbox' ? 'Mapbox' : 'fallback'} estimate.`;
    }
    const timeLabel = getRuntimePeriodDetail(dayType, period);
    if (scenario?.source?.type === 'gtfs' && scenario.source.routeShortName) {
        return `No scheduled GTFS runtime found for Route ${scenario.source.routeShortName} · ${timeLabel}; using ${segment.source === 'mapbox' ? 'Mapbox' : 'fallback'} estimate.`;
    }
    return `No scheduled GTFS stop-pair or corridor match found for this custom concept · ${timeLabel}; using ${segment.source === 'mapbox' ? 'Mapbox' : 'fallback'} estimate.`;
}

function getOriginalRuntimeEstimate(
    scenario: RoutePlanner2Project['scenarios'][number],
    segment: RoutePlanner2SegmentRuntime,
): RoutePlanner2SegmentRuntime | null {
    if (segment.source !== 'manual') return null;
    return scenario.runtimeEstimates?.find((estimate) =>
        estimate.id === segment.id
        || (estimate.fromStopId === segment.fromStopId && estimate.toStopId === segment.toStopId)
    ) ?? null;
}

function shouldLogRoutePlanner2RuntimeDiagnostics(): boolean {
    return Boolean(import.meta.env.DEV && import.meta.env.MODE !== 'test');
}

function logRoutePlanner2RuntimeDiagnostics(diagnostic: RoutePlanner2RuntimeEvidenceDiagnostic): void {
    if (!shouldLogRoutePlanner2RuntimeDiagnostics()) return;
    const missedSegments = diagnostic.segments.filter((segment) => segment.reason !== 'matched');
    console.groupCollapsed(
        `[RoutePlanner2 runtime diagnostics] ${diagnostic.scenarioName} · ${diagnostic.dayType}/${diagnostic.period} · ${diagnostic.estimateCount}/${diagnostic.segmentCount} scheduled estimates`,
    );
    console.info('Runtime evidence context', {
        scenarioId: diagnostic.scenarioId,
        preferredRoute: diagnostic.preferredRoute,
        runtimeBasis: diagnostic.runtimeBasis,
        gtfsStopCount: diagnostic.gtfsStopCount,
        speedSegmentCount: diagnostic.speedSegmentCount,
        statsForSelectedPeriodCount: diagnostic.statsForSelectedPeriodCount,
    });
    console.table(diagnostic.segments.map((segment) => ({
        segmentId: segment.segmentId,
        from: segment.fromStopName ?? segment.fromStopId,
        to: segment.toStopName ?? segment.toStopId,
        reason: segment.reason,
        fromGtfs: segment.fromGtfsMatch
            ? `${segment.fromGtfsMatch.gtfsStopId} (${segment.fromGtfsMatch.quality})`
            : 'none',
        toGtfs: segment.toGtfsMatch
            ? `${segment.toGtfsMatch.gtfsStopId} (${segment.toGtfsMatch.quality})`
            : 'none',
        speedSegment: segment.matchedSpeedSegmentId ?? 'none',
        segmentRoutes: segment.matchedSegmentRoutes?.join(', ') ?? '',
        statRoutes: segment.statRoutes?.join(', ') ?? '',
        scheduledMin: segment.scheduledRuntimeMin ?? '',
        routeScopedScheduledMin: segment.routeScopedScheduledRuntimeMin ?? '',
        output: segment.runtimeMinutes != null ? `${segment.runtimeMinutes} min ${segment.source ?? ''}` : '',
    })));
    if (missedSegments.length > 0) {
        console.warn('Scheduled GTFS misses', missedSegments);
    }
    console.groupEnd();
}

function readinessClass(readiness: string): string {
    if (readiness === 'needs-review') return 'border-amber-200 bg-amber-50 text-amber-900';
    if (readiness === 'ready-for-review') return 'border-emerald-200 bg-emerald-50 text-emerald-900';
    return 'border-slate-200 bg-slate-50 text-slate-800';
}

function updateScenarioNotes(
    project: RoutePlanner2Project,
    scenarioId: string,
    notes: string,
    now = new Date().toISOString(),
): RoutePlanner2Project {
    let changed = false;
    const scenarios = project.scenarios.map((scenario) => {
        if (scenario.id !== scenarioId || scenario.notes === notes) return scenario;
        changed = true;
        return { ...scenario, notes, updatedAt: now };
    });
    return changed ? {
        ...project,
        status: project.status === 'archived' ? 'archived' : 'local-draft',
        scenarios,
        updatedAt: now,
    } : project;
}

function updateScenarioRuntimeRouteFilter(
    project: RoutePlanner2Project,
    scenarioId: string,
    mode: RoutePlanner2RuntimeRouteFilterMode,
    routeShortNames: string[],
    now = new Date().toISOString(),
): RoutePlanner2Project {
    const normalizedRoutes = [...new Set(routeShortNames.filter(Boolean))]
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
    let changed = false;
    const scenarios = project.scenarios.map((scenario) => {
        if (scenario.id !== scenarioId) return scenario;
        const currentMode = scenario.runtimeRouteFilter?.mode ?? 'all-matching';
        const currentRoutes = scenario.runtimeRouteFilter?.routeShortNames ?? [];
        const sameRoutes = currentRoutes.length === normalizedRoutes.length
            && currentRoutes.every((route, index) => route === normalizedRoutes[index]);
        if (currentMode === mode && sameRoutes) return scenario;
        changed = true;
        return {
            ...scenario,
            runtimeRouteFilter: { mode, routeShortNames: normalizedRoutes },
            updatedAt: now,
        };
    });
    return changed ? {
        ...project,
        status: project.status === 'archived' ? 'archived' : 'local-draft',
        scenarios,
        updatedAt: now,
    } : project;
}

const ROUTE_PLANNER_UNDO_HISTORY_LIMIT = 75;

interface RoutePlanner2ProjectHistory {
    past: RoutePlanner2Project[];
    present: RoutePlanner2Project;
    future: RoutePlanner2Project[];
}

type RoutePlanner2ProjectHistoryAction =
    | { type: 'set'; update: React.SetStateAction<RoutePlanner2Project>; trackHistory: boolean }
    | { type: 'reset'; project: RoutePlanner2Project }
    | { type: 'undo' }
    | { type: 'redo' };

function resolveProjectUpdate(
    update: React.SetStateAction<RoutePlanner2Project>,
    current: RoutePlanner2Project,
): RoutePlanner2Project {
    return typeof update === 'function'
        ? (update as (currentProject: RoutePlanner2Project) => RoutePlanner2Project)(current)
        : update;
}

function routePlanner2ProjectHistoryReducer(
    state: RoutePlanner2ProjectHistory,
    action: RoutePlanner2ProjectHistoryAction,
): RoutePlanner2ProjectHistory {
    if (action.type === 'reset') {
        return { past: [], present: action.project, future: [] };
    }

    if (action.type === 'undo') {
        const previousProject = state.past.at(-1);
        if (!previousProject) return state;
        return {
            past: state.past.slice(0, -1),
            present: previousProject,
            future: [state.present, ...state.future],
        };
    }

    if (action.type === 'redo') {
        const nextProject = state.future[0];
        if (!nextProject) return state;
        return {
            past: [...state.past, state.present].slice(-ROUTE_PLANNER_UNDO_HISTORY_LIMIT),
            present: nextProject,
            future: state.future.slice(1),
        };
    }

    const nextProject = resolveProjectUpdate(action.update, state.present);
    if (nextProject === state.present) return state;

    if (!action.trackHistory) {
        return { ...state, present: nextProject };
    }

    return {
        past: [...state.past, state.present].slice(-ROUTE_PLANNER_UNDO_HISTORY_LIMIT),
        present: nextProject,
        future: [],
    };
}

function isEditableEventTarget(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return false;
    const tagName = target.tagName.toLowerCase();
    return target.isContentEditable || tagName === 'input' || tagName === 'textarea' || tagName === 'select';
}

type RoutePlanner2StopOrderItem =
    | { type: 'stop'; key: string; stop: RoutePlanner2Scenario['stops'][number] }
    | { type: 'bend'; key: string; bend: RoutePlanner2RoutePoint; fromStopName: string; toStopName: string; bendNumber: number };

function buildStopOrderItems(scenario: RoutePlanner2Scenario | null | undefined): RoutePlanner2StopOrderItem[] {
    if (!scenario) return [];
    const visits = buildRoutePlanner2StopVisitSequence(scenario);
    if (visits.length === 0) return [];

    const items: RoutePlanner2StopOrderItem[] = [{
        type: 'stop',
        key: `stop-${visits[0]!.id}-0`,
        stop: visits[0]!,
    }];
    let bendNumber = 1;

    buildRoutePlanner2StopSegmentPairs(scenario).forEach(({ fromStop, toStop }, pairIndex) => {
        const bends = getRoutePlanner2LineWaypointsForSegment(scenario.alignment, fromStop.id, toStop.id);
        bends.forEach((bend) => {
            items.push({
                type: 'bend',
                key: `bend-${bend.id}-${pairIndex}`,
                bend,
                fromStopName: fromStop.name,
                toStopName: toStop.name,
                bendNumber,
            });
            bendNumber += 1;
        });
        items.push({
            type: 'stop',
            key: `stop-${toStop.id}-${pairIndex + 1}`,
            stop: toStop,
        });
    });

    return items;
}

export const RoutePlanner2Workspace: React.FC<RoutePlanner2WorkspaceProps> = ({ onBack, userId, teamId }) => {
    const [projectHistory, dispatchProjectHistory] = useReducer(
        routePlanner2ProjectHistoryReducer,
        undefined,
        (): RoutePlanner2ProjectHistory => ({ past: [], present: createRoutePlanner2Project(), future: [] }),
    );
    const project = projectHistory.present;
    const canUndoProject = projectHistory.past.length > 0;
    const canRedoProject = projectHistory.future.length > 0;
    const setProject = useCallback((
        update: React.SetStateAction<RoutePlanner2Project>,
        options: { trackHistory?: boolean } = {},
    ) => {
        dispatchProjectHistory({ type: 'set', update, trackHistory: options.trackHistory ?? true });
    }, []);
    const resetProjectHistory = useCallback((projectToLoad: RoutePlanner2Project) => {
        dispatchProjectHistory({ type: 'reset', project: projectToLoad });
    }, []);
    const undoProjectChange = useCallback(() => dispatchProjectHistory({ type: 'undo' }), []);
    const redoProjectChange = useCallback(() => dispatchProjectHistory({ type: 'redo' }), []);
    const [selectedStopId, setSelectedStopId] = useState<string | null>(null);
    const [isRightRailOpen, setIsRightRailOpen] = useState(true);
    const [isActionSidebarOpen, setIsActionSidebarOpen] = useState(false);
    const runtimeSourceDetailsRef = useRef<HTMLDivElement | null>(null);
    const mapCanvasRef = useRef<RoutePlanner2MapCanvasHandle | null>(null);
    const [isDrawFocusMode, setIsDrawFocusMode] = useState(false);
    const [isExportingOperatorPdf, setIsExportingOperatorPdf] = useState(false);
    const [isExportingMapPdf, setIsExportingMapPdf] = useState(false);
    const [isExportMenuOpen, setIsExportMenuOpen] = useState(false);
    const [isSelectionMenuOpen, setIsSelectionMenuOpen] = useState(false);
    const [mapSelectionMode, setMapSelectionMode] = useState<RoutePlanner2MapSelectionMode | null>(null);
    const [mapSelection, setMapSelection] = useState<RoutePlanner2MapSelection>(EMPTY_MAP_SELECTION);
    const [isGtfsImportOpen, setIsGtfsImportOpen] = useState(false);
    const [isAddressImportOpen, setIsAddressImportOpen] = useState(false);
    const [segmentSwitchStep, setSegmentSwitchStep] = useState<SegmentSwitchStep>('idle');
    const [gtfsPatterns, setGtfsPatterns] = useState<RoutePlanner2GtfsImportPattern[]>([]);
    const [gtfsLoading, setGtfsLoading] = useState(false);
    const [gtfsError, setGtfsError] = useState<string | null>(null);
    const [transferFromSequence, setTransferFromSequence] = useState(1);
    const [transferToSequence, setTransferToSequence] = useState(1);
    const [transferSourceStartSelected, setTransferSourceStartSelected] = useState(false);
    const [transferSourceEndSelected, setTransferSourceEndSelected] = useState(false);
    const [transferTargetScenarioId, setTransferTargetScenarioId] = useState('');
    const [transferInsertAfterStopId, setTransferInsertAfterStopId] = useState('__end');
    const [transferApplyOppositeDirection, setTransferApplyOppositeDirection] = useState(true);
    const [segmentTransferImpactMessage, setSegmentTransferImpactMessage] = useState<string | null>(null);
    const [pendingStopTransferReview, setPendingStopTransferReview] = useState<PendingStopTransferReview | null>(null);
    const segmentSwitchModeActive = segmentSwitchStep !== 'idle' || Boolean(pendingStopTransferReview);
    const [lastTransferUndoMessage, setLastTransferUndoMessage] = useState<string | null>(null);
    const [runtimeDayType, setRuntimeDayType] = useState<DayType>('weekday');
    const [runtimePeriod, setRuntimePeriod] = useState<TimePeriod>('full-day');
    const [runtimeAvailableRoutesByScenario, setRuntimeAvailableRoutesByScenario] = useState<Record<string, string[]>>({});
    const [savedProjects, setSavedProjects] = useState<RoutePlanner2SavedProjectSummary[]>([]);
    const [selectedSavedProjectId, setSelectedSavedProjectId] = useState('');
    const [isLoadingSavedProjects, setIsLoadingSavedProjects] = useState(false);
    const [savedProjectsLoadFailed, setSavedProjectsLoadFailed] = useState(false);
    const [isLoadPickerOpen, setIsLoadPickerOpen] = useState(false);
    const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
    const [loadState, setLoadState] = useState<'idle' | 'loading' | 'error'>('idle');
    const [saveMessage, setSaveMessage] = useState<string | null>(null);
    const [showRuntimeSourceOverlay, setShowRuntimeSourceOverlay] = useState(false);
    const [showRoadNameLabels, setShowRoadNameLabels] = useState(true);
    const [showCampShuttleLabels, setShowCampShuttleLabels] = useState(false);
    const [roadNameLabelDensity, setRoadNameLabelDensity] = useState<RoutePlanner2RoadNameLabelDensity>('normal');
    const [roadNameLabelStatus, setRoadNameLabelStatus] = useState<{ available: boolean; count: number }>({ available: false, count: 0 });
    const [hoveredMapItem, setHoveredMapItem] = useState<{ type: 'stop' | 'waypoint' | 'segment'; id: string } | null>(null);
    const [draggedStopOrderKey, setDraggedStopOrderKey] = useState<string | null>(null);
    const [addressQuery, setAddressQuery] = useState('');
    const [addressSuggestions, setAddressSuggestions] = useState<RoutePlanner2AddressSuggestion[]>([]);
    const [selectedAddress, setSelectedAddress] = useState<RoutePlanner2AddressSuggestion | null>(null);
    const [addressInsertAfterStopId, setAddressInsertAfterStopId] = useState('__end');
    const [addressSearchLoading, setAddressSearchLoading] = useState(false);
    const [addressSearchError, setAddressSearchError] = useState<string | null>(null);
    const projectSummary = useMemo(() => summarizeRoutePlanner2Project(project), [project]);
    const routeConceptGroups = useMemo(() => buildRoutePlanner2ConceptGroups(project.scenarios), [project.scenarios]);
    const selectedScenario = useMemo(
        () => project.scenarios.find((scenario) => scenario.id === project.selectedScenarioId) ?? project.scenarios[0],
        [project.scenarios, project.selectedScenarioId],
    );
    const backgroundScenarios = useMemo(
        () => project.scenarios.filter((scenario) =>
            scenario.id !== selectedScenario?.id
            && !isRoutePlanner2PairedDirectionScenario(selectedScenario, scenario),
        ),
        [project.scenarios, selectedScenario],
    );
    const selectedScenarioSummary = projectSummary.selectedScenarioSummary;
    const selectedFeasibility = selectedScenarioSummary?.feasibility ?? null;
    const selectedRouteFamilySummary = projectSummary.selectedRouteFamilySummary;
    const runtimeMatchedRoutes = useMemo(
        () => [...new Set((selectedFeasibility?.segmentSummaries ?? [])
            .flatMap((segment) => segment.matchedRoutes ?? [])
            .filter(Boolean))]
            .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })),
        [selectedFeasibility?.segmentSummaries],
    );
    const runtimeRouteFilterMode = selectedScenario?.runtimeRouteFilter?.mode ?? 'all-matching';
    const runtimeSelectedRoutes = selectedScenario?.runtimeRouteFilter?.routeShortNames ?? [];
    const runtimeSourceMode = selectedScenario?.runtimeSourceMode ?? 'mapbox';
    const runtimeRouteOptions = useMemo(
        () => [...new Set([
            ...(selectedScenario?.id ? runtimeAvailableRoutesByScenario[selectedScenario.id] ?? [] : []),
            ...runtimeMatchedRoutes,
            ...runtimeSelectedRoutes,
        ])].sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })),
        [runtimeAvailableRoutesByScenario, runtimeMatchedRoutes, runtimeSelectedRoutes, selectedScenario?.id],
    );
    const selectedStop = useMemo(
        () => selectedScenario?.stops.find((stop) => stop.id === selectedStopId) ?? null,
        [selectedScenario?.stops, selectedStopId],
    );
    const selectedScenarioStops = useMemo(
        () => selectedScenario ? [...selectedScenario.stops].sort((a, b) => a.sequence - b.sequence) : [],
        [selectedScenario],
    );
    const stopCardDetails = useMemo(
        () => selectedScenario ? buildRoutePlanner2StopCardDetails(selectedScenario, selectedFeasibility) : [],
        [selectedFeasibility, selectedScenario],
    );
    const stopCardDetailsByStopId = useMemo(
        () => new Map<string, RoutePlanner2StopCardDetail>(stopCardDetails.map((detail) => [detail.stopId, detail])),
        [stopCardDetails],
    );
    const stopVisitRuntimeDetails = useMemo(
        () => selectedScenario ? buildRoutePlanner2StopVisitRuntimeDetails(selectedScenario, selectedFeasibility) : [],
        [selectedFeasibility, selectedScenario],
    );
    const stopVisitRuntimeDetailsByKey = useMemo(
        () => new Map<string, RoutePlanner2StopVisitRuntimeDetail>(stopVisitRuntimeDetails.map((detail) => [detail.key, detail])),
        [stopVisitRuntimeDetails],
    );
    const stopMapLabelDetails = useMemo(
        () => selectedScenarioStops.map((stop) => {
            const detail = stopCardDetailsByStopId.get(stop.id);
            return {
                stopId: stop.id,
                stopName: stop.name,
                address: stop.address,
                kidsAtStop: detail?.kidsAtStop ?? 0,
                travelTimeLabel: detail?.travelTimeLabel ?? 'Not estimated',
                departureLabel: detail?.arrivalLabel,
            };
        }),
        [selectedScenarioStops, stopCardDetailsByStopId],
    );
    const stopOrderItems = useMemo(() => buildStopOrderItems(selectedScenario), [selectedScenario]);
    const selectedScenarioFirstStopSequence = selectedScenarioStops[0]?.sequence ?? 1;
    const transferTargetScenario = useMemo(
        () => project.scenarios.find((scenario) => scenario.id === transferTargetScenarioId) ?? null,
        [project.scenarios, transferTargetScenarioId],
    );
    const transferTargetStops = useMemo(
        () => transferTargetScenario ? [...transferTargetScenario.stops].sort((a, b) => a.sequence - b.sequence) : [],
        [transferTargetScenario],
    );
    const transferTargetOptions = useMemo(
        () => project.scenarios.filter((scenario) => scenario.id !== selectedScenario?.id),
        [project.scenarios, selectedScenario?.id],
    );
    useEffect(() => {
        if (transferTargetOptions.some((scenario) => scenario.id === transferTargetScenarioId)) return;
        setTransferTargetScenarioId(transferTargetOptions[0]?.id ?? '');
        setTransferInsertAfterStopId('__end');
    }, [transferTargetOptions, transferTargetScenarioId]);
    useEffect(() => {
        if (addressInsertAfterStopId === '__beginning' || addressInsertAfterStopId === '__end') return;
        if (selectedScenarioStops.some((stop) => stop.id === addressInsertAfterStopId)) return;
        setAddressInsertAfterStopId('__end');
    }, [addressInsertAfterStopId, selectedScenarioStops]);
    useEffect(() => {
        if (selectedScenarioStops.length === 0) return;
        const sequenceSet = new Set(selectedScenarioStops.map((stop) => stop.sequence));
        if (!sequenceSet.has(transferFromSequence)) {
            setTransferFromSequence(selectedScenarioStops[0]?.sequence ?? 1);
        }
        if (!sequenceSet.has(transferToSequence)) {
            setTransferToSequence(selectedScenarioStops[0]?.sequence ?? 1);
        }
    }, [selectedScenarioStops, transferFromSequence, transferToSequence]);
    const transferStopCount = useMemo(
        () => selectedScenarioStops.filter((stop) =>
            stop.sequence >= Math.min(transferFromSequence, transferToSequence)
            && stop.sequence <= Math.max(transferFromSequence, transferToSequence),
        ).length,
        [selectedScenarioStops, transferFromSequence, transferToSequence],
    );
    const sourceSegmentSelectionReady = transferSourceStartSelected && transferSourceEndSelected;
    const displayedTransferStopCount = sourceSegmentSelectionReady
        ? transferStopCount
        : Number(transferSourceStartSelected) + Number(transferSourceEndSelected);
    const transferInsertAfterStopIdForPreview = useMemo(
        () => getStopTransferInsertAfterStopId(transferInsertAfterStopId, transferTargetStops),
        [transferInsertAfterStopId, transferTargetStops],
    );
    const stopTransferPreview = useMemo(
        () => {
            if (!selectedScenario || !transferTargetScenarioId || !sourceSegmentSelectionReady || transferStopCount < 2) return null;
            return buildRoutePlanner2StopTransferPreview(project, {
                sourceScenarioId: selectedScenario.id,
                targetScenarioId: transferTargetScenarioId,
                fromSequence: transferFromSequence,
                toSequence: transferToSequence,
                insertAfterStopId: transferInsertAfterStopIdForPreview,
                mode: 'move',
                now: 'route-planner-transfer-preview',
            });
        },
        [
            project,
            selectedScenario,
            sourceSegmentSelectionReady,
            transferFromSequence,
            transferInsertAfterStopIdForPreview,
            transferStopCount,
            transferTargetScenarioId,
            transferToSequence,
        ],
    );
    const stopTransferOppositeSuggestion = useMemo(() => {
        if (!selectedScenario || !transferTargetScenarioId || !sourceSegmentSelectionReady || transferStopCount < 2) return null;
        return buildRoutePlanner2OppositeStopTransferSuggestion(project, {
            sourceScenarioId: selectedScenario.id,
            targetScenarioId: transferTargetScenarioId,
            fromSequence: transferFromSequence,
            toSequence: transferToSequence,
            insertAfterStopId: transferInsertAfterStopIdForPreview,
            mode: 'move',
            now: 'route-planner-transfer-preview-opposite',
        });
    }, [
        project,
        selectedScenario,
        sourceSegmentSelectionReady,
        transferFromSequence,
        transferInsertAfterStopIdForPreview,
        transferStopCount,
        transferTargetScenarioId,
        transferToSequence,
    ]);
    const stopTransferOppositePreview = useMemo(
        () => stopTransferOppositeSuggestion
            ? buildRoutePlanner2StopTransferPreview(project, stopTransferOppositeSuggestion.options)
            : null,
        [project, stopTransferOppositeSuggestion],
    );
    useEffect(() => {
        setTransferApplyOppositeDirection(Boolean(stopTransferOppositePreview));
    }, [
        selectedScenario?.id,
        stopTransferOppositePreview,
        transferFromSequence,
        transferInsertAfterStopIdForPreview,
        transferTargetScenarioId,
        transferToSequence,
    ]);
    const stopTransferPreviewStopIds = useMemo(
        () => {
            if (!sourceSegmentSelectionReady) {
                return selectedScenarioStops
                    .filter((stop) =>
                        (transferSourceStartSelected && stop.sequence === transferFromSequence)
                        || (transferSourceEndSelected && stop.sequence === transferToSequence),
                    )
                    .map((stop) => stop.id);
            }

            return selectedScenarioStops
                .filter((stop) =>
                    stop.sequence >= Math.min(transferFromSequence, transferToSequence)
                    && stop.sequence <= Math.max(transferFromSequence, transferToSequence),
                )
                .map((stop) => stop.id);
        },
        [
            selectedScenarioStops,
            sourceSegmentSelectionReady,
            transferFromSequence,
            transferSourceEndSelected,
            transferSourceStartSelected,
            transferToSequence,
        ],
    );
    const mapSelectedStopIds = useMemo(
        () => segmentSwitchModeActive
            ? [...new Set([...mapSelection.stopIds, ...stopTransferPreviewStopIds])]
            : mapSelection.stopIds,
        [mapSelection.stopIds, segmentSwitchModeActive, stopTransferPreviewStopIds],
    );
    const transferPreviewMarkers = useMemo<RoutePlanner2TransferPreviewMarker[]>(() => {
        if (!segmentSwitchModeActive || !transferTargetScenario || transferTargetStops.length === 0) return [];
        const insertAfterStopId = getStopTransferInsertAfterStopId(transferInsertAfterStopId, transferTargetStops);
        const insertAfterIndex = insertAfterStopId
            ? transferTargetStops.findIndex((stop) => stop.id === insertAfterStopId)
            : -1;
        const beforeStop = insertAfterIndex >= 0 ? transferTargetStops[insertAfterIndex] : null;
        const afterStop = transferTargetStops[insertAfterIndex + 1] ?? null;

        const markers: Array<RoutePlanner2TransferPreviewMarker | null> = [
            beforeStop
                ? {
                    id: `target-insert-after-${beforeStop.id}`,
                    lat: beforeStop.lat,
                    lng: beforeStop.lng,
                    label: 'Insert after',
                    tone: 'target' as const,
                }
                : null,
            !beforeStop && afterStop
                ? {
                    id: `target-insert-start-${afterStop.id}`,
                    lat: afterStop.lat,
                    lng: afterStop.lng,
                    label: 'Insert before',
                    tone: 'target' as const,
                }
                : null,
            beforeStop && afterStop
                ? {
                    id: `target-insert-before-${afterStop.id}`,
                    lat: afterStop.lat,
                    lng: afterStop.lng,
                    label: 'Before next',
                    tone: 'target' as const,
                }
                : null,
        ];

        return markers.filter((marker): marker is RoutePlanner2TransferPreviewMarker => Boolean(marker));
    }, [segmentSwitchModeActive, transferInsertAfterStopId, transferTargetScenario, transferTargetStops]);
    const metadataQuery = usePerformanceMetadataQuery(teamId ?? undefined);
    const hasPerformanceData = Boolean(metadataQuery.data);
    const dataQuery = usePerformanceDataQuery(teamId ?? undefined, hasPerformanceData, metadataQuery.data);
    const speedIndex = useMemo(
        () => buildCorridorSpeedIndex(dataQuery.data?.dailySummaries ?? []),
        [dataQuery.data],
    );
    useEffect(() => {
        setAddressQuery('');
        setAddressSuggestions([]);
        setSelectedAddress(null);
        setAddressSearchError(null);
        setMapSelection(EMPTY_MAP_SELECTION);
        setTransferSourceStartSelected(false);
        setTransferSourceEndSelected(false);
    }, [selectedScenario?.id]);
    useEffect(() => {
        if (!lastTransferUndoMessage) return undefined;
        const timeoutId = window.setTimeout(() => setLastTransferUndoMessage(null), 10000);
        return () => window.clearTimeout(timeoutId);
    }, [lastTransferUndoMessage]);
    useEffect(() => {
        const trimmedQuery = addressQuery.trim();
        if (trimmedQuery.length < 3) {
            setAddressSuggestions([]);
            setAddressSearchLoading(false);
            setAddressSearchError(null);
            return;
        }

        const controller = new AbortController();
        const timeoutId = window.setTimeout(() => {
            setAddressSearchLoading(true);
            setAddressSearchError(null);
            searchRoutePlanner2Addresses(trimmedQuery, { signal: controller.signal })
                .then((suggestions) => {
                    setAddressSuggestions(suggestions);
                    if (suggestions.length === 0) {
                        setAddressSearchError('No matching addresses found.');
                    }
                })
                .catch((error) => {
                    if (controller.signal.aborted) return;
                    console.error('Route Planner 2 address search failed', error);
                    setAddressSuggestions([]);
                    setAddressSearchError('Address search is unavailable.');
                })
                .finally(() => {
                    if (!controller.signal.aborted) setAddressSearchLoading(false);
                });
        }, 250);

        return () => {
            window.clearTimeout(timeoutId);
            controller.abort();
        };
    }, [addressQuery]);
    const refreshSavedProjects = useCallback(async () => {
        if (!teamId || !userId) {
            setSavedProjects([]);
            setSelectedSavedProjectId('');
            setSavedProjectsLoadFailed(false);
            return;
        }
        setIsLoadingSavedProjects(true);
        setSavedProjectsLoadFailed(false);
        try {
            const projects = await listRoutePlanner2SavedProjects(teamId);
            setSavedProjects(projects);
            setLoadState('idle');
            setSavedProjectsLoadFailed(false);
            setSelectedSavedProjectId((current) => {
                if (current && projects.some((savedProject) => savedProject.id === current)) return current;
                return projects[0]?.id ?? '';
            });
        } catch (error) {
            console.error('Failed to load Route Planner projects', error);
            setSavedProjects([]);
            setSelectedSavedProjectId('');
            setSavedProjectsLoadFailed(true);
        } finally {
            setIsLoadingSavedProjects(false);
        }
    }, [teamId, userId]);
    useEffect(() => {
        void refreshSavedProjects();
    }, [refreshSavedProjects]);
    useEffect(() => {
        if (!selectedScenario) {
            setSelectedStopId(null);
            return;
        }
        if (selectedStopId && selectedScenario.stops.some((stop) => stop.id === selectedStopId)) return;
        setSelectedStopId(selectedScenario.stops[0]?.id ?? null);
    }, [selectedScenario, selectedStopId]);
    useEffect(() => {
        if (!selectedScenario) return;
        setRuntimeDayType(selectedScenario.service.dayType ?? 'weekday');
        setRuntimePeriod(selectedScenario.service.planningPeriod === 'all-day'
            ? 'full-day'
            : selectedScenario.service.planningPeriod ?? 'full-day');
    }, [selectedScenario?.id, selectedScenario?.service.dayType, selectedScenario?.service.planningPeriod]);
    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            const hasShortcutModifier = event.ctrlKey || event.metaKey;
            if (!hasShortcutModifier || isEditableEventTarget(event.target)) return;

            const key = event.key.toLowerCase();
            if (key === 'z' && !event.shiftKey) {
                event.preventDefault();
                if (canUndoProject) undoProjectChange();
                return;
            }

            if (key === 'y' || (key === 'z' && event.shiftKey)) {
                event.preventDefault();
                if (canRedoProject) redoProjectChange();
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [canRedoProject, canUndoProject, redoProjectChange, undoProjectChange]);
    useEffect(() => {
        if (!selectedScenario?.id || runtimeMatchedRoutes.length === 0) return;
        setRuntimeAvailableRoutesByScenario((current) => {
            const nextRoutes = [...new Set([...(current[selectedScenario.id] ?? []), ...runtimeMatchedRoutes])]
                .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
            const currentRoutes = current[selectedScenario.id] ?? [];
            const unchanged = currentRoutes.length === nextRoutes.length
                && currentRoutes.every((route, index) => route === nextRoutes[index]);
            return unchanged ? current : { ...current, [selectedScenario.id]: nextRoutes };
        });
    }, [runtimeMatchedRoutes, selectedScenario?.id]);
    useEffect(() => {
        const selectedSequence = selectedStop?.sequence ?? selectedScenarioFirstStopSequence;
        setTransferFromSequence(selectedSequence);
        setTransferToSequence(selectedSequence);
    }, [selectedScenario?.id, selectedStop?.id, selectedStop?.sequence, selectedScenarioFirstStopSequence]);
    useEffect(() => {
        const validTarget = transferTargetOptions.some((scenario) => scenario.id === transferTargetScenarioId);
        if (!validTarget) {
            setTransferTargetScenarioId(transferTargetOptions[0]?.id ?? '');
            setTransferInsertAfterStopId('__end');
        }
    }, [transferTargetOptions, transferTargetScenarioId]);
    useEffect(() => {
        if (!selectedScenario || runtimeSourceMode === 'mapbox') return;
        const estimates = deriveRoutePlanner2EvidenceRuntimeEstimates(
            selectedScenario,
            speedIndex,
            runtimeDayType,
            runtimePeriod,
            {
                runtimeBasis: 'scheduled',
                onDiagnostic: logRoutePlanner2RuntimeDiagnostics,
            },
        );
        if (estimates.length === 0) return;
        const evidenceSegmentIds = estimates.map((estimate) => estimate.id);
        setProject((current) => updateRoutePlanner2SegmentRuntimeEstimates(current, selectedScenario.id, estimates, undefined, {
            replaceForSegmentIds: evidenceSegmentIds,
            replaceSources: ['scheduled-proxy', 'partial-scheduled-proxy', 'observed-scheduled-blend', 'observed-proxy'],
        }), { trackHistory: false });
    }, [
        runtimeDayType,
        runtimePeriod,
        selectedScenario?.id,
        selectedScenario?.stops,
        selectedScenario?.alignment,
        selectedScenario?.routeShape,
        selectedScenario?.turnaroundStopId,
        selectedScenario?.service.planningPeriod,
        runtimeSourceMode,
        selectedScenario?.runtimeRouteFilter,
        selectedScenario?.runtimeEstimates,
        speedIndex,
    ]);
    function getNextAuthoringCoordinate() {
        const pointCount = selectedScenario?.alignment.length ?? 0;
        const stopCount = selectedScenario?.stops.length ?? 0;
        const index = Math.max(pointCount, stopCount) + 1;
        return {
            lat: Number((44.379 + (index * 0.006)).toFixed(6)),
            lng: Number((-79.701 + (index * 0.007)).toFixed(6)),
        };
    }
    async function saveCurrentProject() {
        if (!teamId || !userId) {
            setSaveState('error');
            setSaveMessage('Sign in with a team workspace to save this route plan.');
            return;
        }
        setSaveState('saving');
        setSaveMessage(null);
        try {
            const savedProject = await saveRoutePlanner2Project(teamId, userId, project);
            setProject(savedProject, { trackHistory: false });
            setSelectedSavedProjectId(savedProject.id);
            setSaveState('saved');
            setSaveMessage('Saved to the team workspace.');
            await refreshSavedProjects();
        } catch (error) {
            console.error('Failed to save Route Planner project', error);
            setSaveState('error');
            setSaveMessage(getRoutePlanner2SaveErrorMessage(error));
        }
    }
    async function loadSavedProject(projectId: string) {
        if (!teamId || !projectId) return;
        setLoadState('loading');
        setSaveMessage(null);
        try {
            const loadedProject = await loadRoutePlanner2Project(teamId, projectId);
            if (!loadedProject) {
                setLoadState('error');
                setSaveMessage('That saved route plan was not found.');
                await refreshSavedProjects();
                return;
            }
            const loadedScenario = loadedProject.scenarios.find((scenario) => scenario.id === loadedProject.selectedScenarioId)
                ?? loadedProject.scenarios[0];
            resetProjectHistory(loadedProject);
            setSelectedStopId(loadedScenario?.stops[0]?.id ?? null);
            setSelectedSavedProjectId(loadedProject.id);
            setIsLoadPickerOpen(false);
            setLoadState('idle');
            setSaveState('saved');
            setSaveMessage('Loaded saved route plan.');
        } catch (error) {
            console.error('Failed to load Route Planner project', error);
            setLoadState('error');
            setSaveMessage('Load failed. Please try again.');
        }
    }
    function addStop(coordinate: { lat: number; lng: number; name?: string } = getNextAuthoringCoordinate()) {
        if (!selectedScenario) return;
        const stopNumber = selectedScenario.stops.length + 1;
        const stopId = `stop-${Date.now()}-${stopNumber}`;
        setProject((current) => addRoutePlanner2Stop(current, selectedScenario.id, {
            id: stopId,
            name: coordinate.name ?? `Stop ${stopNumber}`,
            ...coordinate,
        }));
        setSelectedStopId(stopId);
    }
    function addAddressStopAtSelectedPosition(coordinate: { lat: number; lng: number; name?: string }) {
        if (!selectedScenario) return;
        const stopNumber = selectedScenario.stops.length + 1;
        const stopId = `stop-${Date.now()}-${stopNumber}`;
        const insertAfterStopId = addressInsertAfterStopId === '__beginning' || addressInsertAfterStopId === '__end'
            ? undefined
            : addressInsertAfterStopId;
        setProject((current) => addRoutePlanner2Stop(current, selectedScenario.id, {
            id: stopId,
            name: coordinate.name ?? `Stop ${stopNumber}`,
            ...coordinate,
            ...(addressInsertAfterStopId === '__beginning' ? { insertAtBeginning: true } : {}),
            ...(insertAfterStopId ? { insertAfterStopId } : {}),
        }));
        setSelectedStopId(stopId);
        setAddressInsertAfterStopId('__end');
    }
    function selectAddressSuggestion(suggestion: RoutePlanner2AddressSuggestion) {
        setSelectedAddress(suggestion);
        setAddressQuery(suggestion.label);
        setAddressSuggestions((current) => {
            const exists = current.some((item) => item.id === suggestion.id);
            return exists ? current : [suggestion, ...current];
        });
        setAddressSearchError(null);
    }
    function addSelectedAddressStop() {
        const suggestion = selectedAddress ?? addressSuggestions[0];
        if (!suggestion) return;

        addAddressStopAtSelectedPosition({
            lat: suggestion.lat,
            lng: suggestion.lng,
            name: suggestion.name,
        });
        setAddressQuery('');
        setAddressSuggestions([]);
        setSelectedAddress(null);
        setAddressSearchError(null);
    }
    function updateService(patch: Partial<RoutePlanner2ServiceAssumptions>) {
        if (!selectedScenario) return;
        setProject((current) => updateRoutePlanner2Service(current, selectedScenario.id, patch));
    }
    function updateRuntimeDayType(next: DayType) {
        setRuntimeDayType(next);
        updateService({ dayType: next });
    }
    function updateRuntimePeriod(next: TimePeriod) {
        setRuntimePeriod(next);
        updateService({ planningPeriod: next === 'full-day' ? 'all-day' : next });
    }
    function updateRuntimeSourceMode(mode: RoutePlanner2RuntimeSourceMode) {
        if (!selectedScenario) return;
        setProject((current) => updateRoutePlanner2RuntimeSourceMode(current, selectedScenario.id, mode));
    }
    function updateRuntimeRouteFilterMode(mode: RoutePlanner2RuntimeRouteFilterMode) {
        if (!selectedScenario) return;
        const nextRoutes = mode === 'selected'
            ? (runtimeSelectedRoutes.length > 0 ? runtimeSelectedRoutes : runtimeRouteOptions)
            : [];
        setProject((current) => updateScenarioRuntimeRouteFilter(current, selectedScenario.id, mode, nextRoutes));
    }
    function toggleRuntimeSelectedRoute(route: string) {
        if (!selectedScenario) return;
        const currentRoutes = runtimeSelectedRoutes.length > 0 ? runtimeSelectedRoutes : runtimeRouteOptions;
        const nextRoutes = currentRoutes.includes(route)
            ? currentRoutes.filter((value) => value !== route)
            : [...currentRoutes, route];
        if (nextRoutes.length === 0) return;
        setProject((current) => updateScenarioRuntimeRouteFilter(current, selectedScenario.id, 'selected', nextRoutes));
    }
    function updateNumericServiceField(
        key: 'frequencyMinutes' | 'startTerminalLayoverMinutes' | 'endTerminalLayoverMinutes' | 'intermediateStopDwellSeconds',
        value: string,
    ) {
        updateService({ [key]: Number(value) } as Partial<RoutePlanner2ServiceAssumptions>);
    }
    function updateOptionalNumericServiceField(
        key: 'targetBuses',
        value: string,
    ) {
        updateService({ [key]: value.trim() === '' ? undefined : Number(value) } as Partial<RoutePlanner2ServiceAssumptions>);
    }
    function updateSelectedStopRole(role: RoutePlanner2StopRole) {
        if (!selectedScenario || !selectedStop) return;
        setProject((current) => updateRoutePlanner2StopRole(current, selectedScenario.id, selectedStop.id, role));
    }
    function renameSelectedStop(name: string) {
        if (!selectedScenario || !selectedStop) return;
        setProject((current) => renameRoutePlanner2Stop(current, selectedScenario.id, selectedStop.id, name));
    }
    function updateRouteShape(routeShape: RoutePlanner2RouteShape, turnaroundStopId?: string) {
        if (!selectedScenario) return;
        setProject((current) => updateRoutePlanner2RouteShape(current, selectedScenario.id, routeShape, { turnaroundStopId }));
    }
    function createBackDirection() {
        if (!selectedScenario || selectedScenarioStops.length < 2) return;
        const backStartStopId = selectedScenarioStops[selectedScenarioStops.length - 1]?.id ?? null;
        setProject((current) => createRoutePlanner2BackDirection(current, selectedScenario.id));
        setSelectedStopId(backStartStopId);
        setIsRightRailOpen(true);
    }
    function deleteSelectedRouteConcept() {
        if (!selectedScenario || project.scenarios.length <= 1) return;
        setProject((current) => deleteRoutePlanner2Scenario(current, selectedScenario.id));
        setSelectedStopId(null);
        setMapSelection(EMPTY_MAP_SELECTION);
    }
    function deleteStop(stopId: string) {
        if (!selectedScenario) return;
        const remainingStops = selectedScenario.stops.filter((stop) => stop.id !== stopId);
        setProject((current) => deleteRoutePlanner2Stop(current, selectedScenario.id, stopId));
        if (selectedStopId === stopId) {
            setSelectedStopId(remainingStops[0]?.id ?? null);
        }
        setMapSelection((current) => ({
            stopIds: current.stopIds.filter((id) => id !== stopId),
            waypointIds: current.waypointIds,
        }));
    }
    function clearStopOrder() {
        if (!selectedScenario) return;
        setProject((current) => clearRoutePlanner2Stops(current, selectedScenario.id));
        setSelectedStopId(null);
        setHoveredMapItem(null);
        setDraggedStopOrderKey(null);
        setMapSelection(EMPTY_MAP_SELECTION);
    }
    function moveStopOrderItem(item: RoutePlanner2StopOrderItem, direction: 'up' | 'down') {
        if (!selectedScenario) return;
        setProject((current) => item.type === 'stop'
            ? moveRoutePlanner2Stop(current, selectedScenario.id, item.stop.id, direction)
            : moveRoutePlanner2LineWaypointInOrder(current, selectedScenario.id, item.bend.id, direction));
    }
    function moveDraggedStopOrderItem(targetKey: string) {
        if (!selectedScenario || !draggedStopOrderKey || draggedStopOrderKey === targetKey) {
            setDraggedStopOrderKey(null);
            return;
        }

        const sourceIndex = stopOrderItems.findIndex((item) => item.key === draggedStopOrderKey);
        const targetIndex = stopOrderItems.findIndex((item) => item.key === targetKey);
        if (sourceIndex < 0 || targetIndex < 0) {
            setDraggedStopOrderKey(null);
            return;
        }

        const sourceItem = stopOrderItems[sourceIndex]!;
        const direction = sourceIndex < targetIndex ? 'down' : 'up';
        const steps = Math.abs(targetIndex - sourceIndex);
        setProject((current) => {
            let next = current;
            for (let step = 0; step < steps; step += 1) {
                next = sourceItem.type === 'stop'
                    ? moveRoutePlanner2Stop(next, selectedScenario.id, sourceItem.stop.id, direction)
                    : moveRoutePlanner2LineWaypointInOrder(next, selectedScenario.id, sourceItem.bend.id, direction);
            }
            return next;
        });
        setDraggedStopOrderKey(null);
    }
    function deleteSelectedStop() {
        if (!selectedStop) return;
        deleteStop(selectedStop.id);
    }
    function moveStop(stopId: string, coordinate: { lat: number; lng: number }) {
        if (!selectedScenario) return;
        setProject((current) => updateRoutePlanner2StopCoordinate(current, selectedScenario.id, stopId, coordinate));
        setSelectedStopId(stopId);
    }
    function addLineWaypoint(placement: {
        fromStopId: string;
        toStopId: string;
        insertAfterWaypointId?: string;
        insertBeforeWaypointId?: string;
        applyToOppositeDirection?: boolean;
        coordinate: { lat: number; lng: number };
    }) {
        if (!selectedScenario) return;
        setProject((current) => {
            let nextProject = addRoutePlanner2LineWaypoint(current, selectedScenario.id, {
                afterStopId: placement.fromStopId,
                beforeStopId: placement.toStopId,
                insertAfterWaypointId: placement.insertAfterWaypointId,
                insertBeforeWaypointId: placement.insertBeforeWaypointId,
                ...placement.coordinate,
            });

            if (placement.applyToOppositeDirection) {
                nextProject = addRoutePlanner2LineWaypoint(nextProject, selectedScenario.id, {
                    afterStopId: placement.toStopId,
                    beforeStopId: placement.fromStopId,
                    ...placement.coordinate,
                });
            }

            return nextProject;
        });
    }
    function insertStopOnLine(placement: {
        fromStopId: string;
        toStopId: string;
        insertAfterWaypointId?: string;
        insertBeforeWaypointId?: string;
        coordinate: { lat: number; lng: number };
    }) {
        if (!selectedScenario) return;
        const stopNumber = selectedScenario.stops.length + 1;
        const stopId = `stop-${Date.now()}-${stopNumber}`;
        setProject((current) => insertRoutePlanner2StopBetween(current, selectedScenario.id, {
            id: stopId,
            name: `Stop ${stopNumber}`,
            afterStopId: placement.fromStopId,
            beforeStopId: placement.toStopId,
            insertAfterWaypointId: placement.insertAfterWaypointId,
            insertBeforeWaypointId: placement.insertBeforeWaypointId,
            ...placement.coordinate,
        }));
        setSelectedStopId(stopId);
    }
    function moveLineWaypoint(waypointId: string, coordinate: { lat: number; lng: number }) {
        if (!selectedScenario) return;
        setProject((current) => updateRoutePlanner2LineWaypointCoordinate(current, selectedScenario.id, waypointId, coordinate));
    }
    function startSegmentSwitchMode() {
        setIsGtfsImportOpen(false);
        setIsAddressImportOpen(false);
        setIsDrawFocusMode(false);
        setPendingStopTransferReview(null);
        setMapSelection(EMPTY_MAP_SELECTION);
        setMapSelectionMode(null);
        setHoveredMapItem(null);
        if (!transferTargetScenarioId && transferTargetOptions[0]) {
            setTransferTargetScenarioId(transferTargetOptions[0].id);
            setTransferInsertAfterStopId('__end');
        }
        if (selectedScenarioStops[0]) {
            setTransferFromSequence(selectedScenarioStops[0].sequence);
            setTransferToSequence(selectedScenarioStops[0].sequence);
        }
        setTransferSourceStartSelected(false);
        setTransferSourceEndSelected(false);
        setSegmentSwitchStep('select-source-start');
    }
    function cancelSegmentSwitchMode() {
        setSegmentSwitchStep('idle');
        setPendingStopTransferReview(null);
        setMapSelection(EMPTY_MAP_SELECTION);
        setHoveredMapItem(null);
        setTransferSourceStartSelected(false);
        setTransferSourceEndSelected(false);
    }
    function selectSegmentSwitchStop(stopId: string) {
        const stop = selectedScenarioStops.find((candidate) => candidate.id === stopId);
        if (!stop) return;
        setSelectedStopId(stopId);
        const nextSelection = getNextRoutePlanner2SegmentSwitchSourceSelection(
            {
                step: segmentSwitchStep,
                fromSequence: transferFromSequence,
                toSequence: transferToSequence,
                startSelected: transferSourceStartSelected,
                endSelected: transferSourceEndSelected,
            },
            stop.sequence,
            Boolean(transferTargetScenarioId),
        );

        setTransferFromSequence(nextSelection.fromSequence);
        setTransferToSequence(nextSelection.toSequence);
        setTransferSourceStartSelected(nextSelection.startSelected);
        setTransferSourceEndSelected(nextSelection.endSelected);
        setSegmentSwitchStep(nextSelection.step);
    }
    function selectRoutePlannerStop(stopId: string) {
        if (segmentSwitchStep !== 'idle' && !pendingStopTransferReview) {
            selectSegmentSwitchStop(stopId);
            return;
        }
        setSelectedStopId(stopId);
    }
    function buildStopTransferOptions(mode: 'copy' | 'move', now = new Date().toISOString()): RoutePlanner2StopTransferPreviewOptions | null {
        if (!selectedScenario || !transferTargetScenarioId || !sourceSegmentSelectionReady) return null;
        const targetStops = transferTargetStops;
        const transferredStopCount = selectedScenarioStops.filter((stop) =>
            stop.sequence >= Math.min(transferFromSequence, transferToSequence)
            && stop.sequence <= Math.max(transferFromSequence, transferToSequence),
        ).length;
        if (transferredStopCount < 2) return null;
        const insertAfterStopId = getStopTransferInsertAfterStopId(transferInsertAfterStopId, targetStops);

        return {
            sourceScenarioId: selectedScenario.id,
            targetScenarioId: transferTargetScenarioId,
            fromSequence: transferFromSequence,
            toSequence: transferToSequence,
            insertAfterStopId,
            mode,
            now,
        };
    }

    function openStopTransferReview(mode: 'copy' | 'move') {
        const options = buildStopTransferOptions(mode);
        if (!options) return;
        const preview = buildRoutePlanner2StopTransferPreview(project, options);
        if (!preview) return;
        const oppositeSuggestion = buildRoutePlanner2OppositeStopTransferSuggestion(project, options);
        const oppositePreview = oppositeSuggestion
            ? buildRoutePlanner2StopTransferPreview(project, oppositeSuggestion.options)
            : null;
        setSegmentSwitchStep('review');
        setPendingStopTransferReview({
            mode,
            preview,
            options,
            oppositeSuggestion,
            oppositePreview,
            applyOpposite: transferApplyOppositeDirection && Boolean(oppositeSuggestion && oppositePreview),
        });
    }

    function confirmStopTransfer() {
        if (!pendingStopTransferReview) return;

        let updated = reassignRoutePlanner2StopRange(project, pendingStopTransferReview.options);
        const shouldApplyOpposite = pendingStopTransferReview.applyOpposite
            && pendingStopTransferReview.oppositeSuggestion
            && pendingStopTransferReview.oppositePreview;
        if (shouldApplyOpposite && pendingStopTransferReview.oppositeSuggestion) {
            updated = reassignRoutePlanner2StopRange(updated, pendingStopTransferReview.oppositeSuggestion.options);
        }
        const nextProject = selectRoutePlanner2Scenario(updated, pendingStopTransferReview.options.targetScenarioId);
        setProject(nextProject);
        const primaryImpactMessage = buildSegmentTransferImpactMessage(
            pendingStopTransferReview.preview,
            pendingStopTransferReview.mode,
        );
        const oppositeImpactMessage = shouldApplyOpposite
            ? buildSegmentTransferImpactMessage(pendingStopTransferReview.oppositePreview, pendingStopTransferReview.mode)
            : null;
        const combinedImpactMessage = [primaryImpactMessage, oppositeImpactMessage ? `Opposite direction: ${oppositeImpactMessage}` : null]
            .filter(Boolean)
            .join(' ');
        setSegmentTransferImpactMessage(combinedImpactMessage || null);
        setLastTransferUndoMessage(shouldApplyOpposite
            ? 'Segment switch applied in both directions.'
            : 'Segment switch applied.');
        setPendingStopTransferReview(null);
        setSegmentSwitchStep('idle');
        setTransferSourceStartSelected(false);
        setTransferSourceEndSelected(false);
        setSelectedStopId(null);
        setIsRightRailOpen(true);
    }

    function cancelStopTransferReview() {
        setPendingStopTransferReview(null);
        setSegmentSwitchStep('select-insertion');
    }

    function updatePendingStopTransferApplyOpposite(applyOpposite: boolean) {
        setPendingStopTransferReview((current) => current ? { ...current, applyOpposite } : current);
    }

    function undoLastStopTransfer() {
        undoProjectChange();
        setLastTransferUndoMessage(null);
        setSegmentTransferImpactMessage(null);
    }

    function deleteLineWaypoint(waypointId: string) {
        if (!selectedScenario) return;
        setProject((current) => deleteRoutePlanner2LineWaypoint(current, selectedScenario.id, waypointId));
        setMapSelection((current) => ({
            stopIds: current.stopIds,
            waypointIds: current.waypointIds.filter((id) => id !== waypointId),
        }));
    }
    function activateMapSelectionMode(mode: RoutePlanner2MapSelectionMode) {
        setIsActionSidebarOpen(true);
        setIsSelectionMenuOpen(true);
        setMapSelectionMode(mode);
    }
    function deleteSelectedMapItems() {
        if (!selectedScenario || mapSelectionCount === 0) return;
        const stopIds = new Set(mapSelection.stopIds);
        const waypointIds = new Set(mapSelection.waypointIds);
        setProject((current) => {
            let next = current;
            waypointIds.forEach((waypointId) => {
                next = deleteRoutePlanner2LineWaypoint(next, selectedScenario.id, waypointId);
            });
            stopIds.forEach((stopId) => {
                next = deleteRoutePlanner2Stop(next, selectedScenario.id, stopId);
            });
            return next;
        });
        setSelectedStopId((current) => current && stopIds.has(current) ? null : current);
        setHoveredMapItem(null);
        setDraggedStopOrderKey(null);
        setMapSelection(EMPTY_MAP_SELECTION);
    }
    function updateSegmentRuntimeOverride(segmentId: string, value: string) {
        if (!selectedScenario) return;
        const trimmedValue = value.trim();
        if (!trimmedValue) {
            setProject((current) => clearRoutePlanner2SegmentRuntimeOverride(current, selectedScenario.id, segmentId));
            return;
        }
        const runtimeMinutes = Number(trimmedValue);
        setProject((current) => setRoutePlanner2SegmentRuntimeOverride(current, selectedScenario.id, segmentId, runtimeMinutes));
    }
    function updateStopOrderRunningTimeOverride(detail: RoutePlanner2StopVisitRuntimeDetail, value: string) {
        if (!selectedScenario || !detail.segmentId) return;
        const trimmedValue = value.trim();
        if (!trimmedValue) {
            setProject((current) => clearRoutePlanner2SegmentRuntimeOverride(current, selectedScenario.id, detail.segmentId!));
            return;
        }

        const runningRuntimeMinutes = Number(trimmedValue);
        const previousRunningRuntimeMinutes = detail.previousRunningRuntimeMinutes ?? 0;
        const segmentRuntimeMinutes = runningRuntimeMinutes - previousRunningRuntimeMinutes;
        setProject((current) => setRoutePlanner2SegmentRuntimeOverride(current, selectedScenario.id, detail.segmentId!, segmentRuntimeMinutes));
    }
    function clearSegmentRuntimeOverride(segmentId: string) {
        if (!selectedScenario) return;
        setProject((current) => clearRoutePlanner2SegmentRuntimeOverride(current, selectedScenario.id, segmentId));
    }
    const selectedScenarioId = selectedScenario?.id;
    const updateSegmentRuntimeEstimates = useCallback((estimates: RoutePlanner2SegmentRuntime[]) => {
        if (!selectedScenarioId || estimates.length === 0) return;
        setProject((current) => updateRoutePlanner2SegmentRuntimeEstimates(current, selectedScenarioId, estimates), { trackHistory: false });
    }, [selectedScenarioId, setProject]);
    async function loadGtfsPatterns(options: { forceRefresh?: boolean } = {}) {
        setGtfsLoading(true);
        setGtfsError(null);
        try {
            const patterns = await loadRoutePlanner2GtfsImportPatterns({ forceRefresh: options.forceRefresh });
            setGtfsPatterns(patterns);
        } catch (error) {
            setGtfsError(error instanceof Error ? error.message : 'GTFS routes could not be loaded.');
        } finally {
            setGtfsLoading(false);
        }
    }
    function openGtfsImport() {
        setIsAddressImportOpen(false);
        setIsGtfsImportOpen(true);
        if (gtfsPatterns.length === 0 && !gtfsLoading) void loadGtfsPatterns();
    }
    function openLoadPicker() {
        setIsLoadPickerOpen(true);
        if (savedProjectsLoadFailed && !isLoadingSavedProjects) void refreshSavedProjects();
    }
    function importGtfsPatterns(patterns: RoutePlanner2GtfsImportPattern[]) {
        if (patterns.length === 0) return;
        const scenarios = patterns.map((pattern) => createRoutePlanner2ScenarioFromGtfsPattern(pattern));
        const selectedImport = scenarios[0];
        setProject((current) => {
            const nextProject = scenarios.reduce(
                (projectWithImports, scenario) => importRoutePlanner2Scenario(projectWithImports, scenario),
                current,
            );
            return selectedImport ? selectRoutePlanner2Scenario(nextProject, selectedImport.id) : nextProject;
        });
        setSelectedStopId(selectedImport?.stops[0]?.id ?? null);
        setIsActionSidebarOpen(true);
        setIsRightRailOpen(true);
        setIsDrawFocusMode(false);
        setIsGtfsImportOpen(false);
    }
      function importAddressStops(stops: RoutePlanner2GeocodedAddressStop[]) {
          if (!selectedScenario || stops.length === 0) return;
          if (
              selectedScenario.stops.length > 0
              && typeof window !== 'undefined'
              && !window.confirm('Replace the current route stops with this optimized address import?')
          ) {
              return;
          }
          const batchId = Date.now();
          const importedStops = stops.map((stop, index) => ({
              id: `stop-address-${batchId}-${index + 1}`,
            name: stop.name,
            address: stop.address,
              riderCount: stop.occurrenceCount,
              sourceRows: stop.sourceRows,
              lat: stop.lat,
              lng: stop.lng,
              role: stop.role,
              notes: stop.notes,
          }));
        setProject((current) => {
            const baseProject = selectedScenario.stops.length > 0
                ? clearRoutePlanner2Stops(current, selectedScenario.id)
                : current;
            return addRoutePlanner2Stops(baseProject, selectedScenario.id, { stops: importedStops });
        });
        setSelectedStopId(importedStops[0]?.id ?? null);
        setIsRightRailOpen(true);
        setIsDrawFocusMode(false);
        setIsAddressImportOpen(false);
    }
    function enterDrawFocusMode() {
        setIsDrawFocusMode(true);
        setIsRightRailOpen(false);
    }
    function exitDrawFocusMode() {
        setIsDrawFocusMode(false);
        setIsRightRailOpen(true);
    }
    function toggleRightRail() {
        setIsDrawFocusMode(false);
        setIsRightRailOpen((current) => !current);
    }
    function openRuntimeSourceDetails() {
        setIsDrawFocusMode(false);
        setIsRightRailOpen(true);
        const scrollToRuntimeDetails = () => {
            window.setTimeout(() => runtimeSourceDetailsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0);
        };
        if (typeof window.requestAnimationFrame === 'function') {
            window.requestAnimationFrame(scrollToRuntimeDetails);
        } else {
            window.setTimeout(scrollToRuntimeDetails, 0);
        }
    }
    async function exportOperatorDirections() {
        if (!selectedScenario || selectedScenario.stops.length < 2 || isExportingOperatorPdf) return;
        setIsExportingOperatorPdf(true);
        try {
            await exportRoutePlanner2OperatorDirectionsPdf(selectedScenario, {
                projectName: project.name,
                feasibility: selectedFeasibility,
            });
        } finally {
            setIsExportingOperatorPdf(false);
        }
    }
    async function exportMapPdf() {
        if (!selectedScenario || selectedScenario.stops.length < 2 || isExportingMapPdf) return;
        setIsExportingMapPdf(true);
        setSaveMessage(null);
        try {
            const mapImage = await mapCanvasRef.current?.captureMapImage({
                padding: 96,
                showStopLabels: false,
            });
            if (!mapImage) {
                throw new Error('The map is still loading. Please try the export again in a moment.');
            }
            const mapBookSections = buildRoutePlanner2MapBookSections(selectedScenario);
            const mapPages: RoutePlanner2MapBookPage[] = [];
            if (mapBookSections.length > 1) {
                for (const section of mapBookSections) {
                    const sectionMapImage = await mapCanvasRef.current?.captureMapImage({
                        fitCoordinates: section.coordinates,
                        padding: 48,
                    });
                    if (!sectionMapImage) {
                        throw new Error('The map section could not be captured. Please try the export again in a moment.');
                    }
                    mapPages.push({
                        title: section.title,
                        subtitle: section.subtitle,
                        mapImage: sectionMapImage,
                    });
                }
            }
            await exportRoutePlanner2MapPdf(selectedScenario, {
                projectName: project.name,
                routeLabel: selectedScenario.name,
                mapImage,
                mapPages,
                summaryItems: [
                    { label: 'Stops', value: String(selectedScenario.stops.length) },
                    { label: 'Runtime', value: formatRuntime(selectedFeasibility?.oneWayRuntimeMinutes) },
                    { label: 'Cycle', value: formatRuntime(selectedFeasibility?.cycleTimeMinutes) },
                    { label: 'Buses', value: formatBuses(selectedFeasibility?.busesRequired) },
                    { label: 'Shape', value: routeShapeLabel },
                ],
            });
        } catch (error) {
            console.error('Failed to export Route Planner 2 map PDF', error);
            setSaveState('error');
            setSaveMessage(error instanceof Error ? error.message : 'Map PDF export failed. Please try again.');
        } finally {
            setIsExportingMapPdf(false);
        }
    }
    const runtimeBandDisclosure = getRuntimeBandDisclosure(selectedFeasibility, runtimeDayType, runtimePeriod);
    const selectedDirectionLabel = selectedScenario?.routeFamily?.memberShortName ?? 'Route';
    const mapMetricItems = selectedRouteFamilySummary
        ? [
            {
                label: `${selectedDirectionLabel} runtime`,
                value: formatRuntime(selectedFeasibility?.oneWayRuntimeMinutes),
                detail: `Family runtime: ${selectedRouteFamilySummary.runtimeLabel}`,
                description: runtimeSourceMode === 'gtfs'
                    ? `Runtime source and time band in use: ${runtimeBandDisclosure}. Click to review segment-level source details.`
                    : 'Runtime source: Mapbox only. Click to review segment-level source details.',
                onClick: openRuntimeSourceDetails,
            },
            { label: 'Family cycle', value: selectedRouteFamilySummary.cycleTimeLabel },
            { label: 'Family recovery', value: selectedRouteFamilySummary.recoveryLabel },
            { label: 'Family buses', value: selectedRouteFamilySummary.busesRequiredLabel },
            {
                label: 'Confidence',
                value: selectedRouteFamilySummary.confidence,
                description: confidenceDescription(selectedRouteFamilySummary.confidence),
            },
        ]
        : [
            {
                label: 'Runtime',
                value: formatRuntime(selectedFeasibility?.oneWayRuntimeMinutes),
                detail: `Data source: ${getRuntimeSourceDetail(selectedFeasibility, runtimeDayType, runtimePeriod)}`,
                description: runtimeSourceMode === 'gtfs'
                    ? `Runtime source and time band in use: ${runtimeBandDisclosure}. Click to review segment-level source details.`
                    : 'Runtime source: Mapbox only. Click to review segment-level source details.',
                onClick: openRuntimeSourceDetails,
            },
            { label: 'Cycle', value: formatRuntime(selectedFeasibility?.cycleTimeMinutes) },
            { label: 'Recovery', value: formatRecovery(selectedFeasibility?.recoveryTimeMinutes, selectedFeasibility?.recoveryPercent) },
            { label: 'Buses', value: formatBuses(selectedFeasibility?.busesRequired) },
            {
                label: 'Confidence',
                value: selectedFeasibility?.confidence ?? 'not-ready',
                description: confidenceDescription(selectedFeasibility?.confidence),
            },
        ];
    const runtimeSourceSummaryItems = getRuntimeSourceSummaryItems(
        selectedFeasibility?.segmentSummaries ?? [],
        runtimeDayType,
        runtimePeriod,
    );
    const showRightRail = !isDrawFocusMode && !segmentSwitchModeActive;
    const visibleRightRailOpen = isRightRailOpen && showRightRail;
    const rightRailState = visibleRightRailOpen ? 'open' : 'closed';
    const focusMode = isDrawFocusMode ? 'draw' : 'standard';
    const showActionSidebar = !isDrawFocusMode;
    const actionSidebarExpanded = showActionSidebar && isActionSidebarOpen;
    const importDrawerOpen = isGtfsImportOpen || isAddressImportOpen;
    const mapOverlayInsets = {
        left: showActionSidebar ? actionSidebarExpanded ? '20rem' : '6rem' : '2rem',
        right: importDrawerOpen || segmentSwitchModeActive ? '31.5rem' : showRightRail ? visibleRightRailOpen ? '26.5rem' : '6rem' : '8rem',
        top: isDrawFocusMode ? '1.5rem' : '6rem',
    };
    const canUseTeamSave = Boolean(teamId && userId);
    const saveStatusLabel = project.status === 'local-saved' ? 'Saved to team' : 'Local draft';
    const visibleSaveMessage = project.status === 'local-draft' && saveState === 'saved' ? null : saveMessage;
    const canShowRuntimeSourceOverlay = Boolean(selectedScenario && selectedScenario.stops.length >= 2);
    const canShowRoadNameLabels = Boolean(selectedScenario && selectedScenario.stops.length >= 2);
    const mapSelectionCount = mapSelection.stopIds.length + mapSelection.waypointIds.length;
    const drawingGuide = getDrawingGuide(selectedScenario);
    const stopVisitSequence = selectedScenario ? buildRoutePlanner2StopVisitSequence(selectedScenario) : [];
    const routeShapeLabel = selectedScenario?.routeShape === 'closed-loop'
        ? 'Closed loop'
        : selectedScenario?.routeShape === 'out-and-back'
            ? 'Out and back'
            : 'One-way';
    const canApplyStopTransfer = Boolean(selectedScenario && transferTargetScenarioId && sourceSegmentSelectionReady && transferStopCount >= 2);
    const transferFromStop = selectedScenarioStops.find((stop) => stop.sequence === transferFromSequence) ?? null;
    const transferToStop = selectedScenarioStops.find((stop) => stop.sequence === transferToSequence) ?? null;
    const segmentSwitchStepLabel: Record<SegmentSwitchStep, string> = {
        idle: 'Not active',
        'select-source-start': '1 · Pick start',
        'select-source-end': '2 · Pick end',
        'select-target': '3 · Target route',
        'select-insertion': '4 · Insert point',
        review: '5 · Review',
    };
    const pendingStopTransferWarnings = pendingStopTransferReview
        ? [...pendingStopTransferReview.preview.scheduleImpact.warnings, ...pendingStopTransferReview.preview.warnings]
        : [];
    const reassignStopsPanel = (
        <section className="rounded-2xl border border-cyan-200 bg-cyan-50/60 p-3" data-testid="rp2-reassign-stops-panel">
            <div className="flex items-start justify-between gap-3">
                <div>
                    <div className="flex items-center gap-2">
                        <ArrowRightLeft size={16} className="text-cyan-700" />
                        <h3 className="text-sm font-black text-slate-900">Map segment switch</h3>
                    </div>
                    <p className="mt-1 text-xs leading-5 text-slate-600">
                        Click the start and end stops on the map, then move or copy that route segment.
                    </p>
                </div>
                <span className="shrink-0 rounded-full bg-white px-2 py-1 text-[10px] font-black uppercase text-cyan-700">{segmentSwitchStepLabel[segmentSwitchStep]}</span>
            </div>
            {transferTargetOptions.length === 0 ? (
                <p className="mt-3 rounded-xl border border-cyan-100 bg-white px-3 py-2 text-sm leading-6 text-slate-600">
                    Create or import another route concept before reassigning stops.
                </p>
            ) : selectedScenarioStops.length === 0 ? (
                <p className="mt-3 rounded-xl border border-cyan-100 bg-white px-3 py-2 text-sm leading-6 text-slate-600">
                    Add stops to this route before reassigning them.
                </p>
            ) : (
                <div className="mt-3 space-y-3">
                    <div className="rounded-xl border border-cyan-100 bg-white px-3 py-2 text-xs leading-5 text-slate-600">
                        Source route: <span className="font-bold text-slate-900">{selectedScenario?.name}</span>
                    </div>
                    <div className="rounded-xl border border-cyan-100 bg-white p-3 text-xs leading-5 text-slate-600" data-testid="rp2-segment-switch-mode-status">
                        <div className="font-black text-slate-900">
                            {!transferSourceStartSelected
                                ? 'Click the first stop in the segment.'
                                : !transferSourceEndSelected
                                    ? 'Click the last stop in the segment.'
                                    : 'Source segment selected.'}
                        </div>
                        <div className="mt-2 grid gap-2 sm:grid-cols-2">
                            <button
                                type="button"
                                onClick={() => setSegmentSwitchStep('select-source-start')}
                                className={`rounded-xl border px-3 py-2 text-left ${segmentSwitchStep === 'select-source-start' ? 'border-cyan-300 bg-cyan-50 text-cyan-900' : 'border-slate-200 bg-white text-slate-700'}`}
                            >
                                <span className="block text-[10px] font-black uppercase tracking-wide">Start stop</span>
                                <span className="block font-black">{transferSourceStartSelected && transferFromStop ? `${transferFromStop.sequence}. ${transferFromStop.name}` : 'Pick on map'}</span>
                            </button>
                            <button
                                type="button"
                                onClick={() => setSegmentSwitchStep('select-source-end')}
                                className={`rounded-xl border px-3 py-2 text-left ${segmentSwitchStep === 'select-source-end' ? 'border-cyan-300 bg-cyan-50 text-cyan-900' : 'border-slate-200 bg-white text-slate-700'}`}
                            >
                                <span className="block text-[10px] font-black uppercase tracking-wide">End stop</span>
                                <span className="block font-black">{transferSourceEndSelected && transferToStop ? `${transferToStop.sequence}. ${transferToStop.name}` : 'Pick on map'}</span>
                            </button>
                        </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                        <label className="text-xs font-bold uppercase tracking-wide text-slate-500" htmlFor="rp2-transfer-from">
                            Start fallback
                            <select id="rp2-transfer-from" value={transferFromSequence} onChange={(event) => { setTransferFromSequence(Number(event.target.value)); setTransferSourceStartSelected(true); setSegmentSwitchStep('select-source-end'); }} className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-800">
                                {selectedScenarioStops.map((stop) => <option key={stop.id} value={stop.sequence}>{stop.sequence}. {stop.name}</option>)}
                            </select>
                        </label>
                        <label className="text-xs font-bold uppercase tracking-wide text-slate-500" htmlFor="rp2-transfer-to">
                            End fallback
                            <select id="rp2-transfer-to" value={transferToSequence} onChange={(event) => { setTransferToSequence(Number(event.target.value)); setTransferSourceStartSelected(true); setTransferSourceEndSelected(true); setSegmentSwitchStep(transferTargetScenarioId ? 'select-insertion' : 'select-target'); }} className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-800">
                                {selectedScenarioStops.map((stop) => <option key={stop.id} value={stop.sequence}>{stop.sequence}. {stop.name}</option>)}
                            </select>
                        </label>
                    </div>
                    <label className="block text-xs font-bold uppercase tracking-wide text-slate-500" htmlFor="rp2-transfer-target">
                        Target route
                        <select id="rp2-transfer-target" value={transferTargetScenarioId} onChange={(event) => { setTransferTargetScenarioId(event.target.value); setTransferInsertAfterStopId('__end'); setSegmentSwitchStep('select-insertion'); }} className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-800">
                            {transferTargetOptions.map((scenario) => <option key={scenario.id} value={scenario.id}>{scenario.name}</option>)}
                        </select>
                    </label>
                    <label className="block text-xs font-bold uppercase tracking-wide text-slate-500" htmlFor="rp2-transfer-insert">
                        Insert position
                        <select id="rp2-transfer-insert" value={transferInsertAfterStopId} onChange={(event) => { setTransferInsertAfterStopId(event.target.value); setSegmentSwitchStep('select-insertion'); }} className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-800">
                            <option value="__start">At beginning</option>
                            {transferTargetStops.map((stop) => <option key={stop.id} value={stop.id}>After {stop.sequence}. {stop.name}</option>)}
                            <option value="__end">At end</option>
                        </select>
                    </label>
                    <button
                        type="button"
                        disabled={!stopTransferOppositePreview}
                        aria-pressed={Boolean(stopTransferOppositePreview && transferApplyOppositeDirection)}
                        onClick={() => {
                            if (!stopTransferOppositePreview) return;
                            setTransferApplyOppositeDirection((current) => !current);
                        }}
                        className={`w-full rounded-xl border px-3 py-2 text-left text-sm transition disabled:cursor-not-allowed ${
                            stopTransferOppositePreview
                                ? transferApplyOppositeDirection
                                    ? 'border-violet-200 bg-violet-50 text-violet-950 hover:bg-violet-100'
                                    : 'border-slate-200 bg-white text-slate-700 hover:border-violet-200 hover:bg-violet-50'
                                : 'border-slate-200 bg-slate-50 text-slate-500 opacity-80'
                        }`}
                    >
                        <span className="block font-black text-slate-900">
                            {stopTransferOppositePreview
                                ? transferApplyOppositeDirection
                                    ? 'Paired direction will also update'
                                    : 'Apply same switch to paired direction'
                                : 'No paired direction match found'}
                        </span>
                        <span className="mt-0.5 block text-xs font-semibold leading-5">
                            {stopTransferOppositeSuggestion && stopTransferOppositePreview
                                ? `${stopTransferOppositeSuggestion.sourceScenarioName} → ${stopTransferOppositeSuggestion.targetScenarioName}, ${stopTransferOppositePreview.transferredStopCount} ${stopTransferOppositePreview.transferredStopCount === 1 ? 'stop' : 'stops'} matched.`
                                : 'A paired route such as 2B needs matching stops before this switch can be applied in both directions.'}
                        </span>
                    </button>
                    <div className="rounded-xl border border-cyan-100 bg-white px-3 py-2 text-xs leading-5 text-slate-600">
                        Selected range: <span className="font-black text-slate-900">{displayedTransferStopCount}</span> {displayedTransferStopCount === 1 ? 'stop' : 'stops'}
                        {(!sourceSegmentSelectionReady || transferStopCount < 2) && (
                            <span className="font-semibold text-amber-700"> · pick at least two stops to switch a segment</span>
                        )}
                        {stopTransferOppositePreview && transferApplyOppositeDirection && (
                            <span className="font-semibold text-violet-700"> · paired direction included</span>
                        )}
                    </div>
                    {stopTransferPreview && (
                        <div data-testid="rp2-stop-transfer-preview" className="rounded-xl border border-cyan-100 bg-white p-3 text-xs leading-5 text-slate-600">
                            <div className="flex items-start justify-between gap-3">
                                <div>
                                    <h4 className="text-sm font-black text-slate-900">Transfer preview</h4>
                                    <p className="mt-1">
                                        Move {formatTransferCount(stopTransferPreview.transferredStopCount, 'stop')} into <span className="font-bold text-slate-900">{stopTransferPreview.targetScenarioName}</span>.
                                    </p>
                                </div>
                                <span className="shrink-0 rounded-full bg-cyan-50 px-2 py-1 text-[10px] font-black uppercase text-cyan-700">Before apply</span>
                            </div>
                            <div className="mt-3 grid gap-2 sm:grid-cols-2">
                                <div className="rounded-lg bg-slate-50 px-2.5 py-2">
                                    <div className="font-black uppercase tracking-wide text-slate-500">Target moved runtime</div>
                                    <div className="mt-0.5 font-bold text-slate-900">
                                        {formatMovedRuntimeTransition(stopTransferPreview.targetRuntimeBeforeMinutes, stopTransferPreview.targetAccountingRuntimeAfterMinutes)}
                                    </div>
                                </div>
                                <div className="rounded-lg bg-slate-50 px-2.5 py-2">
                                    <div className="font-black uppercase tracking-wide text-slate-500">Source moved runtime</div>
                                    <div className="mt-0.5 font-bold text-slate-900">
                                        {formatMovedRuntimeTransition(stopTransferPreview.sourceRuntimeBeforeMinutes, stopTransferPreview.sourceAccountingRuntimeAfterMinutes)}
                                    </div>
                                </div>
                            </div>
                            <div className="mt-3 grid gap-3 lg:grid-cols-2" data-testid="rp2-stop-transfer-impact-cards">
                                <SegmentSwitchImpactCard impact={stopTransferPreview.scheduleImpact.source} />
                                <SegmentSwitchImpactCard impact={stopTransferPreview.scheduleImpact.target} />
                            </div>
                            {(runtimeDeltaDiffers(stopTransferPreview.targetRuntimeDeltaMinutes, stopTransferPreview.targetAccountingRuntimeDeltaMinutes)
                                || runtimeDeltaDiffers(stopTransferPreview.sourceRuntimeDeltaMinutes, stopTransferPreview.sourceAccountingRuntimeDeltaMinutes)) && (
                                <p className="mt-2 rounded-lg bg-slate-50 px-2.5 py-2 text-slate-700">
                                    <span className="font-black">Full route recalculation:</span> source {formatRuntimeTransition(stopTransferPreview.sourceRuntimeBeforeMinutes, stopTransferPreview.sourceRuntimeAfterMinutes)}; target {formatRuntimeTransition(stopTransferPreview.targetRuntimeBeforeMinutes, stopTransferPreview.targetRuntimeAfterMinutes)}. Connector geometry may differ, but the moved runtime is counted equally.
                                </p>
                            )}
                            {stopTransferOppositeSuggestion && stopTransferOppositePreview && (
                                <div data-testid="rp2-opposite-transfer-suggestion" className="mt-2 rounded-lg border border-violet-200 bg-violet-50 px-2.5 py-2 text-violet-900">
                                    <span className="font-black">Paired direction:</span> {transferApplyOppositeDirection ? 'included' : 'not included'} — {stopTransferOppositeSuggestion.sourceScenarioName} → {stopTransferOppositeSuggestion.targetScenarioName}.
                                </div>
                            )}
                            {stopTransferPreview.sourceFamilyBefore
                                && stopTransferPreview.sourceFamilyAfter
                                && stopTransferPreview.sourceFamilyBefore.key !== stopTransferPreview.targetFamilyBefore?.key
                                && (
                                    <p className="mt-2 rounded-lg bg-slate-50 px-2.5 py-2 text-slate-700">
                                        <span className="font-black">Recalculated source family:</span> runtime {stopTransferPreview.sourceFamilyBefore.runtimeLabel} -&gt; {stopTransferPreview.sourceFamilyAfter.runtimeLabel}; recovery {stopTransferPreview.sourceFamilyBefore.recoveryLabel} -&gt; {stopTransferPreview.sourceFamilyAfter.recoveryLabel}.
                                    </p>
                                )}
                            {stopTransferPreview.targetFamilyBefore && stopTransferPreview.targetFamilyAfter && (
                                <p className="mt-2 rounded-lg bg-cyan-50 px-2.5 py-2 text-cyan-900">
                                    <span className="font-black">Recalculated target family:</span> runtime {stopTransferPreview.targetFamilyBefore.runtimeLabel} -&gt; {stopTransferPreview.targetFamilyAfter.runtimeLabel}; recovery {stopTransferPreview.targetFamilyBefore.recoveryLabel} -&gt; {stopTransferPreview.targetFamilyAfter.recoveryLabel}.
                                </p>
                            )}
                            <div className="mt-3 flex flex-wrap gap-1.5">
                                <span className="rounded-full bg-slate-100 px-2 py-1 font-bold text-slate-700">{formatTransferCount(stopTransferPreview.carriedScheduledSegmentCount, 'scheduled segment')}</span>
                                <span className="rounded-full bg-slate-100 px-2 py-1 font-bold text-slate-700">{formatTransferCount(stopTransferPreview.carriedRuntimeEstimateCount, 'period runtime')}</span>
                                <span className="rounded-full bg-slate-100 px-2 py-1 font-bold text-slate-700">{formatTransferCount(stopTransferPreview.carriedManualOverrideCount, 'manual override')}</span>
                                <span className="rounded-full bg-slate-100 px-2 py-1 font-bold text-slate-700">{formatTransferCount(stopTransferPreview.connectorSegmentCount, 'connector')}</span>
                                {stopTransferPreview.fallbackConnectorCount > 0 && (
                                    <span className="rounded-full bg-amber-50 px-2 py-1 font-bold text-amber-700">{formatTransferCount(stopTransferPreview.fallbackConnectorCount, 'fallback connector')}</span>
                                )}
                            </div>
                            {stopTransferPreview.matchedRoutes.length > 0 && (
                                <p className="mt-2">
                                    Runtime evidence carried from: <span className="font-bold text-slate-900">{stopTransferPreview.matchedRoutes.join(', ')}</span>
                                </p>
                            )}
                            {stopTransferPreview.droppedDirectionalRuntimeEstimateCount > 0 && (
                                <p className="mt-2 rounded-lg bg-amber-50 px-2.5 py-2 text-amber-800">
                                    {formatTransferCount(stopTransferPreview.droppedDirectionalRuntimeEstimateCount, 'directional runtime')} will be dropped because the segment is reversed.
                                </p>
                            )}
                            {stopTransferPreview.warnings.length > 0 && (
                                <ul className="mt-2 space-y-1">
                                    {stopTransferPreview.warnings.map((warning) => (
                                        <li key={warning.id} className="rounded-lg bg-amber-50 px-2.5 py-2 text-amber-800">
                                            <span className="font-black">Review:</span> {warning.message}
                                        </li>
                                    ))}
                                </ul>
                            )}
                            <p className="mt-2 text-[11px] font-semibold text-slate-500">
                                Copy uses the same target preview but leaves the source route unchanged.
                            </p>
                        </div>
                    )}
                    <div className="grid grid-cols-2 gap-2">
                        <button type="button" onClick={() => openStopTransferReview('move')} disabled={!canApplyStopTransfer} className="rounded-xl border border-cyan-200 bg-cyan-600 px-3 py-2 text-sm font-black text-white shadow-sm disabled:cursor-not-allowed disabled:opacity-50">Move stops</button>
                        <button type="button" onClick={() => openStopTransferReview('copy')} disabled={!canApplyStopTransfer} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-black text-slate-700 disabled:cursor-not-allowed disabled:opacity-50">Copy stops</button>
                        <button type="button" onClick={cancelSegmentSwitchMode} className="col-span-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-black text-slate-600 hover:bg-slate-50">Exit segment switch</button>
                    </div>
                </div>
            )}
        </section>
    );
    const stopTransferReviewPanel = pendingStopTransferReview ? (
        <section className="rounded-2xl border border-cyan-200 bg-white p-4 shadow-sm" data-testid="rp2-stop-transfer-impact-panel">
            <div className="flex items-start justify-between gap-3">
                <div>
                    <div className="inline-flex items-center gap-2 rounded-full bg-cyan-50 px-3 py-1 text-[10px] font-black uppercase tracking-[0.16em] text-cyan-700">
                        <ArrowRightLeft size={14} />
                        Segment switch review
                    </div>
                    <h3 className="mt-3 text-lg font-black leading-6 text-slate-950">
                        {pendingStopTransferReview.mode === 'move' ? 'Move' : 'Copy'} {pendingStopTransferReview.preview.transferredStopCount} {pendingStopTransferReview.preview.transferredStopCount === 1 ? 'stop' : 'stops'} from {pendingStopTransferReview.preview.sourceScenarioName} to {pendingStopTransferReview.preview.targetScenarioName}
                    </h3>
                    <p className="mt-1 text-sm font-semibold leading-6 text-slate-600">
                        Runtime shifted: <span className="font-black text-slate-950">{formatRuntime(pendingStopTransferReview.preview.transferredRuntimeMinutes)}</span>
                    </p>
                </div>
                <button
                    type="button"
                    onClick={cancelStopTransferReview}
                    className="inline-flex size-9 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                    aria-label="Close segment switch review"
                >
                    <X size={17} />
                </button>
            </div>

            <div className="mt-4 grid gap-2 text-xs sm:grid-cols-2">
                <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                    <div className="font-black uppercase tracking-wide text-slate-500">Stop range</div>
                    <div className="mt-1 font-black text-slate-900">{pendingStopTransferReview.preview.sourceStopRangeLabel}</div>
                    <div className="mt-1 font-semibold text-slate-500">{pendingStopTransferReview.preview.transferredStopNames.join(', ')}</div>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                    <div className="font-black uppercase tracking-wide text-slate-500">Insertion</div>
                    <div className="mt-1 font-black text-slate-900">{pendingStopTransferReview.preview.insertPositionLabel}</div>
                    <div className="mt-1 font-semibold text-slate-500">Stop order preserved.</div>
                </div>
            </div>

            <h4 className="mt-4 text-sm font-black text-slate-950">Schedule impact</h4>
            <div className="mt-2 grid gap-3" data-testid="rp2-stop-transfer-review-impact-cards">
                <SegmentSwitchImpactCard impact={pendingStopTransferReview.preview.scheduleImpact.source} />
                <SegmentSwitchImpactCard impact={pendingStopTransferReview.preview.scheduleImpact.target} />
            </div>

            {pendingStopTransferReview.oppositePreview ? (
                <label className="mt-4 flex items-start gap-3 rounded-2xl border border-violet-200 bg-violet-50 px-4 py-3 text-sm text-violet-950">
                    <input
                        type="checkbox"
                        checked={pendingStopTransferReview.applyOpposite}
                        onChange={(event) => updatePendingStopTransferApplyOpposite(event.target.checked)}
                        className="mt-1 size-4 rounded border-violet-300 text-violet-600"
                    />
                    <span>
                        <span className="block font-black">Also apply matching opposite direction</span>
                        <span className="mt-1 block text-xs font-semibold leading-5">
                            {pendingStopTransferReview.oppositePreview.sourceScenarioName} → {pendingStopTransferReview.oppositePreview.targetScenarioName}, {pendingStopTransferReview.oppositePreview.transferredStopCount} {pendingStopTransferReview.oppositePreview.transferredStopCount === 1 ? 'stop' : 'stops'} matched.
                        </span>
                    </span>
                </label>
            ) : (
                <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                    <span className="font-black text-slate-900">Opposite direction:</span> no complete matching opposite segment was found.
                </div>
            )}

            {pendingStopTransferWarnings.length > 0 ? (
                <div className="mt-4 space-y-2">
                    <h4 className="text-sm font-black text-slate-950">Planner review</h4>
                    {pendingStopTransferWarnings.map((warning) => (
                        <div key={warning.id} className="rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                            <div className="font-black">{warning.message}</div>
                            {warning.action && <div className="mt-0.5 text-xs font-semibold opacity-80">{warning.action}</div>}
                        </div>
                    ))}
                </div>
            ) : (
                <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
                    <span className="font-black">No schedule risk flags detected.</span> Review the impact, then apply if it matches the planning intent.
                </div>
            )}

            <div className="mt-4 flex flex-wrap gap-1.5 text-xs font-bold">
                <span className="rounded-full bg-slate-100 px-2 py-1 text-slate-700">{pendingStopTransferReview.preview.carriedScheduledSegmentCount} scheduled segment{pendingStopTransferReview.preview.carriedScheduledSegmentCount === 1 ? '' : 's'}</span>
                <span className="rounded-full bg-slate-100 px-2 py-1 text-slate-700">{pendingStopTransferReview.preview.carriedRuntimeEstimateCount} period runtime{pendingStopTransferReview.preview.carriedRuntimeEstimateCount === 1 ? '' : 's'}</span>
                <span className="rounded-full bg-slate-100 px-2 py-1 text-slate-700">{pendingStopTransferReview.preview.connectorSegmentCount} connector{pendingStopTransferReview.preview.connectorSegmentCount === 1 ? '' : 's'}</span>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-2 border-t border-slate-200 pt-4">
                <button
                    type="button"
                    onClick={cancelStopTransferReview}
                    className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-black text-slate-700 hover:bg-slate-50"
                >
                    Back
                </button>
                <button
                    type="button"
                    onClick={confirmStopTransfer}
                    data-testid="rp2-confirm-stop-transfer"
                    className="rounded-xl border border-cyan-700 bg-cyan-600 px-3 py-2 text-sm font-black text-white shadow-sm hover:bg-cyan-700"
                >
                    Confirm {pendingStopTransferReview.mode === 'move' ? 'move stops' : 'copy stops'}
                </button>
            </div>
        </section>
    ) : null;
    return (
        <div className="h-full overflow-hidden bg-slate-100">
            <main
                data-testid="rp2-map-first-shell"
                data-layout="map-first"
                data-focus-mode={focusMode}
                className="relative h-full min-h-0 overflow-hidden bg-slate-100 p-0"
            >
                    <RoutePlanner2MapCanvas
                        ref={mapCanvasRef}
                        scenario={selectedScenario}
                        backgroundScenarios={backgroundScenarios}
                        transferPreviewMarkers={transferPreviewMarkers}
                        selectedStopId={selectedStopId}
                        highlightedStopId={hoveredMapItem?.type === 'stop' ? hoveredMapItem.id : null}
                        highlightedWaypointId={hoveredMapItem?.type === 'waypoint' ? hoveredMapItem.id : null}
                        highlightedSegmentId={hoveredMapItem?.type === 'segment' ? hoveredMapItem.id : null}
                        selectionMode={mapSelectionMode}
                        selectedStopIds={mapSelectedStopIds}
                        selectedWaypointIds={mapSelection.waypointIds}
                        onSelectionChange={setMapSelection}
                        onSelectStop={selectRoutePlannerStop}
                        onAddStop={addStop}
                        onDeleteStop={deleteStop}
                        onMoveStop={moveStop}
                        onAddLineWaypoint={addLineWaypoint}
                        onInsertStopOnLine={insertStopOnLine}
                        onMoveLineWaypoint={moveLineWaypoint}
                        onDeleteLineWaypoint={deleteLineWaypoint}
                        onSegmentRuntimeEstimates={updateSegmentRuntimeEstimates}
                        onSetSegmentRuntimeOverride={(segmentId, runtimeMinutes) => updateSegmentRuntimeOverride(segmentId, String(runtimeMinutes))}
                        onClearSegmentRuntimeOverride={clearSegmentRuntimeOverride}
                        metricItems={mapMetricItems}
                        segmentRuntimes={selectedFeasibility?.segmentSummaries ?? []}
                        stopLabelDetails={showCampShuttleLabels ? stopMapLabelDetails : []}
                        showRuntimeSourceOverlay={showRuntimeSourceOverlay}
                        showRoadNameLabels={showRoadNameLabels}
                        roadNameLabelDensity={roadNameLabelDensity}
                        onRoadNameLabelStatusChange={setRoadNameLabelStatus}
                        overlayInsets={mapOverlayInsets}
                    />
                    {showActionSidebar && (
                        <>
                            <div className="pointer-events-none absolute left-3 top-3 z-30 flex max-w-[calc(100%-1.5rem)] items-start gap-3">
                                <div
                                    data-testid="rp2-project-chip"
                                    className="pointer-events-auto flex min-w-0 items-center gap-2 rounded-3xl border border-slate-200 bg-white/95 px-3 py-2 shadow-xl backdrop-blur"
                                >
                                    <button type="button" onClick={onBack} aria-label="Back to Planning Data" className="rounded-xl border border-slate-200 p-1.5 text-slate-700 hover:bg-slate-50">
                                        <ArrowLeft size={18} />
                                    </button>
                                    <div className="min-w-0">
                                        <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.16em] text-cyan-700">
                                            <MapPinned size={16} />
                                            Route Planner
                                        </div>
                                        <input
                                            value={project.name}
                                            onChange={(event) => setProject((current) => renameRoutePlanner2Project(current, event.target.value))}
                                            aria-label="Project name"
                                            className="mt-0.5 w-64 max-w-[46vw] rounded-xl border border-transparent bg-transparent text-lg font-black text-slate-900 focus:border-cyan-200 focus:bg-white focus:px-2"
                                        />
                                    </div>
                                    <span className={`hidden rounded-full px-3 py-1 text-xs font-bold sm:inline-flex ${project.status === 'local-saved' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
                                        {saveStatusLabel}
                                    </span>
                                </div>
                                {visibleSaveMessage && (
                                    <div className={`pointer-events-auto mt-1 rounded-2xl border px-3 py-1.5 text-xs font-semibold shadow-lg ${saveState === 'error' || loadState === 'error'
                                        ? 'border-rose-200 bg-rose-50 text-rose-700'
                                        : 'border-emerald-200 bg-emerald-50 text-emerald-700'
                                    }`}>
                                        {visibleSaveMessage}
                                    </div>
                                )}
                            </div>
                            <aside
                                data-testid="rp2-action-sidebar"
                                data-state={actionSidebarExpanded ? 'expanded' : 'collapsed'}
                                className={`pointer-events-auto absolute bottom-4 left-3 top-24 z-30 flex flex-col rounded-3xl border border-slate-200 bg-white/95 p-2.5 shadow-xl backdrop-blur transition-all duration-200 ${actionSidebarExpanded ? 'w-72' : 'w-20'}`}
                                aria-label="Route Planner actions"
                            >
                                <button
                                    type="button"
                                    onClick={() => setIsActionSidebarOpen((current) => !current)}
                                    className="flex min-h-10 items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-2 py-2 text-xs font-black text-slate-700 hover:bg-slate-50"
                                    aria-expanded={actionSidebarExpanded}
                                    title={actionSidebarExpanded ? 'Collapse actions' : 'Expand actions'}
                                >
                                    <span aria-hidden="true">{actionSidebarExpanded ? '‹' : '›'}</span>
                                    <span className={actionSidebarExpanded ? undefined : 'sr-only'}>Actions</span>
                                </button>
                                {actionSidebarExpanded ? (
                                    <section className="mt-2 rounded-2xl border border-slate-200 bg-slate-50 p-2">
                                        <div className="flex items-center justify-between gap-2">
                                            <div className="text-xs font-black uppercase tracking-wide text-slate-500">Route concepts</div>
                                            <button type="button" onClick={() => setProject((current) => addRoutePlanner2Scenario(current))} className="inline-flex shrink-0 items-center gap-1 rounded-full bg-cyan-50 px-2 py-1 text-xs font-bold text-cyan-700">
                                                <Plus size={12} /> Add
                                            </button>
                                        </div>
                                        <div className="mt-2 max-h-44 space-y-1.5 overflow-y-auto pr-1">
                                            {routeConceptGroups.map((group) => (
                                                <div key={group.key} className={group.scenarios.length > 1 ? 'rounded-2xl border border-slate-200 bg-white/70 p-1.5' : undefined}>
                                                    {group.scenarios.length > 1 && (
                                                        <div className="mb-1 px-1">
                                                            <div className="flex items-center justify-between gap-2">
                                                                <span className="truncate text-xs font-black uppercase tracking-wide text-slate-500">{group.label}</span>
                                                                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase text-slate-600">{group.scenarios.length} directions</span>
                                                            </div>
                                                            {(() => {
                                                                const familySummary = projectSummary.routeFamilySummaries.find((summary) =>
                                                                    group.scenarios.some((scenario) => summary.scenarioIds.includes(scenario.id)),
                                                                );
                                                                return familySummary ? (
                                                                    <div className="mt-1 truncate text-[11px] font-semibold text-slate-500">
                                                                        {familySummary.runtimeLabel} runtime · {familySummary.cycleTimeLabel} cycle · {familySummary.busesRequiredLabel}
                                                                    </div>
                                                                ) : null;
                                                            })()}
                                                        </div>
                                                    )}
                                                    <div className="space-y-1.5">
                                                        {group.scenarios.map((scenario) => {
                                                            const summary = projectSummary.scenarioSummaries.find((item) => item.scenarioId === scenario.id);
                                                            const isSelected = selectedScenario?.id === scenario.id;
                                                            const scenarioLabel = group.scenarios.length > 1 ? getRoutePlanner2ScenarioDirectionLabel(scenario) : scenario.name;
                                                            return (
                                                                <button
                                                                    key={scenario.id}
                                                                    type="button"
                                                                    onClick={() => setProject((current) => selectRoutePlanner2Scenario(current, scenario.id))}
                                                                    className={`w-full rounded-xl border px-2.5 py-2 text-left ${isSelected ? 'border-cyan-300 bg-white shadow-sm' : 'border-slate-200 bg-white/80 hover:bg-white'}`}
                                                                >
                                                                    <div className="flex items-center justify-between gap-2">
                                                                        <span className="truncate text-sm font-black text-slate-900">{scenarioLabel}</span>
                                                                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase text-slate-700">{scenario.status}</span>
                                                                    </div>
                                                                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
                                                                        <span>{scenario.stops.length} stops</span>
                                                                        <span>{summary?.oneWayRuntimeLabel ?? 'Not ready'}</span>
                                                                        <span>{scenario.routeShape === 'closed-loop' ? 'Closed loop' : scenario.routeShape === 'out-and-back' ? 'Out and back' : summary?.readinessLabel ?? 'Not ready'}</span>
                                                                    </div>
                                                                    {group.scenarios.length > 1 && scenario.routeFamily && (
                                                                        <div className="mt-1 truncate text-[11px] font-semibold text-slate-400">{scenario.name}</div>
                                                                    )}
                                                                </button>
                                                            );
                                                        })}
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                        <button
                                            type="button"
                                            data-testid="rp2-delete-selected-route-concept"
                                            onClick={deleteSelectedRouteConcept}
                                            disabled={!selectedScenario || project.scenarios.length <= 1}
                                            className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-red-200 bg-white px-2.5 py-2 text-xs font-black text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40"
                                            title={project.scenarios.length <= 1 ? 'Add another route concept before deleting this one' : 'Delete selected route concept'}
                                        >
                                            <Trash2 size={14} /> Delete concept
                                        </button>
                                    </section>
                                ) : (
                                    <div className="mt-2 space-y-1.5">
                                        <button
                                            type="button"
                                            onClick={() => setIsActionSidebarOpen(true)}
                                            className="inline-flex min-h-10 w-full items-center justify-center rounded-2xl border border-cyan-200 bg-cyan-50 px-2.5 py-2 text-xs font-bold text-cyan-800"
                                            title="Route concepts"
                                        >
                                            <Layers3 size={16} /><span className="sr-only">Route concepts</span>
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setProject((current) => addRoutePlanner2Scenario(current));
                                                setIsActionSidebarOpen(true);
                                            }}
                                            className="inline-flex min-h-10 w-full items-center justify-center rounded-2xl border border-cyan-200 bg-white px-2.5 py-2 text-xs font-bold text-cyan-800"
                                            title="Add route"
                                        >
                                            <Plus size={16} /><span className="sr-only">Add route</span>
                                        </button>
                                    </div>
                                )}
                                <div
                                    data-testid="rp2-action-sidebar-scroll"
                                    className={`mt-2 flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto rp2-action-scrollbar ${actionSidebarExpanded ? 'pr-1' : 'pr-2'}`}
                                >
                                    <button
                                        type="button"
                                        onClick={undoProjectChange}
                                        disabled={!canUndoProject}
                                        className={`inline-flex min-h-10 items-center gap-2 rounded-2xl border border-slate-200 bg-white px-2.5 py-2 text-xs font-bold text-slate-700 disabled:cursor-not-allowed disabled:opacity-40 ${actionSidebarExpanded ? 'justify-start' : 'justify-center'}`}
                                        title="Undo last route planner change"
                                    >
                                        <Undo2 size={16} /><span className={actionSidebarExpanded ? undefined : 'sr-only'}>Undo</span>
                                    </button>
                                    <button
                                        type="button"
                                        onClick={redoProjectChange}
                                        disabled={!canRedoProject}
                                        className={`inline-flex min-h-10 items-center gap-2 rounded-2xl border border-slate-200 bg-white px-2.5 py-2 text-xs font-bold text-slate-700 disabled:cursor-not-allowed disabled:opacity-40 ${actionSidebarExpanded ? 'justify-start' : 'justify-center'}`}
                                        title="Redo last undone route planner change"
                                    >
                                        <Redo2 size={16} /><span className={actionSidebarExpanded ? undefined : 'sr-only'}>Redo</span>
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setShowRuntimeSourceOverlay((current) => !current)}
                                        disabled={!canShowRuntimeSourceOverlay}
                                        data-testid="rp2-runtime-source-overlay-toggle"
                                        aria-pressed={showRuntimeSourceOverlay}
                                        className={`inline-flex min-h-10 items-center gap-2 rounded-2xl border px-2.5 py-2 text-xs font-bold disabled:cursor-not-allowed disabled:opacity-40 ${actionSidebarExpanded ? 'justify-start' : 'justify-center'} ${showRuntimeSourceOverlay ? 'border-cyan-300 bg-cyan-50 text-cyan-800' : 'border-slate-200 bg-white text-slate-700'}`}
                                        title={showRuntimeSourceOverlay ? 'Hide source overlay' : 'Show source overlay'}
                                    >
                                        <Eye size={16} /><span className={actionSidebarExpanded ? undefined : 'sr-only'}>{showRuntimeSourceOverlay ? 'Hide source overlay' : 'Show source overlay'}</span>
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setShowRoadNameLabels((current) => !current)}
                                        disabled={!canShowRoadNameLabels}
                                        data-testid="rp2-road-name-label-toggle"
                                        aria-pressed={showRoadNameLabels}
                                        className={`inline-flex min-h-10 items-center gap-2 rounded-2xl border px-2.5 py-2 text-xs font-bold disabled:cursor-not-allowed disabled:opacity-40 ${actionSidebarExpanded ? 'justify-start' : 'justify-center'} ${showRoadNameLabels ? 'border-blue-300 bg-blue-50 text-blue-800' : 'border-slate-200 bg-white text-slate-700'}`}
                                        title={showRoadNameLabels ? 'Hide road names' : 'Show road names'}
                                    >
                                        <MapPin size={16} /><span className={actionSidebarExpanded ? undefined : 'sr-only'}>{showRoadNameLabels ? 'Hide road names' : 'Show road names'}</span>
                                    </button>
                                    <button
                                        type="button"
                                        data-testid="rp2-camp-shuttle-label-toggle"
                                        aria-pressed={showCampShuttleLabels}
                                        onClick={() => setShowCampShuttleLabels((current) => !current)}
                                        className={`inline-flex min-h-10 items-center gap-2 rounded-2xl border px-2.5 py-2 text-xs font-bold ${actionSidebarExpanded ? 'justify-start' : 'justify-center'} ${
                                            showCampShuttleLabels
                                                ? 'border-emerald-300 bg-emerald-50 text-emerald-800'
                                                : 'border-slate-200 bg-white text-slate-700'
                                        }`}
                                        title={showCampShuttleLabels ? 'Hide camp shuttle stop labels' : 'Show camp shuttle stop labels'}
                                    >
                                        <MapPinned size={16} />
                                        <span className={actionSidebarExpanded ? undefined : 'sr-only'}>Camp Shuttle</span>
                                        {actionSidebarExpanded && (
                                            <span className={`ml-auto rounded-full px-2 py-0.5 text-[10px] font-black uppercase ${
                                                showCampShuttleLabels ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600'
                                            }`}>
                                                {showCampShuttleLabels ? 'On' : 'Off'}
                                            </span>
                                        )}
                                    </button>
                                    {actionSidebarExpanded && canShowRoadNameLabels && showRoadNameLabels && (
                                        <div className="rounded-2xl border border-blue-100 bg-blue-50/60 p-2">
                                            <div className="mb-1 flex items-center justify-between gap-2">
                                                <span className="text-[10px] font-black uppercase tracking-wide text-blue-800">Road label density</span>
                                                <span className="text-[10px] font-bold text-blue-700">{roadNameLabelStatus.count} shown</span>
                                            </div>
                                            <div className="grid grid-cols-3 gap-1" data-testid="rp2-road-name-density-controls">
                                                {(['fewer', 'normal', 'more'] as const).map((density) => (
                                                    <button
                                                        key={density}
                                                        type="button"
                                                        onClick={() => setRoadNameLabelDensity(density)}
                                                        className={`rounded-xl border px-2 py-1 text-[10px] font-black capitalize ${roadNameLabelDensity === density ? 'border-blue-300 bg-white text-blue-800 shadow-sm' : 'border-transparent bg-blue-100 text-blue-700'}`}
                                                    >
                                                        {density}
                                                    </button>
                                                ))}
                                            </div>
                                            {!roadNameLabelStatus.available && (
                                                <p className="mt-1.5 text-[10px] font-semibold leading-4 text-blue-700">
                                                    Labels appear after Mapbox road snapping. Fallback segments may not have road names.
                                                </p>
                                            )}
                                        </div>
                                    )}
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setIsActionSidebarOpen(true);
                                            setIsSelectionMenuOpen((current) => !current);
                                        }}
                                        data-testid="rp2-selection-menu-toggle"
                                        aria-expanded={isSelectionMenuOpen}
                                        className={`inline-flex min-h-10 items-center gap-2 rounded-2xl border px-2.5 py-2 text-xs font-bold ${actionSidebarExpanded ? 'justify-start' : 'justify-center'} ${mapSelectionMode ? 'border-violet-300 bg-violet-50 text-violet-800' : 'border-slate-200 bg-white text-slate-700'}`}
                                        title="Select stops and bend anchors"
                                    >
                                        <MousePointer2 size={16} /><span className={actionSidebarExpanded ? undefined : 'sr-only'}>Select</span>
                                    </button>
                                    {actionSidebarExpanded && isSelectionMenuOpen && (
                                        <div data-testid="rp2-selection-menu" className="rounded-2xl border border-violet-100 bg-violet-50/70 p-2">
                                            <div className="grid grid-cols-2 gap-1">
                                                <button
                                                    type="button"
                                                    onClick={() => activateMapSelectionMode('box')}
                                                    aria-pressed={mapSelectionMode === 'box'}
                                                    className={`inline-flex items-center justify-center gap-1 rounded-xl border px-2 py-1.5 text-xs font-black ${mapSelectionMode === 'box' ? 'border-violet-300 bg-white text-violet-800 shadow-sm' : 'border-transparent bg-violet-100 text-violet-700'}`}
                                                >
                                                    <BoxSelect size={14} /> Box
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => activateMapSelectionMode('lasso')}
                                                    aria-pressed={mapSelectionMode === 'lasso'}
                                                    className={`inline-flex items-center justify-center gap-1 rounded-xl border px-2 py-1.5 text-xs font-black ${mapSelectionMode === 'lasso' ? 'border-violet-300 bg-white text-violet-800 shadow-sm' : 'border-transparent bg-violet-100 text-violet-700'}`}
                                                >
                                                    <LassoSelect size={14} /> Lasso
                                                </button>
                                            </div>
                                            <button
                                                type="button"
                                                data-testid="rp2-delete-selected-map-items"
                                                onClick={deleteSelectedMapItems}
                                                disabled={mapSelectionCount === 0}
                                                className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-red-200 bg-white px-2 py-1.5 text-xs font-black text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40"
                                            >
                                                <Trash2 size={14} /> Delete selected{mapSelectionCount > 0 ? ` (${mapSelectionCount})` : ''}
                                            </button>
                                            <div className="mt-2 flex items-center justify-between gap-2 text-[10px] font-bold text-violet-700">
                                                <span>{mapSelectionCount} selected</span>
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        setMapSelection(EMPTY_MAP_SELECTION);
                                                        setMapSelectionMode(null);
                                                    }}
                                                    className="rounded-full bg-white px-2 py-1 font-black text-violet-800"
                                                >
                                                    Clear
                                                </button>
                                            </div>
                                            <p className="mt-1.5 text-[10px] font-semibold leading-4 text-violet-700">
                                                Choose Box or Lasso, then drag on the map around stops and bend anchors.
                                            </p>
                                        </div>
                                    )}
                                    <button
                                        type="button"
                                        onClick={openLoadPicker}
                                        disabled={!canUseTeamSave || loadState === 'loading'}
                                        className={`inline-flex min-h-10 items-center gap-2 rounded-2xl border border-slate-200 bg-white px-2.5 py-2 text-xs font-bold text-slate-700 disabled:opacity-50 ${actionSidebarExpanded ? 'justify-start' : 'justify-center'}`}
                                        title={canUseTeamSave ? 'Load saved plan' : 'Sign in with a team workspace to load'}
                                    >
                                        <FolderOpen size={16} /><span className={actionSidebarExpanded ? undefined : 'sr-only'}>{loadState === 'loading' ? 'Loading...' : 'Load'}</span>
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => selectedScenario && setProject((current) => duplicateRoutePlanner2Scenario(current, selectedScenario.id))}
                                        className={`inline-flex min-h-10 items-center gap-2 rounded-2xl border border-slate-200 bg-white px-2.5 py-2 text-xs font-bold text-slate-700 ${actionSidebarExpanded ? 'justify-start' : 'justify-center'}`}
                                        title="Duplicate route"
                                    >
                                        <Copy size={16} /><span className={actionSidebarExpanded ? undefined : 'sr-only'}>Duplicate</span>
                                    </button>
                                    <button
                                        type="button"
                                        onClick={openGtfsImport}
                                        className={`inline-flex min-h-10 items-center gap-2 rounded-2xl border border-cyan-200 bg-cyan-50 px-2.5 py-2 text-xs font-bold text-cyan-800 ${actionSidebarExpanded ? 'justify-start' : 'justify-center'}`}
                                        title="Import GTFS"
                                    >
                                        <Database size={16} /><span className={actionSidebarExpanded ? undefined : 'sr-only'}>Import GTFS</span>
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setIsGtfsImportOpen(false);
                                            setIsAddressImportOpen(true);
                                        }}
                                        className={`inline-flex min-h-10 items-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 px-2.5 py-2 text-xs font-bold text-emerald-800 ${actionSidebarExpanded ? 'justify-start' : 'justify-center'}`}
                                        title="Import addresses"
                                    >
                                        <FileSpreadsheet size={16} /><span className={actionSidebarExpanded ? undefined : 'sr-only'}>Import addresses</span>
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setIsActionSidebarOpen(true);
                                            setIsExportMenuOpen((current) => !current);
                                        }}
                                        data-testid="rp2-export-menu-toggle"
                                        aria-expanded={isExportMenuOpen}
                                        className={`inline-flex min-h-10 items-center gap-2 rounded-2xl border border-cyan-200 bg-cyan-50 px-2.5 py-2 text-xs font-bold text-cyan-800 ${actionSidebarExpanded ? 'justify-start' : 'justify-center'}`}
                                        title="Export PDFs"
                                    >
                                        <FileDown size={16} /><span className={actionSidebarExpanded ? undefined : 'sr-only'}>Export</span>
                                    </button>
                                    {actionSidebarExpanded && isExportMenuOpen && (
                                        <div data-testid="rp2-export-menu" className="rounded-2xl border border-cyan-100 bg-cyan-50/70 p-2">
                                            <button
                                                type="button"
                                                onClick={exportOperatorDirections}
                                                disabled={!selectedScenario || selectedScenario.stops.length < 2 || isExportingOperatorPdf}
                                                className="inline-flex w-full items-center gap-2 rounded-xl border border-cyan-200 bg-white px-2 py-1.5 text-xs font-black text-cyan-800 hover:bg-cyan-50 disabled:cursor-not-allowed disabled:opacity-50"
                                                title="Operator PDF"
                                            >
                                                <FileDown size={14} /> {isExportingOperatorPdf ? 'Preparing PDF' : 'Operator PDF'}
                                            </button>
                                            <button
                                                type="button"
                                                onClick={exportMapPdf}
                                                disabled={!selectedScenario || selectedScenario.stops.length < 2 || isExportingMapPdf}
                                                className="mt-1 inline-flex w-full items-center gap-2 rounded-xl border border-blue-200 bg-white px-2 py-1.5 text-xs font-black text-blue-800 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-50"
                                                title="Map PDF"
                                            >
                                                <MapPinned size={14} /> {isExportingMapPdf ? 'Preparing map' : 'Map PDF'}
                                            </button>
                                        </div>
                                    )}
                                    <button
                                        type="button"
                                        onClick={toggleRightRail}
                                        className={`inline-flex min-h-10 items-center gap-2 rounded-2xl border border-slate-200 bg-white px-2.5 py-2 text-xs font-black text-slate-700 hover:bg-slate-50 ${actionSidebarExpanded ? 'justify-start' : 'justify-center'}`}
                                        title={visibleRightRailOpen ? 'Hide review' : 'Review route'}
                                    >
                                        <PanelRightOpen size={16} /><span className={actionSidebarExpanded ? undefined : 'sr-only'}>{visibleRightRailOpen ? 'Hide review' : 'Review route'}</span>
                                    </button>
                                </div>
                                {actionSidebarExpanded && <div className="mt-2 rounded-2xl bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-500">Team: {teamId ?? 'not set'}</div>}
                            </aside>
                        </>
                    )}
                    <div className="pointer-events-none absolute inset-x-4 top-4 z-30 flex items-start justify-between gap-3">
                        <div />
                        <div className="flex flex-col items-end gap-2">
                            <div className="flex gap-2">
                                <button
                                    type="button"
                                    onClick={segmentSwitchModeActive ? cancelSegmentSwitchMode : startSegmentSwitchMode}
                                    data-testid="rp2-open-segment-switch"
                                    className={`pointer-events-auto inline-flex items-center gap-2 rounded-full border px-3 py-2 text-xs font-black shadow-lg backdrop-blur ${segmentSwitchModeActive ? 'border-slate-300 bg-slate-900/90 text-white hover:bg-slate-800' : 'border-cyan-200 bg-white/95 text-cyan-800 hover:bg-cyan-50'}`}
                                >
                                    <ArrowRightLeft size={15} />
                                    {segmentSwitchModeActive ? 'Exit segment switch' : 'Segment switch'}
                                </button>
                            {isDrawFocusMode && (
                                <button
                                    type="button"
                                    onClick={exitDrawFocusMode}
                                    className="pointer-events-auto rounded-full border border-cyan-200 bg-white/95 px-3 py-2 text-xs font-black text-cyan-700 shadow-lg hover:bg-cyan-50"
                                >
                                    Exit focus
                                </button>
                            )}
                            </div>
                            {segmentTransferImpactMessage && (
                                <div data-testid="rp2-segment-transfer-impact" className="pointer-events-auto max-w-md rounded-2xl border border-emerald-200 bg-emerald-50/95 px-3 py-2 text-xs leading-5 text-emerald-900 shadow-lg backdrop-blur">
                                    <span className="font-black">Runtime impact:</span> {segmentTransferImpactMessage}
                                </div>
                            )}
                            {lastTransferUndoMessage && (
                                <div data-testid="rp2-transfer-undo-toast" className="pointer-events-auto flex max-w-md items-center gap-3 rounded-2xl border border-slate-200 bg-white/95 px-3 py-2 text-xs leading-5 text-slate-700 shadow-lg backdrop-blur">
                                    <span className="font-bold">{lastTransferUndoMessage}</span>
                                    <button
                                        type="button"
                                        onClick={undoLastStopTransfer}
                                        className="shrink-0 rounded-xl border border-cyan-200 bg-cyan-50 px-2.5 py-1.5 font-black text-cyan-800 hover:bg-cyan-100"
                                    >
                                        Undo
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>
                    {segmentSwitchModeActive && (
                        <aside
                            data-testid="rp2-segment-switch-drawer"
                            className="pointer-events-auto absolute bottom-4 right-3 top-24 z-30 flex w-[min(92vw,30rem)] flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white/95 p-3 shadow-2xl backdrop-blur"
                        >
                            <header className="mb-3 flex items-start justify-between gap-3 rounded-3xl border border-slate-200 bg-white p-3 shadow-sm">
                                <div>
                                    <div className="text-[10px] font-black uppercase tracking-[0.18em] text-cyan-700">Route segment tools</div>
                                    <h2 className="mt-0.5 text-base font-black text-slate-950">Segment switch mode</h2>
                                    <p className="mt-1 text-xs font-semibold leading-5 text-slate-500">
                                        Work directly from the map. Selected source stops stay highlighted while you choose the target route and review the impact.
                                    </p>
                                </div>
                                <button
                                    type="button"
                                    onClick={cancelSegmentSwitchMode}
                                    className="inline-flex size-9 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                                    aria-label="Exit segment switch mode"
                                >
                                    <X size={17} />
                                </button>
                            </header>
                            <div className="min-h-0 flex-1 overflow-y-auto pr-1">
                                {stopTransferReviewPanel ?? reassignStopsPanel}
                            </div>
                        </aside>
                    )}
                    <aside
                        data-testid="rp2-right-rail"
                        data-state={rightRailState}
                        aria-hidden={!showRightRail}
                        className={`absolute bottom-4 right-3 top-24 z-20 flex flex-col overflow-y-auto rounded-3xl border border-slate-200 bg-white/95 p-2 shadow-xl backdrop-blur transition-all duration-200 ${visibleRightRailOpen ? 'w-[410px] space-y-4' : 'w-14 gap-2'} ${showRightRail ? 'pointer-events-auto translate-x-0 opacity-100' : 'pointer-events-none translate-x-[calc(100%+2rem)] opacity-0'}`}
                    >
                        {visibleRightRailOpen ? (
                            <>
                        <section className="sticky top-0 z-10 rounded-3xl border border-slate-200 bg-white/95 p-3 shadow-lg backdrop-blur">
                            <div className="flex items-center justify-between gap-3">
                                <div>
                                    <div className="text-[10px] font-black uppercase tracking-[0.18em] text-cyan-700">Route Planner</div>
                                    <h2 className="mt-0.5 text-base font-black text-slate-950">Review route</h2>
                                </div>
                                <div className="flex items-center gap-2">
                                    <button
                                        type="button"
                                        onClick={() => void saveCurrentProject()}
                                        disabled={!canUseTeamSave || saveState === 'saving'}
                                        className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-black text-emerald-800 disabled:cursor-not-allowed disabled:opacity-50"
                                        title={canUseTeamSave ? 'Save this route plan' : 'Sign in with a team workspace to save'}
                                    >
                                        <Save size={14} /> {saveState === 'saving' ? 'Saving...' : 'Save'}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setIsRightRailOpen(false)}
                                        className="inline-flex size-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                                        aria-label="Close review route panel"
                                        title="Collapse review route panel"
                                    >
                                        <span aria-hidden="true">›</span>
                                    </button>
                                </div>
                            </div>
                        </section>

                        <section className="rounded-3xl border border-cyan-100 bg-white p-4 shadow-sm">
                            <div className="flex items-start justify-between gap-3">
                                <div>
                                    <div className="text-xs font-black uppercase tracking-wide text-cyan-700">Draw route</div>
                                    <div className="mt-1 text-base font-black leading-5 text-slate-900">{drawingGuide.title}</div>
                                </div>
                                <button
                                    type="button"
                                    onClick={enterDrawFocusMode}
                                    className="shrink-0 rounded-xl border border-cyan-200 bg-cyan-50 px-3 py-2 text-xs font-black text-cyan-700 hover:bg-cyan-100"
                                >
                                    Draw route
                                </button>
                            </div>
                            {drawingGuide.body && (
                                <p className="mt-2 text-sm leading-5 text-slate-600">{drawingGuide.body}</p>
                            )}
                            <div className="mt-3 rounded-2xl border border-slate-200 bg-slate-50 p-2">
                                <label className="text-[10px] font-black uppercase tracking-wide text-slate-500" htmlFor="rp2-address-search">
                                    Add stop by address
                                </label>
                                <div className="mt-2 flex gap-2">
                                    <div className="relative min-w-0 flex-1">
                                        <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                                        <input
                                            id="rp2-address-search"
                                            type="text"
                                            value={addressQuery}
                                            onChange={(event) => {
                                                setSelectedAddress(null);
                                                setAddressQuery(event.target.value);
                                            }}
                                            placeholder="Start typing an address"
                                            className="w-full rounded-xl border border-slate-200 bg-white py-2 pl-9 pr-9 text-sm font-semibold text-slate-900 outline-none focus:border-cyan-300 focus:ring-2 focus:ring-cyan-100"
                                            autoComplete="off"
                                        />
                                        {addressSearchLoading && (
                                            <Loader2 size={14} className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-cyan-600" />
                                        )}
                                    </div>
                                    <button
                                        type="button"
                                        onClick={addSelectedAddressStop}
                                        disabled={addressSuggestions.length === 0}
                                        className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-cyan-600 text-white shadow-sm transition-colors hover:bg-cyan-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                                        aria-label="Add selected address as stop"
                                        title="Add selected address as stop"
                                    >
                                        <Plus size={18} />
                                    </button>
                                </div>
                                {addressSuggestions.length > 0 && (
                                    <div className="mt-2 max-h-44 overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-sm">
                                        {addressSuggestions.map((suggestion) => (
                                            <button
                                                key={suggestion.id}
                                                type="button"
                                                onClick={() => selectAddressSuggestion(suggestion)}
                                                className={`flex w-full items-start gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-cyan-50 ${selectedAddress?.id === suggestion.id ? 'bg-cyan-50 text-cyan-900' : 'text-slate-700'}`}
                                            >
                                                <MapPin size={14} className="mt-0.5 shrink-0 text-cyan-600" />
                                                <span className="min-w-0">
                                                    <span className="block font-black">{suggestion.name}</span>
                                                    <span className="block truncate text-xs font-semibold text-slate-500">{suggestion.label}</span>
                                                </span>
                                            </button>
                                        ))}
                                    </div>
                                )}
                                {selectedScenarioStops.length > 0 && (
                                    <label className="mt-2 block text-[10px] font-black uppercase tracking-wide text-slate-500" htmlFor="rp2-address-insert-position">
                                        Add stop position
                                        <select
                                            id="rp2-address-insert-position"
                                            value={addressInsertAfterStopId}
                                            onChange={(event) => setAddressInsertAfterStopId(event.target.value)}
                                            className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-800 outline-none focus:border-cyan-300 focus:ring-2 focus:ring-cyan-100"
                                        >
                                            <option value="__beginning">Beginning of route</option>
                                            {selectedScenarioStops.slice(0, -1).map((stop, index) => (
                                                <option key={stop.id} value={stop.id}>
                                                    {`Between ${stop.sequence}. ${stop.name} and ${selectedScenarioStops[index + 1]?.sequence}. ${selectedScenarioStops[index + 1]?.name}`}
                                                </option>
                                            ))}
                                            <option value="__end">End of route</option>
                                        </select>
                                    </label>
                                )}
                                {addressSearchError && (
                                    <p className="mt-2 text-xs font-semibold text-amber-700">{addressSearchError}</p>
                                )}
                            </div>
                            {selectedScenario && selectedScenario.stops.length >= 2 && (
                                <div className="mt-3 rounded-2xl bg-slate-50 p-2">
                                    <div className="mb-2 text-[10px] font-black uppercase tracking-wide text-slate-500">Route type</div>
                                    <div className="flex flex-wrap gap-2">
                                        <button
                                            type="button"
                                            onClick={() => updateRouteShape('one-way')}
                                            className={`rounded-full border px-3 py-1.5 text-xs font-black ${selectedScenario.routeShape === 'one-way' ? 'border-cyan-300 bg-cyan-50 text-cyan-800' : 'border-slate-200 bg-white text-slate-600'}`}
                                        >
                                            One-way
                                        </button>
                                        {selectedScenario.stops.length >= 3 && (
                                            <button
                                                type="button"
                                                onClick={() => updateRouteShape('closed-loop')}
                                                className={`rounded-full border px-3 py-1.5 text-xs font-black ${selectedScenario.routeShape === 'closed-loop' ? 'border-cyan-300 bg-cyan-50 text-cyan-800' : 'border-slate-200 bg-white text-slate-600'}`}
                                            >
                                                Closed loop
                                            </button>
                                        )}
                                        <button
                                            type="button"
                                            onClick={() => updateRouteShape('out-and-back')}
                                            className={`rounded-full border px-3 py-1.5 text-xs font-black ${selectedScenario.routeShape === 'out-and-back' ? 'border-cyan-300 bg-cyan-50 text-cyan-800' : 'border-slate-200 bg-white text-slate-600'}`}
                                        >
                                            Out and back
                                        </button>
                                    </div>
                                    <div className="mt-2 text-xs font-semibold text-slate-600">
                                        {routeShapeLabel}: {stopVisitSequence.map((stop) => stop.sequence).join(' → ')}
                                    </div>
                                    {selectedScenario.routeShape === 'one-way' && selectedScenarioStops.length >= 2 && (
                                        <button
                                            type="button"
                                            onClick={createBackDirection}
                                            className="mt-3 w-full rounded-xl border border-cyan-200 bg-white px-3 py-2 text-xs font-black text-cyan-800 hover:bg-cyan-50"
                                        >
                                            Create back direction
                                        </button>
                                    )}
                                </div>
                            )}
                            <div className="mt-3">
                                <button type="button" onClick={() => addStop()} className="rounded-xl bg-cyan-600 px-3 py-2 text-sm font-bold text-white hover:bg-cyan-700">
                                    {drawingGuide.actionLabel}
                                </button>
                            </div>
                        </section>

                        <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
                            <div className="flex items-center justify-between gap-3">
                                <h2 className="text-sm font-black text-slate-900">Route details</h2>
                                {selectedScenarioSummary?.isPreferred && <span className="rounded-full bg-emerald-100 px-2 py-1 text-xs font-bold text-emerald-700">Preferred</span>}
                            </div>
                            {selectedScenario && selectedScenarioSummary ? (
                                <div className="mt-4 space-y-4">
                                    <label className="block text-xs font-bold uppercase tracking-wide text-slate-500" htmlFor="rp2-scenario-name">
                                        Route name
                                        <input id="rp2-scenario-name" value={selectedScenario.name} onChange={(event) => setProject((current) => renameRoutePlanner2Scenario(current, selectedScenario.id, event.target.value))} className="mt-1 w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm font-bold text-slate-900" />
                                    </label>
                                    <div className="divide-y divide-slate-100 rounded-2xl bg-slate-50 px-3 text-sm">
                                        <div className="flex items-center justify-between gap-3 py-2">
                                            <span className="font-bold text-slate-500">{selectedScenario.routeFamily ? `${selectedScenario.routeFamily.memberShortName} runtime` : 'Runtime'}</span>
                                            <span className="text-right font-black text-slate-900">{formatRuntime(selectedFeasibility?.oneWayRuntimeMinutes)}</span>
                                        </div>
                                        <div className="flex items-center justify-between gap-3 py-2">
                                            <span className="font-bold text-slate-500">Source</span>
                                            <span className="text-right font-semibold text-slate-700">{getRuntimeSourceDetail(selectedFeasibility, runtimeDayType, runtimePeriod)}</span>
                                        </div>
                                        <div className="flex items-center justify-between gap-3 py-2">
                                            <span className="font-bold text-slate-500">Cycle</span>
                                            <span className="text-right font-black text-slate-900">{formatRuntime(selectedFeasibility?.cycleTimeMinutes)}</span>
                                        </div>
                                    </div>
                                    {selectedRouteFamilySummary && (
                                        <div className="rounded-2xl border border-cyan-200 bg-cyan-50/70 p-3" data-testid="rp2-route-family-summary">
                                            <div className="flex items-start justify-between gap-3">
                                                <div>
                                                    <h3 className="text-sm font-black text-slate-900">{selectedRouteFamilySummary.familyName} family</h3>
                                                    <p className="mt-1 text-xs font-semibold leading-5 text-slate-600">
                                                        Combined operating view for {selectedRouteFamilySummary.directionLabels.join(' + ')}.
                                                    </p>
                                                </div>
                                                <span className="shrink-0 rounded-full bg-white px-2 py-1 text-[10px] font-black uppercase text-cyan-700">Family</span>
                                            </div>
                                            <div className="mt-3 divide-y divide-cyan-100 rounded-2xl bg-white px-3 text-sm">
                                                <div className="flex items-center justify-between gap-3 py-2">
                                                    <span className="font-bold text-slate-500">Combined runtime</span>
                                                    <span className="text-right font-black text-slate-900">{selectedRouteFamilySummary.runtimeLabel}</span>
                                                </div>
                                                <div className="flex items-center justify-between gap-3 py-2">
                                                    <span className="font-bold text-slate-500">Cycle window</span>
                                                    <span className="text-right font-black text-slate-900">{selectedRouteFamilySummary.cycleTimeLabel}</span>
                                                </div>
                                                <div className="flex items-center justify-between gap-3 py-2">
                                                    <span className="font-bold text-slate-500">Recovery</span>
                                                    <span className="text-right font-black text-slate-900">{selectedRouteFamilySummary.recoveryLabel}</span>
                                                </div>
                                                <div className="flex items-center justify-between gap-3 py-2">
                                                    <span className="font-bold text-slate-500">Buses</span>
                                                    <span className="text-right font-black text-slate-900">{selectedRouteFamilySummary.busesRequiredLabel}</span>
                                                </div>
                                            </div>
                                            <p className="mt-2 text-xs font-semibold leading-5 text-slate-500">
                                                Direction labels, stops, shapes, and segment runtimes stay separate. The family summary adds the directions together for cycle, recovery, and shared bus need.
                                            </p>
                                        </div>
                                    )}
                                    <div className="rounded-2xl border border-slate-200 bg-white p-3" data-testid="rp2-stop-order-panel">
                                        <div className="flex items-center justify-between gap-3">
                                            <div>
                                                <h3 className="text-sm font-black text-slate-900">Stop order</h3>
                                                <p className="mt-1 text-xs font-semibold text-slate-500">Review, select, reorder, or remove stops here instead of on the map.</p>
                                            </div>
                                            <div className="flex shrink-0 items-center gap-2">
                                                {stopOrderItems.length > 0 && (
                                                    <button
                                                        type="button"
                                                        onClick={clearStopOrder}
                                                        className="rounded-full border border-red-200 bg-white px-2 py-1 text-xs font-black text-red-700 hover:bg-red-50"
                                                    >
                                                        Clear all
                                                    </button>
                                                )}
                                                <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-bold text-slate-600">
                                                    {stopOrderItems.length}
                                                </span>
                                            </div>
                                        </div>
                                        {stopOrderItems.length > 0 ? (
                                            <ol className="mt-3 max-h-72 space-y-2 overflow-y-auto pr-1">
                                                {stopOrderItems.map((item) => item.type === 'stop' ? (
                                                    <li
                                                        key={item.key}
                                                        data-testid={`rp2-stop-order-item-${item.stop.id}`}
                                                        draggable
                                                        onDragStart={() => setDraggedStopOrderKey(item.key)}
                                                        onDragOver={(event) => event.preventDefault()}
                                                        onDrop={() => moveDraggedStopOrderItem(item.key)}
                                                        onDragEnd={() => setDraggedStopOrderKey(null)}
                                                onMouseEnter={() => setHoveredMapItem({ type: 'stop', id: item.stop.id })}
                                                onMouseLeave={() => setHoveredMapItem(null)}
                                                className={`cursor-grab rounded-2xl border p-2 active:cursor-grabbing ${selectedStopId === item.stop.id ? 'border-cyan-200 bg-cyan-50' : 'border-slate-200 bg-slate-50'}`}
                                                    >
                                                        {(() => {
                                                            const stopDetail = stopCardDetailsByStopId.get(item.stop.id);
                                                            const runtimeDetail = stopVisitRuntimeDetailsByKey.get(item.key);
                                                            const canEditRunningTime = Boolean(runtimeDetail?.segmentId && runtimeDetail.previousStopId);
                                                            const minimumRunningTime = Math.max(1, (runtimeDetail?.previousRunningRuntimeMinutes ?? 0) + 1);
                                                            return (
                                                        <>
                                                        <div className="flex items-start gap-2">
                                                            <button
                                                                type="button"
                                                                onClick={() => setSelectedStopId(item.stop.id)}
                                                                className="min-w-0 flex-1 text-left"
                                                            >
                                                                <span className="flex items-center gap-2">
                                                                    <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-white text-xs font-black text-slate-700">{item.stop.sequence}</span>
                                                                    <span className="min-w-0 truncate text-sm font-black text-slate-900">{item.stop.name}</span>
                                                                </span>
                                                                <span className="mt-1 block truncate pl-8 text-xs font-semibold text-slate-500">
                                                                    {stopRoleLabel(item.stop.role)}{item.stop.stopCode ? ` · Stop ${item.stop.stopCode}` : ''}
                                                                </span>
                                                                <span className="mt-2 grid grid-cols-2 gap-1 pl-8">
                                                                    <span className="rounded-xl border border-slate-200 bg-white px-2 py-1 text-[10px] font-black uppercase tracking-wide text-slate-600">
                                                                        Kids {stopDetail?.kidsAtStop ?? 0}
                                                                    </span>
                                                                    <span className="rounded-xl border border-slate-200 bg-white px-2 py-1 text-[10px] font-black uppercase tracking-wide text-slate-600">
                                                                        Kids total {stopDetail?.runningKidsTotal ?? 0}
                                                                    </span>
                                                                </span>
                                                                <span className="mt-2 grid gap-1 pl-8 sm:grid-cols-2">
                                                                    <span className="rounded-xl border border-cyan-100 bg-white px-2 py-1 text-[10px] font-black uppercase tracking-wide text-cyan-700">
                                                                        From previous {runtimeDetail?.segmentRuntimeLabel ?? 'Not estimated'}
                                                                    </span>
                                                                    <span className="rounded-xl border border-cyan-100 bg-white px-2 py-1 text-[10px] font-black uppercase tracking-wide text-cyan-700">
                                                                        Running time {runtimeDetail?.runningRuntimeLabel ?? 'Not estimated'}
                                                                    </span>
                                                                </span>
                                                                {runtimeDetail && (runtimeDetail.source || runtimeDetail.arrivalLabel !== 'Not set') && (
                                                                    <span className="mt-2 flex flex-wrap items-center gap-1 pl-8">
                                                                        {runtimeDetail.arrivalLabel !== 'Not set' && (
                                                                            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-slate-600">
                                                                                Arrival {runtimeDetail.arrivalLabel}
                                                                            </span>
                                                                        )}
                                                                        {runtimeDetail.source && (
                                                                            <span className={`rounded-full border px-2 py-0.5 text-[10px] font-black ${getRuntimeSourceBadgeClass(runtimeDetail.source)}`}>
                                                                                {runtimeSourceLabel(runtimeDetail.source)}
                                                                            </span>
                                                                        )}
                                                                    </span>
                                                                )}
                                                            </button>
                                                            <button
                                                                type="button"
                                                                onClick={() => deleteStop(item.stop.id)}
                                                                className="flex size-8 shrink-0 items-center justify-center rounded-full border border-red-200 bg-white text-red-600 hover:bg-red-50"
                                                                aria-label={`Delete ${item.stop.name}`}
                                                                title={`Delete ${item.stop.name}`}
                                                            >
                                                                <Trash2 size={14} />
                                                            </button>
                                                        </div>
                                                        {runtimeDetail && canEditRunningTime && (
                                                            <div className="mt-2 grid grid-cols-[1fr_auto] items-end gap-2 pl-8">
                                                                <label className="text-[10px] font-black uppercase tracking-wide text-slate-500">
                                                                    Edit running time
                                                                    <input
                                                                        type="number"
                                                                        min={minimumRunningTime}
                                                                        step="1"
                                                                        value={runtimeDetail.runningRuntimeMinutes ?? ''}
                                                                        onChange={(event) => updateStopOrderRunningTimeOverride(runtimeDetail, event.target.value)}
                                                                        onMouseDown={(event) => event.stopPropagation()}
                                                                        onClick={(event) => event.stopPropagation()}
                                                                        className="mt-1 w-full rounded-xl border border-cyan-100 bg-white px-2 py-1.5 text-sm font-black text-slate-900"
                                                                        aria-label={`Override running time to ${item.stop.name} in minutes`}
                                                                    />
                                                                </label>
                                                                <button
                                                                    type="button"
                                                                    onClick={() => runtimeDetail.segmentId && clearSegmentRuntimeOverride(runtimeDetail.segmentId)}
                                                                    disabled={runtimeDetail.source !== 'manual'}
                                                                    className="rounded-xl border border-slate-200 bg-white px-2 py-1.5 text-xs font-bold text-slate-600 disabled:opacity-40"
                                                                >
                                                                    Clear
                                                                </button>
                                                            </div>
                                                        )}
                                                        </>
                                                            );
                                                        })()}
                                                        <div className="mt-2 grid grid-cols-2 gap-2">
                                                            <button type="button" onClick={() => moveStopOrderItem(item, 'up')} className="rounded-xl border border-slate-200 bg-white px-2 py-1.5 text-xs font-bold text-slate-700">Move up</button>
                                                            <button type="button" onClick={() => moveStopOrderItem(item, 'down')} className="rounded-xl border border-slate-200 bg-white px-2 py-1.5 text-xs font-bold text-slate-700">Move down</button>
                                                        </div>
                                                    </li>
                                                ) : (
                                                    <li
                                                        key={item.key}
                                                        data-testid={`rp2-stop-order-item-${item.bend.id}`}
                                                        draggable
                                                        onDragStart={() => setDraggedStopOrderKey(item.key)}
                                                        onDragOver={(event) => event.preventDefault()}
                                                        onDrop={() => moveDraggedStopOrderItem(item.key)}
                                                        onDragEnd={() => setDraggedStopOrderKey(null)}
                                                        onMouseEnter={() => setHoveredMapItem({ type: 'waypoint', id: item.bend.id })}
                                                        onMouseLeave={() => setHoveredMapItem(null)}
                                                        className="cursor-grab rounded-2xl border border-cyan-100 bg-cyan-50/60 p-2 active:cursor-grabbing"
                                                    >
                                                        <div className="flex items-start gap-2">
                                                            <div className="flex size-6 shrink-0 items-center justify-center rounded-full bg-white text-xs font-black text-cyan-700">+</div>
                                                            <div className="min-w-0 flex-1">
                                                                <div className="truncate text-sm font-black text-slate-900">Bend {item.bendNumber}</div>
                                                                <div className="mt-1 truncate text-xs font-semibold text-slate-500">Between {item.fromStopName} and {item.toStopName}</div>
                                                            </div>
                                                            <button
                                                                type="button"
                                                                onClick={() => deleteLineWaypoint(item.bend.id)}
                                                                className="flex size-8 shrink-0 items-center justify-center rounded-full border border-red-200 bg-white text-red-600 hover:bg-red-50"
                                                                aria-label={`Delete Bend ${item.bendNumber}`}
                                                                title={`Delete Bend ${item.bendNumber}`}
                                                            >
                                                                <Trash2 size={14} />
                                                            </button>
                                                        </div>
                                                        <div className="mt-2 grid grid-cols-2 gap-2">
                                                            <button type="button" onClick={() => moveStopOrderItem(item, 'up')} className="rounded-xl border border-cyan-100 bg-white px-2 py-1.5 text-xs font-bold text-cyan-700">Move up</button>
                                                            <button type="button" onClick={() => moveStopOrderItem(item, 'down')} className="rounded-xl border border-cyan-100 bg-white px-2 py-1.5 text-xs font-bold text-cyan-700">Move down</button>
                                                        </div>
                                                    </li>
                                                ))}
                                            </ol>
                                        ) : (
                                            <p className="mt-3 text-sm leading-6 text-slate-500">Add stops from the map or address importer to build the order list.</p>
                                        )}
                                    </div>
                                    <details className="rounded-2xl border border-slate-200 bg-white p-3">
                                        <summary className="cursor-pointer text-sm font-black text-slate-900">Edit route inputs</summary>
                                        <div className="mt-3 space-y-4">
                                            <div className="rounded-2xl border border-slate-200 bg-white p-3">
                                                <h3 className="text-sm font-black text-slate-900">Service assumptions</h3>
                                                <div className="mt-3 grid grid-cols-2 gap-3">
                                            <label className="text-xs font-bold uppercase tracking-wide text-slate-500">First trip<input type="time" value={selectedScenario.service.firstTripTime} onChange={(event) => updateService({ firstTripTime: event.target.value })} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm" /></label>
                                            <label className="text-xs font-bold uppercase tracking-wide text-slate-500">Last trip<input type="time" value={selectedScenario.service.lastTripTime} onChange={(event) => updateService({ lastTripTime: event.target.value })} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm" /></label>
                                            <label className="text-xs font-bold uppercase tracking-wide text-slate-500">Frequency<input type="number" min="0" value={selectedScenario.service.frequencyMinutes} onChange={(event) => updateNumericServiceField('frequencyMinutes', event.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm" /></label>
                                            <label className="text-xs font-bold uppercase tracking-wide text-slate-500">Buses<input type="number" min="1" step="1" placeholder="Auto" value={selectedScenario.service.targetBuses ?? ''} onChange={(event) => updateOptionalNumericServiceField('targetBuses', event.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm" /></label>
                                            <label className="text-xs font-bold uppercase tracking-wide text-slate-500">Runtime day<select value={runtimeDayType} onChange={(event) => updateRuntimeDayType(event.target.value as DayType)} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm">{DAY_TYPES.map((day) => <option key={day.id} value={day.id}>{day.label}</option>)}</select></label>
                                            <label className="text-xs font-bold uppercase tracking-wide text-slate-500">Runtime period<select value={runtimePeriod} onChange={(event) => updateRuntimePeriod(event.target.value as TimePeriod)} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm">{TIME_PERIODS.map((period) => <option key={period.id} value={period.id}>{period.label}</option>)}</select></label>
                                            <label className="text-xs font-bold uppercase tracking-wide text-slate-500">Start layover<input type="number" value={selectedScenario.service.startTerminalLayoverMinutes} onChange={(event) => updateNumericServiceField('startTerminalLayoverMinutes', event.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm" /></label>
                                            <label className="text-xs font-bold uppercase tracking-wide text-slate-500">End layover<input type="number" value={selectedScenario.service.endTerminalLayoverMinutes} onChange={(event) => updateNumericServiceField('endTerminalLayoverMinutes', event.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm" /></label>
                                            <label className="text-xs font-bold uppercase tracking-wide text-slate-500">Dwell / stop sec<input type="number" min="0" value={selectedScenario.service.intermediateStopDwellSeconds ?? 0} onChange={(event) => updateNumericServiceField('intermediateStopDwellSeconds', event.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm" /></label>
                                                </div>
                                                <div data-testid="rp2-runtime-band-disclosure" className="mt-3 rounded-xl border border-cyan-100 bg-cyan-50 px-3 py-2 text-xs leading-5 text-cyan-900">
                                                    <span className="font-black">Runtime band in use:</span> {runtimeBandDisclosure}
                                                </div>
                                                <p className="mt-2 text-xs leading-5 text-slate-500">
                                                    GTFS imports fill first/last trip, frequency, buses, and scheduled runtimes by time band when the feed has enough schedule and block data. Leave buses blank to calculate it from runtime and frequency. Terminal layover stays separate.
                                                </p>
                                            </div>
                                            <label className="block text-xs font-bold uppercase tracking-wide text-slate-500" htmlFor="rp2-notes">
                                        Planner notes
                                        <textarea id="rp2-notes" value={selectedScenario.notes} onChange={(event) => setProject((current) => updateScenarioNotes(current, selectedScenario.id, event.target.value))} rows={5} className="mt-1 w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm text-slate-700" />
                                            </label>
                                            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                                        <div className="mb-3 flex items-center justify-between"><h3 className="text-sm font-black text-slate-900">Selected stop</h3><span className="rounded-full bg-white px-2 py-1 text-xs font-bold text-slate-500">{selectedScenario.stops.length} stops</span></div>
                                        {selectedStop ? (
                                            <div className="space-y-3">
                                                <label className="block text-xs font-bold uppercase tracking-wide text-slate-500" htmlFor="rp2-stop-name">Stop name<input id="rp2-stop-name" value={selectedStop.name} onChange={(event) => renameSelectedStop(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold" /></label>
                                                <label className="block text-xs font-bold uppercase tracking-wide text-slate-500" htmlFor="rp2-stop-role">Stop role<select id="rp2-stop-role" value={selectedStop.role} onChange={(event) => updateSelectedStopRole(event.target.value as RoutePlanner2StopRole)} className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold"><option value="regular">Regular stop</option><option value="timed">Timed stop</option><option value="start-terminal">Start terminal</option><option value="end-terminal">End terminal</option><option value="turnaround">Bus turnaround</option></select></label>
                                                <div className="grid grid-cols-3 gap-2">
                                                    <button type="button" onClick={() => selectedScenario && selectedStop && setProject((current) => moveRoutePlanner2Stop(current, selectedScenario.id, selectedStop.id, 'up'))} className="rounded-xl border bg-white px-2 py-2 text-xs font-bold">Up</button>
                                                    <button type="button" onClick={() => selectedScenario && selectedStop && setProject((current) => moveRoutePlanner2Stop(current, selectedScenario.id, selectedStop.id, 'down'))} className="rounded-xl border bg-white px-2 py-2 text-xs font-bold">Down</button>
                                                    <button type="button" onClick={deleteSelectedStop} className="rounded-xl border border-red-200 bg-white px-2 py-2 text-xs font-bold text-red-700">Remove</button>
                                                </div>
                                            </div>
                                        ) : <p className="text-sm leading-6 text-slate-500">Add a stop from the map canvas, then mark terminal roles here.</p>}
                                            </div>

                                        </div>
                                    </details>
                                    <div ref={runtimeSourceDetailsRef} data-testid="rp2-runtime-source-details" className="scroll-mt-24">
                                        <details className="rounded-2xl border border-slate-200 bg-white p-3">
                                            <summary className="cursor-pointer text-sm font-black text-slate-900">Advanced GTFS/source details</summary>
                                            <div className="mt-3 flex items-center justify-between gap-3">
                                            <h3 className="text-xs font-black uppercase tracking-wide text-slate-500">Runtime source summary</h3>
                                            <span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-black uppercase text-slate-500">
                                                {selectedFeasibility?.segmentSummaries.length ?? 0} {(selectedFeasibility?.segmentSummaries.length ?? 0) === 1 ? 'segment' : 'segments'}
                                            </span>
                                        </div>
                                        <p className="mt-2 text-xs leading-5 text-slate-500">Choose whether route runtime can use scheduled GTFS evidence or should stay with Mapbox/drawn-route estimates.</p>
                                        <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
                                            <h4 className="text-xs font-black uppercase tracking-wide text-slate-700">Runtime basis</h4>
                                            <div className="mt-3 grid gap-2 sm:grid-cols-2">
                                                <button
                                                    type="button"
                                                    onClick={() => updateRuntimeSourceMode('gtfs')}
                                                    className={`rounded-xl border p-3 text-left transition ${runtimeSourceMode === 'gtfs' ? 'border-emerald-300 bg-white shadow-sm' : 'border-slate-200 bg-white/70 hover:bg-white'}`}
                                                >
                                                    <span className="block text-sm font-black text-slate-900">GTFS route run time</span>
                                                    <span className="mt-1 block text-xs leading-5 text-slate-500">Use matching scheduled GTFS runtimes first. Mapbox fills gaps.</span>
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => updateRuntimeSourceMode('mapbox')}
                                                    className={`rounded-xl border p-3 text-left transition ${runtimeSourceMode === 'mapbox' ? 'border-cyan-300 bg-white shadow-sm' : 'border-slate-200 bg-white/70 hover:bg-white'}`}
                                                >
                                                    <span className="block text-sm font-black text-slate-900">Mapbox only</span>
                                                    <span className="mt-1 block text-xs leading-5 text-slate-500">Ignore GTFS runtime evidence and use the drawn route estimate.</span>
                                                </button>
                                            </div>
                                        </div>
                                        {runtimeSourceMode === 'mapbox' && (
                                            <p className="mt-2 rounded-xl border border-cyan-100 bg-cyan-50 px-3 py-2 text-xs font-semibold leading-5 text-cyan-800">
                                                GTFS route matching is off. Segment totals will use Mapbox estimates when available, then fallback assumptions.
                                            </p>
                                        )}
                                        {runtimeSourceMode === 'gtfs' && runtimeRouteOptions.length > 0 && (
                                            <div className="mt-3 rounded-xl border border-cyan-100 bg-cyan-50/60 p-3">
                                                <div className="flex items-start justify-between gap-3">
                                                    <div>
                                                        <h4 className="text-xs font-black uppercase tracking-wide text-cyan-900">GTFS route match</h4>
                                                        <p className="mt-1 text-xs leading-5 text-cyan-800">Use all matching scheduled routes, or limit corridor runtime to selected routes.</p>
                                                    </div>
                                                    <span className="shrink-0 rounded-full bg-white px-2 py-1 text-[10px] font-black uppercase text-cyan-700">
                                                        {runtimeRouteOptions.length} {runtimeRouteOptions.length === 1 ? 'route' : 'routes'}
                                                    </span>
                                                </div>
                                                <div className="mt-3 grid grid-cols-2 gap-2">
                                                    <button
                                                        type="button"
                                                        onClick={() => updateRuntimeRouteFilterMode('all-matching')}
                                                        className={`rounded-lg border px-3 py-2 text-xs font-black ${runtimeRouteFilterMode === 'all-matching' ? 'border-cyan-300 bg-white text-cyan-800 shadow-sm' : 'border-transparent bg-cyan-100 text-cyan-700'}`}
                                                    >
                                                        All matching
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => updateRuntimeRouteFilterMode('selected')}
                                                        className={`rounded-lg border px-3 py-2 text-xs font-black ${runtimeRouteFilterMode === 'selected' ? 'border-cyan-300 bg-white text-cyan-800 shadow-sm' : 'border-transparent bg-cyan-100 text-cyan-700'}`}
                                                    >
                                                        Selected routes
                                                    </button>
                                                </div>
                                                {runtimeRouteFilterMode === 'selected' && (
                                                    <div className="mt-3 flex flex-wrap gap-2">
                                                        {runtimeRouteOptions.map((route) => {
                                                            const isSelected = (runtimeSelectedRoutes.length > 0 ? runtimeSelectedRoutes : runtimeRouteOptions).includes(route);
                                                            return (
                                                                <button
                                                                    key={route}
                                                                    type="button"
                                                                    onClick={() => toggleRuntimeSelectedRoute(route)}
                                                                    className={`rounded-full border px-3 py-1.5 text-xs font-black ${isSelected ? 'border-cyan-300 bg-white text-cyan-800 shadow-sm' : 'border-cyan-100 bg-cyan-100 text-cyan-600'}`}
                                                                >
                                                                    Route {route}
                                                                </button>
                                                            );
                                                        })}
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                        {runtimeSourceSummaryItems.length > 0 ? (
                                            <div className="mt-3 space-y-2">
                                                {runtimeSourceSummaryItems.map((item) => (
                                                    <div key={item.key} className="flex items-center justify-between gap-3 rounded-xl bg-slate-50 px-3 py-2">
                                                        <span className={`rounded-full border px-2 py-1 text-[11px] font-black ${getRuntimeSourceBadgeClass(item.source)}`}>
                                                            {item.label}
                                                        </span>
                                                        <span className="shrink-0 text-xs font-bold text-slate-500">
                                                            {item.count} {item.count === 1 ? 'segment' : 'segments'}
                                                        </span>
                                                    </div>
                                                ))}
                                            </div>
                                        ) : (
                                            <p className="mt-2 text-sm leading-6 text-slate-500">Add at least two stops before runtime source coverage is available.</p>
                                        )}
                                        </details>
                                    </div>
                                    {selectedFeasibility && selectedFeasibility.segmentSummaries.length > 0 && (
                                        <details className="rounded-2xl border border-slate-200 bg-white p-3">
                                            <summary className="cursor-pointer text-sm font-black text-slate-900">
                                                Segment runtimes and overrides
                                                <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-600">
                                                    {selectedFeasibility.segmentSummaries.length}
                                                </span>
                                            </summary>
                                            <p className="mt-1 text-xs font-semibold text-slate-500">
                                                Stop order shows the working running time. Open this only to inspect sources or override a segment.
                                            </p>
                                            <div className="mt-3 space-y-2">
                                                {selectedFeasibility.segmentSummaries.map((segment) => {
                                                    const fromStop = selectedScenario.stops.find((stop) => stop.id === segment.fromStopId);
                                                    const toStop = selectedScenario.stops.find((stop) => stop.id === segment.toStopId);
                                                    const originalEstimate = getOriginalRuntimeEstimate(selectedScenario, segment);
                                                    const scheduledGapMessage = getScheduledGapMessage(segment, selectedScenario, runtimeDayType, runtimePeriod);
                                                    const runtimeRouteBreakdown = segment.runtimeRouteBreakdown ?? [];
                                                    const routeBreakdownNote = getRuntimeRouteBreakdownNote(
                                                        segment,
                                                        selectedScenario.runtimeRouteFilter?.mode === 'selected',
                                                    );
                                                    return (
                                                        <div
                                                            key={segment.id}
                                                            data-testid={`rp2-segment-runtime-card-${segment.id}`}
                                                            onMouseEnter={() => setHoveredMapItem({ type: 'segment', id: segment.id })}
                                                            onMouseLeave={() => setHoveredMapItem(null)}
                                                            className="rounded-xl border border-transparent bg-slate-50 p-2 text-xs text-slate-600 transition hover:border-cyan-200 hover:bg-cyan-50/60"
                                                        >
                                                            <div className="flex flex-wrap items-center justify-between gap-2">
                                                                <div className="font-bold text-slate-800">{fromStop?.name ?? 'Unknown'} to {toStop?.name ?? 'Unknown'}: {formatRuntime(segment.runtimeMinutes)}</div>
                                                                <span className={`rounded-full border px-2 py-1 text-[11px] font-black ${getRuntimeSourceBadgeClass(segment.source)}`}>
                                                                    {getSegmentSourceBadgeText(segment, runtimeDayType, runtimePeriod)}
                                                                </span>
                                                            </div>
                                                            <div className="mt-1 text-[11px] font-semibold text-slate-500">
                                                    {segment.evidenceMethod === 'shape-overlap'
                                                        ? 'GTFS shape match'
                                                        : segment.evidenceMethod === 'corridor-path'
                                                            ? 'GTFS corridor'
                                                            : runtimeSourceLabel(segment.source)}
                                                                {segment.matchedRoutes && segment.matchedRoutes.length > 0 && <> · {formatRouteSource(segment.matchedRoutes)}</>}
                                                            </div>
                                                            {routeBreakdownNote && (
                                                                <div className="mt-2 rounded-lg border border-emerald-100 bg-white p-2 text-[11px] text-slate-700">
                                                                    <div className="font-black text-emerald-800">{routeBreakdownNote}</div>
                                                                    <div className="mt-1 space-y-1">
                                                                        {runtimeRouteBreakdown.map((route) => (
                                                                            <div key={route.routeShortName} className="flex items-center justify-between gap-3">
                                                                                <span className="font-semibold">Route {route.routeShortName}</span>
                                                                                <span className="font-black text-slate-900">{formatRuntime(route.scheduledRuntimeMinutes)}</span>
                                                                            </div>
                                                                        ))}
                                                                    </div>
                                                                </div>
                                                            )}
                                                            {segment.source === 'partial-scheduled-proxy' && (
                                                                <div className="mt-2 rounded-lg border border-lime-100 bg-white p-2 text-[11px] font-semibold text-lime-800">
                                                                    Scheduled GTFS covers {segment.scheduledCoverageRatio != null ? `${Math.round(segment.scheduledCoverageRatio * 100)}%` : 'part'} of this segment
                                                                    {segment.estimatedUncoveredDistanceKm != null && <>; the remaining {segment.estimatedUncoveredDistanceKm} km uses the drawn-route estimate.</>}
                                                                </div>
                                                            )}
                                                            <div className="mt-2 flex items-end gap-2">
                                                                <label className="min-w-0 flex-1 font-bold uppercase tracking-wide text-slate-500">
                                                                    Override min
                                                                    <input
                                                                        type="number"
                                                                        min="1"
                                                                        step="1"
                                                                        value={segment.source === 'manual' ? segment.runtimeMinutes ?? '' : ''}
                                                                        placeholder={segment.runtimeMinutes != null ? String(segment.runtimeMinutes) : 'Min'}
                                                                        onChange={(event) => updateSegmentRuntimeOverride(segment.id, event.target.value)}
                                                                        className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2 py-1 text-sm font-bold text-slate-900"
                                                                        aria-label={`Override runtime for ${fromStop?.name ?? 'segment'} to ${toStop?.name ?? 'segment'}`}
                                                                    />
                                                                </label>
                                                                <button
                                                                    type="button"
                                                                    onClick={() => clearSegmentRuntimeOverride(segment.id)}
                                                                    disabled={segment.source !== 'manual'}
                                                                    className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-bold text-slate-600 disabled:opacity-40"
                                                                >
                                                                    Clear
                                                                </button>
                                                            </div>
                                                            {segment.source === 'mapbox' && (
                                                                <div className="mt-1 text-[11px] font-semibold text-cyan-700">Mapbox planning estimate</div>
                                                            )}
                                                            {segment.source === 'manual' && (
                                                                <div className="mt-1 text-[11px] font-semibold text-emerald-700">Planner override</div>
                                                            )}
                                                            {originalEstimate && (
                                                                <div className="mt-1 text-[11px] font-semibold text-indigo-700">
                                                                    Original: {getSegmentSourceBadgeText(originalEstimate, runtimeDayType, runtimePeriod)} · {formatRuntime(originalEstimate.runtimeMinutes)}
                                                                </div>
                                                            )}
                                                            {scheduledGapMessage && (
                                                                <div className="mt-1 text-[11px] font-semibold text-amber-700">{scheduledGapMessage}</div>
                                                            )}
                                                            {segment.fallbackReason && (
                                                                <div className="mt-1 text-[11px] font-semibold text-amber-700">{segment.fallbackReason}</div>
                                                            )}
                                                            <details className="mt-2 rounded-lg border border-slate-200 bg-white px-2 py-1">
                                                                <summary className="cursor-pointer text-[11px] font-black text-slate-500">Advanced segment details</summary>
                                                                <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-slate-600">
                                                                    <span>{runtimeSourceLabel(segment.source)} / {segment.confidence}</span>
                                                                    {segment.distanceKm != null && <span>{segment.distanceKm.toFixed(2)} km</span>}
                                                                    {segment.sampleSize != null && <span>{segment.sampleSize} samples</span>}
                                                                    {segment.scheduledRuntimeMinutes != null && <span>Scheduled {segment.scheduledRuntimeMinutes} min</span>}
                                                                    {segment.observedRuntimeMinutes != null && <span>Observed {segment.observedRuntimeMinutes} min</span>}
                                                                    {segment.matchQuality && <span>Match: {segment.matchQuality}</span>}
                                                                </div>
                                                            </details>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </details>
                                    )}
                                    <div className="grid grid-cols-2 gap-2">
                                        <button type="button" onClick={() => setProject((current) => markRoutePlanner2PreferredScenario(current, selectedScenario.id))} className="inline-flex items-center justify-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-bold text-emerald-700"><Star size={16} />Mark preferred</button>
                                    <button type="button" onClick={deleteSelectedRouteConcept} disabled={project.scenarios.length <= 1} className="inline-flex items-center justify-center gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm font-bold text-red-700 disabled:opacity-50"><Trash2 size={16} />Delete</button>
                                    </div>
                                </div>
                            ) : <p className="mt-3 text-sm text-slate-500">Select a route to edit details.</p>}
                        </section>
                        <details className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
                            <summary className="cursor-pointer text-sm font-black text-slate-900">Route comparison</summary>
                            <div className={`mt-3 rounded-2xl border p-3 ${readinessClass(projectSummary.preferredScenarioSummary?.readiness ?? 'not-ready')}`}>
                                <div className="flex items-center justify-between gap-2">
                                    <h3 className="text-sm font-black">Preferred route summary</h3>
                                    {projectSummary.preferredScenarioSummary && <span className="rounded-full bg-white/80 px-2 py-1 text-xs font-black uppercase">{projectSummary.preferredScenarioSummary.readinessLabel}</span>}
                                </div>
                                {projectSummary.preferredScenarioSummary ? (
                                    <div>
                                        <p className="mt-2 text-sm leading-6">{projectSummary.preferredScenarioSummary.summaryText}</p>
                                        <p className="mt-2 text-xs font-bold">Next: {projectSummary.preferredScenarioSummary.nextAction}</p>
                                    </div>
                                ) : <p className="mt-2 text-sm leading-6">No preferred route yet. Build a route with terminals and feasibility outputs, then mark it preferred.</p>}
                            </div>
                            <div className="mt-3 overflow-x-auto rounded-2xl border border-slate-200">
                                <table className="w-full min-w-[520px] text-left text-xs">
                                    <thead className="bg-slate-50 text-slate-500">
                                        <tr><th className="px-3 py-2 font-bold">Route</th><th className="px-3 py-2 font-bold">Stops</th><th className="px-3 py-2 font-bold">Runtime</th><th className="px-3 py-2 font-bold">Cycle</th><th className="px-3 py-2 font-bold">Buses</th><th className="px-3 py-2 font-bold">State</th><th className="px-3 py-2 font-bold">Warnings</th></tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100 bg-white">
                                        {projectSummary.scenarioSummaries.map((summary) => (
                                            <tr key={summary.scenarioId} className={summary.scenarioId === project.selectedScenarioId ? 'bg-cyan-50/50' : undefined}>
                                                <td className="px-3 py-2 font-semibold text-slate-800">{summary.scenarioName}{summary.isPreferred ? ' (preferred)' : ''}</td>
                                                <td className="px-3 py-2 text-slate-600">{summary.stopsLabel}</td>
                                                <td className="px-3 py-2 text-slate-600">{summary.oneWayRuntimeLabel}</td>
                                                <td className="px-3 py-2 text-slate-600">{summary.cycleTimeLabel}</td>
                                                <td className="px-3 py-2 text-slate-600">{summary.busesRequiredLabel}</td>
                                                <td className="px-3 py-2 text-slate-600">{summary.readinessLabel}</td>
                                                <td className="px-3 py-2 text-slate-600">{summary.warningCount}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                            {projectSummary.routeFamilySummaries.length > 0 && (
                                <div className="mt-4 overflow-x-auto rounded-2xl border border-cyan-200">
                                    <table className="w-full min-w-[560px] text-left text-xs">
                                        <thead className="bg-cyan-50 text-cyan-800">
                                            <tr><th className="px-3 py-2 font-bold">Family</th><th className="px-3 py-2 font-bold">Directions</th><th className="px-3 py-2 font-bold">Runtime</th><th className="px-3 py-2 font-bold">Cycle</th><th className="px-3 py-2 font-bold">Recovery</th><th className="px-3 py-2 font-bold">Buses</th></tr>
                                        </thead>
                                        <tbody className="divide-y divide-cyan-100 bg-white">
                                            {projectSummary.routeFamilySummaries.map((summary) => (
                                                <tr key={summary.key} className={summary.scenarioIds.includes(project.selectedScenarioId) ? 'bg-cyan-50/50' : undefined}>
                                                    <td className="px-3 py-2 font-semibold text-slate-800">{summary.familyName}</td>
                                                    <td className="px-3 py-2 text-slate-600">{summary.directionLabels.join(' + ')}</td>
                                                    <td className="px-3 py-2 text-slate-600">{summary.runtimeLabel}</td>
                                                    <td className="px-3 py-2 text-slate-600">{summary.cycleTimeLabel}</td>
                                                    <td className="px-3 py-2 text-slate-600">{summary.recoveryLabel}</td>
                                                    <td className="px-3 py-2 text-slate-600">{summary.busesRequiredLabel}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </details>
                            </>
                        ) : (
                            <>
                                <button
                                    type="button"
                                    onClick={() => setIsRightRailOpen(true)}
                                    className="flex items-center justify-center rounded-2xl border border-slate-200 bg-white px-2 py-2 text-xs font-black text-slate-700 hover:bg-slate-50"
                                    aria-expanded={false}
                                    aria-label="Expand review route panel"
                                    title="Expand review route panel"
                                >
                                    <span aria-hidden="true">‹</span>
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setIsRightRailOpen(true)}
                                    className="inline-flex min-h-10 w-full items-center justify-center rounded-2xl border border-cyan-200 bg-cyan-50 px-2.5 py-2 text-xs font-bold text-cyan-800"
                                    title="Review route"
                                >
                                    <ClipboardList size={16} /><span className="sr-only">Review route</span>
                                </button>
                                <button
                                    type="button"
                                    onClick={() => void saveCurrentProject()}
                                    disabled={!canUseTeamSave || saveState === 'saving'}
                                    className="inline-flex min-h-10 w-full items-center justify-center rounded-2xl border border-emerald-200 bg-emerald-50 px-2.5 py-2 text-xs font-bold text-emerald-800 disabled:cursor-not-allowed disabled:opacity-50"
                                    title={canUseTeamSave ? 'Save this route plan' : 'Sign in with a team workspace to save'}
                                >
                                    <Save size={16} /><span className="sr-only">Save</span>
                                </button>
                                <button
                                    type="button"
                                    onClick={enterDrawFocusMode}
                                    className="inline-flex min-h-10 w-full items-center justify-center rounded-2xl border border-slate-200 bg-white px-2.5 py-2 text-xs font-bold text-slate-700"
                                    title="Draw route"
                                >
                                    <PencilRuler size={16} /><span className="sr-only">Draw route</span>
                                </button>
                            </>
                        )}
                    </aside>
                </main>
            {isLoadPickerOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4">
                    <section
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="rp2-load-picker-title"
                        className="w-full max-w-xl rounded-3xl border border-slate-200 bg-white p-5 shadow-2xl"
                    >
                        <div className="flex items-start justify-between gap-4">
                            <div>
                                <div className="text-[10px] font-black uppercase tracking-[0.18em] text-cyan-700">Route Planner 2</div>
                                <h2 id="rp2-load-picker-title" className="mt-1 text-lg font-black text-slate-950">Load route plan</h2>
                                <p className="mt-1 text-sm font-semibold text-slate-500">Choose a saved route plan from this team workspace.</p>
                            </div>
                            <button
                                type="button"
                                onClick={() => setIsLoadPickerOpen(false)}
                                className="inline-flex size-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                                aria-label="Close load route plan picker"
                                title="Close"
                            >
                                ×
                            </button>
                        </div>
                        <div className="mt-4">
                            {isLoadingSavedProjects ? (
                                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm font-bold text-slate-600">Loading saved route plans...</div>
                            ) : savedProjectsLoadFailed ? (
                                <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
                                    <div className="text-sm font-black text-amber-900">Saved route plans unavailable</div>
                                    <p className="mt-1 text-sm font-semibold text-amber-800">Try refreshing the list.</p>
                                    <button
                                        type="button"
                                        onClick={() => void refreshSavedProjects()}
                                        className="mt-3 rounded-xl border border-amber-200 bg-white px-3 py-2 text-xs font-black text-amber-800 hover:bg-amber-100"
                                    >
                                        Refresh
                                    </button>
                                </div>
                            ) : savedProjects.length === 0 ? (
                                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm font-semibold text-slate-600">No saved route plans yet.</div>
                            ) : (
                                <div className="max-h-[60vh] space-y-2 overflow-y-auto pr-1">
                                    {savedProjects.map((savedProject) => (
                                        <button
                                            key={savedProject.id}
                                            type="button"
                                            onClick={() => void loadSavedProject(savedProject.id)}
                                            disabled={loadState === 'loading'}
                                            className="w-full rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:border-cyan-200 hover:bg-cyan-50 disabled:cursor-not-allowed disabled:opacity-50"
                                        >
                                            <div className="flex items-start justify-between gap-3">
                                                <div className="min-w-0">
                                                    <div className="truncate text-sm font-black text-slate-950">{savedProject.name}</div>
                                                    <div className="mt-1 text-xs font-semibold text-slate-500">{formatSavedProjectLabel(savedProject)}</div>
                                                </div>
                                                <span className="shrink-0 rounded-full bg-slate-100 px-2 py-1 text-[10px] font-black uppercase text-slate-600">
                                                    {savedProject.scenarioCount === 1 ? '1 route' : `${savedProject.scenarioCount} routes`}
                                                </span>
                                            </div>
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                    </section>
                </div>
            )}
            <RoutePlanner2GtfsImportModal
                open={isGtfsImportOpen}
                presentation="map-drawer"
                patterns={gtfsPatterns}
                loading={gtfsLoading}
                error={gtfsError}
                onClose={() => setIsGtfsImportOpen(false)}
                onImport={importGtfsPatterns}
                onRetry={() => void loadGtfsPatterns({ forceRefresh: true })}
            />
            <RoutePlanner2AddressImportModal
                open={isAddressImportOpen}
                presentation="map-drawer"
                onClose={() => setIsAddressImportOpen(false)}
                onImport={importAddressStops}
            />
        </div>
    );
};
