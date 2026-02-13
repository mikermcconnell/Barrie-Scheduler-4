import React, { useMemo, useState } from 'react';
import { jsPDF } from 'jspdf';
import 'jspdf-autotable';
import { Radio, Filter, Layers, MessageCircle } from 'lucide-react';
import type { HeatmapAtlasSliceId, TransitAppDataSummary, TransferSeason } from '../../utils/transit-app/transitAppTypes';
import { TransitAppMap } from './TransitAppMap';
import { ChartCard, MetricCard, NoData, fmt, formatTimeBand, formatDayType, formatSeason } from './AnalyticsShared';


interface HeatmapModuleProps {
    data: TransitAppDataSummary;
}

const SEASON_OPTIONS: { key: TransferSeason; label: string }[] = [
    { key: 'jan', label: 'January' },
    { key: 'jul', label: 'July' },
    { key: 'sep', label: 'September' },
    { key: 'other', label: 'Other' },
];

const ATLAS_ORDER: { id: HeatmapAtlasSliceId; label: string }[] = [
    { id: 'weekday_am_peak', label: 'Weekday AM' },
    { id: 'weekday_midday', label: 'Weekday Midday' },
    { id: 'weekday_pm_peak', label: 'Weekday PM' },
    { id: 'weekday_evening', label: 'Weekday Evening' },
    { id: 'saturday_all_day', label: 'Saturday All Day' },
    { id: 'sunday_all_day', label: 'Sunday All Day' },
];

