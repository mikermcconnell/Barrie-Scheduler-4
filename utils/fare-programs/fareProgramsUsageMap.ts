export interface FareProgramUsageMapOrigin {
    id: string;
    label: string;
    longitude: number;
    latitude: number;
    filteredUses: number;
    uses: number;
}

export interface FareProgramUsageMapPoint {
    id: string;
    longitude: number;
    latitude: number;
    filteredUses: number;
    totalUses: number;
    locationCount: number;
    origins: FareProgramUsageMapOrigin[];
}

const COORDINATE_PRECISION = 6;

function coordinateKey(longitude: number, latitude: number): string {
    return `${longitude.toFixed(COORDINATE_PRECISION)},${latitude.toFixed(COORDINATE_PRECISION)}`;
}

export function groupFareProgramUsageMapOrigins(
    origins: FareProgramUsageMapOrigin[],
): FareProgramUsageMapPoint[] {
    const grouped = new Map<string, FareProgramUsageMapOrigin[]>();

    for (const origin of origins) {
        const key = coordinateKey(origin.longitude, origin.latitude);
        const group = grouped.get(key);
        if (group) group.push(origin);
        else grouped.set(key, [origin]);
    }

    return Array.from(grouped.entries())
        .map(([key, group]) => {
            const sortedOrigins = [...group].sort((left, right) =>
                right.filteredUses - left.filteredUses || left.label.localeCompare(right.label));
            return {
                id: `usage-${key}`,
                longitude: sortedOrigins[0].longitude,
                latitude: sortedOrigins[0].latitude,
                filteredUses: sortedOrigins.reduce((sum, origin) => sum + origin.filteredUses, 0),
                totalUses: sortedOrigins.reduce((sum, origin) => sum + origin.uses, 0),
                locationCount: sortedOrigins.length,
                origins: sortedOrigins,
            };
        })
        .sort((left, right) =>
            right.filteredUses - left.filteredUses
            || right.locationCount - left.locationCount
            || left.id.localeCompare(right.id));
}
