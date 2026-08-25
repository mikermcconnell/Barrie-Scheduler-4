import type { MasterScheduleContent, MasterScheduleEntry } from '../masterScheduleTypes';
import type { MasterRouteTable, MasterTrip } from '../parsers/masterScheduleParser';
import type { DraftBasedOn, DraftSchedule } from './scheduleTypes';
import { validateMergedRouteBlockContinuity } from './mergedRouteContinuity';
import { getOperationalSortTime } from '../blocks/blockAssignmentCore';
import { getRouteConfig } from '../config/routeDirectionConfig';
import {
    getOperationalEndTime,
    getOperationalOccupiedEndTime,
    getOperationalStartTime,
    normalizeTripTime,
} from './tripTiming';
import {
    buildDetailedMasterComparison,
    buildMasterComparisonChangeSummary,
    buildTripKey,
    classifyMatchedTripChange,
    type TripChangeKind,
} from './masterComparison';

export type ScheduleReviewSeverity = 'error' | 'warning' | 'info';
export type ScheduleIssueKind =
    | 'block-overlap'
    | 'tight-recovery'
    | 'excess-recovery'
    | 'service-gap'
    | 'headway-variation'
    | 'cycle-deviation'
    | 'invalid-timing'
    | 'merged-continuity';

export interface ScheduleReviewLocation {
    direction: string;
    routeName: string;
    tripId?: string;
    blockId?: string;
    startTime?: number;
}

export interface ScheduleReviewIssue {
    id: string;
    kind: ScheduleIssueKind;
    severity: ScheduleReviewSeverity;
    message: string;
    location: ScheduleReviewLocation;
}

export interface ScheduleReviewChange {
    id: string;
    kind: Exclude<TripChangeKind, 'unchanged'> | 'block-changed';
    message: string;
    location: ScheduleReviewLocation;
}

export interface ScheduleReviewResult {
    changes: ScheduleReviewChange[];
    issues: ScheduleReviewIssue[];
    changeCounts: ReturnType<typeof buildMasterComparisonChangeSummary>['counts'];
    issueCounts: Record<ScheduleReviewSeverity, number>;
    blockChangedCount: number;
    publishReady: boolean;
}

export type DraftFreshness =
    | { status: 'not-master-derived' }
    | { status: 'unknown'; routeIdentity?: string; reason: 'source-version-missing' | 'source-version-ahead' | 'master-missing' }
    | { status: 'current'; routeIdentity: string; sourceVersion: number; currentVersion: number }
    | { status: 'stale'; routeIdentity: string; sourceVersion: number; currentVersion: number };

const tablesFromContent = (content: MasterScheduleContent): MasterRouteTable[] => [
    content.northTable,
    content.southTable,
].filter((table): table is MasterRouteTable => !!table);

const directionOf = (table: MasterRouteTable): 'North' | 'South' => (
    table.routeName.toLowerCase().includes('south') ? 'South' : 'North'
);

const reviewDirectionOf = (table: MasterRouteTable): string => {
    const routeNumber = table.routeName.match(/^\s*([A-Za-z0-9]+)/)?.[1] || '';
    const config = getRouteConfig(routeNumber);
    if (config?.segments.length === 1) return config.segments[0].name;
    return directionOf(table);
};

const locationFor = (table: MasterRouteTable, trip: MasterTrip): ScheduleReviewLocation => ({
    direction: getRouteConfig(table.routeName.match(/^\s*([A-Za-z0-9]+)/)?.[1] || '')?.segments.length === 1
        ? reviewDirectionOf(table)
        : trip.direction || directionOf(table),
    routeName: table.routeName,
    tripId: trip.id,
    blockId: trip.blockId,
    startTime: trip.startTime,
});

const changeLabel = (kind: ScheduleReviewChange['kind']): string => ({
    new: 'Trip added',
    extended: 'Trip extended',
    shortened: 'Trip shortened',
    retimed: 'Trip retimed',
    review: 'Trip match needs review',
    removed: 'Trip removed',
    'block-changed': 'Block changed',
}[kind]);

const severityOrder: Record<ScheduleReviewSeverity, number> = { error: 0, warning: 1, info: 2 };

const median = (values: number[]): number | null => {
    if (values.length === 0) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0
        ? (sorted[middle - 1] + sorted[middle]) / 2
        : sorted[middle];
};

