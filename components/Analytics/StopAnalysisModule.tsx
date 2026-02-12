import React, { useMemo } from 'react';
import { MapPin, AlertCircle, Layers, Ruler } from 'lucide-react';
import type { TransitAppDataSummary } from '../../utils/transit-app/transitAppTypes';
import { TransitAppMap } from './TransitAppMap';
import { ChartCard, MetricCard, NoData, fmt, formatTimeBand, formatDayType } from './AnalyticsShared';

interface StopAnalysisModuleProps {
    data: TransitAppDataSummary;
}

export const StopAnalysisModule: React.FC<StopAnalysisModuleProps> = ({ data }) => {
    const { stopProximityAnalysis, locationDensity, odPairs } = data;

    const topCoverageGaps = useMemo(() => (
        (stopProximityAnalysis?.topClusters ?? [])
            .slice(0, 25)
            .sort((a, b) => b.tripCount - a.tripCount)
    ), [stopProximityAnalysis]);

    if (!stopProximityAnalysis) {
        return (
            <ChartCard title="Stop-Level Proximity Analysis" subtitle="No proximity analysis available.">
                <NoData />
            </ChartCard>
        );
    }

    return (
        <div className="space-y-6">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <MetricCard
                    icon={<MapPin size={20} />}
                    label="Endpoints Analyzed"
                    value={fmt(stopProximityAnalysis.totals.tripEndpointsAnalyzed)}
                    color="cyan"
                />
                <MetricCard
                    icon={<AlertCircle size={20} />}
                    label={`Far Endpoints (> ${Math.round(stopProximityAnalysis.farThresholdKm * 1000)}m)`}
                    value={fmt(stopProximityAnalysis.totals.farEndpointCount)}
                    color="amber"
                    subValue={`${stopProximityAnalysis.totals.farEndpointSharePct}% of endpoints`}
                />
                <MetricCard
                    icon={<Layers size={20} />}
                    label="Coverage Gap Clusters"
                    value={fmt(stopProximityAnalysis.totals.clusterCount)}
                    color="indigo"
                />
                <MetricCard
                    icon={<Ruler size={20} />}
                    label="Avg Nearest Stop Dist"
                    value={`${stopProximityAnalysis.totals.avgNearestStopDistanceKm.toFixed(2)} km`}
                    color="emerald"
                />
            </div>

            <ChartCard
                title="Coverage Gap Map"
                subtitle="Clusters farther than 400m from nearest stop with dominant time/day annotations"
            >
                <TransitAppMap
                    locationDensity={locationDensity}
                    odPairs={odPairs}
                    coverageGapClusters={topCoverageGaps}
                    height={620}
                />
            </ChartCard>

            <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                <ChartCard title="Far-From-Stops Clusters" subtitle="Ranked by trip count">
                    {(stopProximityAnalysis.topClusters ?? []).length > 0 ? (
                        <div className="overflow-x-auto max-h-[400px] overflow-y-auto">
                            <table className="w-full text-sm">
                                <thead className="sticky top-0 bg-white z-10">
                                    <tr className="border-b border-gray-200">
                                        <th className="text-left py-2 px-2 text-gray-500 font-medium">Cluster</th>
                                        <th className="text-right py-2 px-2 text-gray-500 font-medium">Trips</th>
                                        <th className="text-right py-2 px-2 text-gray-500 font-medium">Avg Dist</th>
                                        <th className="text-left py-2 px-2 text-gray-500 font-medium">Peak Period</th>
                                        <th className="text-right py-2 px-2 text-gray-500 font-medium">OD Overlap</th>
                                    </tr>
                                </thead>
                                <tbody className="tabular-nums">
                                    {(stopProximityAnalysis.topClusters ?? []).slice(0, 40).map(cluster => (
                                        <tr key={cluster.clusterId} className="border-b border-gray-50 hover:bg-gray-50">
                                            <td className="py-2 px-2">
                                                <div className="font-medium text-gray-800">{cluster.nearestStopName || 'Unknown Stop'}</div>
                                                <div className="text-[11px] text-gray-400">{cluster.lat.toFixed(4)}, {cluster.lon.toFixed(4)}</div>
                                            </td>
                                            <td className="py-2 px-2 text-right font-semibold">{fmt(cluster.tripCount)}</td>
                                            <td className="py-2 px-2 text-right">{cluster.avgNearestStopDistanceKm.toFixed(2)} km</td>
                                            <td className="py-2 px-2">
                                                {formatDayType(cluster.dominantDayType)} • {formatTimeBand(cluster.dominantTimeBand)}
                                            </td>
                                            <td className="py-2 px-2 text-right">{fmt(cluster.odOverlapCount)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    ) : <NoData message="No far-from-stop clusters detected." />}
                </ChartCard>

                <ChartCard title="Stop Mention Ranking" subtitle="Itinerary mention frequency (not boardings)">
                    {(stopProximityAnalysis.stopMentions ?? []).length > 0 ? (
                        <div className="overflow-x-auto max-h-[400px] overflow-y-auto">
                            <table className="w-full text-sm">
                                <thead className="sticky top-0 bg-white z-10">
                                    <tr className="border-b border-gray-200">
                                        <th className="text-left py-2 px-2 text-gray-500 font-medium">Stop Name</th>
                                        <th className="text-right py-2 px-2 text-gray-500 font-medium">Mentions</th>
                                    </tr>
                                </thead>
                                <tbody className="tabular-nums">
                                    {(stopProximityAnalysis.stopMentions ?? []).slice(0, 50).map(row => (
                                        <tr key={row.stopName} className="border-b border-gray-50 hover:bg-gray-50">
                                            <td className="py-2 px-2">{row.stopName}</td>
                                            <td className="py-2 px-2 text-right font-semibold">{fmt(row.mentions)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    ) : <NoData message="No stop mentions found in itinerary data." />}
                </ChartCard>
            </div>

            <ChartCard title="Interpretation Caveat" subtitle="How to use this analysis">
                <p className="text-sm text-gray-600 leading-relaxed">
                    These clusters represent trip-planning demand points far from existing stops and should be treated as coverage signals.
                    Stop mention rankings reflect itinerary references, not APC boarding counts.
                    Use this module to identify candidate areas for coverage review, then validate with operational and ridership data before service changes.
                </p>
            </ChartCard>
        </div>
    );
};
