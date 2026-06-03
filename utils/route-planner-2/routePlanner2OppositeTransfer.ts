import { sortRoutePlanner2Stops } from './routePlanner2Segments';
import type { RoutePlanner2Project, RoutePlanner2Scenario, RoutePlanner2Stop } from './routePlanner2Types';
import type { RoutePlanner2StopTransferPreviewOptions } from './routePlanner2TransferPreview';

export interface RoutePlanner2OppositeStopTransferSuggestion {
    options: RoutePlanner2StopTransferPreviewOptions;
    sourceScenarioName: string;
    targetScenarioName: string;
    matchedStopCount: number;
}

type CardinalDirection = 'NB' | 'SB' | 'EB' | 'WB';

interface ScenarioDirectionIdentity {
    routeCode?: string;
    routeBase?: string;
    branch?: string;
    cardinal?: CardinalDirection;
}

function normalizeText(value: string | undefined): string {
    return (value ?? '').trim().toUpperCase().replace(/\s+/g, ' ');
}

function normalizeStopName(value: string | undefined): string {
    return normalizeText(value).replace(/[^A-Z0-9]/g, '');
}

function getScenarioRouteCode(scenario: RoutePlanner2Scenario): string | undefined {
    return normalizeText(
        scenario.routeFamily?.memberShortName
        ?? (scenario.source?.type === 'gtfs' ? scenario.source.routeShortName : undefined)
        ?? scenario.name.match(/\b(\d{1,3}[A-Z]?)\b/i)?.[1],
    ) || undefined;
}

function getScenarioCardinal(scenario: RoutePlanner2Scenario): CardinalDirection | undefined {
    const haystack = normalizeText([
        scenario.name,
        scenario.routeFamily?.directionLabel,
        scenario.source?.type === 'gtfs' ? scenario.source.tripHeadsign : undefined,
        scenario.notes,
    ].filter(Boolean).join(' '));

    if (/\b(NB|NORTHBOUND|NORTH)\b/.test(haystack)) return 'NB';
    if (/\b(SB|SOUTHBOUND|SOUTH)\b/.test(haystack)) return 'SB';
    if (/\b(EB|EASTBOUND|EAST)\b/.test(haystack)) return 'EB';
    if (/\b(WB|WESTBOUND|WEST)\b/.test(haystack)) return 'WB';
    return undefined;
}

function invertCardinal(cardinal: CardinalDirection | undefined): CardinalDirection | undefined {
    if (cardinal === 'NB') return 'SB';
    if (cardinal === 'SB') return 'NB';
    if (cardinal === 'EB') return 'WB';
    if (cardinal === 'WB') return 'EB';
    return undefined;
}

function getScenarioDirectionIdentity(scenario: RoutePlanner2Scenario): ScenarioDirectionIdentity {
    const routeCode = getScenarioRouteCode(scenario);
    const routeMatch = routeCode?.match(/^(\d{1,3})([A-Z])?$/);
    return {
        routeCode,
        routeBase: scenario.routeFamily?.shortName ?? routeMatch?.[1],
        branch: routeMatch?.[2],
        cardinal: getScenarioCardinal(scenario),
    };
}

function isRoute8Opposite(source: ScenarioDirectionIdentity, candidate: ScenarioDirectionIdentity): boolean {
    if (source.routeBase !== '8' || candidate.routeBase !== '8') return false;
    if (!source.branch || !candidate.branch || !source.cardinal || !candidate.cardinal) return false;

    const oppositeBranch = source.branch === 'A' ? 'B' : source.branch === 'B' ? 'A' : undefined;
    return candidate.branch === oppositeBranch && candidate.cardinal === invertCardinal(source.cardinal);
}

function isGenericCardinalOpposite(source: ScenarioDirectionIdentity, candidate: ScenarioDirectionIdentity): boolean {
    return Boolean(
        source.routeCode
        && candidate.routeCode === source.routeCode
        && source.cardinal
        && candidate.cardinal === invertCardinal(source.cardinal),
    );
}

