import type { MasterRouteTable } from '../../../utils/parsers/masterScheduleParser';
import type { ScheduleConfig } from '../steps/Step3Build';
import type { ImportMode, PerformanceConfig } from '../steps/Step1Upload';
import type { RuntimeData, SegmentRawData } from './csvParser';
import type { TripBucketAnalysis } from '../../../utils/ai/runtimeAnalysis';
import { getRouteConfig, getRouteVariant, parseRouteInfo } from '../../../utils/config/routeDirectionConfig';
import {
    buildNormalizedSegmentNameLookup,
    normalizeSegmentNameForMatching,
    normalizeSegmentStopKey,
    resolveCanonicalSegmentName,
} from '../../../utils/runtimeSegmentMatching';

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

    if (direction === 'North' || direction === 'South') {
        if (routeConfig.suffixIsDirection) {
            return getRouteVariant(parsedRoute.baseRoute, direction);
        }

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

export const deriveWizardStepFromProject = (
    project: WizardProjectLike
): 1 | 2 | 3 | 4 => {
    if (project.isGenerated && project.generatedSchedules?.length) {
        return 4;
    }
    if (project.config?.blocks?.length) {
        return 3;
    }
    if (project.analysis?.length || project.parsedData?.length) {
        return 2;
    }
    return 1;
};

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
