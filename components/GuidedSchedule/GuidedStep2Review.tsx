import React, { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { TimeBand, TripBucketAnalysis } from '../../utils/ai/runtimeAnalysis';
import { buildBarDomain, buildGuidedBandSummary, buildGuidedBucketRows, toggleGuidedBucket } from './runtimeReview/guidedBandView';
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

const BandBadge: React.FC<{ band: string | null; color: string | null }> = ({ band, color }) => (
    band
        ? <span className="inline-block w-6 rounded-md text-center text-xs font-bold text-white" style={{ backgroundColor: color ?? undefined }}>{band}</span>
        : <span className="text-gray-400">—</span>
);

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
    const toggle = (timeBucket: string) => onAnalysisChange(toggleGuidedBucket(analysis, timeBucket));
    const axisLabels = rows.length > 0
        ? [0, 0.25, 0.5, 0.75, 1].map(fraction => rows[Math.min(rows.length - 1, Math.round(fraction * (rows.length - 1)))].label.split('–')[0])
        : [];

    return (
        <div className="space-y-4">
            <div>
                <h2 className="text-lg font-bold text-gray-900">Review time bands · {dayType}</h2>
                <p className="text-sm text-gray-500">Each bar is a 30-minute bucket of observed runtime. Its colour shows which A–E band it falls in. Exclude buckets you don't trust, then approve.</p>
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
                            const height = row.minutes > 0 ? Math.max(6, ((row.minutes - low) / Math.max(1, high - low)) * 100) : 6;
                            return (
                                <button
                                    key={row.timeBucket}
                                    type="button"
                                    onClick={() => toggle(row.timeBucket)}
                                    disabled={!row.canRestore}
                                    title={`${row.label} · ${row.minutes} min · ${row.band ? `band ${row.band}` : 'excluded'} — click to ${row.ignored ? 'restore' : 'exclude'}`}
                                    className="min-w-[6px] flex-1 rounded-t-sm transition hover:brightness-110 disabled:cursor-not-allowed"
                                    style={{
                                        height: `${Math.min(100, height)}%`,
                                        backgroundColor: row.color ?? '#e5e7eb',
                                        opacity: row.ignored ? 0.35 : 1,
                                        outline: row.ignored ? '1px dashed #9ca3af' : undefined,
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
                        <span>faded = excluded</span>
                    </div>

                    <div className="mt-3 grid grid-cols-5 gap-2" aria-label="Band summary">
                        {summary.map(band => (
                            <div key={band.id} className="rounded-lg border border-gray-200 p-2 text-center">
                                <BandBadge band={band.id} color={band.color} />
                                <b className="block text-lg text-gray-900">{band.minutes ?? '—'}</b>
                                <small className="text-[11px] text-gray-500">min · {band.bucketCount} bucket{band.bucketCount === 1 ? '' : 's'}</small>
                            </div>
                        ))}
                    </div>
                </section>

                <section className="rounded-xl border border-gray-200 p-4" aria-label="Bucket evidence">
                    <h3 className="mb-2 text-sm font-bold text-gray-900">Bucket evidence</h3>
                    <div className="max-h-[22rem] overflow-auto">
                        <table className="w-full text-sm">
                            <thead className="sticky top-0 bg-white text-left text-[11px] uppercase tracking-wide text-gray-500">
                                <tr>
                                    <th className="py-1 font-semibold">Bucket</th>
                                    <th className="py-1 text-right font-semibold">Days</th>
                                    <th className="py-1 text-right font-semibold">Min</th>
                                    <th className="py-1 text-center font-semibold">Band</th>
                                    <th className="py-1" />
                                </tr>
                            </thead>
                            <tbody>
                                {rows.map(row => (
                                    <tr key={row.timeBucket} className={`border-t border-gray-100 ${row.ignored ? 'text-gray-400' : 'text-gray-800'}`}>
                                        <td className="py-1 font-mono text-xs">{row.label}</td>
                                        <td
                                            className={`py-1 text-right ${row.qualifyingDays !== null && row.requiredDays !== null && row.qualifyingDays < row.requiredDays ? 'font-semibold text-amber-700' : ''}`}
                                            title={row.reasons.join('; ') || undefined}
                                        >
                                            {row.qualifyingDays ?? '—'}
                                        </td>
                                        <td className="py-1 text-right">{row.minutes || '—'}</td>
                                        <td className="py-1 text-center"><BandBadge band={row.band} color={row.color} /></td>
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
                    <p className="mt-2 text-xs text-gray-500">An approved bucket needs at least 5 days with a complete same-day paired cycle (locked rule 7).</p>
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
