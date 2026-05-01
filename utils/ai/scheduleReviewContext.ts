import type { DayType } from '../masterScheduleTypes';
import {
    buildRoundTripView,
    type MasterRouteTable,
    type MasterTrip,
} from '../parsers/masterScheduleParser';
import {
    analyzeHeadways,
    calculateOrderedHeadways,
    calculatePeakVehicles,
    calculateServiceSpan,
    validateSchedule,
} from '../schedule/scheduleEditorUtils';
import { getRowInsights } from '../schedule/scheduleInsights';
import {
    buildDetailedMasterComparison,
    buildTripKey,
    type CurrentTripComparisonEntry,
    type MasterComparisonConfidence,
} from '../schedule/masterComparison';
import {
    getRoundTripDisplayedHeadways,
    getRoundTripRowKey,
} from '../schedule/roundTripSortUtils';
import { TimeUtils } from '../timeUtils';
import { extractDirectionFromName, parseRouteInfo } from '../config/routeDirectionConfig';
import type {
    DeterministicFinding,
    ScheduleReviewCategory,
    ScheduleReviewCompareStatus,
    ScheduleReviewRow,
    ScheduleReviewSnapshot,
} from './scheduleReviewTypes';

interface BuildScheduleReviewSnapshotInput {
    draftName: string;
    routeGroupName: string;
    dayType: DayType;
    routeIdentity: string;
    routeTables: MasterRouteTable[];
    targetHeadwayMinutes?: number;
    targetCycleMinutes?: number;
    masterBaseline?: MasterRouteTable[] | null;
}

type RowRef = Pick<ScheduleReviewRow, 'rowKey' | 'blockId'>;

const getCompareRouteKey = (routeName: string): string => (
    parseRouteInfo(routeName).baseRoute.trim().toUpperCase()
);

const tableMatchesReviewCompareScope = (
    baselineTable: MasterRouteTable,
    routeTables: MasterRouteTable[],
): boolean => {
    if (routeTables.some(routeTable => routeTable.routeName === baselineTable.routeName)) {
        return true;
    }

    const baselineRouteKey = getCompareRouteKey(baselineTable.routeName);
    const sameRouteTables = routeTables.filter(routeTable => getCompareRouteKey(routeTable.routeName) === baselineRouteKey);
    if (sameRouteTables.length === 0) return false;

    const baselineDirection = extractDirectionFromName(baselineTable.routeName);
    const activeDirections = sameRouteTables.map(routeTable => extractDirectionFromName(routeTable.routeName));

    if (!baselineDirection || activeDirections.some(direction => !direction)) {
        return true;
    }

    return activeDirections.includes(baselineDirection);
};

const roundRatio = (value: number): number => Math.round(value * 10) / 10;

const sortTripsByStart = (trips: MasterTrip[]): MasterTrip[] => (
    [...trips].sort((a, b) => a.startTime - b.startTime)
);

const compareStatusRank = (status: ScheduleReviewCompareStatus): number => {
    switch (status) {
        case 'ambiguous':
            return 4;
        case 'new':
            return 3;
        case 'removed':
            return 2;
        case 'matched':
            return 1;
        default:
            return 0;
    }
};

const getCompareStatusFromEntries = (entries: CurrentTripComparisonEntry[]): ScheduleReviewCompareStatus => {
    let bestStatus: ScheduleReviewCompareStatus = 'none';

    entries.forEach((entry) => {
        const candidate = entry.status === 'matched' || entry.status === 'new' || entry.status === 'ambiguous'
            ? entry.status
            : 'none';
        if (compareStatusRank(candidate) > compareStatusRank(bestStatus)) {
            bestStatus = candidate;
        }
    });

    return bestStatus;
};

const getCompareReasonFromEntries = (entries: CurrentTripComparisonEntry[]): string | undefined => {
    const reasons = Array.from(new Set(entries.map(entry => entry.reason).filter(Boolean)));
    return reasons.length ? reasons.join(' ') : undefined;
};

const classifyValidationMessage = (message: string): ScheduleReviewCategory => {
    const lower = message.toLowerCase();
    if (lower.includes('recovery')) return 'recovery';
    if (lower.includes('gap')) return 'service-pattern';
    if (lower.includes('headway')) return 'headway';
    if (lower.includes('master') || lower.includes('compare')) return 'compare';
    return 'service-pattern';
};

const compareConfidenceLabel = (confidence: MasterComparisonConfidence): string => {
    if (confidence === 'high') return 'high confidence';
    if (confidence === 'medium') return 'medium confidence';
    return 'low confidence';
};

const pushFinding = (
    findings: DeterministicFinding[],
    finding: Omit<DeterministicFinding, 'id'>,
): void => {
    findings.push({
        id: `finding-${findings.length + 1}`,
        ...finding,
    });
};

