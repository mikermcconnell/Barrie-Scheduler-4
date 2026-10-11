import React, { Suspense, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, Bus, BusFront, CalendarRange, ChartNoAxesCombined, ClipboardList, Database, GanttChartSquare, Loader2, Smartphone } from 'lucide-react';
import { TransitAppAnalysisView } from './TransitAppWorkspace';
import {
    loadStrategicPlanServiceProfile,
} from '../../utils/strategic-plan/serviceProfileData';
import type {
    StrategicPlanDayType,
    StrategicPlanServiceProfile,
    StrategicPlanServiceProfileRow,
} from '../../utils/strategic-plan/serviceProfile';
import type { TransitAppDataSummary } from '../../utils/transit-app/transitAppTypes';
import { buildStrategicFleetPlanEvidence } from '../../utils/strategic-plan/fleetPlanEvidence';
import type { FleetPlanWorkbook } from '../../utils/fleet-plan/types';
import type { StrategicWorkplanWorkspaceServices } from './StrategicWorkplanWorkspace';

interface StrategicPlanWorkspaceProps {
    onBack: () => void;
    transitAppData?: TransitAppDataSummary | null;
    transitAppAvailable?: boolean;
    transitAppLoading?: boolean;
    fleetPlanData?: FleetPlanWorkbook | null;
    fleetPlanLoading?: boolean;
    fleetPlanError?: string | null;
    ridershipTeamId?: string;
    requestingTeamId?: string;
    workplanTeamId?: string;
    currentUserId?: string;
    currentUserLabel?: string;
    workplanServices?: StrategicWorkplanWorkspaceServices;
}

const DAY_TYPES: StrategicPlanDayType[] = ['Weekday', 'Saturday', 'Sunday'];
type StrategicPlanSection = 'overview' | 'project-workplan' | 'service-baseline' | 'transit-app' | 'ridership-trends' | 'fleet-plan' | 'master-schedule';

const MasterScheduleBrowser = React.lazy(() =>
    import('../MasterScheduleBrowser').then(module => ({ default: module.MasterScheduleBrowser }))
);

const RidershipTrendsWorkspace = React.lazy(() =>
    import('./RidershipTrendsWorkspace').then(module => ({ default: module.RidershipTrendsWorkspace }))
);

const StrategicWorkplanWorkspace = React.lazy(() =>
    import('./StrategicWorkplanWorkspace').then(module => ({ default: module.StrategicWorkplanWorkspace }))
);

interface EvidenceWorkspaceCardProps {
    title: string;
    description: string;
    source: string;
    icon: React.ReactNode;
    accentClassName: string;
    onClick: () => void;
}

const EvidenceWorkspaceCard: React.FC<EvidenceWorkspaceCardProps> = ({
    title,
    description,
    source,
    icon,
    accentClassName,
    onClick,
}) => (
    <button
        type="button"
        onClick={onClick}
        className="group flex min-h-64 flex-col rounded-2xl border border-slate-200 bg-white p-6 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-lg focus:outline-none focus:ring-2 focus:ring-[#001C80] focus:ring-offset-2"
    >
        <span className={`inline-flex h-12 w-12 items-center justify-center rounded-xl ${accentClassName}`}>
            {icon}
        </span>
        <span className="mt-6 text-lg font-black text-slate-900">{title}</span>
        <span className="mt-2 flex-1 text-sm leading-relaxed text-slate-600">{description}</span>
        <span className="mt-5 text-xs font-bold uppercase tracking-[0.12em] text-slate-400">{source}</span>
        <span className="mt-4 inline-flex items-center gap-2 text-sm font-black text-[#001C80]">
            Open workspace <ArrowRight size={16} className="transition-transform group-hover:translate-x-1" />
        </span>
    </button>
);

