import { describe, expect, it } from 'vitest';
import { computeODConfidenceReport } from '../utils/od-matrix/odDataConfidence';
import type { ODMatrixDataSummary } from '../utils/od-matrix/odMatrixTypes';

function buildBaseSummary(): ODMatrixDataSummary {
    return {
        schemaVersion: 1,
        stations: [
            {
                name: 'A',
                totalOrigin: 10,
                totalDestination: 7,
                totalVolume: 17,
                geocode: {
                    lat: 43.1,
                    lon: -79.2,
                    displayName: 'A',
                    source: 'auto',
                    confidence: 'high',
                },
            },
            {
                name: 'B',
                totalOrigin: 7,
                totalDestination: 10,
                totalVolume: 17,
                geocode: {
                    lat: 44.1,
                    lon: -80.2,
                    displayName: 'B',
                    source: 'auto',
                    confidence: 'high',
                },
            },
        ],
        pairs: [
            { origin: 'A', destination: 'B', journeys: 10 },
            { origin: 'B', destination: 'A', journeys: 7 },
        ],
        totalJourneys: 17,
        stationCount: 2,
        topPairs: [
            { origin: 'A', destination: 'B', journeys: 10 },
            { origin: 'B', destination: 'A', journeys: 7 },
        ],
        metadata: {
            importId: '12345',
            importedAt: '2026-02-23T00:00:00.000Z',
            importedBy: 'tester',
            fileName: 'sample.xlsx',
            dateRange: 'Jan 2026',
            stationCount: 2,
            totalJourneys: 17,
        },
    };
}

describe('computeODConfidenceReport', () => {
    it('returns high confidence for consistent datasets', () => {
        const report = computeODConfidenceReport(buildBaseSummary());
        expect(report.score).toBe(100);
        expect(report.level).toBe('high');
        expect(report.failCount).toBe(0);
    });

    it('flags mismatches between uploaded metadata and displayed values', () => {
        const bad = buildBaseSummary();
        bad.metadata.totalJourneys = 20;
        bad.stations[0].totalOrigin = 12;

        const report = computeODConfidenceReport(bad);
        const totalJourneyCheck = report.rows.find(row => row.id === 'total_journeys');
        const originBalanceCheck = report.rows.find(row => row.id === 'origin_balance');

        expect(totalJourneyCheck?.status).toBe('fail');
        expect(originBalanceCheck?.status).toBe('fail');
        expect(report.score).toBeLessThan(90);
    });
});
