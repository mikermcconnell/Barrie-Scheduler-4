import { findNearestRouteAnchor } from './detourGeometry';
import type { DetourCoordinate, DetourStreetLabel, DetourStreetLabelPath } from './detourTypes';

export interface DetourRoadLabelSuggestion {
    name: string;
    geometry: DetourCoordinate[];
}

function normalizedStreetKey(value: string): string {
    return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase();
}

export function streetLabelText(label: Pick<DetourStreetLabel, 'path' | 'streetName'>): string {
    const streetName = label.streetName.trim().toLocaleUpperCase();
    return label.path === 'closure'
        ? `NO SERVICE ON · ${streetName}`
        : `DETOUR VIA · ${streetName}`;
}

function pathSegmentLengths(geometry: DetourCoordinate[]): number[] {
    return geometry.slice(1).map((point, index) => Math.hypot(
        point.longitude - geometry[index]!.longitude,
        point.latitude - geometry[index]!.latitude,
    ));
}

export function pathCoordinateAtFraction(geometry: DetourCoordinate[], requestedFraction: number): DetourCoordinate | null {
    if (!geometry.length) return null;
    if (geometry.length === 1) return { ...geometry[0]! };
    const lengths = pathSegmentLengths(geometry);
    const fraction = Math.min(1, Math.max(0, requestedFraction));
    const target = lengths.reduce((sum, length) => sum + length, 0) * fraction;
    let travelled = 0;
    for (let index = 0; index < lengths.length; index += 1) {
        const length = lengths[index]!;
        if (travelled + length >= target) {
            const start = geometry[index]!;
            const end = geometry[index + 1]!;
            const fraction = length === 0 ? 0 : (target - travelled) / length;
            return {
                longitude: start.longitude + (end.longitude - start.longitude) * fraction,
                latitude: start.latitude + (end.latitude - start.latitude) * fraction,
            };
        }
        travelled += length;
    }
    return { ...geometry.at(-1)! };
}

export function pathFractionAtCoordinate(geometry: DetourCoordinate[], coordinate: DetourCoordinate): number {
    if (geometry.length < 2) return 0;
    const anchor = findNearestRouteAnchor(geometry, coordinate);
    if (!anchor) return 0;
    const lengths = pathSegmentLengths(geometry);
    const total = lengths.reduce((sum, length) => sum + length, 0);
    if (total === 0) return 0;
    const before = lengths.slice(0, anchor.segmentIndex).reduce((sum, length) => sum + length, 0);
    const within = (lengths[anchor.segmentIndex] ?? 0) * anchor.fraction;
    return Math.min(1, Math.max(0, (before + within) / total));
}

export function pathMidpoint(geometry: DetourCoordinate[]): DetourCoordinate | null {
    return pathCoordinateAtFraction(geometry, 0.5);
}

export function createPlannerStreetLabel(
    path: DetourStreetLabelPath,
    streetName: string,
    geometry: DetourCoordinate[],
): DetourStreetLabel | null {
    const position = pathMidpoint(geometry);
    const name = streetName.trim().replace(/\s+/g, ' ');
    if (!position || !name) return null;
    return {
        id: `street-${crypto.randomUUID()}`,
        path,
        streetName: name,
        position,
        source: 'planner',
        confirmed: true,
        visible: true,
    };
}

/** Refreshes only unconfirmed Mapbox suggestions; planner work and accepted suggestions remain untouched. */
export function mergeDetourStreetSuggestions(
    current: DetourStreetLabel[],
    suggestions: DetourRoadLabelSuggestion[],
): DetourStreetLabel[] {
    const retained = current.filter(label => label.path !== 'detour' || label.source !== 'mapbox' || label.confirmed);
    const existingNames = new Set(retained
        .filter(label => label.path === 'detour')
        .map(label => normalizedStreetKey(label.streetName)));
    const seen = new Set<string>();
    const nextSuggestions: DetourStreetLabel[] = [];
    suggestions.forEach(suggestion => {
        const name = suggestion.name.trim().replace(/\s+/g, ' ');
        const key = normalizedStreetKey(name);
        if (!name || seen.has(key) || existingNames.has(key)) return;
        const position = pathMidpoint(suggestion.geometry);
        if (!position) return;
        seen.add(key);
        nextSuggestions.push({
            id: `street-suggestion-${crypto.randomUUID()}`,
            path: 'detour',
            streetName: name,
            position,
            source: 'mapbox',
            confirmed: false,
            visible: true,
        });
    });
    return [...retained, ...nextSuggestions];
}

export function snapStreetLabelToPath(label: DetourStreetLabel, geometry: DetourCoordinate[]): DetourStreetLabel {
    const anchor = findNearestRouteAnchor(geometry, label.position);
    return anchor ? { ...label, position: anchor.coordinate } : label;
}
