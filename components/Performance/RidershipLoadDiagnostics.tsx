import React from 'react';
import {
    FULL_LOAD,
    MAX_TRIP_IMBALANCE_RATIO,
    VEHICLE_RATIO_BAND,
    type RouteLoadView,
    type VehicleCountDiagnostic,
} from '../../utils/performanceRouteLoad';

interface RidershipLoadDiagnosticsProps {
    selected: RouteLoadView;
    views: RouteLoadView[];
    vehicles: VehicleCountDiagnostic[];
}

/** Skipped trips this much busier than kept trips suggest the cut-off hides crowding. */
const SKIPPED_BUSIER_WARNING = 1.2;
/** More than this share of kept trips floored at zero suggests misattributed or missing counts. */
const CLAMP_WARNING_SHARE = 0.2;

function percent(value: number | null): string {
    return value === null ? '—' : `${Math.round(value * 100)}%`;
}

function number(value: number | null, digits = 1): string {
    return value === null ? '—' : value.toLocaleString(undefined, { maximumFractionDigits: digits });
}

function blockLabel(view: RouteLoadView): string {
    if (view.inferenceBlocked === 'loop') return 'Not inferred: loop';
    if (view.inferenceBlocked === 'interlined') return 'Not inferred: interlined';
    return 'Inferred';
}

function Check({ ok, label, detail }: { ok: boolean | null; label: string; detail: string }) {
    const tone = ok === null ? 'text-gray-400' : ok ? 'text-emerald-700' : 'text-amber-700';
    const mark = ok === null ? '–' : ok ? '✓' : '!';
    return (
        <li className="flex gap-2">
            <span className={`w-3 shrink-0 font-bold ${tone}`} aria-hidden="true">{mark}</span>
            <span><span className="font-semibold text-gray-700">{label}</span> <span className="text-gray-500">{detail}</span></span>
        </li>
    );
}