const ProjectControlWorkspaceCard: React.FC<{ onClick: () => void }> = ({ onClick }) => (
    <button
        type="button"
        onClick={onClick}
        className="group relative w-full overflow-hidden rounded-3xl border border-indigo-300 bg-gradient-to-br from-[#001C80] via-indigo-900 to-slate-950 p-6 text-left text-white shadow-lg transition hover:-translate-y-0.5 hover:shadow-xl focus:outline-none focus:ring-2 focus:ring-[#001C80] focus:ring-offset-2 sm:p-7"
    >
        <span className="absolute -right-12 -top-16 h-48 w-48 rounded-full bg-white/10 blur-2xl" aria-hidden="true" />
        <span className="relative flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
            <span className="flex items-start gap-4">
                <span className="inline-flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-white/15 ring-1 ring-inset ring-white/25">
                    <GanttChartSquare size={28} />
                </span>
                <span>
                    <span className="text-xs font-black uppercase tracking-[0.18em] text-blue-200">Shared project control</span>
                    <span className="mt-2 block text-2xl font-black">Project Work Plan</span>
                    <span className="mt-2 block max-w-4xl text-sm leading-relaxed text-blue-100">
                        Maintain the complete Dillon schedule, task ownership, status, progress, dates, dependencies, milestones, and update notes. Every shared save records who changed which task fields.
                    </span>
                </span>
            </span>
            <span className="relative inline-flex shrink-0 items-center gap-2 self-start rounded-xl bg-white px-4 py-3 text-sm font-black text-[#001C80] shadow-sm lg:self-center">
                Open full schedule <ArrowRight size={17} className="transition-transform group-hover:translate-x-1" />
            </span>
        </span>
    </button>
);

const EvidenceWorkspaceBack: React.FC<{ onClick: () => void }> = ({ onClick }) => (
    <button
        type="button"
        onClick={onClick}
        className="mb-5 inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50"
    >
        <ArrowLeft size={16} />
        Strategic Plan workspaces
    </button>
);

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

function formatFleetPlanTimestamp(value: string): string {
    const timestamp = Date.parse(value);
    if (!Number.isFinite(timestamp)) return value || 'Unknown';
    return new Intl.DateTimeFormat('en-CA', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
    }).format(new Date(timestamp));
}

const FleetTimelineValue: React.FC<{ value: string }> = ({ value }) => {
    const normalized = value.trim().toUpperCase();
    const className = normalized === 'RETIRE'
        ? 'bg-red-50 text-red-700 ring-red-200'
        : normalized === 'GROWTH'
            ? 'bg-amber-50 text-amber-800 ring-amber-200'
            : normalized.startsWith('PURCHASE')
                ? 'bg-emerald-50 text-emerald-700 ring-emerald-200'
                : value
                    ? 'bg-blue-50 text-[#001C80] ring-blue-200'
                    : 'bg-slate-50 text-slate-400 ring-slate-200';

    return (
        <span className={`inline-flex min-w-16 justify-center rounded-md px-2 py-1 text-xs font-bold ring-1 ring-inset ${className}`}>
            {value || '—'}
        </span>
    );
};

