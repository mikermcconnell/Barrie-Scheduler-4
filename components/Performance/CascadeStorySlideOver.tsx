import React, { useEffect, useMemo, useState } from 'react';
import {
    Activity,
    ArrowRight,
    AlertTriangle,
    CheckCircle2,
    Clock3,
    MapPin,
    Route,
    TrendingDown,
    X,
    Zap,
} from 'lucide-react';
import type { CascadeAffectedTrip, DailySummary, DwellCascade, DwellSeverity } from '../../utils/performanceDataTypes';
import type { StopLoadData } from '../../utils/schedule/cascadeStoryUtils';
import { buildCascadeLateDepartureImpactByRoute } from '../../utils/schedule/cascadeImpactUtils';
import CascadeTimelineChart from './CascadeTimelineChart';
import CascadeTripChain from './CascadeTripChain';
import CascadeRouteMap from './CascadeRouteMap';

interface CascadeStorySlideOverProps {
    cascade: DwellCascade;
    onClose: () => void;
    stopLoadLookup: Map<string, StopLoadData>;
    dailySummaries: DailySummary[];
}

type MilestoneTone = 'blue' | 'emerald' | 'amber' | 'red';

const fmtTime = (hhmm: string): string => hhmm.length >= 5 ? hhmm.slice(0, 5) : hhmm;
const fmtMin = (sec: number): string => (sec / 60).toFixed(1);

const toneMap: Record<MilestoneTone, { card: string; icon: string; text: string; badge: string }> = {
    blue: {
        card: 'border-blue-200 bg-blue-50',
        icon: 'border-blue-100 bg-white text-brand-blue',
        text: 'text-blue-900',
        badge: 'border-blue-200 bg-white text-brand-blue',
    },
    emerald: {
        card: 'border-emerald-200 bg-emerald-50',
        icon: 'border-emerald-100 bg-white text-emerald-600',
        text: 'text-emerald-900',
        badge: 'border-emerald-200 bg-white text-emerald-700',
    },
    amber: {
        card: 'border-amber-200 bg-amber-50',
        icon: 'border-amber-100 bg-white text-amber-600',
        text: 'text-amber-900',
        badge: 'border-amber-200 bg-white text-amber-700',
    },
    red: {
        card: 'border-red-200 bg-red-50',
        icon: 'border-red-100 bg-white text-red-600',
        text: 'text-red-900',
        badge: 'border-red-200 bg-white text-red-700',
    },
};

