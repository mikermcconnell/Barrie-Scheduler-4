import React, { useMemo, useState } from 'react';
import { ArrowLeft, Bus, GraduationCap, Info, MapPin, Ticket, Users } from 'lucide-react';
import { Marker, Popup } from 'react-map-gl/mapbox';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { MapBase } from '../shared/MapBase';
import {
    FARE_PROGRAMS_SNAPSHOT,
    getSchoolLinkedUses,
    type FareProgramSchoolArea,
} from '../../utils/fare-programs/fareProgramsSnapshot';

interface FareProgramsWorkspaceProps {
    onBack: () => void;
}

const number = new Intl.NumberFormat('en-CA');

const MetricCard: React.FC<{
    label: string;
    value: number | string;
    detail: string;
    icon: React.ReactNode;
}> = ({ label, value, detail, icon }) => (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
        <div className="flex items-start justify-between gap-3">
            <div>
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-gray-500">{label}</p>
                <p className="mt-2 text-3xl font-bold tracking-tight text-gray-900">{typeof value === 'number' ? number.format(value) : value}</p>
                <p className="mt-1 text-xs leading-relaxed text-gray-500">{detail}</p>
            </div>
            <div className="rounded-lg bg-gray-100 p-2 text-gray-600">{icon}</div>
        </div>
    </div>
);

function markerDiameter(uses: number): number {
    return Math.max(30, Math.min(68, 20 + Math.sqrt(uses) * 3.2));
}

