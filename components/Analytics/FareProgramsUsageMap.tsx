import React, { useMemo, useState } from 'react';
import { Clock3, Info, Loader2, MapPin, ShieldCheck } from 'lucide-react';
import { Marker, Popup } from 'react-map-gl/mapbox';
import { MapBase } from '../shared/MapBase';
import {
    getFareProgramOriginUses,
    type FareProgramDayType,
    type FareProgramOriginArea,
    type FareProgramsSnapshot,
    type FareProgramTimeBandId,
} from '../../utils/fare-programs/fareProgramsSnapshot';
import {
    geocodeFareProgramOrigins,
    type FareProgramOriginGeocode,
} from '../../utils/fare-programs/fareProgramsOriginGeocoder';

interface FareProgramsUsageMapProps {
    snapshot: FareProgramsSnapshot;
}

type GeocodeStatus = 'idle' | 'loading' | 'ready' | 'error';
type DayFilter = FareProgramDayType | 'all';
type TimeFilter = FareProgramTimeBandId | 'all';
type LocatedOrigin = FareProgramOriginArea & FareProgramOriginGeocode & { filteredUses: number };

const number = new Intl.NumberFormat('en-CA');

function markerDiameter(uses: number, maximumUses: number): number {
    const share = maximumUses > 0 ? Math.sqrt(uses / maximumUses) : 0;
    return Math.round(24 + share * 36);
}

function filterLabel(
    dayFilter: DayFilter,
    timeFilter: TimeFilter,
    timeBands: Array<{ id: FareProgramTimeBandId; label: string }>,
): string {
    const dayLabel = dayFilter === 'all' ? 'All days' : dayFilter === 'weekday' ? 'Weekdays' : 'Weekends';
    const timeLabel = timeFilter === 'all'
        ? 'all times'
        : timeBands.find((band) => band.id === timeFilter)?.label ?? timeFilter;
    return `${dayLabel}, ${timeLabel}`;
}

