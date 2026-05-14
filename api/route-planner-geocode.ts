import type { VercelRequest, VercelResponse } from '@vercel/node';
import { checkRateLimit, getRequestIp } from '../lib/apiSecurity.js';

const BARRIE_PROXIMITY = { lng: -79.69, lat: 44.38 };
const MIN_ADDRESS_QUERY_LENGTH = 3;
const MAX_ADDRESS_QUERY_LENGTH = 180;

interface RoutePlanner2AddressSuggestion {
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

function getMapboxToken(): string {
    return process.env.MAPBOX_TOKEN || process.env.VITE_MAPBOX_TOKEN || '';
}

function readBody(body: VercelRequest['body']): Record<string, unknown> | null {
    if (typeof body === 'string') {
        try {
            const parsed = JSON.parse(body);
            return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : null;
        } catch {
            return null;
        }
    }
    return body && typeof body === 'object' ? body as Record<string, unknown> : null;
}

function parsePayload(body: VercelRequest['body']): { query: string; limit: number } | null {
    const parsed = readBody(body);
    const query = typeof parsed?.query === 'string' ? parsed.query.trim() : '';
    const rawLimit = typeof parsed?.limit === 'number' ? parsed.limit : 5;
    const limit = Math.max(1, Math.min(Math.floor(rawLimit), 10));

    if (query.length < MIN_ADDRESS_QUERY_LENGTH || query.length > MAX_ADDRESS_QUERY_LENGTH) {
        return null;
    }

    return { query, limit };
}

function buildMapboxUrl(query: string, token: string, limit: number): string {
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

export default async function handler(req: VercelRequest, res: VercelResponse) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed. Use POST.' });
    }

    const payload = parsePayload(req.body);
    if (!payload) {
        return res.status(400).json({ error: 'Missing or invalid address query.' });
    }

    const requestIp = getRequestIp(req);
    const allowed = checkRateLimit(`route-planner-geocode:${requestIp}`, 300, 60 * 60 * 1000);
    if (!allowed) {
        return res.status(429).json({ error: 'Rate limit exceeded. Please try again later.' });
    }

    const token = getMapboxToken();
    if (!token) {
        return res.status(500).json({
            error: 'Server geocode is not configured.',
            diagnostic: {
                query: payload.query,
                source: 'server',
                status: null,
                tokenPresent: false,
                resultCount: 0,
                error: 'Mapbox token is not configured.',
            },
        });
    }

    try {
        const response = await fetch(buildMapboxUrl(payload.query, token, payload.limit));
        const status = response.status;
        const data = await response.json() as MapboxGeocodingResponse;
        const suggestions = (data.features ?? [])
            .map(normalizeFeature)
            .filter((suggestion): suggestion is RoutePlanner2AddressSuggestion => suggestion !== null);

        if (!response.ok) {
            return res.status(status).json({
                error: `Mapbox address search returned ${status}`,
                diagnostic: {
                    query: payload.query,
                    source: 'server',
                    status,
                    tokenPresent: true,
                    resultCount: 0,
                    error: `Mapbox address search returned ${status}`,
                },
            });
        }

        return res.status(200).json({
            suggestions,
            diagnostic: {
                query: payload.query,
                source: 'server',
                status,
                tokenPresent: true,
                resultCount: suggestions.length,
                topResultLabel: suggestions[0]?.label,
            },
        });
    } catch {
        return res.status(502).json({
            error: 'Mapbox address search failed.',
            diagnostic: {
                query: payload.query,
                source: 'server',
                status: null,
                tokenPresent: true,
                resultCount: 0,
                error: 'Mapbox address search failed.',
            },
        });
    }
}
