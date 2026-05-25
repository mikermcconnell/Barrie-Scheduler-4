import React, { useMemo, useState } from 'react';
import {
    ArrowUpDown,
    Repeat,
    Train,
    GitBranch,
    Target,
} from 'lucide-react';
import type {
    TransitAppDataSummary,
    TransferPriorityTier,
    TransferTripAnchor,
} from '../../utils/transit-app/transitAppTypes';
import { NoData, fmt, formatTimeBand } from './AnalyticsShared';
import {
    calculateTransferScopeStats,
    isTransferRowInScope,
    type TransferScopeFilter,
} from '../../utils/transit-app/transitAppTransferScope';
import {
    groupTransferPatternsByRoute,
    rankConnectionTargetsForScope,
    type GroupedTransferPattern,
} from '../../utils/transit-app/transitAppTransferUiMetrics';

interface TransfersModuleProps {
    data: TransitAppDataSummary;
}

type SortField = 'count' | 'avgWaitMinutes';
type ScopeFilter = TransferScopeFilter;

const TOP_TRANSFER_TABLE_LIMIT = 50;
const GO_LINKED_TABLE_LIMIT = 15;
const CONNECTION_TARGET_TABLE_LIMIT = 15;
const TRANSFER_PATTERN_TABLE_LIMIT = 100;

function formatPriority(priority: TransferPriorityTier): string {
    switch (priority) {
        case 'high': return 'High';
        case 'medium': return 'Medium';
        case 'low': return 'Low';
        default: return priority;
    }
}

function priorityBadgeClass(priority: TransferPriorityTier): string {
    switch (priority) {
        case 'high': return 'bg-red-500 text-white';
        case 'medium': return 'bg-amber-100 text-amber-800 ring-1 ring-amber-200';
        case 'low': return 'bg-slate-100 text-slate-600 ring-1 ring-slate-200';
        default: return 'bg-slate-100 text-slate-500';
    }
}

function waitTimeClass(minutes: number): string {
    if (minutes > 10) return 'text-red-600 font-semibold';
    if (minutes >= 5) return 'text-amber-600';
    return 'text-emerald-600';
}

function formatTripAnchors(anchors?: TransferTripAnchor[]): string {
    if (!anchors || anchors.length === 0) return 'N/A';
    return anchors
        .slice(0, 2)
        .map(anchor => `${anchor.timeLabel} (${anchor.sharePct}%)`)
        .join(', ');
}

// ── Segmented Button Group ──────────────────────────────────────────────────

const SegBtn: React.FC<{
    active: boolean;
    onClick: () => void;
    children: React.ReactNode;
}> = ({ active, onClick, children }) => (
    <button
        onClick={onClick}
        className={`px-2.5 py-1.5 text-[11px] font-medium transition-all duration-150 ${
            active
                ? 'bg-slate-900 text-white shadow-sm'
                : 'bg-white text-slate-500 hover:bg-slate-50 hover:text-slate-700'
        }`}
    >
        {children}
    </button>
);

// ── Section Card ────────────────────────────────────────────────────────────

const SectionCard: React.FC<{
    title: string;
    subtitle: string;
    accentColor?: string;
    headerExtra?: React.ReactNode;
    noPadding?: boolean;
    children: React.ReactNode;
}> = ({ title, subtitle, accentColor, headerExtra, noPadding, children }) => (
    <div
        className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden"
        style={accentColor ? { borderTopWidth: 3, borderTopColor: accentColor } : undefined}
    >
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
            <div>
                <h3 className="text-[15px] font-bold text-slate-900 tracking-tight">{title}</h3>
                <p className="text-xs text-slate-400 mt-0.5">{subtitle}</p>
            </div>
            {headerExtra}
        </div>
        <div className={noPadding ? '' : 'p-5'}>
            {children}
        </div>
    </div>
);

// ── Main Module ─────────────────────────────────────────────────────────────

