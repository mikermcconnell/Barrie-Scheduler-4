import type { ODMatrixDataSummary } from './odMatrixTypes';

export type ODConfidenceStatus = 'pass' | 'warn' | 'fail';

export interface ODConfidenceRow {
    id: string;
    label: string;
    uploaded: string;
    displayed: string;
    status: ODConfidenceStatus;
    details?: string;
    points: number;
}

export interface ODConfidenceReport {
    score: number;
    level: 'high' | 'medium' | 'low';
    passCount: number;
    warnCount: number;
    failCount: number;
    rows: ODConfidenceRow[];
    generatedAt: string;
}

function formatNumber(value: number): string {
    return Number.isFinite(value) ? value.toLocaleString() : 'n/a';
}

function buildRow(
    id: string,
    label: string,
    uploaded: string,
    displayed: string,
    status: ODConfidenceStatus,
    points: number,
    details?: string,
): ODConfidenceRow {
    return { id, label, uploaded, displayed, status, points, details };
}

function scoreStatus(
    expected: number,
    actual: number,
    points: number,
    id: string,
    label: string,
): ODConfidenceRow {
    const status: ODConfidenceStatus = expected === actual ? 'pass' : 'fail';
    return buildRow(
        id,
        label,
        formatNumber(expected),
        formatNumber(actual),
        status,
        points,
        status === 'fail' ? `Mismatch of ${formatNumber(Math.abs(expected - actual))}` : undefined,
    );
}

function calculateLevel(score: number, warnCount: number, failCount: number): 'high' | 'medium' | 'low' {
    const baseLevel = score >= 90 ? 'high' : score >= 75 ? 'medium' : 'low';
    if (failCount > 0 && baseLevel === 'high') return 'medium';
    if (warnCount > 0 && baseLevel === 'high') return 'medium';
    return baseLevel;
}

