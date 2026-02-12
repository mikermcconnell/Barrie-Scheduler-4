import React, { useState, useMemo } from 'react';
import {
    BarChart,
    Bar,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
} from 'recharts';
import type { TransitAppDataSummary, ODCoverageGap, ODPair } from '../../utils/transit-app/transitAppTypes';
import { TransitAppMap, type SeasonFilter, describeLocationRelativeToBarrie } from './TransitAppMap';
import { ChartCard, NoData, fmt } from './AnalyticsShared';
import { analyzeODCoverageGaps } from '../../utils/transit-app/transitAppAggregator';
import { findNearestStopName } from '../../utils/gtfs/gtfsStopLookup';
import { CoverageGapMap } from './CoverageGapMap';

interface DemandModuleProps {
    data: TransitAppDataSummary;
}

type TimeFilter = 'all' | 'am' | 'midday' | 'pm' | 'evening';

const TIME_FILTERS: { key: TimeFilter; label: string; hours: string }[] = [
    { key: 'all', label: 'All Day', hours: '0-23' },
    { key: 'am', label: 'AM Peak', hours: '6-9' },
    { key: 'midday', label: 'Midday', hours: '9-15' },
    { key: 'pm', label: 'PM Peak', hours: '15-19' },
    { key: 'evening', label: 'Evening/Night', hours: '19-6' },
];

const SEASON_FILTERS: { key: SeasonFilter; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'jan', label: 'Jan' },
    { key: 'jul', label: 'Jul' },
    { key: 'sep', label: 'Sep' },
];

