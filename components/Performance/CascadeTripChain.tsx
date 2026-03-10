import React, { useMemo } from 'react';
import { getTripNodeColor, type TripNodeColor } from '../../utils/schedule/cascadeStoryUtils';
import type { DwellCascade, CascadeAffectedTrip } from '../../utils/performanceDataTypes';

interface CascadeTripChainProps {
    cascade: DwellCascade;
    selectedTripIndex: number | null;
    onSelectTrip: (tripIndex: number | null) => void;
}

const NODE_WIDTH = 140;
const NODE_HEIGHT = 64;
const NODE_GAP = 60;
const ORIGIN_WIDTH = 120;

const fmtMin = (s: number): string => (s / 60).toFixed(0);

type ColorConfig = {
    bg: string;
    border: string;
    text: string;
    line: string;
};

const colorMap: Record<TripNodeColor, ColorConfig> = {
    red: {
        bg: 'bg-red-50',
        border: 'border-red-300',
        text: 'text-red-700',
        line: '#ef4444',
    },
    amber: {
        bg: 'bg-amber-50',
        border: 'border-amber-300',
        text: 'text-amber-700',
        line: '#f59e0b',
    },
    green: {
        bg: 'bg-emerald-50',
        border: 'border-emerald-300',
        text: 'text-emerald-700',
        line: '#10b981',
    },
};

const CascadeTripChain: React.FC<CascadeTripChainProps> = ({
    cascade,
    selectedTripIndex,
    onSelectTrip,
}) => {
    const trips = cascade.cascadedTrips;

    const minWidth = useMemo(() => {
        // origin + (connector + node) * tripCount + end marker
        return ORIGIN_WIDTH + trips.length * (NODE_GAP + NODE_WIDTH) + NODE_GAP + 100;
    }, [trips.length]);

    if (trips.length === 0) {
        return (
            <div className="flex items-center justify-center h-16 text-gray-300 text-sm">
                No downstream trips
            </div>
        );
    }

    return (
        <div className="overflow-x-auto">
            <div
                className="flex items-center gap-0"
                style={{ minWidth, height: NODE_HEIGHT + 24 }}
            >
                {/* Origin node */}
                <div
                    className="flex-none bg-red-100 border-2 border-red-400 rounded-lg px-3 py-2 text-center"
                    style={{ width: ORIGIN_WIDTH, height: NODE_HEIGHT }}
                >
                    <div className="font-bold text-red-800 text-xs leading-tight">⚡ Dwell Event</div>
                    <div
                        className="text-red-600 text-xs leading-tight truncate mt-0.5"
                        title={cascade.stopName}
                    >
                        {cascade.stopName}
                    </div>
                    <div className="font-bold text-red-700 text-xs leading-tight mt-0.5">
                        +{fmtMin(cascade.trackedDwellSeconds)}m excess
                    </div>
                </div>

                {/* Trip nodes with connectors */}
                {trips.map((trip: CascadeAffectedTrip, i: number) => {
                    const tripColor = getTripNodeColor(trip);
                    const colors = colorMap[tripColor];
                    const isSelected = selectedTripIndex === i;
                    const hasSelection = selectedTripIndex !== null;
                    const isDimmed = hasSelection && !isSelected;
                    const recoveryMin = Math.round(trip.scheduledRecoverySeconds / 60);

                    return (
                        <React.Fragment key={trip.tripId || i}>
                            {/* Connector line */}
                            <div
                                className="flex-none flex flex-col items-center justify-center"
                                style={{ width: NODE_GAP, height: NODE_HEIGHT }}
                            >
                                <div
                                    style={{
                                        width: '100%',
                                        height: 3,
                                        backgroundColor: colors.line,
                                        opacity: isDimmed ? 0.3 : 1,
                                        transition: 'opacity 150ms',
                                    }}
                                />
                                {recoveryMin > 0 && (
                                    <div
                                        className="text-gray-400 text-xs mt-1 whitespace-nowrap"
                                        style={{ opacity: isDimmed ? 0.3 : 1, transition: 'opacity 150ms' }}
                                    >
                                        {recoveryMin}m rec
                                    </div>
                                )}
                            </div>

                            {/* Trip node */}
                            <button
                                type="button"
                                onClick={() => onSelectTrip(isSelected ? null : i)}
                                className={[
                                    'flex-none border rounded-lg px-2 py-1 text-left transition-all',
                                    colors.bg,
                                    colors.border,
                                    isSelected ? 'ring-2 ring-cyan-400 shadow-md' : '',
                                    isDimmed ? 'opacity-30' : '',
                                ].join(' ')}
                                style={{ width: NODE_WIDTH, height: NODE_HEIGHT }}
                            >
                                {/* Row 1: trip name + recovered checkmark */}
                                <div className={`font-semibold text-xs leading-tight truncate ${colors.text}`}>
                                    {trip.tripName}
                                    {trip.recoveredHere && (
                                        <span className="ml-1 text-emerald-600">✓</span>
                                    )}
                                </div>
                                {/* Row 2: route + terminal departure */}
                                <div className="text-gray-500 text-xs leading-tight truncate mt-0.5">
                                    Route {trip.routeId} · {trip.terminalDepartureTime}
                                </div>
                                {/* Row 3: downstream impact summary */}
                                <div className={`text-xs leading-tight mt-0.5 ${colors.text}`}>
                                    {trip.lateTimepointCount > 0
                                        ? `${trip.lateTimepointCount}/${trip.timepoints.length} OTP-late`
                                        : trip.affectedTimepointCount > 0
                                            ? `${trip.affectedTimepointCount}/${trip.timepoints.length} delayed`
                                            : 'Recovered in trip'}
                                </div>
                            </button>
                        </React.Fragment>
                    );
                })}

                {/* End marker */}
                <div className="flex-none flex items-center" style={{ width: NODE_GAP + 100, height: NODE_HEIGHT, paddingLeft: NODE_GAP }}>
                    {cascade.recoveredAtTrip ? (
                        <span className="inline-flex items-center gap-1 px-3 py-1 text-xs font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full whitespace-nowrap">
                            ✓ Recovered
                        </span>
                    ) : (
                        <span className="inline-flex items-center gap-1 px-3 py-1 text-xs font-semibold text-red-600 bg-red-50 border border-red-200 rounded-full whitespace-nowrap">
                            ✗ Not recovered
                        </span>
                    )}
                </div>
            </div>
        </div>
    );
};

export default CascadeTripChain;