export const FareProgramsWorkspace: React.FC<FareProgramsWorkspaceProps> = ({ onBack }) => {
    const [selectedSchool, setSelectedSchool] = useState<FareProgramSchoolArea | null>(null);
    const snapshot = FARE_PROGRAMS_SNAPSHOT;
    const linkedUses = useMemo(() => getSchoolLinkedUses(snapshot), [snapshot]);
    const linkedShare = linkedUses / snapshot.serviceMirroring.uses;

    return (
        <div className="flex h-full min-h-0 flex-col bg-gray-50">
            <header className="shrink-0 border-b border-gray-200 bg-white px-6 py-4">
                <div className="mx-auto flex max-w-[1600px] items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                        <button
                            type="button"
                            onClick={onBack}
                            aria-label="Back to Planning Data"
                            className="rounded-lg border border-gray-200 p-2 text-gray-600 transition-colors hover:bg-gray-50 hover:text-gray-900"
                        >
                            <ArrowLeft size={18} />
                        </button>
                        <div>
                            <div className="flex items-center gap-2">
                                <h1 className="text-xl font-bold tracking-tight text-gray-900">Fare Programs</h1>
                                <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs font-semibold text-blue-700">Sep 2025–Jun 2026</span>
                            </div>
                            <p className="mt-1 text-sm text-gray-500">HotSpot usage summary for the Service Mirroring Pilot and Field Trip Pass.</p>
                        </div>
                    </div>
                    <div className="hidden text-right text-xs text-gray-500 md:block">
                        <div className="font-semibold text-gray-700">{snapshot.sourceFileName}</div>
                        <div>{number.format(snapshot.sourceRows)} source transactions</div>
                    </div>
                </div>
            </header>

            <main className="min-h-0 flex-1 overflow-auto custom-scrollbar px-6 py-5">
                <div className="mx-auto max-w-[1600px] space-y-5">
                    <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                        <MetricCard
                            label="Service Mirroring proxy"
                            value={snapshot.serviceMirroring.uses}
                            detail="Working proxy: High School Student Pass only; 1 Innisdale pass use remains separate pending confirmation."
                            icon={<Bus size={19} />}
                        />
                        <MetricCard
                            label="School-linked uses"
                            value={linkedUses}
                            detail={`${(linkedShare * 100).toFixed(1)}% matched a named school or adjacent school stop.`}
                            icon={<GraduationCap size={19} />}
                        />
                        <MetricCard
                            label="Not attributable"
                            value={snapshot.serviceMirroring.unattributedUses}
                            detail="The export has no school or rider identifier, so these uses remain unassigned."
                            icon={<Users size={19} />}
                        />
                        <MetricCard
                            label="Field Trip Pass uses"
                            value={snapshot.fieldTripPass.uses}
                            detail="Supplied total; this fare type is absent from the workbook and cannot yet be mapped."
                            icon={<Ticket size={19} />}
                        />
                    </section>

                    <section className="grid min-h-[520px] gap-5 xl:grid-cols-[minmax(0,1.55fr)_minmax(360px,0.75fr)]">
                        <div className="relative min-h-[520px] overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
                            <MapBase longitude={-79.667} latitude={44.375} zoom={11.4} showNavigation showScale>
                                {snapshot.serviceMirroring.schoolAreas.map((school) => {
                                    const diameter = markerDiameter(school.uses);
                                    return (
                                        <Marker key={school.id} longitude={school.longitude} latitude={school.latitude} anchor="center">
                                            <button
                                                type="button"
                                                onClick={() => setSelectedSchool(school)}
                                                aria-label={`${school.name}: ${school.uses} school-linked uses`}
                                                className="grid rounded-full border-2 border-white bg-blue-600 text-white shadow-lg transition-transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-blue-300"
                                                style={{ width: diameter, height: diameter, placeItems: 'center' }}
                                            >
                                                <span className="text-sm font-bold">{school.uses}</span>
                                            </button>
                                        </Marker>
                                    );
                                })}
                                {selectedSchool && (
                                    <Popup
                                        longitude={selectedSchool.longitude}
                                        latitude={selectedSchool.latitude}
                                        anchor="bottom"
                                        offset={38}
                                        closeButton
                                        closeOnClick={false}
                                        onClose={() => setSelectedSchool(null)}
                                    >
                                        <div className="max-w-[230px] p-1">
                                            <div className="font-bold text-gray-900">{selectedSchool.name}</div>
                                            <div className="mt-1 text-sm font-semibold text-blue-700">{number.format(selectedSchool.uses)} linked uses</div>
                                            <p className="mt-1 text-xs leading-relaxed text-gray-600">{selectedSchool.evidence}</p>
                                        </div>
                                    </Popup>
                                )}
                            </MapBase>
                            <div className="pointer-events-none absolute left-4 top-4 max-w-xs rounded-lg border border-gray-200 bg-white/95 p-3 shadow-sm backdrop-blur">
                                <div className="flex items-center gap-2 text-sm font-bold text-gray-900"><MapPin size={16} className="text-blue-600" /> School-proximity map</div>
                                <p className="mt-1 text-xs leading-relaxed text-gray-600">Circle size represents uses with a recorded endpoint at the school or its adjacent stop. Counts are uses, not unique riders.</p>
                            </div>
                        </div>

                        <div className="space-y-5">
                            <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
                                <h2 className="text-base font-bold text-gray-900">Rough school-area breakdown</h2>
                                <p className="mt-1 text-xs leading-relaxed text-gray-500">A conservative proxy based only on explicit school-location matches.</p>
                                <div className="mt-4 space-y-3">
                                    {snapshot.serviceMirroring.schoolAreas.map((school) => (
                                        <button
                                            key={school.id}
                                            type="button"
                                            onClick={() => setSelectedSchool(school)}
                                            className="flex w-full items-center justify-between rounded-lg border border-gray-200 px-3 py-3 text-left transition-colors hover:border-blue-200 hover:bg-blue-50/50"
                                        >
                                            <div>
                                                <div className="text-sm font-semibold text-gray-900">{school.name}</div>
                                                <div className="mt-0.5 text-xs text-gray-500">{school.evidence}</div>
                                            </div>
                                            <div className="ml-3 text-lg font-bold text-gray-900">{number.format(school.uses)}</div>
                                        </button>
                                    ))}
                                    <div className="flex items-center justify-between rounded-lg bg-gray-100 px-3 py-3">
                                        <div>
                                            <div className="text-sm font-semibold text-gray-900">Not attributable</div>
                                            <div className="mt-0.5 text-xs text-gray-500">No school identity can be inferred from the transaction.</div>
                                        </div>
                                        <div className="ml-3 text-lg font-bold text-gray-900">{number.format(snapshot.serviceMirroring.unattributedUses)}</div>
                                    </div>
                                </div>
                            </div>

                            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-950">
                                <div className="flex gap-3">
                                    <Info size={18} className="mt-0.5 shrink-0 text-amber-700" />
                                    <div>
                                        <div className="text-sm font-bold">Field Trip Pass map needs a transaction export</div>
                                        <p className="mt-1 text-xs leading-relaxed text-amber-900">The 982-use total is retained, but the workbook contains no Field Trip Pass rows to place by origin, destination, stop, or trip. {snapshot.fieldTripPass.mappingStatus}</p>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </section>

                    <section className="grid gap-5 xl:grid-cols-[minmax(0,1.4fr)_minmax(320px,0.6fr)]">
                        <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
                            <div className="flex items-start justify-between gap-4">
                                <div>
                                    <h2 className="text-base font-bold text-gray-900">Service Mirroring proxy by month</h2>
                                    <p className="mt-1 text-xs text-gray-500">Monthly uses reconcile to {number.format(snapshot.serviceMirroring.uses)}.</p>
                                </div>
                                <span className="rounded-full bg-gray-100 px-2 py-1 text-xs font-semibold text-gray-600">Uses, not riders</span>
                            </div>
                            <div className="mt-4 h-64">
                                <ResponsiveContainer width="100%" height="100%">
                                    <BarChart data={snapshot.serviceMirroring.monthlyUses} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" />
                                        <XAxis dataKey="label" tick={{ fill: '#6B7280', fontSize: 12 }} axisLine={false} tickLine={false} />
                                        <YAxis allowDecimals={false} tick={{ fill: '#6B7280', fontSize: 12 }} axisLine={false} tickLine={false} />
                                        <Tooltip formatter={(value) => [number.format(Number(value)), 'Uses']} cursor={{ fill: '#EFF6FF' }} />
                                        <Bar dataKey="uses" fill="#2563EB" radius={[5, 5, 0, 0]} />
                                    </BarChart>
                                </ResponsiveContainer>
                            </div>
                        </div>

                        <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
                            <h2 className="text-base font-bold text-gray-900">Data quality</h2>
                            <dl className="mt-4 space-y-4">
                                <div className="flex items-end justify-between border-b border-gray-100 pb-3">
                                    <dt className="text-sm text-gray-600">Authorized start locations</dt>
                                    <dd className="font-bold text-gray-900">{number.format(snapshot.serviceMirroring.authorizedStartLocations)} <span className="text-xs font-medium text-gray-500">/ {number.format(snapshot.serviceMirroring.uses)}</span></dd>
                                </div>
                                <div className="flex items-end justify-between border-b border-gray-100 pb-3">
                                    <dt className="text-sm text-gray-600">Usable end locations</dt>
                                    <dd className="font-bold text-gray-900">{number.format(snapshot.serviceMirroring.usableEndLocations)} <span className="text-xs font-medium text-gray-500">/ {number.format(snapshot.serviceMirroring.uses)}</span></dd>
                                </div>
                                <div className="flex items-end justify-between">
                                    <dt className="text-sm text-gray-600">School-linked reconciliation</dt>
                                    <dd className="font-bold text-gray-900">{number.format(linkedUses + snapshot.serviceMirroring.unattributedUses)}</dd>
                                </div>
                            </dl>
                            <p className="mt-5 rounded-lg bg-gray-50 p-3 text-xs leading-relaxed text-gray-600">School attribution is intentionally conservative. It does not represent enrollment, home school, catchment, or unique riders.</p>
                            <p className="mt-3 rounded-lg border border-blue-100 bg-blue-50 p-3 text-xs leading-relaxed text-blue-900">The workbook has no Service Mirroring or user-group field. This view uses only the High School Student Pass as the working proxy. The separate Innisdale pass record is excluded until its program mapping is confirmed.</p>
                        </div>
                    </section>
                </div>
            </main>
        </div>
    );
};
