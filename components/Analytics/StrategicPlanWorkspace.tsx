import React, { useEffect, useState } from 'react';
import { ArrowLeft, CalendarRange, Database, Loader2 } from 'lucide-react';
import {
    loadStrategicPlanServiceProfile,
} from '../../utils/strategic-plan/serviceProfileData';
import type {
    StrategicPlanDayType,
    StrategicPlanServiceProfile,
    StrategicPlanServiceProfileRow,
} from '../../utils/strategic-plan/serviceProfile';

interface StrategicPlanWorkspaceProps {
    onBack: () => void;
}

const DAY_TYPES: StrategicPlanDayType[] = ['Weekday', 'Saturday', 'Sunday'];

function formatFrequency(value: number | null): string {
    return value === null ? 'N/A' : `${value} min`;
}

const FrequencyCell: React.FC<{ value: number | null }> = ({ value }) => (
    <span className={`inline-flex min-w-[4.5rem] justify-center rounded-full px-2.5 py-1 text-xs font-bold ${
        value === null
            ? 'bg-slate-100 text-slate-500'
            : value <= 30
                ? 'bg-blue-50 text-[#001C80] ring-1 ring-inset ring-blue-200'
                : 'bg-slate-100 text-slate-700 ring-1 ring-inset ring-slate-200'
    }`}>
        {formatFrequency(value)}
    </span>
);

const MobileRouteCard: React.FC<{ row: StrategicPlanServiceProfileRow }> = ({ row }) => (
    <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-3">
            <div>
                <div className="text-xs font-bold uppercase tracking-[0.16em] text-[#001C80]">Route {row.routeShortName}</div>
                <h3 className="mt-1 text-base font-bold text-slate-900">{row.routeName}</h3>
            </div>
            <div className="rounded-lg bg-[#001C80] px-2.5 py-1.5 text-sm font-black text-white">{row.routeShortName}</div>
        </div>
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
            <div className="col-span-2">
                <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Service span</dt>
                <dd className="mt-1 font-semibold text-slate-900">{row.serviceSpan}</dd>
            </div>
            <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Peak frequency</dt>
                <dd className="mt-1"><FrequencyCell value={row.peakFrequencyMinutes} /></dd>
            </div>
            <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Off-peak frequency</dt>
                <dd className="mt-1"><FrequencyCell value={row.offPeakFrequencyMinutes} /></dd>
            </div>
            <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Peak span</dt>
                <dd className="mt-1 font-medium text-slate-700">{row.peakFrequencySpan}</dd>
            </div>
            <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Off-peak span</dt>
                <dd className="mt-1 font-medium text-slate-700">{row.offPeakFrequencySpan}</dd>
            </div>
            <div className="col-span-2 border-t border-slate-100 pt-3">
                <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Revenue hours per day</dt>
                <dd className="mt-1 text-lg font-black text-[#001C80]">{row.revenueHours.toFixed(1)}</dd>
            </div>
        </dl>
    </article>
);

