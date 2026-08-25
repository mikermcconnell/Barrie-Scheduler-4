import { describe, expect, it } from 'vitest';
import {
    buildCorridorPerformanceRankedRows,
    formatCorridorEvidenceDays,
    getCorridorRankingTitle,
} from '../utils/corridor-performance/corridorPerformancePresentation';
import type { CorridorSpeedSegment, CorridorSpeedStats } from '../utils/gtfs/corridorSpeed';

function makeSegment(id: string): CorridorSpeedSegment {
    return {
        id,
        fromStopId: `${id}-from`,
        toStopId: `${id}-to`,
        fromStopName: `${id} from`,
        toStopName: `${id} to`,
        directionId: 'South',
        routes: ['8A'],
        geometry: [[44.38, -79.69], [44.39, -79.68]],
        lengthMeters: 1_000,
    };
}

function makeStats(runtimeDeltaMin: number, confidenceLevel: 'low' | 'usable'): CorridorSpeedStats {
    return {
        segmentId: 'segment',
        directionId: 'South',
        period: 'am-peak',
        dayType: 'weekday',
        corridorLengthMeters: 1_000,
        sampleCount: confidenceLevel === 'usable' ? 8 : 1,
        lowConfidence: confidenceLevel !== 'usable',
        scheduledRuntimeMin: 10,
        observedRuntimeMin: 10 + runtimeDeltaMin,
        runtimeDeltaMin,
        runtimeDeltaPct: runtimeDeltaMin * 10,
        scheduledSpeedKmh: 6,
        observedSpeedKmh: 5,
        routeBreakdown: [],
        confidenceLevel,
        confidenceReasons: confidenceLevel === 'usable' ? [] : ['Fewer than 8 matched traversals'],
    };
}

describe('corridor performance ranking presentation', () => {
    it('keeps low-confidence outliers out of the decision-ready ranking', () => {
        const usable = makeSegment('usable');
        const lowConfidence = makeSegment('low');
        const ranked = buildCorridorPerformanceRankedRows(
            [lowConfidence, usable],
            new Map([
                [lowConfidence.id, makeStats(20, 'low')],
                [usable.id, makeStats(3, 'usable')],
            ]),
            'delay-minutes',
        );

        expect(ranked.usable.map(row => row.segment.id)).toEqual(['usable']);
        expect(ranked.lowConfidence.map(row => row.segment.id)).toEqual(['low']);
    });

    it('uses metric-specific ranking titles and honest unknown-day labels', () => {
        expect(getCorridorRankingTitle('delay-minutes')).toBe('Highest runtime pressure');
        expect(getCorridorRankingTitle('observed-speed')).toBe('Lowest observed operating speed');
        expect(formatCorridorEvidenceDays(undefined)).toBe('days unknown');
        expect(formatCorridorEvidenceDays(5)).toBe('5 days');
    });
});
