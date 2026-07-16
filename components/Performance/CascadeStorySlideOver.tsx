import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ChevronDown, X } from 'lucide-react';
import type { DailySummary, DwellCascade, DwellIncident } from '../../utils/performanceDataTypes';
import type { StopLoadData } from '../../utils/schedule/cascadeStoryUtils';
import { getAllStopsWithCoords } from '../../utils/gtfs/gtfsStopLookup';
import CascadeRouteMap, { type CascadeMapPhase } from './CascadeRouteMap';

interface CascadeStorySlideOverProps {
    cascade: DwellCascade;
    incident?: DwellIncident;
    onClose: () => void;
    stopLoadLookup: Map<string, StopLoadData>;
    dailySummaries: DailySummary[];
}

const fmtTime = (value?: string): string => value ? value.slice(0, 5) : 'Unavailable';
const fmtCount = (value?: number | null): string => value == null ? 'Unavailable' : `${value}`;

const CascadeStorySlideOver: React.FC<CascadeStorySlideOverProps> = ({
    cascade,
    incident,
    onClose,
    stopLoadLookup,
}) => {
    const panelRef = useRef<HTMLDivElement | null>(null);
    const closeButtonRef = useRef<HTMLButtonElement | null>(null);
    const [visible, setVisible] = useState(false);
    const [phase, setPhase] = useState<CascadeMapPhase>('whole');
    const storyTrips = useMemo(
        () => cascade.sameTripImpact ? [cascade.sameTripImpact, ...cascade.cascadedTrips] : cascade.cascadedTrips,
        [cascade.cascadedTrips, cascade.sameTripImpact],
    );
    const hasMapCoordinates = useMemo(() => {
        const coordinateStopIds = new Set(getAllStopsWithCoords().map(stop => stop.stop_id));
        return coordinateStopIds.has(cascade.stopId)
            || storyTrips.some(trip => trip.timepoints.some(point => coordinateStopIds.has(point.stopId)));
    }, [cascade.stopId, storyTrips]);

    const sameTripAffectedPoints = cascade.sameTripImpact?.affectedTimepointCount ?? 0;
    const sameTripLateDepartures = cascade.sameTripImpact?.lateTimepointCount ?? 0;
    const otpLateDepartures = sameTripLateDepartures + cascade.blastRadius;
    const sameTripObservedCount = cascade.sameTripObservedTimepointCount
        ?? cascade.sameTripImpact?.timepoints.filter(point => point.observedDeparture !== null).length
        ?? 0;
    const sameTripMissingCount = cascade.sameTripMissingObservedTimepointCount
        ?? cascade.sameTripImpact?.timepoints.filter(point => point.observedDeparture === null).length
        ?? 0;
    const laterObservedCount = cascade.laterTripObservedTimepointCount
        ?? cascade.cascadedTrips.reduce((total, trip) => total + trip.timepoints.filter(point => point.observedDeparture !== null).length, 0);
    const laterMissingCount = cascade.laterTripMissingObservedTimepointCount
        ?? cascade.cascadedTrips.reduce((total, trip) => total + trip.timepoints.filter(point => point.observedDeparture === null).length, 0);
    const missingCount = sameTripMissingCount + laterMissingCount;
    const confidence = cascade.incidentRecordMatched === false
        ? 'Incident unmatched'
        : cascade.sameTripObserved !== true || missingCount > 0
            ? 'Partial coverage'
            : 'Good coverage';
    const observedAffectedBoardings = storyTrips.reduce(
        (total, trip) => total + trip.timepoints.reduce(
            (sum, point) => sum + (point.observedDeparture !== null && (point.deviationSeconds ?? 0) > 0 ? point.boardings ?? 0 : 0),
            0,
        ),
        0,
    );

    useEffect(() => {
        const frame = requestAnimationFrame(() => setVisible(true));
        return () => cancelAnimationFrame(frame);
    }, []);

    useEffect(() => {
        const handler = (event: KeyboardEvent) => {
            if (event.key === 'Escape') onClose();
            if (event.key !== 'Tab' || !panelRef.current) return;
            const focusable = Array.from(panelRef.current.querySelectorAll<HTMLElement>(
                'button:not([disabled]), [href], summary, select:not([disabled]), input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
            ));
            if (focusable.length === 0) return;
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first.focus();
            }
        };
        document.addEventListener('keydown', handler);
        return () => document.removeEventListener('keydown', handler);
    }, [onClose]);

    useEffect(() => {
        if (visible) closeButtonRef.current?.focus();
    }, [visible]);

    const phases: Array<{ id: CascadeMapPhase; label: string; disabled?: boolean }> = [
        { id: 'whole', label: 'Whole story' },
        { id: 'same-trip', label: 'Incident trip', disabled: !cascade.sameTripImpact },
        { id: 'later-trip', label: 'Later trips', disabled: cascade.cascadedTrips.length === 0 },
    ];

    return (
        <>
            <div
                className="fixed inset-0 z-40 bg-slate-900/40 backdrop-blur-sm"
                onClick={onClose}
                style={{ opacity: visible ? 1 : 0, transition: 'opacity 180ms ease-out' }}
            />
            <div
                ref={panelRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby="dwell-incident-review-title"
                className="fixed inset-3 z-50 flex flex-col overflow-hidden rounded-3xl border border-gray-200 bg-white shadow-2xl md:inset-6"
                style={{
                    transform: visible ? 'translateY(0)' : 'translateY(12px)',
                    opacity: visible ? 1 : 0,
                    transition: 'transform 220ms ease-out, opacity 220ms ease-out',
                }}
            >
                <header className="flex shrink-0 items-center justify-between gap-4 border-b border-gray-200 px-4 py-3 md:px-5">
                    <div className="min-w-0">
                        <h2 id="dwell-incident-review-title" className="text-base font-bold text-gray-900">Dwell incident review</h2>
                        <p className="truncate text-xs text-gray-500">
                            Route {cascade.routeId} · {cascade.stopName} · {cascade.date} at {fmtTime(cascade.observedDepartureTime)}
                        </p>
                    </div>
                    <button
                        ref={closeButtonRef}
                        type="button"
                        onClick={onClose}
                        aria-label="Close dwell incident review"
                        className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg p-2 text-gray-500 transition hover:bg-gray-100 hover:text-gray-900 focus:outline-none focus:ring-2 focus:ring-brand-blue"
                    >
                        <X size={20} />
                    </button>
                </header>

                <section aria-label="Outcome metrics" className="grid shrink-0 grid-cols-4 divide-x divide-gray-200 border-b border-gray-200 bg-white lg:hidden">
                    {[
                        ['Same-trip affected', `${sameTripAffectedPoints}`],
                        ['Later trips', `${cascade.affectedTripCount}`],
                        ['OTP-late', `${otpLateDepartures}`],
                        ['Confidence', confidence],
                    ].map(([label, value]) => (
                        <div key={label} className="min-w-0 px-2 py-2 text-center">
                            <div className="truncate text-[9px] font-bold uppercase tracking-wide text-gray-500">{label}</div>
                            <div className="mt-0.5 text-[11px] font-bold leading-4 text-gray-900">{value}</div>
                        </div>
                    ))}
                </section>

                <main className="relative min-h-0 flex-1 overflow-hidden bg-gray-100">
                    {hasMapCoordinates ? (
                        <CascadeRouteMap
                            cascade={cascade}
                            phase={phase}
                            stopLoadLookup={stopLoadLookup}
                        />
                    ) : (
                        <div className="flex h-full items-center justify-center p-6">
                            <div className="max-w-xl rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
                                <div className="flex items-start gap-3">
                                    <AlertTriangle className="mt-0.5 shrink-0 text-amber-500" size={20} />
                                    <div>
                                        <h3 className="font-bold text-gray-900">Map unavailable for this incident</h3>
                                        <p className="mt-1 text-sm text-gray-600">
                                            Stop coordinates are missing. The observed evidence below is still available; missing map data does not indicate recovery.
                                        </p>
                                        <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
                                            <div><dt className="text-gray-500">Effective dwell</dt><dd className="font-bold text-gray-900">{(cascade.trackedDwellSeconds / 60).toFixed(1)} min</dd></div>
                                            <div><dt className="text-gray-500">Same-trip points</dt><dd className="font-bold text-gray-900">{sameTripAffectedPoints}</dd></div>
                                            <div><dt className="text-gray-500">Later trips touched</dt><dd className="font-bold text-gray-900">{cascade.affectedTripCount}</dd></div>
                                            <div><dt className="text-gray-500">OTP-late departures</dt><dd className="font-bold text-gray-900">{otpLateDepartures}</dd></div>
                                            <div className="col-span-2"><dt className="text-gray-500">Recovery</dt><dd className="font-bold text-gray-900">{cascade.recoveredAtStop ? `Observed at ${cascade.recoveredAtStop}` : 'Not observed before the evidence ended'}</dd></div>
                                        </dl>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    {hasMapCoordinates ? <section aria-label="Incident summary" className="absolute left-3 top-3 z-20 max-w-[min(340px,calc(100%-1.5rem))] rounded-xl border border-gray-200 bg-white/95 p-3 shadow-lg backdrop-blur md:left-4 md:top-4 md:p-4">
                        <div className="flex flex-wrap items-center gap-2 text-xs font-semibold">
                            <span className={cascade.severity === 'high' ? 'text-red-700' : 'text-amber-700'}>{cascade.severity.toUpperCase()}</span>
                            <span className="text-gray-300">•</span>
                            <span className="text-gray-500">Trip {cascade.tripName}</span>
                        </div>
                        <div className="mt-1 text-xl font-bold text-gray-900 md:text-2xl">{(cascade.trackedDwellSeconds / 60).toFixed(1)} min effective dwell</div>
                        <p className="mt-1 text-xs leading-4 text-gray-600">Associated-delay evidence—not proof of sole cause.</p>
                        <p className="mt-2 hidden text-xs text-gray-500 sm:block">Operator {cascade.operatorId || 'unavailable'} · Block {cascade.block || 'unavailable'}</p>
                    </section> : null}

                    {hasMapCoordinates ? <section aria-label="Outcome metrics" className="absolute right-3 top-3 z-20 hidden grid-cols-4 overflow-hidden rounded-2xl border border-gray-200 bg-white/95 shadow-lg backdrop-blur lg:grid">
                        {[
                            ['Same-trip affected', `${sameTripAffectedPoints}`],
                            ['Later trips', `${cascade.affectedTripCount}`],
                            ['OTP-late departures', `${otpLateDepartures}`],
                            ['Confidence', confidence],
                        ].map(([label, value]) => (
                            <div key={label} className="min-w-[105px] border-r border-gray-200 px-3 py-3 last:border-r-0">
                                <div className="text-[10px] font-bold uppercase tracking-wider text-gray-500">{label}</div>
                                <div className="mt-1 text-sm font-bold text-gray-900">{value}</div>
                            </div>
                        ))}
                    </section> : null}

                    {hasMapCoordinates ? <div className="absolute bottom-3 left-1/2 z-20 flex -translate-x-1/2 rounded-xl border border-gray-200 bg-white p-1 shadow-lg" role="group" aria-label="Map phase">
                        {phases.map(item => (
                            <button
                                key={item.id}
                                type="button"
                                disabled={item.disabled}
                                onClick={() => setPhase(item.id)}
                                aria-pressed={phase === item.id}
                                className={`min-h-11 whitespace-nowrap rounded-lg px-3 py-2 text-xs font-semibold transition focus:outline-none focus:ring-2 focus:ring-brand-blue ${phase === item.id ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-gray-100'} disabled:cursor-not-allowed disabled:opacity-35`}
                            >
                                {item.label}
                            </button>
                        ))}
                    </div> : null}
                </main>

                <details className="group shrink-0 border-t border-gray-200 bg-white">
                    <summary className="flex cursor-pointer list-none items-center justify-between px-5 py-3 text-sm font-semibold text-gray-700 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-brand-blue">
                        Incident details
                        <ChevronDown size={17} className="transition-transform group-open:rotate-180" />
                    </summary>
                    <div className="grid max-h-52 gap-5 overflow-y-auto border-t border-gray-100 px-5 py-4 text-sm md:grid-cols-4">
                        <dl className="space-y-2">
                            <div><dt className="text-gray-500">Scheduled arrival</dt><dd className="font-semibold text-gray-900">{fmtTime(incident?.scheduledArrivalTime)}</dd></div>
                            <div><dt className="text-gray-500">Observed arrival</dt><dd className="font-semibold text-gray-900">{fmtTime(incident?.observedArrivalTime)}</dd></div>
                            <div><dt className="text-gray-500">Scheduled departure</dt><dd className="font-semibold text-gray-900">{fmtTime(incident?.scheduledDepartureTime)}</dd></div>
                            <div><dt className="text-gray-500">Observed departure</dt><dd className="font-semibold text-gray-900">{fmtTime(incident?.observedDepartureTime ?? cascade.observedDepartureTime)}</dd></div>
                        </dl>
                        <dl className="space-y-2">
                            <div><dt className="text-gray-500">Boardings / alightings</dt><dd className="font-semibold text-gray-900">{fmtCount(incident?.boardings)} / {fmtCount(incident?.alightings)}</dd></div>
                            <div><dt className="text-gray-500">Wheelchair activity</dt><dd className="font-semibold text-gray-900">{fmtCount(incident?.wheelchairUsageCount)}</dd></div>
                            <div><dt className="text-gray-500">Departure load</dt><dd className="font-semibold text-gray-900">{incident?.departureLoadReliable === false ? 'Unavailable (unreliable reading)' : fmtCount(incident?.departureLoad)}</dd></div>
                            <div><dt className="text-gray-500">Boardings at observed affected points</dt><dd className="font-semibold text-gray-900">{observedAffectedBoardings}</dd></div>
                        </dl>
                        <dl className="space-y-2">
                            <div><dt className="text-gray-500">Vehicle</dt><dd className="font-semibold text-gray-900">{incident?.vehicleId || 'Unavailable'}</dd></div>
                            <div><dt className="text-gray-500">Direction</dt><dd className="font-semibold text-gray-900">{incident?.direction || 'Unavailable'}</dd></div>
                            <div><dt className="text-gray-500">Observed points</dt><dd className="font-semibold text-gray-900">{sameTripObservedCount + laterObservedCount}</dd></div>
                            <div><dt className="text-gray-500">Missing observations</dt><dd className="font-semibold text-gray-900">{missingCount}</dd></div>
                        </dl>
                        <div className="space-y-2 text-gray-600">
                            <p className="font-semibold text-gray-900">Method and confidence</p>
                            <p>{confidence}. Missing observations are unknown and do not imply recovery or continued delay.</p>
                            <p>Associated delay is raw departure deviation minus positive arrival lateness already present at the incident stop, never below zero.</p>
                        </div>
                    </div>
                </details>
            </div>
        </>
    );
};

export default CascadeStorySlideOver;
