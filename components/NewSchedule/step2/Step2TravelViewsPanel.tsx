import React, { useState } from 'react';
import { AlertTriangle } from 'lucide-react';

interface Step2TravelViewsPanelProps {
    troubleshootingPatternWarning?: string | null;
    bandSummaryView: React.ReactNode;
    troubleshootingView: React.ReactNode;
}

export const Step2TravelViewsPanel: React.FC<Step2TravelViewsPanelProps> = ({
    troubleshootingPatternWarning,
    bandSummaryView,
    troubleshootingView,
}) => {
    const [matrixView, setMatrixView] = useState<'band-summary' | 'segment-matrix'>('band-summary');

    return (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
            <div className="p-4 border-b border-gray-200 bg-gray-50 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div>
                    <h3 className="font-bold text-gray-900">Segment Travel Views</h3>
                    <p className="mt-1 text-xs text-gray-500">
                        Switch between the planning band summary and a troubleshooting view that follows the bus stop-by-stop through the dominant full route.
                    </p>
                </div>
                <div className="inline-flex rounded-lg bg-gray-100 p-1">
                    <button
                        type="button"
                        onClick={() => setMatrixView('band-summary')}
                        data-testid="step2-view-band-summary"
                        className={`rounded-md px-4 py-2 text-sm font-bold transition-all ${
                            matrixView === 'band-summary'
                                ? 'bg-white text-brand-blue shadow-sm'
                                : 'text-gray-500 hover:text-gray-700'
                        }`}
                    >
                        Band Summary
                    </button>
                    <button
                        type="button"
                        onClick={() => setMatrixView('segment-matrix')}
                        data-testid="step2-view-segment-matrix"
                        className={`rounded-md px-4 py-2 text-sm font-bold transition-all ${
                            matrixView === 'segment-matrix'
                                ? 'bg-white text-brand-blue shadow-sm'
                                : 'text-gray-500 hover:text-gray-700'
                        }`}
                    >
                        Troubleshooting View
                    </button>
                </div>
            </div>
            <div className="p-4 bg-gray-50/40">
                {matrixView === 'band-summary' ? (
                    <div data-testid="step2-band-summary-view">
                        {bandSummaryView}
                    </div>
                ) : (
                    <div data-testid="step2-segment-matrix-view">
                        {troubleshootingPatternWarning && (
                            <div
                                data-testid="step2-troubleshooting-warning"
                                className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
                            >
                                <div className="flex items-start gap-2">
                                    <AlertTriangle size={16} className="mt-0.5 shrink-0 text-amber-700" />
                                    <div>
                                        <div className="font-bold text-amber-900">Troubleshooting view fallback</div>
                                        <div className="mt-1">{troubleshootingPatternWarning}</div>
                                    </div>
                                </div>
                            </div>
                        )}
                        {troubleshootingPatternWarning ? (
                            <div
                                data-testid="step2-troubleshooting-blocked"
                                className="rounded-xl border border-amber-200 bg-white px-6 py-8 text-center text-sm text-gray-700"
                            >
                                <div className="mx-auto max-w-2xl">
                                    <div className="font-bold text-gray-900">Full-route troubleshooting path not confirmed</div>
                                    <p className="mt-2">
                                        This matrix only shows a full stop-by-stop route path in bus order. Because the current data did not confirm that full anchored path, the table is hidden instead of showing partial-trip rows.
                                    </p>
                                </div>
                            </div>
                        ) : troubleshootingView}
                    </div>
                )}
            </div>
        </div>
    );
};
