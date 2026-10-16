import React, { useState } from 'react';
import { ArrowLeft, ArrowRight, Check, Loader2, X } from 'lucide-react';
import { useTeam } from '../contexts/TeamContext';
import { useToast } from '../contexts/ToastContext';
import { getMasterSchedule } from '../../utils/services/masterScheduleService';
import { Step1Upload } from '../NewSchedule/steps/Step1Upload';
import { Step2Analysis } from '../NewSchedule/steps/Step2Analysis';
import { GuidedApprovalBar } from './GuidedApprovalBar';
import { GUIDED_STEPS, canEnterGuidedStep, resolveGuidedStep, type GuidedStep } from './guidedSteps';
import { useGuidedPerformanceSource } from './useGuidedPerformanceSource';
import { useGuidedRuntimeReview } from './runtimeReview/useGuidedRuntimeReview';
import { prepareRuntimeReview } from './runtimeReview/prepareRuntimeReview';
import { buildRuntimeReviewModel } from './runtimeReview/buildRuntimeReviewModel';
import type { GuidedDateRange, GuidedDayType } from './runtimeReview/guidedRuntimeReviewTypes';

interface GuidedScheduleWorkspaceProps {
    onClose: () => void;
}

const selectionKey = (routeId: string, dayType: GuidedDayType, dateRange: GuidedDateRange | null): string => (
    JSON.stringify([routeId.trim(), dayType, dateRange?.start ?? null, dateRange?.end ?? null])
);

const noop = (): void => undefined;

/**
 * Guided scheduling workspace (in development). Reuses the New Schedule
 * engine behind a new five-step shell; see docs/GUIDED_SCHEDULING.md.
 */
