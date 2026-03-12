import { HUBS } from '../platform/platformConfig';

export type RouteCoverageSeedCategory = 'hub' | 'school';

export interface RouteCoverageSeedPoint {
    id: string;
    name: string;
    category: RouteCoverageSeedCategory;
    latitude?: number;
    longitude?: number;
    stopCodes?: string[];
}

const SCHOOL_POINTS: RouteCoverageSeedPoint[] = [
    { id: 'school-barrie-north', name: 'Barrie North Collegiate', category: 'school', latitude: 44.4012, longitude: -79.6901 },
    { id: 'school-eastview', name: 'Eastview Secondary', category: 'school', latitude: 44.4049, longitude: -79.6616 },
    { id: 'school-innisdale', name: 'Innisdale Secondary', category: 'school', latitude: 44.3594, longitude: -79.6854 },
    { id: 'school-maple-ridge', name: 'Maple Ridge Secondary', category: 'school', latitude: 44.3509, longitude: -79.6086 },
    { id: 'school-st-josephs', name: "St. Joseph's High", category: 'school', latitude: 44.4125, longitude: -79.6837 },
    { id: 'school-bear-creek', name: 'Bear Creek Secondary', category: 'school', latitude: 44.3319, longitude: -79.7337 },
    { id: 'school-georgian-college', name: 'Georgian College', category: 'school', latitude: 44.4098, longitude: -79.6634 },
];

const HUB_POINTS: RouteCoverageSeedPoint[] = HUBS.map((hub) => ({
    id: `hub-${hub.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
    name: hub.name,
    category: 'hub',
    stopCodes: [...hub.stopCodes],
}));

export function getRouteCoverageSeedPoints(): RouteCoverageSeedPoint[] {
    return [...HUB_POINTS, ...SCHOOL_POINTS];
}
