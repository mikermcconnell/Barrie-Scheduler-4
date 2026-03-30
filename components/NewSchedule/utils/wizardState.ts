import type { MasterRouteTable } from '../../../utils/parsers/masterScheduleParser';
import type { ScheduleConfig } from '../steps/Step3Build';
import type { ImportMode, PerformanceConfig } from '../steps/Step1Upload';
import type { RuntimeData, SegmentRawData } from './csvParser';
import type { Step2ApprovalState } from './step2ReviewTypes';
import type { ApprovedRuntimeContract } from './step2ReviewTypes';
import {
    computeDirectionBandSummary,
    getLowConfidenceThreshold,
    type DirectionBandSummary,
    type SampleCountMode,
    type TimeBand,
    type TripBucketAnalysis,
} from '../../../utils/ai/runtimeAnalysis';
import { getRouteConfig, getRouteVariant, parseRouteInfo } from '../../../utils/config/routeDirectionConfig';
import type { PerformanceRuntimeDiagnostics } from '../../../utils/performanceRuntimeComputer';
import {
    buildNormalizedSegmentNameLookup,
    normalizeSegmentNameForMatching,
    normalizeSegmentStopKey,
    resolveCanonicalSegmentName,
} from '../../../utils/runtimeSegmentMatching';
import type { Step2StopOrderHealth } from './step2StopOrder';

export interface WizardProgressLike {
    step: 1 | 2 | 3 | 4;
    fileNames: string[];
    importMode?: ImportMode;
    performanceConfig?: {
        routeId: string;
        dateRange: { start: string; end: string } | null;
    };
}

export interface WizardProjectLike {
    isGenerated?: boolean;
    generatedSchedules?: MasterRouteTable[];
    config?: ScheduleConfig;
    analysis?: TripBucketAnalysis[];
    parsedData?: RuntimeData[];
    approvedRuntimeContract?: ApprovedRuntimeContract;
    approvedRuntimeModel?: ApprovedRuntimeModel;
}

export const createDefaultPerformanceConfig = (): PerformanceConfig => ({
    routeId: '',
    dateRange: null,
});

export const createDefaultScheduleConfig = (): ScheduleConfig => ({
    routeNumber: '10',
    cycleTime: 60,
    recoveryRatio: 15,
    blocks: [],
});

export const getUsableCanonicalDirectionStops = (
    routeNumber: string | undefined,
    directionStops: Record<string, string[]> | undefined
): Record<string, string[]> | undefined => {
    if (!directionStops) return undefined;

    const normalized = {
        North: directionStops.North || [],
        South: directionStops.South || [],
    };

    if (normalized.North.length === 0 && normalized.South.length === 0) {
        return undefined;
    }

    const parsedRoute = routeNumber?.trim() ? parseRouteInfo(routeNumber.trim()) : null;
    const routeConfig = parsedRoute ? getRouteConfig(parsedRoute.baseRoute) : null;
    const isBidirectionalRoute = !!routeConfig && routeConfig.segments.length === 2;
    const populatedDirections = [normalized.North, normalized.South].filter(stops => stops.length > 0).length;

    if (isBidirectionalRoute && populatedDirections < 2) {
        return undefined;
    }

    if (
        isBidirectionalRoute
        && normalized.North.length > 0
        && normalized.South.length > 0
    ) {
        const northTerminus = normalized.North[normalized.North.length - 1];
        const southStart = normalized.South[0];

        if (normalizeSegmentStopKey(northTerminus) !== normalizeSegmentStopKey(southStart)) {
            return {
                North: [...normalized.North, southStart],
                South: normalized.South,
            };
        }
    }

    return normalized;
};

