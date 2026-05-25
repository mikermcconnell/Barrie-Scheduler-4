import React, { Suspense, useEffect, useState, useMemo } from 'react';
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
import type { TransitAppODSeasonFilter as SeasonFilter } from '../../utils/transit-app/transitAppOdPairs';
import { describeLocationRelativeToBarrie } from '../../utils/transit-app/transitAppGeo';
import { ChartCard, NoData, fmt } from './AnalyticsShared';
import { findNearestStopName } from '../../utils/gtfs/gtfsStopLookup';

const TransitAppMap = React.lazy(() =>
    import('./TransitAppMap').then(module => ({ default: module.TransitAppMap }))
);
const CoverageGapMap = React.lazy(() =>
    import('./CoverageGapMap').then(module => ({ default: module.CoverageGapMap }))
);

interface DemandModuleProps {
    data: TransitAppDataSummary;
}

export const DemandModule: React.FC<DemandModuleProps> = ({ data }) => {
    const [seasonFilter, setSeasonFilter] = useState<SeasonFilter>('all');
    const [displayedODPairs, setDisplayedODPairs] = useState<ODPair[] | null>(null);
    const [highlightedGapIdx, setHighlightedGapIdx] = useState<number | null>(null);
    const [coverageGaps, setCoverageGaps] = useState<ODCoverageGap[]>([]);
    const { tripDistribution, locationDensity, odPairs } = data;

    useEffect(() => {
        setDisplayedODPairs(null);
    }, [odPairs]);

    useEffect(() => {
        setCoverageGaps([]);
        if (!odPairs) return undefined;

        let cancelled = false;
        const timer = window.setTimeout(() => {
            void import('../../utils/transit-app/transitAppAggregator')
                .then(({ analyzeODCoverageGaps }) => {
                    if (cancelled) return;
                    try {
                        setCoverageGaps(analyzeODCoverageGaps(odPairs, 25));
                    } catch {
                        setCoverageGaps([]);
                    }
                })
                .catch(() => {
                    if (!cancelled) setCoverageGaps([]);
                });
        }, 500);

        return () => {
            cancelled = true;
            window.clearTimeout(timer);
        };
    }, [odPairs]);

    // Hourly distribution data — full 24h
    const hourlyData = tripDistribution.hourly.map(h => ({
        hour: `${h.hour.toString().padStart(2, '0')}:00`,
        count: h.count,
    }));

    // Check if season data is available
    const hasSeasonData = useMemo(() => {
        if (!odPairs) return false;
        return odPairs.pairs.some(p => p.seasonBins && (p.seasonBins.jan > 0 || p.seasonBins.jul > 0 || p.seasonBins.sep > 0 || p.seasonBins.other > 0));
    }, [odPairs]);
    const hasOtherSeasonData = useMemo(() => {
        if (!odPairs) return false;
        return odPairs.pairs.some(p => (p.seasonBins?.other || 0) > 0);
    }, [odPairs]);

    // Top OD pairs ranked table — mirrors the current TransitAppMap ranking/filter state
    const topODPairs = useMemo(() => {
        if (!odPairs) return [];
        const sourcePairs = displayedODPairs ?? odPairs.pairs.slice(0, 20);
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
                    other: p.seasonBins?.other ?? 0,
                };
            });
    }, [odPairs, hasSeasonData]);

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
            {/* OD Map — with season filter synced */}
            <ChartCard
                title="Origin-Destination Map"
                subtitle={`${fmt(locationDensity.totalPoints)} location points${odPairs ? `, ${fmt(odPairs.pairs.length)} OD pairs` : ''}`}
            >
                <Suspense fallback={<MapLoadingState height={520} label="Preparing OD map..." />}>
                    <TransitAppMap
                        locationDensity={locationDensity}
                        odPairs={odPairs}
                        height={520}
                        defaultLayer="od"
                        seasonFilter={seasonFilter}
                        onSeasonFilterChange={setSeasonFilter}
                        onDisplayedODPairsChange={setDisplayedODPairs}
                    />
                </Suspense>
            </ChartCard>

            {/* Hourly Trip Distribution */}
            <ChartCard
                title="Hourly Trip Distribution"
                subtitle="When riders plan trips (all day)"
            >
                {hourlyData.some(h => h.count > 0) ? (
                    <ResponsiveContainer width="100%" height={300}>
                        <BarChart data={hourlyData} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
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
                        ? `${gapStats.gapCount} of top ${gapStats.totalAnalyzed} Barrie-only OD pairs lack direct route service (${gapStats.gapPct}% of trip volume)`
                        : 'Analyzing route coverage for top Barrie-only OD pairs'}
                >
                    <Suspense fallback={<MapLoadingState height={380} label="Preparing coverage map..." />}>
                        <CoverageGapMap
                            gaps={coverageGaps}
                            height={380}
                            highlightedIndex={highlightedGapIdx}
                            onGapHover={setHighlightedGapIdx}
                        />
                    </Suspense>
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
                                    const isSevere = gap.coverageStatus === 'gap';
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
                                                ) : gap.coverageStatus === 'gap' ? (
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
                    subtitle="Overall top 10 OD pairs — trip counts by season for shift visibility"
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
                                    {hasOtherSeasonData && (
                                        <th className="text-right py-2 px-3 text-gray-500 font-medium">Other</th>
                                    )}
                                </tr>
                            </thead>
                            <tbody>
                                {seasonalComparison.map(p => {
                                    const maxSeason = Math.max(p.jan, p.jul, p.sep, hasOtherSeasonData ? p.other : 0);
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
                                            {hasOtherSeasonData && (
                                                <td className={`py-2 px-3 text-right ${p.other === maxSeason && maxSeason > 0 ? 'font-bold text-gray-700' : 'text-gray-500'}`}>
                                                    {fmt(p.other)}
                                                </td>
                                            )}
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

const MapLoadingState: React.FC<{ height: number; label: string }> = ({ height, label }) => (
    <div
        className="relative overflow-hidden rounded-lg border border-gray-200 bg-gray-50"
        style={{ height }}
        role="status"
        aria-live="polite"
    >
        <div className="absolute inset-0 bg-gradient-to-br from-white via-gray-50 to-gray-100" />
        <div className="absolute inset-x-6 top-6 h-8 rounded-lg bg-white/80 shadow-sm" />
        <div className="absolute left-6 top-24 h-32 w-48 rounded-xl bg-white/70 shadow-sm" />
        <div className="absolute bottom-8 right-8 h-28 w-40 rounded-xl bg-white/70 shadow-sm" />
        <div className="absolute inset-0 grid place-items-center">
            <div className="rounded-xl border border-gray-200 bg-white/95 px-5 py-4 text-center shadow-sm">
                <div className="mx-auto mb-3 h-6 w-6 animate-spin rounded-full border-2 border-gray-200 border-t-cyan-500" />
                <div className="text-sm font-semibold text-gray-800">{label}</div>
                <div className="mt-1 text-xs text-gray-500">Loading map layers and OD lines</div>
            </div>
        </div>
    </div>
);