export const FareProgramsUsageMap: React.FC<FareProgramsUsageMapProps> = ({ snapshot }) => {
    const originUsage = snapshot.serviceMirroring.originUsage;
    const [dayFilter, setDayFilter] = useState<DayFilter>('all');
    const [timeFilter, setTimeFilter] = useState<TimeFilter>('all');
    const [status, setStatus] = useState<GeocodeStatus>('idle');
    const [geocodes, setGeocodes] = useState<Record<string, FareProgramOriginGeocode>>({});
    const [failedCount, setFailedCount] = useState(0);
    const [progress, setProgress] = useState({ completed: 0, total: originUsage.origins.length });
    const [error, setError] = useState<string | null>(null);
    const [selectedOriginId, setSelectedOriginId] = useState<string | null>(null);

    const filteredOrigins = useMemo(() => originUsage.origins
        .map((origin) => ({
            origin,
            filteredUses: getFareProgramOriginUses(origin, dayFilter, timeFilter),
        }))
        .filter((item) => item.filteredUses > 0)
        .sort((left, right) => right.filteredUses - left.filteredUses || left.origin.label.localeCompare(right.origin.label)), [
        dayFilter,
        originUsage.origins,
        timeFilter,
    ]);
    const filteredUses = filteredOrigins.reduce((sum, item) => sum + item.filteredUses, 0);
    const locatedOrigins = filteredOrigins
        .map(({ origin, filteredUses: uses }) => {
            const geocode = geocodes[origin.id];
            return geocode ? { ...origin, ...geocode, filteredUses: uses } : null;
        })
        .filter((origin): origin is LocatedOrigin => origin !== null);
    const mappedUses = locatedOrigins.reduce((sum, origin) => sum + origin.filteredUses, 0);
    const maximumUses = locatedOrigins[0]?.filteredUses ?? 0;
    const selectedOrigin = locatedOrigins.find((origin) => origin.id === selectedOriginId) ?? null;
    const currentFilterLabel = filterLabel(dayFilter, timeFilter, originUsage.timeBands);

    const buildUsageMap = async () => {
        setStatus('loading');
        setError(null);
        setFailedCount(0);
        setProgress({ completed: 0, total: originUsage.origins.length });
        try {
            const result = await geocodeFareProgramOrigins(originUsage.origins, {
                onProgress: ({ completed, total }) => setProgress({ completed, total }),
            });
            setGeocodes(Object.fromEntries(result.geocodes.map((geocode) => [geocode.originId, geocode])));
            setFailedCount(result.failedOriginIds.length);
            setStatus('ready');
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : 'Could not locate the sanitized origin areas.');
            setStatus('error');
        }
    };

    return (
        <div className="space-y-5">
            <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                        <h2 className="text-base font-bold text-gray-900">High-school-pass starting areas</h2>
                        <p className="mt-1 max-w-3xl text-xs leading-relaxed text-gray-500">
                            Explore where pass trips started by Barrie-local day and time. Counts are transactions, not unique students or home addresses.
                        </p>
                    </div>
                    <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-800">
                        <ShieldCheck className="mr-1.5 inline h-4 w-4" />
                        Minimum {originUsage.minimumGroupUses} uses per displayed area
                    </div>
                </div>

                <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
                    <div>
                        <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">Day type</div>
                        <div className="mt-2 flex flex-wrap gap-2">
                            {([
                                ['all', 'All days'],
                                ['weekday', 'Weekdays'],
                                ['weekend', 'Weekends'],
                            ] as const).map(([id, label]) => (
                                <button
                                    key={id}
                                    type="button"
                                    onClick={() => {
                                        setDayFilter(id);
                                        setSelectedOriginId(null);
                                    }}
                                    className={`rounded-lg border px-3 py-2 text-xs font-semibold transition-colors ${
                                        dayFilter === id
                                            ? 'border-blue-600 bg-blue-600 text-white'
                                            : 'border-gray-200 bg-white text-gray-600 hover:border-blue-300 hover:text-blue-700'
                                    }`}
                                >
                                    {label}
                                </button>
                            ))}
                        </div>
                    </div>
                    <div>
                        <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">Time of day</div>
                        <div className="mt-2 flex flex-wrap gap-2">
                            <button
                                type="button"
                                onClick={() => {
                                    setTimeFilter('all');
                                    setSelectedOriginId(null);
                                }}
                                className={`rounded-lg border px-3 py-2 text-xs font-semibold transition-colors ${
                                    timeFilter === 'all'
                                        ? 'border-blue-600 bg-blue-600 text-white'
                                        : 'border-gray-200 bg-white text-gray-600 hover:border-blue-300 hover:text-blue-700'
                                }`}
                            >
                                All times
                            </button>
                            {originUsage.timeBands.map((band) => (
                                <button
                                    key={band.id}
                                    type="button"
                                    onClick={() => {
                                        setTimeFilter(band.id);
                                        setSelectedOriginId(null);
                                    }}
                                    className={`rounded-lg border px-3 py-2 text-xs font-semibold transition-colors ${
                                        timeFilter === band.id
                                            ? 'border-blue-600 bg-blue-600 text-white'
                                            : 'border-gray-200 bg-white text-gray-600 hover:border-blue-300 hover:text-blue-700'
                                    }`}
                                >
                                    {band.label}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>
            </section>

            <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
                    <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">Filtered uses</div>
                    <div className="mt-2 text-2xl font-bold text-gray-900">{number.format(filteredUses)}</div>
                    <div className="mt-1 text-xs text-gray-500">{currentFilterLabel}</div>
                </div>
                <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
                    <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">Sanitized areas</div>
                    <div className="mt-2 text-2xl font-bold text-gray-900">{number.format(filteredOrigins.length)}</div>
                    <div className="mt-1 text-xs text-gray-500">Repeated street, stop, or named-place groups.</div>
                </div>
                <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
                    <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">Privacy-safe coverage</div>
                    <div className="mt-2 text-2xl font-bold text-gray-900">{((originUsage.displayedUses / originUsage.usableStartUses) * 100).toFixed(1)}%</div>
                    <div className="mt-1 text-xs text-gray-500">{number.format(originUsage.suppressedUses)} usable starts suppressed in small groups.</div>
                </div>
                <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
                    <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">Missing / unauthorized</div>
                    <div className="mt-2 text-2xl font-bold text-gray-900">{number.format(snapshot.serviceMirroring.uses - originUsage.usableStartUses)}</div>
                    <div className="mt-1 text-xs text-gray-500">No usable starting location in the export.</div>
                </div>
            </section>

            <section className="grid min-h-[590px] gap-5 xl:grid-cols-[minmax(0,1.55fr)_minmax(340px,0.65fr)]">
                <div className="relative min-h-[590px] overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
                    <MapBase longitude={-79.69} latitude={44.38} zoom={11.3} showNavigation showScale>
                        {locatedOrigins.map((origin) => {
                            const diameter = markerDiameter(origin.filteredUses, maximumUses);
                            return (
                                <Marker key={origin.id} longitude={origin.longitude} latitude={origin.latitude} anchor="center">
                                    <button
                                        type="button"
                                        onClick={() => setSelectedOriginId(origin.id)}
                                        aria-label={`${origin.label}: ${origin.filteredUses} filtered uses`}
                                        className="grid rounded-full border-2 border-white bg-blue-600 text-white shadow-lg transition-transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-blue-300"
                                        style={{ width: diameter, height: diameter, placeItems: 'center' }}
                                    >
                                        <span className="text-xs font-bold">{number.format(origin.filteredUses)}</span>
                                    </button>
                                </Marker>
                            );
                        })}
                        {selectedOrigin && (
                            <Popup
                                longitude={selectedOrigin.longitude}
                                latitude={selectedOrigin.latitude}
                                anchor="bottom"
                                offset={36}
                                closeButton
                                closeOnClick={false}
                                onClose={() => setSelectedOriginId(null)}
                            >
                                <div className="max-w-[240px] p-1">
                                    <div className="font-bold text-gray-900">{selectedOrigin.label}</div>
                                    <div className="mt-1 text-sm font-semibold text-blue-700">{number.format(selectedOrigin.filteredUses)} filtered uses</div>
                                    <p className="mt-1 text-xs leading-relaxed text-gray-600">{currentFilterLabel}. {number.format(selectedOrigin.uses)} uses across all days and times.</p>
                                </div>
                            </Popup>
                        )}
                    </MapBase>

                    {status !== 'ready' && (
                        <div className="absolute inset-0 grid place-items-center bg-white/88 p-6 backdrop-blur-sm">
                            <div className="max-w-md rounded-xl border border-gray-200 bg-white p-6 text-center shadow-lg">
                                {status === 'loading' ? (
                                    <>
                                        <Loader2 className="mx-auto h-9 w-9 animate-spin text-blue-600" />
                                        <h3 className="mt-3 text-base font-bold text-gray-900">Locating sanitized areas</h3>
                                        <p className="mt-2 text-sm text-gray-600">{number.format(progress.completed)} of {number.format(progress.total)} areas checked.</p>
                                    </>
                                ) : (
                                    <>
                                        <MapPin className="mx-auto h-10 w-10 text-blue-600" />
                                        <h3 className="mt-3 text-base font-bold text-gray-900">Build the usage map</h3>
                                        <p className="mt-2 text-sm leading-relaxed text-gray-600">
                                            Only sanitized street and place-area labels are sent for temporary geocoding. Coordinates remain in this browser session.
                                        </p>
                                        {error && <p className="mt-3 rounded-lg bg-red-50 p-3 text-xs text-red-700">{error}</p>}
                                        <button type="button" onClick={() => void buildUsageMap()} className="mt-5 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700">
                                            {status === 'error' ? 'Try again' : 'Build usage map'}
                                        </button>
                                    </>
                                )}
                            </div>
                        </div>
                    )}

                    {status === 'ready' && (
                        <div className="pointer-events-none absolute left-4 top-4 max-w-xs rounded-lg border border-gray-200 bg-white/95 p-3 shadow-sm backdrop-blur">
                            <div className="flex items-center gap-2 text-sm font-bold text-gray-900"><MapPin size={16} className="text-blue-600" /> Sanitized starting areas</div>
                            <p className="mt-1 text-xs leading-relaxed text-gray-600">{number.format(mappedUses)} filtered uses mapped. Bubble size represents transaction count.</p>
                            {failedCount > 0 && <p className="mt-1 text-xs text-amber-700">{number.format(failedCount)} sanitized areas could not be located.</p>}
                        </div>
                    )}
                </div>

                <div className="space-y-5">
                    <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
                        <div className="flex items-center justify-between gap-3">
                            <h2 className="text-sm font-bold text-gray-900">Top starting areas</h2>
                            <span className="rounded-full bg-gray-100 px-2 py-1 text-xs font-semibold text-gray-600">Uses, not riders</span>
                        </div>
                        <div className="mt-4 space-y-2">
                            {filteredOrigins.slice(0, 10).map(({ origin, filteredUses: uses }, index) => (
                                <button
                                    key={origin.id}
                                    type="button"
                                    disabled={!geocodes[origin.id]}
                                    onClick={() => setSelectedOriginId(origin.id)}
                                    className="flex w-full items-center gap-3 rounded-lg border border-gray-200 px-3 py-2.5 text-left enabled:hover:border-blue-200 enabled:hover:bg-blue-50/50 disabled:cursor-default"
                                >
                                    <span className="w-5 text-xs font-bold tabular-nums text-gray-400">{index + 1}</span>
                                    <span className="min-w-0 flex-1 truncate text-sm font-semibold text-gray-800">{origin.label}</span>
                                    <span className="text-sm font-bold tabular-nums text-gray-900">{number.format(uses)}</span>
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-blue-950">
                        <div className="flex gap-3">
                            <Clock3 size={18} className="mt-0.5 shrink-0 text-blue-700" />
                            <div>
                                <div className="text-sm font-bold">Time interpretation</div>
                                <p className="mt-1 text-xs leading-relaxed text-blue-900">{originUsage.timestampAssumption}</p>
                            </div>
                        </div>
                    </div>

                    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
                        <div className="flex gap-3">
                            <Info size={18} className="mt-0.5 shrink-0 text-gray-500" />
                            <div>
                                <div className="text-sm font-bold text-gray-900">What the map does not prove</div>
                                <p className="mt-1 text-xs leading-relaxed text-gray-600">
                                    A starting area is not necessarily a student&apos;s home, school, or unique rider location. Repeat taps may belong to the same person, but this export has no rider identifier.
                                </p>
                            </div>
                        </div>
                    </div>
                </div>
            </section>
        </div>
    );
};
