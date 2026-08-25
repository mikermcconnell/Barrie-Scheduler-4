import React from 'react';
import { CalendarRange, Database, Route, ShieldCheck, TriangleAlert } from 'lucide-react';
import type { PerformanceMetadata } from '../../utils/performanceDataTypes';
import {
    assessCorridorBaselineCoverage,
    type CorridorGtfsProvenance,
} from '../../utils/corridor-performance/corridorPerformanceProvenance';

interface CorridorPerformanceTrustBarProps {
    metadata: PerformanceMetadata | null | undefined;
    provenance: CorridorGtfsProvenance;
    observedCorridorCount: number;
    usableCorridorCount: number;
    totalCorridorCount: number;
}

function formatDate(value: string | null | undefined): string {
    if (!value) return 'Unknown';
    const date = new Date(`${value}T12:00:00`);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' });
}

export const CorridorPerformanceTrustBar: React.FC<CorridorPerformanceTrustBarProps> = ({
    metadata,
    provenance,
    observedCorridorCount,
    usableCorridorCount,
    totalCorridorCount,
}) => {
    const baselineCoverage = assessCorridorBaselineCoverage(metadata, provenance);
    const baselineWarning = !!metadata && baselineCoverage !== 'covered';
    const baselineMessage = baselineCoverage === 'partial'
        ? 'Only overlapping service dates are compared'
        : 'Schedule provenance unavailable; comparisons are withheld';

    return (
        <div className={`grid gap-px border-y ${baselineWarning ? 'border-amber-200 bg-amber-200' : 'border-gray-200 bg-gray-200'} sm:grid-cols-2 xl:grid-cols-4`}>
            <div className="flex items-center gap-2 bg-white px-3 py-2">
                <Database size={15} className="shrink-0 text-gray-400" />
                <div className="min-w-0">
                    <div className="text-[9px] font-bold uppercase tracking-wide text-gray-400">STREETS evidence</div>
                    <div className="truncate text-xs font-semibold text-gray-700">
                        {metadata ? `${formatDate(metadata.dateRange.start)} – ${formatDate(metadata.dateRange.end)}` : 'Not loaded'}
                    </div>
                </div>
            </div>

            <div className={`flex items-center gap-2 px-3 py-2 ${baselineWarning ? 'bg-amber-50' : 'bg-white'}`}>
                {baselineWarning
                    ? <TriangleAlert size={15} className="shrink-0 text-amber-600" />
                    : <CalendarRange size={15} className="shrink-0 text-gray-400" />}
                <div className="min-w-0">
                    <div className={`text-[9px] font-bold uppercase tracking-wide ${baselineWarning ? 'text-amber-700' : 'text-gray-400'}`}>
                        Scheduled baseline
                    </div>
                    <div className={`truncate text-xs font-semibold ${baselineWarning ? 'text-amber-900' : 'text-gray-700'}`}>
                        GTFS {provenance.feedVersion ?? 'unknown'} · {formatDate(provenance.feedStartDate)} – {formatDate(provenance.feedEndDate)}
                    </div>
                    {baselineWarning && (
                        <div className="text-[10px] font-medium text-amber-700">{baselineMessage}</div>
                    )}
                </div>
            </div>

            <div className="flex items-center gap-2 bg-white px-3 py-2">
                <Route size={15} className="shrink-0 text-gray-400" />
                <div className="min-w-0">
                    <div className="text-[9px] font-bold uppercase tracking-wide text-gray-400">Visible coverage</div>
                    <div className="text-xs font-semibold text-gray-700">
                        {observedCorridorCount} of {totalCorridorCount} corridors · {usableCorridorCount} usable
                    </div>
                </div>
            </div>

            <div className="flex items-center gap-2 bg-white px-3 py-2">
                <ShieldCheck size={15} className="shrink-0 text-gray-400" />
                <div className="min-w-0">
                    <div className="text-[9px] font-bold uppercase tracking-wide text-gray-400">Evidence policy</div>
                    <div className="text-xs font-semibold text-gray-700">Normal-classified service · 8 trips across 5 days</div>
                </div>
            </div>
        </div>
    );
};