export const StrategicPlanWorkspace: React.FC<StrategicPlanWorkspaceProps> = ({ onBack }) => {
    const [dayType, setDayType] = useState<StrategicPlanDayType>('Weekday');
    const [profile, setProfile] = useState<StrategicPlanServiceProfile | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let active = true;
        loadStrategicPlanServiceProfile()
            .then(result => {
                if (active) setProfile(result);
            })
            .catch(loadError => {
                if (active) setError(loadError instanceof Error ? loadError.message : 'Unable to load the bundled GTFS feed.');
            });
        return () => { active = false; };
    }, []);

    const rows = profile?.rowsByDayType[dayType] || [];

    return (
        <div className="min-h-full bg-slate-50">
            <header className="bg-[#001C80] text-white shadow-sm">
                <div className="mx-auto max-w-[1500px] px-4 py-5 sm:px-6 lg:px-8">
                    <button
                        type="button"
                        onClick={onBack}
                        aria-label="Back to Planning Data"
                        className="mb-4 inline-flex items-center gap-2 rounded-lg border border-white/25 bg-white/10 px-3 py-2 text-sm font-semibold text-white transition hover:bg-white/20"
                    >
                        <ArrowLeft size={16} />
                        Planning Data
                    </button>
                    <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
                        <div>
                            <div className="mb-2 flex items-center gap-2 text-blue-100">
                                <CalendarRange size={18} />
                                <span className="text-xs font-bold uppercase tracking-[0.18em]">Planning baseline</span>
                            </div>
                            <h1 className="text-2xl font-black tracking-tight sm:text-3xl">5-Year Strategic Plan</h1>
                            <p className="mt-2 max-w-3xl text-sm leading-relaxed text-blue-100 sm:text-base">
                                Existing fixed-route service profile for strategic-plan baselining and future service comparisons.
                            </p>
                        </div>
                        {profile && (
                            <div className="rounded-xl border border-white/20 bg-white/10 px-4 py-3 text-xs text-blue-50">
                                <div className="flex items-center gap-2 font-bold text-white"><Database size={14} /> Static GTFS snapshot</div>
                                <div className="mt-1">Version {profile.feedVersion} · {profile.feedStartDate} to {profile.feedEndDate}</div>
                            </div>
                        )}
                    </div>
                </div>
            </header>

            <main className="mx-auto max-w-[1500px] px-4 py-6 sm:px-6 lg:px-8">
                <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
                    <div className="flex flex-col gap-4 border-b border-slate-200 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
                        <div>
                            <h2 className="text-lg font-black text-slate-900">Existing Service Profile</h2>
                            <p className="mt-1 text-sm text-slate-500">Service spans are rounded to 15 minutes; frequencies are simplified route-level scheduled headways.</p>
                        </div>
                        <div className="inline-flex self-start rounded-xl bg-slate-100 p-1" role="tablist" aria-label="Service day">
                            {DAY_TYPES.map(option => (
                                <button
                                    key={option}
                                    type="button"
                                    role="tab"
                                    aria-selected={dayType === option}
                                    onClick={() => setDayType(option)}
                                    className={`rounded-lg px-3 py-2 text-sm font-bold transition ${
                                        dayType === option ? 'bg-[#001C80] text-white shadow-sm' : 'text-slate-600 hover:bg-white hover:text-slate-900'
                                    }`}
                                >
                                    {option}
                                </button>
                            ))}
                        </div>
                    </div>

                    {!profile && !error && (
                        <div className="flex min-h-[20rem] items-center justify-center gap-3 text-slate-500">
                            <Loader2 className="animate-spin text-[#001C80]" size={24} />
                            <span className="text-sm font-semibold">Calculating service profile from the bundled GTFS…</span>
                        </div>
                    )}

                    {error && (
                        <div className="m-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
                            <div className="font-bold">Service profile unavailable</div>
                            <div className="mt-1">{error}</div>
                        </div>
                    )}

                    {profile && (
                        <>
                            <div className="hidden overflow-x-auto lg:block">
                                <table className="w-full min-w-[1180px] border-collapse text-sm">
                                    <thead className="bg-[#001C80] text-white">
                                        <tr>
                                            {['Route', 'Route Short Name', 'Service Span', 'Peak Frequency', 'Peak Frequency Span', 'Off-Peak Frequency', 'Off-Peak Frequency Span', 'Revenue Hours / Day'].map(header => (
                                                <th key={header} scope="col" className="border-r border-white/15 px-3 py-3 text-left text-xs font-bold uppercase tracking-wide last:border-r-0">
                                                    {header}
                                                </th>
                                            ))}
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-200">
                                        {rows.map((row, index) => (
                                            <tr key={row.routeShortName} className={index % 2 === 0 ? 'bg-white' : 'bg-blue-50/35'}>
                                                <td className="px-3 py-3 font-bold text-slate-900">{row.routeName}</td>
                                                <td className="px-3 py-3"><span className="inline-flex min-w-10 justify-center rounded-md bg-[#001C80] px-2 py-1 font-black text-white">{row.routeShortName}</span></td>
                                                <td className="whitespace-nowrap px-3 py-3 font-semibold text-slate-700">{row.serviceSpan}</td>
                                                <td className="px-3 py-3"><FrequencyCell value={row.peakFrequencyMinutes} /></td>
                                                <td className="px-3 py-3 font-medium text-slate-700">{row.peakFrequencySpan}</td>
                                                <td className="px-3 py-3"><FrequencyCell value={row.offPeakFrequencyMinutes} /></td>
                                                <td className="px-3 py-3 font-medium text-slate-700">{row.offPeakFrequencySpan}</td>
                                                <td className="px-3 py-3 text-right text-base font-black text-[#001C80]">{row.revenueHours.toFixed(1)}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>

                            <div className="grid gap-3 p-4 lg:hidden">
                                {rows.map(row => <MobileRouteCard key={row.routeShortName} row={row} />)}
                            </div>
                        </>
                    )}
                </section>

                <p className="mt-4 text-xs leading-relaxed text-slate-500">
                    Source: {profile?.feedPublisherName || 'Barrie Transit'} static GTFS. Revenue hours sum scheduled trip time and exclude terminal recovery or deadhead. Frequency periods are derived independently by direction and summarized to the nearest five minutes; “N/A” means the feed does not contain a distinct second frequency regime.
                </p>
            </main>
        </div>
    );
};
