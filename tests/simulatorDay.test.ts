// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { parseSTREETSCSV } from '../functions/src/parser';
import {
  buildSimulatorDay,
  expiredSimulatorDays,
  indexGtfsZip,
  selectGtfsSnapshot,
  shouldReplaceSimulatorDay,
  simulatorDayIndex,
  VISIT_PASSENGER_ONLY,
  VISIT_TIMEPOINT,
  type SimulatorDayPointer,
} from '../functions/src/simulatorDay';
import { canReadSimulatorFeed, isSimulatorDayPath } from '../functions/src/sharedWorkspaceData';
import { DEFAULT_PERFORMANCE_LOAD_CAPACITY_CONFIG } from '../functions/src/performanceLoadCapacity';

const DATE = '2026-10-06'; // Tuesday

function gtfsZip(): Uint8Array {
  return zipSync({
    'feed_info.txt': strToU8('feed_publisher_name,feed_version,feed_start_date,feed_end_date\nBarrie Transit,20260920,20260920,20261226\n'),
    'stops.txt': strToU8('stop_id,stop_code,stop_name\nS1,101,"Downtown, Platform 1"\nS2,102,Bayfield\nS3,103,Georgian Mall\n'),
    'routes.txt': strToU8('route_id,route_short_name\nR8,8A\nR2,2A\n'),
    'calendar.txt': strToU8('service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\nWK,1,1,1,1,1,0,0,20260920,20261226\nSAT,0,0,0,0,0,1,0,20260920,20261226\n'),
    'calendar_dates.txt': strToU8('service_id,date,exception_type\n'),
    'trips.txt': strToU8('route_id,service_id,trip_id\nR8,WK,G-100\nR2,WK,G-200\nR8,WK,G-LATE\nR8,SAT,G-SAT\n'),
    'stop_times.txt': strToU8([
      'trip_id,arrival_time,departure_time,stop_id,stop_sequence',
      'G-100,06:00:00,06:00:00,S1,1', 'G-100,06:10:00,06:10:00,S2,2', 'G-100,06:20:00,06:20:00,S3,3',
      'G-200,07:00:00,07:00:00,S1,1', 'G-200,07:15:00,07:15:00,S3,2',
      'G-LATE,24:30:00,24:30:00,S1,1', 'G-LATE,24:40:00,24:40:00,S2,2',
      'G-SAT,06:00:00,06:00:00,S1,1',
    ].join('\n')),
  });
}

const HEADER = 'VehicleID,InBetween,IsTripper,Date,Day,ArrivalTime,ObservedArrivalTime,StopTime,ObservedDepartureTime,WheelchairUsageCount,DepartureLoad,Boardings,Alightings,APCSource,Block,OperatorID,TripName,StopName,RouteName,RouteID,RouteStopIndex,StopID,Direction,IsDetour,StopLat,StopLon,TimePoint,TripID,InternalTripID,TerminalDepartureTime';

interface RowInput {
  vehicle?: string; inBetween?: boolean; date?: string; arr: string; obsArr?: string; dep: string; obsDep?: string;
  load?: number; on?: number; off?: number; apc?: number; route?: string; idx: number; stop: string; tp?: boolean;
  trip: string; start: string;
}

function row(r: RowInput): string {
  return [
    r.vehicle ?? '1201', r.inBetween ? 'Y' : 'N', 'N', r.date ?? '10/06/2026', 'TUESDAY', r.arr, r.obsArr ?? '', r.dep, r.obsDep ?? '',
    0, r.load ?? 0, r.on ?? 0, r.off ?? 0, r.apc ?? 1, 'B1', 'OP-SECRET', 'T', 'Stop', r.route ?? '8A', r.route ?? '8A', r.idx, r.stop,
    'North', 'N', 44.3, -79.6, r.tp === false ? 'N' : 'Y', r.trip, 0, r.start,
  ].join(',');
}

function build(rows: string[], capacity = DEFAULT_PERFORMANCE_LOAD_CAPACITY_CONFIG) {
  const { records } = parseSTREETSCSV([HEADER, ...rows].join('\n'));
  return buildSimulatorDay(records, {
    serviceDate: DATE,
    gtfs: indexGtfsZip(gtfsZip(), DATE),
    gtfsOrigin: 'gtfs-archive:test',
    gtfsCovers: true,
    loadCapacity: capacity,
    source: { name: 'test.csv', sha256: 'abc' },
    generatedAt: '2026-10-07T00:00:00.000Z',
  });
}

