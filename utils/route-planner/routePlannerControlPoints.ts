const EARTH_RADIUS_KM = 6371;
const MIN_CONTROL_POINTS = 6;
const MAX_CONTROL_POINTS = 18;
const MAX_SHARP_TURN_ANCHORS = 6;
const SHARP_TURN_THRESHOLD_DEGREES = 28;
const MIN_TURN_SPACING_KM = 0.35;

function toRadians(value: number): number {
    return (value * Math.PI) / 180;
}

function haversineDistanceKm(first: [number, number], second: [number, number]): number {
    const [lonA, latA] = first;
    const [lonB, latB] = second;
    const dLat = toRadians(latB - latA);
    const dLon = toRadians(lonB - lonA);
    const lat1 = toRadians(latA);
    const lat2 = toRadians(latB);

    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2)
        + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);

    return 2 * EARTH_RADIUS_KM * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function coordinatesEqual(first: [number, number], second: [number, number]): boolean {
    return Math.abs(first[0] - second[0]) < 0.000001 && Math.abs(first[1] - second[1]) < 0.000001;
}

function dedupeSequentialCoordinates(coordinates: [number, number][]): [number, number][] {
    return coordinates.filter((coordinate, index) => (
        index === 0 || !coordinatesEqual(coordinate, coordinates[index - 1])
    ));
}

function calculateTurnAngleDegrees(
    previous: [number, number],
    current: [number, number],
    next: [number, number]
): number {
    const vectorA = [current[0] - previous[0], current[1] - previous[1]];
    const vectorB = [next[0] - current[0], next[1] - current[1]];
    const magnitudeA = Math.hypot(vectorA[0], vectorA[1]);
    const magnitudeB = Math.hypot(vectorB[0], vectorB[1]);

    if (magnitudeA === 0 || magnitudeB === 0) return 0;

    const dot = (vectorA[0] * vectorB[0]) + (vectorA[1] * vectorB[1]);
    const normalizedDot = Math.min(1, Math.max(-1, dot / (magnitudeA * magnitudeB)));
    return Math.acos(normalizedDot) * (180 / Math.PI);
}

function buildCumulativeDistancesKm(coordinates: [number, number][]): number[] {
    const distances = [0];

    for (let index = 1; index < coordinates.length; index += 1) {
        distances.push(distances[index - 1] + haversineDistanceKm(coordinates[index - 1], coordinates[index]));
    }

    return distances;
}

function buildTargetControlPointCount(totalDistanceKm: number): number {
    return Math.max(
        MIN_CONTROL_POINTS,
        Math.min(MAX_CONTROL_POINTS, Math.round(totalDistanceKm / 1.5) + 2)
    );
}

interface TurnCandidate {
    angle: number;
    index: number;
}

function collectSharpTurnIndices(coordinates: [number, number][], cumulativeDistancesKm: number[], targetCount: number): number[] {
    const candidates: TurnCandidate[] = [];

    for (let index = 1; index < coordinates.length - 1; index += 1) {
        const angle = calculateTurnAngleDegrees(coordinates[index - 1], coordinates[index], coordinates[index + 1]);
        if (angle < SHARP_TURN_THRESHOLD_DEGREES) continue;
        candidates.push({ angle, index });
    }

    candidates.sort((left, right) => right.angle - left.angle);

    const selected: number[] = [];
    const maxTurns = Math.min(MAX_SHARP_TURN_ANCHORS, Math.max(0, targetCount - 2));

    candidates.forEach((candidate) => {
        if (selected.length >= maxTurns) return;

        const candidateDistance = cumulativeDistancesKm[candidate.index];
        const isTooClose = selected.some((selectedIndex) =>
            Math.abs(cumulativeDistancesKm[selectedIndex] - candidateDistance) < MIN_TURN_SPACING_KM
        );

        if (!isTooClose) {
            selected.push(candidate.index);
        }
    });

    return selected.sort((left, right) => left - right);
}

function pickNearestAvailableIndex(
    targetDistanceKm: number,
    cumulativeDistancesKm: number[],
    selectedSet: Set<number>
): number | null {
    let bestIndex: number | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;

    for (let index = 1; index < cumulativeDistancesKm.length - 1; index += 1) {
        if (selectedSet.has(index)) continue;

        const distanceFromTarget = Math.abs(cumulativeDistancesKm[index] - targetDistanceKm);
        if (distanceFromTarget < bestDistance) {
            bestDistance = distanceFromTarget;
            bestIndex = index;
        }
    }

    return bestIndex;
}

export function simplifyRouteControlPoints(coordinates: [number, number][]): [number, number][] {
    const dedupedCoordinates = dedupeSequentialCoordinates(coordinates);
    if (dedupedCoordinates.length <= MAX_CONTROL_POINTS) {
        return dedupedCoordinates;
    }

    const cumulativeDistancesKm = buildCumulativeDistancesKm(dedupedCoordinates);
    const totalDistanceKm = cumulativeDistancesKm[cumulativeDistancesKm.length - 1] ?? 0;
    const targetCount = buildTargetControlPointCount(totalDistanceKm);
    const selectedIndices = new Set<number>([
        0,
        dedupedCoordinates.length - 1,
        ...collectSharpTurnIndices(dedupedCoordinates, cumulativeDistancesKm, targetCount),
    ]);

    const remainingSlots = Math.max(0, targetCount - selectedIndices.size);
    for (let slot = 1; slot <= remainingSlots; slot += 1) {
        const targetDistanceKm = (slot / (remainingSlots + 1)) * totalDistanceKm;
        const nearestIndex = pickNearestAvailableIndex(targetDistanceKm, cumulativeDistancesKm, selectedIndices);
        if (nearestIndex !== null) {
            selectedIndices.add(nearestIndex);
        }
    }

    return Array.from(selectedIndices)
        .sort((left, right) => left - right)
        .map((index) => dedupedCoordinates[index]);
}

export const ROUTE_CONTROL_POINT_LIMITS = {
    min: MIN_CONTROL_POINTS,
    max: MAX_CONTROL_POINTS,
} as const;
