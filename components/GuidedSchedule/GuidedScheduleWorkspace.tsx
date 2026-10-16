import React, { useState } from 'react';
import { ArrowLeft, ArrowRight, Check, X } from 'lucide-react';
import { useTeam } from '../contexts/TeamContext';
import { useToast } from '../contexts/ToastContext';
import { getMasterSchedule } from '../../utils/services/masterScheduleService';
import { Step2Analysis } from '../NewSchedule/steps/Step2Analysis';
import { GuidedApprovalBar } from './GuidedApprovalBar';
import { GuidedLoadingModal } from './GuidedLoadingModal';
import { GuidedStep1 } from './GuidedStep1';
import { GUIDED_STEPS, canEnterGuidedStep, resolveGuidedStep, type GuidedGateState, type GuidedStep } from './guidedSteps';
import { GUIDED_DAY_TYPES, guidedSelectionKey } from './guidedSelection';
import { useGuidedPerformanceSource } from './useGuidedPerformanceSource';
import { useGuidedRuntimeReview, type GuidedRuntimeReview } from './runtimeReview/useGuidedRuntimeReview';
import { prepareRuntimeReview } from './runtimeReview/prepareRuntimeReview';
import { buildRuntimeReviewModel } from './runtimeReview/buildRuntimeReviewModel';
import type { GuidedDayType } from './runtimeReview/guidedRuntimeReviewTypes';

interface GuidedScheduleWorkspaceProps {
    onClose: () => void;
}

interface SkippedDayType {
    dayType: GuidedDayType;
    reason: string;
}

const approvalChip = (review: GuidedRuntimeReview): { label: string; className: string } => {
    if (review.approvalState === 'approved') return { label: 'approved', className: 'bg-emerald-100 text-emerald-800' };
    if (review.approvalState === 'stale') return { label: 'approve again', className: 'bg-amber-100 text-amber-800' };
    if (review.reviewResult?.health.status === 'blocked') return { label: 'blocked', className: 'bg-red-100 text-red-700' };
    return { label: 'needs review', className: 'bg-amber-100 text-amber-800' };
};

/**
 * Guided scheduling workspace (in development). Reuses the New Schedule
 * engine behind a new five-step shell; see docs/GUIDED_SCHEDULING.md.
 */
export const GuidedScheduleWorkspace: React.FC<GuidedScheduleWorkspaceProps> = ({ onClose }) => {
    const { team } = useTeam();
    const toast = useToast();
    const source = useGuidedPerformanceSource(team?.id);
    // One review per day type; hook count is fixed, so this is safe.
    const reviews: Record<GuidedDayType, GuidedRuntimeReview> = {
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

    const { selection } = source;
    const currentKey = guidedSelectionKey(selection);
    const reviewed = reviewedDayTypes.map(dayType => reviews[dayType]);
    const reviewIsCurrent = analyzedKey === currentKey && reviewed.length > 0 && reviewed.every(review => !!review.reviewResult);
    const gate: GuidedGateState = {
        hasReview: reviewIsCurrent,
        approvalState: reviewed.length > 0 && reviewed.every(review => review.approvalState === 'approved')
            ? 'approved'
            : reviewed.some(review => review.approvalState === 'stale') ? 'stale' : 'unapproved',
    };
    const visibleStep = resolveGuidedStep(step, gate);
    const approvedCount = reviewed.filter(review => review.approvalState === 'approved').length;

    const active = reviewedDayTypes.includes(activeDayType) ? reviews[activeDayType] : reviewed[0];
    const activeDay = reviewedDayTypes.includes(activeDayType) ? activeDayType : reviewedDayTypes[0];

    const routeLabel = analyzedKey && reviewedDayTypes.length > 0 && selection.routeId
        ? `Route ${selection.routeId} · ${reviewedDayTypes.join(', ')}`
        : null;

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

    const footer = visibleStep === 1
        ? {
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
        }
        : {
            message: gate.approvalState === 'approved'
                ? 'All day types approved. "Set the stage" arrives in the next build phase.'
                : `${approvedCount} of ${reviewed.length} day type${reviewed.length === 1 ? '' : 's'} approved. Approve each one to continue.`,
            label: 'Continue to Set the stage',
            disabled: !canEnterGuidedStep(3, gate),
            onClick: () => setStep(3),
        };

    const health = active?.reviewResult?.health ?? null;

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
                                    onClick={() => setStep(definition.step)}
                                    disabled={!canEnterGuidedStep(definition.step, gate)}
                                    aria-current={isCurrent ? 'step' : undefined}
                                    title={definition.available ? undefined : 'Coming in a later build phase'}
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

            {visibleStep === 2 && reviewedDayTypes.length > 0 && (
                <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-gray-200 px-4 py-2 sm:px-6" role="tablist" aria-label="Day types">
                    <span className="text-[11px] font-bold uppercase tracking-wide text-gray-500">Day type</span>
                    {reviewedDayTypes.map(dayType => {
                        const chip = approvalChip(reviews[dayType]);
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
                        <span key={entry.dayType} title={entry.reason} className="rounded-full border border-dashed border-gray-300 px-3 py-1 text-sm text-gray-400 line-through">
                            {entry.dayType}
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
                        {active.cycleAnalysis && (
                            <section className="flex flex-col gap-3 rounded-xl border border-blue-200 bg-blue-50/70 p-4 sm:flex-row sm:items-center sm:justify-between" aria-label="Cycle start orientation review">
                                <div>
                                    <h2 className="text-sm font-bold text-blue-950">Review both cycle start orientations</h2>
                                    <p className="mt-1 text-xs text-blue-800">North-start and South-start evidence are approved independently. Excluding a time in one view does not change the other.</p>
                                </div>
                                <div className="inline-flex rounded-lg border border-blue-200 bg-white p-1" role="tablist" aria-label="Cycle start orientation">
                                    {(['North', 'South'] as const).map(direction => {
                                        const count = active.cycleAnalysis?.[direction]?.length ?? 0;
                                        return (
                                            <button
                                                key={direction}
                                                type="button"
                                                role="tab"
                                                aria-selected={active.selectedDirection === direction}
                                                disabled={count === 0}
                                                onClick={() => active.setSelectedDirection(direction)}
                                                className={`rounded-md px-3 py-1.5 text-xs font-bold ${
                                                    active.selectedDirection === direction ? 'bg-brand-blue text-white shadow-sm' : 'text-blue-800 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-40'
                                                }`}
                                            >
                                                {direction}-start ({count})
                                            </button>
                                        );
                                    })}
                                </div>
                            </section>
                        )}
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
                    </div>
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
                    onClick={() => setStep(1)}
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
