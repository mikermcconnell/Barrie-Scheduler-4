import React, { useMemo, useState } from 'react';
import {
    Bar,
    CartesianGrid,
    ComposedChart,
    Legend,
    Line,
    ReferenceArea,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from 'recharts';
import type {
    RouteDemandSupplyProfile,
    ServiceGapType,
    TransitAppDataSummary,
    TransferDayType,
    TransferSeason,
} from '../../utils/transitAppTypes';
import { ChartCard, MetricCard, NoData, fmt } from './AnalyticsShared';

interface ServiceGapsModuleProps {
    data: TransitAppDataSummary;
}

const DAY_TYPE_OPTIONS: { value: TransferDayType; label: string }[] = [
    { value: 'weekday', label: 'Weekday' },
    { value: 'saturday', label: 'Saturday' },
    { value: 'sunday', label: 'Sunday' },
];

const SEASON_OPTIONS: { value: TransferSeason; label: string }[] = [
    { value: 'jan', label: 'Jan' },
    { value: 'jul', label: 'Jul' },
    { value: 'sep', label: 'Sep' },
    { value: 'other', label: 'Other' },
];

const GAP_TYPE_OPTIONS: { value: 'all' | ServiceGapType; label: string }[] = [
    { value: 'all', label: 'All Gaps' },
    { value: 'span_start', label: 'Span Start' },
    { value: 'span_end', label: 'Span End' },
    { value: 'weekend', label: 'Weekend' },
    { value: 'seasonal_shift', label: 'Seasonal Shift' },
    { value: 'frequency_gap', label: 'Frequency Gap' },
];

function formatHour(hour: number): string {
    return `${hour.toString().padStart(2, '0')}:00`;
}

function formatMinuteClock(value: number | null): string {
    if (value === null) return 'N/A';
    const hour = Math.floor(value / 60);
    const minute = value % 60;
    return `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
}

function gapLabel(gapType: ServiceGapType): string {
    switch (gapType) {
        case 'span_start': return 'Span Start';
        case 'span_end': return 'Span End';
        case 'weekend': return 'Weekend';
        case 'seasonal_shift': return 'Seasonal Shift';
        case 'frequency_gap': return 'Frequency Gap';
        default: return gapType;
    }
}

export const ServiceGapsModule: React.FC<ServiceGapsModuleProps> = ({ data }) => {
    const analysis = data.serviceGapAnalysis;
    const [selectedRoute, setSelectedRoute] = useState('');
    const [selectedDayType, setSelectedDayType] = useState<TransferDayType>('weekday');
    const [selectedSeason, setSelectedSeason] = useState<TransferSeason>('jan');
    const [selectedGapType, setSelectedGapType] = useState<'all' | ServiceGapType>('all');

    const profiles = analysis?.routeProfiles || [];
    const gapRegister = analysis?.gapRegister || [];

    const routeOptions = useMemo(() => (
        Array.from(new Set(profiles.map(p => p.route))).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    ), [profiles]);

    const effectiveRoute = selectedRoute || routeOptions[0] || '';

    const routeProfiles = useMemo(() => (
        profiles.filter(profile => profile.route === effectiveRoute)
    ), [profiles, effectiveRoute]);

    const availableDayTypes = useMemo(() => {
        const values = new Set(routeProfiles.map(profile => profile.dayType));
        return DAY_TYPE_OPTIONS.filter(option => values.has(option.value));
    }, [routeProfiles]);

    const effectiveDayType = availableDayTypes.some(option => option.value === selectedDayType)
        ? selectedDayType
        : (availableDayTypes[0]?.value || 'weekday');

    const availableSeasons = useMemo(() => {
        const values = new Set(
            routeProfiles
                .filter(profile => profile.dayType === effectiveDayType)
                .map(profile => profile.season)
        );
        return SEASON_OPTIONS.filter(option => values.has(option.value));
    }, [routeProfiles, effectiveDayType]);

    const effectiveSeason = availableSeasons.some(option => option.value === selectedSeason)
        ? selectedSeason
        : (availableSeasons[0]?.value || 'jan');

    const selectedProfile: RouteDemandSupplyProfile | null = useMemo(() => (
        routeProfiles.find(
            profile => profile.dayType === effectiveDayType && profile.season === effectiveSeason
        ) || null
    ), [routeProfiles, effectiveDayType, effectiveSeason]);

    const chartData = useMemo(() => (
        (selectedProfile?.hourly || []).map(point => ({
            hour: point.hour,
            hourLabel: formatHour(point.hour),
            demand: point.demand,
            supply: point.supply,
        }))
    ), [selectedProfile]);

    const firstSpanHour = selectedProfile?.firstDepartureMin !== null && selectedProfile?.firstDepartureMin !== undefined
        ? Math.floor((selectedProfile.firstDepartureMin % 1440) / 60)
        : null;
    const lastSpanHour = selectedProfile?.lastDepartureMin !== null && selectedProfile?.lastDepartureMin !== undefined
        ? Math.floor((selectedProfile.lastDepartureMin % 1440) / 60)
        : null;
    const canShadePostSpan = selectedProfile?.lastDepartureMin !== null
        && selectedProfile?.lastDepartureMin !== undefined
        && selectedProfile.lastDepartureMin < 1440;

    const selectedRouteSummary = useMemo(() => (
        data.routeMetrics.summary.find(row => row.route.trim().toUpperCase() === effectiveRoute)
    ), [data.routeMetrics.summary, effectiveRoute]);

    const selectedRouteScorecard = useMemo(() => (
        data.routePerformance?.scorecard.find(row => row.route.trim().toUpperCase() === effectiveRoute) || null
    ), [data.routePerformance, effectiveRoute]);

    const filteredGapRows = useMemo(() => (
        gapRegister
            .filter(row => !effectiveRoute || row.route === effectiveRoute)
            .filter(row => selectedGapType === 'all' || row.gapType === selectedGapType)
    ), [gapRegister, effectiveRoute, selectedGapType]);

    const routeGapSummary = useMemo(() => {
        const grouped = new Map<string, { count: number; peakDemandGap: number; topType: ServiceGapType | null }>();
        for (const row of gapRegister) {
            const existing = grouped.get(row.route);
            if (existing) {
                existing.count += 1;
                existing.peakDemandGap = Math.max(existing.peakDemandGap, row.appRequestsPerHour - row.scheduledTripsPerHour);
                if (!existing.topType) existing.topType = row.gapType;
            } else {
                grouped.set(row.route, {
                    count: 1,
                    peakDemandGap: row.appRequestsPerHour - row.scheduledTripsPerHour,
                    topType: row.gapType,
                });
            }
        }

        return Array.from(grouped.entries())
            .map(([route, stats]) => ({ route, ...stats }))
            .sort((a, b) => b.peakDemandGap - a.peakDemandGap || b.count - a.count)
            .slice(0, 12);
    }, [gapRegister]);

    if (!analysis || profiles.length === 0) {
        return (
            <ChartCard
                title="Service Span & Frequency Gaps"
                subtitle="Re-import with route leg data and GTFS to generate demand-vs-supply profiles."
            >
                <NoData />
            </ChartCard>
        );
    }

    return (
        <div className="space-y-6">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <MetricCard icon={<span className="text-sm font-bold">R</span>} label="Routes with Demand" value={fmt(analysis.totals.routesWithDemand)} color="cyan" />
                <MetricCard icon={<span className="text-sm font-bold">M</span>} label="Matched to GTFS" value={fmt(analysis.totals.matchedRoutes)} color="emerald" />
                <MetricCard icon={<span className="text-sm font-bold">G</span>} label="Gap Rows" value={fmt(gapRegister.length)} color="amber" />
                <MetricCard icon={<span className="text-sm font-bold">S</span>} label="Supply Profiles" value={fmt(analysis.supplyProfiles.length)} color="indigo" />
            </div>

            <ChartCard
                title="Demand vs Supply Overlay"
                subtitle={`Route ${effectiveRoute || 'N/A'} • ${effectiveDayType} • ${effectiveSeason.toUpperCase()}`}
                headerExtra={(
                    <div className="flex items-center gap-2">
                        <select
                            value={effectiveRoute}
                            onChange={e => setSelectedRoute(e.target.value)}
                            className="px-2 py-1.5 border border-gray-200 rounded text-xs"
                        >
                            {routeOptions.map(route => (
                                <option key={route} value={route}>{route}</option>
                            ))}
                        </select>
                        <select
                            value={effectiveDayType}
                            onChange={e => setSelectedDayType(e.target.value as TransferDayType)}
                            className="px-2 py-1.5 border border-gray-200 rounded text-xs"
                        >
                            {availableDayTypes.map(option => (
                                <option key={option.value} value={option.value}>{option.label}</option>
                            ))}
                        </select>
                        <select
                            value={effectiveSeason}
                            onChange={e => setSelectedSeason(e.target.value as TransferSeason)}
                            className="px-2 py-1.5 border border-gray-200 rounded text-xs"
                        >
                            {availableSeasons.map(option => (
                                <option key={option.value} value={option.value}>{option.label}</option>
                            ))}
                        </select>
                    </div>
                )}
            >
                {selectedProfile && chartData.length > 0 ? (
                    <div className="space-y-4">
                        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                            <div className="bg-gray-50 rounded-lg p-3 border border-gray-100">
                                <p className="text-xs text-gray-500">First Trip</p>
                                <p className="text-sm font-bold text-gray-900">{formatMinuteClock(selectedProfile.firstDepartureMin)}</p>
                            </div>
                            <div className="bg-gray-50 rounded-lg p-3 border border-gray-100">
                                <p className="text-xs text-gray-500">Last Trip</p>
                                <p className="text-sm font-bold text-gray-900">{formatMinuteClock(selectedProfile.lastDepartureMin)}</p>
                            </div>
                            <div className="bg-gray-50 rounded-lg p-3 border border-gray-100">
                                <p className="text-xs text-gray-500">Avg Headway</p>
                                <p className="text-sm font-bold text-gray-900">
                                    {selectedProfile.avgHeadwayMinutes !== null ? `${selectedProfile.avgHeadwayMinutes} min` : 'N/A'}
                                </p>
                            </div>
                            <div className="bg-gray-50 rounded-lg p-3 border border-gray-100">
                                <p className="text-xs text-gray-500">Demand Outside Span</p>
                                <p className="text-sm font-bold text-gray-900">
                                    {fmt(selectedProfile.demandBeforeFirst + selectedProfile.demandAfterLast)}
                                </p>
                            </div>
                        </div>

                        <ResponsiveContainer width="100%" height={340}>
                            <ComposedChart data={chartData} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
                                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                                <XAxis
                                    dataKey="hour"
                                    tick={{ fontSize: 10 }}
                                    tickFormatter={value => `${String(value).padStart(2, '0')}:00`}
                                />
                                <YAxis yAxisId="left" tick={{ fontSize: 11 }} />
                                <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }} />
                                <Tooltip
                                    formatter={(value: number, name: string) => [value, name === 'demand' ? 'App Demand' : 'Scheduled Departures']}
                                    labelFormatter={(label: number) => `Hour ${formatHour(label)}`}
                                />
                                <Legend />
                                {firstSpanHour !== null && firstSpanHour > 0 && (
                                    <ReferenceArea x1={0} x2={firstSpanHour - 0.01} fill="#fef3c7" fillOpacity={0.35} yAxisId="left" />
                                )}
                                {lastSpanHour !== null && canShadePostSpan && lastSpanHour < 23 && (
                                    <ReferenceArea x1={lastSpanHour + 0.01} x2={23} fill="#fee2e2" fillOpacity={0.25} yAxisId="left" />
                                )}
                                <Bar yAxisId="left" dataKey="demand" fill="#06b6d4" name="App Demand" radius={[4, 4, 0, 0]} />
                                <Line yAxisId="right" type="monotone" dataKey="supply" stroke="#f59e0b" strokeWidth={2.5} dot={false} name="Scheduled Departures" />
                            </ComposedChart>
                        </ResponsiveContainer>
                    </div>
                ) : (
                    <NoData />
                )}
            </ChartCard>

            <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                <ChartCard title="Gap Register" subtitle={`Rows: ${fmt(filteredGapRows.length)}`}>
                    <div className="mb-3">
                        <select
                            value={selectedGapType}
                            onChange={e => setSelectedGapType(e.target.value as 'all' | ServiceGapType)}
                            className="px-2 py-1.5 border border-gray-200 rounded text-xs"
                        >
                            {GAP_TYPE_OPTIONS.map(option => (
                                <option key={option.value} value={option.value}>{option.label}</option>
                            ))}
                        </select>
                    </div>
                    {filteredGapRows.length > 0 ? (
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="border-b border-gray-200">
                                        <th className="text-left py-2 px-2 text-gray-500 font-medium">Type</th>
                                        <th className="text-left py-2 px-2 text-gray-500 font-medium">Day</th>
                                        <th className="text-left py-2 px-2 text-gray-500 font-medium">Band</th>
                                        <th className="text-left py-2 px-2 text-gray-500 font-medium">Season</th>
                                        <th className="text-right py-2 px-2 text-gray-500 font-medium">Demand/h</th>
                                        <th className="text-right py-2 px-2 text-gray-500 font-medium">Supply/h</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {filteredGapRows.slice(0, 40).map((row, idx) => (
                                        <tr key={`${row.route}-${row.gapType}-${row.dayType}-${row.timeBand}-${idx}`} className="border-b border-gray-50 hover:bg-gray-50">
                                            <td className="py-2 px-2">{gapLabel(row.gapType)}</td>
                                            <td className="py-2 px-2 capitalize">{row.dayType}</td>
                                            <td className="py-2 px-2">{row.timeBand.replace('_', ' ')}</td>
                                            <td className="py-2 px-2 uppercase">{row.season}</td>
                                            <td className="py-2 px-2 text-right font-semibold">{row.appRequestsPerHour.toFixed(1)}</td>
                                            <td className="py-2 px-2 text-right">{row.scheduledTripsPerHour.toFixed(1)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    ) : (
                        <NoData />
                    )}
                </ChartCard>

                <ChartCard title="Route Gap Priority" subtitle="Routes with strongest demand-minus-supply signals">
                    {routeGapSummary.length > 0 ? (
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="border-b border-gray-200">
                                        <th className="text-left py-2 px-2 text-gray-500 font-medium">Route</th>
                                        <th className="text-right py-2 px-2 text-gray-500 font-medium">Gap Rows</th>
                                        <th className="text-right py-2 px-2 text-gray-500 font-medium">Peak Gap</th>
                                        <th className="text-left py-2 px-2 text-gray-500 font-medium">Primary Type</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {routeGapSummary.map(row => (
                                        <tr key={row.route} className="border-b border-gray-50 hover:bg-gray-50">
                                            <td className="py-2 px-2 font-bold">{row.route}</td>
                                            <td className="py-2 px-2 text-right">{fmt(row.count)}</td>
                                            <td className="py-2 px-2 text-right font-semibold">{row.peakDemandGap.toFixed(1)}</td>
                                            <td className="py-2 px-2">{row.topType ? gapLabel(row.topType) : 'N/A'}</td>
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

            <ChartCard title="UC2 Context" subtitle="Route engagement cross-reference for selected route">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                    <div className="bg-gray-50 border border-gray-100 rounded-lg p-3">
                        <p className="text-xs text-gray-500">Avg Daily Views</p>
                        <p className="font-bold text-gray-900">{selectedRouteSummary ? fmt(selectedRouteSummary.avgDailyViews) : 'N/A'}</p>
                    </div>
                    <div className="bg-gray-50 border border-gray-100 rounded-lg p-3">
                        <p className="text-xs text-gray-500">Avg Daily Taps</p>
                        <p className="font-bold text-gray-900">{selectedRouteSummary ? fmt(selectedRouteSummary.avgDailyTaps) : 'N/A'}</p>
                    </div>
                    <div className="bg-gray-50 border border-gray-100 rounded-lg p-3">
                        <p className="text-xs text-gray-500">Performance Trend</p>
                        <p className="font-bold text-gray-900">{selectedRouteScorecard?.trend || 'N/A'}</p>
                    </div>
                </div>
            </ChartCard>
        </div>
    );
};
