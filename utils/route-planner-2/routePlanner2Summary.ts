import { deriveRoutePlanner2Feasibility } from './routePlanner2Feasibility';
import type {
    RoutePlanner2FeasibilitySummary,
    RoutePlanner2PlanningPeriod,
    RoutePlanner2Project,
    RoutePlanner2Scenario,
    RoutePlanner2WarningSeverity,
} from './routePlanner2Types';

export type RoutePlanner2ScenarioReadiness = 'not-ready' | 'needs-review' | 'ready-for-review';

export interface RoutePlanner2ScenarioSummary {
    scenarioId: string;
    scenarioName: string;
    isPreferred: boolean;
    readiness: RoutePlanner2ScenarioReadiness;
    readinessLabel: string;
    summaryText: string;
    nextAction: string;
    oneWayRuntimeLabel: string;
    cycleTimeLabel: string;
    busesRequiredLabel: string;
    confidenceLabel: string;
    stopsLabel: string;
    frequencyLabel: string;
    warningCount: number;
    blockingWarningCount: number;
    feasibility: RoutePlanner2FeasibilitySummary;
}

export interface RoutePlanner2RouteFamilySummary {
    key: string;
    familyName: string;
    scenarioIds: string[];
    directionLabels: string[];
    runtimeMinutes: number | null;
    runtimeLabel: string;
    cycleTimeMinutes: number | null;
    cycleTimeLabel: string;
    recoveryTimeMinutes: number | null;
    recoveryPercent: number | null;
    recoveryLabel: string;
    busesRequired: number | null;
    busesRequiredLabel: string;
    frequencyMinutes: number | null;
    confidence: RoutePlanner2FeasibilitySummary['confidence'];
    warningCount: number;
    blockingWarningCount: number;
    summaryText: string;
}

export interface RoutePlanner2ProjectSummary {
    totalScenarios: number;
    comparableScenarioCount: number;
    notReadyScenarioCount: number;
    preferredScenarioSummary: RoutePlanner2ScenarioSummary | null;
    selectedScenarioSummary: RoutePlanner2ScenarioSummary | null;
    selectedRouteFamilySummary: RoutePlanner2RouteFamilySummary | null;
    scenarioSummaries: RoutePlanner2ScenarioSummary[];
    routeFamilySummaries: RoutePlanner2RouteFamilySummary[];
}

function pluralize(count: number, singular: string, plural = `${singular}s`): string {
    return `${count} ${count === 1 ? singular : plural}`;
}

function formatMinutes(minutes: number | null): string {
    return minutes != null ? `${minutes} min` : 'Not ready';
}

function formatBuses(value: number | null): string {
    if (value == null) return 'Not ready';
    return pluralize(value, 'bus', 'buses');
}

function formatRecovery(minutes: number | null, percent: number | null): string {
    if (minutes == null) return 'Not ready';
    return percent != null ? `${minutes} min (${percent}%)` : `${minutes} min`;
}

function countWarnings(feasibility: RoutePlanner2FeasibilitySummary, severity: RoutePlanner2WarningSeverity): number {
    return feasibility.warnings.filter((warning) => warning.severity === severity).length;
}

function getNotReadyNextAction(feasibility: RoutePlanner2FeasibilitySummary): string {
    const warningIds = new Set(feasibility.warnings.map((warning) => warning.id));
    if (
        feasibility.oneWayRuntimeMinutes != null
        && warningIds.has('missing-start-terminal')
        && warningIds.has('missing-end-terminal')
    ) {
        return 'Mark Stop 1 as start and Stop 2 as end to estimate cycle time.';
    }

    const firstBlockingWarning = feasibility.warnings.find((warning) => warning.severity === 'blocking');
    return firstBlockingWarning?.action ?? firstBlockingWarning?.message ?? 'Fix blocking warnings before review.';
}

