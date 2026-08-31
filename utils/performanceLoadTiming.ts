import type {
    PerformanceDataLoadOptions,
    PerformanceDetailMode,
    PerformanceMetadata,
} from './performanceDataTypes';

const PERFORMANCE_LOAD_TIMING_STORAGE_KEY = 'scheduler4:performance-load-timings:v1';
const MAX_SAMPLES_PER_PROFILE = 5;

type PerformanceLoadTimingHistory = Record<string, number[]>;

function readTimingHistory(): PerformanceLoadTimingHistory {
    if (typeof window === 'undefined') return {};

    try {
        const raw = window.localStorage.getItem(PERFORMANCE_LOAD_TIMING_STORAGE_KEY);
        if (!raw) return {};
        const parsed = JSON.parse(raw) as unknown;
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};

        return Object.fromEntries(
            Object.entries(parsed).flatMap(([key, value]) => {
                if (!Array.isArray(value)) return [];
                const samples = value
                    .map(Number)
                    .filter(sample => Number.isFinite(sample) && sample > 0)
                    .slice(-MAX_SAMPLES_PER_PROFILE);
                return samples.length > 0 ? [[key, samples]] : [];
            }),
        );
    } catch {
        return {};
    }
}

export function getPerformanceLoadEstimateMs(profileKey: string): number | null {
    const samples = readTimingHistory()[profileKey];
    if (!samples?.length) return null;
    const sorted = [...samples].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0
        ? (sorted[middle - 1] + sorted[middle]) / 2
        : sorted[middle];
}

export function recordPerformanceLoadDuration(profileKey: string, durationMs: number): void {
    if (typeof window === 'undefined' || !Number.isFinite(durationMs) || durationMs <= 0) return;

    try {
        const history = readTimingHistory();
        history[profileKey] = [
            ...(history[profileKey] || []),
            Math.round(durationMs),
        ].slice(-MAX_SAMPLES_PER_PROFILE);
        window.localStorage.setItem(PERFORMANCE_LOAD_TIMING_STORAGE_KEY, JSON.stringify(history));
    } catch {
        // Timing history is optional. Loading must still work when storage is blocked.
    }
}

function monthOverlapsRange(month: string, range?: { start: string; end: string }): boolean {
    if (!range?.start || !range.end) return true;
    return month >= range.start.slice(0, 7) && month <= range.end.slice(0, 7);
}

export function getExpectedPerformanceLoadUnits(
    teamId: string | undefined,
    metadata: PerformanceMetadata | null | undefined,
    routeId?: string | null,
    requestingTeamId?: string,
    options?: PerformanceDataLoadOptions,
): number {
    if (!teamId || !metadata) return 1;
    const usesSharedRequest = !!requestingTeamId && (
        requestingTeamId !== teamId
        || options?.detailMode === 'load-profiles'
    );
    if (usesSharedRequest) return 1;

    const routePaths = routeId && routeId !== 'all'
        ? metadata.routeMonthlyStoragePaths?.[routeId]
        : undefined;
    const paths = routePaths || metadata.monthlyStoragePaths;
    if (!paths) return 1;

    const matchingMonths = Object.keys(paths)
        .filter(month => monthOverlapsRange(month, options?.dateRange));
    return Math.max(1, matchingMonths.length);
}

function getUnitBucket(unitCount: number): '1' | '2-4' | '5+' {
    if (unitCount <= 1) return '1';
    if (unitCount <= 4) return '2-4';
    return '5+';
}

export function buildPerformanceLoadProfileKey({
    kind,
    unitCount = 1,
    routeScoped = false,
    detailMode = 'overview',
    shared = false,
}: {
    kind: 'metadata' | 'overview' | 'detail';
    unitCount?: number;
    routeScoped?: boolean;
    detailMode?: PerformanceDetailMode;
    shared?: boolean;
}): string {
    if (kind !== 'detail') return `operations:${kind}`;
    return [
        'operations:detail',
        shared ? 'shared' : 'storage',
        routeScoped ? 'route' : 'all-routes',
        detailMode,
        getUnitBucket(unitCount),
    ].join(':');
}

export const PERFORMANCE_METADATA_LOAD_PROFILE = buildPerformanceLoadProfileKey({ kind: 'metadata' });
export const PERFORMANCE_OVERVIEW_LOAD_PROFILE = buildPerformanceLoadProfileKey({ kind: 'overview' });
