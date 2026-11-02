import React, { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { TimeBand, TripBucketAnalysis } from '../../utils/ai/runtimeAnalysis';
import {
    buildBandedRuntimeSpread,
    buildBarDomain,
    buildGuidedBandSummary,
    buildGuidedBucketRows,
    toggleGuidedBucket,
    type GuidedBucketRow,
} from './runtimeReview/guidedBandView';
import type { CycleStartDirection } from './runtimeReview/guidedRuntimeReviewTypes';

interface GuidedStep2ReviewProps {
    dayType: string;
    analysis: TripBucketAnalysis[];
    bands: TimeBand[];
    onAnalysisChange: (updated: TripBucketAnalysis[]) => void;
    orientationCounts?: Partial<Record<CycleStartDirection, number>>;
    selectedDirection: CycleStartDirection;
    onDirectionChange: (direction: CycleStartDirection) => void;
    /** The full legacy review (segment matrix, data health), shown on demand. */
    detail?: React.ReactNode;
}

const BandBadge: React.FC<{ band: string | null; color: string | null; inferred?: boolean }> = ({ band, color, inferred }) => (
    band
        ? (
            <span
                className={`inline-block w-6 rounded-md text-center text-xs font-bold text-white ${inferred ? 'opacity-40 outline-dashed outline-1 outline-offset-1 outline-gray-400' : ''}`}
                style={{ backgroundColor: color ?? undefined }}
            >
                {band}
            </span>
        )
        : <span className="text-gray-400">—</span>
);

/** The schedule's segment sum runs 2+ min under the median real round trip. */
const isUnderObserved = (row: GuidedBucketRow): boolean => (
    row.observedCycleMinutes !== null && row.minutes > 0 && row.observedCycleMinutes - row.minutes >= 2
);

/** Diagonal stripes mark a bar whose runtime is borrowed from the nearest banded bucket. */
const inferredStripes = (color: string): string => (
    `repeating-linear-gradient(135deg, ${color} 0 4px, transparent 4px 7px)`
);

const describeRow = (row: GuidedBucketRow): string => {
    if (row.band) return `${row.label} · ${row.minutes} min (P80 ${row.p80Minutes}) · band ${row.band}`;
    const status = row.ignored ? 'excluded' : 'no band';
    return row.inferredFrom
        ? `${row.label} · ${status} · trips starting here use ${row.inferredFrom.label} (${row.inferredFrom.minutes} min, band ${row.inferredFrom.band})`
        : `${row.label} · ${status} · no banded bucket to borrow from`;
};

/**
 * Step 2 review: 30-minute buckets coloured by their A–E band, a band
 * summary, and the bucket evidence table with Exclude / Restore. Display
 * only; banding comes from the existing runtime analysis.
 */
export const GuidedStep2Review: React.FC<GuidedStep2ReviewProps> = ({
    dayType,
    analysis,
    bands,
    onAnalysisChange,
    orientationCounts,
    selectedDirection,
    onDirectionChange,
    detail,
}) => {
    const [showDetail, setShowDetail] = useState(false);
    const rows = useMemo(() => buildGuidedBucketRows(analysis, bands), [analysis, bands]);
    const summary = useMemo(() => buildGuidedBandSummary(bands), [bands]);
    const [low, high] = buildBarDomain(rows);
    const spread = useMemo(() => buildBandedRuntimeSpread(rows), [rows]);
    const toggle = (timeBucket: string) => onAnalysisChange(toggleGuidedBucket(analysis, timeBucket));
    const axisLabels = rows.length > 0
        ? [0, 0.25, 0.5, 0.75, 1].map(fraction => rows[Math.min(rows.length - 1, Math.round(fraction * (rows.length - 1)))].label.split('–')[0])
        : [];

    return (
        <div className="space-y-4">
            <div>
                <h2 className="text-lg font-bold text-gray-900">Review time bands · {dayType}</h2>
                <p className="text-sm text-gray-500">Each bar is a 30-minute bucket. Its height is the median (P50) round-trip runtime the schedule will use. Its colour shows which A–E band it falls in. Exclude buckets you don't trust, then approve.</p>
            </div>

            <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
                <section className="rounded-xl border border-gray-200 p-4" aria-label="Buckets and bands">
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                        <h3 className="text-sm font-bold text-gray-900">30-minute buckets → A–E bands</h3>
                        <div className="inline-flex rounded-lg border border-gray-200 bg-gray-50 p-0.5" role="tablist" aria-label="Cycle start orientation">
                            {(['North', 'South'] as const).map(direction => {
                                const count = orientationCounts?.[direction] ?? 0;
                                return (
                                    <button
                                        key={direction}
                                        type="button"
                                        role="tab"
                                        aria-selected={selectedDirection === direction}
                                        disabled={count === 0}
                                        onClick={() => onDirectionChange(direction)}
                                        className={`rounded-md px-3 py-1 text-xs font-bold ${
                                            selectedDirection === direction ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-white disabled:cursor-not-allowed disabled:opacity-40'
                                        }`}
                                    >
                                        {direction}-start
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    <div className="flex h-40 items-end gap-[3px]" aria-label="Runtime by bucket">
                        {rows.map(row => {
                            // A bucket with no band is drawn at the runtime it borrows, in that band's colour.
                            const inferred = row.band ? null : row.inferredFrom;
                            const minutes = inferred ? inferred.minutes : row.minutes;
                            const height = minutes > 0 ? Math.max(6, ((minutes - low) / Math.max(1, high - low)) * 100) : 6;
                            const action = row.canRestore ? ` — click to ${row.ignored ? 'restore' : 'exclude'}` : '';
                            return (
                                <button
                                    key={row.timeBucket}
                                    type="button"
                                    onClick={() => toggle(row.timeBucket)}
                                    disabled={!row.canRestore}
                                    title={`${describeRow(row)}${action}`}
                                    aria-label={describeRow(row)}
                                    className="min-w-[6px] flex-1 rounded-t-sm transition hover:brightness-110 disabled:cursor-not-allowed"
                                    style={{
                                        height: `${Math.min(100, height)}%`,
                                        backgroundColor: inferred ? undefined : row.color ?? '#e5e7eb',
                                        backgroundImage: inferred?.color ? inferredStripes(inferred.color) : undefined,
                                        opacity: row.ignored || inferred ? 0.45 : 1,
                                        outline: row.ignored || inferred ? '1px dashed #9ca3af' : undefined,
                                    }}
                                />
                            );
                        })}
                    </div>
                    <div className="mt-1 flex justify-between text-[11px] text-gray-400">
                        {axisLabels.map((label, index) => <span key={`${label}-${index}`}>{label}</span>)}
                    </div>

                    <div className="mt-3 flex flex-wrap gap-3 text-xs text-gray-600">
                        {summary.map(band => (
                            <span key={band.id} className="flex items-center gap-1">
                                <BandBadge band={band.id} color={band.color} />
                                {band.id === 'A' ? 'slowest' : band.id === 'E' ? 'fastest' : ''}
                            </span>
                        ))}
                        <span>faded stripes = excluded; trips there use the nearest banded bucket</span>
                    </div>

                    <div className="mt-3 grid grid-cols-5 gap-2" aria-label="Band summary">
                        {summary.map(band => (
                            <div key={band.id} className="rounded-lg border border-gray-200 p-2 text-center">
                                <BandBadge band={band.id} color={band.color} />
                                <b className="block text-lg text-gray-900">{band.minutes ?? '—'}</b>
                                <small className="block text-[11px] text-gray-500">min · {band.bucketCount} bucket{band.bucketCount === 1 ? '' : 's'}</small>
                                {band.minMinutes !== null && band.maxMinutes !== null && band.minMinutes !== band.maxMinutes && (
                                    <small className="block text-[11px] text-gray-400">{band.minMinutes}–{band.maxMinutes}</small>
                                )}
                            </div>
                        ))}
                    </div>
                    <p className="mt-2 text-xs text-gray-500">
                        Bands group half-hours for review only. Each trip uses the runtime of its own half-hour, not the band average.
                        {spread !== null && spread <= 3 && (
                            <span className="font-semibold text-gray-700"> All banded half-hours are within {spread} min of each other, so the bands differ very little.</span>
                        )}
                    </p>
                </section>

                <section className="rounded-xl border border-gray-200 p-4" aria-label="Bucket evidence">
                    <h3 className="mb-2 text-sm font-bold text-gray-900">Bucket evidence</h3>
                    <div className="max-h-[22rem] overflow-auto">
                        <table className="w-full text-sm">
                            <thead className="sticky top-0 bg-white text-left text-[11px] uppercase tracking-wide text-gray-500">
                                <tr>
                                    <th className="py-1 font-semibold">Bucket</th>
                                    <th className="py-1 text-right font-semibold">Days</th>
                                    <th className="py-1 text-right font-semibold" title="Median runtime the schedule uses">P50</th>
                                    <th className="py-1 text-right font-semibold" title="8 in 10 observed cycles finish within this">P80</th>
                                    <th className="py-1 text-center font-semibold">Band</th>
                                    <th className="py-1" />
                                </tr>
                            </thead>
                            <tbody>
                                {rows.map(row => (
                                    <tr key={row.timeBucket} className={`border-t border-gray-100 ${row.ignored ? 'text-gray-400' : 'text-gray-800'}`}>
                                        <td className="py-1 font-mono text-xs">
                                            {row.label}
                                            {!row.band && row.inferredFrom && (
                                                <span className="block font-sans text-[11px] text-gray-500">
                                                    uses {row.inferredFrom.label} · {row.inferredFrom.minutes} min
                                                </span>
                                            )}
                                        </td>
                                        <td
                                            className={`py-1 text-right ${row.qualifyingDays !== null && row.requiredDays !== null && row.qualifyingDays < row.requiredDays ? 'font-semibold text-amber-700' : ''}`}
                                            title={row.reasons.join('; ') || undefined}
                                        >
                                            {row.qualifyingDays ?? '—'}
                                        </td>
                                        <td
                                            className={`py-1 text-right ${isUnderObserved(row) ? 'font-semibold text-amber-700' : ''}`}
                                            title={row.observedCycleMinutes !== null ? `Real same-day round trips: median ${row.observedCycleMinutes} min` : undefined}
                                        >
                                            {row.minutes || '—'}
                                        </td>
                                        <td className={`py-1 text-right ${row.p80Minutes - row.minutes >= 5 ? 'font-semibold text-amber-700' : 'text-gray-500'}`}>
                                            {row.p80Minutes || '—'}
                                        </td>
                                        <td className="py-1 text-center" title={row.band ? undefined : describeRow(row)}>
                                            {row.band || !row.inferredFrom
                                                ? <BandBadge band={row.band} color={row.color} />
                                                : <BandBadge band={row.inferredFrom.band} color={row.inferredFrom.color} inferred />}
                                        </td>
                                        <td className="py-1 text-right">
                                            <button
                                                type="button"
                                                onClick={() => toggle(row.timeBucket)}
                                                disabled={!row.canRestore}
                                                title={row.canRestore ? undefined : 'Weak or estimated evidence cannot be restored for scheduling'}
                                                className="text-xs font-semibold text-blue-700 hover:underline disabled:cursor-not-allowed disabled:text-gray-300 disabled:no-underline"
                                            >
                                                {row.ignored ? 'Restore' : 'Exclude'}
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                    <p className="mt-2 text-xs text-gray-500">
                        An approved bucket needs at least 5 days with a complete same-day paired cycle (locked rule 7). Buckets under 5 days start excluded. Days far from the rest of their own bucket (a detour or storm day) are dropped automatically; slow peak half-hours are kept.
                        An amber P50 means real same-day round trips took 2 or more minutes longer than the schedule's segment sum (hover for the real median). An amber P80 means 1 in 5 cycles runs 5 or more minutes over the median. Check that recovery time covers it.
                        A trip that starts in an excluded bucket uses the runtime of the nearest banded bucket (faded badge); when two are equally near, the earlier one.
                    </p>
                </section>
            </div>

            {detail && (
                <section className="rounded-xl border border-gray-200">
                    <button
                        type="button"
                        onClick={() => setShowDetail(value => !value)}
                        aria-expanded={showDetail}
                        className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm font-semibold text-gray-700 hover:bg-gray-50"
                    >
                        {showDetail ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                        Full detail: segment matrix, data health and approved model
                    </button>
                    {showDetail && <div className="border-t border-gray-200 p-4">{detail}</div>}
                </section>
            )}
        </div>
    );
};