const sortByLocation = <T extends { id: string; location: ScheduleReviewLocation }>(a: T, b: T): number =>
    a.location.direction.localeCompare(b.location.direction)
    || (a.location.startTime === undefined ? Number.MAX_SAFE_INTEGER : getOperationalSortTime(a.location.startTime))
        - (b.location.startTime === undefined ? Number.MAX_SAFE_INTEGER : getOperationalSortTime(b.location.startTime))
    || (a.location.blockId || '').localeCompare(b.location.blockId || '', undefined, { numeric: true })
    || a.id.localeCompare(b.id);

const buildChanges = (
    current: MasterScheduleContent,
    baseline?: MasterScheduleContent | null,
): { changes: ScheduleReviewChange[]; changeCounts: ScheduleReviewResult['changeCounts']; blockChangedCount: number } => {
    const schedules = tablesFromContent(current);
    const detailed = buildDetailedMasterComparison(schedules, baseline ? tablesFromContent(baseline) : null);
    const summary = buildMasterComparisonChangeSummary(schedules, detailed);
    const lookup = new Map<string, { table: MasterRouteTable; trip: MasterTrip }>();

    schedules.forEach(table => table.trips.forEach(trip => {
        lookup.set(buildTripKey(trip.direction || directionOf(table), trip.id, table.routeName), { table, trip });
    }));

    const changes: ScheduleReviewChange[] = [];
    let blockChangedCount = 0;
    detailed.currentTripComparisons.forEach((entry, key) => {
        const found = lookup.get(key);
        if (!found) return;
        const kind = entry.status === 'new'
            ? 'new'
            : entry.status === 'ambiguous'
                ? 'review'
                : classifyMatchedTripChange(found.trip, entry.masterTrip);
        if (kind !== 'unchanged') {
            changes.push({
                id: `change:${key}:${kind}`,
                kind,
                message: `${changeLabel(kind)} — Block ${found.trip.blockId}`,
                location: locationFor(found.table, found.trip),
            });
        }
        if (entry.status === 'matched' && found.trip.blockId !== entry.masterTrip.blockId) {
            blockChangedCount += 1;
            changes.push({
                id: `change:${key}:block-changed`,
                kind: 'block-changed',
                message: `Block changed — ${entry.masterTrip.blockId} to ${found.trip.blockId}`,
                location: locationFor(found.table, found.trip),
            });
        }
    });

    detailed.removedMasterTrips.forEach((entry, index) => {
        changes.push({
            id: `change:removed:${entry.direction}:${entry.masterTrip.id}:${index}`,
            kind: 'removed',
            message: `${changeLabel('removed')} — Block ${entry.masterTrip.blockId}`,
            location: {
                direction: entry.direction,
                routeName: entry.routeName,
                tripId: entry.masterTrip.id,
                blockId: entry.masterTrip.blockId,
                startTime: entry.masterTrip.startTime,
            },
        });
    });

    return { changes: changes.sort(sortByLocation), changeCounts: summary.counts, blockChangedCount };
};

