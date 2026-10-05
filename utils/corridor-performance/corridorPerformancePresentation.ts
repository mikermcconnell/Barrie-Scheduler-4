import type {
    CorridorSpeedMetric,
    CorridorSpeedSegment,
    CorridorSpeedStats,
} from '../gtfs/corridorSpeed';

export interface CorridorPerformanceRankedRow {
    segment: CorridorSpeedSegment;
    stats: CorridorSpeedStats;
}

export interface CorridorPerformanceRankedRows {
    usable: CorridorPerformanceRankedRow[];
    lowConfidence: CorridorPerformanceRankedRow[];
}

function getRankingValue(stats: CorridorSpeedStats, metric: CorridorSpeedMetric): number | null {
    switch (metric) {
        case 'delay-percent':
            return stats.runtimeDeltaPct;
        case 'observed-speed':
            return stats.observedSpeedKmh === null ? null : -stats.observedSpeedKmh;
        case 'scheduled-speed':
            return stats.scheduledSpeedKmh === null ? null : -stats.scheduledSpeedKmh;
        case 'delay-minutes':
        default:
            return stats.runtimeDeltaMin;
    }
}

export function buildCorridorPerformanceRankedRows(
    segments: readonly CorridorSpeedSegment[],
    statsBySegment: ReadonlyMap<string, CorridorSpeedStats>,
    metric: CorridorSpeedMetric,
    usableLimit = 8,
    lowConfidenceLimit = 3,
): CorridorPerformanceRankedRows {
    const rows = segments
        .map(segment => ({ segment, stats: statsBySegment.get(segment.id) ?? null }))
        .filter((row): row is CorridorPerformanceRankedRow => (
            row.stats !== null
            && row.stats.observedRuntimeMin !== null
            && getRankingValue(row.stats, metric) !== null
        ))
        .sort((a, b) => (
            (getRankingValue(b.stats, metric) ?? Number.NEGATIVE_INFINITY)
            - (getRankingValue(a.stats, metric) ?? Number.NEGATIVE_INFINITY)
        ));

    return {
        usable: rows.filter(row => row.stats.confidenceLevel === 'usable').slice(0, usableLimit),
        lowConfidence: rows.filter(row => row.stats.confidenceLevel !== 'usable').slice(0, lowConfidenceLimit),
    };
}

export function getCorridorRankingTitle(metric: CorridorSpeedMetric): string {
    switch (metric) {
        case 'observed-speed':
            return 'Lowest observed operating speed';
        case 'scheduled-speed':
            return 'Lowest scheduled speed';
        case 'delay-percent':
        case 'delay-minutes':
        default:
            return 'Highest runtime pressure';
    }
}

export function formatCorridorEvidenceDays(distinctDayCount: number | undefined): string {
    return distinctDayCount === undefined ? 'days unknown' : `${distinctDayCount} days`;
}

export function getCorridorSpeedStyle(
    stats: CorridorSpeedStats | null,
    metric: CorridorSpeedMetric = 'delay-minutes',
): { color: string; weight: number; opacity: number } {
    if (!stats) return { color: '#d1d5db', weight: 2, opacity: 0.45 };
    if (stats.sampleCount === 0 || stats.observedRuntimeMin === null || stats.scheduledRuntimeMin === null) {
        return { color: '#cbd5e1', weight: 2, opacity: 0.45 };
    }
    if (stats.confidenceLevel === 'low' || stats.lowConfidence) {
        return { color: '#9ca3af', weight: 3, opacity: 0.72 };
    }

    const sampleWeight = Math.min(6, 2 + Math.floor(Math.min(stats.sampleCount, 24) / 6));
    if (metric === 'delay-percent') {
        const deltaPct = stats.runtimeDeltaPct ?? 0;
        if (deltaPct <= -10) return { color: '#16a34a', weight: sampleWeight, opacity: 0.88 };
        if (deltaPct <= 5) return { color: '#3b82f6', weight: sampleWeight, opacity: 0.84 };
        if (deltaPct <= 20) return { color: '#f59e0b', weight: sampleWeight, opacity: 0.88 };
        return { color: '#dc2626', weight: sampleWeight + 1, opacity: 0.92 };
    }

    if (metric === 'observed-speed' || metric === 'scheduled-speed') {
        const speed = metric === 'observed-speed' ? stats.observedSpeedKmh : stats.scheduledSpeedKmh;
        if (speed === null) return { color: '#cbd5e1', weight: 2, opacity: 0.45 };
        if (speed < 16) return { color: '#dc2626', weight: sampleWeight + 1, opacity: 0.92 };
        if (speed < 22) return { color: '#f59e0b', weight: sampleWeight, opacity: 0.88 };
        if (speed < 28) return { color: '#3b82f6', weight: sampleWeight, opacity: 0.84 };
        return { color: '#16a34a', weight: sampleWeight, opacity: 0.88 };
    }

    const delta = stats.runtimeDeltaMin ?? 0;
    if (delta <= -1.5) return { color: '#16a34a', weight: sampleWeight, opacity: 0.88 };
    if (delta <= 1) return { color: '#3b82f6', weight: sampleWeight, opacity: 0.84 };
    if (delta <= 3) return { color: '#f59e0b', weight: sampleWeight, opacity: 0.88 };
    return { color: '#dc2626', weight: sampleWeight + 1, opacity: 0.92 };
}

export function getMetricDisplayValue(stats: CorridorSpeedStats | null, metric: CorridorSpeedMetric): string {
    if (!stats) return 'No data';

    switch (metric) {
        case 'delay-minutes':
            return stats.runtimeDeltaMin === null
                ? 'No observed data'
                : `${stats.runtimeDeltaMin > 0 ? '+' : ''}${stats.runtimeDeltaMin.toFixed(1)} min`;
        case 'delay-percent':
            return stats.runtimeDeltaPct === null
                ? 'No observed data'
                : `${stats.runtimeDeltaPct > 0 ? '+' : ''}${stats.runtimeDeltaPct.toFixed(1)}%`;
        case 'observed-speed':
            return stats.observedSpeedKmh === null ? 'No observed data' : `${stats.observedSpeedKmh.toFixed(1)} km/h`;
        case 'scheduled-speed':
            return stats.scheduledSpeedKmh === null ? 'No scheduled data' : `${stats.scheduledSpeedKmh.toFixed(1)} km/h`;
        default:
            return 'No data';
    }
}
