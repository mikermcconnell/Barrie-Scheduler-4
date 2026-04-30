import { describe, expect, it } from 'vitest';
import { copyNearestMasterRecoveryToGenerated } from '../utils/schedule/masterRecoveryTransfer';
import type { MasterRouteTable, MasterTrip } from '../utils/parsers/masterScheduleParser';

const trip = (overrides: Partial<MasterTrip>): MasterTrip => ({
  id: overrides.id ?? 'trip',
  blockId: overrides.blockId ?? '1',
  direction: overrides.direction ?? 'North',
  tripNumber: overrides.tripNumber ?? 1,
  rowId: overrides.rowId ?? 1,
  startTime: overrides.startTime ?? 420,
  endTime: overrides.endTime ?? 450,
  recoveryTime: overrides.recoveryTime ?? 0,
  recoveryTimes: overrides.recoveryTimes,
  travelTime: overrides.travelTime ?? 30,
  cycleTime: overrides.cycleTime ?? 30,
  stops: overrides.stops ?? {},
  stopMinutes: overrides.stopMinutes,
  arrivalTimes: overrides.arrivalTimes,
  ...overrides,
});

const table = (overrides: Partial<MasterRouteTable>): MasterRouteTable => ({
  routeName: overrides.routeName ?? '2 (Weekday) (North)',
  stops: overrides.stops ?? ['Park Place', 'Downtown'],
  stopIds: overrides.stopIds ?? {},
  trips: overrides.trips ?? [],
});

describe('copyNearestMasterRecoveryToGenerated', () => {
  it('copies recovery times from the nearest same-direction master trip', () => {
    const generated = table({
      trips: [
        trip({
          id: 'generated-near',
          startTime: 422,
          endTime: 452,
          stops: { 'Park Place': '7:02 AM', Downtown: '7:32 AM' },
          arrivalTimes: { 'Park Place': '7:02 AM', Downtown: '7:32 AM' },
          stopMinutes: { 'Park Place': 422, Downtown: 452 },
        }),
      ],
    });

    const master = table({
      trips: [
        trip({
          id: 'master-near',
          startTime: 420,
          endTime: 456,
          recoveryTime: 6,
          recoveryTimes: { Downtown: 6 },
          stops: { 'Park Place': '7:00 AM', Downtown: '7:36 AM' },
          arrivalTimes: { 'Park Place': '7:00 AM', Downtown: '7:30 AM' },
        }),
        trip({
          id: 'master-far',
          startTime: 480,
          endTime: 513,
          recoveryTime: 3,
          recoveryTimes: { Downtown: 3 },
          stops: { 'Park Place': '8:00 AM', Downtown: '8:33 AM' },
          arrivalTimes: { 'Park Place': '8:00 AM', Downtown: '8:30 AM' },
        }),
      ],
    });

    const result = copyNearestMasterRecoveryToGenerated([generated], [master]);
    const copied = result.tables[0].trips[0];

    expect(result.appliedCount).toBe(1);
    expect(copied.recoveryTimes).toEqual({ Downtown: 6 });
    expect(copied.recoveryTime).toBe(6);
    expect(copied.stops.Downtown).toBe('7:38 AM');
    expect(copied.endTime).toBe(458);
    expect(copied.cycleTime).toBe(36);
    expect(copied.travelTime).toBe(30);
  });

  it('normalizes ARRIVE/DEPART stop names when mapping master recovery', () => {
    const generated = table({
      stops: ['Park Place', 'Downtown Terminal'],
      trips: [
        trip({
          id: 'generated',
          startTime: 600,
          endTime: 630,
          stops: { 'Park Place': '10:00 AM', 'Downtown Terminal': '10:30 AM' },
          arrivalTimes: { 'Park Place': '10:00 AM', 'Downtown Terminal': '10:30 AM' },
          stopMinutes: { 'Park Place': 600, 'Downtown Terminal': 630 },
        }),
      ],
    });

    const master = table({
      stops: ['Park Place', 'ARRIVE Downtown Terminal'],
      trips: [
        trip({
          id: 'master',
          startTime: 599,
          endTime: 634,
          recoveryTime: 4,
          recoveryTimes: { 'ARRIVE Downtown Terminal': 4 },
          stops: { 'Park Place': '9:59 AM', 'ARRIVE Downtown Terminal': '10:34 AM' },
          arrivalTimes: { 'Park Place': '9:59 AM', 'ARRIVE Downtown Terminal': '10:30 AM' },
        }),
      ],
    });

    const result = copyNearestMasterRecoveryToGenerated([generated], [master]);

    expect(result.tables[0].trips[0].recoveryTimes).toEqual({ 'Downtown Terminal': 4 });
    expect(result.tables[0].trips[0].stops['Downtown Terminal']).toBe('10:34 AM');
  });

  it('falls back to total master recovery at the generated trip terminal', () => {
    const generated = table({
      routeName: '2B Dunlop (Weekday) (South)',
      stops: ['Downtown', 'Park Place'],
      trips: [
        trip({
          id: 'generated-south',
          direction: 'South',
          startTime: 455,
          endTime: 485,
          stops: { Downtown: '7:35 AM', 'Park Place': '8:05 AM' },
          arrivalTimes: { Downtown: '7:35 AM', 'Park Place': '8:05 AM' },
          stopMinutes: { Downtown: 455, 'Park Place': 485 },
        }),
      ],
    });

    const master = table({
      routeName: '2B Dunlop (Weekday) (South)',
      stops: ['Downtown', 'Park Place'],
      trips: [
        trip({
          id: 'master-south',
          direction: 'South',
          startTime: 456,
          endTime: 490,
          recoveryTime: 5,
          stops: { Downtown: '7:36 AM', 'Park Place': '8:10 AM' },
          arrivalTimes: { Downtown: '7:36 AM', 'Park Place': '8:05 AM' },
        }),
      ],
    });

    const result = copyNearestMasterRecoveryToGenerated([generated], [master]);

    expect(result.appliedCount).toBe(1);
    expect(result.tables[0].trips[0].recoveryTimes).toEqual({ 'Park Place': 5 });
    expect(result.tables[0].trips[0].stops['Park Place']).toBe('8:10 AM');
  });

  it('copies zero recovery from the nearest master trip instead of keeping generated padding', () => {
    const generated = table({
      trips: [
        trip({
          id: 'generated-with-padding',
          startTime: 420,
          endTime: 455,
          recoveryTime: 5,
          recoveryTimes: { Downtown: 5 },
          stops: { 'Park Place': '7:00 AM', Downtown: '7:35 AM' },
          arrivalTimes: { 'Park Place': '7:00 AM', Downtown: '7:30 AM' },
          stopMinutes: { 'Park Place': 420, Downtown: 455 },
          travelTime: 30,
          cycleTime: 35,
        }),
      ],
    });

    const master = table({
      trips: [
        trip({
          id: 'master-zero',
          startTime: 421,
          endTime: 451,
          recoveryTime: 0,
          stops: { 'Park Place': '7:01 AM', Downtown: '7:31 AM' },
          arrivalTimes: { 'Park Place': '7:01 AM', Downtown: '7:31 AM' },
        }),
      ],
    });

    const result = copyNearestMasterRecoveryToGenerated([generated], [master]);
    const copied = result.tables[0].trips[0];

    expect(result.appliedCount).toBe(1);
    expect(copied.recoveryTimes).toEqual({ Downtown: 0 });
    expect(copied.recoveryTime).toBe(0);
    expect(copied.stops.Downtown).toBe('7:30 AM');
    expect(copied.endTime).toBe(450);
  });
});
