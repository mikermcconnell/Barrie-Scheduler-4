import { describe, expect, it } from 'vitest';
import type { MasterTrip } from '../utils/parsers/masterScheduleParser';
import { calculateGridTravelMinutes, isStationaryTravelSegment } from '../utils/schedule/travelTimeGridUtils';

const buildTrip = (overrides: Partial<MasterTrip> = {}): MasterTrip => ({
    id: 'trip-1',
    blockId: '12-1',
    direction: 'North',
    tripNumber: 1,
    rowId: 0,
    startTime: 23 * 60 + 53,
    endTime: 24 * 60 + 33,
    recoveryTime: 0,
    travelTime: 40,
    cycleTime: 40,
    stops: {
        Downtown: '11:53 PM',
        Terminal: '12:33 AM',
    },
    arrivalTimes: {
        Downtown: '11:53 PM',
        Terminal: '12:33 AM',
    },
    ...overrides,
});

describe('travelTimeGridUtils', () => {
    it('treats same-stop segments as stationary', () => {
        expect(isStationaryTravelSegment('Downtown Hub to Downtown Hub (Platform 2)')).toBe(true);
        expect(isStationaryTravelSegment('Downtown Hub to Park Place')).toBe(false);
    });

    it('keeps post-midnight travel positive in the route grid', () => {
        const trip = buildTrip();

        expect(calculateGridTravelMinutes(trip, 'Downtown', 'Terminal')).toBe(40);
    });

    it('prefers numeric departure minutes when they are available', () => {
        const trip = buildTrip({
            startTime: 24 * 60 + 5,
            stopMinutes: {
                Downtown: 24 * 60 + 5,
                Terminal: 24 * 60 + 41,
            },
            stops: {
                Downtown: '12:05 AM',
                Terminal: '12:46 AM',
            },
            arrivalTimes: {
                Downtown: '12:05 AM',
                Terminal: '12:41 AM',
            },
        });

        expect(calculateGridTravelMinutes(trip, 'Downtown', 'Terminal')).toBe(36);
    });
});
