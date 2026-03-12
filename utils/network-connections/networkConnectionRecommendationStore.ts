import type { DayType } from '../masterScheduleTypes';
import type {
    NetworkConnectionRecommendation,
    NetworkConnectionSeverity,
    NetworkConnectionTimeBand,
} from './networkConnectionTypes';

interface StoredNetworkConnectionRecommendation extends Omit<SavedNetworkConnectionRecommendation, 'createdAt' | 'updatedAt'> {
    createdAt: string;
    updatedAt: string;
}

export type SavedNetworkConnectionRecommendationStatus = 'new' | 'reviewing' | 'accepted' | 'implemented';

export interface SavedNetworkConnectionRecommendation {
    id: string;
    teamId?: string | null;
    status: SavedNetworkConnectionRecommendationStatus;
    dayType: DayType;
    timeBand: NetworkConnectionTimeBand;
    hubId: string;
    hubName: string;
    hubStopNames: string[];
    hubSeverity: NetworkConnectionSeverity;
    routeNumbers: string[];
    patternId: string;
    patternLabel: string;
    patternSeverity: NetworkConnectionSeverity;
    recommendationId: string;
    recommendationType: NetworkConnectionRecommendation['type'];
    recommendationTitle: string;
    recommendationSummary: string;
    recommendationRationale: string;
    fromRouteNumber: string;
    toRouteNumber: string;
    opportunityId?: string | null;
    opportunityLabel?: string | null;
    createdAt: Date;
    updatedAt: Date;
}

export function getNetworkConnectionRecommendationStorageKey(teamId?: string | null): string {
    return `scheduler4:network-connections:saved-actions:${teamId ?? 'default'}`;
}

function toStoredRecommendation(
    recommendation: SavedNetworkConnectionRecommendation,
): StoredNetworkConnectionRecommendation {
    return {
        ...recommendation,
        createdAt: recommendation.createdAt.toISOString(),
        updatedAt: recommendation.updatedAt.toISOString(),
    };
}

export function serializeSavedNetworkConnectionRecommendations(
    recommendations: SavedNetworkConnectionRecommendation[],
): string {
    return JSON.stringify(recommendations.map(toStoredRecommendation));
}

function parseStoredRecommendation(
    value: Partial<StoredNetworkConnectionRecommendation>,
): SavedNetworkConnectionRecommendation | null {
    if (
        !value
        || typeof value.id !== 'string'
        || typeof value.dayType !== 'string'
        || typeof value.timeBand !== 'string'
        || typeof value.hubId !== 'string'
        || typeof value.hubName !== 'string'
        || typeof value.hubSeverity !== 'string'
        || !Array.isArray(value.routeNumbers)
        || typeof value.patternId !== 'string'
        || typeof value.patternLabel !== 'string'
        || typeof value.patternSeverity !== 'string'
        || typeof value.recommendationId !== 'string'
        || typeof value.recommendationType !== 'string'
        || typeof value.recommendationTitle !== 'string'
        || typeof value.recommendationSummary !== 'string'
        || typeof value.recommendationRationale !== 'string'
        || typeof value.fromRouteNumber !== 'string'
        || typeof value.toRouteNumber !== 'string'
        || typeof value.createdAt !== 'string'
        || typeof value.updatedAt !== 'string'
    ) {
        return null;
    }

    return {
        id: value.id,
        teamId: typeof value.teamId === 'string' ? value.teamId : value.teamId ?? null,
        status: value.status === 'reviewing'
            || value.status === 'accepted'
            || value.status === 'implemented'
            ? value.status
            : 'new',
        dayType: value.dayType as DayType,
        timeBand: value.timeBand as NetworkConnectionTimeBand,
        hubId: value.hubId,
        hubName: value.hubName,
        hubStopNames: Array.isArray(value.hubStopNames)
            ? value.hubStopNames.filter((item): item is string => typeof item === 'string')
            : [value.hubName],
        hubSeverity: value.hubSeverity as NetworkConnectionSeverity,
        routeNumbers: value.routeNumbers.filter((item): item is string => typeof item === 'string'),
        patternId: value.patternId,
        patternLabel: value.patternLabel,
        patternSeverity: value.patternSeverity as NetworkConnectionSeverity,
        recommendationId: value.recommendationId,
        recommendationType: value.recommendationType as NetworkConnectionRecommendation['type'],
        recommendationTitle: value.recommendationTitle,
        recommendationSummary: value.recommendationSummary,
        recommendationRationale: value.recommendationRationale,
        fromRouteNumber: value.fromRouteNumber,
        toRouteNumber: value.toRouteNumber,
        opportunityId: typeof value.opportunityId === 'string' ? value.opportunityId : value.opportunityId ?? null,
        opportunityLabel: typeof value.opportunityLabel === 'string' ? value.opportunityLabel : value.opportunityLabel ?? null,
        createdAt: new Date(value.createdAt),
        updatedAt: new Date(value.updatedAt),
    };
}

export function parseSavedNetworkConnectionRecommendations(raw: string): SavedNetworkConnectionRecommendation[] {
    try {
        const parsed = JSON.parse(raw) as unknown;
        if (!Array.isArray(parsed)) return [];

        return parsed
            .map((item) => parseStoredRecommendation(item as Partial<StoredNetworkConnectionRecommendation>))
            .filter((item): item is SavedNetworkConnectionRecommendation => item !== null)
            .sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime());
    } catch {
        return [];
    }
}

export function loadSavedNetworkConnectionRecommendations(teamId?: string | null): SavedNetworkConnectionRecommendation[] {
    if (typeof window === 'undefined') return [];

    const raw = window.localStorage.getItem(getNetworkConnectionRecommendationStorageKey(teamId));
    if (!raw) return [];
    return parseSavedNetworkConnectionRecommendations(raw);
}

export function saveSavedNetworkConnectionRecommendations(
    recommendations: SavedNetworkConnectionRecommendation[],
    teamId?: string | null,
): void {
    if (typeof window === 'undefined') return;

    window.localStorage.setItem(
        getNetworkConnectionRecommendationStorageKey(teamId),
        serializeSavedNetworkConnectionRecommendations(recommendations),
    );
}

export function upsertSavedNetworkConnectionRecommendation(
    recommendation: SavedNetworkConnectionRecommendation,
    teamId?: string | null,
): SavedNetworkConnectionRecommendation[] {
    const existing = loadSavedNetworkConnectionRecommendations(teamId);
    const withoutCurrent = existing.filter((item) => item.id !== recommendation.id);
    const next = [recommendation, ...withoutCurrent]
        .sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime());

    saveSavedNetworkConnectionRecommendations(next, teamId);
    return next;
}

export function removeSavedNetworkConnectionRecommendation(
    recommendationId: string,
    teamId?: string | null,
): SavedNetworkConnectionRecommendation[] {
    const next = loadSavedNetworkConnectionRecommendations(teamId)
        .filter((item) => item.id !== recommendationId);

    saveSavedNetworkConnectionRecommendations(next, teamId);
    return next;
}

export function updateSavedNetworkConnectionRecommendationStatus(
    recommendationId: string,
    status: SavedNetworkConnectionRecommendationStatus,
    teamId?: string | null,
): SavedNetworkConnectionRecommendation[] {
    const next = loadSavedNetworkConnectionRecommendations(teamId)
        .map((item) => item.id === recommendationId
            ? { ...item, status, updatedAt: new Date() }
            : item,
        )
        .sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime());

    saveSavedNetworkConnectionRecommendations(next, teamId);
    return next;
}