export const buildSegmentsMapFromParsedData = (
    results: RuntimeData[]
): Record<string, SegmentRawData[]> => {
    const groupedSegments: Record<string, SegmentRawData[]> = {};
    const getSegmentOrderValue = (value?: number): number =>
        Number.isFinite(value) ? value as number : Number.POSITIVE_INFINITY;

    const compareSegmentsByIndex = (a: SegmentRawData, b: SegmentRawData): number => {
        const fromDiff = getSegmentOrderValue(a.fromRouteStopIndex) - getSegmentOrderValue(b.fromRouteStopIndex);
        if (fromDiff !== 0) return fromDiff;

        const toDiff = getSegmentOrderValue(a.toRouteStopIndex) - getSegmentOrderValue(b.toRouteStopIndex);
        if (toDiff !== 0) return toDiff;

        return 0;
    };

    const orderSegmentsByRouteChain = (segments: SegmentRawData[]): SegmentRawData[] => {
        const parsed = segments.map((segment, index) => {
            const parts = segment.segmentName.split(' to ');
            return {
                segment,
                index,
                from: parts[0]?.trim() || '',
                to: parts[1]?.trim() || '',
                fromKey: normalizeSegmentStopKey(parts[0]?.trim() || ''),
                toKey: normalizeSegmentStopKey(parts[1]?.trim() || ''),
            };
        });

        const hasUsableIndices = parsed.every(item =>
            Number.isFinite(item.segment.fromRouteStopIndex) && Number.isFinite(item.segment.toRouteStopIndex)
        );

        if (hasUsableIndices) {
            return [...segments].sort(compareSegmentsByIndex);
        }

        const outgoing = new Map<string, typeof parsed[number]>();
        const incomingCounts = new Map<string, number>();
        let isChainSafe = true;

        parsed.forEach((item) => {
            if (!item.fromKey || !item.toKey) {
                isChainSafe = false;
                return;
            }
            if (outgoing.has(item.fromKey)) {
                isChainSafe = false;
                return;
            }
            outgoing.set(item.fromKey, item);
            incomingCounts.set(item.toKey, (incomingCounts.get(item.toKey) || 0) + 1);
            if (!incomingCounts.has(item.fromKey)) incomingCounts.set(item.fromKey, incomingCounts.get(item.fromKey) || 0);
        });

        if (!isChainSafe) return [...segments];

        const start = parsed.find(item => (incomingCounts.get(item.fromKey) || 0) === 0)?.fromKey || parsed[0]?.fromKey;
        if (!start) return [...segments];

        const ordered: SegmentRawData[] = [];
        const visited = new Set<number>();
        let current = start;

        while (outgoing.has(current)) {
            const next = outgoing.get(current)!;
            if (visited.has(next.index)) break;
            ordered.push(next.segment);
            visited.add(next.index);
            current = next.toKey;
        }

        if (ordered.length === segments.length) return ordered;

        parsed.forEach((item) => {
            if (!visited.has(item.index)) ordered.push(item.segment);
        });

        return ordered;
    };

    results.forEach((runtime) => {
        const direction = runtime.detectedDirection || 'North';
        if (!groupedSegments[direction]) {
            groupedSegments[direction] = [];
        }
        groupedSegments[direction].push(...runtime.segments);
    });

    Object.keys(groupedSegments).forEach((direction) => {
        groupedSegments[direction] = orderSegmentsByRouteChain(groupedSegments[direction]);
    });

    return groupedSegments;
};

export const getOrderedSegmentNames = (
    segmentsMap: Record<string, SegmentRawData[]>,
    analysis?: TripBucketAnalysis[]
): string[] => {
    const seen = new Set<string>();
    const ordered: string[] = [];
    const directionOrder: Record<string, number> = {
        North: 0,
        A: 1,
        Loop: 2,
        South: 3,
        B: 4,
    };

    const orderedDirections = Object.keys(segmentsMap).sort((a, b) => {
        const orderA = directionOrder[a] ?? Number.MAX_SAFE_INTEGER;
        const orderB = directionOrder[b] ?? Number.MAX_SAFE_INTEGER;
        if (orderA !== orderB) return orderA - orderB;
        return a.localeCompare(b);
    });

    orderedDirections.forEach((direction) => {
        segmentsMap[direction].forEach((segment) => {
            if (seen.has(segment.segmentName)) return;
            seen.add(segment.segmentName);
            ordered.push(segment.segmentName);
        });
    });

    if (ordered.length > 0) return ordered;

    analysis?.forEach((bucket) => {
        bucket.details?.forEach((detail) => {
            if (seen.has(detail.segmentName)) return;
            seen.add(detail.segmentName);
            ordered.push(detail.segmentName);
        });
    });

    return ordered;
};

