import { describe, expect, it } from 'vitest';
import {
    getNetworkConnectionRecommendationStorageKey,
    parseSavedNetworkConnectionRecommendations,
    serializeSavedNetworkConnectionRecommendations,
} from '../utils/network-connections/networkConnectionRecommendationStore';
import type { SavedNetworkConnectionRecommendation } from '../utils/network-connections/networkConnectionRecommendationStore';

function buildSavedRecommendation(): SavedNetworkConnectionRecommendation {
    return {
        id: 'weekday|full_day|hub-a|pattern-a|retime',
        teamId: 'team-1',
        status: 'reviewing',
        dayType: 'Weekday',
        timeBand: 'full_day',
        hubId: 'hub-a',
        hubName: 'Downtown Terminal',
        hubStopNames: ['Downtown Terminal', 'Bayfield Street'],
        hubSeverity: 'weak',
        routeNumbers: ['1', '2'],
        patternId: 'pattern-a',
        patternLabel: '1 North -> 2 South',
        patternSeverity: 'weak',
        recommendationId: 'recommendation-a',
        recommendationType: 'retime',
        recommendationTitle: 'Small retime candidate',
        recommendationSummary: 'A minor schedule shift is likely worth testing here.',
        recommendationRationale: 'Misses cluster within a narrow window.',
        fromRouteNumber: '1',
        toRouteNumber: '2',
        opportunityId: 'trip-1|trip-2|stop-a|stop-b|480|486',
        opportunityLabel: '8:00 AM to 8:06 AM',
        createdAt: new Date('2026-03-11T12:00:00Z'),
        updatedAt: new Date('2026-03-11T12:05:00Z'),
    };
}

describe('networkConnectionRecommendationStore', () => {
    it('builds a stable storage key by team', () => {
        expect(getNetworkConnectionRecommendationStorageKey('team-1')).toBe(
            'scheduler4:network-connections:saved-actions:team-1',
        );
    });

    it('serializes and parses saved recommendation snapshots', () => {
        const recommendation = buildSavedRecommendation();

        const parsed = parseSavedNetworkConnectionRecommendations(
            serializeSavedNetworkConnectionRecommendations([recommendation]),
        );

        expect(parsed).toHaveLength(1);
        expect(parsed[0]?.hubName).toBe(recommendation.hubName);
        expect(parsed[0]?.updatedAt).toBeInstanceOf(Date);
        expect(parsed[0]?.recommendationType).toBe('retime');
        expect(parsed[0]?.status).toBe('reviewing');
        expect(parsed[0]?.hubStopNames).toContain('Bayfield Street');
        expect(parsed[0]?.opportunityLabel).toBe('8:00 AM to 8:06 AM');
    });

    it('returns an empty list for invalid payloads', () => {
        expect(parseSavedNetworkConnectionRecommendations('{"bad":true}')).toEqual([]);
    });
});
