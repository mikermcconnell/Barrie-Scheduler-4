import type {
    TransferConnectionTargetCandidate,
    TransferPairSummary,
    TransferPattern,
    TransferPriorityTier,
    TransferTimeBand,
} from './transitAppTypes';

export type TransferMapTimeBandFilter = 'all' | TransferTimeBand;
export type TransferMapLimit = number | 'all';

export interface GroupedTransferPattern {
    routePair: string;
    totalCount: number;
    avgWait: number;
    patterns: TransferPattern[];
}

export function getTransferPairDisplayCount(
    pair: TransferPairSummary,
    timeBandFilter: TransferMapTimeBandFilter
): number {
    if (timeBandFilter === 'all') return pair.totalCount;

    const exactBandCount = pair.timeBandCounts?.[timeBandFilter];
    if (typeof exactBandCount === 'number') return exactBandCount;

    // Backward-compatible fallback for saved imports created before exact band counts existed.
    return pair.dominantTimeBands.includes(timeBandFilter) ? pair.totalCount : 0;
}

export function rankTransferPairsForMap(
    pairs: TransferPairSummary[],
    timeBandFilter: TransferMapTimeBandFilter,
    limit: TransferMapLimit
): TransferPairSummary[] {
    const rankedPairs = pairs
        .filter(pair => getTransferPairDisplayCount(pair, timeBandFilter) > 0)
        .sort((a, b) => {
            const countDiff = getTransferPairDisplayCount(b, timeBandFilter)
                - getTransferPairDisplayCount(a, timeBandFilter);
            if (countDiff !== 0) return countDiff;
            return b.totalCount - a.totalCount;
        });

    return limit === 'all' ? rankedPairs : rankedPairs.slice(0, limit);
}

export function rankConnectionTargetPriority(
    target: Pick<TransferConnectionTargetCandidate, 'goLinked'>,
    scopedIndex: number
): TransferPriorityTier {
    if (target.goLinked) return 'high';
    if (scopedIndex < 5) return 'high';
    if (scopedIndex < 15) return 'medium';
    return 'low';
}

export function rankConnectionTargetsForScope(
    targets: TransferConnectionTargetCandidate[]
): TransferConnectionTargetCandidate[] {
    return [...targets]
        .sort((a, b) => b.totalTransfers - a.totalTransfers)
        .map((target, index) => ({
            ...target,
            priorityTier: rankConnectionTargetPriority(target, index),
        }));
}

export function groupTransferPatternsByRoute(patterns: TransferPattern[]): GroupedTransferPattern[] {
    const groups = new Map<string, TransferPattern[]>();
    for (const pattern of patterns) {
        const key = `${pattern.fromRoute} → ${pattern.toRoute}`;
        const existing = groups.get(key);
        if (existing) {
            existing.push(pattern);
        } else {
            groups.set(key, [pattern]);
        }
    }

    return Array.from(groups.entries())
        .map(([routePair, groupedPatterns]) => {
            const totalCount = groupedPatterns.reduce((sum, pattern) => sum + pattern.count, 0);
            const totalWait = groupedPatterns.reduce(
                (sum, pattern) => sum + (pattern.totalWaitMinutes ?? pattern.avgWaitMinutes * pattern.count),
                0
            );

            return {
                routePair,
                totalCount,
                avgWait: totalWait / Math.max(1, totalCount),
                patterns: groupedPatterns,
            };
        })
        .sort((a, b) => b.totalCount - a.totalCount);
}
