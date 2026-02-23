/**
 * Corridor Detail Panel
 *
 * Click-to-detail panel showing route breakdown for a selected corridor segment.
 */

import React from 'react';
import type { CorridorSegment } from '../../utils/gtfs/corridorBuilder';
import { formatHeadway, type SegmentHeadway } from '../../utils/gtfs/corridorHeadway';

interface CorridorDetailPanelProps {
    segment: CorridorSegment;
    headway: SegmentHeadway | null;
    periodLabel: string;
    dayTypeLabel: string;
    onClose: () => void;
}

export const CorridorDetailPanel: React.FC<CorridorDetailPanelProps> = ({
    segment,
    headway,
    periodLabel,
    dayTypeLabel,
    onClose,
}) => {
    const fromStop = segment.stopNames[0];
    const toStop = segment.stopNames[segment.stopNames.length - 1];

    return (
        <div className="absolute top-2 left-2 z-[1000] bg-white/95 backdrop-blur-sm rounded-lg shadow-lg border border-gray-200 w-72 pointer-events-auto">
            {/* Header */}
            <div className="flex items-start justify-between px-3 pt-2.5 pb-1">
                <div className="min-w-0 flex-1">
                    <div className="font-bold text-gray-900 text-sm leading-tight truncate">
                        {segment.isShared ? 'Shared Corridor' : `Route ${segment.routes[0]}`}
                    </div>
                    <div className="text-[10px] text-gray-400 mt-0.5">
                        {segment.stops.length} stops · {periodLabel} · {dayTypeLabel}
                    </div>
                </div>
                <button onClick={onClose} className="text-gray-400 hover:text-gray-600 -mt-0.5 -mr-1 p-1 flex-shrink-0">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                </button>
            </div>

            {/* From → To */}
            <div className="px-3 py-2 border-t border-gray-100">
                <div className="text-[9px] text-gray-400 uppercase mb-0.5">Segment</div>
                <div className="text-xs text-gray-700">
                    <span className="font-medium">{fromStop}</span>
                    <span className="text-gray-300 mx-1">→</span>
                    <span className="font-medium">{toStop}</span>
                </div>
            </div>

            {/* Combined headway */}
            {headway && (
                <div className="px-3 py-2 border-t border-gray-100">
                    <div className="flex items-baseline gap-2">
                        <div className="text-lg font-bold text-teal-700">
                            {formatHeadway(headway.combinedHeadwayMin)}
                        </div>
                        <div className="text-[10px] text-gray-400">
                            combined headway · {headway.combinedTripsPerHour} trips/hr · {headway.totalTrips} total trips
                        </div>
                    </div>
                </div>
            )}

            {/* Route breakdown */}
            <div className="px-3 py-2 border-t border-gray-100">
                <div className="text-[9px] text-gray-400 uppercase mb-1">Routes on This Corridor</div>
                <div className="space-y-1">
                    {segment.routes.map((route, i) => {
                        const breakdown = headway?.routeBreakdown.find(rb => rb.route === route);
                        const color = segment.routeColors[i] || '888888';
                        return (
                            <div key={route} className="flex items-center justify-between">
                                <div className="flex items-center gap-1.5">
                                    <span
                                        className="inline-block w-3 h-3 rounded-sm flex-shrink-0"
                                        style={{ backgroundColor: `#${color}` }}
                                    />
                                    <span className="text-xs font-bold text-gray-700">Route {route}</span>
                                </div>
                                <div className="text-xs text-gray-500 tabular-nums">
                                    {breakdown
                                        ? `${breakdown.trips} trips · ${formatHeadway(breakdown.headwayMin)}`
                                        : '—'
                                    }
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
};
