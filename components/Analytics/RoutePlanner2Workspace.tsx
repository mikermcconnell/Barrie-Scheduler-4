import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Copy, Download, FileSpreadsheet, Plus, Route, Save, Star, Trash2 } from 'lucide-react';

import {
    addRoutePlanner2LineWaypoint,
    addRoutePlanner2Stop,
    addRoutePlanner2Stops,
    clearRoutePlanner2SegmentRuntimeOverride,
    deleteRoutePlanner2LineWaypoint,
    deleteRoutePlanner2Stop,
    insertRoutePlanner2StopBetween,
    moveRoutePlanner2Stop,
    reassignRoutePlanner2StopRange,
    renameRoutePlanner2Stop,
    setRoutePlanner2SegmentRuntimeOverride,
    updateRoutePlanner2RouteShape,
    updateRoutePlanner2LineWaypointCoordinate,
    updateRoutePlanner2SegmentRuntimeEstimates,
    updateRoutePlanner2StopCoordinate,
    updateRoutePlanner2StopRole,
} from '../../utils/route-planner-2/routePlanner2Authoring';
import { updateRoutePlanner2Service } from '../../utils/route-planner-2/routePlanner2Feasibility';
import {
    addRoutePlanner2Scenario,
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
import { loadRoutePlanner2GtfsImportPatterns } from '../../utils/route-planner-2/routePlanner2GtfsClient';
import {
    createRoutePlanner2ScenarioFromGtfsPattern,
    type RoutePlanner2GtfsImportPattern,
} from '../../utils/route-planner-2/routePlanner2GtfsImport';
import { summarizeRoutePlanner2Project } from '../../utils/route-planner-2/routePlanner2Summary';
import { usePerformanceDataQuery, usePerformanceMetadataQuery } from '../../hooks/usePerformanceData';
import { buildCorridorSpeedIndex } from '../../utils/gtfs/corridorSpeed';
import { DAY_TYPES, TIME_PERIODS, type DayType, type TimePeriod } from '../../utils/gtfs/corridorHeadway';
import {
    deriveRoutePlanner2EvidenceRuntimeEstimates,
    type RoutePlanner2RuntimeEvidenceDiagnostic,
} from '../../utils/route-planner-2/routePlanner2RuntimeEvidence';
import { RoutePlanner2MapCanvas } from './route-planner-2/RoutePlanner2MapCanvas';
import { RoutePlanner2GtfsImportModal } from './route-planner-2/RoutePlanner2GtfsImportModal';
import {
    RoutePlanner2AddressImportModal,
} from './route-planner-2/RoutePlanner2AddressImportModal';
import type { RoutePlanner2GeocodedAddressStop } from '../../utils/route-planner-2/routePlanner2AddressImport';
import type {
    RoutePlanner2Project,
    RoutePlanner2RouteShape,
    RoutePlanner2RuntimeRouteFilterMode,
    RoutePlanner2SegmentRuntime,
    RoutePlanner2ServiceAssumptions,
    RoutePlanner2StopRole,
} from '../../utils/route-planner-2/routePlanner2Types';

interface RoutePlanner2WorkspaceProps {
    onBack: () => void;
    userId?: string | null;
    teamId?: string | null;
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

function formatCampServiceSpan(service: RoutePlanner2ServiceAssumptions | null | undefined): string {
    if (!service?.firstTripTime || !service?.lastTripTime) return 'Set service span';
    return `${service.firstTripTime}-${service.lastTripTime}`;
}

function formatCampFrequency(service: RoutePlanner2ServiceAssumptions | null | undefined): string {
    return service?.frequencyMinutes ? `Every ${service.frequencyMinutes} min` : 'Set frequency';
}

function stopRoleLabel(role: RoutePlanner2StopRole): string {
    if (role === 'start-terminal') return 'Start terminal';
    if (role === 'end-terminal') return 'End terminal';
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

function getRuntimeSourceDetail(
    feasibility: RoutePlanner2Project['scenarios'][number]['feasibility'] | null | undefined,
): string {
    const segments = feasibility?.segmentSummaries ?? [];
    if (segments.length === 0) return 'Source not ready';

    const sources = [...new Set(segments.map((segment) => segment.source))];
    const sourceLabel = sources.length === 1 ? conciseRuntimeSourceLabel(sources[0]!) : 'Mixed sources';
    const matchedRoutes = segments.flatMap((segment) => segment.matchedRoutes ?? []);
    const routeLabel = formatRouteSource(matchedRoutes);

    return routeLabel ? `${sourceLabel} · ${routeLabel}` : sourceLabel;
}

function getRuntimePeriodDetail(dayType: DayType, period: TimePeriod): string {
    const dayLabel = DAY_TYPES.find((day) => day.id === dayType)?.label ?? dayType;
    const periodLabel = TIME_PERIODS.find((item) => item.id === period)?.label ?? period;
    return `${dayLabel} · ${periodLabel}`;
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

export const RoutePlanner2Workspace: React.FC<RoutePlanner2WorkspaceProps> = ({ onBack, teamId }) => {
    const [project, setProject] = useState<RoutePlanner2Project>(() => createRoutePlanner2Project());
    const [selectedStopId, setSelectedStopId] = useState<string | null>(null);
    const [isRightRailOpen, setIsRightRailOpen] = useState(false);
    const runtimeSourceDetailsRef = useRef<HTMLDivElement | null>(null);
    const [isDrawFocusMode, setIsDrawFocusMode] = useState(false);
    const [isCampShuttleFocusMode, setIsCampShuttleFocusMode] = useState(false);
    const [isExportingOperatorPdf, setIsExportingOperatorPdf] = useState(false);
    const [isGtfsImportOpen, setIsGtfsImportOpen] = useState(false);
    const [isAddressImportOpen, setIsAddressImportOpen] = useState(false);
    const [gtfsPatterns, setGtfsPatterns] = useState<RoutePlanner2GtfsImportPattern[]>([]);
    const [gtfsLoading, setGtfsLoading] = useState(false);
    const [gtfsError, setGtfsError] = useState<string | null>(null);
    const [transferFromSequence, setTransferFromSequence] = useState(1);
    const [transferToSequence, setTransferToSequence] = useState(1);
    const [transferTargetScenarioId, setTransferTargetScenarioId] = useState('');
    const [transferInsertAfterStopId, setTransferInsertAfterStopId] = useState('__end');
    const [runtimeDayType, setRuntimeDayType] = useState<DayType>('weekday');
    const [runtimePeriod, setRuntimePeriod] = useState<TimePeriod>('full-day');
    const [runtimeAvailableRoutesByScenario, setRuntimeAvailableRoutesByScenario] = useState<Record<string, string[]>>({});

    const projectSummary = useMemo(() => summarizeRoutePlanner2Project(project), [project]);
    const selectedScenario = useMemo(
        () => project.scenarios.find((scenario) => scenario.id === project.selectedScenarioId) ?? project.scenarios[0],
        [project.scenarios, project.selectedScenarioId],
    );
    const selectedScenarioSummary = projectSummary.selectedScenarioSummary;
    const selectedFeasibility = selectedScenarioSummary?.feasibility ?? null;
    const runtimeMatchedRoutes = useMemo(
        () => [...new Set((selectedFeasibility?.segmentSummaries ?? [])
            .flatMap((segment) => segment.matchedRoutes ?? [])
            .filter(Boolean))]
            .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })),
        [selectedFeasibility?.segmentSummaries],
    );
    const runtimeRouteFilterMode = selectedScenario?.runtimeRouteFilter?.mode ?? 'all-matching';
    const runtimeSelectedRoutes = selectedScenario?.runtimeRouteFilter?.routeShortNames ?? [];
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
    const metadataQuery = usePerformanceMetadataQuery(teamId ?? undefined);
    const hasPerformanceData = Boolean(metadataQuery.data);
    const dataQuery = usePerformanceDataQuery(teamId ?? undefined, hasPerformanceData, metadataQuery.data);
    const speedIndex = useMemo(
        () => buildCorridorSpeedIndex(dataQuery.data?.dailySummaries ?? []),
        [dataQuery.data],
    );

    useEffect(() => {
        if (!selectedScenario) {
            setSelectedStopId(null);
            return;
        }
        if (selectedStopId && selectedScenario.stops.some((stop) => stop.id === selectedStopId)) return;
        setSelectedStopId(selectedScenario.stops[0]?.id ?? null);
    }, [selectedScenario, selectedStopId]);

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
        const selectedSequence = selectedStop?.sequence ?? selectedScenarioStops[0]?.sequence ?? 1;
        setTransferFromSequence(selectedSequence);
        setTransferToSequence(selectedSequence);
    }, [selectedScenario?.id, selectedStop?.id, selectedStop?.sequence, selectedScenarioStops]);

    useEffect(() => {
        const validTarget = transferTargetOptions.some((scenario) => scenario.id === transferTargetScenarioId);
        if (!validTarget) {
            setTransferTargetScenarioId(transferTargetOptions[0]?.id ?? '');
            setTransferInsertAfterStopId('__end');
        }
    }, [transferTargetOptions, transferTargetScenarioId]);

    useEffect(() => {
        if (!selectedScenario) return;
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
        }));
    }, [
        runtimeDayType,
        runtimePeriod,
        selectedScenario?.id,
        selectedScenario?.stops,
        selectedScenario?.alignment,
        selectedScenario?.routeShape,
        selectedScenario?.turnaroundStopId,
        selectedScenario?.service.planningPeriod,
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

    function setTurnaroundStop(stopId: string) {
        updateRouteShape('out-and-back', stopId);
        setSelectedStopId(stopId);
    }

    function deleteStop(stopId: string) {
        if (!selectedScenario) return;
        const remainingStops = selectedScenario.stops.filter((stop) => stop.id !== stopId);

        setProject((current) => deleteRoutePlanner2Stop(current, selectedScenario.id, stopId));

        if (selectedStopId === stopId) {
            setSelectedStopId(remainingStops[0]?.id ?? null);
        }
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
        coordinate: { lat: number; lng: number };
    }) {
        if (!selectedScenario) return;
        setProject((current) => addRoutePlanner2LineWaypoint(current, selectedScenario.id, {
            afterStopId: placement.fromStopId,
            beforeStopId: placement.toStopId,
            insertAfterWaypointId: placement.insertAfterWaypointId,
            insertBeforeWaypointId: placement.insertBeforeWaypointId,
            ...placement.coordinate,
        }));
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

    function applyStopTransfer(mode: 'copy' | 'move') {
        if (!selectedScenario || !transferTargetScenarioId) return;
        const targetStops = transferTargetStops;
        const insertAfterStopId = transferInsertAfterStopId === '__start'
            ? null
            : transferInsertAfterStopId === '__end'
                ? targetStops[targetStops.length - 1]?.id ?? null
                : transferInsertAfterStopId;

        setProject((current) => {
            const updated = reassignRoutePlanner2StopRange(current, {
                sourceScenarioId: selectedScenario.id,
                targetScenarioId: transferTargetScenarioId,
                fromSequence: transferFromSequence,
                toSequence: transferToSequence,
                insertAfterStopId,
                mode,
            });
            return selectRoutePlanner2Scenario(updated, transferTargetScenarioId);
        });
        setSelectedStopId(null);
        setIsRightRailOpen(true);
    }

    function deleteLineWaypoint(waypointId: string) {
        if (!selectedScenario) return;
        setProject((current) => deleteRoutePlanner2LineWaypoint(current, selectedScenario.id, waypointId));
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

    function clearSegmentRuntimeOverride(segmentId: string) {
        if (!selectedScenario) return;
        setProject((current) => clearRoutePlanner2SegmentRuntimeOverride(current, selectedScenario.id, segmentId));
    }

    const selectedScenarioId = selectedScenario?.id;
    const updateSegmentRuntimeEstimates = useCallback((estimates: RoutePlanner2SegmentRuntime[]) => {
        if (!selectedScenarioId || estimates.length === 0) return;
        setProject((current) => updateRoutePlanner2SegmentRuntimeEstimates(current, selectedScenarioId, estimates));
    }, [selectedScenarioId]);


    async function loadGtfsPatterns() {
        setGtfsLoading(true);
        setGtfsError(null);
        try {
            const patterns = await loadRoutePlanner2GtfsImportPatterns();
            setGtfsPatterns(patterns);
        } catch (error) {
            setGtfsError(error instanceof Error ? error.message : 'GTFS routes could not be loaded.');
        } finally {
            setGtfsLoading(false);
        }
    }

    function openGtfsImport() {
        setIsGtfsImportOpen(true);
        if (gtfsPatterns.length === 0 && !gtfsLoading) void loadGtfsPatterns();
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
        setIsRightRailOpen(true);
        setIsDrawFocusMode(false);
        setIsCampShuttleFocusMode(false);
        setIsGtfsImportOpen(false);
    }

    function importAddressStops(stops: RoutePlanner2GeocodedAddressStop[]) {
        if (!selectedScenario || stops.length === 0) return;
        const batchId = Date.now();
        const importedStops = stops.map((stop, index) => ({
            id: `stop-address-${batchId}-${index + 1}`,
            name: stop.name,
            lat: stop.lat,
            lng: stop.lng,
            notes: stop.notes,
        }));

        setProject((current) => addRoutePlanner2Stops(current, selectedScenario.id, { stops: importedStops }));
        setSelectedStopId(importedStops[0]?.id ?? null);
        setIsRightRailOpen(true);
        setIsDrawFocusMode(false);
        setIsCampShuttleFocusMode(false);
        setIsAddressImportOpen(false);
    }

    function enterDrawFocusMode() {
        setIsDrawFocusMode(true);
        setIsCampShuttleFocusMode(false);
        setIsRightRailOpen(false);
    }

    function exitDrawFocusMode() {
        setIsDrawFocusMode(false);
        setIsRightRailOpen(true);
    }

    function enterCampShuttleFocusMode() {
        setIsCampShuttleFocusMode(true);
        setIsDrawFocusMode(false);
        setIsRightRailOpen(false);
    }

    function exitCampShuttleFocusMode() {
        setIsCampShuttleFocusMode(false);
    }

    function toggleRightRail() {
        setIsDrawFocusMode(false);
        setIsCampShuttleFocusMode(false);
        setIsRightRailOpen((current) => !current);
    }

    function openRuntimeSourceDetails() {
        setIsDrawFocusMode(false);
        setIsCampShuttleFocusMode(false);
        setIsRightRailOpen(true);
        const scrollToRuntimeDetails = () => runtimeSourceDetailsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
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

    const mapMetricItems = [
        {
            label: 'Runtime',
            value: formatRuntime(selectedFeasibility?.oneWayRuntimeMinutes),
            detail: `Data source: ${getRuntimeSourceDetail(selectedFeasibility)}`,
            description: `Runtime source and selected time window: ${getRuntimePeriodDetail(runtimeDayType, runtimePeriod)}. Click to review segment-level source details.`,
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

    const visibleRightRailOpen = isRightRailOpen && !isCampShuttleFocusMode;
    const rightRailState = visibleRightRailOpen ? 'open' : 'closed';
    const focusMode = isCampShuttleFocusMode ? 'camp-shuttle' : isDrawFocusMode ? 'draw' : 'standard';
    const campStops = selectedScenario?.stops.slice().sort((a, b) => a.sequence - b.sequence) ?? [];
    const mapOverlayInsets = {
        left: '2rem',
        right: isCampShuttleFocusMode ? '27.5rem' : visibleRightRailOpen ? '26.5rem' : '8rem',
    };

    return (
        <div className="h-full overflow-hidden bg-slate-100">
            <div className="flex h-full flex-col">
                <header className="shrink-0 border-b border-slate-200 bg-white px-4 py-2 shadow-sm sm:px-5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex min-w-0 items-center gap-2">
                            <button type="button" onClick={onBack} aria-label="Back to Planning Data" className="rounded-xl border border-slate-200 p-1.5">
                                <ArrowLeft size={18} />
                            </button>
                            <div className="min-w-0">
                                <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.18em] text-cyan-700">
                                    <Route size={18} />
                                    Route Planner
                                </div>
                                <input
                                    value={project.name}
                                    onChange={(event) => setProject((current) => renameRoutePlanner2Project(current, event.target.value))}
                                    aria-label="Project name"
                                    className="mt-0.5 w-full max-w-xl rounded-xl border border-transparent bg-transparent text-xl font-black text-slate-900"
                                />
                            </div>
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5">
                            <span className="rounded-full bg-cyan-50 px-3 py-1 text-xs font-bold text-cyan-700">Fresh workspace</span>
                            <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700">Local draft</span>
                            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">Team: {teamId ?? 'not set'}</span>
                            <button type="button" disabled className="inline-flex items-center gap-1.5 rounded-xl border px-2.5 py-1 text-xs font-bold opacity-60"><Save size={14} />Save later</button>
                            <button type="button" onClick={() => selectedScenario && setProject((current) => duplicateRoutePlanner2Scenario(current, selectedScenario.id))} className="inline-flex items-center gap-1.5 rounded-xl border px-2.5 py-1 text-xs font-bold"><Copy size={14} />Duplicate</button>
                            <button
                                type="button"
                                onClick={openGtfsImport}
                                className="inline-flex items-center gap-1.5 rounded-xl border border-cyan-200 bg-cyan-50 px-2.5 py-1 text-xs font-bold text-cyan-800"
                            >
                                <Route size={14} />Import GTFS
                            </button>
                            <button
                                type="button"
                                onClick={() => setIsAddressImportOpen(true)}
                                className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-800"
                            >
                                <FileSpreadsheet size={14} />Import addresses
                            </button>
                            <button
                                type="button"
                                onClick={exportOperatorDirections}
                                disabled={!selectedScenario || selectedScenario.stops.length < 2 || isExportingOperatorPdf}
                                className="inline-flex items-center gap-1.5 rounded-xl border border-cyan-200 bg-cyan-50 px-2.5 py-1 text-xs font-bold text-cyan-800 disabled:opacity-50"
                            >
                                <Download size={14} />{isExportingOperatorPdf ? 'Preparing PDF' : 'Operator PDF'}
                            </button>
                            <button
                                type="button"
                                onClick={isCampShuttleFocusMode ? exitCampShuttleFocusMode : enterCampShuttleFocusMode}
                                className={`inline-flex items-center gap-1.5 rounded-xl border px-2.5 py-1 text-xs font-bold ${isCampShuttleFocusMode ? 'border-amber-300 bg-amber-100 text-amber-900' : 'border-amber-200 bg-amber-50 text-amber-800'}`}
                            >
                                <Route size={14} />Camp Focus
                            </button>
                            <button type="button" disabled className="inline-flex items-center gap-1.5 rounded-xl bg-slate-900 px-2.5 py-1 text-xs font-bold text-white opacity-60"><Download size={14} />Export later</button>
                        </div>
                    </div>
                    <div className="mt-2 flex items-center gap-2 overflow-x-auto rounded-2xl border border-slate-200 bg-slate-50 px-2 py-1">
                        <div className="shrink-0 text-xs font-black uppercase tracking-wide text-slate-500">Route concepts</div>
                        <button type="button" onClick={() => setProject((current) => addRoutePlanner2Scenario(current))} className="inline-flex shrink-0 items-center gap-1 rounded-full bg-cyan-50 px-2.5 py-1 text-xs font-bold text-cyan-700">
                            <Plus size={12} /> Add route
                        </button>
                        <div className="flex min-w-0 gap-2">
                            {project.scenarios.map((scenario) => {
                                const summary = projectSummary.scenarioSummaries.find((item) => item.scenarioId === scenario.id);
                                const isSelected = selectedScenario?.id === scenario.id;
                                return (
                                    <button
                                        key={scenario.id}
                                        type="button"
                                        onClick={() => setProject((current) => selectRoutePlanner2Scenario(current, scenario.id))}
                                        className={`min-w-[170px] rounded-xl border px-2.5 py-1 text-left ${isSelected ? 'border-cyan-300 bg-white shadow-sm' : 'border-slate-200 bg-white/70 hover:bg-white'}`}
                                    >
                                        <div className="flex items-center justify-between gap-2">
                                            <span className="truncate text-sm font-black text-slate-900">{scenario.name}</span>
                                            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase text-slate-700">{scenario.status}</span>
                                        </div>
                                        <div className="mt-1 flex items-center gap-3 text-xs text-slate-500">
                                            <span>{scenario.stops.length} stops</span>
                                            <span>{summary?.oneWayRuntimeLabel ?? 'Not ready'}</span>
                                            <span>{scenario.routeShape === 'closed-loop' ? 'Closed loop' : scenario.routeShape === 'out-and-back' ? 'Out and back' : summary?.readinessLabel ?? 'Not ready'}</span>
                                        </div>
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                </header>

                <main
                    data-testid="rp2-map-first-shell"
                    data-layout="map-first"
                    data-focus-mode={focusMode}
                    className="relative min-h-0 flex-1 overflow-hidden bg-slate-100 p-1.5 sm:p-2"
                >
                    <RoutePlanner2MapCanvas
                        scenario={selectedScenario}
                        selectedStopId={selectedStopId}
                        onSelectStop={setSelectedStopId}
                        onAddStop={addStop}
                        onDeleteStop={deleteStop}
                        onMoveStop={moveStop}
                        onAddLineWaypoint={addLineWaypoint}
                        onInsertStopOnLine={insertStopOnLine}
                        onMoveLineWaypoint={moveLineWaypoint}
                        onDeleteLineWaypoint={deleteLineWaypoint}
                        onSegmentRuntimeEstimates={updateSegmentRuntimeEstimates}
                        onRouteShapeChange={updateRouteShape}
                        onSetTurnaroundStop={setTurnaroundStop}
                        onAddNextStop={() => addStop()}
                        onEnterDrawFocus={enterDrawFocusMode}
                        focusMode={isDrawFocusMode}
                        metricItems={mapMetricItems}
                        overlayInsets={mapOverlayInsets}
                    />

                    <div className="pointer-events-none absolute inset-x-4 top-4 z-30 flex items-start justify-between gap-3">
                        <div />
                        <div className="flex gap-2">
                            {isCampShuttleFocusMode && (
                                <button
                                    type="button"
                                    onClick={exitCampShuttleFocusMode}
                                    className="pointer-events-auto rounded-full border border-amber-200 bg-white/95 px-3 py-2 text-xs font-black text-amber-800 shadow-lg hover:bg-amber-50"
                                >
                                    Exit camp focus
                                </button>
                            )}
                            {isDrawFocusMode && (
                                <button
                                    type="button"
                                    onClick={exitDrawFocusMode}
                                    className="pointer-events-auto rounded-full border border-cyan-200 bg-white/95 px-3 py-2 text-xs font-black text-cyan-700 shadow-lg hover:bg-cyan-50"
                                >
                                    Exit focus
                                </button>
                            )}
                            {!isCampShuttleFocusMode && (
                                <button
                                    type="button"
                                    onClick={toggleRightRail}
                                    className="pointer-events-auto rounded-full border border-slate-200 bg-white/95 px-3 py-2 text-xs font-black text-slate-700 shadow-lg hover:bg-slate-50"
                                >
                                    {visibleRightRailOpen ? 'Hide review' : 'Review route'}
                                </button>
                            )}
                        </div>
                    </div>

                    {isCampShuttleFocusMode && selectedScenario && (
                        <aside
                            data-testid="rp2-camp-shuttle-focus"
                            className="absolute bottom-4 right-4 top-16 z-20 w-[410px] overflow-y-auto rounded-3xl border border-amber-200 bg-white p-4 shadow-xl"
                        >
                            <div className="flex items-start justify-between gap-3">
                                <div>
                                    <div className="text-xs font-black uppercase tracking-[0.18em] text-amber-700">Summer camp shuttle</div>
                                    <h2 className="mt-1 text-lg font-black text-slate-950">{selectedScenario.name}</h2>
                                </div>
                                <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-black text-amber-800">Summer service</span>
                            </div>
                            <p className="mt-3 text-sm leading-6 text-slate-600">
                                Focused Route Planner view for reviewing the camp shuttle pattern, stop order, service span, headway, and vehicle need.
                            </p>

                            <div className="mt-4 grid grid-cols-2 gap-2">
                                {[
                                    { label: 'Stops', value: String(campStops.length) },
                                    { label: 'Span', value: formatCampServiceSpan(selectedScenario.service) },
                                    { label: 'Headway', value: formatCampFrequency(selectedScenario.service) },
                                    { label: 'Buses', value: formatBuses(selectedFeasibility?.busesRequired) },
                                    { label: 'Runtime', value: formatRuntime(selectedFeasibility?.oneWayRuntimeMinutes) },
                                    { label: 'Cycle', value: formatRuntime(selectedFeasibility?.cycleTimeMinutes) },
                                ].map((item) => (
                                    <div key={item.label} className="rounded-2xl border border-amber-100 bg-amber-50/70 p-3">
                                        <div className="text-[11px] font-black uppercase tracking-wide text-amber-700">{item.label}</div>
                                        <div className="mt-1 text-sm font-black text-slate-950">{item.value}</div>
                                    </div>
                                ))}
                            </div>

                            <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-3">
                                <h3 className="text-sm font-black text-slate-900">Camp stop order</h3>
                                {campStops.length > 0 ? (
                                    <ol className="mt-3 space-y-2">
                                        {campStops.map((stop) => (
                                            <li key={stop.id} className="flex gap-3 rounded-xl bg-white p-2 text-sm shadow-sm">
                                                <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-amber-100 text-xs font-black text-amber-800">{stop.sequence}</span>
                                                <div className="min-w-0">
                                                    <div className="truncate font-black text-slate-900">{stop.name}</div>
                                                    <div className="text-xs font-semibold text-slate-500">{stopRoleLabel(stop.role)}{stop.stopCode ? ` · Stop ${stop.stopCode}` : ''}</div>
                                                </div>
                                            </li>
                                        ))}
                                    </ol>
                                ) : (
                                    <p className="mt-2 text-sm leading-6 text-slate-500">Add the camp pickup, dropoff, and terminal stops to build the shuttle pattern.</p>
                                )}
                            </div>

                            <div className="mt-4 rounded-2xl border border-cyan-100 bg-cyan-50 p-3">
                                <h3 className="text-sm font-black text-cyan-950">Operational snapshot</h3>
                                <p className="mt-2 text-sm leading-6 text-cyan-900">
                                    Uses the selected Route Planner concept. Edit stops and service assumptions in the route review panel when you leave camp focus.
                                </p>
                            </div>
                        </aside>
                    )}

                    <aside
                        data-testid="rp2-right-rail"
                        data-state={rightRailState}
                        aria-hidden={!visibleRightRailOpen}
                        className={`absolute bottom-4 right-4 top-16 z-20 w-[390px] space-y-4 overflow-y-auto transition-all duration-200 ${visibleRightRailOpen ? 'translate-x-0 opacity-100' : 'pointer-events-none translate-x-[calc(100%+2rem)] opacity-0'}`}
                    >
                        <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
                            <div className="flex items-center justify-between gap-3">
                                <h2 className="text-sm font-black text-slate-900">Review route</h2>
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
                                            <span className="font-bold text-slate-500">Runtime</span>
                                            <span className="text-right font-black text-slate-900">{formatRuntime(selectedFeasibility?.oneWayRuntimeMinutes)}</span>
                                        </div>
                                        <div className="flex items-center justify-between gap-3 py-2">
                                            <span className="font-bold text-slate-500">Source</span>
                                            <span className="text-right font-semibold text-slate-700">{getRuntimeSourceDetail(selectedFeasibility)}</span>
                                        </div>
                                        <div className="flex items-center justify-between gap-3 py-2">
                                            <span className="font-bold text-slate-500">Cycle</span>
                                            <span className="text-right font-black text-slate-900">{formatRuntime(selectedFeasibility?.cycleTimeMinutes)}</span>
                                        </div>
                                    </div>

                                    <div className={`rounded-2xl border p-3 ${readinessClass(selectedScenarioSummary.readiness)}`}>
                                        <div className="flex items-center justify-between gap-2">
                                            <h3 className="text-sm font-black">Route status</h3>
                                            <span className="rounded-full bg-white/80 px-2 py-1 text-xs font-black uppercase">{selectedScenarioSummary.readinessLabel}</span>
                                        </div>
                                        <p className="mt-2 text-sm leading-5">{selectedScenarioSummary.summaryText}</p>
                                        <p className="mt-1 text-xs font-bold">Next: {selectedScenarioSummary.nextAction}</p>
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
                                            <label className="text-xs font-bold uppercase tracking-wide text-slate-500">Runtime day<select value={runtimeDayType} onChange={(event) => updateRuntimeDayType(event.target.value as DayType)} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm">{DAY_TYPES.map((day) => <option key={day.id} value={day.id}>{day.label}</option>)}</select></label>
                                            <label className="text-xs font-bold uppercase tracking-wide text-slate-500">Runtime period<select value={runtimePeriod} onChange={(event) => updateRuntimePeriod(event.target.value as TimePeriod)} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm">{TIME_PERIODS.map((period) => <option key={period.id} value={period.id}>{period.label}</option>)}</select></label>
                                            <label className="text-xs font-bold uppercase tracking-wide text-slate-500">Start layover<input type="number" value={selectedScenario.service.startTerminalLayoverMinutes} onChange={(event) => updateNumericServiceField('startTerminalLayoverMinutes', event.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm" /></label>
                                            <label className="text-xs font-bold uppercase tracking-wide text-slate-500">End layover<input type="number" value={selectedScenario.service.endTerminalLayoverMinutes} onChange={(event) => updateNumericServiceField('endTerminalLayoverMinutes', event.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm" /></label>
                                            <label className="text-xs font-bold uppercase tracking-wide text-slate-500">Dwell / stop sec<input type="number" min="0" value={selectedScenario.service.intermediateStopDwellSeconds ?? 0} onChange={(event) => updateNumericServiceField('intermediateStopDwellSeconds', event.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm" /></label>
                                                </div>
                                                <p className="mt-2 text-xs leading-5 text-slate-500">
                                                    Dwell is added for intermediate stops only. Terminal layover stays separate.
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
                                                <label className="block text-xs font-bold uppercase tracking-wide text-slate-500" htmlFor="rp2-stop-role">Stop role<select id="rp2-stop-role" value={selectedStop.role} onChange={(event) => updateSelectedStopRole(event.target.value as RoutePlanner2StopRole)} className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold"><option value="regular">Regular stop</option><option value="timed">Timed stop</option><option value="start-terminal">Start terminal</option><option value="end-terminal">End terminal</option></select></label>
                                                <div className="grid grid-cols-3 gap-2">
                                                    <button type="button" onClick={() => selectedScenario && selectedStop && setProject((current) => moveRoutePlanner2Stop(current, selectedScenario.id, selectedStop.id, 'up'))} className="rounded-xl border bg-white px-2 py-2 text-xs font-bold">Up</button>
                                                    <button type="button" onClick={() => selectedScenario && selectedStop && setProject((current) => moveRoutePlanner2Stop(current, selectedScenario.id, selectedStop.id, 'down'))} className="rounded-xl border bg-white px-2 py-2 text-xs font-bold">Down</button>
                                                    <button type="button" onClick={deleteSelectedStop} className="rounded-xl border border-red-200 bg-white px-2 py-2 text-xs font-bold text-red-700">Remove</button>
                                                </div>
                                            </div>
                                        ) : <p className="text-sm leading-6 text-slate-500">Add a stop from the map canvas, then mark terminal roles here.</p>}
                                            </div>

                                            <div className="rounded-2xl border border-slate-200 bg-white p-3">
                                        <div className="flex items-start justify-between gap-3">
                                            <div>
                                                <h3 className="text-sm font-black text-slate-900">Reassign stops</h3>
                                                <p className="mt-1 text-xs leading-5 text-slate-500">Copy or move a contiguous stop range into another route concept.</p>
                                            </div>
                                            <span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-black uppercase text-slate-500">Planning copy</span>
                                        </div>
                                        {transferTargetOptions.length === 0 ? (
                                            <p className="mt-3 text-sm leading-6 text-slate-500">Create another route concept before reassigning stops.</p>
                                        ) : selectedScenarioStops.length === 0 ? (
                                            <p className="mt-3 text-sm leading-6 text-slate-500">Add stops to this route before reassigning them.</p>
                                        ) : (
                                            <div className="mt-3 space-y-3">
                                                <div className="grid grid-cols-2 gap-3">
                                                    <label className="text-xs font-bold uppercase tracking-wide text-slate-500" htmlFor="rp2-transfer-from">
                                                        From stop
                                                        <select id="rp2-transfer-from" value={transferFromSequence} onChange={(event) => setTransferFromSequence(Number(event.target.value))} className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-800">
                                                            {selectedScenarioStops.map((stop) => <option key={stop.id} value={stop.sequence}>{stop.sequence}. {stop.name}</option>)}
                                                        </select>
                                                    </label>
                                                    <label className="text-xs font-bold uppercase tracking-wide text-slate-500" htmlFor="rp2-transfer-to">
                                                        To stop
                                                        <select id="rp2-transfer-to" value={transferToSequence} onChange={(event) => setTransferToSequence(Number(event.target.value))} className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-800">
                                                            {selectedScenarioStops.map((stop) => <option key={stop.id} value={stop.sequence}>{stop.sequence}. {stop.name}</option>)}
                                                        </select>
                                                    </label>
                                                </div>
                                                <label className="block text-xs font-bold uppercase tracking-wide text-slate-500" htmlFor="rp2-transfer-target">
                                                    Target route
                                                    <select id="rp2-transfer-target" value={transferTargetScenarioId} onChange={(event) => { setTransferTargetScenarioId(event.target.value); setTransferInsertAfterStopId('__end'); }} className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-800">
                                                        {transferTargetOptions.map((scenario) => <option key={scenario.id} value={scenario.id}>{scenario.name}</option>)}
                                                    </select>
                                                </label>
                                                <label className="block text-xs font-bold uppercase tracking-wide text-slate-500" htmlFor="rp2-transfer-insert">
                                                    Insert position
                                                    <select id="rp2-transfer-insert" value={transferInsertAfterStopId} onChange={(event) => setTransferInsertAfterStopId(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-800">
                                                        <option value="__start">At beginning</option>
                                                        {transferTargetStops.map((stop) => <option key={stop.id} value={stop.id}>After {stop.sequence}. {stop.name}</option>)}
                                                        <option value="__end">At end</option>
                                                    </select>
                                                </label>
                                                <div className="grid grid-cols-2 gap-2">
                                                    <button type="button" onClick={() => applyStopTransfer('copy')} className="rounded-xl border border-cyan-200 bg-cyan-50 px-3 py-2 text-sm font-black text-cyan-800">Copy stops</button>
                                                    <button type="button" onClick={() => applyStopTransfer('move')} className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-black text-amber-800">Move stops</button>
                                                </div>
                                            </div>
                                        )}
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
                                        <p className="mt-2 text-xs leading-5 text-slate-500">Scheduled GTFS is used when the segment matches a GTFS stop pair or a corridor path for the selected day and time period. Mapbox fills any scheduled-data gaps.</p>
                                        {runtimeRouteOptions.length > 0 && (
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

                                    <div className={`rounded-2xl border p-3 ${(selectedFeasibility?.warnings.length ?? 0) > 0 ? 'border-amber-200 bg-amber-50' : 'border-emerald-200 bg-emerald-50'}`}>
                                        <h3 className={`text-sm font-black ${(selectedFeasibility?.warnings.length ?? 0) > 0 ? 'text-amber-900' : 'text-emerald-900'}`}>{(selectedFeasibility?.warnings.length ?? 0) > 0 ? 'Needs attention' : 'Ready for runtime review'}</h3>
                                        {(selectedFeasibility?.warnings.length ?? 0) > 0 ? (
                                            <ul className="mt-2 space-y-2">
                                                {selectedFeasibility?.warnings.map((warning) => (
                                                    <li key={warning.id} className="text-sm leading-5 text-amber-800">
                                                        {warning.message}
                                                        {warning.action && <span className="block text-xs font-semibold text-amber-700">{warning.action}</span>}
                                                    </li>
                                                ))}
                                            </ul>
                                        ) : <p className="mt-2 text-sm text-emerald-800">Route has enough inputs for a segment travel-time estimate.</p>}
                                    </div>

                                    {selectedFeasibility && selectedFeasibility.segmentSummaries.length > 0 && (
                                        <div className="rounded-2xl border border-slate-200 bg-white p-3">
                                            <h3 className="text-sm font-black text-slate-900">Segment runtimes</h3>
                                            <div className="mt-2 space-y-2">
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
                                                        <div key={segment.id} className="rounded-xl bg-slate-50 p-2 text-xs text-slate-600">
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
                                        </div>
                                    )}

                                    <div className="grid grid-cols-2 gap-2">
                                        <button type="button" onClick={() => setProject((current) => markRoutePlanner2PreferredScenario(current, selectedScenario.id))} className="inline-flex items-center justify-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-bold text-emerald-700"><Star size={16} />Mark preferred</button>
                                        <button type="button" onClick={() => setProject((current) => deleteRoutePlanner2Scenario(current, selectedScenario.id))} disabled={project.scenarios.length <= 1} className="inline-flex items-center justify-center gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm font-bold text-red-700 disabled:opacity-50"><Trash2 size={16} />Delete</button>
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
                        </details>
                    </aside>
                </main>
            </div>
            <RoutePlanner2GtfsImportModal
                open={isGtfsImportOpen}
                patterns={gtfsPatterns}
                loading={gtfsLoading}
                error={gtfsError}
                onClose={() => setIsGtfsImportOpen(false)}
                onImport={importGtfsPatterns}
                onRetry={loadGtfsPatterns}
            />
            <RoutePlanner2AddressImportModal
                open={isAddressImportOpen}
                onClose={() => setIsAddressImportOpen(false)}
                onImport={importAddressStops}
            />
        </div>
    );
};
