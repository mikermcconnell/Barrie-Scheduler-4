import { describe, expect, it } from 'vitest';
import {
    getTransferPairDisplayCount,
    groupTransferPatternsByRoute,
    rankConnectionTargetsForScope,
    rankTransferPairsForMap,
} from '../utils/transit-app/transitAppTransferUiMetrics';
import type {
    TransferConnectionTargetCandidate,
    TransferPairSummary,
    TransferPattern,
} from '../utils/transit-app/transitAppTypes';

const pair = (overrides: Partial<TransferPairSummary>): TransferPairSummary => ({
    fromRoute: '1',
    toRoute: '2',
    fromRouteId: '1',
    toRouteId: '2',
    transferStopName: 'Downtown Hub',
    transferStopId: '100',
    transferStopCode: null,
    transferType: 'barrie_to_barrie',
    totalCount: 1,
    avgWaitMinutes: 5,
    dominantTimeBands: ['midday'],
    timeBandCounts: { midday: 1 },
    ...overrides,
});

const target = (overrides: Partial<TransferConnectionTargetCandidate>): TransferConnectionTargetCandidate => ({
    fromRoute: '1',
    toRoute: '2',
    fromRouteId: '1',
    toRouteId: '2',
    locationStopName: 'Downtown Hub',
    locationStopId: '100',
    locationStopCode: null,
    timeBands: ['midday'],
    totalTransfers: 1,
    priorityTier: 'low',
    goLinked: false,
    ...overrides,
});

const pattern = (overrides: Partial<TransferPattern>): TransferPattern => ({
    fromRoute: '1',
    toRoute: '2',
    fromStop: 'A',
    toStop: 'B',
    count: 1,
    avgWaitMinutes: 5,
    minWaitMinutes: 5,
    maxWaitMinutes: 5,
    ...overrides,
});

describe('transitAppTransferUiMetrics', () => {
    it('ranks map pairs after the selected time-band count is applied', () => {
        const ranked = rankTransferPairsForMap([
            pair({
                fromRoute: 'overall-top',
                totalCount: 100,
                dominantTimeBands: ['am_peak'],
                timeBandCounts: { am_peak: 100 },
            }),
            pair({
                fromRoute: 'pm-top',
                totalCount: 60,
                dominantTimeBands: ['pm_peak'],
                timeBandCounts: { pm_peak: 60 },
            }),
            pair({
                fromRoute: 'pm-second',
                totalCount: 40,
                dominantTimeBands: ['pm_peak'],
                timeBandCounts: { pm_peak: 40 },
            }),
        ], 'pm_peak', 1);

        expect(ranked).toHaveLength(1);
        expect(ranked[0].fromRoute).toBe('pm-top');
        expect(getTransferPairDisplayCount(ranked[0], 'pm_peak')).toBe(60);
    });

    it('supports overnight map filtering', () => {
        const overnightPair = pair({
            totalCount: 20,
            dominantTimeBands: ['overnight'],
            timeBandCounts: { overnight: 12, midday: 8 },
        });

        expect(getTransferPairDisplayCount(overnightPair, 'overnight')).toBe(12);
    });

    it('recomputes connection target priority after scope filtering and ranking', () => {
        const ranked = rankConnectionTargetsForScope([
            target({ fromRoute: 'low-global', totalTransfers: 10, priorityTier: 'low' }),
            target({ fromRoute: 'go', totalTransfers: 1, goLinked: true, priorityTier: 'low' }),
            target({ fromRoute: 'top-scoped', totalTransfers: 20, priorityTier: 'low' }),
        ]);

        expect(ranked[0].fromRoute).toBe('top-scoped');
        expect(ranked[0].priorityTier).toBe('high');
        expect(ranked[1].priorityTier).toBe('high');
        expect(ranked[2].fromRoute).toBe('go');
        expect(ranked[2].priorityTier).toBe('high');
    });

    it('groups transfer patterns from every scoped row, not only the visible display cap', () => {
        const grouped = groupTransferPatternsByRoute([
            pattern({ fromRoute: '1', toRoute: '2', count: 10, avgWaitMinutes: 3, totalWaitMinutes: 30 }),
            pattern({ fromRoute: '1', toRoute: '2', count: 5, avgWaitMinutes: 20, totalWaitMinutes: 100 }),
            pattern({ fromRoute: '3', toRoute: '4', count: 2, avgWaitMinutes: 7, totalWaitMinutes: 14 }),
        ]);

        expect(grouped[0].routePair).toBe('1 → 2');
        expect(grouped[0].totalCount).toBe(15);
        expect(grouped[0].avgWait).toBeCloseTo(130 / 15);
    });
});