export const GuidedScheduleWorkspace: React.FC<GuidedScheduleWorkspaceProps> = ({ onClose }) => {
    const { team } = useTeam();
    const toast = useToast();
    const source = useGuidedPerformanceSource(team?.id);
    const review = useGuidedRuntimeReview();
    const [step, setStep] = useState<GuidedStep>(1);
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [analyzedKey, setAnalyzedKey] = useState<string | null>(null);

    const { dayType, performanceConfig } = source;
    const currentKey = selectionKey(performanceConfig.routeId, dayType, performanceConfig.dateRange);
    const reviewIsCurrent = !!review.reviewResult && analyzedKey === currentKey;
    const gate = { hasReview: reviewIsCurrent, approvalState: review.approvalState };
    const visibleStep = resolveGuidedStep(step, gate);

    const routeLabel = review.loaded ? `Route ${review.loaded.prepared.routeNumber} · ${review.loaded.dayType}` : null;
    const routeMismatch = review.loaded && review.model?.detectedRouteNumber
        && review.model.detectedRouteNumber.toUpperCase() !== review.loaded.prepared.routeNumber.toUpperCase()
        ? review.model.detectedRouteNumber
        : null;

    const handleAnalyze = async () => {
        const { routeId, dateRange } = performanceConfig;
        if (!routeId) {
            toast.warning('No Route', 'Choose a route first.');
            return;
        }
        if (dateRange) {
            if (!dateRange.start || !dateRange.end) {
                toast.warning('Invalid Date Range', 'Select both start and end dates, or use all data.');
                return;
            }
            if (dateRange.start > dateRange.end) {
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
        const routeMetadata = source.availableRoutes.find(route => route.routeId === routeId);
        if (routeMetadata && routeMetadata.stopLevelDayCount === 0) {
            toast.error('Re-import STREETS Data', `Route ${routeId} only has older coarse runtime summaries. Re-import STREETS data to compute stop-level runtimes.`);
            return;
        }

        setIsAnalyzing(true);
        try {
            const teamId = team?.id;
            const prepared = await prepareRuntimeReview({
                dailySummaries: source.cleanData.dailySummaries,
                routeId,
                dayType,
                dateRange,
                loadMasterStops: teamId
                    ? async (routeIdentity) => {
                        const master = await getMasterSchedule(teamId, routeIdentity);
                        return master
                            ? { North: master.content.northTable.stops || [], South: master.content.southTable.stops || [] }
                            : null;
                    }
                    : undefined,
            });
            if (prepared.results.length === 0) {
                const d = source.diagnostics;
                toast.error(
                    'No Data',
                    `No segment runtime data found for Route ${routeId} on ${dayType}s.${d ? ` Checked ${d.filteredDayCount} day(s); matched ${d.matchedRouteDayCount}.` : ''}`
                );
                return;
            }
            review.load({
                prepared,
                model: buildRuntimeReviewModel(prepared.results, prepared.displayResults),
                diagnostics: source.diagnostics,
                dayType,
                dateRange,
            });
            setAnalyzedKey(currentKey);
            setStep(2);
        } catch (error) {
            console.error(error);
            toast.error('Compute Error', 'Failed to compute runtimes from performance data.');
        } finally {
            setIsAnalyzing(false);
        }
    };

    const handleApprove = () => {
        if (review.approve()) toast.success('Runtimes Approved', 'This runtime contract can now be used to set the stage.');
        else toast.warning('Approval Failed', 'Review the warnings and try again.');
    };

    const health = review.reviewResult?.health ?? null;
    const footer = visibleStep === 1
        ? {
            message: reviewIsCurrent
                ? 'A review exists for this selection. Re-analyze to start over.'
                : analyzedKey ? 'Your selection changed. Re-analyze to update the review.' : 'Choose the route, day type and data window.',
            label: 'Analyze runtimes',
            disabled: isAnalyzing || !performanceConfig.routeId,
            onClick: () => { void handleAnalyze(); },
        }
        : {
            message: review.approvalState === 'approved'
                ? 'Approved. "Set the stage" arrives in the next build phase of the guided workflow.'
                : 'Approve the runtimes to continue.',
            label: 'Continue to Set the stage',
            disabled: !canEnterGuidedStep(3, gate),
            onClick: () => setStep(3),
        };

    return (
        <div className="flex h-full min-h-0 flex-col bg-white">
            {isAnalyzing && (
                <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-slate-900/35 backdrop-blur-sm" role="dialog" aria-modal="true" aria-busy="true">
                    <div className="w-full max-w-sm rounded-2xl bg-white p-6 text-center shadow-2xl">
                        <Loader2 size={28} className="mx-auto animate-spin text-brand-blue" />
                        <h3 className="mt-3 text-lg font-bold text-gray-900">Analyzing performance runtimes</h3>
                        <p className="mt-1 text-sm text-gray-500">This can take a few seconds.</p>
                    </div>
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
                        const isDone = definition.step < visibleStep || (definition.step === 2 && review.approvalState === 'approved');
                        const enterable = canEnterGuidedStep(definition.step, gate);
                        return (
                            <React.Fragment key={definition.step}>
                                {index > 0 && <span className="text-gray-300">›</span>}
                                <button
                                    type="button"
                                    onClick={() => setStep(definition.step)}
                                    disabled={!enterable}
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

            <div className="min-h-0 flex-1 overflow-auto px-4 py-4 sm:px-6">
                {visibleStep === 1 && (
                    <div className="mx-auto max-w-5xl space-y-3">
                        <div>
                            <h2 className="text-lg font-bold text-gray-900">Select data</h2>
                            <p className="text-sm text-gray-500">Choose the route, the day type, and the window of observed STREETS data.</p>
                        </div>
                        <Step1Upload
                            files={[]}
                            setFiles={noop}
                            dayType={dayType}
                            setDayType={source.setDayType}
                            importMode="performance"
                            setImportMode={noop}
                            availableImportModes={['performance']}
                            availableRoutes={source.availableRoutes}
                            performanceConfig={performanceConfig}
                            onPerformanceConfigChange={source.setPerformanceConfig}
                            performanceDataLoading={source.dataLoading}
                            performanceMetadataLoading={source.metadataLoading}
                            performanceDataError={source.dataError}
                            performanceMetadataError={source.metadataError}
                            onRetryPerformanceData={source.retryData}
                            onRetryPerformanceMetadata={source.retryMetadata}
                            performanceLoadRouteId={source.loadRouteId}
                            performanceLoadRouteIds={source.loadRouteIds}
                            onPerformanceLoadRouteChange={source.changeLoadRoute}
                            performanceDateRange={source.availableDateRange}
                            performanceDiagnostics={source.diagnostics}
                            performanceHistoryStatus={source.historyStatus}
                        />
                    </div>
                )}

                {visibleStep === 2 && review.model && review.loaded && review.orientationView && (
                    <div className="space-y-4">
                        {routeMismatch && (
                            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900">
                                The runtime rows identify route <b>{routeMismatch}</b>, but you selected route <b>{review.loaded.prepared.routeNumber}</b>. The review uses your selection; check that this is the right route before approving.
                            </div>
                        )}
                        {review.cycleAnalysis && (
                            <section className="flex flex-col gap-3 rounded-xl border border-blue-200 bg-blue-50/70 p-4 sm:flex-row sm:items-center sm:justify-between" aria-label="Cycle start orientation review">
                                <div>
                                    <h2 className="text-sm font-bold text-blue-950">Review both cycle start orientations</h2>
                                    <p className="mt-1 text-xs text-blue-800">North-start and South-start evidence are approved independently. Excluding a time in one view does not change the other.</p>
                                </div>
                                <div className="inline-flex rounded-lg border border-blue-200 bg-white p-1" role="tablist" aria-label="Cycle start orientation">
                                    {(['North', 'South'] as const).map(direction => {
                                        const count = review.cycleAnalysis?.[direction]?.length ?? 0;
                                        return (
                                            <button
                                                key={direction}
                                                type="button"
                                                role="tab"
                                                aria-selected={review.selectedDirection === direction}
                                                disabled={count === 0}
                                                onClick={() => review.setSelectedDirection(direction)}
                                                className={`rounded-md px-3 py-1.5 text-xs font-bold ${
                                                    review.selectedDirection === direction ? 'bg-brand-blue text-white shadow-sm' : 'text-blue-800 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-40'
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
                            dayType={review.loaded.dayType}
                            routeNumber={review.loaded.prepared.routeNumber}
                            analysis={review.orientationView.analysis}
                            bands={review.orientationView.bands}
                            setAnalysis={review.updateAnalysis}
                            segmentsMap={review.model.segmentsMap}
                            matrixAnalysis={review.model.matrixAnalysis}
                            matrixSegmentsMap={review.model.matrixSegmentsMap}
                            canonicalSegmentColumns={review.loaded.prepared.canonicalSegmentColumns}
                            canonicalDirectionStops={review.loaded.prepared.canonicalDirectionStops}
                            healthReport={health}
                            approvedRuntimeModel={review.approvedModel}
                            approvalState={review.approvalState}
                            approvedRuntimeContract={review.contract}
                            warningAcknowledged={review.warningsAcknowledged}
                            onWarningAcknowledgedChange={review.setWarningsAcknowledged}
                            troubleshootingPatternWarning={review.model.troubleshootingPatternWarning}
                        />
                    </div>
                )}
            </div>

            {visibleStep === 2 && health && (
                <div className="shrink-0 border-t border-gray-200 bg-white px-4 pt-3 sm:px-6">
                    <GuidedApprovalBar
                        readinessStatus={health.status}
                        approvalState={review.approvalState}
                        warnings={review.approvalWarnings}
                        blockers={health.blockers}
                        warningsAcknowledged={review.warningsAcknowledged}
                        onWarningsAcknowledgedChange={review.setWarningsAcknowledged}
                        approvalBlocker={review.approvalBlocker}
                        approvedAt={review.contract?.approvedAt}
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
