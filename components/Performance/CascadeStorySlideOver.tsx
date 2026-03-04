import React, { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import type { DwellCascade, DwellSeverity, DailySummary } from '../../utils/performanceDataTypes';
import type { StopLoadData } from '../../utils/schedule/cascadeStoryUtils';
import { buildTimelinePoints } from '../../utils/schedule/cascadeStoryUtils';
import CascadeTimelineChart from './CascadeTimelineChart';
import CascadeTripChain from './CascadeTripChain';
import CascadeRouteMap from './CascadeRouteMap';

interface CascadeStorySlideOverProps {
    cascade: DwellCascade;
    onClose: () => void;
    stopLoadLookup: Map<string, StopLoadData>;
    dailySummaries: DailySummary[];
}

const fmtTime = (hhmm: string): string => hhmm.length >= 5 ? hhmm.slice(0, 5) : hhmm;
const fmtMin = (sec: number): string => (sec / 60).toFixed(1);

const SeverityBadge: React.FC<{ severity: DwellSeverity }> = ({ severity }) => (
    <span className={`inline-flex items-center px-2 py-0.5 text-xs font-semibold rounded-full ${
        severity === 'high'
            ? 'bg-red-100 text-red-700'
            : 'bg-amber-100 text-amber-700'
    }`}>
        {severity.toUpperCase()}
    </span>
);

const CascadeStorySlideOver: React.FC<CascadeStorySlideOverProps> = ({ cascade, onClose, stopLoadLookup, dailySummaries }) => {
    const [selectedTripIndex, setSelectedTripIndex] = useState<number | null>(null);
    const [selectedPointIndex, setSelectedPointIndex] = useState<number | null>(null);
    const [visible, setVisible] = useState(false);

    // Customer impact: actual APC boardings at late stops
    const customerImpact = useMemo(() => {
        let totalBoardings = 0;
        for (const trip of cascade.cascadedTrips) {
            for (const tp of trip.timepoints) {
                if (!tp.isLate) continue;
                totalBoardings += tp.boardings;
            }
        }
        if (totalBoardings === 0) return null;
        return { totalBoardings };
    }, [cascade.cascadedTrips]);

    // Per-cascade OTP impact
    const otpImpact = useMemo(() => {
        if (cascade.blastRadius === 0) return null;
        let totalRouteTrips = 0;
        for (const d of dailySummaries) {
            const routeMetrics = d.byRoute?.find(r => r.routeId === cascade.routeId);
            if (routeMetrics?.otp?.total) totalRouteTrips += routeMetrics.otp.total;
        }
        if (totalRouteTrips === 0) return null;
        const penaltyPct = (cascade.blastRadius / totalRouteTrips) * 100;
        return { totalRouteTrips, penaltyPct };
    }, [cascade.blastRadius, cascade.routeId, dailySummaries]);

    // Trigger open animation on mount
    useEffect(() => {
        const frame = requestAnimationFrame(() => setVisible(true));
        return () => cancelAnimationFrame(frame);
    }, []);

    // Close on Escape key
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        document.addEventListener('keydown', handler);
        return () => document.removeEventListener('keydown', handler);
    }, [onClose]);

    return (
        <>
            {/* Backdrop */}
            <div
                className="fixed inset-0 bg-black/30 backdrop-blur-sm z-40"
                onClick={onClose}
                style={{
                    opacity: visible ? 1 : 0,
                    transition: 'opacity 200ms ease-out',
                }}
            />

            {/* Slide-over panel */}
            <div
                className="fixed top-0 right-0 h-full w-[70vw] max-w-[1100px] min-w-[600px] bg-white shadow-2xl z-50 flex flex-col"
                style={{
                    transform: visible ? 'translateX(0)' : 'translateX(100%)',
                    transition: 'transform 300ms ease-out',
                }}
            >
                {/* Header */}
                <div className="flex-none border-b border-gray-200 px-6 py-4">
                    <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 mb-1">
                                <h2 className="text-base font-semibold text-gray-900">Cascade Story</h2>
                                <SeverityBadge severity={cascade.severity} />
                            </div>
                            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-gray-600">
                                <span>
                                    <span className="text-gray-400 text-xs mr-1">Route</span>
                                    <span className="font-medium">{cascade.routeId}</span>
                                </span>
                                <span className="text-gray-300">·</span>
                                <span>
                                    <span className="text-gray-400 text-xs mr-1">Block</span>
                                    <span className="font-mono font-medium">{cascade.block}</span>
                                </span>
                                <span className="text-gray-300">·</span>
                                <span className="truncate max-w-[200px]" title={cascade.stopName}>
                                    {cascade.stopName}
                                </span>
                                <span className="text-gray-300">·</span>
                                <span>{fmtTime(cascade.observedDepartureTime)}</span>
                                <span className="text-gray-300">·</span>
                                <span>
                                    <span className="font-medium text-red-600">{fmtMin(cascade.trackedDwellSeconds)} min</span>
                                    <span className="text-gray-400 ml-1">excess dwell</span>
                                </span>
                            </div>
                        </div>
                        <button
                            onClick={onClose}
                            className="flex-none p-1.5 rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
                            aria-label="Close"
                        >
                            <X size={18} />
                        </button>
                    </div>
                </div>

                {/* Quick stats row */}
                <div className="flex items-center gap-4 px-5 py-2 bg-gray-50/50 border-b border-gray-100 text-xs text-gray-600 flex-shrink-0">
                    <span><span className="font-semibold text-red-600">{cascade.affectedTripCount}</span> trips affected</span>
                    <span><span className="font-semibold text-gray-800">{cascade.blastRadius}</span> late departures</span>
                    {Number.isFinite(cascade.recoveryTimeAvailableSeconds) && (
                        <span><span className="font-semibold text-gray-800">{fmtMin(cascade.recoveryTimeAvailableSeconds)}</span> min recovery available</span>
                    )}
                    {cascade.recoveredAtTrip && (
                        <span className="text-emerald-600 font-medium">✓ Recovered at {cascade.recoveredAtTrip}</span>
                    )}
                    {!cascade.recoveredAtTrip && cascade.cascadedTrips.length > 0 && (
                        <span className="text-red-600 font-medium">✗ Never recovered</span>
                    )}
                    {customerImpact && (
                        <>
                            <span className="text-gray-300">|</span>
                            <span>
                                <span className="font-semibold text-gray-800">{customerImpact.totalBoardings}</span>
                                {' '}boardings at late stops
                            </span>
                        </>
                    )}
                </div>

                {/* OTP Impact mini-card */}
                {otpImpact && (
                    <div className="flex items-center gap-3 px-5 py-2 border-b border-gray-100 flex-shrink-0">
                        <div className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-red-50 border border-red-100 text-xs text-red-700">
                            <span className="font-medium">OTP Impact</span>
                            <span className="text-red-400">·</span>
                            <span>
                                Route {cascade.routeId}: <span className="font-semibold">{cascade.blastRadius}</span> late departures
                                of <span className="font-semibold">{otpImpact.totalRouteTrips}</span> assessed
                            </span>
                            <span className="text-red-400">·</span>
                            <span>
                                est. <span className="font-semibold">{otpImpact.penaltyPct.toFixed(1)}%</span> OTP penalty
                            </span>
                        </div>
                    </div>
                )}

                {/* Body — scrollable, 3 panels */}
                <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
                    {/* Panel 1: Timeline chart */}
                    <div className="border border-gray-200 rounded-xl p-4 bg-white" style={{ minHeight: 200 }}>
                        <div className="flex items-center gap-2 mb-2">
                            <h3 className="text-xs font-medium text-gray-400 uppercase tracking-wide">Delay Timeline</h3>
                            <span className="inline-flex items-center px-1.5 py-0.5 text-[10px] font-medium rounded-full bg-gray-100 text-gray-600">
                                {cascade.cascadedTrips.length} trips traced
                            </span>
                        </div>
                        <CascadeTimelineChart
                            trips={cascade.cascadedTrips}
                            routeId={cascade.routeId}
                            selectedTripIndex={selectedTripIndex}
                            onSelectPoint={setSelectedPointIndex}
                            stopLoadLookup={stopLoadLookup}
                            dwellOriginStopId={cascade.stopId}
                            dwellExcessMinutes={cascade.trackedDwellSeconds / 60}
                        />
                    </div>

                    {/* Panel 2: Trip chain */}
                    <div className="border border-gray-200 rounded-xl p-4 bg-white" style={{ minHeight: 120 }}>
                        <h3 className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-2">Trip Chain</h3>
                        <CascadeTripChain
                            cascade={cascade}
                            selectedTripIndex={selectedTripIndex}
                            onSelectTrip={setSelectedTripIndex}
                        />
                    </div>

                    {/* Panel 3: Route map */}
                    <div className="border border-gray-200 rounded-xl p-4 bg-white" style={{ minHeight: 300 }}>
                        <h3 className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-2">Route Map</h3>
                        <CascadeRouteMap
                            cascade={cascade}
                            selectedPointIndex={selectedPointIndex}
                            selectedTripIndex={selectedTripIndex}
                            stopLoadLookup={stopLoadLookup}
                        />
                    </div>
                </div>
            </div>
        </>
    );
};

export default CascadeStorySlideOver;