const buildSingleTripRow = (
    trip: MasterTrip,
    pairIndex: number,
    headwayMinutes: number | null,
    compareEntry: CurrentTripComparisonEntry | undefined,
): ScheduleReviewRow => {
    const compareStatus = compareEntry
        ? getCompareStatusFromEntries([compareEntry])
        : 'none';
    const flags: string[] = [];

    if (headwayMinutes !== null) {
        flags.push(`Headway ${headwayMinutes}m`);
    }
    if (compareEntry?.status === 'new') {
        flags.push('New compared with master');
    }
    if (compareEntry?.status === 'ambiguous') {
        flags.push(`Compare review needed (${compareConfidenceLabel(compareEntry.confidence)})`);
    }

    return {
        rowKey: `${trip.direction}-${trip.id}`,
        blockId: trip.blockId,
        pairIndex,
        northTripId: trip.direction === 'North' ? trip.id : undefined,
        southTripId: trip.direction === 'South' ? trip.id : undefined,
        firstDeparture: TimeUtils.fromMinutes(trip.startTime),
        lastArrival: TimeUtils.fromMinutes(trip.endTime),
        totalTravelMinutes: trip.travelTime,
        totalRecoveryMinutes: trip.recoveryTime,
        totalCycleMinutes: trip.cycleTime,
        recoveryRatio: trip.travelTime > 0 ? roundRatio((trip.recoveryTime / trip.travelTime) * 100) : null,
        headwayMinutes,
        compareStatus,
        compareReason: compareEntry?.reason,
        flags,
    };
};