describe('simulator day feed builder', () => {
  it('matches trips by GTFS trip id, then by first stop and departure time via stop codes', () => {
    const day = build([
      row({ arr: '06:00', dep: '06:00', obsDep: '06:01', idx: 1, stop: '101', trip: 'G-100', start: '06:00' }),
      row({ arr: '06:10', dep: '06:10', obsDep: '06:12', idx: 2, stop: '102', trip: 'G-100', start: '06:00' }),
      row({ arr: '07:00', dep: '07:00', obsDep: '07:02', idx: 1, stop: '101', route: '2A', trip: 'STREETS-9', start: '07:00' }),
      row({ arr: '07:15', dep: '07:15', obsDep: '07:16', idx: 2, stop: '103', route: '2A', trip: 'STREETS-9', start: '07:00' }),
    ]);
    expect(day.quality).toMatchObject({ trips: 2, tripsMatched: 2 });
    const [a, b] = day.trips;
    expect(a).toMatchObject({ id: 'G-100', gtfsTripId: 'G-100', match: 'trip-id', start: 21600 });
    expect(b).toMatchObject({ id: 'STREETS-9', gtfsTripId: 'G-200', match: 'first-stop-time' });
    expect(a.visits[0]).toEqual(['S1', 1, 21600, 21600, null, 21660, 0, 0, 0, VISIT_TIMEPOINT]);
    expect(day.gtfs).toEqual({ version: '20260920', start: '20260920', end: '20261226', covers: true, origin: 'gtfs-archive:test' });
    expect(day.dayType).toBe('weekday');
  });

  it('puts after-midnight trips on the GTFS clock', () => {
    const day = build([
      row({ arr: '00:30', dep: '00:30', obsDep: '00:31', idx: 1, stop: '101', trip: 'X-LATE', start: '00:30' }),
      row({ arr: '00:40', dep: '00:40', obsDep: '00:43', idx: 2, stop: '102', trip: 'X-LATE', start: '00:30' }),
    ]);
    expect(day.trips[0]).toMatchObject({ gtfsTripId: 'G-LATE', start: 88200 });
    expect(day.trips[0].visits[1][5]).toBe(88980);
  });

  it('keeps the duplicate observation closest to schedule and folds InBetween passengers in', () => {
    const day = build([
      row({ arr: '06:00', dep: '06:00', obsDep: '06:15', idx: 1, stop: '101', trip: 'G-100', start: '06:00', on: 9 }),
      row({ arr: '06:00', dep: '06:00', obsDep: '06:01', idx: 1, stop: '101', trip: 'G-100', start: '06:00', on: 4 }),
      row({ arr: '06:00', dep: '06:00', idx: 1, stop: '101', trip: 'G-100', start: '06:00', on: 2, inBetween: true }),
      row({ arr: '06:05', dep: '06:05', idx: 9, stop: '555', trip: 'G-100', start: '06:00', on: 1, inBetween: true }),
      row({ arr: '06:10', dep: '06:10', obsDep: '06:12', idx: 2, stop: '102', trip: 'G-100', start: '06:00' }),
      row({ arr: '08:00', dep: '08:00', idx: 1, stop: '101', trip: 'ONLY-PASSENGERS', start: '08:00', on: 3, inBetween: true }),
    ]);
    expect(day.quality).toMatchObject({ duplicateRows: 1, inBetweenRows: 3, trips: 1 });
    const visits = day.trips[0].visits;
    expect(visits[0][5]).toBe(21660);
    expect(visits[0][6]).toBe(6);
    const passengerOnly = visits.find(v => v[1] === 9)!;
    expect(passengerOnly).toEqual(['streets:555', 9, 21900, 21900, null, null, 1, 0, null, VISIT_PASSENGER_ONLY]);
  });

  it('drops untrustworthy loads, caps at the vehicle capacity and never copies operator identity', () => {
    const day = build([
      row({ arr: '06:00', dep: '06:00', obsDep: '06:01', idx: 1, stop: '101', trip: 'G-100', start: '06:00', load: 12, apc: 0 }),
      row({ arr: '06:10', dep: '06:10', obsDep: '06:12', idx: 2, stop: '102', trip: 'G-100', start: '06:00', load: 90 }),
    ], { ...DEFAULT_PERFORMANCE_LOAD_CAPACITY_CONFIG, vehicleCapacities: { '1201': 40 } });
    expect(day.trips[0].visits.map(v => v[8])).toEqual([null, 40]);
    expect(day.quality).toMatchObject({ missingApc: 1, loadCapped: 1 });
    expect(JSON.stringify(day)).not.toContain('OP-SECRET');
  });

  it('ignores other service dates', () => {
    const day = build([
      row({ arr: '06:00', dep: '06:00', obsDep: '06:01', idx: 1, stop: '101', trip: 'G-100', start: '06:00' }),
      row({ date: '10/05/2026', arr: '06:00', dep: '06:00', obsDep: '06:01', idx: 1, stop: '101', trip: 'G-100', start: '06:00' }),
    ]);
    expect(day.quality.rows).toBe(1);
  });
});

