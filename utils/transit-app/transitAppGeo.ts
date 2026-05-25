import type { ODPair } from './transitAppTypes';

export const BARRIE_ANALYSIS_BOUNDS = {
    minLat: 44.28,
    maxLat: 44.48,
    minLon: -79.80,
    maxLon: -79.58,
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