export function summarizeRoutePlanner2Scenario(
    scenario: RoutePlanner2Scenario,
    options: { isPreferred?: boolean } = {},
): RoutePlanner2ScenarioSummary {
    const feasibility = deriveRoutePlanner2Feasibility(scenario);
    const blockingWarningCount = countWarnings(feasibility, 'blocking');
    const warningCount = feasibility.warnings.length;
    const oneWayRuntimeLabel = formatMinutes(feasibility.oneWayRuntimeMinutes);
    const cycleTimeLabel = formatMinutes(feasibility.cycleTimeMinutes);
    const busesRequiredLabel = formatBuses(feasibility.busesRequired);
    const stopsLabel = pluralize(scenario.stops.length, 'stop');
    const frequencyLabel = `${scenario.service.frequencyMinutes} min`;

    if (blockingWarningCount > 0) {
        return {
            scenarioId: scenario.id,
            scenarioName: scenario.name,
            isPreferred: options.isPreferred ?? false,
            readiness: 'not-ready',
            readinessLabel: 'Not ready',
            summaryText: `${scenario.name} needs ${pluralize(blockingWarningCount, 'blocking issue')} fixed before it can be compared as a feasible route concept.`,
            nextAction: getNotReadyNextAction(feasibility),
            oneWayRuntimeLabel,
            cycleTimeLabel,
            busesRequiredLabel,
            confidenceLabel: feasibility.confidence,
            stopsLabel,
            frequencyLabel,
            warningCount,
            blockingWarningCount,
            feasibility,
        };
    }

    if (warningCount > 0) {
        return {
            scenarioId: scenario.id,
            scenarioName: scenario.name,
            isPreferred: options.isPreferred ?? false,
            readiness: 'needs-review',
            readinessLabel: 'Planning estimate',
            summaryText: `${scenario.name} has a fallback feasibility estimate: ${oneWayRuntimeLabel} one-way, ${cycleTimeLabel} cycle, ${busesRequiredLabel} at ${frequencyLabel} service.`,
            nextAction: 'Review warnings before treating this as a preferred planning option.',
            oneWayRuntimeLabel,
            cycleTimeLabel,
            busesRequiredLabel,
            confidenceLabel: feasibility.confidence,
            stopsLabel,
            frequencyLabel,
            warningCount,
            blockingWarningCount,
            feasibility,
        };
    }

    return {
        scenarioId: scenario.id,
        scenarioName: scenario.name,
        isPreferred: options.isPreferred ?? false,
        readiness: 'ready-for-review',
        readinessLabel: 'Ready for review',
        summaryText: `${scenario.name} is ready for planning review: ${oneWayRuntimeLabel} one-way, ${cycleTimeLabel} cycle, ${busesRequiredLabel} at ${frequencyLabel} service.`,
            nextAction: 'Compare against other routes or mark it preferred.',
        oneWayRuntimeLabel,
        cycleTimeLabel,
        busesRequiredLabel,
        confidenceLabel: feasibility.confidence,
        stopsLabel,
        frequencyLabel,
        warningCount,
        blockingWarningCount,
        feasibility,
    };
}

function getFamilySummaryKey(scenario: RoutePlanner2Scenario): string | null {
    if (!scenario.routeFamily) return null;
    const serviceId = scenario.source?.type === 'gtfs' ? scenario.source.serviceId ?? 'service' : 'local';
    return `${scenario.routeFamily.key}-${serviceId}`;
}

function getFamilyDirectionOrder(scenario: RoutePlanner2Scenario): number {
    if (scenario.routeFamily?.directionRole === 'out') return 0;
    if (scenario.routeFamily?.directionRole === 'back') return 1;
    return 2;
}

function getFamilyConfidence(feasibilities: RoutePlanner2FeasibilitySummary[]): RoutePlanner2FeasibilitySummary['confidence'] {
    if (feasibilities.some((feasibility) => feasibility.confidence === 'not-ready')) return 'not-ready';
    if (feasibilities.some((feasibility) => feasibility.confidence === 'low')) return 'low';
    if (feasibilities.some((feasibility) => feasibility.confidence === 'medium')) return 'medium';
    return 'high';
}

function getScenarioScheduledCycleWindow(scenario: RoutePlanner2Scenario): number | null {
    const planningPeriod: RoutePlanner2PlanningPeriod = scenario.service.planningPeriod ?? 'all-day';
    const scheduledCycleWindow = scenario.service.scheduledCycleWindows?.[planningPeriod]
        ?? scenario.service.scheduledCycleWindows?.['all-day'];
    const cycleTimeMinutes = scheduledCycleWindow?.cycleTimeMinutes;
    return typeof cycleTimeMinutes === 'number' && Number.isFinite(cycleTimeMinutes) && cycleTimeMinutes > 0
        ? cycleTimeMinutes
        : null;
}

