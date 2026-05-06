const BARRIE_PROXIMITY = { lng: -79.69, lat: 44.38 };
const MIN_ADDRESS_QUERY_LENGTH = 3;

export interface RoutePlanner2AddressSuggestion {
    id: string;
    name: string;
    label: string;
    lat: number;
    lng: number;
}

interface MapboxFeature {
    id?: string;
    text?: string;
    place_name?: string;
    center?: [number, number];
}

interface MapboxGeocodingResponse {
    features?: MapboxFeature[];
}

export interface RoutePlanner2AddressSearchOptions {
    token?: string | null;
    fetcher?: typeof fetch;
    signal?: AbortSignal;
    limit?: number;
}

function getMapboxToken(): string | null {
    return import.meta.env?.VITE_MAPBOX_TOKEN ?? null;
}

export function buildRoutePlanner2AddressSearchUrl(
    query: string,
    token: string,
    limit = 5,
): string {
    const url = new URL(`https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json`);
    url.searchParams.set('autocomplete', 'true');
    url.searchParams.set('country', 'ca');
    url.searchParams.set('proximity', `${BARRIE_PROXIMITY.lng},${BARRIE_PROXIMITY.lat}`);
    url.searchParams.set('types', 'address,poi,place,locality,neighborhood');
    url.searchParams.set('limit', String(limit));
    url.searchParams.set('access_token', token);
    return url.toString();
}

function normalizeFeature(feature: MapboxFeature, index: number): RoutePlanner2AddressSuggestion | null {
    const [lng, lat] = feature.center ?? [];
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

    const label = (feature.place_name ?? feature.text ?? '').trim();
    if (!label) return null;

    return {
        id: feature.id ?? `address-${index}`,
        name: (feature.text ?? label.split(',')[0] ?? label).trim(),
        label,
        lat,
        lng,
    };
}

export async function searchRoutePlanner2Addresses(
    query: string,
    options: RoutePlanner2AddressSearchOptions = {},
): Promise<RoutePlanner2AddressSuggestion[]> {
    const trimmedQuery = query.trim();
    if (trimmedQuery.length < MIN_ADDRESS_QUERY_LENGTH) return [];

    const token = options.token ?? getMapboxToken();
    if (!token) return [];

    const fetcher = options.fetcher ?? fetch;
    const response = await fetcher(buildRoutePlanner2AddressSearchUrl(trimmedQuery, token, options.limit), {
        signal: options.signal,
    });

    if (!response.ok) {
        throw new Error(`Mapbox address search returned ${response.status}`);
    }

    const data = await response.json() as MapboxGeocodingResponse;
    return (data.features ?? [])
        .map(normalizeFeature)
        .filter((suggestion): suggestion is RoutePlanner2AddressSuggestion => suggestion !== null);
}
