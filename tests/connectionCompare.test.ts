import { describe, expect, it } from 'vitest';
import { columnTags, compareCell, compareConnections, matchTrainColumns } from '../utils/regional-transit/connectionCompare';
import type { ConnectionCell, GoTrainEvent, LocalConnectionRow } from '../utils/regional-transit/types';

const train = (tripId: string, trainNumber: string, minutes: number, direction: GoTrainEvent['direction'] = 'to-go'): GoTrainEvent =>
    ({ id: tripId, tripId, trainNumber, headsign: 'Union', stationStopId: 'AD', direction, minutes });
const cell = (status: ConnectionCell['status'], gapMinutes?: number, tripId = 'bus-1'): ConnectionCell =>
    gapMinutes === undefined ? { status } : { status, gapMinutes, busMinutes: 400, tripId };

describe('compareCell', () => {
    it('ranks Comfortable > Long wait > Tight > No connection', () => {
        expect(compareCell(cell('tight', 3), cell('comfortable', 8)).outcome).toBe('better');
        expect(compareCell(cell('long', 20), cell('comfortable', 12)).outcome).toBe('better');
        expect(compareCell(cell('comfortable', 10), cell('long', 18)).outcome).toBe('worse');
        expect(compareCell(cell('long', 25), cell('tight', 2)).outcome).toBe('worse');
        expect(compareCell(cell('no-connection'), cell('tight', 4)).outcome).toBe('gained');
        expect(compareCell(null, cell('long', 20)).outcome).toBe('gained');
        expect(compareCell(cell('tight', 4), null).outcome).toBe('lost');
        expect(compareCell(cell('no-connection'), cell('no-connection')).outcome).toBe('none');
        expect(compareCell(cell('unavailable'), cell('comfortable', 8)).outcome).toBe('unassessed');
    });

    it('reports the rider wait change and a switch to a different bus within the same band', () => {
        expect(compareCell(cell('comfortable', 8), cell('comfortable', 12))).toMatchObject({ outcome: 'changed', waitDelta: 4, busChanged: false });
        expect(compareCell(cell('comfortable', 8), cell('comfortable', 8, 'bus-2'))).toMatchObject({ outcome: 'changed', waitDelta: 0, busChanged: true });
        expect(compareCell(cell('comfortable', 8), cell('comfortable', 8)).outcome).toBe('unchanged');
    });
});

describe('matchTrainColumns', () => {
    it('pairs trains by number into same, moved, added and removed columns in time order', () => {
        const columns = matchTrainColumns(
            [train('a', '100', 360), train('b', '102', 420), train('c', '104', 480)],
            [train('a', '100', 360), train('b2', '102', 428), train('d', '106', 390)],
        );
        expect(columns.map(column => [column.trainNumber, column.change, column.shiftMinutes])).toEqual([
            ['100', 'same', 0], ['106', 'added', undefined], ['102', 'moved', 8], ['104', 'removed', undefined],
        ]);
        expect([...columnTags(columns, 'before')]).toEqual([['b', 'Moves +8'], ['c', 'Cancelled']]);
        expect([...columnTags(columns, 'after')]).toEqual([['d', 'New'], ['b2', 'Moved +8']]);
    });
});

describe('compareConnections', () => {
    it('re-picks the closest bus after a train moves and counts outcomes', () => {
        const row = { id: 'r', routeNumber: '8A', direction: 'North', version: 1, stopNames: [], stopCodes: [], status: 'ready',
            arrivals: [{ tripId: 'early', minutes: 400, stopName: 'AD', stopCode: '1' }, { tripId: 'late', minutes: 425, stopName: 'AD', stopCode: '1' }],
            departures: [] } as LocalConnectionRow;
        // Train 102 moves 420 → 428: 'early' (20 min, Long wait) gives way to 'late' (3 min, Tight).
        const result = compareConnections([row], [train('b', '102', 420)], [train('b', '102', 428)], 'to-go');
        expect(result.rows[0].cells[0]).toMatchObject({ outcome: 'worse', waitDelta: -17, busChanged: true });
        expect(result.counts.worse).toBe(1);
    });
});
