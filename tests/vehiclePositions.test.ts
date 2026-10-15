// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { compactDay, mergeToday, transit_realtime, decodePings, secondsOfService, serviceDateOf, serviceMidnight, type RawFile } from '../functions/src/vehiclePositions';

type Entity = { id: string; vehicle?: Record<string, unknown> };

const encode = (entities: Entity[]) =>
  transit_realtime.FeedMessage.encode(
    transit_realtime.FeedMessage.fromObject({ header: { gtfsRealtimeVersion: '2.0' }, entity: entities }),
  ).finish();

const NOW = Date.parse('2026-10-14T15:00:00Z'); // 11:00 Toronto (EDT)
const ping = (id: string, over: Record<string, unknown> = {}): Entity => ({
  id,
  vehicle: {
    vehicle: { id },
    trip: { tripId: `trip-${id}`, routeId: '2B', startDate: '20261014' },
    position: { latitude: 44.3911234567, longitude: -79.6903456789, bearing: 90.4 },
    timestamp: Math.floor(NOW / 1000) - 10,
    ...over,
  },
});

describe('decodePings', () => {
  it('builds rows with rounded coordinates and seconds since local midnight', () => {
    const rows = decodePings(encode([ping('1')]), NOW);
    expect(rows).toHaveLength(1);
    const [date, t, vehicle, trip, route, lat, lon, bearing] = rows[0];
    expect(date).toBe('2026-10-14');
    expect(t).toBe(11 * 3600 - 10);
    expect([vehicle, trip, route, bearing]).toEqual(['1', 'trip-1', '2B', 90]);
    // The feed carries float32 coordinates, so compare to about a metre.
    expect(lat).toBeCloseTo(44.391123, 5);
    expect(lon).toBeCloseTo(-79.690346, 5);
    expect(String(lat).split(".")[1].length).toBeLessThanOrEqual(6);
  });

  it('drops entities with no position, no timestamp, old or future timestamps', () => {
    const buf = encode([
      ping('ok'),
      ping('nopos', { position: undefined }),
      ping('nots', { timestamp: undefined }),
      ping('old', { timestamp: Math.floor(NOW / 1000) - 301 }),
      ping('future', { timestamp: Math.floor(NOW / 1000) + 121 }),
      ping('edge', { timestamp: Math.floor(NOW / 1000) + 119 }),
    ]);
    expect(decodePings(buf, NOW).map((r) => r[2]).sort()).toEqual(['edge', 'ok']);
  });

  it('keeps null trip and route for a bus not on a trip', () => {
    const rows = decodePings(encode([ping('1', { trip: undefined })]), NOW);
    expect([rows[0][3], rows[0][4]]).toEqual([null, null]);
  });
});

describe('service date', () => {
  const after = Date.parse('2026-10-15T04:30:00Z'); // 00:30 EDT on the 15th

  it('puts 00:30 local on the previous date when the feed names no start date', () => {
    expect(serviceDateOf(after)).toBe('2026-10-14');
    expect(secondsOfService(after, '2026-10-14')).toBe(24 * 3600 + 30 * 60);
    const rows = decodePings(encode([ping('1', { trip: { tripId: 't' }, timestamp: Math.floor(after / 1000) })]), after);
    expect(rows[0][0]).toBe('2026-10-14');
    expect(rows[0][1]).toBe(24 * 3600 + 30 * 60);
  });

  it('uses the trip start date when present', () => {
    const same = decodePings(encode([ping('1', { timestamp: Math.floor(after / 1000) })]), after);
    expect(same[0][0]).toBe('2026-10-14');
    const next = decodePings(encode([ping('2', { trip: { tripId: 't', startDate: '20261015' }, timestamp: Math.floor(after / 1000) })]), after);
    expect(next[0][0]).toBe('2026-10-15');
    expect(next[0][1]).toBe(30 * 60);
  });

  it('handles the fall DST change (25-hour day)', () => {
    // 2026-11-01: clocks go back at 02:00 EDT, so local midnight is still 04:00Z and 03:00 EST is 4 h in.
    expect(serviceMidnight('2026-11-01')).toBe(Date.parse('2026-11-01T04:00:00Z'));
    const ms = Date.parse('2026-11-01T08:00:00Z'); // 03:00 EST
    expect(secondsOfService(ms, '2026-11-01')).toBe(4 * 3600);
    // 03:00 is before the 04:00 service-day start, so it still belongs to the 31st.
    expect(serviceDateOf(ms)).toBe('2026-10-31');
    expect(serviceDateOf(Date.parse('2026-11-01T09:00:00Z'))).toBe('2026-11-01');
    // The 2nd starts at 05:00Z (EST); 00:30 EST on the 2nd is still the previous service date.
    expect(serviceDateOf(Date.parse('2026-11-02T05:30:00Z'))).toBe('2026-11-01');
  });
});

describe('compactDay', () => {
  const row = (t: number, v: string, date = '2026-10-14'): RawFile['rows'][number] => [date, t, v, 'tr', '2B', 44.39, -79.69, null];

  it('dedupes on (vehicle, t), sorts by vehicle then t and merges fetch times', () => {
    const a = { fetches: [100, 130], rows: [row(200, 'b'), row(100, 'a'), row(100, 'a')] };
    const b = { fetches: [130, 160], rows: [row(150, 'a'), row(200, 'b'), row(100, 'b')] };
    const day = compactDay('2026-10-14', [a, b]);
    expect(day.pings.map((p) => [p[1], p[0]])).toEqual([['a', 100], ['a', 150], ['b', 100], ['b', 200]]);
    expect(day.fetches).toEqual([100, 130, 160]);
    expect(day.schema).toBe(1);
  });

  it('rebases a ping carrying another service date onto the file date', () => {
    const day = compactDay('2026-10-14', [{ fetches: [], rows: [row(60, 'a', '2026-10-15')] }]);
    expect(day.pings[0][0]).toBe(86_400 + 60);
  });

  it('merges into an existing day file', () => {
    const first = compactDay('2026-10-14', [{ fetches: [1], rows: [row(100, 'a')] }]);
    const again = compactDay('2026-10-14', [{ fetches: [1, 2], rows: [row(100, 'a'), row(130, 'a')] }], first);
    expect(again.pings).toHaveLength(2);
    expect(again.fetches).toEqual([1, 2]);
  });
});

describe('mergeToday', () => {
  const raw = (t: number, vehicle = 'v1'): Pick<RawFile, 'fetches' | 'rows'> => ({
    fetches: [t],
    rows: [['2026-10-14', t, vehicle, 'trip', '2B', 44.39, -79.69, 90]],
  });

  it('adds new raw objects and remembers their names', () => {
    const first = mergeToday('2026-10-14', null, [{ name: '110000.json', file: raw(39600) }]);
    const second = mergeToday('2026-10-14', first, [
      { name: '110000.json', file: raw(39600, 'again') },
      { name: '110100.json', file: raw(39660) },
    ]);
    expect(second.merged).toEqual(['110000.json', '110100.json']);
    // The already-merged object is skipped, even if its content differs.
    expect(second.pings.map((p) => [p[0], p[1]])).toEqual([[39600, 'v1'], [39660, 'v1']]);
    expect(second.fetches).toEqual([39600, 39660]);
  });

  it('keeps names after midnight, which sort before morning ones', () => {
    const day = mergeToday('2026-10-14', null, [{ name: '235900.json', file: raw(86340) }, { name: '000100.json', file: raw(86460) }]);
    expect(day.merged).toEqual(['000100.json', '235900.json']);
    expect(day.pings).toHaveLength(2);
  });
});