export interface OrderedSegmentColumn {
    segmentName: string;
    direction?: string;
    groupLabel?: string;
}

export {
    buildNormalizedSegmentNameLookup,
    normalizeSegmentNameForMatching,
    normalizeSegmentStopKey,
    resolveCanonicalSegmentName,
};

const DIRECTION_DISPLAY_ORDER: Record<string, number> = {
    North: 0,
    A: 1,
    Loop: 2,
    South: 3,
    B: 4,
};

const getOrderedDirections = (segmentsMap: Record<string, SegmentRawData[]>): string[] => {
    return Object.keys(segmentsMap).sort((a, b) => {
        const orderA = DIRECTION_DISPLAY_ORDER[a] ?? Number.MAX_SAFE_INTEGER;
        const orderB = DIRECTION_DISPLAY_ORDER[b] ?? Number.MAX_SAFE_INTEGER;
        if (orderA !== orderB) return orderA - orderB;
        return a.localeCompare(b);
    });
};

const getDirectionGroupLabel = (routeNumber: string | undefined, direction: string): string | undefined => {
    if (!direction) return undefined;
    if (!routeNumber) return direction;

    const parsedRoute = parseRouteInfo(routeNumber);
    const routeConfig = getRouteConfig(parsedRoute.baseRoute);
    if (!routeConfig) return direction;

    if (routeConfig.suffixIsDirection) {
        if (direction === 'North' || direction === 'A') {
            return `${parsedRoute.baseRoute}A`;
        }
        if (direction === 'South' || direction === 'B') {
            return `${parsedRoute.baseRoute}B`;
        }
    }

    if (direction === 'North' || direction === 'South') {
        const segment = routeConfig.segments.find(value => value.name === direction);
        return segment?.variant || direction;
    }

    if (direction === 'Loop') {
        return parsedRoute.variant || routeNumber;
    }

    return direction;
};

export const getOrderedSegmentColumns = (
    segmentsMap: Record<string, SegmentRawData[]>,
    routeNumber?: string,
    analysis?: TripBucketAnalysis[]
): OrderedSegmentColumn[] => {
    const columns: OrderedSegmentColumn[] = [];
    const seen = new Set<string>();

    getOrderedDirections(segmentsMap).forEach((direction) => {
        const groupLabel = getDirectionGroupLabel(routeNumber, direction);
        segmentsMap[direction].forEach((segment) => {
            if (seen.has(segment.segmentName)) return;
            seen.add(segment.segmentName);
            columns.push({
                segmentName: segment.segmentName,
                direction,
                groupLabel,
            });
        });
    });

    if (columns.length > 0) return columns;

    return getOrderedSegmentNames(segmentsMap, analysis).map((segmentName) => ({
        segmentName,
    }));
};

export const alignOrderedSegmentColumnsToPreferredGroups = (
    segmentColumns: OrderedSegmentColumn[],
    preferredColumns?: OrderedSegmentColumn[]
): OrderedSegmentColumn[] => {
    if (segmentColumns.length === 0 || !preferredColumns || preferredColumns.length === 0) {
        return segmentColumns;
    }

    const preferredGroupOrder = new Map<string, number>();
    preferredColumns.forEach((column) => {
        const key = column.groupLabel?.trim() || column.direction?.trim();
        if (!key || preferredGroupOrder.has(key)) return;
        preferredGroupOrder.set(key, preferredGroupOrder.size);
    });

    if (preferredGroupOrder.size === 0) {
        return segmentColumns;
    }

    return [...segmentColumns]
        .map((column, index) => ({
            column,
            index,
            rank: preferredGroupOrder.get(column.groupLabel?.trim() || column.direction?.trim() || '') ?? Number.MAX_SAFE_INTEGER,
        }))
        .sort((a, b) => {
            if (a.rank !== b.rank) return a.rank - b.rank;
            return a.index - b.index;
        })
        .map(item => item.column);
};

