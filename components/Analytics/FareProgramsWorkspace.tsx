import React, { useEffect, useState } from 'react';
import { ArrowLeft, Bus, ChevronLeft, ChevronRight, FileSpreadsheet, Loader2, Upload, X } from 'lucide-react';
import { FareProgramsUsageMap } from './FareProgramsUsageMap';
import { FARE_PROGRAMS_SNAPSHOT } from '../../utils/fare-programs/fareProgramsSnapshot';
import type {
    FareProgramTransactionResult,
    FareProgramTransactionRow,
} from '../../utils/fare-programs/fareProgramsWorkbook';
import { validateFareProgramsWorkbookFile } from '../../utils/fare-programs/fareProgramsWorkbook';
import {
    loadFareProgramsWorkbook,
    removeFareProgramsWorkbook,
    saveFareProgramsWorkbook,
} from '../../utils/fare-programs/fareProgramsWorkbookStorage';

interface FareProgramsWorkspaceProps {
    onBack: () => void;
}

const number = new Intl.NumberFormat('en-CA');
type ActiveTab = 'usage-map' | 'raw-counts';
type FarePassCount = { label: string; uses: number };
type WorkbookStorageStatus = 'restoring' | 'saving' | 'saved' | 'none' | 'error';
const TRANSACTION_PAGE_SIZE = 100;

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