const StrategicFleetPlanView: React.FC<{ workbook: FleetPlanWorkbook }> = ({ workbook }) => {
    const evidence = useMemo(() => buildStrategicFleetPlanEvidence(workbook), [workbook]);

    return (
        <>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
                {evidence.summaries.map(summary => (
                    <article key={summary.year} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                        <div className="text-xs font-black uppercase tracking-[0.14em] text-[#001C80]">{summary.year}</div>
                        <div className="mt-2 text-3xl font-black text-slate-900">{summary.fleetTotal}</div>
                        <div className="text-xs font-semibold text-slate-500">planned fleet total</div>
                        <dl className="mt-3 space-y-1 border-t border-slate-200 pt-3 text-xs">
                            <div className="flex justify-between gap-2"><dt className="text-slate-500">Retiring</dt><dd className="font-bold text-red-700">{summary.retiring}</dd></div>
                            <div className="flex justify-between gap-2"><dt className="text-slate-500">Replacement</dt><dd className="font-bold text-emerald-700">{summary.replacementPurchases}</dd></div>
                            <div className="flex justify-between gap-2"><dt className="text-slate-500">Growth</dt><dd className="font-bold text-amber-700">{summary.growthPurchases}</dd></div>
                        </dl>
                    </article>
                ))}
            </div>

            <div className="mt-5 overflow-x-auto rounded-xl border border-slate-200">
                <table className="w-full min-w-[1120px] border-collapse text-sm">
                    <thead className="bg-[#001C80] text-white">
                        <tr>
                            <th scope="col" className="px-3 py-3 text-left text-xs font-bold uppercase tracking-wide">Unit</th>
                            <th scope="col" className="px-3 py-3 text-left text-xs font-bold uppercase tracking-wide">Bus type</th>
                            <th scope="col" className="px-3 py-3 text-left text-xs font-bold uppercase tracking-wide">Make / model</th>
                            <th scope="col" className="px-3 py-3 text-left text-xs font-bold uppercase tracking-wide">Model year</th>
                            {evidence.years.map(year => (
                                <th key={year} scope="col" className="px-3 py-3 text-center text-xs font-bold uppercase tracking-wide">{year}</th>
                            ))}
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 bg-white">
                        {evidence.rows.map((row, index) => (
                            <tr key={row.id} className={index % 2 === 0 ? 'bg-white' : 'bg-slate-50/60'}>
                                <td className="whitespace-nowrap px-3 py-3 font-black text-slate-900">{row.unitNumber || 'Unassigned'}</td>
                                <td className="whitespace-nowrap px-3 py-3 font-semibold text-slate-600">{row.busType}</td>
                                <td className="px-3 py-3 font-medium text-slate-700">{row.makeModel || '—'}</td>
                                <td className="whitespace-nowrap px-3 py-3 font-semibold text-slate-600">{row.modelYear || '—'}</td>
                                {evidence.years.map(year => (
                                    <td key={year} className="px-3 py-3 text-center"><FleetTimelineValue value={row.timeline[year]} /></td>
                                ))}
                            </tr>
                        ))}
                    </tbody>
                </table>
                {evidence.rows.length === 0 && (
                    <div className="bg-white px-4 py-10 text-center text-sm font-semibold text-slate-500">The canonical Fleet Plan contains no populated rows.</div>
                )}
            </div>
        </>
    );
};

