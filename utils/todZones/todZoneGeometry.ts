import type {
    TodCityStop,
    TodConnectionStop,
    TodStopOverride,
    TodZoneDraft,
    TodZoneDefinition,
    TodZoneMembership,
    TodZonePolygon,
    TodZoneStopSnapshot,
    TodZoneVersion,
} from './todZoneTypes';

const MAX_POLYGONS = 80;
const MAX_VERTICES_PER_POLYGON = 250;
const MAX_TOTAL_VERTICES = 5_000;
const MAX_DEFINITIONS = 26;
const MAX_CONNECTION_STOPS = 1_500;
const MAX_OVERRIDES = 1_000;
const COORDINATE_EPSILON = 1e-10;

function samePosition(a: [number, number], b: [number, number]): boolean {
    return Math.abs(a[0] - b[0]) <= COORDINATE_EPSILON
        && Math.abs(a[1] - b[1]) <= COORDINATE_EPSILON;
}

export function normalizeTodZoneStopId(value: string): string {
    const match = value.trim().match(/^(?:stop[-\s:]*)?(\d+)$/i);
    return match ? String(Number(match[1])) : value.trim();
}

function pointOnSegment(point: [number, number], start: [number, number], end: [number, number]): boolean {
    const [x, y] = point;
    const [x1, y1] = start;
    const [x2, y2] = end;
    const lengthSquared = ((x2 - x1) ** 2 + (y2 - y1) ** 2);
    if (lengthSquared <= COORDINATE_EPSILON) return samePosition(point, start);
    const cross = (y - y1) * (x2 - x1) - (x - x1) * (y2 - y1);
    if (Math.abs(cross) > COORDINATE_EPSILON) return false;
    const dot = (x - x1) * (x2 - x1) + (y - y1) * (y2 - y1);
    return dot >= 0 && dot <= lengthSquared;
}

export function pointInTodPolygon(point: [number, number], ring: [number, number][]): boolean {
    if (ring.length < 4) return false;
    let inside = false;
    for (let current = 0, previous = ring.length - 1; current < ring.length; previous = current++) {
        const a = ring[current];
        const b = ring[previous];
        if (pointOnSegment(point, a, b)) return true;
        const intersects = (a[1] > point[1]) !== (b[1] > point[1])
            && point[0] < ((b[0] - a[0]) * (point[1] - a[1])) / (b[1] - a[1]) + a[0];
        if (intersects) inside = !inside;
    }
    return inside;
}

function normalizedCodes(codes: string[], definitions: TodZoneDefinition[]): string[] {
    const valid = new Set(definitions.filter(zone => zone.active).map(zone => zone.code));
    return [...new Set(codes.map(code => code.trim().toUpperCase()).filter(code => valid.has(code)))].sort();
}

export function assignTodZoneMembership(
    stop: Pick<TodCityStop, 'id' | 'lat' | 'lon'>,
    definitions: TodZoneDefinition[],
    polygons: TodZonePolygon[],
    overrides: TodStopOverride[],
    connectionStops: TodConnectionStop[] = [],
): TodZoneMembership {
    const polygonCodes = polygons
        .filter(polygon => pointInTodPolygon([stop.lon, stop.lat], polygon.coordinates))
        .map(polygon => polygon.zoneCode);
    const normalizedStopId = normalizeTodZoneStopId(stop.id);
    const connectionStop = connectionStops.find(candidate => normalizeTodZoneStopId(candidate.stopId) === normalizedStopId);
    const override = overrides.find(candidate => normalizeTodZoneStopId(candidate.stopId) === normalizedStopId);
    let zoneCodes = normalizedCodes([...polygonCodes, ...(connectionStop?.zoneCodes ?? [])], definitions);
    if (override) {
        const overrideCodes = normalizedCodes(override.zoneCodes, definitions);
        if (override.action === 'replace') zoneCodes = overrideCodes;
        if (override.action === 'include') zoneCodes = normalizedCodes([...zoneCodes, ...overrideCodes], definitions);
        if (override.action === 'exclude') zoneCodes = zoneCodes.filter(code => !overrideCodes.includes(code));
    }
    return {
        zoneCodes,
        source: override ? 'override' : connectionStop ? 'connection' : zoneCodes.length > 0 ? 'polygon' : 'unassigned',
        isConnectionStop: !!connectionStop,
    };
}

export function buildTodStopSnapshot(
    stops: TodCityStop[],
    definitions: TodZoneDefinition[],
    polygons: TodZonePolygon[],
    overrides: TodStopOverride[],
    connectionStops: TodConnectionStop[] = [],
): TodZoneStopSnapshot[] {
    return stops.map(stop => {
        const membership = assignTodZoneMembership(stop, definitions, polygons, overrides, connectionStops);
        return {
            stopId: stop.id,
            name: stop.name,
            lat: stop.lat,
            lon: stop.lon,
            zoneCodes: membership.zoneCodes,
            isConnectionStop: membership.isConnectionStop,
        };
    });
}