export function findRoutePlanner2OppositeScenario(
    scenarios: RoutePlanner2Scenario[],
    scenario: RoutePlanner2Scenario,
): RoutePlanner2Scenario | null {
    if (scenario.routeFamily?.key && scenario.routeFamily.directionRole) {
        const oppositeRole = scenario.routeFamily.directionRole === 'out' ? 'back' : 'out';
        const routeFamilyMatch = scenarios.find((candidate) =>
            candidate.id !== scenario.id
            && candidate.routeFamily?.key === scenario.routeFamily?.key
            && candidate.routeFamily?.directionRole === oppositeRole,
        );
        if (routeFamilyMatch) return routeFamilyMatch;
    }

    const sourceIdentity = getScenarioDirectionIdentity(scenario);
    const route8Match = scenarios.find((candidate) =>
        candidate.id !== scenario.id && isRoute8Opposite(sourceIdentity, getScenarioDirectionIdentity(candidate)),
    );
    if (route8Match) return route8Match;

    return scenarios.find((candidate) =>
        candidate.id !== scenario.id && isGenericCardinalOpposite(sourceIdentity, getScenarioDirectionIdentity(candidate)),
    ) ?? null;
}

function stopsRepresentSamePlace(first: RoutePlanner2Stop, second: RoutePlanner2Stop): boolean {
    if (first.stopCode && second.stopCode && first.stopCode === second.stopCode) return true;
    if (normalizeStopName(first.name) && normalizeStopName(first.name) === normalizeStopName(second.name)) return true;

    const latDiff = Math.abs(first.lat - second.lat);
    const lngDiff = Math.abs(first.lng - second.lng);
    return latDiff < 0.00025 && lngDiff < 0.00025;
}

function findMatchingStop(stop: RoutePlanner2Stop, candidates: RoutePlanner2Stop[]): RoutePlanner2Stop | null {
    return candidates.find((candidate) => stopsRepresentSamePlace(stop, candidate)) ?? null;
}

function getNormalizedInsertIndex(options: RoutePlanner2StopTransferPreviewOptions, targetStops: RoutePlanner2Stop[]): number {
    if (!options.insertAfterStopId) return 0;
    const stopIndex = targetStops.findIndex((stop) => stop.id === options.insertAfterStopId);
    return stopIndex >= 0 ? stopIndex + 1 : targetStops.length;
}

export function buildRoutePlanner2OppositeStopTransferSuggestion(
    project: RoutePlanner2Project,
    options: RoutePlanner2StopTransferPreviewOptions,
): RoutePlanner2OppositeStopTransferSuggestion | null {
    const sourceScenario = project.scenarios.find((scenario) => scenario.id === options.sourceScenarioId);
    const targetScenario = project.scenarios.find((scenario) => scenario.id === options.targetScenarioId);
    if (!sourceScenario || !targetScenario) return null;

    const oppositeSourceScenario = findRoutePlanner2OppositeScenario(project.scenarios, sourceScenario);
    const oppositeTargetScenario = findRoutePlanner2OppositeScenario(project.scenarios, targetScenario);
    if (!oppositeSourceScenario || !oppositeTargetScenario) return null;
    if (oppositeSourceScenario.id === oppositeTargetScenario.id) return null;

    const sourceStops = sortRoutePlanner2Stops(sourceScenario.stops);
    const selectedStops = sourceStops.filter((stop) =>
        stop.sequence >= Math.min(options.fromSequence, options.toSequence)
        && stop.sequence <= Math.max(options.fromSequence, options.toSequence),
    );
    if (selectedStops.length === 0) return null;

    const oppositeSourceStops = sortRoutePlanner2Stops(oppositeSourceScenario.stops);
    const matchedStops = selectedStops
        .map((stop) => findMatchingStop(stop, oppositeSourceStops))
        .filter((stop): stop is RoutePlanner2Stop => Boolean(stop));

    if (matchedStops.length !== selectedStops.length) return null;

    const targetStops = sortRoutePlanner2Stops(targetScenario.stops);
    const oppositeTargetStops = sortRoutePlanner2Stops(oppositeTargetScenario.stops);
    const normalizedInsertIndex = getNormalizedInsertIndex(options, targetStops);
    const mirroredInsertIndex = Math.max(0, Math.min(oppositeTargetStops.length, targetStops.length - normalizedInsertIndex));
    const insertAfterStopId = mirroredInsertIndex > 0 ? oppositeTargetStops[mirroredInsertIndex - 1]?.id ?? null : null;
    const matchedSequences = matchedStops.map((stop) => stop.sequence);

    return {
        options: {
            sourceScenarioId: oppositeSourceScenario.id,
            targetScenarioId: oppositeTargetScenario.id,
            fromSequence: Math.min(...matchedSequences),
            toSequence: Math.max(...matchedSequences),
            insertAfterStopId,
            mode: options.mode,
            reverseOrder: options.reverseOrder,
            now: options.now,
        },
        sourceScenarioName: oppositeSourceScenario.name,
        targetScenarioName: oppositeTargetScenario.name,
        matchedStopCount: matchedStops.length,
    };
}