const findCanonicalStopPair = (
    stops: string[],
    fromStopKey: string,
    toStopKey: string
): { fromIndex: number; toIndex: number } | null => {
    if (!fromStopKey || !toStopKey || stops.length === 0) return null;

    const normalizedStops = stops.map(stop => normalizeSegmentStopKey(stop));
    for (let fromIndex = 0; fromIndex < normalizedStops.length; fromIndex += 1) {
        if (normalizedStops[fromIndex] !== fromStopKey) continue;
        for (let toIndex = fromIndex + 1; toIndex < normalizedStops.length; toIndex += 1) {
            if (normalizedStops[toIndex] === toStopKey) {
                return { fromIndex, toIndex };
            }
        }
    }

    return null;
};

export const orderSegmentColumnsByCanonicalStops = (
    segmentColumns: OrderedSegmentColumn[],
    canonicalDirectionStops?: Partial<Record<'North' | 'South', string[]>>,
    preferredColumns?: OrderedSegmentColumn[],
    options?: {
        excludeUnmatched?: boolean;
    }
): OrderedSegmentColumn[] => {
    if (
        segmentColumns.length === 0
        || !canonicalDirectionStops
        || (
            (!canonicalDirectionStops.North || canonicalDirectionStops.North.length === 0)
            && (!canonicalDirectionStops.South || canonicalDirectionStops.South.length === 0)
        )
    ) {
        return segmentColumns;
    }

    const preferredGroupOrder = new Map<string, number>();
    preferredColumns?.forEach((column) => {
        const key = column.groupLabel?.trim() || column.direction?.trim();
        if (!key || preferredGroupOrder.has(key)) return;
        preferredGroupOrder.set(key, preferredGroupOrder.size);
    });

    const getGroupRank = (groupKey?: string, direction?: string): number => {
        const directGroup = groupKey?.trim();
        if (directGroup && preferredGroupOrder.has(directGroup)) {
            return preferredGroupOrder.get(directGroup)!;
        }
        const directDirection = direction?.trim();
        if (directDirection && preferredGroupOrder.has(directDirection)) {
            return preferredGroupOrder.get(directDirection)!;
        }
        if (directDirection === 'North') return 0;
        if (directDirection === 'South') return 1;
        return Number.MAX_SAFE_INTEGER;
    };

    const ordered = [...segmentColumns]
        .map((column, index) => {
            const [fromStop = '', toStop = ''] = column.segmentName.split(' to ');
            const fromStopKey = normalizeSegmentStopKey(fromStop);
            const toStopKey = normalizeSegmentStopKey(toStop);

            const northMatch = canonicalDirectionStops.North
                ? findCanonicalStopPair(canonicalDirectionStops.North, fromStopKey, toStopKey)
                : null;
            const southMatch = canonicalDirectionStops.South
                ? findCanonicalStopPair(canonicalDirectionStops.South, fromStopKey, toStopKey)
                : null;

            const canonicalDirection = northMatch ? 'North' : southMatch ? 'South' : undefined;
            const canonicalMatch = northMatch || southMatch;
            const groupRank = getGroupRank(column.groupLabel, canonicalDirection || column.direction);

            return {
                column: canonicalDirection
                    ? {
                        ...column,
                        direction: canonicalDirection,
                    }
                    : column,
                index,
                groupRank,
                hasCanonicalMatch: !!canonicalMatch,
                fromIndex: canonicalMatch?.fromIndex ?? Number.MAX_SAFE_INTEGER,
                toIndex: canonicalMatch?.toIndex ?? Number.MAX_SAFE_INTEGER,
            };
        })
        .sort((a, b) => {
            if (a.groupRank !== b.groupRank) return a.groupRank - b.groupRank;
            if (a.hasCanonicalMatch !== b.hasCanonicalMatch) return a.hasCanonicalMatch ? -1 : 1;
            if (a.fromIndex !== b.fromIndex) return a.fromIndex - b.fromIndex;
            if (a.toIndex !== b.toIndex) return a.toIndex - b.toIndex;
            return a.index - b.index;
        });

    const matched = ordered.filter(item => item.hasCanonicalMatch);
    if (options?.excludeUnmatched && matched.length > 0) {
        return matched.map(item => item.column);
    }

    return ordered.map(item => item.column);
};