const FareTypeRowsModal: React.FC<{
    fareType: FarePassCount;
    expectedSourceRows: number;
    expectedSourceFileName: string;
    sourceFile: File | null;
    onSourceFileChange: (file: File) => void;
    onClose: () => void;
}> = ({
    fareType,
    expectedSourceRows,
    expectedSourceFileName,
    sourceFile,
    onSourceFileChange,
    onClose,
}) => {
    const [transactions, setTransactions] = useState<FareProgramTransactionRow[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [warning, setWarning] = useState<string | null>(null);
    const [page, setPage] = useState(0);

    useEffect(() => {
        let cancelled = false;
        setPage(0);
        setTransactions([]);
        setError(null);
        setWarning(null);
        if (!sourceFile) return () => { cancelled = true; };

        setLoading(true);
        let worker: Worker | null = null;
        void sourceFile.arrayBuffer()
            .then((buffer) => new Promise<FareProgramTransactionResult>((resolve, reject) => {
                if (cancelled) return;
                worker = new Worker(
                    new URL('../../utils/fare-programs/fareProgramsWorkbook.worker.ts', import.meta.url),
                    { type: 'module' },
                );
                worker.onmessage = (event: MessageEvent<
                    | { ok: true; result: FareProgramTransactionResult }
                    | { ok: false; error: string }
                >) => {
                    worker?.terminate();
                    const response = event.data;
                    if (response.ok === true) resolve(response.result);
                    else reject(new Error(response.error));
                };
                worker.onerror = () => {
                    worker?.terminate();
                    reject(new Error('The workbook reader stopped unexpectedly.'));
                };
                worker.postMessage({ buffer, fareType: fareType.label }, [buffer]);
            }))
            .then((result) => {
                if (cancelled) return;
                setTransactions(result.transactions);
                const warnings = [];
                if (result.sourceRows !== expectedSourceRows) {
                    warnings.push(`Workbook has ${number.format(result.sourceRows)} rows; the summary was generated from ${number.format(expectedSourceRows)}.`);
                }
                if (result.transactions.length !== fareType.uses) {
                    warnings.push(`This file contains ${number.format(result.transactions.length)} matching rows; the summary shows ${number.format(fareType.uses)}.`);
                }
                setWarning(warnings.length > 0 ? warnings.join(' ') : null);
            })
            .catch((cause: unknown) => {
                if (!cancelled) setError(cause instanceof Error ? cause.message : 'Could not read the selected workbook.');
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });

        return () => {
            cancelled = true;
            worker?.terminate();
        };
    }, [expectedSourceRows, fareType.label, fareType.uses, sourceFile]);

    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [onClose]);

    const pageCount = Math.max(1, Math.ceil(transactions.length / TRANSACTION_PAGE_SIZE));
    const visibleTransactions = transactions.slice(
        page * TRANSACTION_PAGE_SIZE,
        (page + 1) * TRANSACTION_PAGE_SIZE,
    );

    return (
        <div
            className="fixed inset-0 z-[100] flex items-center justify-center bg-gray-950/50 p-3 backdrop-blur-sm md:p-6"
            role="dialog"
            aria-modal="true"
            aria-labelledby="fare-program-rows-title"
            onMouseDown={(event) => {
                if (event.target === event.currentTarget) onClose();
            }}
        >
            <div className="flex h-[min(92vh,920px)] w-[min(98vw,1720px)] min-h-0 flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl">
                <div className="flex shrink-0 items-start justify-between gap-4 border-b border-gray-200 px-5 py-4">
                    <div>
                        <div className="flex flex-wrap items-center gap-2">
                            <h2 id="fare-program-rows-title" className="text-lg font-bold text-gray-900">{fareType.label}</h2>
                            <span className="rounded-full bg-blue-50 px-2 py-1 text-xs font-semibold text-blue-700">{number.format(fareType.uses)} summary rows</span>
                        </div>
                        <p className="mt-1 text-xs text-gray-500">
                            Transaction details are read locally from the workbook saved on this device.
                        </p>
                    </div>
                    <button type="button" onClick={onClose} aria-label="Close transaction rows" className="rounded-lg border border-gray-200 p-2 text-gray-500 hover:bg-gray-50 hover:text-gray-900">
                        <X size={18} />
                    </button>
                </div>

                {!sourceFile ? (
                    <div className="grid min-h-0 flex-1 place-items-center p-6">
                        <div className="max-w-lg rounded-xl border border-gray-200 bg-gray-50 p-6 text-center">
                            <FileSpreadsheet className="mx-auto h-10 w-10 text-blue-600" />
                            <h3 className="mt-4 text-base font-bold text-gray-900">Choose the source workbook</h3>
                            <p className="mt-2 text-sm leading-relaxed text-gray-600">
                                Select <strong>{expectedSourceFileName}</strong> to view every transaction row for this fare type. The browser will keep it on this device for future visits.
                            </p>
                            <label className="mt-5 inline-flex cursor-pointer items-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-700">
                                <Upload size={17} />
                                Choose source workbook
                                <input
                                    type="file"
                                    accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                                    className="sr-only"
                                    onChange={(event) => {
                                        const file = event.target.files?.[0];
                                        if (file) onSourceFileChange(file);
                                    }}
                                />
                            </label>
                        </div>
                    </div>
                ) : loading ? (
                    <div className="grid min-h-0 flex-1 place-items-center p-6 text-center">
                        <div>
                            <Loader2 className="mx-auto h-9 w-9 animate-spin text-blue-600" />
                            <div className="mt-3 text-sm font-semibold text-gray-900">Reading {sourceFile.name}</div>
                            <p className="mt-1 text-xs text-gray-500">Filtering {number.format(expectedSourceRows)} workbook transactions…</p>
                        </div>
                    </div>
                ) : error ? (
                    <div className="grid min-h-0 flex-1 place-items-center p-6">
                        <div className="max-w-lg rounded-xl border border-red-200 bg-red-50 p-6 text-center">
                            <h3 className="text-base font-bold text-red-900">The workbook could not be loaded</h3>
                            <p className="mt-2 text-sm leading-relaxed text-red-800">{error}</p>
                            <label className="mt-5 inline-flex cursor-pointer items-center gap-2 rounded-lg border border-red-300 bg-white px-4 py-2.5 text-sm font-semibold text-red-800 hover:bg-red-100">
                                <Upload size={17} />
                                Choose another workbook
                                <input
                                    type="file"
                                    accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                                    className="sr-only"
                                    onChange={(event) => {
                                        const file = event.target.files?.[0];
                                        if (file) onSourceFileChange(file);
                                    }}
                                />
                            </label>
                        </div>
                    </div>
                ) : (
                    <>
                        <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-gray-200 bg-gray-50 px-5 py-3">
                            <div>
                                <div className="text-sm font-semibold text-gray-900">{number.format(transactions.length)} matching rows</div>
                                <div className="mt-0.5 text-xs text-gray-500">{sourceFile.name}</div>
                            </div>
                            <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50">
                                <Upload size={15} />
                                Change workbook
                                <input
                                    type="file"
                                    accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                                    className="sr-only"
                                    onChange={(event) => {
                                        const file = event.target.files?.[0];
                                        if (file) onSourceFileChange(file);
                                    }}
                                />
                            </label>
                            {warning && <p className="w-full rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">{warning}</p>}
                        </div>
                        <div className="min-h-0 flex-1 overflow-auto">
                            <table className="w-full min-w-[1500px] text-left">
                                <thead className="sticky top-0 z-10 bg-gray-100 text-xs font-semibold uppercase tracking-wide text-gray-500 shadow-sm">
                                    <tr>
                                        <th className="px-4 py-3">Source row</th>
                                        <th className="px-4 py-3">ID</th>
                                        <th className="px-4 py-3">Route</th>
                                        <th className="px-4 py-3">Transit pass</th>
                                        <th className="px-4 py-3">Starting location</th>
                                        <th className="px-4 py-3">Ending location</th>
                                        <th className="px-4 py-3">Start time</th>
                                        <th className="px-4 py-3">End time</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-100">
                                    {visibleTransactions.map((transaction) => (
                                        <tr key={`${transaction.sourceRowNumber}-${transaction.id}`} className="align-top hover:bg-blue-50/40">
                                            <td className="whitespace-nowrap px-4 py-3 text-xs font-semibold tabular-nums text-gray-500">{number.format(transaction.sourceRowNumber)}</td>
                                            <td className="whitespace-nowrap px-4 py-3 text-xs text-gray-700">{transaction.id || '—'}</td>
                                            <td className="whitespace-nowrap px-4 py-3 text-xs text-gray-700">{transaction.route || '—'}</td>
                                            <td className="whitespace-nowrap px-4 py-3 text-xs font-semibold text-gray-900">{transaction.transitPass || '(Blank fare type)'}</td>
                                            <td className="max-w-sm px-4 py-3 text-xs text-gray-700">{transaction.startingLocation || '—'}</td>
                                            <td className="max-w-sm px-4 py-3 text-xs text-gray-700">{transaction.endingLocation || '—'}</td>
                                            <td className="whitespace-nowrap px-4 py-3 text-xs text-gray-700">{transaction.startTime || '—'}</td>
                                            <td className="whitespace-nowrap px-4 py-3 text-xs text-gray-700">{transaction.endTime || '—'}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                        <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-gray-200 bg-white px-5 py-3">
                            <div className="text-xs text-gray-500">
                                Showing {number.format(page * TRANSACTION_PAGE_SIZE + 1)}–{number.format(Math.min((page + 1) * TRANSACTION_PAGE_SIZE, transactions.length))} of {number.format(transactions.length)}
                            </div>
                            <div className="flex items-center gap-2">
                                <button type="button" disabled={page === 0} onClick={() => setPage((current) => Math.max(0, current - 1))} className="rounded-lg border border-gray-200 p-2 text-gray-600 enabled:hover:bg-gray-50 disabled:opacity-40" aria-label="Previous transaction page">
                                    <ChevronLeft size={16} />
                                </button>
                                <label className="flex items-center gap-2 text-xs font-semibold text-gray-600">
                                    Page
                                    <input
                                        type="number"
                                        min={1}
                                        max={pageCount}
                                        value={page + 1}
                                        onChange={(event) => {
                                            const nextPage = Number(event.target.value) - 1;
                                            if (Number.isFinite(nextPage)) setPage(Math.max(0, Math.min(pageCount - 1, nextPage)));
                                        }}
                                        className="w-20 rounded-lg border border-gray-200 px-2 py-1.5 text-center tabular-nums text-gray-900 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                                    />
                                    of {number.format(pageCount)}
                                </label>
                                <button type="button" disabled={page >= pageCount - 1} onClick={() => setPage((current) => Math.min(pageCount - 1, current + 1))} className="rounded-lg border border-gray-200 p-2 text-gray-600 enabled:hover:bg-gray-50 disabled:opacity-40" aria-label="Next transaction page">
                                    <ChevronRight size={16} />
                                </button>
                            </div>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
};

export const FareProgramsWorkspace: React.FC<FareProgramsWorkspaceProps> = ({ onBack }) => {
    const [activeTab, setActiveTab] = useState<ActiveTab>('usage-map');
    const [selectedFareType, setSelectedFareType] = useState<FarePassCount | null>(null);
    const [sourceWorkbook, setSourceWorkbook] = useState<File | null>(null);
    const [workbookStorageStatus, setWorkbookStorageStatus] = useState<WorkbookStorageStatus>('restoring');
    const [workbookStorageError, setWorkbookStorageError] = useState<string | null>(null);
    const snapshot = FARE_PROGRAMS_SNAPSHOT;

    useEffect(() => {
        let cancelled = false;
        void loadFareProgramsWorkbook()
            .then((file) => {
                if (cancelled) return;
                if (file) {
                    setSourceWorkbook(file);
                    setWorkbookStorageStatus('saved');
                } else {
                    setWorkbookStorageStatus('none');
                }
            })
            .catch((cause: unknown) => {
                if (cancelled) return;
                setWorkbookStorageStatus('error');
                setWorkbookStorageError(cause instanceof Error ? cause.message : 'Could not restore the saved workbook.');
            });
        return () => {
            cancelled = true;
        };
    }, []);

    const handleSourceWorkbookChange = (file: File) => {
        const validationError = validateFareProgramsWorkbookFile(file);
        if (validationError) {
            setWorkbookStorageStatus('error');
            setWorkbookStorageError(validationError);
            return;
        }

        setSourceWorkbook(file);
        setWorkbookStorageStatus('saving');
        setWorkbookStorageError(null);
        void saveFareProgramsWorkbook(file)
            .then((saved) => {
                setWorkbookStorageStatus(saved ? 'saved' : 'error');
                if (!saved) setWorkbookStorageError('This browser cannot save the workbook, but it remains available for this session.');
            })
            .catch((cause: unknown) => {
                setWorkbookStorageStatus('error');
                setWorkbookStorageError(cause instanceof Error ? cause.message : 'Could not save the workbook on this device.');
            });
    };

    const handleRemoveSourceWorkbook = () => {
        setSourceWorkbook(null);
        setWorkbookStorageStatus('none');
        setWorkbookStorageError(null);
        void removeFareProgramsWorkbook().catch((cause: unknown) => {
            setWorkbookStorageStatus('error');
            setWorkbookStorageError(cause instanceof Error ? cause.message : 'Could not remove the saved workbook.');
        });
    };

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
                            <p className="mt-1 text-sm text-gray-500">HotSpot usage summary and source transaction review for the Service Mirroring Pilot.</p>
                        </div>
                    </div>
                    <div className="hidden text-right text-xs text-gray-500 md:block">
                        <div className="font-semibold text-gray-700">{snapshot.sourceFileName}</div>
                        <div>{number.format(snapshot.sourceRows)} source transactions</div>
                    </div>
                </div>
            </header>

            <nav className="shrink-0 border-b border-gray-200 bg-white px-6" aria-label="Fare Programs views">
                <div className="mx-auto flex max-w-[1600px] gap-6" role="tablist">
                    {([
                        { id: 'usage-map', label: 'Usage map' },
                        { id: 'raw-counts', label: 'Raw counts' },
                    ] as const).map((tab) => (
                        <button
                            key={tab.id}
                            type="button"
                            role="tab"
                            aria-selected={activeTab === tab.id}
                            onClick={() => setActiveTab(tab.id)}
                            className={`border-b-2 px-1 py-3 text-sm font-semibold transition-colors ${
                                activeTab === tab.id
                                    ? 'border-blue-600 text-blue-700'
                                    : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-800'
                            }`}
                        >
                            {tab.label}
                        </button>
                    ))}
                </div>
            </nav>

            <main className="min-h-0 flex-1 overflow-auto custom-scrollbar px-6 py-5">
                <div className="mx-auto max-w-[1600px] space-y-5">
                    {activeTab === 'raw-counts' ? (
                        <>
                            <section className="grid gap-4 lg:grid-cols-2">
                                <MetricCard
                                    label="Workbook transactions"
                                    value={snapshot.sourceRows}
                                    detail={`${snapshot.sourcePassCounts.length} distinct fare labels, including any blank label as its own row.`}
                                    icon={<FileSpreadsheet size={19} />}
                                />
                                <MetricCard
                                    label="Proxy rows included"
                                    value={snapshot.serviceMirroring.uses}
                                    detail={snapshot.serviceMirroring.definition}
                                    icon={<Bus size={19} />}
                                />
                            </section>

                            <section className="grid gap-5 xl:grid-cols-[minmax(0,1.5fr)_minmax(320px,0.5fr)]">
                                <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
                                    <div className="border-b border-gray-200 px-5 py-4">
                                        <h2 className="text-base font-bold text-gray-900">Fare-type counts from the workbook</h2>
                                        <p className="mt-1 text-xs leading-relaxed text-gray-500">
                                            Each row is counted from the workbook&apos;s Transit Pass column. Together these rows reconcile to {number.format(snapshot.sourceRows)} source transactions.
                                        </p>
                                    </div>
                                    <div className="overflow-x-auto">
                                        <table className="w-full min-w-[680px] text-left">
                                            <thead className="bg-gray-50 text-xs font-semibold uppercase tracking-wide text-gray-500">
                                                <tr>
                                                    <th className="px-5 py-3">Fare type</th>
                                                    <th className="px-5 py-3 text-right">Workbook rows</th>
                                                    <th className="px-5 py-3 text-right">Share</th>
                                                    <th className="px-5 py-3">How it is used here</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-gray-100">
                                                {snapshot.sourcePassCounts.map((pass) => {
                                                    const isIncluded = snapshot.serviceMirroring.passTypes.some((included) => included.label === pass.label);
                                                    const isReviewOnly = snapshot.serviceMirroring.excludedReviewPasses.some((excluded) => excluded.label === pass.label);
                                                    return (
                                                        <tr key={pass.label} className={isIncluded ? 'bg-blue-50/50' : 'bg-white'}>
                                                            <td className="px-5 py-3">
                                                                <button
                                                                    type="button"
                                                                    onClick={() => setSelectedFareType(pass)}
                                                                    aria-label={`View all rows for ${pass.label}`}
                                                                    className="group flex items-center gap-2 text-left text-sm font-semibold text-blue-700 hover:text-blue-900 hover:underline"
                                                                >
                                                                    {pass.label}
                                                                    <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 group-hover:text-blue-700">View rows</span>
                                                                </button>
                                                            </td>
                                                            <td className="px-5 py-3 text-right text-sm font-bold tabular-nums text-gray-900">{number.format(pass.uses)}</td>
                                                            <td className="px-5 py-3 text-right text-sm tabular-nums text-gray-600">{((pass.uses / snapshot.sourceRows) * 100).toFixed(2)}%</td>
                                                            <td className="px-5 py-3">
                                                                {isIncluded ? (
                                                                    <span className="rounded-full bg-blue-100 px-2 py-1 text-xs font-semibold text-blue-800">Included in working proxy</span>
                                                                ) : isReviewOnly ? (
                                                                    <span className="rounded-full bg-amber-100 px-2 py-1 text-xs font-semibold text-amber-800">Held for mapping review</span>
                                                                ) : (
                                                                    <span className="text-xs text-gray-500">Not included in the proxy</span>
                                                                )}
                                                            </td>
                                                        </tr>
                                                    );
                                                })}
                                            </tbody>
                                            <tfoot className="border-t border-gray-200 bg-gray-50">
                                                <tr>
                                                    <th className="px-5 py-3 text-sm font-bold text-gray-900">Total</th>
                                                    <td className="px-5 py-3 text-right text-sm font-bold tabular-nums text-gray-900">{number.format(snapshot.sourceRows)}</td>
                                                    <td className="px-5 py-3 text-right text-sm font-bold tabular-nums text-gray-900">100.00%</td>
                                                    <td className="px-5 py-3 text-xs font-medium text-emerald-700">Reconciled to source</td>
                                                </tr>
                                            </tfoot>
                                        </table>
                                    </div>
                                </div>

                                <div className="space-y-5">
                                    <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
                                        <h2 className="text-sm font-bold text-gray-900">Source and privacy</h2>
                                        <dl className="mt-4 space-y-3 text-xs">
                                            <div>
                                                <dt className="font-semibold text-gray-500">Workbook</dt>
                                                <dd className="mt-1 break-words text-gray-900">{snapshot.sourceFileName}</dd>
                                            </div>
                                            <div>
                                                <dt className="font-semibold text-gray-500">Coverage</dt>
                                                <dd className="mt-1 text-gray-900">{snapshot.coverageLabel}</dd>
                                            </div>
                                            <div>
                                                <dt className="font-semibold text-gray-500">Transaction access</dt>
                                                <dd className="mt-1 leading-relaxed text-gray-700">Click a fare type to open its rows. Detailed IDs and locations are read from a workbook saved only in this browser and are not bundled into the app or uploaded to shared storage.</dd>
                                            </div>
                                        </dl>
                                    </div>
                                </div>
                            </section>
                        </>
                    ) : (
                        <FareProgramsUsageMap
                            snapshot={snapshot}
                            sourceFile={sourceWorkbook}
                            workbookStorageStatus={workbookStorageStatus}
                            workbookStorageError={workbookStorageError}
                            onSourceFileChange={handleSourceWorkbookChange}
                            onRemoveSourceFile={handleRemoveSourceWorkbook}
                        />
                    )}
                </div>
            </main>
            {selectedFareType && (
                <FareTypeRowsModal
                    fareType={selectedFareType}
                    expectedSourceRows={snapshot.sourceRows}
                    expectedSourceFileName={snapshot.sourceFileName}
                    sourceFile={sourceWorkbook}
                    onSourceFileChange={handleSourceWorkbookChange}
                    onClose={() => setSelectedFareType(null)}
                />
            )}
        </div>
    );
};
