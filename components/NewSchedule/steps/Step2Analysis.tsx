
import React, { useMemo, useState, useEffect } from 'react';
import {
    TripBucketAnalysis,
    TimeBand,
    BandSummary,
    DirectionBandSummary,
    MIN_RELIABLE_OBSERVATIONS,
    computeDirectionBandSummary,
    computeSegmentBreakdownByBand,
    sumDisplayedSegmentTotals,
} from '../../../utils/ai/runtimeAnalysis';
import { SegmentRawData } from '../utils/csvParser';
import {
    getOrderedSegmentColumns,
    normalizeSegmentNameForMatching,
    type OrderedSegmentColumn,
} from '../utils/wizardState';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, ReferenceLine } from 'recharts';
import { AlertTriangle, CheckCircle2, TrendingUp, Clock, BarChart2, ChevronDown, ChevronRight, Eye, EyeOff, Table } from 'lucide-react';
import { buildNormalizedSegmentNameLookup, resolveCanonicalSegmentName } from '../../../utils/runtimeSegmentMatching';

const truncateHeaderStop = (value: string, maxLength: number = 16): string => (
    value.length > maxLength ? `${value.substring(0, maxLength - 3)}...` : value
);

const renderSegmentHeader = (segmentName: string) => {
    const [fromStop = '', toStop = ''] = segmentName.split(' to ');
    const destinationLabel = truncateHeaderStop(toStop || segmentName, 18);
    const fromLabel = truncateHeaderStop(fromStop, 18);

    return (
        <div className="flex flex-col items-center leading-tight">
            <span className="text-xs font-semibold text-gray-700" title={toStop || segmentName}>
                {destinationLabel}
            </span>
            <span className="text-[11px] text-gray-400" title={fromStop ? `from ${fromStop}` : undefined}>
                {fromStop ? `from ${fromLabel}` : ''}
            </span>
        </div>
    );
};

