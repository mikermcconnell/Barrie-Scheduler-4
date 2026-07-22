import { getRouteColor } from '../config/routeColors';
import type { RoutePlanner2GtfsImportPattern } from '../route-planner-2/routePlanner2GtfsImport';
import type {
    DetourCoordinate,
    DetourGtfsRouteSnapshot,
    DetourRouteOverlay,
} from './detourTypes';

function toCoordinate(point: { lat: number; lng: number }): DetourCoordinate {
    return { latitude: point.lat, longitude: point.lng };
}

function normalizeColor(pattern: RoutePlanner2GtfsImportPattern): string {
    const configured = getRouteColor(pattern.routeShortName);
    if (configured !== '#6B7280') return configured;
    const gtfs = pattern.routeColor?.trim().replace(/^#/, '');
    return gtfs && /^[0-9a-f]{6}$/i.test(gtfs) ? `#${gtfs.toUpperCase()}` : configured;
}

function isLoopPattern(pattern: RoutePlanner2GtfsImportPattern): boolean {
    const stops = [...pattern.stops].sort((a, b) => a.sequence - b.sequence);
    const first = stops[0];
    const last = stops.at(-1);
    if (!first || !last || stops.length < 2) return false;
    if ((first.gtfsStopId || first.stopId) === (last.gtfsStopId || last.stopId)) return true;
    const latitudeScale = Math.cos(first.lat * Math.PI / 180);
    const latMetres = (last.lat - first.lat) * 111_320;
    const lngMetres = (last.lng - first.lng) * 111_320 * latitudeScale;
    return Math.hypot(latMetres, lngMetres) <= 35;
}

function compareFullWeekdayPatterns(
    first: RoutePlanner2GtfsImportPattern,
    second: RoutePlanner2GtfsImportPattern,
): number {
    return second.stopCount - first.stopCount
        || second.tripCount - first.tripCount
        || second.shapePointCount - first.shapePointCount
        || first.id.localeCompare(second.id);
}

/** Returns one complete weekday planning pattern for each public route number. */
export function selectDetourWeekdayRoutes(
    patterns: RoutePlanner2GtfsImportPattern[],
): RoutePlanner2GtfsImportPattern[] {
    const patternsByRoute = new Map<string, RoutePlanner2GtfsImportPattern[]>();

    patterns.forEach((pattern) => {
        if (pattern.dayTypeLabel.trim().toLowerCase() !== 'weekday') return;
        const routeKey = pattern.routeShortName.trim().toUpperCase();
        if (!routeKey) return;
        const routePatterns = patternsByRoute.get(routeKey) ?? [];
        routePatterns.push(pattern);
        patternsByRoute.set(routeKey, routePatterns);
    });

    return Array.from(patternsByRoute.values())
        .map(routePatterns => [...routePatterns].sort(compareFullWeekdayPatterns)[0]!)
        .sort((first, second) => first.routeShortName.localeCompare(
            second.routeShortName,
            undefined,
            { numeric: true, sensitivity: 'base' },
        ));
}

export function getDetourPatternDirectionLabel(pattern: RoutePlanner2GtfsImportPattern): string {
    const familyDirection = pattern.routeFamily?.directionLabel?.trim();
    if (familyDirection) return familyDirection;
    const headsign = pattern.tripHeadsign?.trim();
    if (headsign) return headsign;
    if (pattern.directionId === 0) return 'Direction 0';
    if (pattern.directionId === 1) return 'Direction 1';
    return 'Route direction';
}

export function createDetourRouteSnapshotFromGtfsPattern(
    pattern: RoutePlanner2GtfsImportPattern,
    importedAt = new Date(),
): DetourGtfsRouteSnapshot {
    const originalGeometry = [...pattern.shapePoints]
        .sort((a, b) => a.sequence - b.sequence)
        .map(toCoordinate);

    return {
        feedId: pattern.feedVersion,
        importedAt: importedAt.toISOString(),
        routeId: pattern.routeId,
        routeShortName: pattern.routeShortName,
        routeLongName: pattern.routeLongName,
        routeColor: normalizeColor(pattern),
        serviceId: pattern.serviceId,
        directionId: pattern.directionId === 0 || pattern.directionId === 1 ? pattern.directionId : undefined,
        directionLabel: getDetourPatternDirectionLabel(pattern),
        isLoop: isLoopPattern(pattern),
        headsign: pattern.tripHeadsign,
        originalGeometry: originalGeometry.length >= 2
            ? originalGeometry
            : [...pattern.stops].sort((a, b) => a.sequence - b.sequence).map(toCoordinate),
        stops: [...pattern.stops]
            .sort((a, b) => a.sequence - b.sequence)
            .map((stop, index) => ({
                stopId: stop.gtfsStopId || stop.stopId,
                stopCode: stop.stopCode,
                name: stop.name,
                position: toCoordinate(stop),
                sequence: index + 1,
            })),
    };
}

export function createDetourOverlayFromGtfsPattern(
    pattern: RoutePlanner2GtfsImportPattern,
    options: { id?: string; now?: Date } = {},
): DetourRouteOverlay {
    const now = options.now ?? new Date();
    const routeSnapshot = createDetourRouteSnapshotFromGtfsPattern(pattern, now);
    return {
        id: options.id ?? `overlay-${crypto.randomUUID()}`,
        routeSnapshot,
        closureStart: null,
        closureEnd: null,
        closureWaypoints: [],
        closureGeometry: {
            coordinates: [],
            source: 'manual',
            manualRoutingAcknowledged: false,
        },
        detourWaypoints: [],
        detourGeometry: {
            coordinates: [],
            source: 'manual',
            manualRoutingAcknowledged: false,
        },
        streetLabels: [],
        labels: [],
        stopImpacts: routeSnapshot.stops.map(stop => ({
            id: `${options.id ?? pattern.id}-stop-${stop.stopId}`,
            sourceStop: stop,
            status: 'open',
            suggestedStatus: 'open',
            reviewed: true,
        })),
        busSuitabilityConfirmed: false,
        createdAt: now,
        updatedAt: now,
    };
}