export const StrategicPlanWorkspace: React.FC<StrategicPlanWorkspaceProps> = ({
    onBack,
    transitAppData = null,
    transitAppAvailable = false,
    transitAppLoading = false,
    fleetPlanData = null,
    fleetPlanLoading = false,
    fleetPlanError = null,
    ridershipTeamId,
    requestingTeamId,
    workplanTeamId,
    currentUserId,
    currentUserLabel,
    workplanServices,
}) => {
    const [dayType, setDayType] = useState<StrategicPlanDayType>('Weekday');
    const [section, setSection] = useState<StrategicPlanSection>('overview');
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

    if (section === 'project-workplan' && requestingTeamId) {
        return (
            <Suspense fallback={(
                <div className="flex min-h-[32rem] items-center justify-center gap-3 text-slate-500" role="status" aria-live="polite">
                    <Loader2 className="animate-spin text-[#001C80]" size={24} />
                    <span className="text-sm font-semibold">Loading the project work plan...</span>
                </div>
            )}>
                <StrategicWorkplanWorkspace
                    teamId={workplanTeamId ?? requestingTeamId}
                    userId={currentUserId}
                    userLabel={currentUserLabel}
                    services={workplanServices}
                    onBack={() => setSection('overview')}
                />
            </Suspense>
        );
    }

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
                            <h1 className="text-2xl font-black tracking-tight sm:text-3xl">2027–2032 Strategic Plan</h1>
                            <p className="mt-2 max-w-3xl text-sm leading-relaxed text-blue-100 sm:text-base">
                                Shared project control plus source-specific workspaces for service, ridership, rider-planning, fleet, and published schedule evidence.
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
                {section === 'overview' && (
                    <section aria-labelledby="strategic-workspaces-heading">
                        <div className="mb-6 max-w-3xl">
                            <p className="text-xs font-black uppercase tracking-[0.16em] text-[#001C80]">Project hub</p>
                            <h2 id="strategic-workspaces-heading" className="mt-2 text-2xl font-black text-slate-900">Strategic Plan workspaces</h2>
                            <p className="mt-2 text-sm leading-relaxed text-slate-600">
                                Maintain the shared project schedule, then use the evidence library for source-specific planning context.
                            </p>
                        </div>
                        <ProjectControlWorkspaceCard onClick={() => setSection('project-workplan')} />
                        <div className="mb-4 mt-8">
                            <p className="text-xs font-black uppercase tracking-[0.16em] text-slate-500">Evidence library</p>
                            <p className="mt-1 text-sm text-slate-600">Read-only source workspaces remain separate from project-control edits.</p>
                        </div>
                        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-5">
                            <EvidenceWorkspaceCard
                                title="Current Scheduled Service Route Summaries"
                                description="Compare static-GTFS service spans, scheduled frequency regimes, and revenue hours by service day."
                                source={profile ? `GTFS ${profile.feedStartDate} to ${profile.feedEndDate}` : 'Bundled static GTFS'}
                                icon={<BusFront size={24} />}
                                accentClassName="bg-blue-50 text-[#001C80]"
                                onClick={() => setSection('service-baseline')}
                            />
                            <EvidenceWorkspaceCard
                                title="Trip Planning Trends"
                                description="Review the complete aggregate for demand, trip patterns, stops, transfers, heatmaps, route engagement, and app usage."
                                source={transitAppData
                                    ? `Transit App ${transitAppData.metadata.dateRange.start} to ${transitAppData.metadata.dateRange.end}`
                                    : transitAppAvailable ? 'Configured Transit App source' : 'Transit App source not configured'}
                                icon={<Smartphone size={24} />}
                                accentClassName="bg-cyan-50 text-cyan-700"
                                onClick={() => setSection('transit-app')}
                            />
                            <EvidenceWorkspaceCard
                                title="Annual Ridership"
                                description="Track long-range fixed-route boardings, annual change, and current-year progress as daily STREETS data arrives."
                                source="Workbook baseline + STREETS"
                                icon={<ChartNoAxesCombined size={24} />}
                                accentClassName="bg-violet-50 text-violet-700"
                                onClick={() => setSection('ridership-trends')}
                            />
                            <EvidenceWorkspaceCard
                                title="Bus Fleet Plan"
                                description="Review the canonical 2027–2032 fleet outlook, including planned totals, retirements, replacements, growth, and unit timelines."
                                source={fleetPlanData
                                    ? `Fleet Plan v${fleetPlanData.metadata.currentVersion ?? '—'} · ${fleetPlanData.metadata.sourceFileName}`
                                    : fleetPlanError ? 'Fleet Plan unavailable' : 'Canonical team Fleet Plan'}
                                icon={<Bus size={24} />}
                                accentClassName="bg-amber-50 text-amber-700"
                                onClick={() => setSection('fleet-plan')}
                            />
                            <EvidenceWorkspaceCard
                                title="Published Route Schedules"
                                description="Inspect current published route schedules, service hours, route tables, platform activity, and source versions."
                                source="Canonical team Master Schedule"
                                icon={<ClipboardList size={24} />}
                                accentClassName="bg-emerald-50 text-emerald-700"
                                onClick={() => setSection('master-schedule')}
                            />
                        </div>
                        <div className="mt-6 rounded-xl border border-slate-200 bg-white px-4 py-3 text-xs leading-relaxed text-slate-500">
                            Source boundary: static GTFS describes a dated feed snapshot; Annual Ridership sums fixed-route boardings; Transit App describes app engagement and requested-trip evidence; Fleet Plan describes the current planning record for fleet lifecycle and capital timing; Master Schedule shows the currently published schedule. None establishes causation, approved funding, or delivered outcomes on its own.
                        </div>
                    </section>
                )}

                {section === 'service-baseline' && <>
                <EvidenceWorkspaceBack onClick={() => setSection('overview')} />
                <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
                    <div className="flex flex-col gap-4 border-b border-slate-200 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
                        <div>
                            <h2 className="text-lg font-black text-slate-900">Current Scheduled Service Route Summaries</h2>
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
                    Source: {profile?.feedPublisherName || 'Barrie Transit'} static GTFS. Revenue hours sum scheduled trip time and exclude terminal recovery or deadhead. Frequencies average sustained time bands within matching direction and origin-to-destination patterns. Planning conventions show Route 2 as 30/60-minute service, retain the trailing 60-minute periods on Routes 10/11, and show Routes 100/101 as 41 minutes off-peak. Uniform Sunday service at 60-minute or longer headways is classified as off-peak; Routes 100/101 retain their peak and off-peak split. “N/A” means there is no service in that frequency category.
                </p>
                </>}

                {section === 'transit-app' && (
                    <div>
                    <EvidenceWorkspaceBack onClick={() => setSection('overview')} />
                    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
                        <div className="mb-5 border-b border-slate-200 pb-4">
                            <h2 className="text-lg font-black text-slate-900">Trip Planning Trends</h2>
                            <p className="mt-1 text-sm leading-relaxed text-slate-600">
                                This is the same complete aggregated summary used by the standalone Transit App workspace. It is read-only here and is not a second import or copied dataset.
                            </p>
                            {transitAppData && (
                                <p className="mt-2 text-xs font-semibold text-slate-500">
                                    Evidence period: {transitAppData.metadata.dateRange.start} to {transitAppData.metadata.dateRange.end}
                                </p>
                            )}
                        </div>

                        {transitAppLoading && (
                            <div className="flex min-h-[20rem] items-center justify-center gap-3 text-slate-500" role="status" aria-live="polite">
                                <Loader2 className="animate-spin text-cyan-600" size={24} />
                                <span className="text-sm font-semibold">Loading the canonical Transit App summary…</span>
                            </div>
                        )}

                        {!transitAppLoading && transitAppData && <TransitAppAnalysisView data={transitAppData} />}

                        {!transitAppLoading && !transitAppData && (
                            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-5 text-sm text-amber-900">
                                <div className="font-bold">Transit App evidence unavailable</div>
                                <div className="mt-1">
                                    {transitAppAvailable
                                        ? 'The configured source has metadata, but its aggregated summary could not be loaded.'
                                        : 'No Transit App dataset is configured for this team.'}
                                </div>
                            </div>
                        )}

                        <p className="mt-5 text-xs leading-relaxed text-slate-500">
                            Transit App records describe app engagement, requested trips, inferred origins and destinations, itinerary stop mentions, and transfer patterns. They do not by themselves prove boardings, unique riders, residence, trip completion, or service need.
                        </p>
                    </section>
                    </div>
                )}

                {section === 'fleet-plan' && (
                    <div>
                        <EvidenceWorkspaceBack onClick={() => setSection('overview')} />
                        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
                            <div className="mb-5 border-b border-slate-200 pb-4">
                                <h2 className="text-lg font-black text-slate-900">Bus Fleet Plan</h2>
                                <p className="mt-1 text-sm leading-relaxed text-slate-600">
                                    This is a read-only view of the same canonical shared workbook used by the Fleet Plan workspace. It creates no Strategic Plan copy, snapshot, or second import.
                                </p>
                                {fleetPlanData && (
                                    <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs font-semibold text-slate-500">
                                        <span>Source: {fleetPlanData.metadata.sourceFileName}</span>
                                        <span>Version: {fleetPlanData.metadata.currentVersion ?? 'Unknown'}</span>
                                        <span>Updated: {formatFleetPlanTimestamp(fleetPlanData.metadata.updatedAt)}</span>
                                    </div>
                                )}
                            </div>

                            {fleetPlanLoading && (
                                <div className="flex min-h-[20rem] items-center justify-center gap-3 text-slate-500" role="status" aria-live="polite">
                                    <Loader2 className="animate-spin text-amber-600" size={24} />
                                    <span className="text-sm font-semibold">Loading the canonical Fleet Plan…</span>
                                </div>
                            )}

                            {!fleetPlanLoading && fleetPlanData && <StrategicFleetPlanView workbook={fleetPlanData} />}

                            {!fleetPlanLoading && !fleetPlanData && (
                                <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-5 text-sm text-amber-900">
                                    <div className="font-bold">Fleet Plan evidence unavailable</div>
                                    <div className="mt-1">{fleetPlanError || 'No Fleet Plan dataset is configured for this team.'}</div>
                                </div>
                            )}

                            <p className="mt-5 text-xs leading-relaxed text-slate-500">
                                Fleet Plan records describe current planning assumptions for vehicle lifecycle, replacements, and growth. They do not by themselves establish approved capital funding, procurement timing, vehicle availability, operating cost, or Council approval.
                            </p>
                        </section>
                    </div>
                )}

                {section === 'ridership-trends' && ridershipTeamId && (
                    <Suspense fallback={(
                        <div className="flex min-h-[28rem] items-center justify-center gap-3 text-slate-500" role="status" aria-live="polite">
                            <Loader2 className="animate-spin text-violet-600" size={24} />
                            <span className="text-sm font-semibold">Loading annual ridership evidence…</span>
                        </div>
                    )}>
                        <RidershipTrendsWorkspace
                            teamId={ridershipTeamId}
                            requestingTeamId={requestingTeamId}
                            accessContext="strategicPlan"
                            backLabel="Strategic Plan workspaces"
                            onBack={() => setSection('overview')}
                        />
                    </Suspense>
                )}

                {section === 'ridership-trends' && !ridershipTeamId && (
                    <div>
                        <EvidenceWorkspaceBack onClick={() => setSection('overview')} />
                        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-5 text-sm text-amber-900">
                            <div className="font-bold">Annual Ridership evidence unavailable</div>
                            <div className="mt-1">No STREETS source is configured for this team.</div>
                        </div>
                    </div>
                )}

                {section === 'master-schedule' && (
                    <div>
                        <EvidenceWorkspaceBack onClick={() => setSection('overview')} />
                        <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
                            <div className="border-b border-slate-200 px-5 py-4">
                                <h2 className="text-lg font-black text-slate-900">Published Route Schedules</h2>
                                <p className="mt-1 text-sm leading-relaxed text-slate-600">
                                    This workspace reads the same canonical Master Schedule used by Scheduled Transit. It is read-only here and creates no copied schedule or strategic-plan snapshot.
                                </p>
                            </div>
                            <div className="h-[calc(100vh-15rem)] min-h-[48rem] overflow-hidden">
                                <Suspense fallback={(
                                    <div className="flex h-full items-center justify-center gap-3 text-slate-500" role="status" aria-live="polite">
                                        <Loader2 className="animate-spin text-emerald-600" size={24} />
                                        <span className="text-sm font-semibold">Loading the canonical Master Schedule…</span>
                                    </div>
                                )}>
                                    <MasterScheduleBrowser readOnly />
                                </Suspense>
                            </div>
                            <p className="border-t border-slate-200 px-5 py-4 text-xs leading-relaxed text-slate-500">
                                Master Schedule records are the current published planning source. They do not establish actual service delivered, reliability, ridership, cost, or future Strategic Plan approval.
                            </p>
                        </section>
                    </div>
                )}
            </main>
        </div>
    );
};
