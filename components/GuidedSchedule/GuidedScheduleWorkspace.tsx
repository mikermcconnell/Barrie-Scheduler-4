import React, { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, Loader2, X } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useTeam } from '../contexts/TeamContext';
import { useToast } from '../contexts/ToastContext';
import { getAllStopsWithCodes, getMasterSchedule, getMasterScheduleEntry } from '../../utils/services/masterScheduleService';
import { getDraft } from '../../utils/services/draftService';
import { buildMasterContentFromTables } from '../../utils/schedule/scheduleDraftAdapter';
import { buildStopNameToIdMap } from '../../utils/gtfs/gtfsStopLookup';
import { buildRouteIdentity, type MasterScheduleContent } from '../../utils/masterScheduleTypes';
import type { DraftBasedOn, DraftStatus } from '../../utils/schedule/scheduleTypes';
import type { ConnectionLibrary } from '../../utils/connections/connectionTypes';
import { lazyWithRetry } from '../../utils/lazyWithRetry';
import { Step2Analysis } from '../NewSchedule/steps/Step2Analysis';
import { Step3Build } from '../NewSchedule/steps/Step3Build';
import { GuidedApprovalBar } from './GuidedApprovalBar';
import { GuidedLoadingModal } from './GuidedLoadingModal';
import { GuidedStep1 } from './GuidedStep1';
import { GuidedStep2Review } from './GuidedStep2Review';
import { GuidedStep4 } from './build/GuidedStep4';
import { GuidedStep5, type GuidedPackageRow } from './package/GuidedStep5';
import { GUIDED_STEPS, canEnterGuidedStep, resolveGuidedStep, type GuidedGateState, type GuidedStep } from './guidedSteps';
import { GUIDED_DAY_TYPES, guidedSelectionKey } from './guidedSelection';
import { useGuidedPerformanceSource } from './useGuidedPerformanceSource';
import { useGuidedRuntimeReview, type GuidedRuntimeReview } from './runtimeReview/useGuidedRuntimeReview';
import { prepareRuntimeReview } from './runtimeReview/prepareRuntimeReview';
import { buildRuntimeReviewModel } from './runtimeReview/buildRuntimeReviewModel';
import type { GuidedDayType } from './runtimeReview/guidedRuntimeReviewTypes';
import { describeStrictCycleCheck, generateGuidedSchedule } from './build/generateGuidedSchedule';
import {
    applyGenerated,
    countTrips,
    createGuidedBuildState,
    isGeneratedCurrent,
    type GuidedBuildState,
} from './build/guidedBuildState';
import {
    EMPTY_PACKAGE_ENTRY,
    canExportPackage,
    confirmPublishedVersion,
    getPackageStatus,
    type GuidedPackageEntry,
} from './package/guidedPackageState';

const ScheduleEditorWorkspace = lazyWithRetry(
    () => import('../workspaces/ScheduleEditorWorkspace').then(module => ({ default: module.ScheduleEditorWorkspace })),
    'GuidedScheduleEditorWorkspace'
);
const PublicTimetable = lazyWithRetry(
    () => import('../Reports/PublicTimetable').then(module => ({ default: module.PublicTimetable })),
    'GuidedPublicTimetable'
);
const RunCuttingWorkspace = lazyWithRetry(
    () => import('../workspaces/RunCuttingWorkspace').then(module => ({ default: module.RunCuttingWorkspace })),
    'GuidedRunCuttingWorkspace'
);

interface GuidedScheduleWorkspaceProps {
    onClose: () => void;
}

interface SkippedDayType {
    dayType: GuidedDayType;
    reason: string;
}

type GuidedOverlay =
    | {
        kind: 'editor';
        dayType: GuidedDayType;
        content: MasterScheduleContent;
        basedOn?: DraftBasedOn;
        draftId?: string;
        draftName?: string;
        draftStatus?: DraftStatus;
        draftUpdatedAt?: Date;
    }
    | { kind: 'brochure' }
    | { kind: 'run-cutting' };

type DayRecord<T> = Record<GuidedDayType, T>;

