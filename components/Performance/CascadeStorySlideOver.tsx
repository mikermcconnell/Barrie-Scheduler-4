import React, { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import type { DwellCascade, DwellSeverity } from '../../utils/performanceDataTypes';
import CascadeTimelineChart from './CascadeTimelineChart';
import CascadeTripChain from './CascadeTripChain';

interface CascadeStorySlideOverProps {
    cascade: DwellCascade;
    onClose: () => void;
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

const CascadeStorySlideOver: React.FC<CascadeStorySlideOverProps> = ({ cascade, onClose }) => {
    const [selectedTripIndex, setSelectedTripIndex] = useState<number | null>(null);
    const [selectedPointIndex, setSelectedPointIndex] = useState<number | null>(null);
    const [visible, setVisible] = useState(false);

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

    // selectedPointIndex used by later panels
    void selectedPointIndex;

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

                {/* Body — scrollable, 3 placeholder panels */}
                <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
                    {/* Panel 1: Timeline chart */}
                    <div className="border border-gray-200 rounded-xl p-4 bg-white" style={{ minHeight: 200 }}>
                        <h3 className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-2">Delay Timeline</h3>
                        <CascadeTimelineChart
                            trips={cascade.cascadedTrips}
                            selectedTripIndex={selectedTripIndex}
                            onSelectPoint={setSelectedPointIndex}
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

                    {/* Panel 3: Route map placeholder */}
                    <div className="border border-gray-200 rounded-xl p-4 bg-white" style={{ minHeight: 300 }}>
                        <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-2">Route Map</p>
                        <div className="flex items-center justify-center h-64 text-gray-300 text-sm">
                            Route map coming in Task 5
                        </div>
                    </div>
                </div>
            </div>
        </>
    );
};

export default CascadeStorySlideOver;
