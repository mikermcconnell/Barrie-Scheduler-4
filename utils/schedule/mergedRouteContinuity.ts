import type { MasterRouteTable, MasterTrip } from '../parsers/masterScheduleParser';
import { getRouteConfig, parseRouteInfo } from '../config/routeDirectionConfig';
import { getOperationalSortTime } from '../blocks/blockAssignmentCore';

export interface MergedRouteContinuityIssue {
    routeKey: string;
    blockId: string;
    severity: 'error';
    message: string;
    tripIds: string[];
}

const stripScheduleSuffixes = (routeName: string): string => (
    routeName
        .replace(/\s*\((North|South)\)/gi, '')
        .replace(/\s*\((Weekday|Saturday|Sunday)\)/gi, '')
        .trim()
);

export const getMergedRouteBaseKey = (routeName: string): string => {
    const parsed = parseRouteInfo(stripScheduleSuffixes(routeName));
    return (parsed.suffixIsDirection ? parsed.baseRoute : parsed.baseRoute).trim().toUpperCase();
};

export const isMergedRouteBase = (routeKey: string): boolean => {
    const config = getRouteConfig(routeKey);
    return !!config?.suffixIsDirection && config.segments.length === 2;
};

export const isMergedRouteName = (routeName: string): boolean => (
    isMergedRouteBase(getMergedRouteBaseKey(routeName))
);

const describeTrip = (trip: MasterTrip): string => (
    `${trip.direction} trip ${trip.id} on block ${trip.blockId}`
);

export const validateMergedRouteBlockContinuity = (
    tables: MasterRouteTable[],
    options: { maxGapMinutes?: number } = {},
): MergedRouteContinuityIssue[] => {
    const maxGapMinutes = options.maxGapMinutes ?? 35;
    const issues: MergedRouteContinuityIssue[] = [];
    const tripsByRoute = new Map<string, MasterTrip[]>();

    tables.forEach(table => {
        const routeKey = getMergedRouteBaseKey(table.routeName);
        if (!isMergedRouteBase(routeKey)) return;

        const routeTrips = tripsByRoute.get(routeKey) ?? [];
        routeTrips.push(...table.trips);
        tripsByRoute.set(routeKey, routeTrips);
    });

    tripsByRoute.forEach((trips, routeKey) => {
        const blockIds = new Set(trips.map(trip => trip.blockId).filter(Boolean));

        blockIds.forEach(blockId => {
            const blockTrips = trips
                .filter(trip => trip.blockId === blockId)
                .sort((a, b) => (
                    getOperationalSortTime(a.startTime) - getOperationalSortTime(b.startTime)
                    || getOperationalSortTime(a.endTime) - getOperationalSortTime(b.endTime)
                    || a.id.localeCompare(b.id)
                ));

            for (let index = 0; index < blockTrips.length - 1; index++) {
                const current = blockTrips[index];
                const next = blockTrips[index + 1];

                if (current.direction === next.direction) {
                    issues.push({
                        routeKey,
                        blockId,
                        severity: 'error',
                        tripIds: [current.id, next.id],
                        message: `${describeTrip(current)} is followed by another ${next.direction} trip instead of alternating A/B service.`,
                    });
                    continue;
                }

                const gap = next.startTime - current.endTime;
                if (gap < 0) {
                    issues.push({
                        routeKey,
                        blockId,
                        severity: 'error',
                        tripIds: [current.id, next.id],
                        message: `${describeTrip(next)} starts ${Math.abs(gap)} minutes before the prior ${current.direction} trip finishes.`,
                    });
                } else if (gap > maxGapMinutes) {
                    issues.push({
                        routeKey,
                        blockId,
                        severity: 'error',
                        tripIds: [current.id, next.id],
                        message: `${describeTrip(current)} is disconnected from the next ${next.direction} trip by ${gap} minutes.`,
                    });
                }
            }
        });
    });

    return issues;
};