const SeverityBadge: React.FC<{ severity: DwellSeverity }> = ({ severity }) => (
    <span className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-bold uppercase tracking-[0.18em] ${
        severity === 'high'
            ? 'border-red-200 bg-red-50 text-red-700'
            : severity === 'moderate'
                ? 'border-amber-200 bg-amber-50 text-amber-700'
                : 'border-blue-200 bg-blue-50 text-brand-blue'
    }`}>
        {severity}
    </span>
);

const WorkspaceCard: React.FC<{ title: string; subtitle?: string; children: React.ReactNode }> = ({ title, subtitle, children }) => (
    <section className="rounded-3xl border-2 border-gray-200 bg-white p-5 shadow-sm">
        <div className="mb-4 flex items-start justify-between gap-4">
            <div>
                <p className="text-xs font-extrabold uppercase tracking-[0.18em] text-gray-400">{title}</p>
                {subtitle ? <p className="mt-1 text-sm font-semibold text-gray-500">{subtitle}</p> : null}
            </div>
        </div>
        {children}
    </section>
);

const MetricBlock: React.FC<{
    label: string;
    value: string;
    note: string;
    tone: MilestoneTone;
}> = ({ label, value, note, tone }) => {
    const styles = toneMap[tone];
    return (
        <div className={`rounded-2xl border-2 p-4 ${styles.card}`}>
            <div className="text-xs font-extrabold uppercase tracking-[0.18em] text-gray-500">{label}</div>
            <div className={`mt-2 text-2xl font-extrabold ${styles.text}`}>{value}</div>
            <div className="mt-1 text-sm font-semibold text-gray-600">{note}</div>
        </div>
    );
};

const PhaseSectionCard: React.FC<{
    tone: MilestoneTone;
    phase: string;
    headline: string;
    detail: string;
    metricLabel: string;
    metricValue: string;
}> = ({ tone, phase, headline, detail, metricLabel, metricValue }) => {
    const styles = toneMap[tone];
    return (
        <div className={`rounded-2xl border-2 p-4 ${styles.card}`}>
            <div className="flex items-start justify-between gap-3">
                <div>
                    <p className="text-xs font-extrabold uppercase tracking-[0.18em] text-gray-500">{phase}</p>
                    <p className={`mt-1 text-sm font-extrabold ${styles.text}`}>{headline}</p>
                </div>
                <span className={`rounded-full border px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-[0.16em] ${styles.badge}`}>
                    {metricLabel}: {metricValue}
                </span>
            </div>
            <p className="mt-2 text-sm font-semibold text-gray-600">{detail}</p>
        </div>
    );
};

const StoryStep: React.FC<{
    tone: MilestoneTone;
    icon: React.ReactNode;
    label: string;
    headline: string;
    detail: string;
    badge?: string;
}> = ({ tone, icon, label, headline, detail, badge }) => {
    const styles = toneMap[tone];
    return (
        <div className={`rounded-2xl border-2 p-4 ${styles.card}`}>
            <div className="flex items-start gap-3">
                <div className={`flex h-11 w-11 items-center justify-center rounded-2xl border-2 ${styles.icon}`}>
                    {icon}
                </div>
                <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                        <p className="text-xs font-extrabold uppercase tracking-[0.18em] text-gray-500">{label}</p>
                        {badge ? (
                            <span className={`rounded-full border px-2.5 py-0.5 text-[10px] font-extrabold uppercase tracking-[0.16em] ${styles.badge}`}>
                                {badge}
                            </span>
                        ) : null}
                    </div>
                    <p className={`mt-1 text-sm font-extrabold ${styles.text}`}>{headline}</p>
                    <p className="mt-1 text-sm font-semibold text-gray-600">{detail}</p>
                </div>
            </div>
        </div>
    );
};

function hasExplicitThresholdMilestone(cascade: DwellCascade): boolean {
    return cascade.backUnderThresholdAtTrip !== undefined || cascade.backUnderThresholdAtStop !== undefined;
}

function getThresholdMilestone(cascade: DwellCascade): { trip: string | null; stop: string | null } {
    if (hasExplicitThresholdMilestone(cascade)) {
        return {
            trip: cascade.backUnderThresholdAtTrip ?? null,
            stop: cascade.backUnderThresholdAtStop ?? null,
        };
    }
    return {
        trip: cascade.recoveredAtTrip,
        stop: cascade.recoveredAtStop,
    };
}

function getFullRecoveryMilestone(cascade: DwellCascade): { trip: string | null; stop: string | null } {
    if (!hasExplicitThresholdMilestone(cascade)) {
        return { trip: null, stop: null };
    }
    return {
        trip: cascade.recoveredAtTrip,
        stop: cascade.recoveredAtStop,
    };
}

function hasExplicitTripThresholdMilestone(trip: CascadeAffectedTrip): boolean {
    return trip.backUnderThresholdHere !== undefined || trip.backUnderThresholdAtStop !== undefined;
}

function tripBackUnderThresholdHere(trip: CascadeAffectedTrip): boolean {
    return hasExplicitTripThresholdMilestone(trip) ? !!trip.backUnderThresholdHere : !!trip.recoveredHere;
}

function tripRecoveredHere(trip: CascadeAffectedTrip): boolean {
    return hasExplicitTripThresholdMilestone(trip) ? !!trip.recoveredHere : false;
}

function getMilestonePhaseBadge(cascade: DwellCascade, tripName: string | null): string | undefined {
    if (!tripName) return undefined;
    return tripName === cascade.tripName ? 'Same trip' : 'Later trip';
}

const CascadeStorySlideOver: React.FC<CascadeStorySlideOverProps> = ({ cascade, onClose, stopLoadLookup, dailySummaries }) => {
    const [selectedTripIndex, setSelectedTripIndex] = useState<number | null>(null);
    const [selectedPointIndex, setSelectedPointIndex] = useState<number | null>(null);
    const [visible, setVisible] = useState(false);
    const storyTrips = useMemo(
        () => cascade.sameTripImpact ? [cascade.sameTripImpact, ...cascade.cascadedTrips] : cascade.cascadedTrips,
        [cascade.cascadedTrips, cascade.sameTripImpact],
    );
    const sameTripImpact = cascade.sameTripImpact ?? null;
    const sameTripObserved = cascade.sameTripObserved === true;

    const customerImpact = useMemo(() => {
        let affectedBoardings = 0;
        let lateBoardings = 0;
        for (const trip of storyTrips) {
            for (const tp of trip.timepoints) {
                const boardings = tp.boardings ?? 0;
                if ((tp.deviationSeconds ?? 0) > 0) affectedBoardings += boardings;
                if (tp.isLate) lateBoardings += boardings;
            }
        }
        if (affectedBoardings === 0 && lateBoardings === 0) return null;
        return { affectedBoardings, lateBoardings };
    }, [storyTrips]);

    const otpImpact = useMemo(() => {
        const rows = buildCascadeLateDepartureImpactByRoute(cascade, dailySummaries);
        return rows.length > 0 ? rows : null;
    }, [cascade, dailySummaries]);

    const thresholdMilestone = useMemo(() => getThresholdMilestone(cascade), [cascade]);
    const fullRecoveryMilestone = useMemo(() => getFullRecoveryMilestone(cascade), [cascade]);
    const thresholdPhaseBadge = useMemo(
        () => getMilestonePhaseBadge(cascade, thresholdMilestone.trip),
        [cascade, thresholdMilestone.trip],
    );
    const fullRecoveryPhaseBadge = useMemo(
        () => getMilestonePhaseBadge(cascade, fullRecoveryMilestone.trip),
        [cascade, fullRecoveryMilestone.trip],
    );
    const firstObservedTrip = storyTrips[0]?.tripName ?? null;
    const firstObservedStop = storyTrips[0]?.timepoints[0]?.stopName ?? null;
    const startsOnLaterTrip = firstObservedTrip !== null && firstObservedTrip !== cascade.tripName;
    const sameTripLateSeconds = sameTripImpact?.lateSeconds ?? 0;
    const sameTripOtpLateDepartures = sameTripImpact?.lateTimepointCount ?? 0;
    const laterTripOtpLateDepartures = cascade.blastRadius;
    const sameTripPhaseTone: MilestoneTone = sameTripImpact
        ? sameTripImpact.recoveredHere
            ? 'emerald'
            : sameTripImpact.lateTimepointCount > 0
                ? 'red'
                : sameTripImpact.affectedTimepointCount > 0
                    ? 'amber'
                    : 'emerald'
        : 'amber';
    const sameTripPhaseHeadline = sameTripImpact
        ? sameTripImpact.recoveredHere
            ? 'Recovered before the incident trip ended'
            : sameTripImpact.backUnderThresholdHere
                ? `Back under 5 min by ${sameTripImpact.backUnderThresholdAtStop}`
                : sameTripImpact.affectedTimepointCount > 0
                    ? `${sameTripImpact.affectedTimepointCount} same-trip points carried delay`
                    : 'No same-trip delay remained at the first observed point'
        : sameTripObserved
            ? 'Same-trip phase was observed'
            : 'Same-trip result is unknown';
    const sameTripPhaseDetail = sameTripImpact
        ? sameTripImpact.lateTimepointCount > 0
            ? `${sameTripImpact.lateTimepointCount} observed same-trip departures stayed above the OTP threshold after the dwell.`
            : sameTripImpact.affectedTimepointCount > 0
                ? 'The incident trip still carried dwell-attributed delay, but it stayed below the OTP-late threshold.'
                : 'The first observed downstream same-trip point showed no remaining dwell-attributed delay.'
        : sameTripObserved
            ? 'Observed same-trip points were available, but no dwell-attributed carryover segment needed to be shown.'
            : 'No observed downstream timepoint was available after the dwell stop on the incident trip.';
    const laterTripPhaseTone: MilestoneTone = cascade.affectedTripCount > 0
        ? 'amber'
        : cascade.recoveredAtTrip === cascade.tripName
            ? 'emerald'
            : cascade.recoveryTimeAvailableSeconds === 0
                ? 'blue'
                : 'emerald';
    const laterTripPhaseHeadline = cascade.affectedTripCount > 0
        ? `${cascade.affectedTripCount} later trips still carried delay`
        : cascade.recoveredAtTrip === cascade.tripName
            ? 'Absorbed before later-trip carryover began'
            : cascade.recoveryTimeAvailableSeconds === 0
                ? 'No later trip was available in this block'
                : 'No later-trip carryover was observed';
    const laterTripPhaseDetail = cascade.affectedTripCount > 0
        ? `${fmtMin(cascade.totalLateSeconds)} dwell-attributed minutes remained visible after the incident trip, including ${cascade.blastRadius} OTP-late departures.`
        : cascade.recoveredAtTrip === cascade.tripName
            ? 'The delay cleared on the incident trip before it could carry into the next scheduled trip.'
            : cascade.recoveryTimeAvailableSeconds === 0
                ? 'This incident happened on the last trip in the block, so there was no later trip to trace.'
                : 'Later trips were observed, but none carried measurable dwell-attributed delay.';

    const focusTripIndex = useMemo(() => {
        if (selectedTripIndex !== null) return selectedTripIndex;
        if (sameTripImpact) return 0;
        const recoveredIdx = storyTrips.findIndex(trip => tripRecoveredHere(trip));
        if (recoveredIdx >= 0) return recoveredIdx;
        const thresholdIdx = storyTrips.findIndex(trip => tripBackUnderThresholdHere(trip));
        if (thresholdIdx >= 0) return thresholdIdx;
        return storyTrips.length > 0 ? storyTrips.length - 1 : null;
    }, [sameTripImpact, selectedTripIndex, storyTrips]);

    const focusTrip = focusTripIndex !== null ? storyTrips[focusTripIndex] ?? null : null;

    useEffect(() => {
        const frame = requestAnimationFrame(() => setVisible(true));
        return () => cancelAnimationFrame(frame);
    }, []);

    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        document.addEventListener('keydown', handler);
        return () => document.removeEventListener('keydown', handler);
    }, [onClose]);

    return (
        <>
            <div
                className="fixed inset-0 z-40 bg-slate-900/35 backdrop-blur-sm"
                onClick={onClose}
                style={{
                    opacity: visible ? 1 : 0,
                    transition: 'opacity 200ms ease-out',
                }}
            />

            <div
                className="fixed inset-3 z-50 flex flex-col overflow-hidden rounded-[32px] border-2 border-gray-200 bg-[#F7F7F7] shadow-2xl md:inset-6"
                style={{
                    transform: visible ? 'translateY(0)' : 'translateY(16px)',
                    opacity: visible ? 1 : 0,
                    transition: 'transform 260ms ease-out, opacity 260ms ease-out',
                }}
            >
                <div className="border-b-2 border-gray-200 bg-white px-5 py-5 md:px-7">
                    <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-3">
                                <div className="flex h-12 w-12 items-center justify-center rounded-2xl border-2 border-red-100 bg-red-50 text-red-600">
                                    <Zap size={22} />
                                </div>
                                <div className="min-w-0">
                                    <h2 className="text-2xl font-extrabold text-gray-900">Dwell Incident Story</h2>
                                    <p className="text-sm font-semibold text-gray-500">
                                        Follow the incident on the same trip first, then see whether it carried into later trips on the block.
                                    </p>
                                </div>
                                <SeverityBadge severity={cascade.severity} />
                            </div>

                            <div className="mt-4 flex flex-wrap items-center gap-2 text-sm font-semibold text-gray-600">
                                <span className="rounded-full border border-gray-200 bg-gray-50 px-3 py-1">Route {cascade.routeId}</span>
                                <span className="rounded-full border border-gray-200 bg-gray-50 px-3 py-1 font-mono">Block {cascade.block}</span>
                                <span className="rounded-full border border-gray-200 bg-gray-50 px-3 py-1">{cascade.date}</span>
                                <span className="rounded-full border border-gray-200 bg-gray-50 px-3 py-1">{cascade.stopName}</span>
                                <span className="rounded-full border border-gray-200 bg-gray-50 px-3 py-1">{fmtTime(cascade.observedDepartureTime)}</span>
                                <span className="rounded-full border border-red-200 bg-red-50 px-3 py-1 text-red-700">
                                    +{fmtMin(cascade.trackedDwellSeconds)} min dwell
                                </span>
                                <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-amber-700">
                                    {fmtMin(cascade.baselineLateSeconds ?? 0)} min pre-existing late
                                </span>
                            </div>

                            {startsOnLaterTrip ? (
                                <div className="mt-4 flex items-start gap-2 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">
                                    <AlertTriangle size={16} className="mt-0.5 shrink-0 text-amber-500" />
                                    <span>
                                        Current traced path starts on a later trip in the same block
                                        {firstObservedTrip ? ` (${firstObservedTrip}` : ''}
                                        {firstObservedStop ? ` at ${firstObservedStop}` : ''}
                                        {firstObservedTrip ? ')' : ''}.
                                        {' '}This view begins at the first observed downstream timepoint available after the dwell, so the first visible point may be far from the origin stop.
                                    </span>
                                </div>
                            ) : null}
                        </div>

                        <button
                            onClick={onClose}
                            className="flex h-11 w-11 items-center justify-center rounded-2xl border-2 border-gray-200 bg-gray-50 text-gray-500 transition-colors hover:bg-white hover:text-gray-700"
                            aria-label="Close"
                        >
                            <X size={18} />
                        </button>
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto p-4 md:p-6">
                    <div className="grid grid-cols-1 gap-5 xl:grid-cols-[290px_minmax(0,1fr)_320px]">
                        <div className="space-y-5">
                            <WorkspaceCard
                                title="Story Path"
                                subtitle="Planner-facing milestones for this dwell incident."
                            >
                                <div className="space-y-3">
                                    <StoryStep
                                        tone="red"
                                        icon={<MapPin size={18} />}
                                        label="Dwell incident"
                                        badge={cascade.tripName}
                                        headline={`${cascade.stopName} at ${fmtTime(cascade.observedDepartureTime)}`}
                                        detail={`${fmtMin(cascade.trackedDwellSeconds)} minutes of excess dwell with ${fmtMin(cascade.baselineLateSeconds ?? 0)} minutes of pre-existing lateness entering the stop.`}
                                    />
                                    {sameTripImpact ? (
                                        <StoryStep
                                            tone={sameTripPhaseTone}
                                            icon={<Route size={18} />}
                                            label="Same-trip impact"
                                            badge="Same trip"
                                            headline={sameTripImpact.recoveredHere
                                                ? `Recovered on ${cascade.tripName} at ${sameTripImpact.recoveredAtStop}`
                                                : sameTripImpact.backUnderThresholdHere
                                                    ? `Same-trip delay dropped under 5 min at ${sameTripImpact.backUnderThresholdAtStop}`
                                                    : sameTripImpact.affectedTimepointCount > 0
                                                        ? `${sameTripImpact.affectedTimepointCount} same-trip points still carried delay`
                                                        : 'Same-trip delay was not observed'}
                                            detail={sameTripImpact.lateTimepointCount > 0
                                                ? `${sameTripImpact.lateTimepointCount} same-trip departures stayed above the OTP threshold after the dwell.`
                                                : sameTripImpact.affectedTimepointCount > 0
                                                    ? 'The incident trip still carried dwell-attributed delay, but it stayed below the OTP-late threshold.'
                                                    : 'The first observed downstream same-trip point showed no remaining dwell-attributed delay.'}
                                        />
                                    ) : !sameTripObserved ? (
                                        <StoryStep
                                            tone="amber"
                                            icon={<AlertTriangle size={18} />}
                                            label="Same-trip impact"
                                            badge="Unknown"
                                            headline="No same-trip observation available"
                                            detail="There was no observed downstream timepoint after the dwell on the incident trip, so the story resumes only when later-trip observations are available."
                                        />
                                    ) : null}
                                    <StoryStep
                                        tone={laterTripPhaseTone}
                                        icon={<ArrowRight size={18} />}
                                        label="Later-trip carryover"
                                        headline={cascade.affectedTripCount > 0
                                            ? `${cascade.affectedTripCount} later trips touched`
                                            : cascade.recoveredAtTrip === cascade.tripName
                                                ? 'Absorbed before the next trip'
                                                : cascade.recoveryTimeAvailableSeconds === 0
                                                    ? 'No later trip in this block'
                                                    : 'No later-trip carryover observed'}
                                        detail={laterTripPhaseDetail}
                                        badge={cascade.affectedTripCount > 0 ? `${cascade.blastRadius} OTP-late departures` : 'No later carryover'}
                                    />
                                    <StoryStep
                                        tone={thresholdMilestone.trip ? 'blue' : 'amber'}
                                        icon={<TrendingDown size={18} />}
                                        label="Back Under 5 Min"
                                        badge={thresholdPhaseBadge}
                                        headline={thresholdMilestone.trip && thresholdMilestone.stop
                                            ? `${thresholdMilestone.trip} at ${thresholdMilestone.stop}`
                                            : 'Route never came back under the OTP threshold'}
                                        detail={thresholdMilestone.trip
                                            ? 'This is the first observed point where dwell-attributed delay dropped to five minutes or less.'
                                            : 'Every observed point in the traced story stayed above the OTP-late threshold.'}
                                    />
                                    <StoryStep
                                        tone={fullRecoveryMilestone.trip ? 'emerald' : 'amber'}
                                        icon={<CheckCircle2 size={18} />}
                                        label="Recovered To Zero"
                                        badge={fullRecoveryPhaseBadge}
                                        headline={fullRecoveryMilestone.trip && fullRecoveryMilestone.stop
                                            ? `${fullRecoveryMilestone.trip} at ${fullRecoveryMilestone.stop}`
                                            : 'Full recovery was not observed'}
                                        detail={fullRecoveryMilestone.trip
                                            ? 'At this point, no dwell-attributed delay remained on the block.'
                                            : 'The route still carried some dwell-attributed delay by the end of the traced story.'}
                                    />
                                </div>
                            </WorkspaceCard>

                            <WorkspaceCard
                                title="Story Sections"
                                subtitle="Separate the incident trip remainder from any later-trip carryover."
                            >
                                <div className="space-y-3">
                                    <PhaseSectionCard
                                        tone={sameTripPhaseTone}
                                        phase="Incident trip remainder"
                                        headline={sameTripPhaseHeadline}
                                        detail={sameTripPhaseDetail}
                                        metricLabel="Observed points"
                                        metricValue={sameTripImpact ? `${sameTripImpact.affectedTimepointCount}` : sameTripObserved ? '0' : 'Unknown'}
                                    />
                                    <PhaseSectionCard
                                        tone={laterTripPhaseTone}
                                        phase="Later block trips"
                                        headline={laterTripPhaseHeadline}
                                        detail={laterTripPhaseDetail}
                                        metricLabel="Trips touched"
                                        metricValue={`${cascade.affectedTripCount}`}
                                    />
                                </div>
                            </WorkspaceCard>

                            <WorkspaceCard
                                title="Trip Story Chain"
                                subtitle="Same-trip impact first, then later trips on the block when carryover survives."
                            >
                                <CascadeTripChain
                                    cascade={cascade}
                                    selectedTripIndex={selectedTripIndex}
                                    onSelectTrip={setSelectedTripIndex}
                                />
                            </WorkspaceCard>
                        </div>

                        <div className="space-y-5">
                            <WorkspaceCard
                                title="Story Route Map"
                                subtitle="Origin, same-trip observations, and later-trip carryover on the route."
                            >
                                <CascadeRouteMap
                                    cascade={cascade}
                                    selectedPointIndex={selectedPointIndex}
                                    selectedTripIndex={selectedTripIndex}
                                    stopLoadLookup={stopLoadLookup}
                                />
                            </WorkspaceCard>

                            <WorkspaceCard
                                title="Incident Delay Timeline"
                                subtitle="Dwell-attributed delay across observed same-trip and later-trip timepoints."
                            >
                                <CascadeTimelineChart
                                    trips={storyTrips}
                                    routeId={cascade.routeId}
                                    selectedTripIndex={selectedTripIndex}
                                    onSelectPoint={setSelectedPointIndex}
                                    stopLoadLookup={stopLoadLookup}
                                    dwellOriginStopId={cascade.stopId}
                                    dwellExcessMinutes={cascade.trackedDwellSeconds / 60}
                                />
                            </WorkspaceCard>
                        </div>

                        <div className="space-y-5">
                            <WorkspaceCard
                                title="Incident Summary"
                                subtitle="What the dwell added on the incident trip and what carried beyond it."
                            >
                                <div className="space-y-4">
                                    <div>
                                        <div className="mb-3 flex items-center gap-2">
                                            <span className="rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-[10px] font-extrabold uppercase tracking-[0.18em] text-brand-blue">
                                                Same trip
                                            </span>
                                            <p className="text-xs font-extrabold uppercase tracking-[0.18em] text-gray-400">Incident trip remainder</p>
                                        </div>
                                        <MetricBlock
                                            label="Same-Trip Delay Carried"
                                            value={sameTripImpact ? `${fmtMin(sameTripLateSeconds)} min` : 'Unknown'}
                                            note={sameTripImpact
                                                ? sameTripImpact.recoveredHere
                                                    ? 'The incident trip recovered before it ended.'
                                                    : 'Observed delay carried on the remainder of the incident trip.'
                                                : 'No downstream same-trip observation was available after the dwell stop.'}
                                            tone={sameTripPhaseTone}
                                        />
                                        <div className="mt-3">
                                            <MetricBlock
                                                label="Same-Trip OTP-Late Departures"
                                                value={`${sameTripOtpLateDepartures}`}
                                                note="Observed departures on the incident trip remainder that stayed above the 5-minute OTP threshold."
                                                tone={sameTripOtpLateDepartures > 0 ? 'red' : 'blue'}
                                            />
                                        </div>
                                    </div>

                                    <div>
                                        <div className="mb-3 flex items-center gap-2">
                                            <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-[10px] font-extrabold uppercase tracking-[0.18em] text-amber-700">
                                                Later trips
                                            </span>
                                            <p className="text-xs font-extrabold uppercase tracking-[0.18em] text-gray-400">Carryover beyond the incident trip</p>
                                        </div>
                                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-1">
                                            <MetricBlock
                                                label="Later Trips Touched"
                                                value={`${cascade.affectedTripCount}`}
                                                note="Later trips that still carried any dwell-attributed delay."
                                                tone={cascade.affectedTripCount > 0 ? 'amber' : 'emerald'}
                                            />
                                            <MetricBlock
                                                label="Later-Trip OTP-Late Departures"
                                                value={`${laterTripOtpLateDepartures}`}
                                                note="Observed later-trip departures that still stayed above the 5-minute OTP threshold."
                                                tone={laterTripOtpLateDepartures > 0 ? 'red' : 'blue'}
                                            />
                                            <MetricBlock
                                                label="Recovery Window"
                                                value={`${fmtMin(cascade.recoveryTimeAvailableSeconds)} min`}
                                                note={cascade.observedRecoverySeconds !== undefined
                                                    ? `${fmtMin(cascade.observedRecoverySeconds)} minutes observed between the incident trip and the next trip.`
                                                    : 'Scheduled recovery between the incident trip and the next trip.'}
                                                tone="blue"
                                            />
                                        </div>
                                        <div className="mt-3 grid grid-cols-1 gap-3">
                                            <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4">
                                                <div className="flex flex-wrap items-center justify-between gap-2">
                                                    <div>
                                                        <p className="text-xs font-extrabold uppercase tracking-[0.16em] text-brand-blue">First back under 5 min</p>
                                                        <p className="mt-1 text-sm font-extrabold text-blue-900">
                                                            {thresholdMilestone.trip && thresholdMilestone.stop
                                                                ? `${thresholdMilestone.trip} at ${thresholdMilestone.stop}`
                                                                : 'Not observed'}
                                                        </p>
                                                    </div>
                                                    {thresholdPhaseBadge ? (
                                                        <span className="rounded-full border border-blue-200 bg-white px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-[0.16em] text-brand-blue">
                                                            {thresholdPhaseBadge}
                                                        </span>
                                                    ) : null}
                                                </div>
                                            </div>
                                            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
                                                <div className="flex flex-wrap items-center justify-between gap-2">
                                                    <div>
                                                        <p className="text-xs font-extrabold uppercase tracking-[0.16em] text-emerald-700">Recovered to zero</p>
                                                        <p className="mt-1 text-sm font-extrabold text-emerald-900">
                                                            {fullRecoveryMilestone.trip && fullRecoveryMilestone.stop
                                                                ? `${fullRecoveryMilestone.trip} at ${fullRecoveryMilestone.stop}`
                                                                : 'Not observed'}
                                                        </p>
                                                    </div>
                                                    {fullRecoveryPhaseBadge ? (
                                                        <span className="rounded-full border border-emerald-200 bg-white px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-[0.16em] text-emerald-700">
                                                            {fullRecoveryPhaseBadge}
                                                        </span>
                                                    ) : null}
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </WorkspaceCard>

                            {customerImpact ? (
                                <WorkspaceCard
                                    title="Customer Exposure"
                                    subtitle="APC-derived boardings at observed affected stops in the full incident story."
                                >
                                    <div className="space-y-3">
                                        <MetricBlock
                                            label="Affected Boardings"
                                            value={`${customerImpact.affectedBoardings}`}
                                            note="Boardings at observed stops where the dwell still had measurable delay impact."
                                            tone="blue"
                                        />
                                        <MetricBlock
                                            label="Boardings At OTP-Late Stops"
                                            value={`${customerImpact.lateBoardings}`}
                                            note="Subset of boardings that occurred while the traced story was still above the OTP-late threshold."
                                            tone={customerImpact.lateBoardings > 0 ? 'red' : 'emerald'}
                                        />
                                    </div>
                                </WorkspaceCard>
                            ) : null}

                            {focusTrip ? (
                                <WorkspaceCard
                                    title={focusTrip.phase === 'same-trip' ? 'Focused Same-Trip Segment' : 'Focused Later Trip'}
                                    subtitle={selectedTripIndex !== null
                                        ? 'Selected from the chain.'
                                        : focusTrip.phase === 'same-trip'
                                            ? 'Auto-focused on the incident trip because it contains the first visible story point.'
                                            : 'Auto-focused on the milestone or last touched trip.'}
                                >
                                    <div className="space-y-3">
                                        <div className="rounded-2xl border-2 border-gray-200 bg-gray-50 p-4">
                                            <div className="flex items-start justify-between gap-3">
                                                <div>
                                                    <p className="text-sm font-extrabold text-gray-900">{focusTrip.tripName}</p>
                                                    <p className="mt-1 text-sm font-semibold text-gray-500">
                                                        Route {focusTrip.routeId} · {focusTrip.phase === 'same-trip' ? 'incident trip remainder' : fmtTime(focusTrip.terminalDepartureTime)}
                                                    </p>
                                                </div>
                                                <span className={`rounded-full border px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-[0.16em] ${
                                                    focusTrip.lateTimepointCount > 0
                                                        ? 'border-red-200 bg-red-50 text-red-700'
                                                        : focusTrip.affectedTimepointCount > 0
                                                            ? 'border-amber-200 bg-amber-50 text-amber-700'
                                                            : 'border-emerald-200 bg-emerald-50 text-emerald-700'
                                                }`}>
                                                    {focusTrip.lateTimepointCount > 0 ? 'OTP-late' : focusTrip.affectedTimepointCount > 0 ? 'Carryover' : 'Cleared'}
                                                </span>
                                            </div>
                                        </div>

                                        <div className="grid grid-cols-2 gap-3">
                                            <div className="rounded-2xl border border-gray-200 bg-gray-50 p-3">
                                                <div className="text-xs font-extrabold uppercase tracking-[0.16em] text-gray-400">OTP-late Points</div>
                                                <div className="mt-2 text-lg font-extrabold text-gray-900">{focusTrip.lateTimepointCount}</div>
                                            </div>
                                            <div className="rounded-2xl border border-gray-200 bg-gray-50 p-3">
                                                <div className="text-xs font-extrabold uppercase tracking-[0.16em] text-gray-400">Carryover Points</div>
                                                <div className="mt-2 text-lg font-extrabold text-gray-900">{focusTrip.affectedTimepointCount}</div>
                                            </div>
                                        </div>

                                        <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4 text-sm font-semibold text-gray-600">
                                            {focusTrip.phase === 'same-trip' ? (
                                                <div className="flex items-center gap-2">
                                                    <Clock3 size={15} className="text-gray-400" />
                                                    This segment shows observed downstream points on the incident trip after the dwell stop.
                                                </div>
                                            ) : (
                                                <div className="flex items-center gap-2">
                                                    <Clock3 size={15} className="text-gray-400" />
                                                    Scheduled recovery before this trip: <span className="font-extrabold text-gray-900">{fmtMin(focusTrip.scheduledRecoverySeconds)} min</span>
                                                </div>
                                            )}
                                            {focusTrip.phase !== 'same-trip' && focusTrip.observedRecoverySeconds !== undefined ? (
                                                <div className="mt-2 flex items-center gap-2">
                                                    <Activity size={15} className="text-gray-400" />
                                                    Observed recovery before this trip: <span className="font-extrabold text-gray-900">{fmtMin(focusTrip.observedRecoverySeconds)} min</span>
                                                </div>
                                            ) : null}
                                            <div className="mt-2 flex items-center gap-2">
                                                <ArrowRight size={15} className="text-gray-400" />
                                                {tripRecoveredHere(focusTrip)
                                                    ? `Cleared to zero at ${focusTrip.recoveredAtStop}.`
                                                    : tripBackUnderThresholdHere(focusTrip)
                                                        ? `Came back under five minutes at ${focusTrip.backUnderThresholdAtStop}.`
                                                        : 'Delay carried through this trip without reaching a milestone.'}
                                            </div>
                                        </div>
                                    </div>
                                </WorkspaceCard>
                            ) : null}

                            {otpImpact ? (
                                <WorkspaceCard
                                    title="Route OTP Carryover"
                                    subtitle="Per-route later-trip OTP-late departures attributed to this dwell incident."
                                >
                                    <div className="space-y-3">
                                        {otpImpact.map((impact) => (
                                            <div key={impact.routeId} className="rounded-2xl border-2 border-red-100 bg-red-50 p-4">
                                                <div className="flex items-start justify-between gap-3">
                                                    <div>
                                                        <p className="text-sm font-extrabold text-red-900">Route {impact.routeId}</p>
                                                        <p className="mt-1 text-sm font-semibold text-red-800/80">
                                                            {impact.lateDepartures} OTP-late departures attributed to this dwell.
                                                        </p>
                                                    </div>
                                                    <span className="rounded-full border border-red-200 bg-white px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-[0.16em] text-red-700">
                                                        {impact.penaltyPct.toFixed(1)}%
                                                    </span>
                                                </div>
                                                <p className="mt-3 text-sm font-semibold text-red-800/80">
                                                    {impact.assessedDepartures > 0
                                                        ? `${impact.assessedDepartures} assessed departures on this route for the selected period.`
                                                        : 'No assessed route departures were available for a denominator.'}
                                                </p>
                                            </div>
                                        ))}
                                    </div>
                                </WorkspaceCard>
                            ) : null}
                        </div>
                    </div>
                </div>
            </div>
        </>
    );
};

export default CascadeStorySlideOver;
