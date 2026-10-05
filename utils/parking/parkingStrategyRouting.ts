export interface ParkingStrategyRoute {
  view: 'board' | 'map';
  from?: string;
  to?: string;
  area?: string;
}

const validMonth = (value: string | null | undefined): string | undefined =>
  value && /^20\d{2}-(0[1-9]|1[0-2])$/.test(value) ? value : undefined;
const validId = (value: string | null | undefined): string | undefined =>
  value && value.length <= 300 && !/[\u0000-\u001f]/.test(value) ? value : undefined;

export function parseParkingStrategyRoute(hash: string): ParkingStrategyRoute {
  const [path, query = ''] = hash.replace(/^#\/?/, '').split('?');
  const params = new URLSearchParams(query);
  let from = validMonth(params.get('from'));
  let to = validMonth(params.get('to'));
  if (from && to && from > to) { from = undefined; to = undefined; }
  return { view: path === 'parking/lot-data/history/map' || path === 'parking/strategy/map' ? 'map' : 'board', from, to, area: validId(params.get('area')) };
}

export function buildParkingStrategyHash(route: Partial<ParkingStrategyRoute> = {}): string {
  const params = new URLSearchParams();
  if (validMonth(route.from)) params.set('from', route.from!);
  if (validMonth(route.to)) params.set('to', route.to!);
  if (validId(route.area)) params.set('area', route.area!);
  return `#parking/lot-data/history${route.view === 'map' ? '/map' : ''}${params.size ? `?${params}` : ''}`;
}

export function buildParkingLotDataHash(route: Partial<ParkingStrategyRoute> & { location?: string } = {}): string {
  const query = buildParkingStrategyHash(route).split('?')[1];
  const params = new URLSearchParams(query);
  params.set('origin', 'strategy');
  if (validId(route.location)) params.set('location', route.location!);
  return `#parking/lot-data?${params}`;
}

export function parseParkingLotDataContext(hash: string): (ParkingStrategyRoute & { location?: string }) | null {
  const [path, query = ''] = hash.replace(/^#\/?/, '').split('?');
  const params = new URLSearchParams(query);
  if (path !== 'parking/lot-data' || params.get('origin') !== 'strategy') return null;
  return { ...parseParkingStrategyRoute(hash), view: 'map', location: validId(params.get('location')) };
}

/** Revenue's legacy empty month array means all history; retain a real requested month when no uploads overlap. */
export function getParkingStrategyRevenueMonths(route: Partial<ParkingStrategyRoute>, availableMonths: string[]): string[] | undefined {
  if (!route.from && !route.to) return undefined;
  const matched = availableMonths.filter(month => (!route.from || month >= route.from) && (!route.to || month <= route.to));
  return matched.length ? matched : [route.from || route.to!];
}