function summarizeRouteFamily(scenarios: RoutePlanner2Scenario[], key: string): RoutePlanner2RouteFamilySummary {
    const sortedScenarios = [...scenarios].sort((a, b) => getFamilyDirectionOrder(a) - getFamilyDirectionOrder(b));
    const familyName = sortedScenarios[0]?.routeFamily?.name ?? 'Route family';
    const feasibilities = sortedScenarios.map((scenario) => deriveRoutePlanner2Feasibility(scenario));
    const directionLabels = sortedScenarios.map((scenario) => {
        const family = scenario.routeFamily;
        return family ? `${family.directionLabel} · ${family.memberShortName}` : scenario.name;
    });
    const blockingWarningCount = feasibilities.reduce((sum, feasibility) => sum + countWarnings(feasibility, 'blocking'), 0);
    const warningCount = feasibilities.reduce((sum, feasibility) => sum + feasibility.warnings.length, 0);
    const runtimeValues = feasibilities.map((feasibility) => feasibility.oneWayRuntimeMinutes);
    const runtimeMinutes = runtimeValues.every((runtime): runtime is number => runtime != null)
        ? runtimeValues.reduce((sum, runtime) => sum + runtime, 0)
        : null;
    const frequencyValues = sortedScenarios
        .map((scenario) => scenario.service.frequencyMinutes)
        .filter((frequency) => Number.isFinite(frequency) && frequency > 0);
    const frequencyMinutes = frequencyValues.length > 0 ? Math.min(...frequencyValues) : null;
    const targetBusValues = sortedScenarios
        .map((scenario) => scenario.service.targetBuses)
        .filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0);
    const targetBuses = targetBusValues.length > 0 ? Math.max(...targetBusValues.map((value) => Math.ceil(value))) : null;
    const scheduledCycleValues = sortedScenarios
        .map(getScenarioScheduledCycleWindow)
        .filter((value): value is number => value != null);
    const scheduledCycleTimeMinutes = targetBuses != null && scheduledCycleValues.length > 0
        ? Math.max(...scheduledCycleValues)
        : null;
    const canCalculateCycle = runtimeMinutes != null && frequencyMinutes != null && blockingWarningCount === 0;
    const busesRequired = canCalculateCycle
        ? targetBuses ?? Math.max(1, Math.ceil(runtimeMinutes / frequencyMinutes))
        : null;
    const cycleTimeMinutes = canCalculateCycle && busesRequired != null && frequencyMinutes != null
        ? scheduledCycleTimeMinutes ?? busesRequired * frequencyMinutes
        : null;
    const recoveryTimeMinutes = cycleTimeMinutes != null && runtimeMinutes != null
        ? cycleTimeMinutes - runtimeMinutes
        : null;
    const recoveryPercent = recoveryTimeMinutes != null && runtimeMinutes != null && runtimeMinutes > 0
        ? Math.round((recoveryTimeMinutes / runtimeMinutes) * 100)
        : null;
    const confidence = blockingWarningCount > 0 ? 'not-ready' : getFamilyConfidence(feasibilities);

    return {
        key,
        familyName,
        scenarioIds: sortedScenarios.map((scenario) => scenario.id),
        directionLabels,
        runtimeMinutes,
        runtimeLabel: formatMinutes(runtimeMinutes),
        cycleTimeMinutes,
        cycleTimeLabel: formatMinutes(cycleTimeMinutes),
        recoveryTimeMinutes,
        recoveryPercent,
        recoveryLabel: formatRecovery(recoveryTimeMinutes, recoveryPercent),
        busesRequired,
        busesRequiredLabel: formatBuses(busesRequired),
        frequencyMinutes,
        confidence,
        warningCount,
        blockingWarningCount,
        summaryText: runtimeMinutes != null && cycleTimeMinutes != null
            ? `${familyName} family: ${runtimeMinutes} min combined runtime across ${directionLabels.join(' + ')}, ${cycleTimeMinutes} min cycle, ${formatBuses(busesRequired)} at ${frequencyMinutes} min service.`
            : `${familyName} family needs all directions ready before combined cycle, recovery, and bus needs can be estimated.`,
    };
}

function summarizeRouteFamilies(project: RoutePlanner2Project): RoutePlanner2RouteFamilySummary[] {
    const groups = new Map<string, RoutePlanner2Scenario[]>();

    project.scenarios.forEach((scenario) => {
        const key = getFamilySummaryKey(scenario);
        if (!key) return;
        groups.set(key, [...(groups.get(key) ?? []), scenario]);
    });

    return Array.from(groups.entries())
        .filter(([, scenarios]) => scenarios.length > 1)
        .map(([key, scenarios]) => summarizeRouteFamily(scenarios, key));
}

export function summarizeRoutePlanner2Project(project: RoutePlanner2Project): RoutePlanner2ProjectSummary {
    const scenarioSummaries = project.scenarios.map((scenario) => summarizeRoutePlanner2Scenario(scenario, {
        isPreferred: project.preferredScenarioId === scenario.id,
    }));
    const routeFamilySummaries = summarizeRouteFamilies(project);
    const selectedRouteFamilySummary = routeFamilySummaries.find((familySummary) =>
        familySummary.scenarioIds.includes(project.selectedScenarioId),
    ) ?? null;

    return {
        totalScenarios: project.scenarios.length,
        comparableScenarioCount: scenarioSummaries.filter((summary) => summary.readiness !== 'not-ready').length,
        notReadyScenarioCount: scenarioSummaries.filter((summary) => summary.readiness === 'not-ready').length,
        preferredScenarioSummary: scenarioSummaries.find((summary) => summary.isPreferred) ?? null,
        selectedScenarioSummary: scenarioSummaries.find((summary) => summary.scenarioId === project.selectedScenarioId) ?? null,
        selectedRouteFamilySummary,
        scenarioSummaries,
        routeFamilySummaries,
    };
}