export const buildCanonicalSegmentColumnsFromMasterStops = (
    routeNumber: string,
    northStops: string[],
    southStops: string[]
): OrderedSegmentColumn[] => {
    const buildColumnsForDirection = (direction: 'North' | 'South', stops: string[]): OrderedSegmentColumn[] => {
        const groupLabel = getDirectionGroupLabel(routeNumber, direction);
        const columns: OrderedSegmentColumn[] = [];
        for (let index = 0; index < stops.length - 1; index += 1) {
            columns.push({
                segmentName: `${stops[index]} to ${stops[index + 1]}`,
                direction,
                groupLabel,
            });
        }
        return columns;
    };

    return [
        ...buildColumnsForDirection('North', northStops),
        ...buildColumnsForDirection('South', southStops),
    ];
};

export interface Step2DataHealthReport {
    status: 'ready' | 'warning' | 'blocked';
    blockers: string[];
    warnings: string[];
    stopOrder?: Step2StopOrderHealth | null;
    expectedDirections: number;
    matchedDirections: string[];
    expectedSegmentCount: number;
    matchedSegmentCount: number;
    missingSegments: string[];
    completeBucketCount: number;
    incompleteBucketCount: number;
    lowConfidenceBucketCount: number;
    availableBucketCount: number;
    repairedBucketCount?: number;
    boundaryBucketCount?: number;
    singleGapBucketCount?: number;
    internalGapBucketCount?: number;
    fragmentedGapBucketCount?: number;
    runtimeSourceSummary: string;
    sampleCountMode?: SampleCountMode;
    confidenceThreshold: number;
    importedAt?: string;
    runtimeLogicVersion?: number;
    usesLegacyRuntimeLogic: boolean;
    cleanHistoryStartDate?: string;
    excludedLegacyDayCount?: number;
    usesCleanHistoryCutoff?: boolean;
}

export interface ApprovedRuntimeBandPreview {
    direction: string;
    bandId: string;
    avgTotal: number;
    timeSlotCount: number;
    segmentCount: number;
}

export interface ApprovedRuntimeModel {
    routeNumber?: string;
    dayType: string;
    importMode: ImportMode;
    status: Step2DataHealthReport['status'];
    chartBasis: 'observed-cycle' | 'uploaded-percentiles';
    generationBasis: 'direction-band-summary';
    buckets: TripBucketAnalysis[];
    bands: TimeBand[];
    directionBandSummary: DirectionBandSummary;
    segmentColumns: OrderedSegmentColumn[];
    healthReport: Step2DataHealthReport;
    usableBucketCount: number;
    ignoredBucketCount: number;
    usableBandCount: number;
    directions: string[];
    bandPreviews: ApprovedRuntimeBandPreview[];
}

