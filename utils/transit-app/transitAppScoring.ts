import type { TransitAppConfidence, TransitAppTrend } from './transitAppTypes';

export interface WeightedScoreInput {
    viewToTapRankPct: number | null;
    viewToSuggestionRankPct: number | null;
    goTripsRankPct: number | null;
    totalLegsRankPct: number | null;
    suggestionToGoRankPct: number | null;
}

export interface TrendResult {
    trend: TransitAppTrend;
    delta: number | null;
}

export function safeRate(numerator: number, denominator: number, decimals = 4): number | null {
    if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) {
        return null;
    }
    const raw = numerator / denominator;
    const factor = Math.pow(10, decimals);
    return Math.round(raw * factor) / factor;
}

export function toMonthKey(date: string): string {
    return date.slice(0, 7);
}

export function isWeekendDate(date: string): boolean {
    const dt = new Date(`${date}T00:00:00`);
    if (Number.isNaN(dt.getTime())) return false;
    const day = dt.getUTCDay();
    return day === 0 || day === 6;
}

export function computePercentileRanks(values: Array<{ key: string; value: number | null }>): Map<string, number | null> {
    const result = new Map<string, number | null>();
    for (const item of values) {
        result.set(item.key, null);
    }

    const numeric = values
        .filter(v => typeof v.value === 'number' && Number.isFinite(v.value))
        .map(v => ({ key: v.key, value: v.value as number }))
        .sort((a, b) => a.value - b.value);

    const n = numeric.length;
    if (n === 0) return result;
    if (n === 1) {
        result.set(numeric[0].key, 100);
        return result;
    }

    let i = 0;
    while (i < n) {
        let j = i;
        while (j + 1 < n && numeric[j + 1].value === numeric[i].value) {
            j++;
        }
        const avgRank = (i + j) / 2;
        const pct = Math.round((avgRank / (n - 1)) * 10000) / 100;
        for (let k = i; k <= j; k++) {
            result.set(numeric[k].key, pct);
        }
        i = j + 1;
    }

    return result;
}

export function computeCompositeScore(input: WeightedScoreInput): number | null {
    if (
        input.viewToTapRankPct === null
        || input.viewToSuggestionRankPct === null
        || input.goTripsRankPct === null
        || input.totalLegsRankPct === null
        || input.suggestionToGoRankPct === null
    ) {
        return null;
    }

    const score = (0.30 * input.viewToTapRankPct)
        + (0.25 * input.viewToSuggestionRankPct)
        + (0.20 * input.goTripsRankPct)
        + (0.15 * input.totalLegsRankPct)
        + (0.10 * input.suggestionToGoRankPct);

    return Math.round(score * 100) / 100;
}

export function classifyTrend(current: number | null, previous: number | null, threshold = 5): TrendResult {
    if (current === null || previous === null) {
        return { trend: 'N/A', delta: null };
    }

    const delta = Math.round((current - previous) * 100) / 100;
    if (delta >= threshold) return { trend: 'Rising', delta };
    if (delta <= -threshold) return { trend: 'Declining', delta };
    return { trend: 'Stable', delta };
}

export function median(values: Array<number | null>): number | null {
    const numeric = values
        .filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
        .sort((a, b) => a - b);

    if (numeric.length === 0) return null;

    const mid = Math.floor(numeric.length / 2);
    if (numeric.length % 2 === 1) return numeric[mid];
    return Math.round(((numeric[mid - 1] + numeric[mid]) / 2) * 100) / 100;
}

export function deriveConfidence(totalViews: number, daysActive: number): TransitAppConfidence {
    if (totalViews >= 200 && daysActive >= 15) return 'High';
    if (totalViews >= 60 && daysActive >= 6) return 'Medium';
    return 'Low';
}
