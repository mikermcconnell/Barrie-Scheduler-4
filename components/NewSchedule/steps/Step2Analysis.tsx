
import React, { useMemo, useState, useEffect } from 'react';
import { TripBucketAnalysis, TimeBand, BandSummary, DirectionBandSummary } from '../../../utils/ai/runtimeAnalysis';
import { SegmentRawData } from '../utils/csvParser';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, ReferenceLine } from 'recharts';
import { AlertTriangle, CheckCircle2, TrendingUp, Clock, BarChart2, ChevronDown, ChevronRight, Eye, EyeOff, Table } from 'lucide-react';

// Segment Breakdown Matrix - Shows runtime data summarized by TIME BAND
const SegmentBreakdownMatrix: React.FC<{
    analysis: TripBucketAnalysis[];
    bands: TimeBand[];
    viewMetric: 'p50' | 'p80';
}> = ({ analysis, bands, viewMetric }) => {
    // Extract unique segment names across all buckets
    const segmentNames = useMemo(() => {
        const names = new Set<string>();
        analysis.forEach(bucket => {
            bucket.details?.forEach(detail => names.add(detail.segmentName));
        });
        return Array.from(names);
    }, [analysis]);

    // Aggregate segment times by band
    const bandSummary = useMemo(() => {
        const summary: Record<string, {
            band: TimeBand;
            segmentTotals: Record<string, { sum: number; count: number; totalN: number }>;
            totalSum: number;
            totalCount: number;
            timeSlots: string[];
        }> = {};

        // Initialize for each band
        bands.forEach(band => {
            summary[band.id] = {
                band,
                segmentTotals: {},
                totalSum: 0,
                totalCount: 0,
                timeSlots: []
            };
            segmentNames.forEach(seg => {
                summary[band.id].segmentTotals[seg] = { sum: 0, count: 0, totalN: 0 };
            });
        });

        // Aggregate data from each bucket into its assigned band
        analysis.forEach(bucket => {
            if (bucket.ignored || !bucket.assignedBand) return;
            const bandData = summary[bucket.assignedBand];
            if (!bandData) return;

            // Track the time slot
            const timeSlot = bucket.timeBucket.split(' - ')[0]; // Just the start time
            bandData.timeSlots.push(timeSlot);

            bucket.details?.forEach(detail => {
                const value = viewMetric === 'p50' ? detail.p50 : detail.p80;
                if (bandData.segmentTotals[detail.segmentName]) {
                    bandData.segmentTotals[detail.segmentName].sum += value;
                    bandData.segmentTotals[detail.segmentName].count += 1;
                    bandData.segmentTotals[detail.segmentName].totalN += detail.n;
                }
            });

            const total = viewMetric === 'p50' ? bucket.totalP50 : bucket.totalP80;
            bandData.totalSum += total;
            bandData.totalCount += 1;
        });

        return summary;
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
                            <th className="px-4 py-3 text-left font-bold text-gray-700 min-w-[100px]">
                                Band
                            </th>
                            <th className="px-4 py-3 text-left font-bold text-gray-700 min-w-[180px]">
                                Time Slots
                            </th>
                            {segmentNames.map(seg => (
                                <th key={seg} className="px-3 py-3 text-center font-medium text-gray-600 min-w-[90px]">
                                    <div className="flex flex-col items-center">
                                        {seg.split(' to ').map((s, i) => (
                                            <span key={i} className={`text-xs ${i === 1 ? 'text-gray-400' : 'font-semibold'}`}>
                                                {i === 1 && '↓ '}
                                                {s.length > 15 ? s.substring(0, 12) + '...' : s}
                                            </span>
                                        ))}
                                    </div>
                                </th>
                            ))}
                            <th className="px-4 py-3 text-center font-bold text-gray-700 min-w-[80px] bg-gray-200">
                                Total
                            </th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                        {bands.map(band => {
                            const data = bandSummary[band.id];
                            if (!data || data.totalCount === 0) return null;

                            const avgTotal = data.totalSum / data.totalCount;

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
                                    {segmentNames.map(segName => {
                                        const segData = data.segmentTotals[segName];
                                        const avgValue = segData && segData.count > 0
                                            ? segData.sum / segData.count
                                            : null;

                                        return (
                                            <td
                                                key={segName}
                                                className="px-3 py-3 text-center font-mono"
                                                style={{
                                                    backgroundColor: band.color + '15',
                                                    borderLeft: `3px solid ${band.color}`
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
                                        {avgTotal.toFixed(0)}
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
    analysis: TripBucketAnalysis[];
    bands: TimeBand[];
    setAnalysis: (data: TripBucketAnalysis[]) => void;
    segmentsMap?: Record<string, SegmentRawData[]>; // Direction -> segments
    onBandSummaryChange?: (summary: DirectionBandSummary) => void;
}

export const Step2Analysis: React.FC<Step2Props> = ({ dayType, analysis, bands, setAnalysis, segmentsMap, onBandSummaryChange }) => {
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

    // Compute band summary for export to schedule generator - KEYED BY DIRECTION
    const computedBandSummary = useMemo((): DirectionBandSummary => {
        // Get all directions from segmentsMap or default to single direction
        const directions = segmentsMap ? Object.keys(segmentsMap) : ['North'];
        const result: DirectionBandSummary = {};

        directions.forEach(direction => {
            // Get segment names for this direction only
            const dirSegments = segmentsMap?.[direction] || [];
            const dirSegmentNames = new Set<string>();
            dirSegments.forEach(seg => dirSegmentNames.add(seg.segmentName));

            // Also include any segments from analysis that might match this direction
            // (This handles the case where segmentsMap might not be passed)
            if (dirSegmentNames.size === 0) {
                analysis.forEach(bucket => {
                    bucket.details?.forEach(detail => dirSegmentNames.add(detail.segmentName));
                });
            }

            const segmentNamesArr = Array.from(dirSegmentNames);

            result[direction] = bands.map(band => {
                const bucketsInBand = analysis.filter(a => !a.ignored && a.assignedBand === band.id);

                // Collect time slots
                const timeSlots = bucketsInBand.map(b => b.timeBucket.split(' - ')[0]);

                // Average total for this band (use full band average as one-way target)
                // The band average represents the target travel time for each trip
                const avgTotal = bucketsInBand.length > 0
                    ? bucketsInBand.reduce((sum, b) => sum + b.totalP50, 0) / bucketsInBand.length
                    : band.avg;

                // Average each segment for this direction only
                const avgSegments = segmentNamesArr.map(segName => {
                    let sum = 0;
                    let count = 0;
                    let totalN = 0;
                    bucketsInBand.forEach(bucket => {
                        const detail = bucket.details?.find(d => d.segmentName === segName);
                        if (detail) {
                            sum += detail.p50;
                            count++;
                            totalN += detail.n;
                        }
                    });
                    return {
                        segmentName: segName,
                        avgTime: count > 0 ? sum / count : 0,
                        totalN,
                    };
                }).filter(s => s.avgTime > 0); // Only keep segments with data

                return {
                    bandId: band.id,
                    color: band.color,
                    avgTotal,
                    segments: avgSegments,
                    timeSlots
                };
            });
        });

        return result;
    }, [analysis, bands, segmentsMap]);

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

    // Prepare chart data - use buckets
    const chartData = useMemo(() => {
        return analysis.map(a => ({
            name: a.timeBucket.split(' - ')[0], // Just start time
            runtime: viewMetric === 'p50' ? a.totalP50 : a.totalP80,
            band: a.assignedBand,
            color: bands.find(b => b.id === a.assignedBand)?.color || '#cccccc', // Bands currently calculated on P50.
            ignored: a.ignored,
            fullBucket: a.timeBucket
            // Note: If we want Bands for P80, we'd need to re-calc binning for P80. 
            // Assumption: Bands for Schedule Logic are based on "Average" (P50).
        }));
    }, [analysis, bands, viewMetric]);

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
                                        stroke={entry.ignored ? '#9CA3AF' : 'none'}
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
                                The graph sums overlapping segments for each 30-minute interval.
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
                            <span className="text-xs font-bold text-gray-700">Band {band.id} ({band.avg.toFixed(0)}m)</span>
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
                </div>
            </div>

            {/* NEW: Segment Breakdown Matrix Table */}
            <SegmentBreakdownMatrix analysis={analysis} bands={bands} viewMetric={viewMetric} />

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
                                <th className="px-6 py-3 text-center">Status</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {analysis.map((row) => (
                                <React.Fragment key={row.timeBucket}>
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
                                            <button
                                                onClick={(e) => { e.stopPropagation(); toggleIgnore(row.timeBucket); }}
                                                className={`p-1 rounded hover:bg-gray-200 transition-colors ${row.ignored ? 'text-gray-400' : 'text-blue-600'}`}
                                                title={row.ignored ? "Include in analysis" : "Ignore from analysis"}
                                            >
                                                {row.ignored ? <EyeOff size={16} /> : <Eye size={16} />}
                                            </button>
                                        </td>
                                    </tr>
                                    {/* Expanded Detail Row */}
                                    {expandedBuckets.has(row.timeBucket) && (
                                        <tr>
                                            <td colSpan={6} className="bg-gray-50 p-4 shadow-inner">
                                                <div className="max-w-4xl mx-auto">
                                                    <h4 className="text-xs font-bold text-gray-500 uppercase mb-3">Segment Breakdown</h4>
                                                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                                                        {row.details && row.details.length > 0 ? (
                                                            row.details.map((detail, idx) => (
                                                                <div key={idx} className="bg-white p-2 rounded border border-gray-100 flex justify-between items-center text-xs">
                                                                    <span className="font-medium truncate mr-2" title={detail.segmentName}>{detail.segmentName}</span>
                                                                    <div className="text-right whitespace-nowrap">
                                                                        <div className="text-gray-900 font-mono">{detail.p50.toFixed(1)} <span className="text-gray-400">/</span> {detail.p80.toFixed(1)}</div>
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
