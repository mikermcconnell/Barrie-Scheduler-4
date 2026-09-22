import { describe, expect, it } from 'vitest';
import { buildParkingLotDataHash, buildParkingStrategyHash, getParkingStrategyRevenueMonths, parseParkingLotDataContext, parseParkingStrategyRoute } from '../utils/parking/parkingStrategyRouting';

describe('parking strategy navigation', () => {
  it('builds canonical history routes inside parking lot data', () => {
    expect(buildParkingStrategyHash()).toBe('#parking/lot-data/history');
    expect(buildParkingStrategyHash({ view: 'map' })).toBe('#parking/lot-data/history/map');
  });
  it.each(['#parking/strategy', '#parking/lot-data/history', '#/parking/strategy', '#/parking/lot-data/history'])('preserves legacy and canonical history context for %s', (path) => {
    const query = '?from=2024-03&to=2025-11&area=location%3AMarina';
    const context = { from: '2024-03', to: '2025-11', area: 'location:Marina' };
    expect(parseParkingStrategyRoute(`${path}${query}`)).toEqual({ ...context, view: 'board' });
    expect(parseParkingStrategyRoute(`${path}/map${query}`)).toEqual({ ...context, view: 'map' });
    expect(buildParkingStrategyHash(parseParkingStrategyRoute(`${path}/map${query}`))).toBe(`#parking/lot-data/history/map${query}`);
  });
  it('round trips period and opaque physical area between board and map', () => {
    const state = { view: 'map' as const, from: '2024-03', to: '2025-11', area: 'location:Marina & Waterfront/1' };
    expect(parseParkingStrategyRoute(buildParkingStrategyHash(state))).toEqual(state);
    expect(parseParkingStrategyRoute(buildParkingStrategyHash({ ...state, view: 'board' }))).toEqual({ ...state, view: 'board' });
  });
  it('rejects invalid and reversed months and overlong or control-character identifiers', () => {
    expect(parseParkingStrategyRoute('#parking/strategy?from=2024-13&to=banana&area=%00')).toMatchObject({ from: undefined, to: undefined, area: undefined });
    expect(parseParkingStrategyRoute('#parking/strategy?from=2025-12&to=2024-01')).toMatchObject({ from: undefined, to: undefined });
    expect(parseParkingStrategyRoute(`#parking/strategy?area=${'x'.repeat(301)}`).area).toBeUndefined();
  });
  it('carries reviewed location and return context only on explicit strategy links', () => {
    const route = { from: '2025-06', to: '2025-08', area: 'domain:MARINA', location: 'city-lot-12' };
    expect(parseParkingLotDataContext(buildParkingLotDataHash(route))).toEqual({ ...route, view: 'map' });
    expect(parseParkingLotDataContext('#parking/lot-data?from=2025-06')).toBeNull();
    expect(parseParkingLotDataContext('#parking/plate-monitor?origin=strategy')).toBeNull();
    expect(parseParkingLotDataContext('#parking/lot-data/history?origin=strategy')).toBeNull();
    expect(buildParkingLotDataHash(route)).toBe('#parking/lot-data?from=2025-06&to=2025-08&area=domain%3AMARINA&origin=strategy&location=city-lot-12');
  });
  it('keeps missing revenue periods empty instead of the legacy empty-array all-history fallback', () => {
    expect(getParkingStrategyRevenueMonths({ from: '2024-03', to: '2024-06' }, ['2026-01'])).toEqual(['2024-03']);
    expect(getParkingStrategyRevenueMonths({ to: '2024-06' }, ['2026-01'])).toEqual(['2024-06']);
    expect(getParkingStrategyRevenueMonths({ from: '2025-06', to: '2025-08' }, ['2025-05', '2025-06', '2025-08', '2025-09'])).toEqual(['2025-06', '2025-08']);
    expect(getParkingStrategyRevenueMonths({}, ['2026-01'])).toBeUndefined();
  });
});
