export interface ParsedLatLon {
    lat: number;
    lon: number;
}

type Axis = 'lat' | 'lon';

function isFiniteNumber(value: number): boolean {
    return Number.isFinite(value);
}

export function isValidLatLon(lat: number, lon: number): boolean {
    return lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180;
}

function parseGoogleMapsPair(input: string): ParsedLatLon | null {
    const patterns = [
        /@\s*([+-]?\d+(?:\.\d+)?),\s*([+-]?\d+(?:\.\d+)?)/i,
        /[?&](?:q|ll|query)=([+-]?\d+(?:\.\d+)?),\s*([+-]?\d+(?:\.\d+)?)/i,
        /!3d([+-]?\d+(?:\.\d+)?)!4d([+-]?\d+(?:\.\d+)?)/i,
    ];

    for (const pattern of patterns) {
        const match = input.match(pattern);
        if (!match) continue;

        const lat = Number(match[1]);
        const lon = Number(match[2]);
        if (!isFiniteNumber(lat) || !isFiniteNumber(lon)) continue;
        if (!isValidLatLon(lat, lon)) continue;

        return { lat, lon };
    }

    return null;
}

function normalizeCoordinateToken(input: string): string {
    return input
        .trim()
        .replace(/[()]/g, ' ')
        .replace(/[“”″]/g, '"')
        .replace(/[’′]/g, "'")
        .replace(/[°º]/g, ' ')
        .replace(/['"]/g, ' ')
        .replace(/,/g, ' ')
        .replace(/\s+/g, ' ');
}

export function parseCoordinateValue(input: string, axis: Axis): number | null {
    const normalized = normalizeCoordinateToken(input);
    if (!normalized) return null;

    const direct = Number(normalized);
    if (isFiniteNumber(direct)) return direct;

    const hemisphereMatch = normalized.match(/[NSEW]/i);
    const hemisphere = hemisphereMatch?.[0]?.toUpperCase();
    if (hemisphere) {
        if (axis === 'lat' && (hemisphere === 'E' || hemisphere === 'W')) return null;
        if (axis === 'lon' && (hemisphere === 'N' || hemisphere === 'S')) return null;
    }

    const numericPart = normalized.replace(/[NSEW]/gi, ' ').trim();
    if (!numericPart) return null;

    const parts = numericPart.split(/\s+/).filter(Boolean);
    if (parts.length === 0 || parts.length > 3) return null;

    const degRaw = Number(parts[0]);
    if (!isFiniteNumber(degRaw)) return null;

    const min = parts[1] ? Number(parts[1]) : 0;
    const sec = parts[2] ? Number(parts[2]) : 0;
    if (!isFiniteNumber(min) || !isFiniteNumber(sec)) return null;
    if (min < 0 || min >= 60 || sec < 0 || sec >= 60) return null;

    const abs = Math.abs(degRaw) + (min / 60) + (sec / 3600);
    let sign = degRaw < 0 ? -1 : 1;

    if (hemisphere === 'S' || hemisphere === 'W') sign = -1;
    if (hemisphere === 'N' || hemisphere === 'E') sign = 1;

    return abs * sign;
}

export function parseLatLonInput(input: string): ParsedLatLon | null {
    const raw = input.trim();
    if (!raw) return null;

    const decoded = (() => {
        try {
            return decodeURIComponent(raw);
        } catch {
            return raw;
        }
    })();

    const urlParsed = parseGoogleMapsPair(raw) || parseGoogleMapsPair(decoded);
    if (urlParsed) return urlParsed;

    const normalizedDecoded = normalizeCoordinateToken(decoded);
    const hemiSegments = normalizedDecoded.match(/[+-]?\d[\d\s.]*?[NSEW]/gi);
    if (hemiSegments && hemiSegments.length >= 2) {
        let lat: number | null = null;
        let lon: number | null = null;

        hemiSegments.forEach((segment) => {
            const hemisphere = segment.match(/[NSEW]/i)?.[0]?.toUpperCase();
            if (!hemisphere) return;
            if ((hemisphere === 'N' || hemisphere === 'S') && lat == null) {
                lat = parseCoordinateValue(segment, 'lat');
            } else if ((hemisphere === 'E' || hemisphere === 'W') && lon == null) {
                lon = parseCoordinateValue(segment, 'lon');
            }
        });

        if (lat != null && lon != null && isValidLatLon(lat, lon)) {
            return { lat, lon };
        }
    }

    const commaParts = decoded.split(',').map(part => part.trim()).filter(Boolean);
    if (commaParts.length >= 2) {
        const lat = parseCoordinateValue(commaParts[0], 'lat');
        const lon = parseCoordinateValue(commaParts[1], 'lon');
        if (lat != null && lon != null && isValidLatLon(lat, lon)) {
            return { lat, lon };
        }
    }

    const decimalPairMatch = decoded.match(/([+-]?\d+(?:\.\d+)?)\s+([+-]?\d+(?:\.\d+)?)/);
    if (decimalPairMatch) {
        const lat = Number(decimalPairMatch[1]);
        const lon = Number(decimalPairMatch[2]);
        if (isFiniteNumber(lat) && isFiniteNumber(lon) && isValidLatLon(lat, lon)) {
            return { lat, lon };
        }
    }

    return null;
}

export function parseManualCoordinateEntry(entry: { lat: string; lon: string }): ParsedLatLon | null {
    const fromLatField = parseLatLonInput(entry.lat);
    if (fromLatField) return fromLatField;

    const fromLonField = parseLatLonInput(entry.lon);
    if (fromLonField) return fromLonField;

    const lat = parseCoordinateValue(entry.lat, 'lat');
    const lon = parseCoordinateValue(entry.lon, 'lon');
    if (lat == null || lon == null) return null;
    if (!isValidLatLon(lat, lon)) return null;

    return { lat, lon };
}

export function buildGoogleMapsSearchUrl(stationName: string): string {
    const query = `${stationName}, Canada`;
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}