export function selectEffectiveTodZoneVersion(versions: TodZoneVersion[], dates: string[]): TodZoneVersion | null {
    if (dates.length === 0) return null;
    const endDate = [...dates].sort().at(-1)!;
    return [...versions]
        .filter(version => version.effectiveFrom <= endDate)
        .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom)
            || (b.publishedAt || '').localeCompare(a.publishedAt || '')
            || b.revision - a.revision)[0] ?? null;
}

function orientation(a: [number, number], b: [number, number], c: [number, number]): number {
    const value = (b[1] - a[1]) * (c[0] - b[0]) - (b[0] - a[0]) * (c[1] - b[1]);
    if (Math.abs(value) <= COORDINATE_EPSILON) return 0;
    return value > 0 ? 1 : 2;
}

function segmentsIntersect(
    firstStart: [number, number],
    firstEnd: [number, number],
    secondStart: [number, number],
    secondEnd: [number, number],
): boolean {
    const first = orientation(firstStart, firstEnd, secondStart);
    const second = orientation(firstStart, firstEnd, secondEnd);
    const third = orientation(secondStart, secondEnd, firstStart);
    const fourth = orientation(secondStart, secondEnd, firstEnd);
    if (first !== second && third !== fourth) return true;
    return (first === 0 && pointOnSegment(secondStart, firstStart, firstEnd))
        || (second === 0 && pointOnSegment(secondEnd, firstStart, firstEnd))
        || (third === 0 && pointOnSegment(firstStart, secondStart, secondEnd))
        || (fourth === 0 && pointOnSegment(firstEnd, secondStart, secondEnd));
}

function hasSelfIntersection(ring: [number, number][]): boolean {
    const segmentCount = ring.length - 1;
    for (let first = 0; first < segmentCount; first += 1) {
        for (let second = first + 1; second < segmentCount; second += 1) {
            const adjacent = second === first + 1 || (first === 0 && second === segmentCount - 1);
            if (adjacent) continue;
            if (segmentsIntersect(ring[first], ring[first + 1], ring[second], ring[second + 1])) return true;
        }
    }
    return false;
}

export function isValidTodZoneDate(value: string): boolean {
    const match = /^(20\d{2})-(\d{2})-(\d{2})$/.exec(value);
    if (!match) return false;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCFullYear() === year
        && date.getUTCMonth() === month - 1
        && date.getUTCDate() === day;
}

export function validateTodZoneGeometry(polygons: TodZonePolygon[], definitions: TodZoneDefinition[]): void {
    if (definitions.length === 0 || definitions.length > MAX_DEFINITIONS) {
        throw new Error(`Define between 1 and ${MAX_DEFINITIONS} TOD zones.`);
    }
    const definitionCodes = definitions.map(zone => zone.code.trim().toUpperCase());
    if (new Set(definitionCodes).size !== definitionCodes.length) throw new Error('TOD zone codes must be unique.');
    definitions.forEach(zone => {
        if (!/^[A-Z]$/.test(zone.code)) throw new Error(`Zone code ${zone.code || '(blank)'} must be one letter.`);
        if (!zone.label.trim() || zone.label.length > 100) throw new Error(`Zone ${zone.code} needs a label of 100 characters or fewer.`);
        if (!/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(zone.color)) throw new Error(`Zone ${zone.code} needs a valid hex colour.`);
        if (zone.kind !== 'permanent' && zone.kind !== 'temporary') throw new Error(`Zone ${zone.code} has an invalid kind.`);
    });
    if (polygons.length > MAX_POLYGONS) throw new Error(`A maximum of ${MAX_POLYGONS} zone polygons is supported.`);
    const codes = new Set(definitionCodes);
    const polygonIds = new Set<string>();
    let totalVertices = 0;
    for (const polygon of polygons) {
        if (!polygon.id.trim() || polygon.id.length > 100) throw new Error('Every polygon needs an ID of 100 characters or fewer.');
        if (polygonIds.has(polygon.id)) throw new Error(`Polygon ID ${polygon.id} is duplicated.`);
        polygonIds.add(polygon.id);
        if (!polygon.pocketName.trim() || polygon.pocketName.length > 200) throw new Error(`Polygon ${polygon.id} needs an area name of 200 characters or fewer.`);
        if (!codes.has(polygon.zoneCode)) throw new Error(`Polygon ${polygon.pocketName} uses an unknown zone code.`);
        if (polygon.coordinates.length < 4) throw new Error(`Polygon ${polygon.pocketName} needs at least three points.`);
        if (polygon.coordinates.length > MAX_VERTICES_PER_POLYGON) {
            throw new Error(`Polygon ${polygon.pocketName} exceeds ${MAX_VERTICES_PER_POLYGON} vertices.`);
        }
        polygon.coordinates.forEach(([lon, lat]) => {
            if (!Number.isFinite(lon) || !Number.isFinite(lat) || lon < -180 || lon > 180 || lat < -90 || lat > 90) {
                throw new Error(`Polygon ${polygon.pocketName} contains an invalid WGS84 coordinate.`);
            }
        });
        if (!samePosition(polygon.coordinates[0], polygon.coordinates.at(-1)!)) {
            throw new Error(`Polygon ${polygon.pocketName} must have a closed boundary.`);
        }
        const distinctVertices = new Set(polygon.coordinates.slice(0, -1).map(([lon, lat]) => `${lon},${lat}`));
        if (distinctVertices.size < 3) throw new Error(`Polygon ${polygon.pocketName} needs three distinct points.`);
        if (hasSelfIntersection(polygon.coordinates)) throw new Error(`Polygon ${polygon.pocketName} crosses itself.`);
        totalVertices += polygon.coordinates.length;
    }
    if (totalVertices > MAX_TOTAL_VERTICES) throw new Error(`Zone geometry exceeds ${MAX_TOTAL_VERTICES} total vertices.`);
}

