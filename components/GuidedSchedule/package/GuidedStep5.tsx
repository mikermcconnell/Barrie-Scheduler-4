import React from 'react';
import { CheckCircle2, ExternalLink, FileText, Loader2, Lock, RefreshCw, Scissors } from 'lucide-react';
import type { GuidedDayType } from '../runtimeReview/guidedRuntimeReviewTypes';
import { canExportPackage, type GuidedPackageEntry, type GuidedPackageStatus } from './guidedPackageState';

export interface GuidedPackageRow {
    dayType: GuidedDayType;
    status: GuidedPackageStatus;
    entry: GuidedPackageEntry;
    tripCount: number;
}

interface GuidedStep5Props {
    routeNumber: string;
    rows: GuidedPackageRow[];
    busyDayType: GuidedDayType | null;
    onOpenEditor: (dayType: GuidedDayType) => void;
    onCheckPublished: (dayType: GuidedDayType) => void;
    onOpenBrochure: () => void;
    onOpenRunCutting: () => void;
}

const STATUS_LABEL: Record<GuidedPackageStatus, { label: string; className: string }> = {
    'no-draft': { label: 'No draft yet', className: 'bg-gray-100 text-gray-700' },
    'draft-outdated': { label: 'Schedule changed · open a new draft', className: 'bg-amber-100 text-amber-800' },
    draft: { label: 'Draft · not published', className: 'bg-amber-100 text-amber-800' },
    published: { label: 'Published', className: 'bg-emerald-100 text-emerald-800' },
};

/**
 * Step 5: publish each day type through the existing draft → ready for
 * review → publish path, then build the brochure and the run-cut workbook
 * from the published Master versions.
 */
export const GuidedStep5: React.FC<GuidedStep5Props> = ({
    routeNumber,
    rows,
    busyDayType,
    onOpenEditor,
    onCheckPublished,
    onOpenBrochure,
    onOpenRunCutting,
}) => {
    const exportsUnlocked = canExportPackage(rows.map(row => row.status));

    return (
        <div className="mx-auto max-w-5xl space-y-5">
            <div>
                <h2 className="text-lg font-bold text-gray-900">Package · Route {routeNumber}</h2>
                <p className="text-sm text-gray-500">
                    Publish each day type, then build the public brochure and the run-cut workbook from the published versions.
                    Publishing uses the normal draft editor: mark the draft ready for review, add a publish note, then publish.
                </p>
            </div>

            <section className="rounded-xl border border-gray-200" aria-label="Publish checklist">
                <h3 className="border-b border-gray-200 px-4 py-2.5 text-sm font-bold text-gray-900">1 · Publish to Master</h3>
                <ul className="divide-y divide-gray-100">
                    {rows.map(row => {
                        const status = STATUS_LABEL[row.status];
                        const busy = busyDayType === row.dayType;
                        return (
                            <li key={row.dayType} className="flex flex-wrap items-center gap-3 px-4 py-3">
                                {row.status === 'published'
                                    ? <CheckCircle2 size={18} className="text-emerald-600" />
                                    : <span className="h-[18px] w-[18px] rounded-full border-2 border-gray-300" />}
                                <div className="min-w-[10rem]">
                                    <div className="font-semibold text-gray-900">{row.dayType}</div>
                                    <div className="text-xs text-gray-500">{row.tripCount} trips</div>
                                </div>
                                <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${status.className}`}>
                                    {status.label}{row.status === 'published' && row.entry.published ? ` · v${row.entry.published.version}` : ''}
                                </span>
                                <div className="ml-auto flex items-center gap-2">
                                    {(row.status === 'draft' || row.status === 'published') && (
                                        <button
                                            type="button"
                                            onClick={() => onCheckPublished(row.dayType)}
                                            disabled={busy}
                                            className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-gray-600 hover:bg-gray-100 disabled:opacity-50"
                                        >
                                            {busy ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />} Check publish status
                                        </button>
                                    )}
                                    <button
                                        type="button"
                                        onClick={() => onOpenEditor(row.dayType)}
                                        disabled={busy}
                                        className="flex items-center gap-1 rounded-lg border border-gray-900 px-3 py-1.5 text-xs font-bold text-gray-900 hover:bg-gray-50 disabled:opacity-50"
                                    >
                                        <ExternalLink size={12} />
                                        {row.status === 'draft' || row.status === 'published' ? 'Open draft' : 'Open in draft editor'}
                                    </button>
                                </div>
                            </li>
                        );
                    })}
                </ul>
                <p className="border-t border-gray-100 px-4 py-2 text-xs text-gray-500">
                    A day type counts as published only when Master's current version was published from this draft. Publishing needs team owner or admin rights.
                </p>
            </section>

            <section className="rounded-xl border border-gray-200" aria-label="Export package">
                <h3 className="flex items-center gap-2 border-b border-gray-200 px-4 py-2.5 text-sm font-bold text-gray-900">
                    2 · Export package {!exportsUnlocked && <Lock size={13} className="text-gray-400" />}
                </h3>
                {!exportsUnlocked && (
                    <p className="px-4 pt-3 text-xs text-gray-500">Unlocks when every day type above is published.</p>
                )}
                <div className="grid gap-3 p-4 sm:grid-cols-2">
                    <button
                        type="button"
                        onClick={onOpenBrochure}
                        disabled={!exportsUnlocked}
                        className="flex items-start gap-3 rounded-xl border border-gray-200 p-4 text-left hover:border-gray-900 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-gray-200"
                    >
                        <FileText size={20} className="mt-0.5 text-gray-700" />
                        <span>
                            <span className="block font-bold text-gray-900">Public brochure</span>
                            <span className="text-xs text-gray-500">Timetable Publisher PDF for Route {routeNumber}, from the published Master versions.</span>
                        </span>
                    </button>
                    <button
                        type="button"
                        onClick={onOpenRunCutting}
                        disabled={!exportsUnlocked}
                        className="flex items-start gap-3 rounded-xl border border-gray-200 p-4 text-left hover:border-gray-900 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-gray-200"
                    >
                        <Scissors size={20} className="mt-0.5 text-gray-700" />
                        <span>
                            <span className="block font-bold text-gray-900">Run-cut workbook</span>
                            <span className="text-xs text-gray-500">Create a scenario, export the Codex input, import the proposal, approve it, then download <code>_runcut.xlsx</code>.</span>
                        </span>
                    </button>
                </div>
            </section>
        </div>
    );
};
