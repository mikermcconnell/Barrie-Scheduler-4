
import React, { useMemo } from 'react';
import {
    TripBucketAnalysis,
    TimeBand,
    DirectionBandSummary,
    computeSegmentBreakdownByBand,
    getAverageBandTotal,
    getBucketDisplayedTotal,
} from '../../../utils/ai/runtimeAnalysis';
import { SegmentRawData } from '../utils/csvParser';
import {
    normalizeSegmentNameForMatching,
    type ApprovedRuntimeModel,
    type OrderedSegmentColumn,
    type Step2DataHealthReport,
} from '../utils/wizardState';
import type {
    ApprovedRuntimeContract,
    Step2ApprovalState,
} from '../utils/step2ReviewTypes';
import { Step2ApprovedRuntimeModelPanel } from './Step2ApprovedRuntimeModelPanel';
import { Step2ReadinessPanel } from './Step2ReadinessPanel';
import { Step2RuntimeReviewHeader } from './Step2RuntimeReviewHeader';
import { Step2TravelViewsPanel } from './Step2TravelViewsPanel';
import { useStep2RuntimeReview, type Step2BucketConfidence } from '../hooks/useStep2RuntimeReview';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, LabelList } from 'recharts';
import { AlertTriangle, CheckCircle2, TrendingUp, BarChart2, ChevronDown, ChevronRight, Eye, EyeOff, Table } from 'lucide-react';
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

const getMatrixSectionKey = (column: OrderedSegmentColumn): string => (
    column.groupLabel?.trim()
    || column.direction?.trim()
    || 'Route path'
);

const getMatrixSectionDescription = (column: OrderedSegmentColumn): string => {
    if (column.direction === 'North') return 'Outbound bus path';
    if (column.direction === 'South') return 'Return bus path';
    return 'Full stop sequence';
};

const formatContributionDate = (date: string): string => {
    const parsed = new Date(`${date}T12:00:00`);
    if (Number.isNaN(parsed.getTime())) return date;
    return new Intl.DateTimeFormat(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
    }).format(parsed);
};

const formatContributionRuntime = (runtime: number): string => `${runtime.toFixed(1)} min`;

const formatBucketTotal = (value: number): string => `${value.toFixed(1)} min`;

const getBucketStartLabel = (timeBucket: string): string => (
    timeBucket.split(' - ')[0] || timeBucket
);

export const buildRuntimeAxisDomain = (
    chartData: Array<{ runtime: number; ignored?: boolean }>
): [number, number] => {
    const values = chartData
        .filter(bucket => !bucket.ignored && Number.isFinite(bucket.runtime))
        .map(bucket => bucket.runtime);

    if (values.length === 0) return [0, 60];

    const min = Math.min(...values);
    const max = Math.max(...values);
    const spread = Math.max(1, max - min);
    const padding = Math.max(3, spread * 0.18);
    const lower = Math.max(0, Math.floor((min - padding) / 5) * 5);
    const upper = Math.ceil((max + padding) / 5) * 5;

    return lower >= upper ? [Math.max(0, lower - 5), upper + 5] : [lower, upper];
};

const toTestIdFragment = (value: string): string => (
    value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
);

const getBucketConfidenceClasses = (confidence?: {
    isLowConfidence: boolean;
    hasMissingSegments: boolean;
}) => {
    if (confidence?.hasMissingSegments) {
        return 'border-orange-200 bg-orange-50 text-orange-800';
    }
    if (confidence?.isLowConfidence) {
        return 'border-amber-200 bg-amber-50 text-amber-800';
    }
    return 'border-gray-200 bg-white text-gray-800';
};

type BucketSegmentCell = {
    segmentName: string;
    value: number | null;
    weightedSum: number;
    matchedDetails: number;
    totalWeight: number;
};

const getBucketColumnTone = (
    bucket: TripBucketAnalysis,
    confidence?: {
        isLowConfidence: boolean;
        hasMissingSegments: boolean;
    }
): string => {
    if (bucket.ignored) return 'bg-gray-50 text-gray-400';
    if (confidence?.hasMissingSegments) return 'bg-orange-50 text-orange-800';
    if (confidence?.isLowConfidence) return 'bg-amber-50 text-amber-800';
    return 'bg-white text-gray-700';
};

const renderPartialRouteBarLabel = (props: {
    x?: number;
    y?: number;
    width?: number;
    value?: string;
}) => {
    const { x, y, width, value } = props;
    if (!value || typeof x !== 'number' || typeof y !== 'number' || typeof width !== 'number') {
        return null;
    }

    const labelWidth = 42;
    const labelHeight = 16;
    const labelX = x + (width / 2) - (labelWidth / 2);
    const labelY = Math.max(0, y - labelHeight - 4);

    return (
        <g>
            <rect
                x={labelX}
                y={labelY}
                width={labelWidth}
                height={labelHeight}
                rx={8}
                fill="#FFF7ED"
                stroke="#FB923C"
            />
            <text
                x={labelX + (labelWidth / 2)}
                y={labelY + 11}
                textAnchor="middle"
                fill="#C2410C"
                fontSize={9}
                fontWeight={700}
            >
                Partial
            </text>
        </g>
    );
};

