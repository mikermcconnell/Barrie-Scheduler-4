import React, { useMemo, useState } from 'react';
import {
    BarChart,
    Bar,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
} from 'recharts';
import { ArrowUpDown } from 'lucide-react';
import type { RoutePerformanceScorecardRow, TransitAppDataSummary } from '../../utils/transit-app/transitAppTypes';
import { ChartCard, NoData, fmt } from './AnalyticsShared';

interface RoutePerformanceModuleProps {
    data: TransitAppDataSummary;
}

type SortKey =
    | 'route'
    | 'compositeScore'
    | 'avgDailyViews'
    | 'viewToTapRate'
    | 'viewToSuggestionRate'
    | 'suggestionToGoRate'
    | 'trend'
    | 'confidence';

export const RoutePerformanceModule: React.FC<RoutePerformanceModuleProps> = ({ data }) => {
    const [sortKey, setSortKey] = useState<SortKey>('compositeScore');
    const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');

    const fallbackScorecard = useMemo(() => {
        const legMap = new Map(data.routeLegs.map(l => [l.route.toUpperCase(), l]));
        return data.routeMetrics.summary.map(r => {
            const route = r.route.toUpperCase();
            const legs = legMap.get(route);
            const viewToTapRate = r.totalViews > 0 ? r.totalTaps / r.totalViews : null;
            const viewToSuggestionRate = r.totalViews > 0 ? r.totalSuggestions / r.totalViews : null;
            const tapToSuggestionRate = r.totalTaps > 0 ? r.totalSuggestions / r.totalTaps : null;
            const suggestionToGoRate = r.totalSuggestions > 0 ? r.totalGoTrips / r.totalSuggestions : null;
            return {
                route,
                latestMonth: 'N/A',
                avgDailyViews: r.avgDailyViews,
                avgDailyTaps: r.avgDailyTaps,
                totalViews: r.totalViews,
                totalTaps: r.totalTaps,
                totalSuggestions: r.totalSuggestions,
                totalGoTrips: r.totalGoTrips,
                totalLegs: legs?.totalLegs || 0,
                uniqueTrips: legs?.uniqueTrips || 0,
                viewToTapRate,
                viewToSuggestionRate,
                tapToSuggestionRate,
                suggestionToGoRate,
                compositeScore: null,
                trend: 'N/A',
                trendDelta: null,
                weekdayScore: null,
                weekendScore: null,
                viewsPerScheduledTrip: null,
                tapsPerScheduledTrip: null,
                normalizationAvailable: false,
                belowMedian: false,
                isWatchRoute: false,
                isMonitorRoute: false,
                confidence: 'Low',
                diagnosisCode: 'low_data_confidence',
                diagnosisLabel: 'Legacy import: scoring unavailable',
                recommendedAction: 'manual_planner_review',
                recommendedActionLabel: 'Re-import to generate planner scoring',
                effortBand: 'Low',
                impactBand: 'Low',
            } as RoutePerformanceScorecardRow;
        });
    }, [data.routeLegs, data.routeMetrics.summary]);

    const scorecard = (data.routePerformance?.scorecard && data.routePerformance.scorecard.length > 0)
        ? data.routePerformance.scorecard
        : fallbackScorecard;

    const watchlist = data.routePerformance?.watchlist || [];
    const months = data.routePerformance?.months || [];

    const sortedScorecard = useMemo(() => {
        const rows = [...scorecard];
        rows.sort((a, b) => {
            const mult = sortDirection === 'asc' ? 1 : -1;
            if (sortKey === 'route') return mult * a.route.localeCompare(b.route, undefined, { numeric: true });
            if (sortKey === 'trend') return mult * a.trend.localeCompare(b.trend);
            if (sortKey === 'confidence') return mult * a.confidence.localeCompare(b.confidence);

            const aVal = numericSortValue(a, sortKey);
            const bVal = numericSortValue(b, sortKey);
            if (aVal === null && bVal === null) return a.route.localeCompare(b.route, undefined, { numeric: true });
            if (aVal === null) return 1;
            if (bVal === null) return -1;
            return mult * (aVal - bVal);
        });
        return rows;
    }, [scorecard, sortDirection, sortKey]);

    const selectedRouteValue = sortedScorecard[0]?.route || '';

    const selectedScore = sortedScorecard.find(s => s.route === selectedRouteValue) || null;
    const funnelData = selectedScore
        ? [
            { stage: 'Views', count: selectedScore.totalViews },
            { stage: 'Taps', count: selectedScore.totalTaps },
            { stage: 'Suggestions', count: selectedScore.totalSuggestions },
            { stage: 'GO Trips', count: selectedScore.totalGoTrips },
        ]
        : [];

    const toggleSort = (nextSortKey: SortKey) => {
        if (sortKey === nextSortKey) {
            setSortDirection(prev => (prev === 'asc' ? 'desc' : 'asc'));
        } else {
            setSortKey(nextSortKey);
            setSortDirection(nextSortKey === 'compositeScore' ? 'asc' : 'desc');
        }
    };

    return (
        <div className="space-y-6">
            <ChartCard
                title="Routes to Watch"
                subtitle={
                    data.routePerformance
                        ? `Latest month: ${data.routePerformance.latestMonth || 'N/A'} • Median score: ${data.routePerformance.latestMedianScore ?? 'N/A'}`
                        : 'Re-import data to enable route-performance scoring and watchlist flags.'
                }
            >
                {watchlist.length > 0 ? (
                    <div className="overflow-x-auto max-h-[400px] overflow-y-auto">
                        <table className="w-full text-sm">
                            <thead className="sticky top-0 bg-white z-10">
                                <tr className="border-b border-gray-200">
                                    <th className="text-left py-2 px-3 text-gray-500 font-medium">Route</th>
                                    <th className="text-right py-2 px-3 text-gray-500 font-medium">Score</th>
                                    <th className="text-left py-2 px-3 text-gray-500 font-medium">Trend</th>
                                    <th className="text-left py-2 px-3 text-gray-500 font-medium">Confidence</th>
                                    <th className="text-left py-2 px-3 text-gray-500 font-medium">Diagnosis</th>
                                    <th className="text-left py-2 px-3 text-gray-500 font-medium">Action</th>
                                    <th className="text-right py-2 px-3 text-gray-500 font-medium">Priority</th>
                                </tr>
                            </thead>
                            <tbody className="tabular-nums">
                                {watchlist.slice(0, 15).map(row => (
                                    <tr key={row.route} className="border-b border-gray-50 hover:bg-gray-50">
                                        <td className="py-2 px-3 font-bold">{row.route}</td>
                                        <td className="py-2 px-3 text-right">{row.compositeScore?.toFixed(1) || 'N/A'}</td>
                                        <td className="py-2 px-3">{trendBadge(row.trend)}</td>
                                        <td className="py-2 px-3">{row.confidence}</td>
                                        <td className="py-2 px-3 text-gray-600">{row.diagnosisCode.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}</td>
                                        <td className="py-2 px-3 text-gray-600">{row.recommendedAction.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}</td>
                                        <td className="py-2 px-3 text-right font-semibold">{row.priorityScore.toFixed(1)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                ) : (
                    <NoData message={data.routePerformance ? 'No routes are currently flagged for review.' : 'Re-import data to enable watchlist scoring.'} />
                )}
            </ChartCard>

            <ChartCard title="Route Conversion Funnel" subtitle={`Views → Taps → Suggestions → GO Trips for route ${selectedRouteValue || 'N/A'}`}>
                {funnelData.length > 0 ? (
                    <ResponsiveContainer width="100%" height={300}>
                        <BarChart data={funnelData}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                            <XAxis dataKey="stage" tick={{ fontSize: 11 }} />
                            <YAxis tick={{ fontSize: 11 }} />
                            <Tooltip />
                            <Bar dataKey="count" fill="#6366f1" radius={[4, 4, 0, 0]} />
                        </BarChart>
                    </ResponsiveContainer>
                ) : (
                    <NoData />
                )}
            </ChartCard>

            <ChartCard title="Route Performance Scorecard" subtitle={`Routes: ${fmt(sortedScorecard.length)} • Months: ${months.length > 0 ? months.join(', ') : 'N/A'}`}>
                {sortedScorecard.length > 0 ? (
                    <div className="overflow-x-auto max-h-[480px] overflow-y-auto">
                        <table className="w-full text-sm">
                            <thead className="sticky top-0 bg-white z-10">
                                <tr className="border-b border-gray-200">
                                    <SortableHeader label="Route" onClick={() => toggleSort('route')} />
                                    <SortableHeader label="Avg Daily Views" onClick={() => toggleSort('avgDailyViews')} align="right" />
                                    <SortableHeader label="View→Tap %" onClick={() => toggleSort('viewToTapRate')} align="right" />
                                    <SortableHeader label="View→Suggestion %" onClick={() => toggleSort('viewToSuggestionRate')} align="right" />
                                    <SortableHeader label="Suggestion→GO %" onClick={() => toggleSort('suggestionToGoRate')} align="right" />
                                    <th className="text-right py-2 px-3 text-gray-500 font-medium">Observed Legs</th>
                                    <SortableHeader label="Score" onClick={() => toggleSort('compositeScore')} align="right" />
                                    <SortableHeader label="Trend" onClick={() => toggleSort('trend')} />
                                    <th className="text-right py-2 px-3 text-gray-500 font-medium">Weekday</th>
                                    <th className="text-right py-2 px-3 text-gray-500 font-medium">Weekend</th>
                                    <SortableHeader label="Confidence" onClick={() => toggleSort('confidence')} />
                                    <th className="text-left py-2 px-3 text-gray-500 font-medium">Diagnosis</th>
                                    <th className="text-left py-2 px-3 text-gray-500 font-medium">Recommended Action</th>
                                </tr>
                            </thead>
                            <tbody className="tabular-nums">
                                {sortedScorecard.map(row => (
                                    <tr key={row.route} className="border-b border-gray-50 hover:bg-gray-50">
                                        <td className="py-2 px-3 font-bold">{row.route}</td>
                                        <td className="py-2 px-3 text-right">{fmt(row.avgDailyViews)}</td>
                                        <td className="py-2 px-3 text-right">{formatPercent(row.viewToTapRate)}</td>
                                        <td className="py-2 px-3 text-right">{formatPercent(getViewToSuggestionRate(row))}</td>
                                        <td className="py-2 px-3 text-right">{formatPercent(row.suggestionToGoRate)}</td>
                                        <td className="py-2 px-3 text-right">{fmt(row.totalLegs)}</td>
                                        <td className="py-2 px-3 text-right font-semibold">{row.compositeScore?.toFixed(1) || 'N/A'}</td>
                                        <td className="py-2 px-3">{trendBadge(row.trend)}</td>
                                        <td className="py-2 px-3 text-right">{row.weekdayScore?.toFixed(1) || 'N/A'}</td>
                                        <td className="py-2 px-3 text-right">{row.weekendScore?.toFixed(1) || 'N/A'}</td>
                                        <td className="py-2 px-3">{row.confidence}</td>
                                        <td className="py-2 px-3 text-gray-600">{row.diagnosisLabel}</td>
                                        <td className="py-2 px-3 text-gray-600">{row.recommendedActionLabel}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                ) : (
                    <NoData />
                )}
            </ChartCard>
        </div>
    );
};

const SortableHeader: React.FC<{ label: string; onClick: () => void; align?: 'left' | 'right' }> = ({
    label,
    onClick,
    align = 'left',
}) => (
    <th className={`${align === 'right' ? 'text-right' : 'text-left'} py-2 px-3 text-gray-500 font-medium`}>
        <button onClick={onClick} className="inline-flex items-center gap-1 hover:text-gray-700">
            {label}
            <ArrowUpDown size={12} />
        </button>
    </th>
);

function formatPercent(value: number | null): string {
    if (value === null) return 'N/A';
    return `${(value * 100).toFixed(1)}%`;
}

function getViewToSuggestionRate(row: RoutePerformanceScorecardRow): number | null {
    return row.viewToSuggestionRate ?? row.tapToSuggestionRate ?? null;
}

function numericSortValue(row: RoutePerformanceScorecardRow, sortKey: Exclude<SortKey, 'route' | 'trend' | 'confidence'>): number | null {
    if (sortKey === 'viewToSuggestionRate') {
        return getViewToSuggestionRate(row);
    }
    return row[sortKey] as number | null;
}

function trendBadge(trend: string): string {
    if (trend === 'Rising') return '↑ Rising';
    if (trend === 'Declining') return '↓ Declining';
    if (trend === 'Stable') return '↔ Stable';
    return 'N/A';
}
