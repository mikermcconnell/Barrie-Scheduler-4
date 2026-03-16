import React from 'react';
import type {
    CorridorSpeedMetric,
    CorridorSpeedRouteBreakdown,
    CorridorSpeedSegment,
    CorridorSpeedStats
} from '../../utils/gtfs/corridorSpeed';
import { getMetricDisplayValue } from '../../utils/gtfs/corridorSpeed';

interface CorridorSpeedDetailPanelProps {
    segment: CorridorSpeedSegment;
    stats: CorridorSpeedStats | null;
    metric: CorridorSpeedMetric;
    periodLabel: string;
    dayTypeLabel: string;
    onClose: () => void;
}

function formatRuntime(value: number | null): string {
    return value === null ? 'No data' : `${value.toFixed(1)} min`;
}

function formatSpeed(value: number | null): string {
    return value === null ? 'No data' : `${value.toFixed(1)} km/h`;
}

export const CorridorSpeedDetailPanel: React.FC<CorridorSpeedDetailPanelProps> = ({
    segment,
    stats,
    metric,
    periodLabel,
    dayTypeLabel,
    onClose,
}) => {
    const routeBreakdown: CorridorSpeedRouteBreakdown[] = stats?.routeBreakdown.length
        ? stats.routeBreakdown
        : segment.routes.map((route): CorridorSpeedRouteBreakdown => ({
            route,
            sampleCount: 0,
            scheduledRuntimeMin: null,
            observedRuntimeMin: null,
            runtimeDeltaMin: null,
            runtimeDeltaPct: null,
            scheduledSpeedKmh: null,
            observedSpeedKmh: null,
        }));
    const selectedRoute = routeBreakdown.length === 1 ? routeBreakdown[0]?.route ?? null : null;

    return (
    <div className="absolute top-2 left-2 z-[1000] bg-white/95 backdrop-blur-sm rounded-lg shadow-lg border border-gray-200 w-80 pointer-events-auto">
        <div className="flex items-start justify-between px-3 pt-2.5 pb-1">
            <div className="min-w-0 flex-1">
                <div className="font-bold text-gray-900 text-sm leading-tight truncate">
                    Stop-to-Stop Speed
                </div>
                <div className="text-[10px] text-gray-400 mt-0.5">
                    {segment.directionId} · {selectedRoute ? `Route ${selectedRoute} · ` : ''}{periodLabel} · {dayTypeLabel}
                </div>
            </div>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 -mt-0.5 -mr-1 p-1 flex-shrink-0">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
            </button>
        </div>

        <div className="px-3 py-2 border-t border-gray-100">
            <div className="text-[9px] text-gray-400 uppercase mb-0.5">Segment</div>
            <div className="text-xs text-gray-700">
                <span className="font-medium">{segment.fromStopName}</span>
                <span className="text-gray-300 mx-1">→</span>
                <span className="font-medium">{segment.toStopName}</span>
            </div>
            <div className="text-[10px] text-gray-400 mt-1">
                {segment.routes.join(', ')} · {(segment.lengthMeters / 1000).toFixed(2)} km
            </div>
        </div>

        <div className="px-3 py-2 border-t border-gray-100">
            <div className="text-[9px] text-gray-400 uppercase mb-1">Selected Metric</div>
            <div className="text-lg font-bold text-cyan-700">{getMetricDisplayValue(stats, metric)}</div>
            {stats?.lowConfidence && (
                <div className="text-[10px] text-amber-700 mt-1">
                    Low confidence: only {stats.sampleCount} observed runs in this period.
                </div>
            )}
        </div>

        <div className="grid grid-cols-2 gap-0 border-t border-gray-100">
            <div className="px-3 py-2 border-r border-gray-100">
                <div className="text-[9px] text-gray-400 uppercase">Scheduled</div>
                <div className="text-sm font-semibold text-gray-800">{formatRuntime(stats?.scheduledRuntimeMin ?? null)}</div>
                <div className="text-[10px] text-gray-500">{formatSpeed(stats?.scheduledSpeedKmh ?? null)}</div>
            </div>
            <div className="px-3 py-2">
                <div className="text-[9px] text-gray-400 uppercase">Observed</div>
                <div className="text-sm font-semibold text-gray-800">{formatRuntime(stats?.observedRuntimeMin ?? null)}</div>
                <div className="text-[10px] text-gray-500">{formatSpeed(stats?.observedSpeedKmh ?? null)}</div>
            </div>
        </div>

        <div className="grid grid-cols-2 gap-0 border-t border-gray-100">
            <div className="px-3 py-2 border-r border-gray-100">
                <div className="text-[9px] text-gray-400 uppercase">Delay Delta</div>
                <div className="text-sm font-semibold text-gray-800">
                    {stats?.runtimeDeltaMin === null ? 'No data' : `${stats.runtimeDeltaMin > 0 ? '+' : ''}${stats.runtimeDeltaMin.toFixed(1)} min`}
                </div>
            </div>
            <div className="px-3 py-2">
                <div className="text-[9px] text-gray-400 uppercase">Sample Count</div>
                <div className="text-sm font-semibold text-gray-800">{stats?.sampleCount ?? 0}</div>
            </div>
        </div>

        <div className="px-3 py-2 border-t border-gray-100">
            <div className="text-[9px] text-gray-400 uppercase mb-1">
                {selectedRoute ? 'Displayed Route' : 'Routes Using This Segment'}
            </div>
            <div className="space-y-1.5">
                {routeBreakdown.map((route) => (
                    <div key={route.route} className="flex items-start justify-between gap-3">
                        <div className="text-xs font-bold text-gray-700">Route {route.route}</div>
                        <div className="text-[10px] text-right text-gray-500">
                            <div>{formatRuntime(route.observedRuntimeMin)}</div>
                            <div>{route.sampleCount} samples</div>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    </div>
    );
};