const buildIssues = (content: MasterScheduleContent): ScheduleReviewIssue[] => {
    const issues: ScheduleReviewIssue[] = [];
    const overlapIds = new Set<string>();
    const tables = tablesFromContent(content);
    const allByBlock = new Map<string, Array<{ table: MasterRouteTable; trip: MasterTrip }>>();
    tables.forEach(table => table.trips.forEach(trip => {
        allByBlock.set(trip.blockId, [...(allByBlock.get(trip.blockId) || []), { table, trip }]);
    }));
    const blockEndTrips = new Set<MasterTrip>();
    allByBlock.forEach(blockEntries => {
        const sorted = [...blockEntries].sort((a, b) => (
            getOperationalStartTime(a.trip) - getOperationalStartTime(b.trip)
            || a.trip.id.localeCompare(b.trip.id)
        ));
        const finalEntry = sorted[sorted.length - 1];
        if (finalEntry) blockEndTrips.add(finalEntry.trip);
    });

    tables.forEach(table => {
        const direction = reviewDirectionOf(table);
        const byBlock = new Map<string, MasterTrip[]>();
        table.trips.forEach(trip => {
            const key = trip.blockId || 'Unassigned';
            byBlock.set(key, [...(byBlock.get(key) || []), trip]);

            const invalidCoreTiming = !Number.isFinite(trip.startTime)
                || !Number.isFinite(trip.endTime)
                || !Number.isFinite(trip.travelTime)
                || !Number.isFinite(trip.recoveryTime)
                || getOperationalEndTime(trip) < getOperationalStartTime(trip)
                || trip.travelTime < 0
                || trip.recoveryTime < 0;
            const activeStart = Math.max(0, trip.startStopIndex ?? 0);
            const activeEnd = Math.min(table.stops.length - 1, trip.endStopIndex ?? table.stops.length - 1);
            const orderedStopMinutes = table.stops
                .slice(activeStart, activeEnd + 1)
                .map(stop => trip.stopMinutes?.[stop])
                .filter((minute): minute is number => typeof minute === 'number')
                .map(minute => normalizeTripTime(trip, minute));
            const nonMonotonicStops = orderedStopMinutes.some((minute, index) => index > 0 && minute < orderedStopMinutes[index - 1]);
            if (invalidCoreTiming || nonMonotonicStops) {
                issues.push({
                    id: `issue:invalid-timing:${direction}:${trip.id}`,
                    kind: 'invalid-timing', severity: 'error',
                    message: `Block ${trip.blockId}: trip times are impossible or not in stop order`,
                    location: locationFor(table, trip),
                });
            }

            const ratio = trip.travelTime > 0 ? trip.recoveryTime / trip.travelTime : null;
            if (!blockEndTrips.has(trip) && ratio !== null && ratio < 0.1 && trip.recoveryTime < 5) {
                issues.push({
                    id: `issue:tight-recovery:${direction}:${trip.id}`,
                    kind: 'tight-recovery', severity: 'warning',
                    message: `Block ${trip.blockId}: tight recovery (${trip.recoveryTime} min)`,
                    location: locationFor(table, trip),
                });
            } else if (ratio !== null && ratio > 0.25) {
                issues.push({
                    id: `issue:excess-recovery:${direction}:${trip.id}`,
                    kind: 'excess-recovery', severity: 'info',
                    message: `Block ${trip.blockId}: high recovery (${trip.recoveryTime} min)`,
                    location: locationFor(table, trip),
                });
            }
        });

        byBlock.forEach(blockTrips => {
            const sorted = [...blockTrips].sort((a, b) => (
                getOperationalStartTime(a) - getOperationalStartTime(b) || a.id.localeCompare(b.id)
            ));
            for (let index = 1; index < sorted.length; index += 1) {
                const previous = sorted[index - 1];
                const current = sorted[index];
                const previousOccupiedEnd = getOperationalOccupiedEndTime(table, previous);
                const currentStart = getOperationalStartTime(current);
                if (currentStart < previousOccupiedEnd) {
                    const id = `issue:block-overlap:${direction}:${current.id}`;
                    if (!overlapIds.has(id)) {
                        overlapIds.add(id);
                        issues.push({
                            id, kind: 'block-overlap', severity: 'error',
                            message: `Block ${current.blockId}: trips overlap by ${Math.max(0, previousOccupiedEnd - currentStart)} min`,
                            location: locationFor(table, current),
                        });
                    }
                }
            }
        });

        const sortedDirection = [...table.trips].sort((a, b) => (
            getOperationalStartTime(a) - getOperationalStartTime(b) || a.id.localeCompare(b.id)
        ));
        for (let index = 1; index < sortedDirection.length; index += 1) {
            const previous = sortedDirection[index - 1];
            const current = sortedDirection[index];
            const gap = getOperationalStartTime(current) - getOperationalEndTime(previous);
            if (gap > 90) {
                issues.push({
                    id: `issue:service-gap:${direction}:${current.id}`,
                    kind: 'service-gap', severity: 'warning',
                    message: `${direction}: ${gap} min service gap`,
                    location: locationFor(table, current),
                });
            }
        }

        const headways = sortedDirection
            .slice(1)
            .map((trip, index) => getOperationalStartTime(trip) - getOperationalStartTime(sortedDirection[index]))
            .filter(value => value > 0 && value <= 180);
        const medianHeadway = headways.length >= 3 ? median(headways) : null;
        if (medianHeadway !== null) {
            const threshold = Math.max(10, medianHeadway * 0.35);
            headways.forEach((headway, index) => {
                if (Math.abs(headway - medianHeadway) <= threshold) return;
                const affectedTrip = sortedDirection[index + 1];
                issues.push({
                    id: `issue:headway-variation:${direction}:${affectedTrip.id}`,
                    kind: 'headway-variation', severity: 'warning',
                    message: `${direction}: ${headway} min headway differs from the typical ${Math.round(medianHeadway)} min`,
                    location: locationFor(table, affectedTrip),
                });
            });
        }

        const usableCycles = sortedDirection.filter(trip => Number.isFinite(trip.cycleTime) && trip.cycleTime > 0);
        const medianCycle = usableCycles.length >= 3 ? median(usableCycles.map(trip => trip.cycleTime)) : null;
        if (medianCycle !== null) {
            const threshold = Math.max(10, medianCycle * 0.25);
            usableCycles.forEach(trip => {
                if (Math.abs(trip.cycleTime - medianCycle) <= threshold) return;
                issues.push({
                    id: `issue:cycle-deviation:${direction}:${trip.id}`,
                    kind: 'cycle-deviation', severity: 'warning',
                    message: `Block ${trip.blockId}: ${trip.cycleTime} min cycle differs from the typical ${Math.round(medianCycle)} min`,
                    location: locationFor(table, trip),
                });
            });
        }
    });

    // A vehicle block can alternate directions, so check its complete chain as well.
    allByBlock.forEach(blockEntries => {
        const sorted = [...blockEntries].sort((a, b) => (
            getOperationalStartTime(a.trip) - getOperationalStartTime(b.trip)
            || a.trip.id.localeCompare(b.trip.id)
        ));
        for (let index = 1; index < sorted.length; index += 1) {
            const previous = sorted[index - 1].trip;
            const { table, trip: current } = sorted[index];
            const direction = reviewDirectionOf(table);
            const id = `issue:block-overlap:${direction}:${current.id}`;
            const previousOccupiedEnd = getOperationalOccupiedEndTime(sorted[index - 1].table, previous);
            const currentStart = getOperationalStartTime(current);
            if (currentStart < previousOccupiedEnd && !overlapIds.has(id)) {
                overlapIds.add(id);
                issues.push({
                    id, kind: 'block-overlap', severity: 'error',
                    message: `Block ${current.blockId}: trips overlap by ${previousOccupiedEnd - currentStart} min`,
                    location: locationFor(table, current),
                });
            }
        }
    });

    const tripLookup = new Map<string, { table: MasterRouteTable; trip: MasterTrip }>();
    tables.forEach(table => table.trips.forEach(trip => tripLookup.set(trip.id, { table, trip })));
    validateMergedRouteBlockContinuity(tables).forEach((issue, index) => {
        const found = issue.tripIds.map(id => tripLookup.get(id)).find(Boolean);
        if (!found) return;
        issues.push({
            id: `issue:merged-continuity:${issue.routeKey}:${issue.blockId}:${index}`,
            kind: 'merged-continuity', severity: 'error', message: issue.message,
            location: locationFor(found.table, found.trip),
        });
    });

    return issues.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity] || sortByLocation(a, b));
};