// Segment Breakdown Matrix - Shows runtime data summarized by TIME BAND
const SegmentBreakdownMatrix: React.FC<{
    analysis: TripBucketAnalysis[];
    bands: TimeBand[];
    viewMetric: 'p50' | 'p80';
    segmentColumns: OrderedSegmentColumn[];
}> = ({ analysis, bands, viewMetric, segmentColumns }) => {
    const segmentNames = segmentColumns.map(column => column.segmentName);
    const segmentGroups = useMemo(() => {
        const groups: Array<{ label: string; count: number }> = [];
        segmentColumns.forEach((column) => {
            const label = column.groupLabel?.trim();
            if (!label) return;
            const previous = groups[groups.length - 1];
            if (previous?.label === label) {
                previous.count += 1;
            } else {
                groups.push({ label, count: 1 });
            }
        });
        return groups;
    }, [segmentColumns]);
    const groupStartIndexes = useMemo(() => {
        const starts = new Set<number>();
        let previousLabel: string | undefined;
        segmentColumns.forEach((column, index) => {
            const currentLabel = column.groupLabel;
            if (currentLabel && currentLabel !== previousLabel) {
                starts.add(index);
            }
            previousLabel = currentLabel;
        });
        return starts;
    }, [segmentColumns]);

    // Aggregate segment times by band
    const bandSummary = useMemo(() => {
        return computeSegmentBreakdownByBand(analysis, bands, segmentNames, viewMetric);
    }, [analysis, bands, segmentNames, viewMetric]);

    if (segmentNames.length === 0 || bands.length === 0) {
        return (
            <div className="bg-white rounded-xl border border-gray-200 p-6 text-center text-gray-400">
                No segment data available
            </div>
        );
    }

    return (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
            <div className="p-4 border-b border-gray-200 bg-gray-50 flex justify-between items-center">
                <div className="flex items-center gap-2">
                    <Table size={18} className="text-gray-500" />
                    <h3 className="font-bold text-gray-900">Segment Times by Band</h3>
                </div>
                <span className="text-xs text-gray-500">
                    Average {viewMetric === 'p50' ? '50th Percentile' : '80th Percentile'} times per band
                </span>
            </div>
            <div className="overflow-x-auto">
                <table className="w-full text-sm">
                    <thead>
                        <tr className="bg-gray-100 border-b border-gray-200">
                            <th
                                className="px-4 py-3 text-left font-bold text-gray-700 min-w-[100px]"
                                rowSpan={segmentGroups.length > 0 ? 2 : 1}
                            >
                                Band
                            </th>
                            <th
                                className="px-4 py-3 text-left font-bold text-gray-700 min-w-[180px]"
                                rowSpan={segmentGroups.length > 0 ? 2 : 1}
                            >
                                Time Slots
                            </th>
                            {segmentGroups.length > 0 ? (
                                segmentGroups.map(group => (
                                    <th
                                        key={group.label}
                                        colSpan={group.count}
                                        className="px-3 py-2 text-center text-xs font-bold uppercase tracking-wide text-gray-700 bg-gray-50 border-x border-gray-200"
                                    >
                                        {group.label}
                                    </th>
                                ))
                            ) : (
                                segmentColumns.map((column) => (
                                    <th key={column.segmentName} className="px-3 py-3 text-center font-medium text-gray-600 min-w-[90px]">
                                        {renderSegmentHeader(column.segmentName)}
                                    </th>
                                ))
                            )}
                            <th
                                className="px-4 py-3 text-center font-bold text-gray-700 min-w-[80px] bg-gray-200"
                                rowSpan={segmentGroups.length > 0 ? 2 : 1}
                            >
                                Total
                            </th>
                        </tr>
                        {segmentGroups.length > 0 && (
                            <tr className="bg-gray-100 border-b border-gray-200">
                                {segmentColumns.map((column) => (
                                    <th key={column.segmentName} className="px-3 py-3 text-center font-medium text-gray-600 min-w-[90px]">
                                        {renderSegmentHeader(column.segmentName)}
                                    </th>
                                ))}
                            </tr>
                        )}
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                        {bands.map(band => {
                            const data = bandSummary[band.id];
                            if (!data || data.totalCount === 0) return null;
                            const displayedTotal = sumDisplayedSegmentTotals(segmentNames, data.segmentTotals);

                            return (
                                <tr key={band.id} className="hover:bg-blue-50/30">
                                    <td className="px-4 py-3">
                                        <div className="flex items-center gap-3">
                                            <span
                                                className="px-3 py-1 rounded-lg text-sm font-bold text-white shadow-sm"
                                                style={{ backgroundColor: band.color }}
                                            >
                                                {band.id}
                                            </span>
                                            <div className="text-xs text-gray-500">
                                                <div>{band.min.toFixed(0)}-{band.max.toFixed(0)}m</div>
                                            </div>
                                        </div>
                                    </td>
                                    <td className="px-4 py-3">
                                        <div className="flex flex-wrap gap-1 max-w-[200px]">
                                            {data.timeSlots.sort().map((slot, idx) => (
                                                <span
                                                    key={idx}
                                                    className="px-1.5 py-0.5 rounded text-[10px] font-mono"
                                                    style={{
                                                        backgroundColor: band.color + '20',
                                                        color: band.color
                                                    }}
                                                >
                                                    {slot}
                                                </span>
                                            ))}
                                        </div>
                                    </td>
                                    {segmentColumns.map((column, columnIndex) => {
                                        const segName = column.segmentName;
                                        const segData = data.segmentTotals[segName];
                                        const avgValue = segData && segData.totalWeight > 0
                                            ? segData.weightedSum / segData.totalWeight
                                            : null;

                                        return (
                                            <td
                                                key={segName}
                                                className="px-3 py-3 text-center font-mono"
                                                style={{
                                                    backgroundColor: band.color + '15',
                                                    borderLeft: `${groupStartIndexes.has(columnIndex) ? 4 : 3}px solid ${band.color}`
                                                }}
                                            >
                                                {avgValue !== null ? (
                                                    <span className="text-gray-800 font-medium">
                                                        {avgValue.toFixed(0)}
                                                    </span>
                                                ) : (
                                                    <span className="text-gray-300">-</span>
                                                )}
                                            </td>
                                        );
                                    })}
                                    <td
                                        className="px-4 py-3 text-center font-mono font-bold text-lg"
                                        style={{ backgroundColor: band.color + '25' }}
                                    >
                                        {displayedTotal}
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

interface Step2Props {
    dayType: string;
    routeNumber?: string;
    analysis: TripBucketAnalysis[];
    bands: TimeBand[];
    setAnalysis: (data: TripBucketAnalysis[]) => void;
    segmentsMap?: Record<string, SegmentRawData[]>; // Direction -> segments
    canonicalSegmentColumns?: OrderedSegmentColumn[];
    onBandSummaryChange?: (summary: DirectionBandSummary) => void;
}

export const Step2Analysis: React.FC<Step2Props> = ({
    dayType,
    routeNumber,
    analysis,
    bands,
    setAnalysis,
    segmentsMap,
    canonicalSegmentColumns,
    onBandSummaryChange,
}) => {
    // Toggle for View Mode
    const [viewMetric, setViewMetric] = useState<'p50' | 'p80'>('p50');

    // Detailed Table Expansion State
    const [expandedBuckets, setExpandedBuckets] = useState<Set<string>>(new Set());

    const toggleExpand = (bucket: string) => {
        const newSet = new Set(expandedBuckets);
        if (newSet.has(bucket)) newSet.delete(bucket);
        else newSet.add(bucket);
        setExpandedBuckets(newSet);
    };

    const runtimeOrderedSegmentColumns = useMemo(
        () => getOrderedSegmentColumns(segmentsMap || {}, routeNumber, analysis),
        [analysis, routeNumber, segmentsMap]
    );
    const displaySegmentColumns = useMemo(
        () => (canonicalSegmentColumns && canonicalSegmentColumns.length > 0 ? canonicalSegmentColumns : runtimeOrderedSegmentColumns),
        [canonicalSegmentColumns, runtimeOrderedSegmentColumns]
    );
    const displaySegmentNames = useMemo(
        () => displaySegmentColumns.map(column => column.segmentName),
        [displaySegmentColumns]
    );
    const displaySegmentLookup = useMemo(
        () => buildNormalizedSegmentNameLookup(displaySegmentNames),
        [displaySegmentNames]
    );
    const orderedSegmentIndex = useMemo(() => {
        const index = new Map<string, number>();
        displaySegmentColumns.forEach((column, position) => {
            index.set(normalizeSegmentNameForMatching(column.segmentName), position);
        });
        return index;
    }, [displaySegmentColumns]);
    const segmentBreakdownByBand = useMemo(
        () => computeSegmentBreakdownByBand(analysis, bands, displaySegmentNames, viewMetric),
        [analysis, bands, displaySegmentNames, viewMetric]
    );
    const bucketConfidence = useMemo(() => {
        const expectedSegments = displaySegmentNames.length;

        return Object.fromEntries(analysis.map((bucket) => {
            const segmentSamples = new Map<string, number>();

            bucket.details?.forEach((detail) => {
                const resolvedSegmentName = resolveCanonicalSegmentName(detail.segmentName, displaySegmentLookup);
                if (!resolvedSegmentName) return;
                segmentSamples.set(resolvedSegmentName, detail.n && detail.n > 0 ? detail.n : 1);
            });

            const matchedSegments = segmentSamples.size;
            const sampleValues = Array.from(segmentSamples.values());
            const minSegmentSamples = sampleValues.length > 0 ? Math.min(...sampleValues) : 0;
            const avgSegmentSamples = sampleValues.length > 0
                ? sampleValues.reduce((sum, value) => sum + value, 0) / sampleValues.length
                : 0;
            const missingSegments = Math.max(0, expectedSegments - matchedSegments);
            const hasLowSamples = minSegmentSamples > 0 && minSegmentSamples < MIN_RELIABLE_OBSERVATIONS;
            const hasMissingSegments = expectedSegments > 0 && missingSegments > 0;

            return [bucket.timeBucket, {
                matchedSegments,
                expectedSegments,
                missingSegments,
                minSegmentSamples,
                avgSegmentSamples,
                hasLowSamples,
                hasMissingSegments,
                isLowConfidence: hasLowSamples || hasMissingSegments,
            }];
        }));
    }, [analysis, displaySegmentLookup, displaySegmentNames]);

    // Compute band summary for export to schedule generator - KEYED BY DIRECTION
    const computedBandSummary = useMemo(
        (): DirectionBandSummary => computeDirectionBandSummary(
            analysis,
            bands,
            segmentsMap || {},
            { canonicalSegmentColumns: displaySegmentColumns }
        ),
        [analysis, bands, displaySegmentColumns, segmentsMap]
    );

    // Export band summary to parent when it changes
    useEffect(() => {
        if (onBandSummaryChange) {
            console.log('=== STEP2 EXPORTING BAND SUMMARY ===');
            console.log('Directions:', Object.keys(computedBandSummary));
            Object.entries(computedBandSummary).forEach(([dir, bands]) => {
                console.log(`  ${dir}: ${bands.length} bands`);
                bands.forEach(b => {
                    console.log(`    Band ${b.bandId}: ${b.segments.length} segments, avgTotal=${b.avgTotal?.toFixed(1)}`);
                    b.segments.slice(0, 3).forEach(s => {
                        console.log(`      "${s.segmentName}" => ${s.avgTime}`);
                    });
                });
            });
            console.log('======================================');
            onBandSummaryChange(computedBandSummary);
        }
    }, [computedBandSummary, onBandSummaryChange]);

    const displayedBandTotals = useMemo(() => {
        const totals = new Map<string, number>();
        Object.entries(segmentBreakdownByBand).forEach(([bandId, bandData]) => {
            totals.set(bandId, sumDisplayedSegmentTotals(displaySegmentNames, bandData.segmentTotals));
        });
        return totals;
    }, [displaySegmentNames, segmentBreakdownByBand]);

    // Prepare chart data using the true per-bucket totals so each 30-minute slot
    // reflects its own observed runtime instead of repeating the whole-band average.
    const chartData = useMemo(() => {
        return analysis.map(a => ({
            name: a.timeBucket.split(' - ')[0], // Just start time
            runtime: viewMetric === 'p50' ? a.totalP50 : a.totalP80,
            band: a.assignedBand,
            color: bands.find(b => b.id === a.assignedBand)?.color || '#cccccc', // Bands currently calculated on P50.
            ignored: a.ignored,
            fullBucket: a.timeBucket,
            confidence: bucketConfidence[a.timeBucket],
            // Note: If we want Bands for P80, we'd need to re-calc binning for P80. 
            // Assumption: Bands for Schedule Logic are based on "Average" (P50).
        }));
    }, [analysis, bands, bucketConfidence, viewMetric]);

    const toggleIgnore = (bucket: string) => {
        const newData = analysis.map(a => {
            if (a.timeBucket === bucket) {
                return { ...a, ignored: !a.ignored };
            }
            return a;
        });
        setAnalysis(newData);
    };

    return (
        <div className="space-y-6 animate-in fade-in duration-500">
            <div className="flex justify-between items-start">
                <div>
                    <h2 className="text-2xl font-bold text-gray-900 tracking-tight">Runtime Analysis</h2>
                    <p className="text-gray-500">
                        Review the total summed runtime for all segments.
                    </p>
                    {displaySegmentColumns.some(column => column.groupLabel) && (
                        <p className="text-xs text-gray-400 mt-1">
                            Segment columns run left to right as the full out-and-back chain.
                        </p>
                    )}
                </div>

                {/* Metric Toggle */}
                <div className="flex bg-gray-100 p-1 rounded-lg">
                    <button
                        onClick={() => setViewMetric('p50')}
                        className={`px-4 py-2 text-sm font-bold rounded-md transition-all ${viewMetric === 'p50' ? 'bg-white text-brand-blue shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                    >
                        50th Percentile (Median)
                    </button>
                    <button
                        onClick={() => setViewMetric('p80')}
                        className={`px-4 py-2 text-sm font-bold rounded-md transition-all ${viewMetric === 'p80' ? 'bg-white text-brand-blue shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                    >
                        80th Percentile (Reliable)
                    </button>
                </div>
            </div>

            {/* Main Chart Card */}
            <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm">
                <div className="flex items-center gap-2 mb-4">
                    <BarChart2 className="text-gray-400" size={20} />
                    <h3 className="font-bold text-gray-700 uppercase text-sm tracking-wider">
                        {viewMetric === 'p50' ? 'Median Trip Time (50%)' : 'Reliable Trip Time (80%)'}
                    </h3>
                </div>

                <div className="h-[400px] w-full">
                    <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={chartData} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" />
                            <XAxis
                                dataKey="name"
                                tick={{ fill: '#6B7280', fontSize: 12 }}
                                axisLine={false}
                                tickLine={false}
                            />
                            <YAxis
                                tick={{ fill: '#6B7280', fontSize: 12 }}
                                axisLine={false}
                                tickLine={false}
                                label={{ value: 'Runtime (min)', angle: -90, position: 'insideLeft', fill: '#9CA3AF' }}
                            />
                            <Tooltip
                                cursor={{ fill: '#F3F4F6' }}
                                content={({ active, payload }) => {
                                    if (active && payload && payload.length) {
                                        const data = payload[0].payload;
                                        return (
                                            <div className="bg-white p-3 border border-gray-200 shadow-lg rounded-lg">
                                                <p className="font-bold text-gray-900">{data.fullBucket}</p>
                                                {viewMetric === 'p50' && ( // Only show Band for P50 since bands are calc'd on it
                                                    <div className="flex items-center gap-2 mt-1">
                                                        <div className="w-3 h-3 rounded-full" style={{ backgroundColor: data.color }} />
                                                        <span className="text-sm font-medium">Band {data.band}</span>
                                                    </div>
                                                )}
                                                <p className="text-2xl font-bold text-gray-800 mt-2">{data.runtime.toFixed(1)} <span className="text-sm font-normal text-gray-500">min</span></p>
                                                <p className="text-xs text-gray-400 font-bold uppercase mt-1">{viewMetric.toUpperCase()} Metric</p>
                                                {data.confidence && (
                                                    <div className="mt-3 space-y-1 text-xs text-gray-600">
                                                        <p>
                                                            Coverage: <span className="font-semibold text-gray-800">{data.confidence.matchedSegments}/{data.confidence.expectedSegments}</span> segments
                                                        </p>
                                                        <p>
                                                            Min samples: <span className="font-semibold text-gray-800">{data.confidence.minSegmentSamples}</span>
                                                            {' '}• Avg samples: <span className="font-semibold text-gray-800">{data.confidence.avgSegmentSamples.toFixed(1)}</span>
                                                        </p>
                                                        {data.confidence.isLowConfidence && (
                                                            <div className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-1 text-amber-700 font-semibold">
                                                                <AlertTriangle size={12} />
                                                                {data.confidence.hasMissingSegments
                                                                    ? `Incomplete coverage (${data.confidence.missingSegments} missing)`
                                                                    : `Low sample bucket (< ${MIN_RELIABLE_OBSERVATIONS})`}
                                                            </div>
                                                        )}
                                                    </div>
                                                )}
                                                {data.ignored && <span className="text-xs bg-red-100 text-red-600 px-2 py-1 rounded-full mt-2 inline-block">Ignored</span>}
                                            </div>
                                        );
                                    }
                                    return null;
                                }}
                            />
                            <Bar dataKey="runtime" radius={[4, 4, 0, 0]}>
                                {chartData.map((entry, index) => (
                                    <Cell
                                        key={`cell-${index}`}
                                        fill={entry.ignored ? '#E5E7EB' : entry.color}
                                        fillOpacity={entry.ignored ? 1 : entry.confidence?.isLowConfidence ? 0.45 : 1}
                                        stroke={entry.ignored ? '#9CA3AF' : entry.confidence?.isLowConfidence ? '#F59E0B' : 'none'}
                                        strokeWidth={entry.confidence?.isLowConfidence ? 2 : 0}
                                        strokeDasharray={entry.ignored ? '4 4' : 'none'}
                                        cursor="pointer"
                                        onClick={() => toggleIgnore(entry.fullBucket)}
                                    />
                                ))}
                            </Bar>
                        </BarChart>
                    </ResponsiveContainer>
                </div>
            </div>

            {/* Stats Summary */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-blue-50 border border-blue-100 p-4 rounded-xl">
                    <div className="flex items-start gap-4">
                        <div className="bg-white p-2 rounded-full shadow-sm text-blue-600">
                            <TrendingUp size={24} />
                        </div>
                        <div>
                            <h3 className="font-bold text-blue-900">Analysis Logic</h3>
                            <p className="text-sm text-blue-700 mt-1">
                                The chart shows the actual observed total for each 30-minute bucket.
                                The matrix below still summarizes those buckets into broader time bands.
                                Buckets with thin data or missing segment coverage are dimmed and outlined.
                                Bands (A-E) are calculated based on the <strong>50th Percentile</strong> (Average) performance.
                            </p>
                        </div>
                    </div>
                </div>
                {/* Legend */}
                <div className="bg-white border border-gray-200 p-4 rounded-xl flex flex-wrap gap-4 items-center">
                    {bands.map(band => (
                        <div key={band.id} className="flex items-center gap-2">
                            <div className="w-3 h-3 rounded-full" style={{ backgroundColor: band.color }} />
                            <span className="text-xs font-bold text-gray-700">
                                Band {band.id} ({(displayedBandTotals.get(band.id) ?? band.avg).toFixed(0)}m)
                            </span>
                        </div>
                    ))}
                    {/* Additional Legend Items */}
                    <div className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-full bg-[#cccccc]" />
                        <span className="text-xs font-bold text-gray-700">Outlier</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-full border border-gray-300 border-dashed bg-gray-50" />
                        <span className="text-xs font-bold text-gray-700">Ignored</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-full border-2 border-amber-400 bg-amber-100/60" />
                        <span className="text-xs font-bold text-gray-700">Low confidence / incomplete</span>
                    </div>
                </div>
            </div>

            {/* NEW: Segment Breakdown Matrix Table */}
            <SegmentBreakdownMatrix
                analysis={analysis}
                bands={bands}
                viewMetric={viewMetric}
                segmentColumns={displaySegmentColumns}
            />

            {/* Detailed Breakdown Table */}
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                <div className="p-4 border-b border-gray-200 bg-gray-50 flex justify-between items-center">
                    <h3 className="font-bold text-gray-900">Detailed Breakdown</h3>
                    <p className="text-xs text-gray-500">Click rows to view segment details</p>
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full text-sm text-left">
                        <thead className="text-xs text-gray-500 uppercase bg-gray-50 border-b border-gray-200">
                            <tr>
                                <th className="px-6 py-3 w-12"></th>
                                <th className="px-6 py-3">Time Bucket</th>
                                <th className="px-6 py-3 text-right">Total P50 (Avg)</th>
                                <th className="px-6 py-3 text-right">Total P80 (Reliable)</th>
                                <th className="px-6 py-3 text-center">Band</th>
                                <th className="px-6 py-3 text-center">Confidence</th>
                                <th className="px-6 py-3 text-center">Status</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {analysis.map((row) => (
                                <React.Fragment key={row.timeBucket}>
                                    {(() => {
                                        const confidence = bucketConfidence[row.timeBucket];
                                        return (
                                    <tr
                                        onClick={() => toggleExpand(row.timeBucket)}
                                        className={`hover:bg-blue-50 cursor-pointer transition-colors ${row.ignored ? 'opacity-50 bg-gray-50' : ''}`}
                                    >
                                        <td className="px-6 py-4 text-center text-gray-400">
                                            {expandedBuckets.has(row.timeBucket) ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                                        </td>
                                        <td className="px-6 py-4 font-medium text-gray-900">
                                            {row.timeBucket}
                                        </td>
                                        <td className="px-6 py-4 text-right font-mono">
                                            {row.totalP50.toFixed(2)} min
                                        </td>
                                        <td className="px-6 py-4 text-right font-mono text-gray-600">
                                            {row.totalP80.toFixed(2)} min
                                        </td>
                                        <td className="px-6 py-4 text-center">
                                            {row.assignedBand && (
                                                <span
                                                    className="px-2 py-1 rounded text-xs font-bold text-white shadow-sm"
                                                    style={{ backgroundColor: bands.find(b => b.id === row.assignedBand)?.color }}
                                                >
                                                    {row.assignedBand}
                                                </span>
                                            )}
                                        </td>
                                        <td className="px-6 py-4 text-center">
                                            {confidence?.isLowConfidence ? (
                                                <div className="inline-flex flex-wrap items-center justify-center gap-1">
                                                    {confidence.hasLowSamples && (
                                                        <span className="rounded-full bg-amber-50 px-2 py-1 text-[11px] font-semibold text-amber-700">
                                                            Min n {confidence.minSegmentSamples}
                                                        </span>
                                                    )}
                                                    {confidence.hasMissingSegments && (
                                                        <span className="rounded-full bg-orange-50 px-2 py-1 text-[11px] font-semibold text-orange-700">
                                                            {confidence.missingSegments} missing
                                                        </span>
                                                    )}
                                                </div>
                                            ) : (
                                                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-1 text-[11px] font-semibold text-emerald-700">
                                                    <CheckCircle2 size={12} />
                                                    OK
                                                </span>
                                            )}
                                        </td>
                                        <td className="px-6 py-4 text-center">
                                            <button
                                                onClick={(e) => { e.stopPropagation(); toggleIgnore(row.timeBucket); }}
                                                className={`p-1 rounded hover:bg-gray-200 transition-colors ${row.ignored ? 'text-gray-400' : 'text-blue-600'}`}
                                                title={row.ignored ? "Include in analysis" : "Ignore from analysis"}
                                            >
                                                {row.ignored ? <EyeOff size={16} /> : <Eye size={16} />}
                                            </button>
                                        </td>
                                    </tr>
                                        );
                                    })()}
                                    {/* Expanded Detail Row */}
                                    {expandedBuckets.has(row.timeBucket) && (
                                        <tr>
                                            <td colSpan={7} className="bg-gray-50 p-4 shadow-inner">
                                                <div className="max-w-4xl mx-auto">
                                                    <h4 className="text-xs font-bold text-gray-500 uppercase mb-3">Segment Breakdown</h4>
                                                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                                                        {row.details && row.details.length > 0 ? (
                                                            [...row.details]
                                                                .sort((a, b) => (
                                                                    (orderedSegmentIndex.get(normalizeSegmentNameForMatching(a.segmentName)) ?? Number.MAX_SAFE_INTEGER)
                                                                    - (orderedSegmentIndex.get(normalizeSegmentNameForMatching(b.segmentName)) ?? Number.MAX_SAFE_INTEGER)
                                                                ))
                                                                .map((detail, idx) => (
                                                                <div key={idx} className="bg-white p-2 rounded border border-gray-100 flex justify-between items-center text-xs">
                                                                    <span className="font-medium truncate mr-2" title={detail.segmentName}>{detail.segmentName}</span>
                                                                    <div className="text-right whitespace-nowrap">
                                                                        <div className="text-gray-900 font-mono">{detail.p50.toFixed(1)} <span className="text-gray-400">/</span> {detail.p80.toFixed(1)}</div>
                                                                        <div className="text-[11px] text-gray-400">n={detail.n ?? 1}</div>
                                                                    </div>
                                                                </div>
                                                            ))
                                                        ) : (
                                                            <p className="text-gray-400 italic text-sm">No segment details available.</p>
                                                        )}
                                                    </div>
                                                </div>
                                            </td>
                                        </tr>
                                    )}
                                </React.Fragment>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};
