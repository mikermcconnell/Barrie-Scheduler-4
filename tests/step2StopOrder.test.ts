import { describe, expect, it } from 'vitest';
import {
    buildStep2StopOrderHealth,
    extractStopOrderDirectionStops,
} from '../components/NewSchedule/utils/step2StopOrder';

describe('step2StopOrder', () => {
    it('extracts direction stop names from a resolver result', () => {
        expect(extractStopOrderDirectionStops(null)).toBeUndefined();

        expect(extractStopOrderDirectionStops({
            decision: 'accept',
            confidence: 'high',
            warnings: [],
            resolvedDirections: {
                North: {
                    source: 'observed-midday-pattern',
                    confidence: 'high',
                    stopIds: ['1', '2'],
                    stopNames: [' Park Place ', 'Downtown Hub'],
                    tripCountUsed: 4,
                    dayCountUsed: 2,
                    middayTripCount: 2,
                    alternatePatternCount: 0,
                    changedFromPrevious: false,
                    changeSeverity: 'none',
                    warnings: [],
                },
                South: {
                    source: 'observed-dominant-pattern',
                    confidence: 'medium',
                    stopIds: ['2', '1'],
                    stopNames: ['Downtown Hub', 'Park Place'],
                    tripCountUsed: 5,
                    dayCountUsed: 3,
                    middayTripCount: 1,
                    alternatePatternCount: 1,
                    changedFromPrevious: false,
                    changeSeverity: 'none',
                    warnings: [],
                },
                Loop: {
                    source: 'observed-dominant-pattern',
                    confidence: 'high',
                    stopIds: ['1', '2', '1'],
                    stopNames: ['Downtown', 'Georgian College', 'Downtown'],
                    tripCountUsed: 3,
                    dayCountUsed: 2,
                    middayTripCount: 1,
                    alternatePatternCount: 0,
                    changedFromPrevious: false,
                    changeSeverity: 'none',
                    warnings: [],
                },
            },
        } as any)).toEqual({
            North: [' Park Place ', 'Downtown Hub'],
            South: ['Downtown Hub', 'Park Place'],
            Loop: ['Downtown', 'Georgian College', 'Downtown'],
        });
    });

    it('marks accepted runtime-derived stop order as driving Step 2 planning', () => {
        const health = buildStep2StopOrderHealth({
            decision: 'accept',
            confidence: 'high',
            warnings: [],
            resolvedDirections: {
                North: {
                    source: 'observed-midday-pattern',
                    confidence: 'high',
                    stopIds: ['1', '2'],
                    stopNames: ['Park Place', 'Downtown Hub'],
                    tripCountUsed: 4,
                    dayCountUsed: 2,
                    middayTripCount: 2,
                    alternatePatternCount: 0,
                    changedFromPrevious: false,
                    changeSeverity: 'none',
                    warnings: [],
                },
            },
        } as any, 'runtime-derived');

        expect(health).toMatchObject({
            decision: 'accept',
            confidence: 'high',
            sourceUsed: 'runtime-derived',
            usedForPlanning: true,
            summary: 'Dynamic stop order was accepted and is now driving the Step 2 route chain.',
            warnings: [],
        });
        expect(health?.directionStats.North).toEqual({
            tripCountUsed: 4,
            dayCountUsed: 2,
            middayTripCount: 2,
        });
    });

    it('includes loop direction stats in stop-order health', () => {
        const health = buildStep2StopOrderHealth({
            decision: 'accept',
            confidence: 'high',
            warnings: [],
            resolvedDirections: {
                Loop: {
                    source: 'observed-midday-pattern',
                    confidence: 'high',
                    stopIds: ['1', '2', '1'],
                    stopNames: ['Downtown', 'Georgian College', 'Downtown'],
                    tripCountUsed: 6,
                    dayCountUsed: 3,
                    middayTripCount: 2,
                    alternatePatternCount: 0,
                    changedFromPrevious: false,
                    changeSeverity: 'none',
                    warnings: [],
                },
            },
        } as any, 'runtime-derived');

        expect(health?.directionStats.Loop).toEqual({
            tripCountUsed: 6,
            dayCountUsed: 3,
            middayTripCount: 2,
        });
    });

    it('keeps master fallback in place when the resolver returns review', () => {
        const health = buildStep2StopOrderHealth({
            decision: 'review',
            confidence: 'medium',
            warnings: ['Dominant pattern changed materially.'],
            resolvedDirections: {
                South: {
                    source: 'master-fallback',
                    confidence: 'medium',
                    stopIds: ['2', '1'],
                    stopNames: ['Downtown Hub', 'Park Place'],
                    tripCountUsed: 3,
                    dayCountUsed: 1,
                    middayTripCount: 0,
                    alternatePatternCount: 1,
                    changedFromPrevious: true,
                    changeSeverity: 'major',
                    warnings: ['Dominant pattern changed materially.'],
                },
            },
        } as any, 'master-fallback');

        expect(health).toMatchObject({
            usedForPlanning: false,
            sourceUsed: 'master-fallback',
            summary: 'Dynamic stop order returned review, so Step 2 kept the master stop chain for planning.',
        });
        expect(health?.warnings).toEqual([
            'Dynamic stop order is review (medium confidence).',
            'Dominant pattern changed materially.',
        ]);
    });

    it('surfaces a blocked stop-order result when no planning chain is available', () => {
        const health = buildStep2StopOrderHealth({
            decision: 'blocked',
            confidence: 'low',
            warnings: ['One direction is missing entirely.'],
            resolvedDirections: {},
        } as any, 'none');

        expect(health).toMatchObject({
            usedForPlanning: false,
            sourceUsed: 'none',
            summary: 'Dynamic stop order could not provide a planning stop chain for this Step 2 run.',
        });
        expect(health?.warnings).toEqual([
            'Dynamic stop order is blocked (low confidence).',
            'One direction is missing entirely.',
        ]);
    });
});