export const RidershipLoadDiagnostics: React.FC<RidershipLoadDiagnosticsProps> = ({ selected, views, vehicles }) => {
    const d = selected.diagnostics;
    const ratedTrips = d.imbalanceBuckets.reduce((sum, bucket) => sum + bucket.trips, 0);
    const skippedBusier = d.keptAvgBoardings !== null && d.skippedAvgBoardings !== null && d.keptAvgBoardings > 0
        ? d.skippedAvgBoardings / d.keptAvgBoardings
        : null;
    const flaggedVehicles = vehicles.filter(vehicle => vehicle.flagged);

    return (
        <details className="mt-3 text-xs" data-testid="ridership-load-diagnostics">
            <summary className="cursor-pointer font-semibold text-gray-600">Method diagnostics</summary>
            <div className="mt-3 space-y-5">
                <section>
                    <h4 className="mb-2 font-semibold text-gray-700">Route {selected.routeId} {selected.direction}</h4>
                    <ul className="space-y-1.5">
                        <Check
                            ok={skippedBusier === null ? null : skippedBusier < SKIPPED_BUSIER_WARNING}
                            label="Skipped trips vs kept trips:"
                            detail={skippedBusier === null
                                ? 'no trips were skipped for unbalanced counts.'
                                : `skipped trips average ${number(d.skippedAvgBoardings)} boardings vs ${number(d.keptAvgBoardings)} on kept trips${skippedBusier >= SKIPPED_BUSIER_WARNING ? ', so busy trips may be under-represented.' : '.'}`}
                        />
                        <Check
                            ok={d.clampedTripShare === null ? null : d.clampedTripShare <= CLAMP_WARNING_SHARE}
                            label="Load floored at zero:"
                            detail={`${percent(d.clampedTripShare)} of kept trips needed it${d.clampedTripShare !== null && d.clampedTripShare > CLAMP_WARNING_SHARE ? ', which suggests counts recorded at the wrong stop or missing.' : '.'}`}
                        />
                        <Check
                            ok={null}
                            label="Trips with no counts:"
                            detail={`${d.noCountTrips.toLocaleString()} (treated as missing data, not empty buses).`}
                        />
                        <Check
                            ok={d.apcComparison === null ? null : d.apcComparison.meanAbsoluteDifference <= 5}
                            label="Compared with APC load:"
                            detail={d.apcComparison === null
                                ? 'no stops with enough APC readings to compare.'
                                : `inferred averages differ by ${number(d.apcComparison.meanAbsoluteDifference)} riders on average across ${d.apcComparison.stopsCompared} stops (inferred is ${d.apcComparison.meanDifference >= 0 ? 'higher' : 'lower'} by ${number(Math.abs(d.apcComparison.meanDifference))} overall). APC is not trusted, so treat this as a sense check only.`}
                        />
                        <Check
                            ok={null}
                            label="Route shape:"
                            detail={`${percent(d.loopTripShare)} of trips loop and ${percent(d.interlinedTripShare)} continue as another route; inference is withheld above 50%.`}
                        />
                    </ul>

                    <p className="mb-1 mt-3 font-semibold text-gray-600">
                        Boardings vs alightings per trip <span className="font-normal text-gray-400">(median ratio {number(d.medianRatio, 2)}; trips beyond ±{Math.round((MAX_TRIP_IMBALANCE_RATIO - 1) * 100)}% are skipped)</span>
                    </p>
                    <div className="space-y-1">
                        {d.imbalanceBuckets.map(bucket => {
                            const width = ratedTrips > 0 ? (bucket.trips / ratedTrips) * 100 : 0;
                            return (
                                <div key={bucket.label} className="flex items-center gap-2">
                                    <span className="w-40 shrink-0 text-gray-500">{bucket.label}</span>
                                    <div className="h-2.5 flex-1 rounded bg-gray-100">
                                        <div className="h-2.5 rounded bg-slate-500" style={{ width: `${width}%` }} />
                                    </div>
                                    <span className="w-16 shrink-0 text-right tabular-nums text-gray-600">{bucket.trips.toLocaleString()}</span>
                                </div>
                            );
                        })}
                    </div>
                </section>

                <section>
                    <h4 className="mb-2 font-semibold text-gray-700">All routes</h4>
                    <div className="overflow-x-auto">
                        <table className="w-full">
                            <thead>
                                <tr className="border-b border-gray-100 text-left uppercase text-gray-400">
                                    <th className="py-1.5 pr-2">Route</th>
                                    <th className="py-1.5 pr-2">Status</th>
                                    <th className="py-1.5 pr-2 text-right">Trips</th>
                                    <th className="py-1.5 pr-2 text-right">Used</th>
                                    <th className="py-1.5 pr-2 text-right">Median ratio</th>
                                    <th className="py-1.5 pr-2 text-right">Floored</th>
                                    <th className="py-1.5 pr-2 text-right">Skipped / kept boardings</th>
                                    <th className="py-1.5 pr-2 text-right">Reach {FULL_LOAD}</th>
                                </tr>
                            </thead>
                            <tbody>
                                {views.map(view => {
                                    const vd = view.diagnostics;
                                    const ratio = vd.keptAvgBoardings && vd.skippedAvgBoardings !== null
                                        ? vd.skippedAvgBoardings / vd.keptAvgBoardings
                                        : null;
                                    return (
                                        <tr key={view.key} className={`border-b border-gray-50 ${view.key === selected.key ? 'bg-cyan-50/60' : ''}`}>
                                            <td className="py-1 pr-2 font-semibold text-gray-700">{view.routeId} {view.direction}</td>
                                            <td className="py-1 pr-2 text-gray-500">{blockLabel(view)}</td>
                                            <td className="py-1 pr-2 text-right tabular-nums">{view.tripCount.toLocaleString()}</td>
                                            <td className="py-1 pr-2 text-right tabular-nums">{percent(view.usableShare)}</td>
                                            <td className="py-1 pr-2 text-right tabular-nums">{number(vd.medianRatio, 2)}</td>
                                            <td className="py-1 pr-2 text-right tabular-nums">{percent(vd.clampedTripShare)}</td>
                                            <td className={`py-1 pr-2 text-right tabular-nums ${ratio !== null && ratio >= SKIPPED_BUSIER_WARNING ? 'font-semibold text-amber-700' : ''}`}>{number(ratio, 2)}</td>
                                            <td className="py-1 pr-2 text-right tabular-nums">{view.inferenceBlocked ? '—' : view.fullTripCount.toLocaleString()}</td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </section>

                <section>
                    <h4 className="mb-1 font-semibold text-gray-700">Vehicles</h4>
                    <p className="mb-2 text-gray-500">
                        {flaggedVehicles.length === 0
                            ? 'No vehicle stands out: counter errors look random rather than tied to particular buses.'
                            : `${flaggedVehicles.length} vehicle${flaggedVehicles.length === 1 ? '' : 's'} with a median ratio outside ${VEHICLE_RATIO_BAND[0]}–${VEHICLE_RATIO_BAND[1]} or more than half their trips skipped. A consistent offset points to a counter fault to fix rather than random noise.`}
                    </p>
                    {vehicles.length > 0 && (
                        <div className="max-h-56 overflow-auto">
                            <table className="w-full">
                                <thead>
                                    <tr className="border-b border-gray-100 text-left uppercase text-gray-400">
                                        <th className="py-1.5 pr-2">Vehicle</th>
                                        <th className="py-1.5 pr-2 text-right">Trips</th>
                                        <th className="py-1.5 pr-2 text-right">Median ratio</th>
                                        <th className="py-1.5 pr-2 text-right">Skipped</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {vehicles.map(vehicle => (
                                        <tr key={vehicle.vehicleId} className={`border-b border-gray-50 ${vehicle.flagged ? 'font-semibold text-amber-700' : 'text-gray-600'}`}>
                                            <td className="py-1 pr-2">{vehicle.vehicleId}{vehicle.flagged ? ' !' : ''}</td>
                                            <td className="py-1 pr-2 text-right tabular-nums">{vehicle.trips.toLocaleString()}</td>
                                            <td className="py-1 pr-2 text-right tabular-nums">{number(vehicle.medianRatio, 2)}</td>
                                            <td className="py-1 pr-2 text-right tabular-nums">{percent(vehicle.skippedShare)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </section>
            </div>
        </details>
    );
};
