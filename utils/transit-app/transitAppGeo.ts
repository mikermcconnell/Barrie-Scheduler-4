import type { ODPair } from './transitAppTypes';

export const BARRIE_ANALYSIS_BOUNDS = {
    minLat: 44.28,
    maxLat: 44.48,
    minLon: -79.80,
    maxLon: -79.58,
} as const;

export const BARRIE_ANALYSIS_CENTER = {
    lat: 44.38,
    lon: -79.69,
} as const;

export function isInBarrieAnalysisArea(lat: number, lon: number): boolean {
    return Number.isFinite(lat)
        && Number.isFinite(lon)
        && lat >= BARRIE_ANALYSIS_BOUNDS.minLat
        && lat <= BARRIE_ANALYSIS_BOUNDS.maxLat
        && lon >= BARRIE_ANALYSIS_BOUNDS.minLon
        && lon <= BARRIE_ANALYSIS_BOUNDS.maxLon;
}

export function isBarrieOnlyODPair(pair: Pick<ODPair, 'originLat' | 'originLon' | 'destLat' | 'destLon'>): boolean {
    return isInBarrieAnalysisArea(pair.originLat, pair.originLon)
        && isInBarrieAnalysisArea(pair.destLat, pair.destLon);
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2
        + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180)
        * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Describe a lat/lon as a human-readable location relative to Barrie centre. */
export function describeLocationRelativeToBarrie(lat: number, lon: number): string {
    const dist = haversineKm(BARRIE_ANALYSIS_CENTER.lat, BARRIE_ANALYSIS_CENTER.lon, lat, lon);
    const dLat = lat - BARRIE_ANALYSIS_CENTER.lat;
    const dLon = lon - BARRIE_ANALYSIS_CENTER.lon;
    const angle = Math.atan2(dLon, dLat) * 180 / Math.PI;
    let dir: string;
    if (angle >= -22.5 && angle < 22.5) dir = 'N';
    else if (angle >= 22.5 && angle < 67.5) dir = 'NE';
    else if (angle >= 67.5 && angle < 112.5) dir = 'E';
    else if (angle >= 112.5 && angle < 157.5) dir = 'SE';
    else if (angle >= 157.5 || angle < -157.5) dir = 'S';
    else if (angle >= -157.5 && angle < -112.5) dir = 'SW';
    else if (angle >= -112.5 && angle < -67.5) dir = 'W';
    else dir = 'NW';

    if (dist < 1) return 'Central Barrie';
    if (isInBarrieAnalysisArea(lat, lon)) return `${dir} Barrie`;
    return `${dist.toFixed(0)}km ${dir} of Barrie`;
}