export const HeatmapModule: React.FC<HeatmapModuleProps> = ({ data }) => {
    const { locationDensity, odPairs, heatmapAnalysis } = data;
    const [season, setSeason] = useState<TransferSeason>('jan');
    const [sliceId, setSliceId] = useState<HeatmapAtlasSliceId>('weekday_am_peak');

    const atlas = useMemo(() => heatmapAnalysis?.atlas ?? [], [heatmapAnalysis]);

    const activeSlice = useMemo(() => (
        atlas.find(slice => slice.season === season && slice.id === sliceId) || null
    ), [atlas, season, sliceId]);

    const atlasRows = useMemo(() => {
        const rows = atlas.map(slice => {
            const hotspot = slice.cells[0];
            return {
                season: slice.season,
                id: slice.id,
                label: ATLAS_ORDER.find(def => def.id === slice.id)?.label || slice.id,
                totalPoints: slice.totalPoints,
                hotspotCount: hotspot?.count || 0,
                hotspotLat: hotspot?.latBin ?? null,
                hotspotLon: hotspot?.lonBin ?? null,
            };
        });
        return rows.sort((a, b) => b.totalPoints - a.totalPoints);
    }, [atlas]);

    const mapDensity = activeSlice
        ? {
            cells: activeSlice.cells,
            bounds: activeSlice.bounds,
            totalPoints: activeSlice.totalPoints,
            rawPoints: locationDensity.rawPoints,
            debiasedPoints: locationDensity.debiasedPoints,
            debiasWindowMinutes: locationDensity.debiasWindowMinutes,
        }
        : locationDensity;

    const topCallouts = useMemo(() => {
        const callouts = heatmapAnalysis?.callouts || [];
        return callouts
            .filter(callout => callout.season === season)
            .sort((a, b) => b.pointCount - a.pointCount)
            .slice(0, 6);
    }, [heatmapAnalysis, season]);

    const exportAtlasPdf = () => {
        if (!heatmapAnalysis) return;
        const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'letter' });
        const margin = 14;
        const pageWidth = doc.internal.pageSize.getWidth();

        doc.setFontSize(15);
        doc.setFont('helvetica', 'bold');
        doc.text('Transit App Heatmap Atlas Summary', pageWidth / 2, margin, { align: 'center' });

        doc.setFontSize(9);
        doc.setFont('helvetica', 'normal');
        doc.text(
            `Debiasing: ${heatmapAnalysis.debiasing.rawPoints.toLocaleString()} raw -> ${heatmapAnalysis.debiasing.debiasedPoints.toLocaleString()} debiased (${heatmapAnalysis.debiasing.reductionPct}% reduction)`,
            pageWidth / 2,
            margin + 6,
            { align: 'center' }
        );

        const head = [['Season', 'Slice', 'Points', 'Top Cell Count', 'Hotspot']];
        const body = atlasRows.map(row => [
            formatSeason(row.season),
            row.label,
            row.totalPoints.toLocaleString(),
            row.hotspotCount.toLocaleString(),
            row.hotspotLat !== null && row.hotspotLon !== null
                ? `${row.hotspotLat.toFixed(4)}, ${row.hotspotLon.toFixed(4)}`
                : 'N/A',
        ]);

        doc.autoTable({
            head,
            body,
            startY: margin + 11,
            theme: 'grid',
            headStyles: { fillColor: [31, 41, 55], fontSize: 8 },
            styles: { fontSize: 7, cellPadding: 1.6 },
            margin: { left: margin, right: margin },
        });

        const callouts = heatmapAnalysis.callouts
            .sort((a, b) => b.pointCount - a.pointCount)
            .slice(0, 10);
        const calloutHead = [['Season', 'Day', 'Band', 'Points', 'Note']];
        const calloutBody = callouts.map(callout => [
            formatSeason(callout.season),
            formatDayType(callout.dayType),
            formatTimeBand(callout.timeBand),
            callout.pointCount.toLocaleString(),
            callout.note,
        ]);

        doc.autoTable({
            head: calloutHead,
            body: calloutBody,
            startY: 168,
            theme: 'grid',
            headStyles: { fillColor: [15, 118, 110], fontSize: 8 },
            styles: { fontSize: 7, cellPadding: 1.4 },
            margin: { left: margin, right: margin },
        });

        const date = new Date().toISOString().slice(0, 10);
        doc.save(`transit-heatmap-atlas-${date}.pdf`);
    };

    if (!heatmapAnalysis) {
        return (
            <ChartCard title="Rider Demand Heatmaps" subtitle="No heatmap analysis available.">
                <NoData />
            </ChartCard>
        );
    }

    const seasonalTotals = heatmapAnalysis.seasonalTotals;
    const selectedSeasonTotal = season === 'jan'
        ? seasonalTotals.jan
        : season === 'jul'
            ? seasonalTotals.jul
            : season === 'sep'
                ? seasonalTotals.sep
                : seasonalTotals.other;

    return (
        <div className="space-y-6">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <MetricCard icon={<Radio size={20} />} label="Raw Pings" value={fmt(heatmapAnalysis.debiasing.rawPoints)} color="cyan" />
                <MetricCard icon={<Filter size={20} />} label="Debiased Pings" value={fmt(heatmapAnalysis.debiasing.debiasedPoints)} color="emerald" />
                <MetricCard icon={<Layers size={20} />} label="Atlas Slices" value={fmt(atlas.length)} color="indigo" />
                <MetricCard icon={<MessageCircle size={20} />} label="Callouts" value={fmt(heatmapAnalysis.callouts.length)} color="amber" />
            </div>

            <ChartCard
                title="Heatmap Atlas Viewer"
                subtitle={`${formatSeason(season)} • ${ATLAS_ORDER.find(a => a.id === sliceId)?.label ?? sliceId}`}
                headerExtra={(
                    <div className="flex items-center gap-2">
                        <select
                            value={season}
                            onChange={e => setSeason(e.target.value as TransferSeason)}
                            className="px-2 py-1.5 border border-gray-200 rounded text-xs"
                        >
                            {SEASON_OPTIONS.map(option => (
                                <option key={option.key} value={option.key}>{option.label}</option>
                            ))}
                        </select>
                        <select
                            value={sliceId}
                            onChange={e => setSliceId(e.target.value as HeatmapAtlasSliceId)}
                            className="px-2 py-1.5 border border-gray-200 rounded text-xs"
                        >
                            {ATLAS_ORDER.map(option => (
                                <option key={option.id} value={option.id}>{option.label}</option>
                            ))}
                        </select>
                        <button
                            onClick={exportAtlasPdf}
                            className="px-3 py-1.5 bg-white border border-gray-200 rounded text-xs font-medium text-gray-600 hover:bg-gray-50"
                        >
                            Export Atlas PDF
                        </button>
                    </div>
                )}
            >
                <div className="space-y-3">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
                        <div className="bg-gray-50 border border-gray-100 rounded-lg p-3">
                            <p className="text-xs text-gray-500">Season Total</p>
                            <p className="font-bold text-gray-900">{fmt(selectedSeasonTotal)}</p>
                        </div>
                        <div className="bg-gray-50 border border-gray-100 rounded-lg p-3">
                            <p className="text-xs text-gray-500">Selected Slice Points</p>
                            <p className="font-bold text-gray-900">{fmt(activeSlice?.totalPoints || 0)}</p>
                        </div>
                        <div className="bg-gray-50 border border-gray-100 rounded-lg p-3">
                            <p className="text-xs text-gray-500">Debias Reduction</p>
                            <p className="font-bold text-gray-900">{heatmapAnalysis.debiasing.reductionPct}%</p>
                        </div>
                    </div>
                    <TransitAppMap
                        locationDensity={mapDensity}
                        odPairs={odPairs}
                        height={560}
                        defaultLayer="heatmap"
                    />
                </div>
            </ChartCard>

            <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                <ChartCard
                    title={`Atlas Matrix (${atlas.length} Slices)`}
                    subtitle={`6 day/time slices x ${new Set(atlas.map(slice => slice.season)).size} seasons`}
                >
                    {atlasRows.length > 0 ? (
                        <div className="overflow-x-auto max-h-[400px] overflow-y-auto">
                            <table className="w-full text-sm">
                                <thead className="sticky top-0 bg-white z-10">
                                    <tr className="border-b border-gray-200">
                                        <th className="text-left py-2 px-2 text-gray-500 font-medium">Season</th>
                                        <th className="text-left py-2 px-2 text-gray-500 font-medium">Slice</th>
                                        <th className="text-right py-2 px-2 text-gray-500 font-medium">Points</th>
                                        <th className="text-right py-2 px-2 text-gray-500 font-medium">Top Cell</th>
                                    </tr>
                                </thead>
                                <tbody className="tabular-nums">
                                    {atlasRows.map(row => (
                                        <tr
                                            key={`${row.season}-${row.id}`}
                                            className="border-b border-gray-50 hover:bg-gray-50 cursor-pointer"
                                            onClick={() => {
                                                setSeason(row.season);
                                                setSliceId(row.id);
                                            }}
                                        >
                                            <td className="py-2 px-2">{formatSeason(row.season)}</td>
                                            <td className="py-2 px-2">{row.label}</td>
                                            <td className="py-2 px-2 text-right font-semibold">{fmt(row.totalPoints)}</td>
                                            <td className="py-2 px-2 text-right">{fmt(row.hotspotCount)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    ) : <NoData message="No atlas slices available for the selected filters." />}
                </ChartCard>

                <ChartCard title="Key Callouts" subtitle={`Top hotspots for ${formatSeason(season)}`}>
                    {topCallouts.length > 0 ? (
                        <div className="space-y-2">
                            {topCallouts.map((callout, idx) => (
                                <div key={`${callout.season}-${callout.lat}-${callout.lon}-${idx}`} className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm">
                                    <div className="flex items-center justify-between">
                                        <span className="font-semibold text-gray-900">
                                            {formatDayType(callout.dayType)} • {formatTimeBand(callout.timeBand)}
                                        </span>
                                        <span className="text-xs text-gray-500">{fmt(callout.pointCount)} points</span>
                                    </div>
                                    <p className="text-gray-600">{callout.note}</p>
                                    <p className="text-xs text-gray-400">{callout.lat.toFixed(4)}, {callout.lon.toFixed(4)}</p>
                                </div>
                            ))}
                        </div>
                    ) : <NoData message="No hotspot callouts for the selected season." />}
                </ChartCard>
            </div>

            <ChartCard title="Seasonal Comparison" subtitle="Debiased point totals by season">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                    <div className="rounded-lg border border-gray-200 p-3 bg-white">
                        <p className="text-xs text-gray-500">January</p>
                        <p className="text-xl font-bold text-gray-900">{fmt(seasonalTotals.jan)}</p>
                    </div>
                    <div className="rounded-lg border border-gray-200 p-3 bg-white">
                        <p className="text-xs text-gray-500">July</p>
                        <p className="text-xl font-bold text-gray-900">{fmt(seasonalTotals.jul)}</p>
                    </div>
                    <div className="rounded-lg border border-gray-200 p-3 bg-white">
                        <p className="text-xs text-gray-500">September</p>
                        <p className="text-xl font-bold text-gray-900">{fmt(seasonalTotals.sep)}</p>
                    </div>
                    {seasonalTotals.other > 0 && (
                        <div className="rounded-lg border border-gray-200 p-3 bg-white">
                            <p className="text-xs text-gray-500">Other</p>
                            <p className="text-xl font-bold text-gray-900">{fmt(seasonalTotals.other)}</p>
                        </div>
                    )}
                </div>
            </ChartCard>

            <ChartCard title="Method Note" subtitle="Data quality and interpretation">
                <p className="text-sm text-gray-600 leading-relaxed">
                    Heatmap points are debiased to at most one ping per user per 15-minute window before aggregation.
                    These maps represent relative app activity concentration, not total ridership.
                    Seasonal slices use Jan/Jul/Sep, with an "Other" season included when present.
                    Use route and stop overlays in the map controls to contextualize hotspots against the existing network.
                </p>
            </ChartCard>
        </div>
    );
};