export const TransfersModule: React.FC<TransfersModuleProps> = ({ data }) => {
    const [sortBy, setSortBy] = useState<SortField>('count');
    const [groupByRoute, setGroupByRoute] = useState(false);
    const [scope, setScope] = useState<ScopeFilter>('barrie');
    const { transferPatterns, transferAnalysis } = data;

    const sortedPatterns = useMemo(() => {
        return [...transferPatterns]
            .filter(tp => isTransferRowInScope(tp, scope))
            .sort((a, b) => {
                if (sortBy === 'count') return b.count - a.count;
                return b.avgWaitMinutes - a.avgWaitMinutes;
            });
    }, [transferPatterns, sortBy, scope]);

    const visiblePatterns = useMemo(
        () => sortedPatterns.slice(0, TRANSFER_PATTERN_TABLE_LIMIT),
        [sortedPatterns]
    );

    const groupedPatterns = useMemo((): GroupedTransferPattern[] | null => {
        if (!groupByRoute) return null;
        return groupTransferPatternsByRoute(sortedPatterns);
    }, [sortedPatterns, groupByRoute]);

    const scopedTopPairs = useMemo(() => {
        if (!transferAnalysis) return [];
        return transferAnalysis.topTransferPairs.filter(row => isTransferRowInScope(row, scope));
    }, [transferAnalysis, scope]);

    const visibleTopPairs = useMemo(
        () => scopedTopPairs.slice(0, TOP_TRANSFER_TABLE_LIMIT),
        [scopedTopPairs]
    );

    const maxTopPairVolume = useMemo(() => {
        return Math.max(...visibleTopPairs.map(p => p.totalCount), 1);
    }, [visibleTopPairs]);

    const scopedGoLinked = useMemo(() => {
        if (!transferAnalysis) return [];
        return transferAnalysis.goLinkedSummary.filter(row => isTransferRowInScope(row, scope));
    }, [transferAnalysis, scope]);

    const visibleGoLinked = useMemo(
        () => scopedGoLinked.slice(0, GO_LINKED_TABLE_LIMIT),
        [scopedGoLinked]
    );

    const scopedConnectionTargets = useMemo(() => {
        if (!transferAnalysis) return [];
        return rankConnectionTargetsForScope(
            transferAnalysis.connectionTargets.filter(row => isTransferRowInScope(row, scope))
        );
    }, [transferAnalysis, scope]);

    const visibleConnectionTargets = useMemo(
        () => scopedConnectionTargets.slice(0, CONNECTION_TARGET_TABLE_LIMIT),
        [scopedConnectionTargets]
    );

    const transferScopeSourceComplete = useMemo(() => {
        if (!transferAnalysis) return true;
        const representedEvents = transferAnalysis.topTransferPairs.reduce((sum, pair) => sum + pair.totalCount, 0);
        return representedEvents >= transferAnalysis.totals.transferEvents;
    }, [transferAnalysis]);

    const scopedTransferStats = useMemo(() => {
        if (!transferAnalysis) return null;
        const allScopeFallback = scope === 'all'
            ? {
                transferEvents: transferAnalysis.totals.transferEvents,
                goLinkedTransferEvents: transferAnalysis.totals.goLinkedTransferEvents,
                uniqueRoutePairs: transferAnalysis.totals.uniqueRoutePairs,
                routeReferencesMatched: transferAnalysis.normalization.routeReferencesMatched,
                routeReferencesTotal: transferAnalysis.normalization.routeReferencesTotal,
                routeMatchRate: transferAnalysis.normalization.routeMatchRate,
            }
            : undefined;
        return calculateTransferScopeStats(scopedTopPairs, allScopeFallback);
    }, [scopedTopPairs, scope, transferAnalysis]);

    return (
        <div className="space-y-6">
            {transferAnalysis && (
                <>
                    {/* ── KPI Strip ──────────────────────────────────────────── */}
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 border-l-[3px] border-l-cyan-500">
                            <div className="flex items-start gap-3">
                                <div className="p-2 rounded-lg bg-cyan-50 text-cyan-600 shrink-0">
                                    <Repeat size={18} />
                                </div>
                                <div className="min-w-0">
                                    <p className="text-2xl font-bold text-slate-900 tracking-tight tabular-nums">
                                        {fmt(scopedTransferStats?.transferEvents ?? transferAnalysis.totals.transferEvents)}
                                    </p>
                                    <p className="text-sm text-slate-500">Transfer Events</p>
                                </div>
                            </div>
                        </div>

                        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 border-l-[3px] border-l-indigo-500">
                            <div className="flex items-start gap-3">
                                <div className="p-2 rounded-lg bg-indigo-50 text-indigo-600 shrink-0">
                                    <Train size={18} />
                                </div>
                                <div className="min-w-0">
                                    <p className="text-2xl font-bold text-slate-900 tracking-tight tabular-nums">
                                        {fmt(scopedTransferStats?.goLinkedTransferEvents ?? transferAnalysis.totals.goLinkedTransferEvents)}
                                    </p>
                                    <p className="text-sm text-slate-500">GO-Linked Events</p>
                                </div>
                            </div>
                        </div>

                        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 border-l-[3px] border-l-emerald-500">
                            <div className="flex items-start gap-3">
                                <div className="p-2 rounded-lg bg-emerald-50 text-emerald-600 shrink-0">
                                    <GitBranch size={18} />
                                </div>
                                <div className="min-w-0">
                                    <p className="text-2xl font-bold text-slate-900 tracking-tight tabular-nums">
                                        {fmt(scopedTransferStats?.uniqueRoutePairs ?? transferAnalysis.totals.uniqueRoutePairs)}
                                    </p>
                                    <p className="text-sm text-slate-500">Unique Route Pairs</p>
                                </div>
                            </div>
                        </div>

                        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 border-l-[3px] border-l-amber-500">
                            <div className="flex items-start gap-3">
                                <div className="p-2 rounded-lg bg-amber-50 text-amber-600 shrink-0">
                                    <Target size={18} />
                                </div>
                                <div className="min-w-0">
                                    <p className="text-2xl font-bold text-slate-900 tracking-tight tabular-nums">
                                        {`${Math.round((scopedTransferStats?.routeMatchRate ?? transferAnalysis.normalization.routeMatchRate) * 100)}%`}
                                    </p>
                                    <p className="text-sm text-slate-500">Route Match Rate</p>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* ── Scope Control Toolbar ─────────────────────────── */}
                    <div className="flex items-center bg-white border border-slate-200 rounded-xl px-4 py-2.5 shadow-sm flex-wrap gap-2">
                        <div className="flex items-center gap-3">
                            <span className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider">Scope</span>
                            <div className="flex rounded-lg border border-slate-200 overflow-hidden">
                                <SegBtn active={scope === 'barrie'} onClick={() => setScope('barrie')}>Barrie</SegBtn>
                                <SegBtn active={scope === 'regional'} onClick={() => setScope('regional')}>Regional</SegBtn>
                                <SegBtn active={scope === 'all'} onClick={() => setScope('all')}>All</SegBtn>
                            </div>
                        </div>
                    </div>

                    {!transferScopeSourceComplete && (
                        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
                            This saved import uses a legacy capped transfer summary. Re-import Transit App data to enable complete scoped rankings and exact map time-band volumes.
                        </div>
                    )}

                    {/* ── Top Transfer Pairs — Hero Section ───────────────── */}
                    <SectionCard
                        title="Top Transfer Pairs"
                        subtitle={`Top ${visibleTopPairs.length} of ${scopedTopPairs.length} ${scope === 'all' ? 'systemwide' : scope} pairs ranked by transfer volume`}
                        noPadding
                    >
                        {visibleTopPairs.length > 0 ? (
                            <div className="overflow-x-auto">
                                <table className="w-full text-sm">
                                    <thead>
                                        <tr className="bg-slate-50/80">
                                            <th className="text-left py-2.5 px-4 text-[11px] text-slate-500 font-semibold uppercase tracking-wider">From</th>
                                            <th className="text-left py-2.5 px-4 text-[11px] text-slate-500 font-semibold uppercase tracking-wider">To</th>
                                            <th className="text-left py-2.5 px-4 text-[11px] text-slate-500 font-semibold uppercase tracking-wider">Transfer Stop</th>
                                            <th className="text-left py-2.5 px-4 text-[11px] text-slate-500 font-semibold uppercase tracking-wider">Arrival / Departure Times</th>
                                            <th className="text-left py-2.5 px-4 text-[11px] text-slate-500 font-semibold uppercase tracking-wider">Peak Bands</th>
                                            <th className="text-right py-2.5 px-4 text-[11px] text-slate-500 font-semibold uppercase tracking-wider">Volume</th>
                                            <th className="text-right py-2.5 px-4 text-[11px] text-slate-500 font-semibold uppercase tracking-wider">Avg Wait</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {visibleTopPairs.map((row, i) => (
                                            <tr key={i} className={`border-b border-slate-50 hover:bg-slate-50/50 transition-colors ${i % 2 === 1 ? 'bg-slate-25' : ''}`}>
                                                <td className="py-2.5 px-4">
                                                    <span className="inline-flex items-center justify-center w-8 h-6 rounded bg-slate-100 text-xs font-bold text-slate-700">
                                                        {row.fromRoute}
                                                    </span>
                                                </td>
                                                <td className="py-2.5 px-4">
                                                    <span className="inline-flex items-center justify-center w-8 h-6 rounded bg-slate-100 text-xs font-bold text-slate-700">
                                                        {row.toRoute}
                                                    </span>
                                                </td>
                                                <td className="py-2.5 px-4 text-slate-600 text-xs">{row.transferStopName || 'Unknown'}</td>
                                                <td className="py-2.5 px-4">
                                                    <div className="text-xs text-slate-500 space-y-0.5">
                                                        <div><span className="text-slate-400 w-8 inline-block">Arr</span> {formatTripAnchors(row.fromTripAnchors)}</div>
                                                        <div><span className="text-slate-400 w-8 inline-block">Dep</span> {formatTripAnchors(row.toTripAnchors)}</div>
                                                    </div>
                                                </td>
                                                <td className="py-2.5 px-4">
                                                    <div className="flex flex-wrap gap-1">
                                                        {row.dominantTimeBands.length > 0
                                                            ? row.dominantTimeBands.map(band => (
                                                                <span key={band} className="inline-block px-1.5 py-0.5 text-[10px] font-medium rounded bg-slate-100 text-slate-600">
                                                                    {formatTimeBand(band)}
                                                                </span>
                                                            ))
                                                            : <span className="text-xs text-slate-300">N/A</span>
                                                        }
                                                    </div>
                                                </td>
                                                <td className="py-2.5 px-4 text-right">
                                                    <div className="flex items-center justify-end gap-2">
                                                        <div className="w-14 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                                                            <div
                                                                className="h-full bg-cyan-500 rounded-full transition-all"
                                                                style={{ width: `${Math.min(100, (row.totalCount / maxTopPairVolume) * 100)}%` }}
                                                            />
                                                        </div>
                                                        <span className="font-bold text-slate-900 tabular-nums text-xs">{fmt(row.totalCount)}</span>
                                                    </div>
                                                </td>
                                                <td className={`py-2.5 px-4 text-right tabular-nums text-xs ${waitTimeClass(row.avgWaitMinutes)}`}>
                                                    {row.avgWaitMinutes} min
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        ) : (
                            <div className="p-5">
                                <NoData />
                            </div>
                        )}
                    </SectionCard>

                    {/* ── GO-Linked + Connection Targets ──────────────────── */}
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        <SectionCard
                            title="GO-Linked Transfers"
                            subtitle={`Top ${visibleGoLinked.length} of ${scopedGoLinked.length} scoped rows by route pair and time band`}
                            accentColor="#6366f1"
                        >
                            {visibleGoLinked.length > 0 ? (
                                <div className="overflow-x-auto -mx-5 -mb-5">
                                    <table className="w-full text-sm">
                                        <thead>
                                            <tr className="bg-slate-50/80">
                                                <th className="text-left py-2.5 px-5 text-[11px] text-slate-500 font-semibold uppercase tracking-wider">From</th>
                                                <th className="text-left py-2.5 px-4 text-[11px] text-slate-500 font-semibold uppercase tracking-wider">To</th>
                                                <th className="text-left py-2.5 px-4 text-[11px] text-slate-500 font-semibold uppercase tracking-wider">Band</th>
                                                <th className="text-right py-2.5 px-5 text-[11px] text-slate-500 font-semibold uppercase tracking-wider">Count</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {visibleGoLinked.map((row, i) => (
                                                <tr key={i} className={`border-b border-slate-50 hover:bg-slate-50/50 transition-colors ${i % 2 === 1 ? 'bg-slate-25' : ''}`}>
                                                    <td className="py-2 px-5">
                                                        <span className="inline-flex items-center justify-center px-1.5 h-5 rounded bg-indigo-50 text-[10px] font-bold text-indigo-700">
                                                            {row.fromRoute}
                                                        </span>
                                                    </td>
                                                    <td className="py-2 px-4">
                                                        <span className="inline-flex items-center justify-center px-1.5 h-5 rounded bg-indigo-50 text-[10px] font-bold text-indigo-700">
                                                            {row.toRoute}
                                                        </span>
                                                    </td>
                                                    <td className="py-2 px-4">
                                                        <span className="inline-block px-1.5 py-0.5 text-[10px] font-medium rounded bg-slate-100 text-slate-600">
                                                            {formatTimeBand(row.timeBand)}
                                                        </span>
                                                    </td>
                                                    <td className="py-2 px-5 text-right font-bold text-slate-900 tabular-nums text-xs">{fmt(row.totalCount)}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            ) : (
                                <NoData />
                            )}
                        </SectionCard>

                        <SectionCard
                            title="Connection Targets"
                            subtitle={`Top ${visibleConnectionTargets.length} of ${scopedConnectionTargets.length} scoped import-ready candidates`}
                            accentColor="#10b981"
                        >
                            {visibleConnectionTargets.length > 0 ? (
                                <div className="overflow-x-auto -mx-5 -mb-5">
                                    <table className="w-full text-sm">
                                        <thead>
                                            <tr className="bg-slate-50/80">
                                                <th className="text-left py-2.5 px-5 text-[11px] text-slate-500 font-semibold uppercase tracking-wider">Pair</th>
                                                <th className="text-left py-2.5 px-4 text-[11px] text-slate-500 font-semibold uppercase tracking-wider">Stop ID</th>
                                                <th className="text-left py-2.5 px-4 text-[11px] text-slate-500 font-semibold uppercase tracking-wider">Arr / Dep Times</th>
                                                <th className="text-left py-2.5 px-4 text-[11px] text-slate-500 font-semibold uppercase tracking-wider">Bands</th>
                                                <th className="text-right py-2.5 px-5 text-[11px] text-slate-500 font-semibold uppercase tracking-wider">Tier</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {visibleConnectionTargets.map((row, i) => (
                                                <tr key={i} className={`border-b border-slate-50 hover:bg-slate-50/50 transition-colors ${i % 2 === 1 ? 'bg-slate-25' : ''}`}>
                                                    <td className="py-2 px-5">
                                                        <div className="font-semibold text-slate-800 text-xs">{row.fromRoute} → {row.toRoute}</div>
                                                        <div className="text-[10px] text-slate-400 truncate max-w-[140px]">{row.locationStopName || 'Unknown stop'}</div>
                                                    </td>
                                                    <td className="py-2 px-4 text-xs text-slate-500 font-mono">{row.locationStopId || '—'}</td>
                                                    <td className="py-2 px-4">
                                                        <div className="text-[10px] text-slate-500 space-y-0.5">
                                                            <div><span className="text-slate-400">Arr</span> {formatTripAnchors(row.fromTripAnchors)}</div>
                                                            <div><span className="text-slate-400">Dep</span> {formatTripAnchors(row.toTripAnchors)}</div>
                                                        </div>
                                                    </td>
                                                    <td className="py-2 px-4">
                                                        <div className="flex flex-wrap gap-0.5">
                                                            {row.timeBands.map(band => (
                                                                <span key={band} className="inline-block px-1 py-0.5 text-[9px] font-medium rounded bg-slate-100 text-slate-500">
                                                                    {formatTimeBand(band)}
                                                                </span>
                                                            ))}
                                                        </div>
                                                    </td>
                                                    <td className="py-2 px-5 text-right">
                                                        <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold ${priorityBadgeClass(row.priorityTier)}`}>
                                                            {formatPriority(row.priorityTier)}
                                                        </span>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            ) : (
                                <NoData />
                            )}
                        </SectionCard>
                    </div>
                </>
            )}

            {/* ── Transfer Patterns Detail ────────────────────────────── */}
            {groupByRoute && groupedPatterns ? (
                <div className="space-y-4">
                    {groupedPatterns.map(group => (
                        <SectionCard
                            key={group.routePair}
                            title={group.routePair}
                            subtitle={`${fmt(group.totalCount)} transfers · avg ${group.avgWait.toFixed(1)} min wait`}
                            headerExtra={
                                <div className="flex items-center gap-2">
                                    <label className="flex items-center gap-1.5 text-xs text-slate-500 cursor-pointer select-none">
                                        <input
                                            type="checkbox"
                                            checked={groupByRoute}
                                            onChange={e => setGroupByRoute(e.target.checked)}
                                            className="accent-slate-900 w-3.5 h-3.5"
                                        />
                                        Grouped
                                    </label>
                                </div>
                            }
                            noPadding
                        >
                            <div className="overflow-x-auto">
                                <table className="w-full text-sm">
                                    <thead>
                                        <tr className="bg-slate-50/80">
                                            <th className="text-left py-2.5 px-4 text-[11px] text-slate-500 font-semibold uppercase tracking-wider">From Stop</th>
                                            <th className="text-left py-2.5 px-4 text-[11px] text-slate-500 font-semibold uppercase tracking-wider">To Stop</th>
                                            <th className="text-left py-2.5 px-4 text-[11px] text-slate-500 font-semibold uppercase tracking-wider">Arrival Times</th>
                                            <th className="text-left py-2.5 px-4 text-[11px] text-slate-500 font-semibold uppercase tracking-wider">Departure Times</th>
                                            <th className="text-right py-2.5 px-4 text-[11px] text-slate-500 font-semibold uppercase tracking-wider">Count</th>
                                            <th className="text-right py-2.5 px-4 text-[11px] text-slate-500 font-semibold uppercase tracking-wider">Avg Wait</th>
                                            <th className="text-right py-2.5 px-4 text-[11px] text-slate-500 font-semibold uppercase tracking-wider">Range</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {group.patterns.map((tp, i) => (
                                            <tr key={i} className={`border-b border-slate-50 hover:bg-slate-50/50 transition-colors ${i % 2 === 1 ? 'bg-slate-25' : ''}`}>
                                                <td className="py-2 px-4 text-slate-600 text-xs truncate max-w-[180px]">{tp.fromStop}</td>
                                                <td className="py-2 px-4 text-slate-600 text-xs truncate max-w-[180px]">{tp.toStop}</td>
                                                <td className="py-2 px-4 text-slate-500 text-[11px]">{formatTripAnchors(tp.fromTripAnchors)}</td>
                                                <td className="py-2 px-4 text-slate-500 text-[11px]">{formatTripAnchors(tp.toTripAnchors)}</td>
                                                <td className="py-2 px-4 text-right font-bold text-slate-900 tabular-nums text-xs">{tp.count}</td>
                                                <td className={`py-2 px-4 text-right tabular-nums text-xs ${waitTimeClass(tp.avgWaitMinutes)}`}>{tp.avgWaitMinutes} min</td>
                                                <td className="py-2 px-4 text-right text-slate-400 tabular-nums text-[11px]">{tp.minWaitMinutes}–{tp.maxWaitMinutes}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </SectionCard>
                    ))}
                </div>
            ) : (
                <SectionCard
                    title="Transfer Patterns"
                    subtitle={`Top ${fmt(visiblePatterns.length)} of ${fmt(sortedPatterns.length)} scoped route-to-route transfers`}
                    headerExtra={
                        <div className="flex items-center gap-3">
                            <label className="flex items-center gap-1.5 text-xs text-slate-500 cursor-pointer select-none">
                                <input
                                    type="checkbox"
                                    checked={groupByRoute}
                                    onChange={e => setGroupByRoute(e.target.checked)}
                                    className="accent-slate-900 w-3.5 h-3.5"
                                />
                                Group by route
                            </label>
                            <button
                                onClick={() => setSortBy(prev => prev === 'count' ? 'avgWaitMinutes' : 'count')}
                                className="flex items-center gap-1 px-2 py-1 text-xs text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-all duration-150"
                            >
                                <ArrowUpDown size={12} />
                                {sortBy === 'count' ? 'Count' : 'Wait'}
                            </button>
                        </div>
                    }
                    noPadding
                >
                    {visiblePatterns.length > 0 ? (
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="bg-slate-50/80">
                                        <th className="text-left py-2.5 px-4 text-[11px] text-slate-500 font-semibold uppercase tracking-wider">From</th>
                                        <th className="text-left py-2.5 px-4 text-[11px] text-slate-500 font-semibold uppercase tracking-wider">To</th>
                                        <th className="text-left py-2.5 px-4 text-[11px] text-slate-500 font-semibold uppercase tracking-wider">Transfer Stop</th>
                                        <th className="text-left py-2.5 px-4 text-[11px] text-slate-500 font-semibold uppercase tracking-wider">Arrival Times</th>
                                        <th className="text-left py-2.5 px-4 text-[11px] text-slate-500 font-semibold uppercase tracking-wider">Departure Times</th>
                                        <th className="text-right py-2.5 px-4 text-[11px] text-slate-500 font-semibold uppercase tracking-wider">Count</th>
                                        <th className="text-right py-2.5 px-4 text-[11px] text-slate-500 font-semibold uppercase tracking-wider">Avg Wait</th>
                                        <th className="text-right py-2.5 px-4 text-[11px] text-slate-500 font-semibold uppercase tracking-wider">Range</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {visiblePatterns.map((tp, i) => (
                                        <tr key={i} className={`border-b border-slate-50 hover:bg-slate-50/50 transition-colors ${i % 2 === 1 ? 'bg-slate-25' : ''}`}>
                                            <td className="py-2 px-4">
                                                <span className="inline-flex items-center justify-center w-8 h-5 rounded bg-slate-100 text-[10px] font-bold text-slate-700">
                                                    {tp.fromRoute}
                                                </span>
                                            </td>
                                            <td className="py-2 px-4">
                                                <span className="inline-flex items-center justify-center w-8 h-5 rounded bg-slate-100 text-[10px] font-bold text-slate-700">
                                                    {tp.toRoute}
                                                </span>
                                            </td>
                                            <td className="py-2 px-4 text-slate-500 text-xs truncate max-w-[200px]">{tp.fromStop} → {tp.toStop}</td>
                                            <td className="py-2 px-4 text-slate-500 text-[11px]">{formatTripAnchors(tp.fromTripAnchors)}</td>
                                            <td className="py-2 px-4 text-slate-500 text-[11px]">{formatTripAnchors(tp.toTripAnchors)}</td>
                                            <td className="py-2 px-4 text-right font-bold text-slate-900 tabular-nums text-xs">{tp.count}</td>
                                            <td className={`py-2 px-4 text-right tabular-nums text-xs ${waitTimeClass(tp.avgWaitMinutes)}`}>{tp.avgWaitMinutes} min</td>
                                            <td className="py-2 px-4 text-right text-slate-400 tabular-nums text-[11px]">{tp.minWaitMinutes}–{tp.maxWaitMinutes}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    ) : (
                        <div className="p-5">
                            <NoData />
                        </div>
                    )}
                </SectionCard>
            )}
        </div>
    );
};
