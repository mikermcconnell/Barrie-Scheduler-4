import React, { useEffect, useRef } from 'react';
import { AlertTriangle, Clock3, MapPin, X } from 'lucide-react';
import type { DailySummary } from '../../utils/performanceDataTypes';
import type { DwellIncidentReviewRow } from '../../utils/performanceDwellReview';
import type { StopLoadData } from '../../utils/schedule/cascadeStoryUtils';
import CascadeStorySlideOver from './CascadeStorySlideOver';

interface DwellIncidentDetailDrawerProps {
    row: DwellIncidentReviewRow;
    onClose: () => void;
    stopLoadLookup: Map<string, StopLoadData>;
    dailySummaries: DailySummary[];
}

const minutes = (seconds: number): string => (seconds / 60).toFixed(1);

const ContextCell: React.FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => (
    <div className="rounded-xl border border-gray-200 bg-gray-50 p-3">
        <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-gray-500">{label}</div>
        <div className="mt-1 text-sm font-semibold text-gray-900">{value}</div>
    </div>
);

export const DwellIncidentDetailDrawer: React.FC<DwellIncidentDetailDrawerProps> = ({
    row,
    onClose,
    stopLoadLookup,
    dailySummaries,
}) => {
    const panelRef = useRef<HTMLElement | null>(null);
    const closeButtonRef = useRef<HTMLButtonElement | null>(null);

    useEffect(() => {
        const previousOverflow = document.body.style.overflow;
        const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        document.body.style.overflow = 'hidden';
        if (row.cascade) {
            return () => {
                document.body.style.overflow = previousOverflow;
                previouslyFocused?.focus();
            };
        }
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') onClose();
            if (event.key === 'Tab' && panelRef.current) {
                const focusable = Array.from(panelRef.current.querySelectorAll<HTMLElement>(
                    'button:not([disabled]), [href], select, input, textarea, [tabindex]:not([tabindex="-1"])',
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
            }
        };
        document.addEventListener('keydown', onKeyDown);
        closeButtonRef.current?.focus();
        return () => {
            document.body.style.overflow = previousOverflow;
            document.removeEventListener('keydown', onKeyDown);
            previouslyFocused?.focus();
        };
    }, [onClose, row.cascade]);

    if (row.cascade) {
        return (
            <CascadeStorySlideOver
                cascade={row.cascade}
                incident={row.incident}
                onClose={onClose}
                stopLoadLookup={stopLoadLookup}
                dailySummaries={dailySummaries}
            />
        );
    }

    const incident = row.incident;
    return (
        <div className="fixed inset-0 z-50 bg-gray-950/35 backdrop-blur-sm" role="presentation" onMouseDown={onClose}>
            <aside
                ref={panelRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby="dwell-incident-title"
                className="ml-auto flex h-full w-full max-w-2xl flex-col bg-white shadow-2xl"
                onMouseDown={event => event.stopPropagation()}
            >
                <header className="border-b border-gray-200 px-5 py-4 sm:px-7">
                    <div className="flex items-start justify-between gap-4">
                        <div>
                            <div className="flex items-center gap-2">
                                <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${incident.severity === 'high' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>
                                    {incident.severity === 'high' ? 'High severity' : 'Moderate'}
                                </span>
                                <span className="text-xs font-semibold text-gray-500">{incident.date}</span>
                            </div>
                            <h2 id="dwell-incident-title" className="mt-3 text-xl font-bold text-gray-900">Dwell incident evidence</h2>
                            <p className="mt-1 text-sm text-gray-500">Route {incident.routeId} · {incident.stopName} · {incident.observedDepartureTime}</p>
                        </div>
                        <button ref={closeButtonRef} type="button" onClick={onClose} aria-label="Close incident detail" className="min-h-11 min-w-11 rounded-lg p-2 text-gray-500 hover:bg-gray-100 hover:text-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400">
                            <X size={20} />
                        </button>
                    </div>
                </header>

                <div className="flex-1 space-y-5 overflow-y-auto p-5 sm:p-7">
                    <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
                        <div className="flex items-start gap-3">
                            <AlertTriangle size={18} className="mt-0.5 shrink-0 text-amber-600" />
                            <div>
                                <h3 className="font-bold text-amber-900">Downstream evidence is unavailable</h3>
                                <p className="mt-1 text-sm text-amber-800">The incident can be reviewed, but this stored day does not include a matching same-trip and block-carryover story. Re-import the source period for complete evidence.</p>
                            </div>
                        </div>
                    </section>

                    <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
                        <div className="flex items-center gap-2 text-gray-900"><Clock3 size={17} /><h3 className="font-bold">Why it was flagged</h3></div>
                        <p className="mt-3 text-sm leading-6 text-gray-600">
                            The vehicle departed more than 3 minutes late and recorded {minutes(incident.trackedDwellSeconds)} minutes of effective dwell. This is an investigation signal, not proof of operator fault.
                        </p>
                    </section>

                    <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
                        <div className="flex items-center gap-2 text-gray-900"><MapPin size={17} /><h3 className="font-bold">Incident context</h3></div>
                        <div className="mt-4 grid grid-cols-2 gap-3">
                            <ContextCell label="Scheduled arrival" value={incident.scheduledArrivalTime ?? 'Unavailable'} />
                            <ContextCell label="Observed arrival" value={incident.observedArrivalTime} />
                            <ContextCell label="Scheduled departure" value={incident.scheduledDepartureTime ?? 'Unavailable'} />
                            <ContextCell label="Observed departure" value={incident.observedDepartureTime} />
                            <ContextCell label="Raw dwell" value={`${minutes(incident.rawDwellSeconds)} min`} />
                            <ContextCell label="Effective dwell" value={`${minutes(incident.trackedDwellSeconds)} min`} />
                            <ContextCell label="Operator" value={incident.operatorId} />
                            <ContextCell label="Block" value={incident.block} />
                            <ContextCell label="Vehicle" value={incident.vehicleId ?? 'Unavailable'} />
                            <ContextCell label="Direction" value={incident.direction ?? 'Unavailable'} />
                            <ContextCell label="Boardings" value={incident.boardings ?? 'Unavailable'} />
                            <ContextCell label="Alightings" value={incident.alightings ?? 'Unavailable'} />
                            <ContextCell label="Wheelchair activity" value={incident.wheelchairUsageCount ?? 'Unavailable'} />
                            <ContextCell label="Departure load" value={incident.departureLoadReliable ? (incident.departureLoad ?? 0) : 'Unavailable'} />
                        </div>
                    </section>
                </div>
            </aside>
        </div>
    );
};

export default DwellIncidentDetailDrawer;