const EMPTY_BUILDS: DayRecord<GuidedBuildState | null> = { Weekday: null, Saturday: null, Sunday: null };
const EMPTY_PACKAGES: DayRecord<GuidedPackageEntry> = { Weekday: EMPTY_PACKAGE_ENTRY, Saturday: EMPTY_PACKAGE_ENTRY, Sunday: EMPTY_PACKAGE_ENTRY };

const approvalChip = (review: GuidedRuntimeReview): { label: string; className: string } => {
    if (review.approvalState === 'approved') return { label: 'approved', className: 'bg-emerald-100 text-emerald-800' };
    if (review.approvalState === 'stale') return { label: 'approve again', className: 'bg-amber-100 text-amber-800' };
    if (review.reviewResult?.health.status === 'blocked') return { label: 'blocked', className: 'bg-red-100 text-red-700' };
    return { label: 'needs review', className: 'bg-amber-100 text-amber-800' };
};

const buildChip = (build: GuidedBuildState | null, current: boolean): { label: string; className: string } => {
    if (!build || build.schedules.length === 0) return { label: 'not generated', className: 'bg-gray-100 text-gray-600' };
    if (!current) return { label: 'generate again', className: 'bg-amber-100 text-amber-800' };
    return { label: `${countTrips(build.schedules)} trips`, className: 'bg-emerald-100 text-emerald-800' };
};

const buildStopSuggestions = (segmentNames: string[]): string[] => {
    const seen = new Set<string>();
    const ordered: string[] = [];
    segmentNames.forEach(name => {
        const parts = name.split(' to ');
        if (parts.length !== 2) return;
        parts.forEach(part => {
            const cleaned = part.trim();
            if (!cleaned || seen.has(cleaned.toLowerCase())) return;
            seen.add(cleaned.toLowerCase());
            ordered.push(cleaned);
        });
    });
    return ordered;
};

/**
 * Guided scheduling workspace (in development). Reuses the New Schedule
 * engine behind a new five-step shell; see docs/GUIDED_SCHEDULING.md.
 */
