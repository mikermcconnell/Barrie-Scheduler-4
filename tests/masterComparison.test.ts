import { describe, expect, it } from 'vitest';
import type { MasterRouteTable, MasterTrip } from '../utils/parsers/masterScheduleParser';
import {
    buildDetailedMasterComparison,
    buildMasterComparison,
    buildTripKey
} from '../utils/schedule/masterComparison';

const makeTrip = (
    id: string,
    direction: 'North' | 'South',
    startTime: number,
    overrides: Partial<MasterTrip> = {},
): MasterTrip => ({
    id,
    blockId: direction === 'North' ? 'B1' : 'B2',
    tripNumber: 1,
    rowId: 1,
    direction,
    startTime,
    endTime: startTime + 30,
    cycleTime: 30,
    travelTime: 30,
    recoveryTime: 0,
    stops: { Terminal: '6:00 AM' },
    arrivalTimes: { Terminal: '6:00 AM' },
    recoveryTimes: {},
    ...overrides,
});

const makeTable = (
    routeName: string,
    trips: MasterTrip[]
): MasterRouteTable => ({
    routeName,
    stops: ['Terminal'],
    stopIds: {},
    trips
});

describe('buildMasterComparison', () => {
    it('matches legacy post-midnight clock times to adjacent late-night master trips', () => {
        const current = [makeTable('10 (North)', [
            makeTrip('draft-after-midnight', 'North', 1, { endTime: 31 }),
        ])];
        const master = [makeTable('10 (North)', [
            makeTrip('master-before-midnight', 'North', 1439, { endTime: 1469 }),
        ])];

        const detailed = buildDetailedMasterComparison(current, master);
        const comparison = detailed.currentTripComparisons.get(
            buildTripKey('North', 'draft-after-midnight', '10 (North)')
        );

        expect(comparison?.status).toBe('matched');
        expect(comparison?.status === 'matched' ? comparison.masterTrip.id : null)
            .toBe('master-before-midnight');
        expect(detailed.removedMasterTrips).toHaveLength(0);
    });

    it('orders removed trips by service day and finds cross-midnight replacement hints', () => {
        const current = [makeTable('10 (North)', [
            makeTrip('possible-after-midnight', 'North', 20, { endTime: 50 }),
        ])];
        const master = [makeTable('10 (North)', [
            makeTrip('removed-late-night', 'North', 120, { endTime: 150 }),
            makeTrip('removed-evening', 'North', 1380, { endTime: 1410 }),
            makeTrip('removed-near-midnight', 'North', 1430, { endTime: 1460 }),
        ])];

        const detailed = buildDetailedMasterComparison(current, master);

        expect(detailed.removedMasterTrips.map(entry => entry.masterTrip.id)).toEqual([
            'removed-evening',
            'removed-near-midnight',
            'removed-late-night',
        ]);
        const nearMidnight = detailed.removedMasterTrips.find(
            entry => entry.masterTrip.id === 'removed-near-midnight'
        );
        expect(nearMidnight?.possibleReplacements[0]).toEqual(expect.objectContaining({
            currentTripId: 'possible-after-midnight',
            diffMinutes: 30,
        }));
    });

    it('prefers exact same-direction trip IDs even when times drift outside fallback threshold', () => {
        const current = [
            makeTable('10 (North)', [makeTrip('1001', 'North', 380)]),
            makeTable('10 (South)', [makeTrip('2001', 'South', 420)])
        ];
        const master = [
            makeTable('10 (North)', [makeTrip('1001', 'North', 360)]),
            makeTable('10 (South)', [makeTrip('2001', 'South', 400)])
        ];

        const result = buildMasterComparison(current, master);

        expect(result.masterMatchMap.get('North::1001')?.id).toBe('1001');
        expect(result.masterMatchMap.get('South::2001')?.id).toBe('2001');
        expect(result.unmatchedMasterTrips).toHaveLength(0);
        expect(result.masterShiftByDir.North).toBeUndefined();
        expect(result.masterShiftByDir.South).toBeUndefined();
    });

    it('falls back to shift-aware time matching when trip IDs do not line up', () => {
        const current = [
            makeTable('10 (North)', [
                makeTrip('draft-a', 'North', 365),
                makeTrip('draft-b', 'North', 425)
            ])
        ];
        const master = [
            makeTable('10 (North)', [
                makeTrip('master-a', 'North', 360),
                makeTrip('master-b', 'North', 420)
            ])
        ];

        const result = buildMasterComparison(current, master);

        expect(result.masterMatchMap.get('North::draft-a')?.id).toBe('master-a');
        expect(result.masterMatchMap.get('North::draft-b')?.id).toBe('master-b');
        expect(result.masterShiftByDir.North).toBe(5);
        expect(result.unmatchedMasterTrips).toHaveLength(0);
    });

    it('does not mark an exact-time trip as removed when other trips establish a larger global shift', () => {
        const current = [
            makeTable('2 (Weekday) (North)', [
                makeTrip('draft-exact', 'North', 360),
                makeTrip('draft-shifted-a', 'North', 434),
                makeTrip('draft-shifted-b', 'North', 494),
            ])
        ];
        const master = [
            makeTable('2 (Weekday) (North)', [
                makeTrip('master-exact', 'North', 360),
                makeTrip('master-shifted-a', 'North', 420),
                makeTrip('master-shifted-b', 'North', 480),
            ])
        ];

        const result = buildDetailedMasterComparison(current, master);
        const exactEntry = result.currentTripComparisons.get(buildTripKey('North', 'draft-exact', '2 (Weekday) (North)'));

        expect(result.masterShiftByDir.North).toBe(14);
        expect(exactEntry?.status).toBe('matched');
        if (exactEntry?.status !== 'matched') throw new Error('Expected exact-time trip to match');
        expect(exactEntry.masterTrip.id).toBe('master-exact');
        expect(exactEntry.shiftMinutes).toBe(0);
        expect(result.currentTripComparisons.get(buildTripKey('North', 'draft-shifted-a', '2 (Weekday) (North)'))?.status).toBe('matched');
        expect(result.removedMasterTrips).toHaveLength(0);
    });

    it('does not treat a single small timing difference as a global shift', () => {
        const current = [
            makeTable('10 (North)', [makeTrip('draft-a', 'North', 365)])
        ];
        const master = [
            makeTable('10 (North)', [makeTrip('master-a', 'North', 360)])
        ];

        const result = buildDetailedMasterComparison(current, master);
        const entry = result.currentTripComparisons.get(buildTripKey('North', 'draft-a', '10 (North)'));

        expect(entry?.status).toBe('matched');
        if (entry?.status !== 'matched') throw new Error('Expected matched trip');
        expect(entry.shiftMinutes).toBe(0);
        expect(result.masterShiftByDir.North).toBeUndefined();
        expect(result.removedMasterTrips).toHaveLength(0);
    });

    it('does not time-match trips across different routes', () => {
        const current = [
            makeTable('7 (North)', [makeTrip('draft-route-7', 'North', 361)])
        ];
        const master = [
            makeTable('10 (North)', [makeTrip('master-route-10', 'North', 360)])
        ];

        const result = buildDetailedMasterComparison(current, master);

        expect(result.currentTripComparisons.get(buildTripKey('North', 'draft-route-7', '7 (North)'))?.status).toBe('new');
        expect(result.removedMasterTrips.map(entry => entry.masterTrip.id)).toEqual(['master-route-10']);
    });

    it('keeps same-direction trip IDs isolated across routes', () => {
        const current = [
            makeTable('7 (North)', [makeTrip('shared-trip', 'North', 360)]),
            makeTable('10 (North)', [makeTrip('shared-trip', 'North', 480)]),
        ];
        const master = [
            makeTable('7 (North)', [makeTrip('shared-trip', 'North', 360)]),
            makeTable('10 (North)', [makeTrip('shared-trip', 'North', 420)]),
        ];

        const result = buildDetailedMasterComparison(current, master);
        const route7Entry = result.currentTripComparisons.get(buildTripKey('North', 'shared-trip', '7 (North)'));
        const route10Entry = result.currentTripComparisons.get(buildTripKey('North', 'shared-trip', '10 (North)'));

        expect(route7Entry?.status).toBe('matched');
        expect(route10Entry?.status).toBe('matched');
        if (route7Entry?.status !== 'matched' || route10Entry?.status !== 'matched') {
            throw new Error('Expected both route-scoped shared trip IDs to match');
        }
        expect(route7Entry.masterTrip.startTime).toBe(360);
        expect(route10Entry.masterTrip.startTime).toBe(420);
        expect(result.removedMasterTrips).toHaveLength(0);
    });

    it('adds possible replacement hints to unmatched master trips near new service', () => {
        const current = [
            makeTable('10 (North)', [makeTrip('draft-later', 'North', 390)])
        ];
        const master = [
            makeTable('10 (North)', [makeTrip('master-original', 'North', 360)])
        ];

        const result = buildDetailedMasterComparison(current, master);

        expect(result.currentTripComparisons.get(buildTripKey('North', 'draft-later', '10 (North)'))?.status).toBe('new');
        expect(result.removedMasterTrips).toHaveLength(1);
        expect(result.removedMasterTrips[0].possibleReplacements).toEqual([
            expect.objectContaining({
                currentTripId: 'draft-later',
                diffMinutes: 30,
            }),
        ]);
    });

    it('uses end time and travel time to choose the better same-start candidate', () => {
        const current = [
            makeTable('10 (North)', [makeTrip('draft-a', 'North', 365)])
        ];
        const master = [
            makeTable('10 (North)', [
                makeTrip('master-wrong-duration', 'North', 360, {
                    endTime: 430,
                    travelTime: 70,
                    cycleTime: 70,
                }),
                makeTrip('master-right-duration', 'North', 360),
            ])
        ];

        const result = buildDetailedMasterComparison(current, master);
        const entry = result.currentTripComparisons.get(buildTripKey('North', 'draft-a', '10 (North)'));

        expect(entry?.status).toBe('matched');
        if (entry?.status !== 'matched') throw new Error('Expected a matched comparison entry');
        expect(entry.masterTrip.id).toBe('master-right-duration');
    });

    it('keeps north and south trip IDs isolated during exact matching', () => {
        const current = [
            makeTable('10 (North)', [makeTrip('shared-trip', 'North', 360)]),
            makeTable('10 (South)', [makeTrip('shared-trip', 'South', 480)])
        ];
        const master = [
            makeTable('10 (North)', [makeTrip('shared-trip', 'North', 300)]),
            makeTable('10 (South)', [makeTrip('shared-trip', 'South', 540)])
        ];

        const result = buildMasterComparison(current, master);

        expect(result.masterMatchMap.get('North::shared-trip')?.startTime).toBe(300);
        expect(result.masterMatchMap.get('South::shared-trip')?.startTime).toBe(540);
        expect(result.unmatchedMasterTrips).toHaveLength(0);
    });

    it('prefers exact lineage matches before falling back to trip ids or time heuristics', () => {
        const current = [
            makeTable('10 (North)', [{
                ...makeTrip('draft-1', 'North', 430),
                lineageId: 'ln:master-1',
            }]),
        ];
        const master = [
            makeTable('10 (North)', [{
                ...makeTrip('master-1', 'North', 360),
                lineageId: 'ln:master-1',
            }]),
        ];

        const result = buildMasterComparison(current, master);

        expect(result.masterMatchMap.get('North::draft-1')?.id).toBe('master-1');
        expect(result.unmatchedMasterTrips).toHaveLength(0);
    });

    it('returns detailed match metadata for time-shift matches', () => {
        const current = [
            makeTable('10 (North)', [
                makeTrip('draft-a', 'North', 365),
                makeTrip('draft-b', 'North', 425)
            ])
        ];
        const master = [
            makeTable('10 (North)', [
                makeTrip('master-a', 'North', 360),
                makeTrip('master-b', 'North', 420)
            ])
        ];

        const result = buildDetailedMasterComparison(current, master);
        const entry = result.currentTripComparisons.get(buildTripKey('North', 'draft-a', '10 (North)'));

        expect(entry?.status).toBe('matched');
        if (entry?.status !== 'matched') {
            throw new Error('Expected a matched comparison entry.');
        }

        expect(entry.matchMethod).toBe('time-shift');
        expect(entry.confidence).toBe('medium');
        expect(entry.shiftMinutes).toBe(5);
        expect(entry.reason).toContain('time alignment');
        expect(result.removedMasterTrips).toHaveLength(0);
    });

    it('does not reuse the same master trip for multiple current trips', () => {
        const current = [
            makeTable('10 (North)', [
                makeTrip('draft-a', 'North', 365),
                makeTrip('draft-b', 'North', 367)
            ])
        ];
        const master = [
            makeTable('10 (North)', [makeTrip('master-a', 'North', 360)])
        ];

        const result = buildDetailedMasterComparison(current, master);

        expect(result.currentTripComparisons.get(buildTripKey('North', 'draft-a', '10 (North)'))?.status).toBe('matched');
        expect(result.currentTripComparisons.get(buildTripKey('North', 'draft-b', '10 (North)'))?.status).toBe('new');
        expect(result.removedMasterTrips).toHaveLength(0);
    });

    it('marks uncertain time-based matches as ambiguous instead of forcing a confident match', () => {
        const current = [
            makeTable('10 (North)', [makeTrip('draft-a', 'North', 365)])
        ];
        const master = [
            makeTable('10 (North)', [
                makeTrip('master-a', 'North', 360),
                makeTrip('master-b', 'North', 361)
            ])
        ];

        const result = buildDetailedMasterComparison(current, master);
        const entry = result.currentTripComparisons.get(buildTripKey('North', 'draft-a', '10 (North)'));

        expect(entry?.status).toBe('ambiguous');
        if (entry?.status !== 'ambiguous') {
            throw new Error('Expected an ambiguous comparison entry.');
        }

        expect(entry.candidates).toHaveLength(2);
        expect(entry.reason).toContain('Review');
        expect(result.removedMasterTrips).toHaveLength(0);
    });
});