// Segment Breakdown Matrix - Shows runtime data summarized by TIME BAND
const SegmentBreakdownMatrix: React.FC<{
    analysis: TripBucketAnalysis[];
    bands: TimeBand[];
    viewMetric: 'p50' | 'p80';
    segmentColumns: OrderedSegmentColumn[];
}> = ({ analysis, bands, viewMetric, segmentColumns }) => {
    const segmentNames = useMemo(
        () => segmentColumns.map(column => column.segmentName),
        [segmentColumns]
    );
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
    const metricLabel = viewMetric === 'p50' ? 'median (P50)' : 'reliable (P80)';
    const bandRangeLabel = 'P50 range';

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
                    Segment cells show weighted {metricLabel} summaries. Band Avg shows the evidence-backed average {metricLabel} cycle total.
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
                                Band Avg
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
                            const actualBandAverage = getAverageBandTotal(data);

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
                                                <div>{bandRangeLabel}</div>
                                            </div>
                                        </div>
                                    </td>
                                    <td className="px-4 py-3">
                                        <div className="flex flex-wrap gap-1 max-w-[200px]">
                                            {[...data.timeSlots].sort().map((slot, idx) => (
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
                                        <div>{actualBandAverage !== null ? actualBandAverage.toFixed(1) : '-'}</div>
                                        <div className="text-[11px] font-medium uppercase tracking-wide text-gray-500">
                                            evidence avg
                                        </div>
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

const StopToStopMatrix: React.FC<{
    analysis: TripBucketAnalysis[];
    bands: TimeBand[];
    viewMetric: 'p50' | 'p80';
    segmentColumns: OrderedSegmentColumn[];
    bucketConfidence: Record<string, Step2BucketConfidence>;
    title?: string;
    description?: string;
    badges?: string[];
}> = ({
    analysis,
    bands,
    viewMetric,
    segmentColumns,
    bucketConfidence,
    title = 'Stop-to-Stop by 30-Minute Bucket',
    description,
    badges = ['Full route only', 'Partial / short turns removed'],
}) => {
    const segmentNames = useMemo(
        () => segmentColumns.map(column => column.segmentName),
        [segmentColumns]
    );
    const segmentLookup = useMemo(
        () => buildNormalizedSegmentNameLookup(segmentNames),
        [segmentNames]
    );
    const segmentIndexesByName = useMemo(() => {
        const indexes = new Map<string, number[]>();
        segmentColumns.forEach((column, index) => {
            const existing = indexes.get(column.segmentName);
            if (existing) {
                existing.push(index);
            } else {
                indexes.set(column.segmentName, [index]);
            }
        });
        return indexes;
    }, [segmentColumns]);
    const bandLookup = useMemo(() => new Map(bands.map(band => [band.id, band])), [bands]);
    const bucketTotals = useMemo(() => analysis.map((bucket) => ({
        bucket,
        total: getBucketDisplayedTotal(bucket, viewMetric),
        confidence: bucketConfidence[bucket.timeBucket],
    })), [analysis, bucketConfidence, viewMetric]);

    const bucketRows = useMemo(() => {
        return analysis.map((bucket) => {
            const confidence = bucketConfidence[bucket.timeBucket];
            const cells = segmentColumns.map<BucketSegmentCell>((column) => ({
                segmentName: column.segmentName,
                value: null,
                weightedSum: 0,
                matchedDetails: 0,
                totalWeight: 0,
            }));

            bucket.details?.forEach((detail) => {
                const canonicalSegmentName = resolveCanonicalSegmentName(detail.segmentName, segmentLookup);
                if (!canonicalSegmentName) return;

                const matchingIndexes = segmentIndexesByName.get(canonicalSegmentName);
                if (!matchingIndexes) return;

                const weight = detail.n && detail.n > 0 ? detail.n : 1;
                const value = viewMetric === 'p50' ? detail.p50 : detail.p80;
                matchingIndexes.forEach((index) => {
                    const cell = cells[index];
                    cell.weightedSum += value * weight;
                    cell.totalWeight += weight;
                    cell.matchedDetails += 1;
                    cell.value = cell.weightedSum / cell.totalWeight;
                });
            });

            return {
                bucket,
                confidence,
                cells,
            };
        });
    }, [analysis, bucketConfidence, segmentColumns, segmentIndexesByName, segmentLookup, viewMetric]);
    const segmentRows = useMemo(() => (
        segmentColumns.map((column, rowIndex) => {
            const sectionKey = getMatrixSectionKey(column);
            const previousSectionKey = rowIndex > 0 ? getMatrixSectionKey(segmentColumns[rowIndex - 1]) : null;
            return {
                column,
                rowIndex,
                sectionKey,
                sectionDescription: getMatrixSectionDescription(column),
                showSectionHeader: rowIndex === 0 || sectionKey !== previousSectionKey,
            };
        })
    ), [segmentColumns]);

    if (segmentColumns.length === 0 || analysis.length === 0) {
        return (
            <div className="bg-white rounded-xl border border-gray-200 p-6 text-center text-gray-400">
                No segment data available
            </div>
        );
    }

    return (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
            <div className="p-4 border-b border-gray-200 bg-gray-50 flex justify-between items-center gap-4">
                <div>
                    <div className="flex items-center gap-2">
                        <Table size={18} className="text-gray-500" />
                        <h3 className="font-bold text-gray-900">{title}</h3>
                    </div>
                    <p className="mt-1 text-xs text-gray-500">
                        {description ?? (
                            <>
                                Each cell shows the selected {viewMetric === 'p50' ? 'median (P50)' : 'reliable (P80)'} travel time for that route segment in that 30-minute bucket.
                                Rows follow the approved planning route chain in bus order.
                            </>
                        )}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                        {badges.map((badge, index) => (
                            <span
                                key={badge}
                                className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${
                                    index === 0
                                        ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                                        : 'border-sky-200 bg-sky-50 text-sky-700'
                                }`}
                            >
                                {badge}
                            </span>
                        ))}
                    </div>
                </div>
                <span className="text-xs text-gray-500">
                    Scroll sideways to review all time buckets. Orange or amber marks missing or low-confidence data.
                </span>
            </div>
            <div className="relative overflow-x-auto">
                <div className="pointer-events-none absolute right-0 top-0 z-30 h-full w-8 bg-gradient-to-l from-white to-transparent" />
                <table className="w-full text-sm">
                    <thead>
                        <tr className="bg-gray-100 border-b border-gray-200">
                            <th className="sticky left-0 top-0 z-30 min-w-[220px] bg-gray-100 px-4 py-3 text-left font-bold text-gray-700 shadow-[6px_0_10px_-10px_rgba(15,23,42,0.8)]">
                                Stop-to-stop segment
                            </th>
                            {bucketRows.map(({ bucket, confidence }) => {
                                const band = bucket.assignedBand ? bandLookup.get(bucket.assignedBand) : undefined;
                                const startLabel = getBucketStartLabel(bucket.timeBucket);
                                return (
                                    <th
                                        key={bucket.timeBucket}
                                        className="sticky top-0 z-20 min-w-[96px] bg-gray-100 px-3 py-3 text-center font-medium text-gray-600 align-bottom"
                                        title={bucket.timeBucket}
                                    >
                                        <div className="flex flex-col items-center gap-1">
                                            <span className="text-xs font-semibold text-gray-700">{startLabel}</span>
                                            <div className="flex items-center gap-1">
                                                {band && (
                                                    <span
                                                        className="h-2.5 w-2.5 rounded-full"
                                                        style={{ backgroundColor: band.color }}
                                                        title={`Band ${band.id}`}
                                                    />
                                                )}
                                                {confidence?.isLowConfidence && (
                                                    <span className={`rounded-full border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide ${getBucketConfidenceClasses(confidence)}`}>
                                                        {confidence.planningEligible === false ? 'Not scheduling' : 'Low'}
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                    </th>
                                );
                            })}
                        </tr>
                        <tr className="border-b border-gray-200 bg-blue-50/60">
                            <th className="sticky left-0 top-[56px] z-30 bg-blue-50 px-4 py-3 text-left font-bold text-blue-900 shadow-[6px_0_10px_-10px_rgba(15,23,42,0.8)]">
                                Bucket total
                            </th>
                            {bucketTotals.map(({ bucket, total, confidence }) => {
                                const band = bucket.assignedBand ? bandLookup.get(bucket.assignedBand) : undefined;
                                return (
                                    <th
                                        key={`${bucket.timeBucket}-total`}
                                        className="sticky top-[56px] z-20 bg-blue-50 px-3 py-3 text-center align-middle"
                                        title={`Total ${bucket.timeBucket}`}
                                    >
                                        <div className={`rounded-lg border px-2 py-2 ${getBucketConfidenceClasses(confidence)}`}>
                                            <div className="font-semibold text-gray-800">
                                                {formatBucketTotal(total)}
                                            </div>
                                            <div className="mt-0.5 text-[10px] text-gray-500">
                                                {band ? `Band ${band.id}` : 'No band'}
                                            </div>
                                        </div>
                                    </th>
                                );
                            })}
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                        {segmentRows.map(({ column, rowIndex, sectionKey, sectionDescription, showSectionHeader }) => {
                            const rowHeader = renderSegmentHeader(column.segmentName);
                            const rowTone = rowIndex % 2 === 0 ? 'bg-white' : 'bg-gray-50/40';
                            return (
                                <React.Fragment key={column.segmentName}>
                                    {showSectionHeader && (
                                        <tr
                                            data-testid={`step2-matrix-section-${toTestIdFragment(sectionKey)}`}
                                            className="border-y border-sky-100 bg-sky-50/70"
                                        >
                                            <td colSpan={bucketRows.length + 1} className="px-4 py-2">
                                                <div className="flex items-center gap-3">
                                                    <span className="rounded-full bg-sky-600 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-white">
                                                        {sectionKey}
                                                    </span>
                                                    <span className="text-xs font-medium text-sky-900">
                                                        {sectionDescription}
                                                    </span>
                                                </div>
                                            </td>
                                        </tr>
                                    )}
                                    <tr className={rowTone}>
                                        <td className={`sticky left-0 z-10 px-4 py-3 shadow-[6px_0_10px_-10px_rgba(15,23,42,0.8)] ${rowTone}`}>
                                            <div className="flex items-center gap-3 min-w-[220px]">
                                                <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-brand-blue/10 text-xs font-bold text-brand-blue">
                                                    {rowIndex + 1}
                                                </span>
                                                <div className="min-w-0">
                                                    {rowHeader}
                                                </div>
                                            </div>
                                        </td>
                                        {bucketRows.map(({ bucket, confidence, cells }) => {
                                            const cell = cells[rowIndex];
                                            const band = bucket.assignedBand ? bandLookup.get(bucket.assignedBand) : undefined;
                                            const tone = getBucketColumnTone(bucket, confidence);
                                            const hasValue = cell.value !== null;
                                            const isMissing = !hasValue || confidence?.hasMissingSegments;
                                            const borderColor = band?.color ?? (confidence?.hasMissingSegments ? '#fb923c' : confidence?.isLowConfidence ? '#f59e0b' : '#e5e7eb');
                                            return (
                                                <td
                                                    key={`${bucket.timeBucket}-${column.segmentName}`}
                                                    data-testid={`step2-matrix-cell-${toTestIdFragment(bucket.timeBucket)}-${toTestIdFragment(column.segmentName)}`}
                                                    className={`px-2 py-2 text-center font-mono ${tone} ${bucket.ignored ? 'opacity-60' : ''}`}
                                                    style={{
                                                        borderLeft: `3px solid ${borderColor}`,
                                                    }}
                                                >
                                                    <div
                                                        className={`rounded-lg border px-2 py-2 transition-colors ${
                                                            isMissing
                                                                ? 'border-dashed'
                                                                : 'border-solid'
                                                        } ${getBucketConfidenceClasses(confidence)}`}
                                                    >
                                                        {hasValue ? (
                                                            <>
                                                                <div className="font-semibold text-gray-800">
                                                                    {Math.round(cell.value as number)}
                                                                </div>
                                                                <div className="mt-0.5 text-[10px] text-gray-500">
                                                                    n={cell.totalWeight}
                                                                </div>
                                                            </>
                                                        ) : (
                                                            <>
                                                                <div className="font-semibold text-gray-400">—</div>
                                                                <div className="mt-0.5 text-[10px] text-gray-400">
                                                                    {confidence?.hasMissingSegments ? 'missing' : 'no data'}
                                                                </div>
                                                            </>
                                                        )}
                                                    </div>
                                                </td>
                                            );
                                        })}
                                    </tr>
                                </React.Fragment>
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
    matrixAnalysis?: TripBucketAnalysis[];
    matrixSegmentsMap?: Record<string, SegmentRawData[]>;
    canonicalSegmentColumns?: OrderedSegmentColumn[];
    canonicalDirectionStops?: Partial<Record<'North' | 'South' | 'Loop', string[]>>;
    healthReport?: Step2DataHealthReport | null;
    approvedRuntimeModel?: ApprovedRuntimeModel | null;
    approvalState?: Step2ApprovalState;
    approvedRuntimeContract?: ApprovedRuntimeContract | null;
    onApproveRuntimeContract?: (acknowledgedWarnings: string[]) => void;
    warningAcknowledged?: boolean;
    onWarningAcknowledgedChange?: (value: boolean) => void;
    troubleshootingPatternWarning?: string | null;
    onBandSummaryChange?: (summary: DirectionBandSummary) => void;
}

export const Step2PlanningReviewPanel: React.FC<Step2Props> = ({
    dayType,
    routeNumber,
    analysis,
    bands,
    setAnalysis,
    segmentsMap,
    matrixAnalysis,
    matrixSegmentsMap,
    canonicalSegmentColumns,
    canonicalDirectionStops,
    healthReport,
    approvedRuntimeModel,
    approvalState,
    approvedRuntimeContract,
    onApproveRuntimeContract,
    warningAcknowledged,
    troubleshootingPatternWarning,
    onBandSummaryChange,
}) => {
    const {
        viewMetric,
        setViewMetric,
        expandedBuckets,
        toggleExpand,
        displaySegmentColumns,
        matrixSourceAnalysis,
        matrixDisplaySegmentColumns,
        orderedSegmentIndex,
        sampleCountMode,
        confidenceThreshold,
        sampleCountUnitLabel,
        sampleCountPluralLabel,
        metricLabel,
        metricShortLabel,
        showDataHealth,
        setShowDataHealth,
        showApprovedRuntimeModel,
        setShowApprovedRuntimeModel,
        displayedHealthReport,
        displayedApprovedRuntimeModel,
        resolvedApprovalState,
        approvalRequiresAcknowledgement,
        approvalWarningList,
        approvalActionDisabled,
        approvedAtLabel,
        bandContextLabel,
        bucketConfidence,
        matrixBucketConfidence,
        displayedBandTotals,
        chartData,
        toggleIgnore,
    } = useStep2RuntimeReview({
        dayType,
        routeNumber,
        analysis,
        bands,
        setAnalysis,
        segmentsMap,
        matrixAnalysis,
        matrixSegmentsMap,
        canonicalSegmentColumns,
        canonicalDirectionStops,
        healthReport,
        approvedRuntimeModel,
        approvalState,
        approvedRuntimeContract,
        warningAcknowledged: warningAcknowledged ?? false,
        onBandSummaryChange,
    });
    const runtimeAxisDomain = useMemo(
        () => buildRuntimeAxisDomain(chartData),
        [chartData]
    );
    const runtimeAxisIsZoomed = runtimeAxisDomain[0] > 0;
    const partialRouteChartBuckets = useMemo(
        () => chartData.filter(entry => entry.isPartialRouteBucket),
        [chartData]
    );
    const partialRouteBucketLabels = partialRouteChartBuckets
        .map(entry => entry.name)
        .slice(0, 8)
        .join(', ');
    const hiddenPartialRouteBucketCount = Math.max(0, partialRouteChartBuckets.length - 8);

    return (
        <div className="space-y-6 pb-28 animate-in fade-in duration-500">
            <Step2RuntimeReviewHeader
                hasGroupedSegmentColumns={displaySegmentColumns.some(column => column.groupLabel)}
                viewMetric={viewMetric}
                onViewMetricChange={setViewMetric}
            />

            <Step2ReadinessPanel
                healthReport={displayedHealthReport}
                showDataHealth={showDataHealth}
                onToggleShowDataHealth={() => setShowDataHealth((value) => !value)}
            />

            {displayedApprovedRuntimeModel && (
                <Step2ApprovedRuntimeModelPanel
                    model={displayedApprovedRuntimeModel}
                    isExpanded={showApprovedRuntimeModel}
                    onToggleExpanded={() => setShowApprovedRuntimeModel((value) => !value)}
                />
            )}

            {/* Main Chart Card */}
            <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm">
                <div className="flex items-center gap-2 mb-4">
                    <BarChart2 className="text-gray-400" size={20} />
                    <h3 className="font-bold text-gray-700 uppercase text-sm tracking-wider">
                        {viewMetric === 'p50' ? 'Median Cycle Time (50%)' : 'Reliable Cycle Time (80%)'}
                    </h3>
                </div>
                <p className="mb-4 text-xs text-gray-500">
                    Bars show evidence-backed {metricLabel} bucket totals. {bandContextLabel}
                    {partialRouteChartBuckets.length > 0 && (
                        <span className="mt-1 block font-semibold text-orange-700">
                            Partial-route buckets are tagged on the chart and excluded from banding until the full route is observed.
                        </span>
                    )}
                    {runtimeAxisIsZoomed && (
                        <span className="mt-1 block font-semibold text-slate-600">
                            The runtime scale is zoomed from {runtimeAxisDomain[0]} min to make band-to-band variation easier to compare.
                        </span>
                    )}
                </p>

                <div className="h-[280px] w-full xl:h-[320px]">
                    <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={chartData} margin={{ top: 36, right: 30, left: 20, bottom: 5 }}>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" />
                            <XAxis
                                dataKey="name"
                                tick={{ fill: '#6B7280', fontSize: 12 }}
                                axisLine={false}
                                tickLine={false}
                            />
                            <YAxis
                                domain={runtimeAxisDomain}
                                tick={{ fill: '#6B7280', fontSize: 12 }}
                                axisLine={false}
                                tickLine={false}
                                tickFormatter={(value) => `${value}m`}
                                label={{ value: runtimeAxisIsZoomed ? 'Runtime (min, zoomed)' : 'Runtime (min)', angle: -90, position: 'insideLeft', fill: '#9CA3AF' }}
                                allowDataOverflow
                            />
                            <Tooltip
                                cursor={{ fill: '#F3F4F6' }}
                                content={({ active, payload }) => {
                                    if (active && payload && payload.length) {
                                        const data = payload[0].payload;
                                        const contributingDays = data.contributingDays as Array<{ date: string; runtime: number }> | undefined;
                                        return (
                                            <div className="bg-white p-3 border border-gray-200 shadow-lg rounded-lg">
                                                <p className="font-bold text-gray-900">{data.fullBucket}</p>
                                                {data.band && (
                                                    <div className="flex items-center gap-2 mt-1">
                                                        <div className="w-3 h-3 rounded-full" style={{ backgroundColor: data.color }} />
                                                        <span className="text-sm font-medium">
                                                            Band {data.band}{viewMetric === 'p80' ? ' (median-based)' : ''}
                                                        </span>
                                                    </div>
                                                )}
                                                {!data.band && data.confidence?.hasMissingSegments && (
                                                    <div className="mt-2 inline-flex items-center gap-1 rounded-full bg-orange-50 px-2 py-1 text-xs font-semibold text-orange-700">
                                                        <AlertTriangle size={12} />
                                                        Excluded from banding until full coverage
                                                    </div>
                                                )}
                                                <p className="text-2xl font-bold text-gray-800 mt-2">{data.runtime.toFixed(1)} <span className="text-sm font-normal text-gray-500">min</span></p>
                                                <p className="text-xs text-gray-400 font-bold uppercase mt-1">{metricShortLabel} Metric</p>
                                                {data.confidence && (
                                                    <div className="mt-3 space-y-1 text-xs text-gray-600">
                                                        <p>
                                                            Coverage: <span className="font-semibold text-gray-800">{data.confidence.matchedSegments}/{data.confidence.expectedSegments}</span> segments
                                                        </p>
                                                        {data.confidence.coverageCauseLabel && (
                                                            <p>
                                                                Coverage type: <span className="font-semibold text-gray-800">{data.confidence.coverageCauseLabel}</span>
                                                            </p>
                                                        )}
                                                        <p>
                                                            Min samples: <span className="font-semibold text-gray-800">{data.confidence.minSegmentSamples}</span>
                                                            {' '}• Avg samples: <span className="font-semibold text-gray-800">{data.confidence.avgSegmentSamples.toFixed(1)}</span>
                                                        </p>
                                                        {data.confidence.isEstimatedRepair && (
                                                            <div className="inline-flex items-center gap-1 rounded-full bg-sky-50 px-2 py-1 text-sky-700 font-semibold">
                                                                <CheckCircle2 size={12} />
                                                                Estimated repair from {data.confidence.repairSourceBuckets?.join(' & ')}
                                                            </div>
                                                        )}
                                                        {data.confidence.isLowConfidence && (
                                                            <div className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-1 text-amber-700 font-semibold">
                                                                <AlertTriangle size={12} />
                                                                {data.confidence.qualifyingCount !== undefined && data.confidence.requiredCount !== undefined
                                                                    ? `${data.confidence.qualifyingCount} of ${data.confidence.requiredCount} required ${sampleCountMode === 'days' ? 'days' : 'observations'}`
                                                                    : data.confidence.hasMissingSegments
                                                                    ? data.confidence.coverageCauseLabel
                                                                        ? `${data.confidence.coverageCauseLabel} (${data.confidence.missingSegments} segment${data.confidence.missingSegments === 1 ? '' : 's'} missing)`
                                                                        : `Incomplete coverage (${data.confidence.missingSegments} segment${data.confidence.missingSegments === 1 ? '' : 's'} missing)`
                                                                    : `Low ${sampleCountMode === 'days' ? 'day' : 'sample'} bucket (< ${confidenceThreshold} ${sampleCountPluralLabel})`}
                                                            </div>
                                                        )}
                                                        {data.confidence.exclusionReasons && data.confidence.exclusionReasons.length > 0 && (
                                                            <div className="text-amber-700">Not for scheduling: {data.confidence.exclusionReasons.join('; ')}</div>
                                                        )}
                                                    </div>
                                                )}
                                                {contributingDays && contributingDays.length > 0 && (
                                                    <div className="mt-3 rounded-lg border border-gray-200 bg-gray-50 p-2">
                                                        <p className="text-[10px] font-bold uppercase tracking-wide text-gray-500">
                                                            Last 10 parsed days
                                                        </p>
                                                        <div className="mt-2 space-y-1">
                                                            {contributingDays.map((day) => (
                                                                <div key={day.date} className="flex items-center justify-between gap-3 text-xs text-gray-700">
                                                                    <span className="font-medium text-gray-600">
                                                                        {formatContributionDate(day.date)}
                                                                    </span>
                                                                    <span className="font-mono font-semibold text-gray-900">
                                                                        {formatContributionRuntime(day.runtime)}
                                                                    </span>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    </div>
                                                )}
                                                {data.ignored && (
                                                    <span className="text-xs bg-red-100 text-red-600 px-2 py-1 rounded-full mt-2 inline-block">
                                                        {data.isOutlier ? 'Ignored outlier' : 'Ignored'}
                                                    </span>
                                                )}
                                            </div>
                                        );
                                    }
                                    return null;
                                }}
                            />
                            <Bar dataKey="runtime" radius={[4, 4, 0, 0]}>
                                <LabelList dataKey="partialRouteLabel" content={renderPartialRouteBarLabel} />
                                {chartData.map((entry, index) => (
                                    <Cell
                                        key={`cell-${index}`}
                                        fill={entry.ignored ? '#E5E7EB' : entry.isPartialRouteBucket ? '#FFF7ED' : entry.color}
                                        fillOpacity={entry.ignored ? 1 : entry.isPartialRouteBucket ? 1 : entry.confidence?.isLowConfidence ? 0.45 : 1}
                                        stroke={entry.ignored ? '#9CA3AF' : entry.isPartialRouteBucket ? '#F97316' : entry.confidence?.isLowConfidence ? '#F59E0B' : 'none'}
                                        strokeWidth={entry.confidence?.isLowConfidence ? 2 : 0}
                                        strokeDasharray={entry.ignored || entry.isPartialRouteBucket ? '4 4' : 'none'}
                                        cursor="pointer"
                                        onClick={() => toggleIgnore(entry.fullBucket)}
                                    />
                                ))}
                            </Bar>
                        </BarChart>
                    </ResponsiveContainer>
                </div>
                {partialRouteChartBuckets.length > 0 && (
                    <div
                        data-testid="step2-partial-route-bucket-callout"
                        className="mt-3 rounded-xl border border-orange-200 bg-orange-50 px-4 py-3 text-sm text-orange-900"
                    >
                        <div className="flex items-start gap-2">
                            <AlertTriangle size={16} className="mt-0.5 shrink-0 text-orange-700" />
                            <div>
                                <div className="font-bold">Partial route buckets shown: {partialRouteBucketLabels}{hiddenPartialRouteBucketCount > 0 ? ` +${hiddenPartialRouteBucketCount} more` : ''}</div>
                                <p className="mt-1 text-xs text-orange-800">
                                    These buckets have only part of the route observed, so they stay visible for review but remain unbanded and excluded from planning bands. This marker appears in both Median and P80 views.
                                </p>
                            </div>
                        </div>
                    </div>
                )}
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
                                The chart shows the observed cycle total for each 30-minute bucket.
                                The matrix below summarizes those buckets into broader time bands using weighted segment summaries.
                                Its <strong>Band Avg</strong> column and the legend show the evidence-backed average bucket total for that band.
                                Buckets with thin data or missing segment coverage are dimmed and outlined.
                                Buckets missing one or more segments remain visible, but do not contribute to band calculations until coverage is complete.
                                Bands (A-E) are calculated from the <strong>50th Percentile</strong> (median) cycle totals.
                                {sampleCountMode === 'days'
                                    ? `Performance-derived runtimes use a ${confidenceThreshold}-day confidence floor.`
                                    : sampleCountMode
                                        ? `CSV imports use a ${confidenceThreshold}-sample confidence floor.`
                                        : 'CSV imports do not include raw sample counts, so low confidence only reflects missing segment coverage.'}
                            </p>
                            <p className="text-sm text-blue-700 mt-2">
                                {viewMetric === 'p80'
                                    ? 'P80 mode keeps the same median-based bands, but swaps the displayed runtimes to reliable (P80) values. '
                                    : ''}
                                Step 3 and Step 4 use the runtime contract preview shown above, so the schedule stays tied to this reviewed analysis.
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
                                {displayedBandTotals.has(band.id)
                                    ? `Band ${band.id} (${displayedBandTotals.get(band.id)!.toFixed(1)}m evidence avg)`
                                    : `Band ${band.id} (no active buckets)`}
                            </span>
                        </div>
                    ))}
                    {/* Additional Legend Items */}
                    <div className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-full border border-gray-300 border-dashed bg-gray-50" />
                        <span className="text-xs font-bold text-gray-700">Ignored / auto-ignored outlier</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-full border-2 border-amber-400 bg-amber-100/60" />
                        <span className="text-xs font-bold text-gray-700">Low confidence / incomplete</span>
                    </div>
                </div>
            </div>

            <Step2TravelViewsPanel
                troubleshootingPatternWarning={troubleshootingPatternWarning}
                bucketMatrixView={(
                    <StopToStopMatrix
                        analysis={analysis}
                        bands={bands}
                        viewMetric={viewMetric}
                        segmentColumns={displaySegmentColumns}
                        bucketConfidence={bucketConfidence}
                        title="Planning Segments by 30-Minute Bucket"
                        badges={['Planning route chain', 'Schedule-build input']}
                    />
                )}
                bandSummaryView={(
                    <SegmentBreakdownMatrix
                        analysis={analysis}
                        bands={bands}
                        viewMetric={viewMetric}
                        segmentColumns={displaySegmentColumns}
                    />
                )}
                troubleshootingView={(
                    <StopToStopMatrix
                        analysis={matrixSourceAnalysis}
                        bands={bands}
                        viewMetric={viewMetric}
                        segmentColumns={matrixDisplaySegmentColumns}
                        bucketConfidence={matrixBucketConfidence}
                        title="Diagnostic Stop-to-Stop by 30-Minute Bucket"
                        description={`Each cell shows the selected ${viewMetric === 'p50' ? 'median (P50)' : 'reliable (P80)'} travel time for that stop pair in that 30-minute bucket. Rows follow the dominant full-route stop chain in bus order, with partial and short-turn patterns removed.`}
                    />
                )}
            />

            {/* Detailed Breakdown Table */}
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                <div className="p-4 border-b border-gray-200 bg-gray-50 flex justify-between items-center">
                    <h3 className="font-bold text-gray-900">Detailed Breakdown</h3>
                    <p className="text-xs text-gray-500">Click rows to view cycle segment details</p>
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full text-sm text-left">
                        <thead className="text-xs text-gray-500 uppercase bg-gray-50 border-b border-gray-200">
                            <tr>
                                <th className="px-6 py-3 w-12"></th>
                                <th className="px-6 py-3">Time Bucket</th>
                                <th className="px-6 py-3 text-right">Cycle P50 (Median)</th>
                                <th className="px-6 py-3 text-right">Cycle P80 (Reliable)</th>
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
                                            {getBucketDisplayedTotal(row, 'p50').toFixed(2)} min
                                        </td>
                                        <td className="px-6 py-4 text-right font-mono text-gray-600">
                                            {getBucketDisplayedTotal(row, 'p80').toFixed(2)} min
                                        </td>
                                        <td className="px-6 py-4 text-center">
                                            {row.assignedBand ? (
                                                <span
                                                    className="px-2 py-1 rounded text-xs font-bold text-white shadow-sm"
                                                    style={{ backgroundColor: bands.find(b => b.id === row.assignedBand)?.color }}
                                                >
                                                    {row.assignedBand}
                                                </span>
                                            ) : confidence?.planningEligible === false ? (
                                                <span className="rounded-full bg-orange-50 px-2 py-1 text-[11px] font-semibold text-orange-700">
                                                    Unbanded
                                                </span>
                                            ) : null}
                                        </td>
                                        <td className="px-6 py-4 text-center">
                                                    {confidence?.isLowConfidence ? (
                                                <div className="inline-flex flex-wrap items-center justify-center gap-1">
                                                    {confidence.isEstimatedRepair && (
                                                        <span className="rounded-full bg-sky-50 px-2 py-1 text-[11px] font-semibold text-sky-700">
                                                            Estimated repair
                                                        </span>
                                                    )}
                                                    {confidence.hasLowSamples && (
                                                        <span className="rounded-full bg-amber-50 px-2 py-1 text-[11px] font-semibold text-amber-700">
                                                            Min {sampleCountUnitLabel}s {confidence.minSegmentSamples}
                                                        </span>
                                                    )}
                                                    {confidence.hasMissingSegments && (
                                                        <span className="rounded-full bg-orange-50 px-2 py-1 text-[11px] font-semibold text-orange-700">
                                                            {confidence.coverageCauseLabel
                                                                ? `${confidence.coverageCauseLabel} • ${confidence.missingSegments} missing`
                                                                : `${confidence.missingSegments} segment${confidence.missingSegments === 1 ? '' : 's'} missing`}
                                                        </span>
                                                    )}
                                                    {!confidence.hasLowSamples && !confidence.hasMissingSegments && !confidence.isEstimatedRepair && (
                                                        <span className="rounded-full bg-amber-50 px-2 py-1 text-[11px] font-semibold text-amber-700">
                                                            Evidence not eligible
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
                                            <div className="inline-flex flex-col items-center gap-1">
                                                {confidence?.planningEligible === false && (
                                                    <span
                                                        className="rounded-full bg-rose-50 px-2 py-1 text-[11px] font-semibold text-rose-700"
                                                        title={confidence.exclusionReasons?.join('; ')}
                                                    >
                                                        Not for scheduling
                                                    </span>
                                                )}
                                                <button
                                                    onClick={(e) => { e.stopPropagation(); toggleIgnore(row.timeBucket); }}
                                                    disabled={row.ignored && confidence?.planningEligible === false}
                                                    className={`p-1 rounded hover:bg-gray-200 transition-colors ${row.ignored ? 'text-gray-400' : 'text-blue-600'} disabled:cursor-not-allowed disabled:opacity-50`}
                                                    title={row.ignored && confidence?.planningEligible === false ? 'Weak or estimated evidence cannot be restored for scheduling' : row.ignored ? 'Include in analysis' : 'Ignore from analysis'}
                                                >
                                                    {row.ignored ? <EyeOff size={16} /> : <Eye size={16} />}
                                                </button>
                                            </div>
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

