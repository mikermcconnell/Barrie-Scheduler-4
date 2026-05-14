const BARRIE_PROXIMITY = { lng: -79.69, lat: 44.38 };
const MIN_ADDRESS_QUERY_LENGTH = 3;

export interface RoutePlanner2AddressSuggestion {
    id: string;
    name: string;
    label: string;
    lat: number;
    lng: number;
}

export interface RoutePlanner2AddressSearchDiagnostic {
    query: string;
    source: 'server' | 'client';
    status: number | null;
    tokenPresent: boolean;
    resultCount: number;
    topResultLabel?: string;
    error?: string;
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
    preferServerProxy?: boolean;
    onDiagnostic?: (diagnostic: RoutePlanner2AddressSearchDiagnostic) => void;
}

function getMapboxToken(): string | null {
    return import.meta.env?.VITE_MAPBOX_TOKEN ?? null;
}

function shouldPreferServerProxy(options: RoutePlanner2AddressSearchOptions): boolean {
    if (typeof options.preferServerProxy === 'boolean') return options.preferServerProxy;
    if (options.token) return false;
    return import.meta.env?.PROD === true;
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

function normalizeSuggestions(features: MapboxFeature[] | undefined): RoutePlanner2AddressSuggestion[] {
    return (features ?? [])
        .map(normalizeFeature)
        .filter((suggestion): suggestion is RoutePlanner2AddressSuggestion => suggestion !== null);
}

async function searchRoutePlanner2AddressesViaServer(
    query: string,
    fetcher: typeof fetch,
    options: RoutePlanner2AddressSearchOptions,
): Promise<RoutePlanner2AddressSuggestion[]> {
    const response = await fetcher('/api/route-planner-geocode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            query,
            limit: options.limit ?? 5,
        }),
        signal: options.signal,
    });

    let payload: {
        suggestions?: RoutePlanner2AddressSuggestion[];
        diagnostic?: RoutePlanner2AddressSearchDiagnostic;
        error?: string;
    } | null = null;

    try {
        payload = await response.json();
    } catch {
        payload = null;
    }

    const suggestions = payload?.suggestions ?? [];
    options.onDiagnostic?.(payload?.diagnostic ?? {
        query,
        source: 'server',
        status: response.status,
        tokenPresent: false,
        resultCount: suggestions.length,
        topResultLabel: suggestions[0]?.label,
        error: response.ok ? undefined : payload?.error ?? `Server geocode returned ${response.status}`,
    });

    if (!response.ok) {
        throw new Error(payload?.error ?? `Server geocode returned ${response.status}`);
    }

    return suggestions;
}

export async function searchRoutePlanner2Addresses(
    query: string,
    options: RoutePlanner2AddressSearchOptions = {},
): Promise<RoutePlanner2AddressSuggestion[]> {
    const trimmedQuery = query.trim();
    if (trimmedQuery.length < MIN_ADDRESS_QUERY_LENGTH) return [];

    const fetcher = options.fetcher ?? fetch;
    if (shouldPreferServerProxy(options)) {
        try {
            return await searchRoutePlanner2AddressesViaServer(trimmedQuery, fetcher, options);
        } catch (error) {
            // Local Vite dev and older deployments may not have the server endpoint.
            // Fall through to the existing client-side Mapbox path when a public token exists.
            options.onDiagnostic?.({
                query: trimmedQuery,
                source: 'server',
                status: null,
                tokenPresent: false,
                resultCount: 0,
                error: error instanceof Error ? error.message : 'Server geocode unavailable',
            });
        }
    }

    const token = options.token ?? getMapboxToken();
    if (!token) {
        options.onDiagnostic?.({
            query: trimmedQuery,
            source: 'client',
            status: null,
            tokenPresent: false,
            resultCount: 0,
            error: 'Mapbox token is not configured',
        });
        return [];
    }

    const response = await fetcher(buildRoutePlanner2AddressSearchUrl(trimmedQuery, token, options.limit), {
        signal: options.signal,
    });

    if (!response.ok) {
        options.onDiagnostic?.({
            query: trimmedQuery,
            source: 'client',
            status: response.status,
            tokenPresent: true,
            resultCount: 0,
            error: `Mapbox address search returned ${response.status}`,
        });
        throw new Error(`Mapbox address search returned ${response.status}`);
    }

    const data = await response.json() as MapboxGeocodingResponse;
    const suggestions = normalizeSuggestions(data.features);
    options.onDiagnostic?.({
        query: trimmedQuery,
        source: 'client',
        status: response.status,
        tokenPresent: true,
        resultCount: suggestions.length,
        topResultLabel: suggestions[0]?.label,
    });
    return suggestions;
}