export const DemandModule: React.FC<DemandModuleProps> = ({ data }) => {
    const [timeFilter, setTimeFilter] = useState<TimeFilter>('all');
    const [seasonFilter, setSeasonFilter] = useState<SeasonFilter>('all');
    const [displayedODPairs, setDisplayedODPairs] = useState<ODPair[]>([]);
    const [highlightedGapIdx, setHighlightedGapIdx] = useState<number | null>(null);
    const { tripDistribution, locationDensity, odPairs } = data;

    // Hourly distribution data — full 24h
    const hourlyData = tripDistribution.hourly.map(h => ({
        hour: `${h.hour.toString().padStart(2, '0')}:00`,
        count: h.count,
    }));

    // Filtered hourly data by time period
    const filteredHourlyData = useMemo(() => {
        if (timeFilter === 'all') return hourlyData;
        const ranges: Record<TimeFilter, [number, number]> = {
            all: [0, 24],
            am: [6, 9],
            midday: [9, 15],
            pm: [15, 19],
            evening: [19, 6],
        };
        const [start, end] = ranges[timeFilter];
        return hourlyData.filter((_, i) => {
            if (start < end) return i >= start && i < end;
            return i >= start || i < end;
        });
    }, [hourlyData, timeFilter]);

    // Check if season data is available
    const hasSeasonData = useMemo(() => {
        if (!odPairs) return false;
        return odPairs.pairs.some(p => p.seasonBins && (p.seasonBins.jan > 0 || p.seasonBins.jul > 0 || p.seasonBins.sep > 0));
    }, [odPairs]);

    // Top OD pairs ranked table — mirrors the current TransitAppMap ranking/filter state
    const topODPairs = useMemo(() => {
        if (!odPairs) return [];
        const sourcePairs = displayedODPairs.length > 0 ? displayedODPairs : odPairs.pairs;
        return sourcePairs
            .map((p, i) => {
                const zoneName = (lat: number, lon: number) =>
                    findNearestStopName(lat, lon, 0.5) ?? describeLocationRelativeToBarrie(lat, lon);
                return {
                    rank: i + 1,
                    origin: zoneName(p.originLat, p.originLon),
                    dest: zoneName(p.destLat, p.destLon),
                    count: p.count,
                    pct: odPairs.totalTripsProcessed > 0
                        ? ((p.count / odPairs.totalTripsProcessed) * 100).toFixed(2)
                        : '0',
                };
            })
            .filter(p => p.count > 0);
    }, [odPairs, displayedODPairs]);

    // Seasonal comparison — top 10 pairs with Jan/Jul/Sep side-by-side
    const seasonalComparison = useMemo(() => {
        if (!odPairs || !hasSeasonData) return [];
        return odPairs.pairs
            .slice(0, 10)
            .map((p, i) => {
                const zoneName = (lat: number, lon: number) =>
                    findNearestStopName(lat, lon, 0.5) ?? describeLocationRelativeToBarrie(lat, lon);
                return {
                    rank: i + 1,
                    origin: zoneName(p.originLat, p.originLon),
                    dest: zoneName(p.destLat, p.destLon),
                    total: p.count,
                    jan: p.seasonBins?.jan ?? 0,
                    jul: p.seasonBins?.jul ?? 0,
                    sep: p.seasonBins?.sep ?? 0,
                };
            });
    }, [odPairs, hasSeasonData]);

    // Coverage gap analysis
    const coverageGaps = useMemo((): ODCoverageGap[] => {
        if (!odPairs) return [];
        try {
            return analyzeODCoverageGaps(odPairs, 25);
        } catch {
            return [];
        }
    }, [odPairs]);

    const gapStats = useMemo(() => {
        if (coverageGaps.length === 0) return null;
        const gaps = coverageGaps.filter(g => !g.isServedByDirectRoute);
        const gapTrips = gaps.reduce((s, g) => s + g.pair.count, 0);
        const totalTrips = coverageGaps.reduce((s, g) => s + g.pair.count, 0);
        return {
            gapCount: gaps.length,
            totalAnalyzed: coverageGaps.length,
            gapTrips,
            gapPct: totalTrips > 0 ? ((gapTrips / totalTrips) * 100).toFixed(1) : '0',
        };
    }, [coverageGaps]);

    return (
        <div className="space-y-6">
            {/* Filter Bar — Time period + Season */}
            <div className="flex items-center flex-wrap gap-4">
                <div className="flex items-center gap-2">
                    <span className="text-sm text-gray-500 font-medium mr-2">Time period:</span>
                    <div className="flex rounded-lg border border-gray-200 overflow-hidden">
                        {TIME_FILTERS.map(({ key, label }) => (
                            <button
                                key={key}
                                onClick={() => setTimeFilter(key)}
                                className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                                    timeFilter === key
                                        ? 'bg-gray-900 text-white'
                                        : 'bg-white text-gray-500 hover:bg-gray-50'
                                }`}
                            >
                                {label}
                            </button>
                        ))}
                    </div>
                </div>

                {hasSeasonData && (
                    <div className="flex items-center gap-2">
                        <span className="text-sm text-gray-500 font-medium mr-2">Season:</span>
                        <div className="flex rounded-lg border border-gray-200 overflow-hidden">
                            {SEASON_FILTERS.map(({ key, label }) => (
                                <button
                                    key={key}
                                    onClick={() => setSeasonFilter(key)}
                                    className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                                        seasonFilter === key
                                            ? 'bg-cyan-500 text-white'
                                            : 'bg-white text-gray-500 hover:bg-gray-50'
                                    }`}
                                >
                                    {label}
                                </button>
                            ))}
                        </div>
                    </div>
                )}
            </div>

            {/* Hourly Trip Distribution */}
            <ChartCard
                title="Hourly Trip Distribution"
                subtitle={timeFilter === 'all' ? 'When riders plan trips (all day)' : `Filtered: ${TIME_FILTERS.find(f => f.key === timeFilter)?.label}`}
            >
                {filteredHourlyData.some(h => h.count > 0) ? (
                    <ResponsiveContainer width="100%" height={300}>
                        <BarChart data={filteredHourlyData} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                            <XAxis dataKey="hour" tick={{ fontSize: 10 }} interval={0} />
                            <YAxis tick={{ fontSize: 11 }} />
                            <Tooltip />
                            <Bar dataKey="count" fill="#10b981" name="Trips" radius={[4, 4, 0, 0]} />
                        </BarChart>
                    </ResponsiveContainer>
                ) : (
                    <NoData />
                )}
            </ChartCard>

            {/* OD Map — with season filter synced */}
            <ChartCard
                title="Origin-Destination Map"
                subtitle={`${fmt(locationDensity.totalPoints)} location points${odPairs ? `, ${fmt(odPairs.pairs.length)} OD pairs` : ''}`}
            >
                <TransitAppMap
                    locationDensity={locationDensity}
                    odPairs={odPairs}
                    height={520}
                    defaultLayer="od"
                    seasonFilter={seasonFilter}
                    onSeasonFilterChange={setSeasonFilter}
                    onDisplayedODPairsChange={setDisplayedODPairs}
                />
            </ChartCard>

            {/* Top OD Pairs Table */}
            {topODPairs.length > 0 && (
                <ChartCard
                    title="Top Origin-Destination Pairs"
                    subtitle={seasonFilter !== 'all'
                        ? `Highest volume zone-to-zone movements (${seasonFilter.toUpperCase()} only, synced to current map filters)`
                        : 'Highest volume zone-to-zone movements (synced to current map filters)'}
                >
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b border-gray-200">
                                    <th className="text-left py-2 px-3 text-gray-500 font-medium w-12">#</th>
                                    <th className="text-left py-2 px-3 text-gray-500 font-medium">Origin Zone</th>
                                    <th className="text-left py-2 px-3 text-gray-500 font-medium">Destination Zone</th>
                                    <th className="text-right py-2 px-3 text-gray-500 font-medium">Trips</th>
                                    <th className="text-right py-2 px-3 text-gray-500 font-medium">% Total</th>
                                </tr>
                            </thead>
                            <tbody>
                                {topODPairs.map(p => (
                                    <tr key={p.rank} className="border-b border-gray-50 hover:bg-gray-50">
                                        <td className="py-2 px-3 text-gray-400 font-medium">{p.rank}</td>
                                        <td className="py-2 px-3 text-xs">{p.origin}</td>
                                        <td className="py-2 px-3 text-xs">{p.dest}</td>
                                        <td className="py-2 px-3 text-right font-bold">{fmt(p.count)}</td>
                                        <td className="py-2 px-3 text-right text-gray-500">{p.pct}%</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </ChartCard>
            )}

            {/* Coverage Gap Analysis (above Seasonal for higher visibility) */}
            {coverageGaps.length > 0 && (
                <ChartCard
                    title="Coverage Gap Analysis"
                    subtitle={gapStats
                        ? `${gapStats.gapCount} of top ${gapStats.totalAnalyzed} OD pairs lack direct route service (${gapStats.gapPct}% of trip volume)`
                        : 'Analyzing route coverage for top OD pairs'}
                >
                    <CoverageGapMap
                        gaps={coverageGaps}
                        height={380}
                        highlightedIndex={highlightedGapIdx}
                        onGapHover={setHighlightedGapIdx}
                    />
                    <div className="overflow-x-auto mt-4">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b border-gray-200">
                                    <th className="text-left py-2 px-3 text-gray-500 font-medium w-12">#</th>
                                    <th className="text-left py-2 px-3 text-gray-500 font-medium">Origin Zone</th>
                                    <th className="text-left py-2 px-3 text-gray-500 font-medium">Dest Zone</th>
                                    <th className="text-right py-2 px-3 text-gray-500 font-medium">Trips</th>
                                    <th className="text-right py-2 px-3 text-gray-500 font-medium">Dist (km)</th>
                                    <th className="text-left py-2 px-3 text-gray-500 font-medium">Nearest Rte (O)</th>
                                    <th className="text-left py-2 px-3 text-gray-500 font-medium">Nearest Rte (D)</th>
                                    <th className="text-center py-2 px-3 text-gray-500 font-medium">Status</th>
                                </tr>
                            </thead>
                            <tbody>
                                {coverageGaps.map((gap, i) => {
                                    const isSevere = !gap.isServedByDirectRoute
                                        && gap.originRouteDistKm > 1
                                        && gap.destRouteDistKm > 1;
                                    const isHighlighted = highlightedGapIdx === i;
                                    return (
                                        <tr
                                            key={i}
                                            className={`border-b border-gray-50 cursor-pointer transition-colors ${
                                                isHighlighted
                                                    ? 'ring-1 ring-blue-200 bg-blue-50'
                                                    : !gap.isServedByDirectRoute
                                                        ? isSevere ? 'bg-red-50 hover:bg-red-100' : 'bg-amber-50 hover:bg-amber-100'
                                                        : 'hover:bg-gray-50'
                                            }`}
                                            onMouseEnter={() => setHighlightedGapIdx(i)}
                                            onMouseLeave={() => setHighlightedGapIdx(null)}
                                        >
                                            <td className="py-2 px-3 text-gray-400 font-medium">{i + 1}</td>
                                            <td className="py-2 px-3 text-xs">{gap.originZoneName}</td>
                                            <td className="py-2 px-3 text-xs">{gap.destZoneName}</td>
                                            <td className="py-2 px-3 text-right font-bold">{fmt(gap.pair.count)}</td>
                                            <td className="py-2 px-3 text-right text-gray-500">{gap.distanceKm.toFixed(1)}</td>
                                            <td className="py-2 px-3 text-xs text-gray-600">
                                                {gap.nearestRouteOrigin ?? '—'}
                                                {gap.originRouteDistKm > 1 && (
                                                    <span className="text-gray-400 ml-1">({gap.originRouteDistKm.toFixed(1)}km)</span>
                                                )}
                                            </td>
                                            <td className="py-2 px-3 text-xs text-gray-600">
                                                {gap.nearestRouteDest ?? '—'}
                                                {gap.destRouteDistKm > 1 && (
                                                    <span className="text-gray-400 ml-1">({gap.destRouteDistKm.toFixed(1)}km)</span>
                                                )}
                                            </td>
                                            <td className="py-2 px-3 text-center">
                                                {gap.isServedByDirectRoute ? (
                                                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-700">
                                                        Served ({gap.servingRoutes.join(', ')})
                                                    </span>
                                                ) : isSevere ? (
                                                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700">
                                                        Gap
                                                    </span>
                                                ) : (
                                                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700">
                                                        Partial
                                                    </span>
                                                )}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </ChartCard>
            )}

            {/* Seasonal Comparison Table */}
            {seasonalComparison.length > 0 && (
                <ChartCard
                    title="Seasonal OD Comparison"
                    subtitle="Top 10 OD pairs — trip counts by month for seasonal shift visibility"
                >
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b border-gray-200">
                                    <th className="text-left py-2 px-3 text-gray-500 font-medium w-12">#</th>
                                    <th className="text-left py-2 px-3 text-gray-500 font-medium">Origin</th>
                                    <th className="text-left py-2 px-3 text-gray-500 font-medium">Destination</th>
                                    <th className="text-right py-2 px-3 text-gray-500 font-medium">Total</th>
                                    <th className="text-right py-2 px-3 text-blue-500 font-medium">Jan</th>
                                    <th className="text-right py-2 px-3 text-amber-500 font-medium">Jul</th>
                                    <th className="text-right py-2 px-3 text-emerald-500 font-medium">Sep</th>
                                </tr>
                            </thead>
                            <tbody>
                                {seasonalComparison.map(p => {
                                    const maxSeason = Math.max(p.jan, p.jul, p.sep);
                                    return (
                                        <tr key={p.rank} className="border-b border-gray-50 hover:bg-gray-50">
                                            <td className="py-2 px-3 text-gray-400 font-medium">{p.rank}</td>
                                            <td className="py-2 px-3 text-xs">{p.origin}</td>
                                            <td className="py-2 px-3 text-xs">{p.dest}</td>
                                            <td className="py-2 px-3 text-right font-bold">{fmt(p.total)}</td>
                                            <td className={`py-2 px-3 text-right ${p.jan === maxSeason && maxSeason > 0 ? 'font-bold text-blue-600' : 'text-gray-500'}`}>
                                                {fmt(p.jan)}
                                            </td>
                                            <td className={`py-2 px-3 text-right ${p.jul === maxSeason && maxSeason > 0 ? 'font-bold text-amber-600' : 'text-gray-500'}`}>
                                                {fmt(p.jul)}
                                            </td>
                                            <td className={`py-2 px-3 text-right ${p.sep === maxSeason && maxSeason > 0 ? 'font-bold text-emerald-600' : 'text-gray-500'}`}>
                                                {fmt(p.sep)}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </ChartCard>
            )}
        </div>
    );
};
