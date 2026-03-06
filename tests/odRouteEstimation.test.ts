import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { estimateRoutesFromGtfsTextFiles } from '../utils/od-matrix/odRouteEstimation';
import type { ODMatrixDataSummary, ODPairRecord } from '../utils/od-matrix/odMatrixTypes';

function makeSummary(pairs: ODPairRecord[]): ODMatrixDataSummary {
    const stationNames = Array.from(new Set(pairs.flatMap(p => [p.origin, p.destination])));
    return {
        schemaVersion: 1,
        stations: stationNames.map(name => ({
            name,
            totalOrigin: 0,
            totalDestination: 0,
            totalVolume: 0,
        })),
        pairs,
        totalJourneys: pairs.reduce((sum, pair) => sum + pair.journeys, 0),
        stationCount: stationNames.length,
        topPairs: [...pairs].sort((a, b) => b.journeys - a.journeys).slice(0, 100),
        metadata: {
            importedAt: '2026-02-27T00:00:00.000Z',
            importedBy: 'test',
            fileName: 'test',
            stationCount: stationNames.length,
            totalJourneys: pairs.reduce((sum, pair) => sum + pair.journeys, 0),
        },
    };
}

describe('odRouteEstimation', () => {
    const gtfsDir = path.resolve(process.cwd(), 'data', 'gtfs', 'ontario-northland');
    const gtfsFiles = {
        routesText: readFileSync(path.join(gtfsDir, 'routes.txt'), 'utf8'),
        tripsText: readFileSync(path.join(gtfsDir, 'trips.txt'), 'utf8'),
        stopTimesText: readFileSync(path.join(gtfsDir, 'stop_times.txt'), 'utf8'),
        stopsText: readFileSync(path.join(gtfsDir, 'stops.txt'), 'utf8'),
    };

    it('matches long corridors requiring more than one transfer', () => {
        const summary = makeSummary([
            {
                origin: 'UNION STATION BUS TERMINAL',
                destination: 'WINNIPEG',
                journeys: 100,
            },
        ]);

        const result = estimateRoutesFromGtfsTextFiles(gtfsFiles, summary);
        expect(result.totalUnmatched).toBe(0);
        expect(result.totalMatched).toBe(1);

        const match = result.matches[0];
        expect(match.confidence).not.toBe('none');
        expect(match.transfer).toBeDefined();
        expect(match.transfer?.legs?.length ?? 0).toBeGreaterThan(2);
        expect(match.transfer?.transferStops?.length ?? 0).toBe((match.transfer?.legs?.length ?? 1) - 1);
    });

    it('normalizes diacritics and punctuation when matching station names', () => {
        const summary = makeSummary([
            {
                origin: 'VAL COTE',
                destination: 'HEARST',
                journeys: 10,
            },
        ]);

        const result = estimateRoutesFromGtfsTextFiles(gtfsFiles, summary);
        expect(result.totalUnmatched).toBe(0);

        const station = result.stationMatchReport.find(s => s.odName === 'VAL COTE');
        expect(station).toBeDefined();
        expect(station?.matchType).not.toBe('unmatched');
        expect(station?.gtfsStopName).toBe('VAL COTÉ');
    });
});