export const buildStep2DataHealthReport = (params: {
    routeNumber?: string;
    analysis: TripBucketAnalysis[];
    segmentsMap: Record<string, SegmentRawData[]>;
    canonicalSegmentColumns?: OrderedSegmentColumn[];
    performanceDiagnostics?: PerformanceRuntimeDiagnostics | null;
    stopOrder?: Step2StopOrderHealth | null;
}): Step2DataHealthReport => {
    const {
        routeNumber,
        analysis,
        segmentsMap,
        canonicalSegmentColumns,
        performanceDiagnostics,
        stopOrder,
    } = params;

    const displaySegmentColumns = (canonicalSegmentColumns && canonicalSegmentColumns.length > 0)
        ? canonicalSegmentColumns
        : getOrderedSegmentColumns(segmentsMap, routeNumber, analysis);
    const displaySegmentNames = displaySegmentColumns.map(column => column.segmentName);
    const lookup = buildNormalizedSegmentNameLookup(displaySegmentNames);
    const sampleCountMode = analysis.find(bucket => bucket.sampleCountMode)?.sampleCountMode;
    const confidenceThreshold = getLowConfidenceThreshold(sampleCountMode);

    const matchedSegments = new Set<string>();
    let completeBucketCount = 0;
    let incompleteBucketCount = 0;
    let lowConfidenceBucketCount = 0;
    let repairedBucketCount = 0;
    let boundaryBucketCount = 0;
    let singleGapBucketCount = 0;
    let internalGapBucketCount = 0;
    let fragmentedGapBucketCount = 0;

    analysis.forEach((bucket) => {
        const bucketSegments = new Set<string>();
        const sampleValues: number[] = [];

        bucket.details?.forEach((detail) => {
            const resolved = resolveCanonicalSegmentName(detail.segmentName, lookup);
            if (!resolved) return;
            matchedSegments.add(resolved);
            bucketSegments.add(resolved);
            sampleValues.push(detail.n && detail.n > 0 ? detail.n : 1);
        });

        const expectedSegmentCount = displaySegmentNames.length;
        const missingSegments = Math.max(0, expectedSegmentCount - bucketSegments.size);
        const minSamples = sampleValues.length > 0 ? Math.min(...sampleValues) : 0;
        const isIncomplete = expectedSegmentCount > 0 && missingSegments > 0;
        const hasLowSamples = minSamples > 0 && minSamples < confidenceThreshold;

        if (!isIncomplete && expectedSegmentCount > 0) {
            completeBucketCount += 1;
        }
        if (isIncomplete) {
            incompleteBucketCount += 1;
        }
        if (isIncomplete || hasLowSamples) {
            lowConfidenceBucketCount += 1;
        }

        switch (bucket.coverageCause) {
            case 'repaired-single-gap':
                repairedBucketCount += 1;
                break;
            case 'boundary-service':
                boundaryBucketCount += 1;
                break;
            case 'single-gap':
                singleGapBucketCount += 1;
                break;
            case 'partial-cycle-gap':
                internalGapBucketCount += 1;
                break;
            case 'fragmented-gap':
                fragmentedGapBucketCount += 1;
                break;
            default:
                break;
        }
    });

    const missingSegments = displaySegmentNames.filter(segmentName => !matchedSegments.has(segmentName));
    const routeConfig = routeNumber ? getRouteConfig(parseRouteInfo(routeNumber).baseRoute) : null;
    const expectedDirections = routeConfig?.segments.length ?? Math.max(performanceDiagnostics?.directions.length || 0, 1);
    const matchedDirections = performanceDiagnostics?.directions || Object.keys(segmentsMap);
    const runtimeSources: string[] = [];
    if ((performanceDiagnostics?.stopEntryCount || 0) > 0) runtimeSources.push('stop-level');
    if ((performanceDiagnostics?.tripEntryCount || 0) > 0) runtimeSources.push('trip-leg');
    if ((performanceDiagnostics?.coarseEntryCount || 0) > 0) runtimeSources.push('coarse fallback');
    const runtimeSourceSummary = runtimeSources.length > 0
        ? runtimeSources.join(' + ')
        : 'No matched runtime source';

    const blockers: string[] = [];
    const warnings: string[] = [];

    if (analysis.length === 0) {
        blockers.push('No runtime analysis buckets were built for this route selection.');
    }
    if (performanceDiagnostics && performanceDiagnostics.matchedRouteDayCount === 0) {
        blockers.push('No matching performance days were found for the selected route, date range, and day type.');
    }
    if (expectedDirections > 1 && matchedDirections.length < expectedDirections) {
        blockers.push(`Only ${matchedDirections.length} of ${expectedDirections} directions were found for this route.`);
    }
    if (displaySegmentNames.length > 0 && completeBucketCount === 0) {
        blockers.push('No complete cycle buckets are currently available for scheduling.');
    }

    if (performanceDiagnostics?.usesLegacyRuntimeLogic) {
        warnings.push('This performance import was built with older runtime logic. Re-importing is recommended.');
    }
    if (missingSegments.length > 0) {
        warnings.push(`${missingSegments.length} segment${missingSegments.length === 1 ? '' : 's'} never matched the current route chain.`);
    }
    if (lowConfidenceBucketCount > 0) {
        warnings.push(`${lowConfidenceBucketCount} bucket${lowConfidenceBucketCount === 1 ? '' : 's'} have low confidence or incomplete coverage.`);
    }
    if (repairedBucketCount > 0) {
        warnings.push(
            repairedBucketCount === 1
                ? '1 near-complete bucket was repaired from adjacent complete buckets and marked as estimated.'
                : `${repairedBucketCount} near-complete buckets were repaired from adjacent complete buckets and marked as estimated.`
        );
    }
    if (boundaryBucketCount > 0) {
        warnings.push(
            boundaryBucketCount === 1
                ? '1 bucket reflects boundary service or short turns and remains excluded from banding.'
                : `${boundaryBucketCount} buckets reflect boundary service or short turns and remain excluded from banding.`
        );
    }
    if (singleGapBucketCount > 0) {
        warnings.push(
            singleGapBucketCount === 1
                ? '1 near-complete bucket still has a single missing segment.'
                : `${singleGapBucketCount} near-complete buckets still have a single missing segment.`
        );
    }
    if ((internalGapBucketCount + fragmentedGapBucketCount) > 0) {
        const totalInternalGapBuckets = internalGapBucketCount + fragmentedGapBucketCount;
        warnings.push(
            totalInternalGapBuckets === 1
                ? '1 bucket still has an internal route gap and remains excluded from banding.'
                : `${totalInternalGapBuckets} buckets still have internal route gaps and remain excluded from banding.`
        );
    }
    if ((performanceDiagnostics?.stopEntryCount || 0) === 0 && (performanceDiagnostics?.tripEntryCount || 0) > 0) {
        warnings.push('This route is relying on trip-leg runtime fallback because stop-level observations are unavailable.');
    }
    if ((performanceDiagnostics?.stopEntryCount || 0) === 0 && (performanceDiagnostics?.tripEntryCount || 0) === 0 && (performanceDiagnostics?.coarseEntryCount || 0) > 0) {
        warnings.push('This route is relying on older coarse runtime summaries.');
    }
    if (stopOrder) {
        if (stopOrder.sourceUsed === 'none') {
            blockers.push(stopOrder.summary);
        } else if (!stopOrder.usedForPlanning) {
            warnings.push(stopOrder.summary);
        }
        warnings.push(...stopOrder.warnings);
    }

    const uniqueBlockers = Array.from(new Set(blockers));
    const uniqueWarnings = Array.from(new Set(warnings));

    return {
        status: uniqueBlockers.length > 0 ? 'blocked' : uniqueWarnings.length > 0 ? 'warning' : 'ready',
        blockers: uniqueBlockers,
        warnings: uniqueWarnings,
        stopOrder: stopOrder ?? null,
        expectedDirections,
        matchedDirections,
        expectedSegmentCount: displaySegmentNames.length,
        matchedSegmentCount: matchedSegments.size,
        missingSegments,
        completeBucketCount,
        incompleteBucketCount,
        lowConfidenceBucketCount,
        availableBucketCount: analysis.length,
        repairedBucketCount,
        boundaryBucketCount,
        singleGapBucketCount,
        internalGapBucketCount,
        fragmentedGapBucketCount,
        runtimeSourceSummary,
        sampleCountMode,
        confidenceThreshold,
        importedAt: performanceDiagnostics?.importedAt,
        runtimeLogicVersion: performanceDiagnostics?.runtimeLogicVersion,
        usesLegacyRuntimeLogic: performanceDiagnostics?.usesLegacyRuntimeLogic ?? false,
        cleanHistoryStartDate: performanceDiagnostics?.cleanHistoryStartDate,
        excludedLegacyDayCount: performanceDiagnostics?.excludedLegacyDayCount,
        usesCleanHistoryCutoff: performanceDiagnostics?.usesCleanHistoryCutoff ?? false,
    };
};

