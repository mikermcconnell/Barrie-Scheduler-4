import { describe, expect, it } from 'vitest';
import {
    calculateTransferScopeStats,
    isTransferRowInScope,
} from '../utils/transit-app/transitAppTransferScope';
import type { TransferPairSummary } from '../utils/transit-app/transitAppTypes';

const pair = (overrides: Partial<TransferPairSummary>): TransferPairSummary => ({
    fromRoute: '8A',
    toRoute: 'BR',
    fromRouteId: '8A',
    toRouteId: null,
    transferStopName: 'Barrie South GO Station',
    transferStopId: '725',
    transferStopCode: null,
    transferType: 'barrie_to_go',
    totalCount: 10,
    avgWaitMinutes: 12,
    dominantTimeBands: ['midday'],
    timeBandCounts: { midday: 10 },
    ...overrides,
});

describe('transitAppTransferScope', () => {
    it('classifies Barrie scoped rows from stop ids, stop names, and local route hints', () => {
        expect(isTransferRowInScope(pair({}), 'barrie')).toBe(true);
        expect(isTransferRowInScope(pair({
            transferStopId: null,
            transferStopName: 'Barrie Allandale Terminal',
        }), 'barrie')).toBe(true);
        expect(isTransferRowInScope(pair({
            fromRoute: '8A',
            toRoute: '12',
            transferStopId: null,
            transferStopName: 'Unknown',
        }), 'barrie')).toBe(true);
        expect(isTransferRowInScope(pair({
            fromRoute: '68',
            toRoute: 'BR',
            transferStopId: null,
            transferStopName: 'Aurora GO Bus',
        }), 'regional')).toBe(true);
    });

    it('calculates scoped transfer KPIs from filtered full transfer-pair rows', () => {
        const rows: TransferPairSummary[] = [
            pair({ totalCount: 10, fromRouteId: '8A', toRouteId: null, transferType: 'barrie_to_go' }),
            pair({ fromRoute: '7', toRoute: '8A', totalCount: 5, fromRouteId: '7', toRouteId: '8A', transferType: 'barrie_to_barrie' }),
        ];

        const stats = calculateTransferScopeStats(rows);

        expect(stats.transferEvents).toBe(15);
        expect(stats.goLinkedTransferEvents).toBe(10);
        expect(stats.uniqueRoutePairs).toBe(2);
        expect(stats.routeReferencesTotal).toBe(30);
        expect(stats.routeReferencesMatched).toBe(20);
        expect(stats.routeMatchRate).toBe(0.6667);
    });
});