export const GuidedScheduleWorkspace: React.FC<GuidedScheduleWorkspaceProps> = ({ onClose }) => {
    const { user } = useAuth();
    const { team } = useTeam();
    const toast = useToast();
    const source = useGuidedPerformanceSource(team?.id);
    // One review per day type; hook count is fixed, so this is safe.
    const reviews: DayRecord<GuidedRuntimeReview> = {
        Weekday: useGuidedRuntimeReview(),
        Saturday: useGuidedRuntimeReview(),
        Sunday: useGuidedRuntimeReview(),
    };
    const [step, setStep] = useState<GuidedStep>(1);
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [analyzedKey, setAnalyzedKey] = useState<string | null>(null);
    const [reviewedDayTypes, setReviewedDayTypes] = useState<GuidedDayType[]>([]);
    const [skippedDayTypes, setSkippedDayTypes] = useState<SkippedDayType[]>([]);
    const [activeDayType, setActiveDayType] = useState<GuidedDayType>('Weekday');
    const [builds, setBuilds] = useState<DayRecord<GuidedBuildState | null>>(EMPTY_BUILDS);
    const [packages, setPackages] = useState<DayRecord<GuidedPackageEntry>>(EMPTY_PACKAGES);
    const [generatingDay, setGeneratingDay] = useState<GuidedDayType | null>(null);
    const [packageBusyDay, setPackageBusyDay] = useState<GuidedDayType | null>(null);
    const [overlay, setOverlay] = useState<GuidedOverlay | null>(null);
    const [connectionLibrary, setConnectionLibrary] = useState<ConnectionLibrary | null>(null);
    const [masterStopCodes, setMasterStopCodes] = useState<Record<string, string>>({});
    const gtfsStopLookup = useMemo(() => buildStopNameToIdMap(), []);
    const packagesRef = useRef(packages);
    packagesRef.current = packages;

    useEffect(() => {
        if (!team?.id) return;
        getAllStopsWithCodes(team.id)
            .then(({ stopCodes }) => setMasterStopCodes(stopCodes))
            .catch(error => console.error('Failed to load master stop codes:', error));
    }, [team?.id]);

    const { selection } = source;
    const currentKey = guidedSelectionKey(selection);
    const routeNumber = selection.routeId ?? '';
    const reviewed = reviewedDayTypes.map(dayType => reviews[dayType]);
    const reviewIsCurrent = analyzedKey === currentKey && reviewed.length > 0 && reviewed.every(review => !!review.reviewResult);
    const buildIsCurrent = (dayType: GuidedDayType): boolean => {
        const build = builds[dayType];
        return !!build && isGeneratedCurrent(build, reviews[dayType].currentContract);
    };
    const gate: GuidedGateState = {
        hasReview: reviewIsCurrent,
        approvalState: reviewed.length > 0 && reviewed.every(review => review.approvalState === 'approved')
            ? 'approved'
            : reviewed.some(review => review.approvalState === 'stale') ? 'stale' : 'unapproved',
        hasCurrentSchedules: reviewedDayTypes.length > 0 && reviewedDayTypes.every(buildIsCurrent),
    };
    const visibleStep = resolveGuidedStep(step, gate);
    const approvedCount = reviewed.filter(review => review.approvalState === 'approved').length;
    const generatedCount = reviewedDayTypes.filter(buildIsCurrent).length;

    const active = reviewedDayTypes.includes(activeDayType) ? reviews[activeDayType] : reviewed[0];
    const activeDay = reviewedDayTypes.includes(activeDayType) ? activeDayType : reviewedDayTypes[0];
    const activeBuild = activeDay ? builds[activeDay] : null;

    const packageRows: GuidedPackageRow[] = reviewedDayTypes.map(dayType => {
        const schedules = builds[dayType]?.schedules ?? [];
        return { dayType, entry: packages[dayType], status: getPackageStatus(packages[dayType], schedules), tripCount: countTrips(schedules) };
    });
    const publishedCount = packageRows.filter(row => row.status === 'published').length;

    const routeLabel = analyzedKey && reviewedDayTypes.length > 0 && selection.routeId
        ? `Route ${selection.routeId} · ${reviewedDayTypes.join(', ')}`
        : null;

    const updateBuild = (dayType: GuidedDayType, update: (state: GuidedBuildState) => GuidedBuildState) => {
        setBuilds(current => ({ ...current, [dayType]: update(current[dayType] ?? createGuidedBuildState(routeNumber)) }));
    };

    const goToStep = (target: GuidedStep) => {
        if (target >= 3) {
            setBuilds(current => {
                const next = { ...current };
                reviewedDayTypes.forEach(dayType => {
                    if (!next[dayType]) next[dayType] = createGuidedBuildState(routeNumber);
                });
                return next;
            });
        }
        setStep(target);
    };

    const handleAnalyze = async () => {
        const { routeId, dayTypes, dateRange } = selection;
        if (!routeId) {
            toast.warning('No Route', 'Choose a route first.');
            return;
        }
        if (dayTypes.length === 0) {
            toast.warning('No Day Types', 'Select at least one day type.');
            return;
        }
        if (dateRange) {
            if (!dateRange.start || !dateRange.end || dateRange.start > dateRange.end) {
                toast.warning('Invalid Date Range', 'Start date must be on or before end date.');
                return;
            }
            const available = source.availableDateRange;
            if (available && (dateRange.start < available.start || dateRange.end > available.end)) {
                toast.warning('Date Range Out of Bounds', `Available data is ${available.start} to ${available.end}.`);
                return;
            }
        }
        if (!source.cleanData || source.cleanData.dailySummaries.length === 0) {
            toast.warning('Clean History Needed', 'Import at least one day with the current STREETS pipeline before building schedules.');
            return;
        }

        setIsAnalyzing(true);
        try {
            const teamId = team?.id;
            const loadMasterStops = teamId
                ? async (routeIdentity: Parameters<typeof getMasterSchedule>[1]) => {
                    const master = await getMasterSchedule(teamId, routeIdentity);
                    return master
                        ? { North: master.content.northTable.stops || [], South: master.content.southTable.stops || [] }
                        : null;
                }
                : undefined;

            const loaded: GuidedDayType[] = [];
            const skipped: SkippedDayType[] = [];
            for (const dayType of GUIDED_DAY_TYPES) {
                if (!dayTypes.includes(dayType)) {
                    reviews[dayType].reset();
                    continue;
                }
                const readiness = source.readiness.find(entry => entry.dayType === dayType);
                if (readiness?.status === 'coarse-only') {
                    skipped.push({ dayType, reason: 'only older coarse summaries; re-import STREETS data' });
                    reviews[dayType].reset();
                    continue;
                }
                const prepared = await prepareRuntimeReview({
                    dailySummaries: source.cleanData.dailySummaries,
                    routeId,
                    dayType,
                    dateRange,
                    loadMasterStops,
                });
                if (prepared.results.length === 0) {
                    skipped.push({ dayType, reason: 'no segment runtime data in this window' });
                    reviews[dayType].reset();
                    continue;
                }
                reviews[dayType].load({
                    prepared,
                    model: buildRuntimeReviewModel(prepared.results, prepared.displayResults),
                    diagnostics: source.diagnosticsFor(dayType),
                    dayType,
                    dateRange,
                });
                loaded.push(dayType);
            }

            setSkippedDayTypes(skipped);
            setReviewedDayTypes(loaded);
            setBuilds(EMPTY_BUILDS);
            setPackages(EMPTY_PACKAGES);
            if (loaded.length === 0) {
                setAnalyzedKey(null);
                toast.error('No Data', `No usable runtime data for Route ${routeId} in the selected day types and dates.`);
                return;
            }
            if (skipped.length > 0) {
                toast.warning('Some Day Types Skipped', skipped.map(entry => `${entry.dayType}: ${entry.reason}`).join(' · '));
            }
            setAnalyzedKey(currentKey);
            setActiveDayType(loaded[0]);
            setStep(2);
        } catch (error) {
            console.error(error);
            toast.error('Compute Error', 'Failed to compute runtimes from performance data.');
        } finally {
            setIsAnalyzing(false);
        }
    };

    const handleApprove = () => {
        if (!active || !activeDay) return;
        if (active.approve()) toast.success('Runtimes Approved', `${activeDay} runtimes are approved.`);
        else toast.warning('Approval Failed', 'Review the warnings and try again.');
    };

    const handleGenerate = async (dayType: GuidedDayType) => {
        const review = reviews[dayType];
        const contract = review.currentContract;
        const build = builds[dayType] ?? createGuidedBuildState(routeNumber);
        if (!contract || !review.model || !review.loaded) {
            toast.error('Runtime Model Missing', `Approve ${dayType} runtimes in Step 2 first.`);
            return;
        }
        const cycleCheck = describeStrictCycleCheck(contract, build.config);
        if (cycleCheck) toast.warning('Check Strict Cycle Time', cycleCheck);

        setGeneratingDay(dayType);
        try {
            const teamId = team?.id;
            const result = await generateGuidedSchedule({
                contract,
                config: build.config,
                parsedData: review.model.parsedData,
                fallbackCanonicalStops: review.loaded.prepared.canonicalDirectionStops,
                autofillFromMaster: build.autofillFromMaster,
                gtfsStopLookup,
                masterStopCodes,
                loadMasterTables: teamId
                    ? async () => {
                        const master = await getMasterSchedule(teamId, buildRouteIdentity(routeNumber, dayType));
                        return master ? [master.content.northTable, master.content.southTable].filter(Boolean) : null;
                    }
                    : undefined,
            });
            if (result.ok === false) {
                toast.error(result.title, result.message);
                return;
            }
            updateBuild(dayType, current => applyGenerated(current, result.tables, result.config, result.fingerprint));
            toast.success('Schedule Generated', `${dayType}: ${countTrips(result.tables)} trips.`);
            result.notices.forEach(notice => toast.info('Recovery', notice));
        } finally {
            setGeneratingDay(null);
        }
    };

    const checkPublished = async (dayType: GuidedDayType, quiet = false) => {
        const draftId = packagesRef.current[dayType].draftId;
        if (!team?.id || !draftId) return;
        setPackageBusyDay(dayType);
        try {
            const entry = await getMasterScheduleEntry(team.id, buildRouteIdentity(routeNumber, dayType));
            const published = confirmPublishedVersion(entry, draftId);
            setPackages(current => ({ ...current, [dayType]: { ...current[dayType], published } }));
            if (published) toast.success('Published', `${dayType} is published as version ${published.version}.`);
            else if (!quiet) toast.info('Not Published Yet', `Master ${dayType} was not published from this draft.`);
        } catch (error) {
            console.error(error);
            toast.error('Status Check Failed', `Could not read the ${dayType} master schedule.`);
        } finally {
            setPackageBusyDay(null);
        }
    };

    const openEditor = async (dayType: GuidedDayType) => {
        const schedules = builds[dayType]?.schedules ?? [];
        const entry = packages[dayType];
        if (entry.draftId && entry.draftSource === schedules && user?.uid) {
            setPackageBusyDay(dayType);
            try {
                const draft = await getDraft(user.uid, entry.draftId);
                if (draft?.content) {
                    setOverlay({
                        kind: 'editor',
                        dayType,
                        content: draft.content,
                        basedOn: draft.basedOn,
                        draftId: draft.id,
                        draftName: draft.name,
                        draftStatus: draft.status,
                        draftUpdatedAt: draft.updatedAt,
                    });
                    return;
                }
                toast.warning('Draft Not Found', 'Opening a new draft from the current schedule.');
            } catch (error) {
                console.error(error);
                toast.error('Draft Load Failed', 'Could not load the saved draft.');
                return;
            } finally {
                setPackageBusyDay(null);
            }
        }
        const content = buildMasterContentFromTables(schedules);
        if (!content) {
            toast.error('Cannot Open Editor', 'The schedule mixes routes or day types.');
            return;
        }
        setPackages(current => ({ ...current, [dayType]: { draftId: null, draftSource: schedules, published: null } }));
        setOverlay({ kind: 'editor', dayType, content: content.content, basedOn: { type: 'generated' } });
    };

    const closeOverlay = () => {
        const closing = overlay;
        setOverlay(null);
        if (closing?.kind === 'editor') void checkPublished(closing.dayType, true);
    };

    const footer = (() => {
        if (visibleStep === 1) {
            return {
                message: reviewIsCurrent
                    ? 'A review exists for this selection. Re-analyze to start over.'
                    : !selection.routeId
                        ? 'Pick a route to begin.'
                        : !selection.timeFrameSet
                            ? `Choose a time frame to load Route ${selection.routeId} data.`
                            : source.dataLoading
                                ? `Loading Route ${selection.routeId} data…`
                                : analyzedKey ? 'Your selection changed. Re-analyze to update the review.' : 'Ready to analyze.',
                label: 'Analyze runtimes',
                disabled: isAnalyzing || !source.dataLoaded || selection.dayTypes.length === 0,
                onClick: () => { void handleAnalyze(); },
            };
        }
        if (visibleStep === 2) {
            return {
                message: gate.approvalState === 'approved'
                    ? 'All day types approved.'
                    : `${approvedCount} of ${reviewed.length} day type${reviewed.length === 1 ? '' : 's'} approved. Approve each one to continue.`,
                label: 'Continue to Set the stage',
                disabled: !canEnterGuidedStep(3, gate),
                onClick: () => goToStep(3),
            };
        }
        if (visibleStep === 3) {
            return {
                message: 'Set the span of service and the blocks for each day type. Generation happens in the next step.',
                label: 'Continue to Build',
                disabled: false,
                onClick: () => goToStep(4),
            };
        }
        if (visibleStep === 4) {
            return {
                message: `${generatedCount} of ${reviewedDayTypes.length} day type${reviewedDayTypes.length === 1 ? '' : 's'} generated and current.`,
                label: 'Continue to Package',
                disabled: !canEnterGuidedStep(5, gate),
                onClick: () => goToStep(5),
            };
        }
        return {
            message: canExportPackage(packageRows.map(row => row.status))
                ? 'All day types published. Build the brochure and run-cut workbook.'
                : `${publishedCount} of ${packageRows.length} day type${packageRows.length === 1 ? '' : 's'} published.`,
            label: 'Close',
            disabled: false,
            onClick: onClose,
        };
    })();

    const health = active?.reviewResult?.health ?? null;
    const showDayTabs = (visibleStep === 2 || visibleStep === 3 || visibleStep === 4) && reviewedDayTypes.length > 0;

    return (
        <div className="flex h-full min-h-0 flex-col bg-white">
            {isAnalyzing ? (
                <GuidedLoadingModal
                    title="Analyzing performance runtimes"
                    message="One review per day type. This can take a few seconds."
                />
            ) : visibleStep === 1 && source.dataLoading && (
                <GuidedLoadingModal
                    title={`Loading Route ${selection.routeId} data`}
                    message={selection.dateRange
                        ? `Fetching STREETS history for ${selection.dateRange.start} to ${selection.dateRange.end}.`
                        : 'Fetching all available STREETS history.'}
                    progress={source.dataLoadProgress}
                />
            )}
            {generatingDay && (
                <GuidedLoadingModal title={`Generating ${generatingDay} schedule`} message="Building trips from the approved runtimes." />
            )}

            {overlay && (
                <div className="fixed inset-0 z-[120] flex flex-col bg-white">
                    <Suspense fallback={<div className="flex flex-1 items-center justify-center text-sm text-gray-500"><Loader2 size={16} className="mr-2 animate-spin" /> Loading…</div>}>
                        {overlay.kind === 'editor' && (
                            <ScheduleEditorWorkspace
                                initialContent={overlay.content}
                                basedOn={overlay.basedOn}
                                currentDraftId={overlay.draftId}
                                currentDraftName={overlay.draftName ?? `Route ${routeNumber} ${overlay.dayType} (guided)`}
                                currentDraftStatus={overlay.draftStatus}
                                currentDraftUpdatedAt={overlay.draftUpdatedAt}
                                onDraftMetadataChange={draft => {
                                    if (!draft.id) return;
                                    const id = draft.id;
                                    setPackages(current => (
                                        current[overlay.dayType].draftId === id
                                            ? current
                                            : { ...current, [overlay.dayType]: { ...current[overlay.dayType], draftId: id, published: null } }
                                    ));
                                }}
                                onClose={closeOverlay}
                            />
                        )}
                        {overlay.kind === 'brochure' && (
                            <div className="min-h-0 flex-1 overflow-auto">
                                <PublicTimetable onBack={closeOverlay} initialRouteNumber={routeNumber} />
                            </div>
                        )}
                        {overlay.kind === 'run-cutting' && (
                            <RunCuttingWorkspace
                                onClose={closeOverlay}
                                initialSelection={{
                                    masterIds: reviewedDayTypes.map(dayType => buildRouteIdentity(routeNumber, dayType)),
                                    dayTypes: reviewedDayTypes,
                                    scenarioName: `Route ${routeNumber} run cut`,
                                }}
                            />
                        )}
                    </Suspense>
                </div>
            )}

            {/* Compact top bar: the content gets the screen. */}
            <div className="flex shrink-0 items-center gap-3 border-b border-gray-200 px-4 py-2">
                <div className="whitespace-nowrap text-sm font-bold text-gray-900">
                    Guided Schedule <span className="ml-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase text-amber-800">beta</span>
                </div>
                {routeLabel && <div className="whitespace-nowrap text-xs font-semibold text-gray-500">{routeLabel}</div>}
                <nav className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto" aria-label="Guided steps">
                    {GUIDED_STEPS.map((definition, index) => {
                        const isCurrent = definition.step === visibleStep;
                        const isDone = definition.step < visibleStep || (definition.step === 2 && gate.approvalState === 'approved');
                        return (
                            <React.Fragment key={definition.step}>
                                {index > 0 && <span className="text-gray-300">›</span>}
                                <button
                                    type="button"
                                    onClick={() => goToStep(definition.step)}
                                    disabled={!canEnterGuidedStep(definition.step, gate)}
                                    aria-current={isCurrent ? 'step' : undefined}
                                    className={`flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold ${
                                        isCurrent ? 'bg-gray-900 text-white' : isDone ? 'text-emerald-700 hover:bg-emerald-50' : 'text-gray-500'
                                    } disabled:cursor-not-allowed disabled:opacity-50`}
                                >
                                    {isDone && !isCurrent ? <Check size={12} /> : <span>{definition.step}</span>}
                                    {definition.label}
                                </button>
                            </React.Fragment>
                        );
                    })}
                </nav>
                <button type="button" onClick={onClose} className="rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700" aria-label="Close guided schedule">
                    <X size={18} />
                </button>
            </div>

            {showDayTabs && (
                <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-gray-200 px-4 py-2 sm:px-6" role="tablist" aria-label="Day types">
                    <span className="text-[11px] font-bold uppercase tracking-wide text-gray-500">Day type</span>
                    {reviewedDayTypes.map(dayType => {
                        const chip = visibleStep === 2 ? approvalChip(reviews[dayType]) : buildChip(builds[dayType], buildIsCurrent(dayType));
                        const selected = dayType === activeDay;
                        return (
                            <button
                                key={dayType}
                                type="button"
                                role="tab"
                                aria-selected={selected}
                                onClick={() => setActiveDayType(dayType)}
                                className={`flex items-center gap-2 rounded-full border px-3 py-1 text-sm font-semibold ${
                                    selected ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-200 bg-white text-gray-800 hover:bg-gray-50'
                                }`}
                            >
                                {dayType}
                                <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${chip.className}`}>{chip.label}</span>
                            </button>
                        );
                    })}
                    {skippedDayTypes.map(entry => (
                        <span key={entry.dayType} title={entry.reason} className="rounded-full border border-dashed border-gray-300 px-3 py-1 text-sm text-gray-400">
                            <span className="line-through">{entry.dayType}</span>
                            <span className="ml-1.5 text-[11px]">skipped: {entry.reason}</span>
                        </span>
                    ))}
                </div>
            )}

            <div className="min-h-0 flex-1 overflow-auto px-4 py-4 sm:px-6">
                {visibleStep === 1 && <GuidedStep1 source={source} />}

                {visibleStep === 2 && active?.model && active.loaded && active.orientationView && (
                    <div className="space-y-4">
                        {active.model.detectedRouteNumber
                            && active.model.detectedRouteNumber.toUpperCase() !== active.loaded.prepared.routeNumber.toUpperCase() && (
                            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900">
                                The runtime rows identify route <b>{active.model.detectedRouteNumber}</b>, but you selected route <b>{active.loaded.prepared.routeNumber}</b>. The review uses your selection; check that this is the right route before approving.
                            </div>
                        )}
                        <GuidedStep2Review
                            key={activeDay}
                            dayType={active.loaded.dayType}
                            analysis={active.orientationView.analysis}
                            bands={active.orientationView.bands}
                            onAnalysisChange={active.updateAnalysis}
                            orientationCounts={{
                                North: active.cycleAnalysis?.North?.length ?? 0,
                                South: active.cycleAnalysis?.South?.length ?? 0,
                            }}
                            selectedDirection={active.selectedDirection}
                            onDirectionChange={active.setSelectedDirection}
                            detail={(
                                <Step2Analysis
                                    key={activeDay}
                                    dayType={active.loaded.dayType}
                                    routeNumber={active.loaded.prepared.routeNumber}
                                    analysis={active.orientationView.analysis}
                                    bands={active.orientationView.bands}
                                    setAnalysis={active.updateAnalysis}
                                    segmentsMap={active.model.segmentsMap}
                                    matrixAnalysis={active.model.matrixAnalysis}
                                    matrixSegmentsMap={active.model.matrixSegmentsMap}
                                    canonicalSegmentColumns={active.loaded.prepared.canonicalSegmentColumns}
                                    canonicalDirectionStops={active.loaded.prepared.canonicalDirectionStops}
                                    healthReport={health}
                                    approvedRuntimeModel={active.approvedModel}
                                    approvalState={active.approvalState}
                                    approvedRuntimeContract={active.contract}
                                    warningAcknowledged={active.warningsAcknowledged}
                                    onWarningAcknowledgedChange={active.setWarningsAcknowledged}
                                    troubleshootingPatternWarning={active.model.troubleshootingPatternWarning}
                                />
                            )}
                        />
                    </div>
                )}

                {visibleStep === 3 && activeDay && active?.currentContract && activeBuild && (
                    <div className="space-y-3">
                        <div>
                            <h2 className="text-lg font-bold text-gray-900">Set the stage · {activeDay}</h2>
                            <p className="text-sm text-gray-500">Span of service and vehicles: each block is one vehicle, with its start and end times. Set the cycle and recovery here; the schedule is generated in Step 4.</p>
                        </div>
                        <Step3Build
                            key={activeDay}
                            dayType={activeDay}
                            bands={active.currentContract.planning.bands}
                            analysis={active.currentContract.planning.approvedBuckets}
                            approvedRuntimeContract={active.currentContract}
                            config={activeBuild.config}
                            setConfig={config => updateBuild(activeDay, current => ({ ...current, config }))}
                            teamId={team?.id}
                            stopSuggestions={buildStopSuggestions(active.currentContract.planning.segmentColumns.map(column => column.segmentName))}
                            autofillFromMaster={activeBuild.autofillFromMaster}
                            onAutofillFromMasterChange={value => updateBuild(activeDay, current => ({ ...current, autofillFromMaster: value }))}
                            onChangeRoute={() => setStep(1)}
                        />
                    </div>
                )}

                {visibleStep === 4 && activeDay && active?.currentContract && activeBuild && (
                    <GuidedStep4
                        key={activeDay}
                        dayType={activeDay}
                        routeNumber={routeNumber}
                        contract={active.currentContract}
                        state={activeBuild}
                        isCurrent={buildIsCurrent(activeDay)}
                        isGenerating={generatingDay === activeDay}
                        onGenerate={() => { void handleGenerate(activeDay); }}
                        onStateChange={update => updateBuild(activeDay, update)}
                        teamId={team?.id}
                        userId={user?.uid}
                        masterStopCodes={masterStopCodes}
                        connectionLibrary={connectionLibrary}
                        setConnectionLibrary={setConnectionLibrary}
                        onConnectionsOptimized={result => toast.success(
                            'Connections Optimized',
                            `${result.summary.connectionsMet} of ${result.summary.totalConnections} configured connections are met.`
                        )}
                    />
                )}

                {visibleStep === 5 && (
                    <GuidedStep5
                        routeNumber={routeNumber}
                        rows={packageRows}
                        busyDayType={packageBusyDay}
                        onOpenEditor={dayType => { void openEditor(dayType); }}
                        onCheckPublished={dayType => { void checkPublished(dayType); }}
                        onOpenBrochure={() => setOverlay({ kind: 'brochure' })}
                        onOpenRunCutting={() => setOverlay({ kind: 'run-cutting' })}
                    />
                )}
            </div>

            {visibleStep === 2 && active && health && (
                <div className="shrink-0 border-t border-gray-200 bg-white px-4 pt-3 sm:px-6">
                    <GuidedApprovalBar
                        readinessStatus={health.status}
                        approvalState={active.approvalState}
                        warnings={active.approvalWarnings}
                        blockers={health.blockers}
                        warningsAcknowledged={active.warningsAcknowledged}
                        onWarningsAcknowledgedChange={active.setWarningsAcknowledged}
                        approvalBlocker={active.approvalBlocker}
                        approvedAt={active.contract?.approvedAt}
                        onApprove={handleApprove}
                    />
                </div>
            )}

            <div className="flex shrink-0 items-center justify-between gap-3 border-t border-gray-200 bg-gray-50 px-4 py-2.5 sm:px-6">
                <button
                    type="button"
                    onClick={() => goToStep(Math.max(1, visibleStep - 1) as GuidedStep)}
                    disabled={visibleStep === 1}
                    className="flex items-center gap-1 rounded-lg px-3 py-1.5 text-sm font-bold text-gray-600 hover:bg-gray-100 disabled:opacity-40"
                >
                    <ArrowLeft size={14} /> Back
                </button>
                <span className="text-xs text-gray-500">{footer.message}</span>
                <button
                    type="button"
                    onClick={footer.onClick}
                    disabled={footer.disabled}
                    className="flex items-center gap-1 rounded-lg bg-emerald-600 px-4 py-1.5 text-sm font-bold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-40"
                >
                    {footer.label} <ArrowRight size={14} />
                </button>
            </div>
        </div>
    );
};

export default GuidedScheduleWorkspace;