export function computeODConfidenceReport(data: ODMatrixDataSummary): ODConfidenceReport {
    const journeySumFromPairs = data.pairs.reduce((sum, pair) => sum + pair.journeys, 0);
    const stationOriginSum = data.stations.reduce((sum, station) => sum + station.totalOrigin, 0);
    const stationDestinationSum = data.stations.reduce((sum, station) => sum + station.totalDestination, 0);
    const stationTotalVolumeSum = data.stations.reduce((sum, station) => sum + station.totalVolume, 0);
    const stationCountFromRows = data.stations.length;

    const sortedPairs = [...data.pairs].sort((a, b) => b.journeys - a.journeys);
    const topPairFromPairs = sortedPairs[0] ?? null;
    const topPairFromSummary = data.topPairs[0] ?? null;

    const invalidPairJourneys = data.pairs.filter(pair => !Number.isFinite(pair.journeys) || pair.journeys < 0 || !Number.isInteger(pair.journeys)).length;
    const invalidStationTotals = data.stations.filter(station => {
        return !Number.isFinite(station.totalOrigin)
            || !Number.isFinite(station.totalDestination)
            || !Number.isFinite(station.totalVolume)
            || station.totalOrigin < 0
            || station.totalDestination < 0
            || station.totalVolume < 0;
    }).length;

    const normalizedNames = data.stations.map(station => station.name.trim().toLowerCase());
    const duplicateStationCount = normalizedNames.length - new Set(normalizedNames).size;
    const geocodedCount = data.stations.filter(station => {
        if (!station.geocode) return false;
        return Number.isFinite(station.geocode.lat) && Number.isFinite(station.geocode.lon);
    }).length;
    const geocodeCoverage = data.stationCount > 0 ? geocodedCount / data.stationCount : 0;

    const rows: ODConfidenceRow[] = [
        scoreStatus(data.metadata.stationCount, stationCountFromRows, 15, 'station_count', 'Station Count'),
        scoreStatus(data.metadata.totalJourneys, journeySumFromPairs, 20, 'total_journeys', 'Total Journeys'),
        scoreStatus(journeySumFromPairs, stationOriginSum, 10, 'origin_balance', 'Pairs Sum vs Origin Trips'),
        scoreStatus(journeySumFromPairs, stationDestinationSum, 10, 'destination_balance', 'Pairs Sum vs Destination Trips'),
        scoreStatus(journeySumFromPairs * 2, stationTotalVolumeSum, 10, 'volume_balance', 'Total Volume Balance'),
    ];

    if (topPairFromPairs && topPairFromSummary) {
        const maxJourneys = topPairFromPairs.journeys;
        const topTiedPairs = sortedPairs.filter(pair => pair.journeys === maxJourneys);
        const topPairMatches = topPairFromSummary.journeys === maxJourneys
            && topTiedPairs.some(pair =>
                pair.origin === topPairFromSummary.origin
                && pair.destination === topPairFromSummary.destination
            );
        rows.push(buildRow(
            'top_pair',
            'Top Pair Alignment',
            `${topPairFromSummary.origin} -> ${topPairFromSummary.destination} (${formatNumber(topPairFromSummary.journeys)})`,
            topTiedPairs.length > 1
                ? `Tie at ${formatNumber(maxJourneys)} journeys (${formatNumber(topTiedPairs.length)} pairs)`
                : `${topPairFromPairs.origin} -> ${topPairFromPairs.destination} (${formatNumber(topPairFromPairs.journeys)})`,
            topPairMatches ? 'pass' : 'fail',
            10,
            topPairMatches ? undefined : 'Saved top pair is not in the recalculated highest-journey set',
        ));
    } else {
        rows.push(buildRow(
            'top_pair',
            'Top Pair Alignment',
            topPairFromSummary ? 'Present' : 'Missing',
            topPairFromPairs ? 'Present' : 'Missing',
            'warn',
            10,
            'Top-pair validation is partial because one source is missing',
        ));
    }

    const numericStatus: ODConfidenceStatus = (invalidPairJourneys === 0 && invalidStationTotals === 0) ? 'pass' : 'fail';
    rows.push(buildRow(
        'numeric_validity',
        'Numeric Validity',
        'No invalid or negative values',
        `${invalidPairJourneys} invalid pairs, ${invalidStationTotals} invalid stations`,
        numericStatus,
        10,
        numericStatus === 'fail' ? 'Invalid values detected in journeys or station totals' : undefined,
    ));

    rows.push(buildRow(
        'duplicate_stations',
        'Duplicate Station Names',
        '0 duplicates',
        formatNumber(duplicateStationCount),
        duplicateStationCount === 0 ? 'pass' : 'fail',
        5,
        duplicateStationCount > 0 ? 'Duplicate station names found after normalization' : undefined,
    ));

    rows.push(buildRow(
        'geocode_coverage',
        'Geocode Coverage',
        '100%',
        `${(geocodeCoverage * 100).toFixed(1)}% (${formatNumber(geocodedCount)}/${formatNumber(data.stationCount)})`,
        geocodeCoverage >= 1 ? 'pass' : geocodeCoverage >= 0.8 ? 'warn' : 'fail',
        10,
        geocodeCoverage < 1 ? 'Low coverage limits map confidence, not numeric totals' : undefined,
    ));

    let weighted = 0;
    for (const row of rows) {
        if (row.points <= 0) continue;
        if (row.status === 'pass') weighted += row.points;
        if (row.status === 'warn') weighted += row.points * 0.5;
    }

    const passCount = rows.filter(row => row.status === 'pass').length;
    const warnCount = rows.filter(row => row.status === 'warn').length;
    const failCount = rows.filter(row => row.status === 'fail').length;
    const score = Math.round(weighted);

    return {
        score,
        level: calculateLevel(score, warnCount, failCount),
        passCount,
        warnCount,
        failCount,
        rows,
        generatedAt: new Date().toISOString(),
    };
}
