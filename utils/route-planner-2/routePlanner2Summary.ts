import { deriveRoutePlanner2Feasibility } from './routePlanner2Feasibility';
import type {
    RoutePlanner2FeasibilitySummary,
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

export interface RoutePlanner2ProjectSummary {
    totalScenarios: number;
    comparableScenarioCount: number;
    notReadyScenarioCount: number;
    preferredScenarioSummary: RoutePlanner2ScenarioSummary | null;
    selectedScenarioSummary: RoutePlanner2ScenarioSummary | null;
    scenarioSummaries: RoutePlanner2ScenarioSummary[];
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

export function summarizeRoutePlanner2Project(project: RoutePlanner2Project): RoutePlanner2ProjectSummary {
    const scenarioSummaries = project.scenarios.map((scenario) => summarizeRoutePlanner2Scenario(scenario, {
        isPreferred: project.preferredScenarioId === scenario.id,
    }));

    return {
        totalScenarios: project.scenarios.length,
        comparableScenarioCount: scenarioSummaries.filter((summary) => summary.readiness !== 'not-ready').length,
        notReadyScenarioCount: scenarioSummaries.filter((summary) => summary.readiness === 'not-ready').length,
        preferredScenarioSummary: scenarioSummaries.find((summary) => summary.isPreferred) ?? null,
        selectedScenarioSummary: scenarioSummaries.find((summary) => summary.scenarioId === project.selectedScenarioId) ?? null,
        scenarioSummaries,
    };
}