export const buildScheduleReviewSnapshot = ({
    draftName,
    routeGroupName,
    dayType,
    routeIdentity,
    routeTables,
    targetHeadwayMinutes,
    targetCycleMinutes,
    masterBaseline,
}: BuildScheduleReviewSnapshotInput): ScheduleReviewSnapshot => {
    const filteredRouteTables = routeTables.filter(Boolean);
    const allTrips = filteredRouteTables.flatMap(table => table.trips);
    const deterministicFindings: DeterministicFinding[] = [];
    const summarySpan = calculateServiceSpan(allTrips);
    const headwayAnalysis = analyzeHeadways(allTrips);

    const relevantBaseline = masterBaseline?.filter(table => (
        tableMatchesReviewCompareScope(table, filteredRouteTables)
    )) ?? null;

    const comparison = buildDetailedMasterComparison(filteredRouteTables, relevantBaseline);
    const compareEntriesByTripId = new Map<string, CurrentTripComparisonEntry>();
    const routeNameByTrip = new Map<MasterTrip, string>();
    filteredRouteTables.forEach(table => {
        table.trips.forEach(trip => routeNameByTrip.set(trip, table.routeName));
    });
    comparison.currentTripComparisons.forEach((entry) => {
        compareEntriesByTripId.set(buildTripKey(entry.direction, entry.currentTripId, entry.routeName), entry);
    });

    const tripIdToRowRef = new Map<string, RowRef>();
    let rows: ScheduleReviewRow[] = [];

    const northTable = filteredRouteTables.find(table => table.trips.some(trip => trip.direction === 'North'));
    const southTable = filteredRouteTables.find(table => table.trips.some(trip => trip.direction === 'South'));

    if (northTable && southTable) {
        const combined = buildRoundTripView(northTable, southTable);
        const displayedHeadways = getRoundTripDisplayedHeadways(combined.rows, combined);

        rows = combined.rows.map((row) => {
            const rowKey = getRoundTripRowKey(row);
            const northTrip = row.trips.find(trip => trip.direction === 'North');
            const southTrip = row.trips.find(trip => trip.direction === 'South');
            const compareEntries = [northTrip, southTrip]
                .filter((trip): trip is MasterTrip => !!trip)
                .map(trip => comparison.currentTripComparisons.get(buildTripKey(
                    trip.direction,
                    trip.id,
                    routeNameByTrip.get(trip)
                )))
                .filter((entry): entry is CurrentTripComparisonEntry => !!entry);
            const compareStatus = getCompareStatusFromEntries(compareEntries);
            const headwayMinutes = displayedHeadways[rowKey] ?? null;
            const rowInsights = getRowInsights(
                headwayMinutes,
                Object.values(displayedHeadways),
                row.totalTravelTime,
                row.totalRecoveryTime,
                targetHeadwayMinutes,
            );

            const flags = rowInsights.map(insight => insight.message);
            if (compareStatus === 'new') {
                flags.push('Contains service not matched to master');
            }
            if (compareStatus === 'ambiguous') {
                flags.push('Contains trip(s) that need compare review against master');
            }

            const builtRow: ScheduleReviewRow = {
                rowKey,
                blockId: row.blockId,
                pairIndex: row.pairIndex,
                northTripId: northTrip?.id,
                southTripId: southTrip?.id,
                firstDeparture: row.trips[0] ? TimeUtils.fromMinutes(row.trips[0].startTime) : undefined,
                lastArrival: row.trips.length ? TimeUtils.fromMinutes(row.trips[row.trips.length - 1].endTime) : undefined,
                totalTravelMinutes: row.totalTravelTime,
                totalRecoveryMinutes: row.totalRecoveryTime,
                totalCycleMinutes: row.totalCycleTime,
                recoveryRatio: row.totalTravelTime > 0 ? roundRatio((row.totalRecoveryTime / row.totalTravelTime) * 100) : null,
                headwayMinutes,
                compareStatus,
                compareReason: getCompareReasonFromEntries(compareEntries),
                flags,
            };

            [northTrip, southTrip].forEach((trip) => {
                if (!trip) return;
                tripIdToRowRef.set(trip.id, {
                    rowKey,
                    blockId: row.blockId,
                });
            });

            rowInsights.forEach((insight) => {
                pushFinding(deterministicFindings, {
                    severity: insight.severity,
                    category: insight.type,
                    scope: 'row',
                    rowKey,
                    blockId: row.blockId,
                    message: insight.message,
                });
            });

            if (compareStatus === 'new') {
                pushFinding(deterministicFindings, {
                    severity: 'info',
                    category: 'compare',
                    scope: 'row',
                    rowKey,
                    blockId: row.blockId,
                    message: `Row ${rowKey} includes new service compared with master.`,
                });
            }

            if (compareStatus === 'ambiguous') {
                pushFinding(deterministicFindings, {
                    severity: 'warning',
                    category: 'compare',
                    scope: 'row',
                    rowKey,
                    blockId: row.blockId,
                    message: `Row ${rowKey} needs compare review because at least one trip has an ambiguous master match.`,
                });
            }

            return builtRow;
        });
    } else {
        const sortedTrips = sortTripsByStart(allTrips);
        const headways = calculateOrderedHeadways(sortedTrips, trip => trip.startTime);

        rows = sortedTrips.map((trip, index) => {
            const compareEntry = compareEntriesByTripId.get(buildTripKey(
                trip.direction,
                trip.id,
                routeNameByTrip.get(trip)
            ));
            const row = buildSingleTripRow(trip, index, headways[trip.id] ?? null, compareEntry);
            tripIdToRowRef.set(trip.id, {
                rowKey: row.rowKey,
                blockId: row.blockId,
            });

            if (row.compareStatus === 'new') {
                pushFinding(deterministicFindings, {
                    severity: 'info',
                    category: 'compare',
                    scope: 'row',
                    rowKey: row.rowKey,
                    blockId: row.blockId,
                    message: `Trip ${trip.id} is new compared with master.`,
                });
            }

            if (row.compareStatus === 'ambiguous') {
                pushFinding(deterministicFindings, {
                    severity: 'warning',
                    category: 'compare',
                    scope: 'row',
                    rowKey: row.rowKey,
                    blockId: row.blockId,
                    message: `Trip ${trip.id} needs compare review against master.`,
                });
            }

            return row;
        });
    }

    validateSchedule(allTrips).forEach((warning) => {
        const rowRef = warning.tripId ? tripIdToRowRef.get(warning.tripId) : undefined;
        pushFinding(deterministicFindings, {
            severity: warning.type === 'info' ? 'info' : 'warning',
            category: classifyValidationMessage(warning.message),
            scope: rowRef ? 'row' : 'route',
            rowKey: rowRef?.rowKey,
            blockId: rowRef?.blockId,
            message: warning.message,
        });
    });

    comparison.removedMasterTrips.forEach((removedTrip) => {
        pushFinding(deterministicFindings, {
            severity: 'warning',
            category: 'compare',
            scope: 'route',
            blockId: removedTrip.masterTrip.blockId,
            message: `Master trip ${removedTrip.masterTrip.id} on block ${removedTrip.masterTrip.blockId} is not present in the current draft.`,
        });
    });

    const blockCount = new Set(allTrips.map(trip => trip.blockId)).size;
    const compareToMaster = relevantBaseline && relevantBaseline.length > 0
        ? {
            matchedCount: Array.from(comparison.currentTripComparisons.values()).filter(entry => entry.status === 'matched').length,
            newCount: Array.from(comparison.currentTripComparisons.values()).filter(entry => entry.status === 'new').length,
            ambiguousCount: Array.from(comparison.currentTripComparisons.values()).filter(entry => entry.status === 'ambiguous').length,
            removedCount: comparison.removedMasterTrips.length,
            masterShiftNorthMinutes: comparison.masterShiftByDir.North,
            masterShiftSouthMinutes: comparison.masterShiftByDir.South,
        }
        : undefined;

    return {
        draftName,
        routeGroupName,
        dayType,
        routeIdentity,
        generatedAt: new Date().toISOString(),
        summary: {
            tripCount: allTrips.length,
            blockCount,
            peakVehicles: calculatePeakVehicles(allTrips),
            serviceStart: summarySpan.start,
            serviceEnd: summarySpan.end,
            serviceHours: summarySpan.hours,
            totalTravelMinutes: allTrips.reduce((sum, trip) => sum + trip.travelTime, 0),
            totalRecoveryMinutes: allTrips.reduce((sum, trip) => sum + trip.recoveryTime, 0),
            avgHeadwayMinutes: headwayAnalysis.avg > 0 ? headwayAnalysis.avg : null,
            targetHeadwayMinutes,
            targetCycleMinutes,
        },
        compareToMaster,
        rows,
        deterministicFindings,
    };
};
