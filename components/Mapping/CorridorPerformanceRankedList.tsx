import React, { useMemo } from 'react';
import { BarChart3 } from 'lucide-react';
import type {
    CorridorSpeedMetric,
    CorridorSpeedSegment,
    CorridorSpeedStats,
} from '../../utils/gtfs/corridorSpeed';
import {
    buildCorridorPerformanceRankedRows,
    formatCorridorEvidenceDays,
    getCorridorRankingTitle,
    getMetricDisplayValue,
    type CorridorPerformanceRankedRow,
} from '../../utils/corridor-performance/corridorPerformancePresentation';

interface CorridorPerformanceRankedListProps {
    segments: CorridorSpeedSegment[];
    statsBySegment: Map<string, CorridorSpeedStats>;
    metric: CorridorSpeedMetric;
    selectedSegmentId: string | null;
    onSelect: (segmentId: string) => void;
}

export const CorridorPerformanceRankedList: React.FC<CorridorPerformanceRankedListProps> = ({
    segments,
    statsBySegment,
    metric,
    selectedSegmentId,
    onSelect,
}) => {
    const rows = useMemo(
        () => buildCorridorPerformanceRankedRows(segments, statsBySegment, metric),
        [metric, segments, statsBySegment],
    );

    const renderRows = (rankedRows: CorridorPerformanceRankedRow[], lowConfidence: boolean) => (
        <ol className="py-1">
            {rankedRows.map(({ segment, stats }, index) => {
                const selected = segment.id === selectedSegmentId;
                return (
                    <li key={segment.id}>
                        <button
                            type="button"
                            onClick={() => onSelect(segment.id)}
                            className={`grid w-full grid-cols-[24px_minmax(0,1fr)_auto] items-start gap-2 px-3 py-2 text-left transition-colors ${selected ? 'bg-blue-50' : 'hover:bg-gray-50'}`}
                        >
                            <span className="pt-0.5 text-[10px] font-bold text-gray-400">{index + 1}</span>
                            <span className="min-w-0">
                                <span className="block truncate text-xs font-semibold text-gray-800">
                                    {segment.fromStopName} → {segment.toStopName}
                                </span>
                                <span className="block truncate text-[10px] text-gray-500">
                                    {segment.directionId} · Routes {segment.routes.join(', ')} · {stats.sampleCount} trips · {formatCorridorEvidenceDays(stats.distinctDayCount)}
                                </span>
                                {lowConfidence && (
                                    <span className="mt-0.5 block text-[9px] font-semibold uppercase tracking-wide text-amber-700">
                                        Low confidence
                                    </span>
                                )}
                            </span>
                            <span className={`text-xs font-bold ${lowConfidence ? 'text-gray-500' : 'text-gray-800'}`}>
                                {getMetricDisplayValue(stats, metric)}
                            </span>
                        </button>
                    </li>
                );
            })}
        </ol>
    );

    return (
        <aside className="absolute right-3 top-3 z-[900] hidden w-[350px] overflow-hidden rounded-xl border border-gray-200 bg-white/95 shadow-lg backdrop-blur-sm xl:block">
            <div className="flex items-center gap-2 border-b border-gray-100 px-3 py-2.5">
                <BarChart3 size={15} className="text-gray-400" />
                <div>
                    <div className="text-xs font-bold text-gray-800">{getCorridorRankingTitle(metric)}</div>
                    <div className="text-[10px] text-gray-500">Decision-ready evidence first</div>
                </div>
            </div>

            {rows.usable.length === 0 && rows.lowConfidence.length === 0 ? (
                <div className="px-3 py-4 text-xs text-gray-500">No observed corridors match these filters.</div>
            ) : (
                <div className="max-h-[430px] overflow-y-auto">
                    {rows.usable.length > 0
                        ? renderRows(rows.usable, false)
                        : <div className="px-3 py-3 text-xs text-gray-500">No decision-ready corridors match these filters.</div>}
                    {rows.lowConfidence.length > 0 && (
                        <div className="border-t border-amber-100 bg-amber-50/40">
                            <div className="px-3 pt-2 text-[9px] font-bold uppercase tracking-wide text-amber-700">
                                Supporting evidence — review before use
                            </div>
                            {renderRows(rows.lowConfidence, true)}
                        </div>
                    )}
                </div>
            )}
        </aside>
    );
};
