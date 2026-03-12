import type { RouteObservedRuntimeSummary } from './routePlannerObservedRuntime';
import { buildRouteTimetableMarkdown } from './routePlannerTimetable';
import type { RouteProject, RouteScenario } from './routePlannerTypes';

function formatObservedCoverage(summary?: RouteObservedRuntimeSummary | null): string {
    if (!summary) return 'No observed stop-to-stop coverage';
    return `${summary.matchedSegmentCount}/${summary.totalSegmentCount} matched stop segments`;
}

function formatRuntimeSource(
    scenario: RouteScenario,
    observedSummary?: RouteObservedRuntimeSummary | null
): string {
    if (scenario.runtimeSourceMode === 'manual_override') return 'Manual override';
    if (scenario.runtimeSourceMode === 'observed_proxy') {
        const coverage = formatObservedCoverage(observedSummary);
        const sampleText = scenario.runtimeInputs.observedSampleCount
            ? `, minimum ${scenario.runtimeInputs.observedSampleCount} samples`
            : '';
        return `Observed proxy (${coverage}${sampleText})`;
    }
    return 'Fallback estimate';
}

function formatStops(scenario: RouteScenario): string {
    if (scenario.stops.length === 0) return '- No stops defined';

    return scenario.stops.map((stop, index) =>
        `${index + 1}. ${stop.name} (${stop.kind}, ${stop.role}) ${stop.timeLabel}${stop.plannedOffsetMinutes !== null && stop.plannedOffsetMinutes !== undefined ? ` · anchor +${stop.plannedOffsetMinutes} min` : ''}`
    ).join('\n');
}

function formatWarnings(scenario: RouteScenario): string {
    if (scenario.warnings.length === 0) return '- No warnings';
    return scenario.warnings.map((warning) => `- ${warning}`).join('\n');
}

function formatDepartures(scenario: RouteScenario): string {
    if (scenario.departures.length === 0) return '- No departures yet';
    return scenario.departures.slice(0, 10).map((departure) => `- ${departure}`).join('\n');
}

export function buildRouteStudyExport(
    project: RouteProject,
    scenarios: RouteScenario[],
    observedSummaries?: Map<string, RouteObservedRuntimeSummary>
): string {
    const sections = scenarios.map((scenario) => {
        const observedSummary = observedSummaries?.get(scenario.id) ?? null;
        return [
            `## ${scenario.name}`,
            '',
            `- Scenario Type: ${scenario.scenarioType}`,
            `- Pattern: ${scenario.pattern}`,
            `- Base Source: ${scenario.baseSource.label}`,
            `- Runtime Source: ${formatRuntimeSource(scenario, observedSummary)}`,
            `- Distance: ${scenario.distanceKm} km`,
            `- Runtime: ${scenario.runtimeMinutes} min`,
            `- Cycle Time: ${scenario.cycleMinutes} min`,
            `- Buses Required: ${scenario.busesRequired}`,
            `- Service Hours: ${scenario.serviceHours}`,
            `- Span: ${scenario.firstDeparture} to ${scenario.lastDeparture}`,
            `- Frequency: Every ${scenario.frequencyMinutes} min`,
            '',
            '### Stops',
            formatStops(scenario),
            '',
            '### Warnings',
            formatWarnings(scenario),
            '',
            '### Sample Departures',
            formatDepartures(scenario),
            '',
            '### Timetable Preview',
            buildRouteTimetableMarkdown(scenario),
            '',
        ].join('\n');
    }).join('\n');

    return [
        `# ${project.name}`,
        '',
        project.description ?? 'No description provided.',
        '',
        `Exported: ${new Date().toLocaleString()}`,
        '',
        sections,
    ].join('\n');
}

export function buildRouteScenarioHandoff(
    project: RouteProject,
    scenario: RouteScenario,
    observedSummary?: RouteObservedRuntimeSummary | null
): string {
    return [
        `# ${project.name} - Scheduling Handoff`,
        '',
        `## Preferred Scenario`,
        '',
        `- Name: ${scenario.name}`,
        `- Scenario Type: ${scenario.scenarioType}`,
        `- Base Source: ${scenario.baseSource.label}`,
        `- Runtime Source: ${formatRuntimeSource(scenario, observedSummary)}`,
        `- Runtime: ${scenario.runtimeMinutes} min`,
        `- Cycle Time: ${scenario.cycleMinutes} min`,
        `- Buses Required: ${scenario.busesRequired}`,
        `- Span: ${scenario.firstDeparture} to ${scenario.lastDeparture}`,
        `- Frequency: Every ${scenario.frequencyMinutes} min`,
        `- Layover: ${scenario.layoverMinutes} min`,
        '',
        '## Stops',
        '',
        formatStops(scenario),
        '',
        '## Planning Notes',
        '',
        scenario.notes.trim() || 'No scenario notes provided.',
        '',
        '## Key Warnings',
        '',
        formatWarnings(scenario),
        '',
        '## First Departures',
        '',
        formatDepartures(scenario),
        '',
        '## Timetable Preview',
        '',
        buildRouteTimetableMarkdown(scenario),
        '',
    ].join('\n');
}
