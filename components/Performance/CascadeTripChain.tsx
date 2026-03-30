import React, { useMemo } from 'react';
import { AlertTriangle } from 'lucide-react';
import { getTripNodeColor, type TripNodeColor } from '../../utils/schedule/cascadeStoryUtils';
import type { DwellCascade, CascadeAffectedTrip } from '../../utils/performanceDataTypes';

interface CascadeTripChainProps {
    cascade: DwellCascade;
    selectedTripIndex: number | null;
    onSelectTrip: (tripIndex: number | null) => void;
}

const NODE_WIDTH = 140;
const NODE_HEIGHT = 84;
const NODE_GAP = 60;
const ORIGIN_WIDTH = 156;

const fmtMin = (s: number): string => (s / 60).toFixed(0);
const phaseLabel = (phase: 'same-trip' | 'later-trip'): string =>
    phase === 'same-trip' ? 'Same-trip impact' : 'Later-trip carryover';

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
    const trips = cascade.sameTripImpact ? [cascade.sameTripImpact, ...cascade.cascadedTrips] : cascade.cascadedTrips;
    const hasSameTripObservation = cascade.sameTripObserved === true;
    const sameTripCount = trips.filter(trip => trip.phase === 'same-trip').length;
    const laterTripCount = trips.filter(trip => trip.phase !== 'same-trip').length;

    const minWidth = useMemo(() => {
        // origin + (connector + node) * tripCount + end marker
        return ORIGIN_WIDTH + trips.length * (NODE_GAP + NODE_WIDTH) + NODE_GAP + 100;
    }, [trips.length]);

    const hasExplicitThresholdMilestone = cascade.backUnderThresholdAtTrip !== undefined
        || cascade.backUnderThresholdAtStop !== undefined;
    const firstVisibleTrip = trips[0] ?? null;
    const traceStartsOnLaterTrip = firstVisibleTrip !== null && firstVisibleTrip.tripName !== cascade.tripName;

    if (trips.length === 0) {
        return (
            <div className="flex items-center justify-center rounded-2xl border-2 border-dashed border-gray-200 bg-gray-50 px-4 py-8 text-sm font-semibold text-gray-400">
                {hasSameTripObservation
                    ? 'No later trips were touched after the incident trip recovered.'
                    : 'No observed downstream trip data was available for this incident.'}
            </div>
        );
    }

    return (
        <div className="overflow-x-auto">
            {traceStartsOnLaterTrip ? (
                <div className="mb-3 flex items-start gap-2 rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">
                    <AlertTriangle size={14} className="mt-0.5 shrink-0 text-amber-500" />
                    <span>
                        This chain starts at the first observed downstream timepoint on a later trip.
                        {' '}The remainder of the incident trip is not shown yet.
                    </span>
                </div>
            ) : null}
            <div className="mb-3 flex flex-wrap items-center gap-2 text-[11px] font-semibold">
                {sameTripCount > 0 ? (
                    <span className="inline-flex items-center gap-1 rounded-full border border-red-200 bg-red-50 px-3 py-1 text-red-700">
                        <span className="text-[10px] uppercase tracking-[0.16em]">Same trip</span>
                        <span>Incident trip remainder · {sameTripCount}</span>
                    </span>
                ) : null}
                {laterTripCount > 0 ? (
                    <span className="inline-flex items-center gap-1 rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-brand-blue">
                        <span className="text-[10px] uppercase tracking-[0.16em]">Later trips</span>
                        <span>Later block trips · {laterTripCount}</span>
                    </span>
                ) : null}
                <span className="text-gray-500 font-medium">
                    The phase badges and connector callout make it easier to see where the incident trip ends and the downstream carryover begins.
                </span>
            </div>
            <div
                className="flex items-center gap-0"
                style={{ minWidth, height: NODE_HEIGHT + 24 }}
            >
                {/* Origin node */}
                <div
                    className="flex-none rounded-2xl border-2 border-red-200 bg-red-50 px-3 py-3 text-left shadow-sm"
                    style={{ width: ORIGIN_WIDTH, height: NODE_HEIGHT }}
                >
                    <div className="text-[10px] font-extrabold uppercase tracking-[0.18em] text-red-500">Dwell incident</div>
                    <div className="mt-1 font-extrabold text-red-800 text-sm leading-tight">Origin stop</div>
                    <div
                        className="text-red-700 text-xs leading-tight truncate mt-1"
                        title={cascade.stopName}
                    >
                        {cascade.stopName}
                    </div>
                    <div className="mt-2 inline-flex rounded-full border border-red-200 bg-white px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-[0.16em] text-red-700">
                        +{fmtMin(cascade.trackedDwellSeconds)}m dwell
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
                    const isSameTrip = trip.phase === 'same-trip';
                    const backUnderThresholdHere = hasExplicitThresholdMilestone
                        ? !!trip.backUnderThresholdHere
                        : !!trip.recoveredHere;
                    const recoveredHere = hasExplicitThresholdMilestone
                        ? !!trip.recoveredHere
                        : false;

                    return (
                        <React.Fragment key={trip.tripId || i}>
                            {/* Connector line */}
                            <div
                                className="flex-none flex flex-col items-center justify-center"
                                style={{ width: NODE_GAP, height: NODE_HEIGHT }}
                            >
                                {trip.phase === 'later-trip' && trips[i - 1]?.phase === 'same-trip' ? (
                                    <div className="mb-1 inline-flex rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[9px] font-extrabold uppercase tracking-[0.14em] text-slate-600 shadow-sm">
                                        Later-trip carryover
                                    </div>
                                ) : null}
                                <div
                                    style={{
                                        width: '100%',
                                        height: 3,
                                        backgroundColor: colors.line,
                                        opacity: isDimmed ? 0.3 : 1,
                                        transition: 'opacity 150ms',
                                    }}
                                />
                                {recoveryMin > 0 && !isSameTrip && (
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
                                    'flex-none rounded-2xl border-2 px-3 py-2 text-left shadow-sm transition-all',
                                    colors.bg,
                                    colors.border,
                                    isSelected ? 'border-brand-blue bg-white ring-2 ring-cyan-300' : 'hover:-translate-y-0.5 hover:bg-white',
                                    isDimmed ? 'opacity-30' : '',
                                ].join(' ')}
                                style={{ width: NODE_WIDTH, height: NODE_HEIGHT }}
                            >
                                <div className="flex items-start justify-between gap-2">
                                    <div className={`font-semibold text-xs leading-tight truncate ${colors.text}`}>
                                        {trip.tripName}
                                    </div>
                                    <span
                                        className={[
                                            'rounded-full border bg-white px-1.5 py-0.5 text-[9px] font-extrabold uppercase tracking-[0.14em]',
                                            isSameTrip
                                                ? 'border-red-200 text-red-700'
                                                : 'border-blue-200 text-brand-blue',
                                        ].join(' ')}
                                    >
                                        {isSameTrip ? 'Same trip' : 'Later trip'}
                                    </span>
                                    {recoveredHere ? (
                                        <span className="rounded-full border border-emerald-200 bg-white px-1.5 py-0.5 text-[9px] font-extrabold uppercase tracking-[0.14em] text-emerald-700">
                                            Zero
                                        </span>
                                    ) : backUnderThresholdHere ? (
                                        <span className="rounded-full border border-blue-200 bg-white px-1.5 py-0.5 text-[9px] font-extrabold uppercase tracking-[0.14em] text-brand-blue">
                                            &lt;=5m
                                        </span>
                                    ) : null}
                                </div>
                                <div className={`mt-1 text-[10px] font-extrabold uppercase tracking-[0.16em] ${isSameTrip ? 'text-red-600' : 'text-brand-blue'}`}>
                                    {phaseLabel(trip.phase)}
                                </div>
                                <div className="text-gray-500 text-xs leading-tight truncate mt-1">
                                    {isSameTrip ? 'Remainder of the incident trip' : `Route ${trip.routeId} · ${trip.terminalDepartureTime}`}
                                </div>
                                <div className={`text-xs leading-tight mt-2 ${colors.text}`}>
                                    {recoveredHere
                                        ? `Cleared to zero at ${trip.recoveredAtStop}`
                                        : backUnderThresholdHere
                                            ? `Back under 5 min at ${trip.backUnderThresholdAtStop}`
                                            : trip.lateTimepointCount > 0
                                                ? `${trip.lateTimepointCount}/${trip.timepoints.length} OTP-late departures`
                                                : trip.affectedTimepointCount > 0
                                                    ? `${trip.affectedTimepointCount}/${trip.timepoints.length} observed points carried delay`
                                                    : isSameTrip
                                                        ? 'No remaining delay was observed on the incident trip'
                                                        : 'Carryover absorbed in trip'}
                                </div>
                            </button>
                        </React.Fragment>
                    );
                })}

                {/* End marker */}
                <div className="flex-none flex items-center" style={{ width: NODE_GAP + 100, height: NODE_HEIGHT, paddingLeft: NODE_GAP }}>
                    {hasExplicitThresholdMilestone && cascade.recoveredAtTrip ? (
                        <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700 whitespace-nowrap">
                            ✓ Cleared To Zero
                        </span>
                    ) : (hasExplicitThresholdMilestone ? cascade.backUnderThresholdAtTrip : cascade.recoveredAtTrip) ? (
                        <span className="inline-flex items-center gap-1 rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-semibold text-brand-blue whitespace-nowrap">
                            ↓ Under 5 Min
                        </span>
                    ) : (
                        <span className="inline-flex items-center gap-1 rounded-full border border-red-200 bg-red-50 px-3 py-1 text-xs font-semibold text-red-600 whitespace-nowrap">
                            ✗ Carryover Still Visible
                        </span>
                    )}
                </div>
            </div>
        </div>
    );
};

export default CascadeTripChain;