export function validateTodZoneDraft(draft: TodZoneDraft): void {
    validateTodZoneGeometry(draft.polygons, draft.definitions);
    if (draft.connectionStops.length > MAX_CONNECTION_STOPS) throw new Error(`A maximum of ${MAX_CONNECTION_STOPS} connection stops is supported.`);
    const activeCodes = new Set(draft.definitions.filter(zone => zone.active).map(zone => zone.code));
    const connectionStopIds = new Set<string>();
    draft.connectionStops.forEach(connectionStop => {
        const stopId = normalizeTodZoneStopId(connectionStop.stopId);
        if (!stopId || stopId.length > 64) throw new Error('Every connection stop needs a stop ID of 64 characters or fewer.');
        if (connectionStopIds.has(stopId)) throw new Error(`Connection stop ${stopId} is duplicated.`);
        connectionStopIds.add(stopId);
        const uniqueCodes = new Set(connectionStop.zoneCodes);
        if (connectionStop.zoneCodes.length === 0 || uniqueCodes.size !== connectionStop.zoneCodes.length || [...uniqueCodes].some(code => !activeCodes.has(code))) {
            throw new Error(`Connection stop ${stopId} uses an invalid or duplicated zone.`);
        }
    });
    if (draft.overrides.length > MAX_OVERRIDES) throw new Error(`A maximum of ${MAX_OVERRIDES} stop overrides is supported.`);
    const stopIds = new Set<string>();
    draft.overrides.forEach(override => {
        const stopId = normalizeTodZoneStopId(override.stopId);
        if (!stopId || stopId.length > 64) throw new Error('Every stop override needs a stop ID of 64 characters or fewer.');
        if (stopIds.has(stopId)) throw new Error(`Stop ${stopId} has more than one override.`);
        stopIds.add(stopId);
        if (!['include', 'exclude', 'replace'].includes(override.action)) throw new Error(`Stop ${stopId} has an invalid override action.`);
        if (override.zoneCodes.length === 0) throw new Error(`Stop ${stopId} needs at least one override zone.`);
        const uniqueCodes = new Set(override.zoneCodes);
        if (uniqueCodes.size !== override.zoneCodes.length || [...uniqueCodes].some(code => !activeCodes.has(code))) {
            throw new Error(`Stop ${stopId} uses an invalid or duplicated override zone.`);
        }
        if (!override.reason.trim() || override.reason.length > 500) throw new Error(`Stop ${stopId} needs an override reason of 500 characters or fewer.`);
    });
    if (!isValidTodZoneDate(draft.effectiveFrom)) throw new Error('Choose a valid effective date.');
    if (!draft.source.trim() || draft.source.length > 1_000) throw new Error('Document the source in 1,000 characters or fewer.');
    if (!draft.reviewNote.trim() || draft.reviewNote.length > 2_000) throw new Error('Add a review note of 2,000 characters or fewer.');
}

export function filterByTodZone(zoneCodes: string[], filter: string): boolean {
    if (filter === 'all') return true;
    if (filter === 'multi-zone') return zoneCodes.length > 1;
    if (filter === 'unassigned') return zoneCodes.length === 0;
    return zoneCodes.includes(filter);
}
