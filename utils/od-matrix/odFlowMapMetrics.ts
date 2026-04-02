import type {
    GeocodeCache,
    GeocodedLocation,
    ODPairRecord,
    ODStation,
} from './odMatrixTypes';
import { isWithinCanada } from './odMatrixGeocoder';

export type ODDirectionFilter = 'all' | 'inbound' | 'outbound';

export interface ODVisibleStopMetrics {
    totalJourneys: number;
    connections: number;
    topOrig?: ODPairRecord;
    topDest?: ODPairRecord;
}

export function buildScopedGeoLookup(
    stations: ODStation[],
    geocodeCache: GeocodeCache | null
): {
    geoLookup: Record<string, GeocodedLocation>;
    outsideCanadaStations: string[];
} {
    const activeStationNames = new Set(stations.map(station => station.name));
    const lookup: Record<string, GeocodedLocation> = {};
    const outside = new Set<string>();

    if (geocodeCache?.stations) {
        Object.entries(geocodeCache.stations).forEach(([name, location]) => {
            if (!activeStationNames.has(name)) return;
            if (isWithinCanada(location.lat, location.lon)) lookup[name] = location;
            else outside.add(name);
        });
    }

    stations.forEach((station) => {
        if (!station.geocode) return;
        if (isWithinCanada(station.geocode.lat, station.geocode.lon)) {
            lookup[station.name] = station.geocode;
        } else {
            outside.add(station.name);
        }
    });

    return {
        geoLookup: lookup,
        outsideCanadaStations: Array.from(outside).sort(),
    };
}

export function getGeocodedPairs(
    pairs: ODPairRecord[],
    geoLookup: Record<string, GeocodedLocation>
): ODPairRecord[] {
    return pairs
        .filter(pair => geoLookup[pair.origin] && geoLookup[pair.destination])
        .sort((a, b) => b.journeys - a.journeys);
}

export function filterODPairs(args: {
    pairs: ODPairRecord[];
    isolatedStation: string | null;
    directionFilter: ODDirectionFilter;
    minJourneys: number;
}): ODPairRecord[] {
    const { pairs, isolatedStation, directionFilter, minJourneys } = args;

    let filtered = pairs.filter(pair => pair.journeys >= minJourneys);
    if (!isolatedStation) return filtered;

    filtered = filtered.filter(
        pair => pair.origin === isolatedStation || pair.destination === isolatedStation,
    );

    if (directionFilter === 'outbound') {
        filtered = filtered.filter(pair => pair.origin === isolatedStation);
    } else if (directionFilter === 'inbound') {
        filtered = filtered.filter(pair => pair.destination === isolatedStation);
    }

    return filtered;
}

export function buildVisibleStopMetrics(
    pairs: ODPairRecord[],
    isolatedStation: string | null
): ODVisibleStopMetrics | null {
    if (!isolatedStation) return null;

    const totalJourneys = pairs.reduce((sum, pair) => sum + pair.journeys, 0);
    const connectedStations = new Set(
        pairs.flatMap(pair => [pair.origin, pair.destination].filter(name => name !== isolatedStation)),
    );
    const topOrig = pairs
        .filter(pair => pair.origin === isolatedStation)
        .sort((a, b) => b.journeys - a.journeys)[0];
    const topDest = pairs
        .filter(pair => pair.destination === isolatedStation)
        .sort((a, b) => b.journeys - a.journeys)[0];

    return {
        totalJourneys,
        connections: connectedStations.size,
        topOrig,
        topDest,
    };
}