/** Pure, deterministic review model for the editor and pre-publish confirmation. */
export const buildScheduleReview = (
    current: MasterScheduleContent,
    baseline?: MasterScheduleContent | null,
): ScheduleReviewResult => {
    const { changes, changeCounts, blockChangedCount } = buildChanges(current, baseline);
    const issues = buildIssues(current);
    const issueCounts = issues.reduce<Record<ScheduleReviewSeverity, number>>(
        (counts, issue) => ({ ...counts, [issue.severity]: counts[issue.severity] + 1 }),
        { error: 0, warning: 0, info: 0 },
    );
    return { changes, issues, changeCounts, issueCounts, blockChangedCount, publishReady: issueCounts.error === 0 };
};

export const buildMasterDraftBasedOn = (
    entry: MasterScheduleEntry,
    options?: { sourceTeamId?: string; sourceLabel?: string },
): DraftBasedOn => ({
    type: 'master',
    id: entry.id,
    sourceVersion: entry.currentVersion,
    ...(options?.sourceTeamId ? { sourceTeamId: options.sourceTeamId } : {}),
    ...(options?.sourceLabel ? { sourceLabel: options.sourceLabel } : {}),
    sourceUpdatedAt: entry.updatedAt,
});

/** Compatibility-safe: legacy master drafts without sourceVersion return unknown, not stale. */
export const assessDraftFreshness = (
    draft: Pick<DraftSchedule, 'basedOn'>,
    currentMaster?: Pick<MasterScheduleEntry, 'id' | 'currentVersion'> | null,
): DraftFreshness => {
    if (draft.basedOn?.type !== 'master') return { status: 'not-master-derived' };
    if (!draft.basedOn.sourceVersion) {
        return { status: 'unknown', routeIdentity: draft.basedOn.id, reason: 'source-version-missing' };
    }
    if (!currentMaster) {
        return { status: 'unknown', routeIdentity: draft.basedOn.id, reason: 'master-missing' };
    }
    if (draft.basedOn.sourceVersion > currentMaster.currentVersion) {
        return { status: 'unknown', routeIdentity: currentMaster.id, reason: 'source-version-ahead' };
    }
    return {
        status: draft.basedOn.sourceVersion < currentMaster.currentVersion ? 'stale' : 'current',
        routeIdentity: currentMaster.id,
        sourceVersion: draft.basedOn.sourceVersion,
        currentVersion: currentMaster.currentVersion,
    };
};