export const buildApprovedRuntimeModel = (params: {
    dayType: string;
    importMode: ImportMode;
    routeNumber?: string;
    analysis: TripBucketAnalysis[];
    bands: TimeBand[];
    segmentsMap: Record<string, SegmentRawData[]>;
    canonicalSegmentColumns?: OrderedSegmentColumn[];
    healthReport?: Step2DataHealthReport | null;
}): ApprovedRuntimeModel => {
    const {
        dayType,
        importMode,
        routeNumber,
        analysis,
        bands,
        segmentsMap,
        canonicalSegmentColumns,
        healthReport,
    } = params;

    const segmentColumns = (canonicalSegmentColumns && canonicalSegmentColumns.length > 0)
        ? canonicalSegmentColumns
        : getOrderedSegmentColumns(segmentsMap, routeNumber, analysis);
    const resolvedHealthReport = healthReport ?? buildStep2DataHealthReport({
        routeNumber,
        analysis,
        segmentsMap,
        canonicalSegmentColumns,
        performanceDiagnostics: null,
    });

    const directionBandSummary = computeDirectionBandSummary(
        analysis,
        bands,
        segmentsMap,
        segmentColumns.length > 0 ? { canonicalSegmentColumns: segmentColumns } : undefined
    );

    const usableBuckets = analysis.filter(bucket => !bucket.ignored && !!bucket.assignedBand);
    const ignoredBucketCount = analysis.filter(bucket => bucket.ignored).length;
    const usableBandIds = new Set(usableBuckets.map(bucket => bucket.assignedBand).filter(Boolean));
    const directions = Object.keys(directionBandSummary);
    const bandPreviews = directions.flatMap((direction) => (
        (directionBandSummary[direction] || []).map((band) => ({
            direction,
            bandId: band.bandId,
            avgTotal: band.avgTotal,
            timeSlotCount: band.timeSlots.length,
            segmentCount: band.segments.length,
        }))
    ));

    return {
        routeNumber,
        dayType,
        importMode,
        status: resolvedHealthReport.status,
        chartBasis: analysis.some(bucket => bucket.observedCycleP50 !== undefined) ? 'observed-cycle' : 'uploaded-percentiles',
        generationBasis: 'direction-band-summary',
        buckets: analysis,
        bands,
        directionBandSummary,
        segmentColumns,
        healthReport: resolvedHealthReport,
        usableBucketCount: usableBuckets.length,
        ignoredBucketCount,
        usableBandCount: usableBandIds.size,
        directions,
        bandPreviews,
    };
};

export const deriveWizardStepFromProject = (
    project: WizardProjectLike
): 1 | 2 | 3 | 4 => {
    if (project.isGenerated && project.generatedSchedules?.length) {
        return 4;
    }
    if (project.config?.blocks?.length) {
        return 3;
    }
    if (project.analysis?.length || project.parsedData?.length || project.approvedRuntimeModel || project.approvedRuntimeContract) {
        return 2;
    }
    return 1;
};

export const clampWizardStepToCurrentStep2Approval = (
    step: 1 | 2 | 3 | 4,
    approvalState: Step2ApprovalState
): 1 | 2 | 3 | 4 => (
    step > 2 && approvalState !== 'approved'
        ? 2
        : step
);

export const hasRestorableWizardProgress = (
    progress: WizardProgressLike | null
): boolean => {
    if (!progress) return false;

    // Step 1 CSV uploads cannot be resumed because File objects are not serializable.
    return progress.step > 1 || !!progress.performanceConfig?.routeId;
};

export const shouldShowNextStepAction = (
    step: number,
    importMode: ImportMode
): boolean => !(step === 4 || (step === 1 && importMode === 'gtfs'));
