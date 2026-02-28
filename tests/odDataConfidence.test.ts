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

    it('only passes geocode coverage when coverage is 100%', () => {
        const partial = buildBaseSummary();
        partial.stations[1].geocode = null;

        const partialReport = computeODConfidenceReport(partial);
        const partialCoverage = partialReport.rows.find(row => row.id === 'geocode_coverage');
        expect(partialCoverage?.status).toBe('fail');

        const full = buildBaseSummary();
        const fullReport = computeODConfidenceReport(full);
        const fullCoverage = fullReport.rows.find(row => row.id === 'geocode_coverage');
        expect(fullCoverage?.status).toBe('pass');
    });

    it('caps level at medium when geocode coverage is a warn', () => {
        const partial = buildBaseSummary();
        // 1 of 2 stations geocoded = 50% → fail. Set to 90% by adding more stations.
        // Simpler: just set one station geocode to valid but make coverage 80-99%
        // Easiest: use the 2-station setup but give one a geocode (50% = fail, not warn)
        // To get a WARN we need coverage >= 80% and < 100%. Build a 10-station dataset.
        const stations = Array.from({ length: 10 }, (_, i) => ({
            name: `Station ${i}`,
            totalOrigin: 1,
            totalDestination: 1,
            totalVolume: 2,
            geocode: i < 9 ? { lat: 44, lon: -79, displayName: `S${i}`, source: 'auto' as const, confidence: 'high' as const } : null,
        }));
        partial.stations = stations;
        partial.stationCount = 10;
        partial.metadata.stationCount = 10;
        partial.totalJourneys = 10;
        partial.metadata.totalJourneys = 10;
        partial.pairs = [{ origin: 'Station 0', destination: 'Station 1', journeys: 10 }];
        partial.topPairs = [{ origin: 'Station 0', destination: 'Station 1', journeys: 10 }];

        const report = computeODConfidenceReport(partial);
        const geocodeRow = report.rows.find(row => row.id === 'geocode_coverage');
        expect(geocodeRow?.status).toBe('warn');
        expect(report.score).toBeLessThan(100);
        expect(report.level).toBe('medium');
    });

    it('treats tied highest-volume pairs as valid top-pair alignment', () => {
        const tied = buildBaseSummary();
        tied.pairs = [
            { origin: 'A', destination: 'B', journeys: 10 },
            { origin: 'B', destination: 'A', journeys: 10 },
        ];
        tied.totalJourneys = 20;
        tied.stations = [
            { ...tied.stations[0], totalOrigin: 10, totalDestination: 10, totalVolume: 20 },
            { ...tied.stations[1], totalOrigin: 10, totalDestination: 10, totalVolume: 20 },
        ];
        tied.metadata.totalJourneys = 20;
        tied.topPairs = [{ origin: 'B', destination: 'A', journeys: 10 }];

        const report = computeODConfidenceReport(tied);
        const topPairCheck = report.rows.find(row => row.id === 'top_pair');
        expect(topPairCheck?.status).toBe('pass');
    });
});
