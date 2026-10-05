import { describe, expect, it } from 'vitest';
import { fetchBarrieTransitStops } from '../utils/todZones/todCityStops';
import { assignTodZoneMembership } from '../utils/todZones/todZoneGeometry';
import { createTodZoneASeedDraft, ZONE_A_CONNECTION_STOP_IDS, ZONE_A_REFERENCE_STOP_IDS, ZONE_B_CONNECTION_STOP_IDS, ZONE_B_REFERENCE_STOP_IDS, ZONE_C_CONNECTION_STOP_IDS, ZONE_C_REFERENCE_STOP_IDS, ZONE_D_CONNECTION_STOP_IDS, ZONE_D_REFERENCE_STOP_IDS, ZONE_E_CONNECTION_STOP_IDS, ZONE_E_REFERENCE_STOP_IDS, ZONE_F_CONNECTION_STOP_IDS, ZONE_F_REFERENCE_STOP_IDS, ZONE_H_CONNECTION_STOP_IDS, ZONE_H_REFERENCE_STOP_IDS, ZONE_T_CONNECTION_STOP_IDS, ZONE_T_REFERENCE_STOP_IDS } from '../utils/todZones/todZoneSeed';

const describeLive = process.env.TOD_LIVE_GIS === '1' ? describe : describe.skip;

describeLive('TOD zones live City GIS validation', () => {
  it('contains every PDF reference stop and no additional active City stop', async () => {
    const stops = await fetchBarrieTransitStops();
    const draft = createTodZoneASeedDraft();
    const assigned = stops.filter(stop => assignTodZoneMembership(
      stop,
      draft.definitions,
      draft.polygons,
      draft.overrides,
      draft.connectionStops,
    ).zoneCodes.includes('A'));
    const assignedIds = new Set(assigned.map(stop => stop.id));

    expect(stops.length).toBeGreaterThan(500);
    expect(ZONE_A_REFERENCE_STOP_IDS.filter(stopId => assignedIds.has(stopId))).toHaveLength(25);
    expect(ZONE_A_CONNECTION_STOP_IDS.filter(stopId => assignedIds.has(stopId))).toHaveLength(17);
    expect(assigned.filter(stop => ![...ZONE_A_REFERENCE_STOP_IDS, ...ZONE_A_CONNECTION_STOP_IDS].includes(stop.id))).toEqual([]);
  }, 30_000);

  it('contains exactly the Zone B PDF stops and connection stops', async () => {
    const stops = await fetchBarrieTransitStops();
    const draft = createTodZoneASeedDraft();
    const assigned = stops.filter(stop => assignTodZoneMembership(
      stop,
      draft.definitions,
      draft.polygons,
      draft.overrides,
      draft.connectionStops,
    ).zoneCodes.includes('B'));
    const assignedIds = new Set(assigned.map(stop => stop.id));

    expect(ZONE_B_REFERENCE_STOP_IDS.filter(stopId => assignedIds.has(stopId))).toHaveLength(10);
    expect(ZONE_B_CONNECTION_STOP_IDS.filter(stopId => assignedIds.has(stopId))).toHaveLength(13);
    expect(assigned.filter(stop => ![...ZONE_B_REFERENCE_STOP_IDS, ...ZONE_B_CONNECTION_STOP_IDS].includes(stop.id))).toEqual([]);
  }, 30_000);

  it.each([
    ['C', ZONE_C_REFERENCE_STOP_IDS, ZONE_C_CONNECTION_STOP_IDS, ZONE_C_REFERENCE_STOP_IDS.length],
    ['D', ZONE_D_REFERENCE_STOP_IDS, ZONE_D_CONNECTION_STOP_IDS, ZONE_D_REFERENCE_STOP_IDS.length],
    ['E', ZONE_E_REFERENCE_STOP_IDS, ZONE_E_CONNECTION_STOP_IDS, ZONE_E_REFERENCE_STOP_IDS.length],
    ['F', ZONE_F_REFERENCE_STOP_IDS, ZONE_F_CONNECTION_STOP_IDS, ZONE_F_REFERENCE_STOP_IDS.length],
    ['H', ZONE_H_REFERENCE_STOP_IDS, ZONE_H_CONNECTION_STOP_IDS, ZONE_H_REFERENCE_STOP_IDS.length - 1],
    ['T', ZONE_T_REFERENCE_STOP_IDS, ZONE_T_CONNECTION_STOP_IDS, ZONE_T_REFERENCE_STOP_IDS.length],
  ] as const)('contains exactly the active Zone %s PDF stops and connection stops', async (zoneCode, referenceStopIds, connectionStopIds, expectedActiveReferenceCount) => {
    const stops = await fetchBarrieTransitStops();
    const draft = createTodZoneASeedDraft();
    const assigned = stops.filter(stop => assignTodZoneMembership(
      stop,
      draft.definitions,
      draft.polygons,
      draft.overrides,
      draft.connectionStops,
    ).zoneCodes.includes(zoneCode));
    const assignedIds = new Set(assigned.map(stop => stop.id));

    expect(referenceStopIds.filter(stopId => assignedIds.has(stopId))).toHaveLength(expectedActiveReferenceCount);
    expect(connectionStopIds.filter(stopId => assignedIds.has(stopId))).toHaveLength(connectionStopIds.length);
    expect(assigned.filter(stop => ![...referenceStopIds, ...connectionStopIds].includes(stop.id))).toEqual([]);
  }, 30_000);
});