describe('simulator day feed publication rules', () => {
  const snapshot = (snapshotId: string, fetchedAt: string, start: string, end: string) => ({
    snapshotId, fetchedAt, zipPath: `gtfs-archive/barrie/${snapshotId}.zip`, feedStartDate: start, feedEndDate: end,
  });

  it('picks the newest archived feed covering the date, else the newest feed marked as not covering', () => {
    const snaps = [
      snapshot('old', '2026-05-01T00:00:00Z', '20260503', '20260829'),
      snapshot('fall', '2026-09-18T00:00:00Z', '20260920', '20261226'),
      snapshot('fall-fix', '2026-09-25T00:00:00Z', '20260920', '20261226'),
    ];
    expect(selectGtfsSnapshot(snaps, '2026-10-06')).toMatchObject({ snapshot: { snapshotId: 'fall-fix' }, covers: true });
    expect(selectGtfsSnapshot(snaps, '2026-06-01')).toMatchObject({ snapshot: { snapshotId: 'old' }, covers: true });
    expect(selectGtfsSnapshot(snaps, '2027-02-01')).toMatchObject({ snapshot: { snapshotId: 'fall-fix' }, covers: false });
    expect(selectGtfsSnapshot([], '2026-10-06')).toBeNull();
  });

  it('never lets an older import replace a newer same-day correction', () => {
    expect(shouldReplaceSimulatorDay(undefined, '0001760000000000-a')).toBe(true);
    expect(shouldReplaceSimulatorDay({ sourceRevision: '0001760000000000-a' }, '0001760000005000-b')).toBe(true);
    expect(shouldReplaceSimulatorDay({ sourceRevision: '0001760000005000-b' }, '0001760000000000-a')).toBe(false);
  });

  it('expires days beyond the detailed-history window and lists days newest first', () => {
    expect(expiredSimulatorDays(['2025-09-01', '2025-10-23', '2026-10-06'])).toEqual(['2025-09-01']);
    const pointer = (date: string) => ({
      date, dayType: 'weekday', gtfsVersion: 'v', trips: 1, tripsMatched: 1, storagePath: 'p', sourceRevision: 'r', importId: 'i', generatedAt: 'g',
    }) as SimulatorDayPointer;
    expect(simulatorDayIndex({ '2026-10-05': pointer('2026-10-05'), '2026-10-06': pointer('2026-10-06') }))
      .toEqual([
        { date: '2026-10-06', dayType: 'weekday', gtfsVersion: 'v', trips: 1, tripsMatched: 1 },
        { date: '2026-10-05', dayType: 'weekday', gtfsVersion: 'v', trips: 1, tripsMatched: 1 },
      ]);
  });

  it('only serves day files from the team and date they belong to', () => {
    expect(isSimulatorDayPath('teams/T1/performanceViews/simulator-days/2026-10-06/0001760000000000-abc-1234abcd.json', 'T1', '2026-10-06')).toBe(true);
    expect(isSimulatorDayPath('teams/T2/performanceViews/simulator-days/2026-10-06/x.json', 'T1', '2026-10-06')).toBe(false);
    expect(isSimulatorDayPath('teams/T1/performanceViews/simulator-days/2026-10-06/../../performanceData/x.json', 'T1', '2026-10-06')).toBe(false);
  });

  it('uses the passenger-load access boundary', () => {
    const token = (schedulerAdmin = false) => ({ schedulerAdmin }) as never;
    expect(canReadSimulatorFeed({ accessLevel: 'planner' }, token())).toBe(false);
    expect(canReadSimulatorFeed({ accessLevel: 'admin' }, token())).toBe(true);
    expect(canReadSimulatorFeed({ accessLevel: 'planner', workspaceOverrides: { operationsLoadProfiles: true } }, token())).toBe(true);
    expect(canReadSimulatorFeed({ accessLevel: 'internal', workspaceOverrides: { workspaceOperations: false } }, token())).toBe(false);
    expect(canReadSimulatorFeed(null, token(true))).toBe(true);
  });
});
