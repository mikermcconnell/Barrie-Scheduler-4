import { useState, type ChangeEvent } from 'react';
import { AlertCircle, FileSpreadsheet, MapPin, Upload, X } from 'lucide-react';

import {
    geocodeRoutePlanner2ParsedAddresses,
    orderRoutePlanner2StopsGeographically,
    parseRoutePlanner2AddressWorkbook,
    parseRoutePlanner2AddressText,
    type RoutePlanner2GeocodedAddressStop,
    type RoutePlanner2UnresolvedAddress,
} from '../../../utils/route-planner-2/routePlanner2AddressImport';

interface RoutePlanner2AddressImportModalProps {
    open: boolean;
    presentation?: 'modal' | 'map-drawer';
    onClose: () => void;
    onImport: (stops: RoutePlanner2GeocodedAddressStop[]) => void;
}

interface ImportPreview {
    fileName: string;
    parsedCount: number;
    duplicateCount: number;
    warningCount: number;
    mappedStops: RoutePlanner2GeocodedAddressStop[];
    unresolved: RoutePlanner2UnresolvedAddress[];
}

export function RoutePlanner2AddressImportModal({
    open,
    presentation = 'modal',
    onClose,
    onImport,
}: RoutePlanner2AddressImportModalProps) {
    const [preview, setPreview] = useState<ImportPreview | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [processing, setProcessing] = useState(false);
    const [reviewInputs, setReviewInputs] = useState<Record<string, string>>({});
    const [reviewErrors, setReviewErrors] = useState<Record<string, string>>({});
    const [reviewingId, setReviewingId] = useState<string | null>(null);
    const [editingReviewId, setEditingReviewId] = useState<string | null>(null);
    const [geocodeProgress, setGeocodeProgress] = useState<{ completed: number; total: number } | null>(null);

    if (!open) return null;

    async function handleFile(file: File) {
        setProcessing(true);
        setError(null);
        setPreview(null);
        setReviewInputs({});
        setReviewErrors({});
        setEditingReviewId(null);
        setGeocodeProgress(null);

        try {
            if (!file.name.match(/\.(xlsx|xls|csv)$/i)) {
                throw new Error('Please upload an Excel or CSV file.');
            }

            const buffer = await file.arrayBuffer();
            const parsed = parseRoutePlanner2AddressWorkbook(buffer, file.name);
            if (parsed.addresses.length === 0) {
                throw new Error('No address rows were found. Check that the file includes street address, city, province, and postal code lines.');
            }

            const geocoded = await geocodeRoutePlanner2ParsedAddresses(parsed.addresses, {
                onProgress: ({ completed, total }) => setGeocodeProgress({ completed, total }),
            });
            setReviewInputs(Object.fromEntries(
                geocoded.unresolved.map((item) => [item.candidate.id, item.candidate.address]),
            ));
            setPreview({
                fileName: file.name,
                parsedCount: parsed.addresses.length,
                duplicateCount: parsed.duplicateCount,
                warningCount: parsed.warningCount,
                mappedStops: geocoded.mappedStops,
                unresolved: geocoded.unresolved,
            });
        } catch (error) {
            setError(error instanceof Error ? error.message : 'Address file could not be imported.');
        } finally {
            setProcessing(false);
        }
    }

    function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
        const file = event.target.files?.[0];
        if (file) void handleFile(file);
        event.target.value = '';
    }

    function confirmImport() {
        if (!preview || preview.mappedStops.length === 0) return;
        onImport(preview.mappedStops);
        setPreview(null);
        setError(null);
    }

    async function resolveReviewedAddress(item: RoutePlanner2UnresolvedAddress) {
        if (!preview || reviewingId) return;

        const input = reviewInputs[item.candidate.id]?.trim() || item.candidate.address;
        const parsed = parseRoutePlanner2AddressText(input, {
            id: item.candidate.id,
            sourceRow: item.candidate.sourceRows[0] ?? 1,
            sourceCell: 'manual-review',
        });

        if (!parsed) {
            setReviewErrors((current) => ({
                ...current,
                [item.candidate.id]: 'Enter a full address with street, city, province, and postal code.',
            }));
            return;
        }

        setReviewingId(item.candidate.id);
        setReviewErrors((current) => {
            const next = { ...current };
            delete next[item.candidate.id];
            return next;
        });

        try {
            const geocoded = await geocodeRoutePlanner2ParsedAddresses([{
                ...parsed,
                sourceRows: item.candidate.sourceRows,
                occurrenceCount: item.candidate.occurrenceCount,
            }]);
            const fixedStop = geocoded.mappedStops[0];

            if (!fixedStop) {
                setReviewErrors((current) => ({
                    ...current,
                    [item.candidate.id]: geocoded.unresolved[0]?.reason ?? 'Mapbox still could not find a confident match.',
                }));
                return;
            }

            setPreview((current) => current
                ? {
                    ...current,
                    mappedStops: orderRoutePlanner2StopsGeographically([...current.mappedStops, fixedStop]),
                    unresolved: current.unresolved.filter((unresolved) => unresolved.candidate.id !== item.candidate.id),
                }
                : current);
            setEditingReviewId(null);
        } catch (error) {
            setReviewErrors((current) => ({
                ...current,
                [item.candidate.id]: error instanceof Error ? error.message : 'Address could not be checked.',
            }));
        } finally {
            setReviewingId(null);
        }
    }

    const isMapDrawer = presentation === 'map-drawer';
    const shellClassName = isMapDrawer
        ? 'fixed inset-y-3 right-3 z-50 flex w-[min(92vw,30rem)] items-stretch'
        : 'fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-6';
    const panelClassName = isMapDrawer
        ? 'flex h-full w-full flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl'
        : 'flex max-h-[86vh] w-full max-w-4xl flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl';

    return (
        <div className={shellClassName} role="dialog" aria-modal={!isMapDrawer} aria-labelledby="rp2-address-import-title">
            <section className={panelClassName}>
                <header className="flex items-start justify-between gap-4 border-b border-slate-200 px-6 py-5">
                    <div>
                        <div className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.18em] text-cyan-700">
                            <FileSpreadsheet size={18} /> Address import
                        </div>
                        <h2 id="rp2-address-import-title" className="mt-1 text-2xl font-black text-slate-900">Import stops from addresses</h2>
                        <p className="mt-2 text-sm font-semibold text-slate-600">
                            Upload an Excel or CSV address list. Names are not imported; repeat addresses are merged into one stop.
                        </p>
                    </div>
                    <button type="button" onClick={onClose} className="rounded-xl border border-slate-200 p-2 text-slate-600 hover:bg-slate-50" aria-label="Close address import">
                        <X size={18} />
                    </button>
                </header>

                <div className="min-h-0 flex-1 overflow-y-auto bg-slate-50 p-6">
                    <label className={`block rounded-3xl border-2 border-dashed p-6 text-center transition ${processing ? 'cursor-wait border-slate-200 bg-slate-100 opacity-70' : 'cursor-pointer border-cyan-200 bg-white hover:border-cyan-300'}`}>
                        <input
                            type="file"
                            accept=".xlsx,.xls,.csv"
                            className="sr-only"
                            disabled={processing}
                            onChange={handleFileChange}
                        />
                        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-cyan-50 text-cyan-700">
                            <Upload size={22} />
                        </div>
                        <div className="mt-3 text-base font-black text-slate-900">
                            {processing
                                ? geocodeProgress
                                    ? `Geocoding ${geocodeProgress.completed} of ${geocodeProgress.total} addresses…`
                                    : 'Parsing addresses…'
                                : 'Choose address file'}
                        </div>
                        <div className="mt-1 text-sm font-semibold text-slate-500">Supports .xlsx, .xls, and .csv</div>
                    </label>

                    {error && (
                        <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-900">
                            <div className="flex items-center gap-2 font-black"><AlertCircle size={18} /> Address import needs attention</div>
                            <p className="mt-1">{error}</p>
                        </div>
                    )}

                    {preview && (
                        <div className="mt-5 space-y-4">
                            <div className="rounded-2xl border border-slate-200 bg-white p-4">
                                <div className="text-sm font-black text-slate-900">{preview.fileName}</div>
                                <div className="mt-3 grid gap-2 sm:grid-cols-4">
                                    <div className="rounded-xl bg-slate-50 p-3">
                                        <div className="text-xs font-black uppercase text-slate-500">Parsed</div>
                                        <div className="text-xl font-black text-slate-900">{preview.parsedCount}</div>
                                    </div>
                                    <div className="rounded-xl bg-emerald-50 p-3">
                                        <div className="text-xs font-black uppercase text-emerald-700">Ready</div>
                                        <div className="text-xl font-black text-emerald-900">{preview.mappedStops.length}</div>
                                    </div>
                                    <div className="rounded-xl bg-cyan-50 p-3">
                                        <div className="text-xs font-black uppercase text-cyan-700">Duplicates</div>
                                        <div className="text-xl font-black text-cyan-900">{preview.duplicateCount}</div>
                                    </div>
                                    <div className="rounded-xl bg-amber-50 p-3">
                                        <div className="text-xs font-black uppercase text-amber-700">Review</div>
                                        <div className="text-xl font-black text-amber-900">{preview.unresolved.length + preview.warningCount}</div>
                                    </div>
                                </div>
                            </div>

                            {preview.mappedStops.length > 0 && (
                                <div className="rounded-2xl border border-emerald-200 bg-white p-4">
                                    <h3 className="flex items-center gap-2 text-sm font-black text-emerald-900">
                                        <MapPin size={16} /> Stops ready to add in geographic order
                                    </h3>
                                    <div className="mt-3 max-h-60 space-y-2 overflow-y-auto pr-1">
                                        {preview.mappedStops.slice(0, 30).map((stop, index) => (
                                            <div key={stop.id} className="flex items-start gap-3 rounded-xl bg-slate-50 px-3 py-2 text-sm">
                                                <span className="rounded-full bg-cyan-600 px-2 py-1 text-xs font-black text-white">{index + 1}</span>
                                                <div>
                                                    <div className="font-black text-slate-900">{stop.name}</div>
                                                    <div className="text-xs font-semibold text-slate-500">
                                                        {stop.address}{stop.occurrenceCount > 1 ? ` · ${stop.occurrenceCount} rows merged` : ''}
                                                    </div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {preview.unresolved.length > 0 && (
                                <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
                                    <h3 className="text-sm font-black text-amber-900">Needs manual review</h3>
                                    <p className="mt-1 text-xs font-semibold text-amber-800">
                                        Edit an address, then try again. Use the base building address for units or ranges, for example “37 Johnson St, Barrie, ON L4M 5C3”.
                                    </p>
                                    <div className="mt-3 max-h-72 space-y-3 overflow-y-auto pr-1">
                                        {preview.unresolved.map((item) => {
                                            const isEditing = editingReviewId === item.candidate.id;
                                            const isChecking = reviewingId === item.candidate.id;

                                            return (
                                                <div key={item.candidate.id} className="rounded-xl bg-white p-3 text-xs text-amber-900">
                                                    <div className="flex items-start justify-between gap-3">
                                                        <div className="min-w-0">
                                                            <div className="break-words font-black">{item.candidate.address}</div>
                                                            <div className="mt-0.5 font-semibold">{item.reason}</div>
                                                            {(item.diagnostics?.length || item.attempts?.length) ? (
                                                                <details className="mt-2 rounded-lg border border-amber-100 bg-amber-50/70 px-3 py-2">
                                                                    <summary className="cursor-pointer text-[11px] font-black uppercase tracking-wide text-amber-900">
                                                                        Why was this reviewed?
                                                                    </summary>
                                                                    <div className="mt-2 space-y-2 text-[11px] font-semibold text-amber-950">
                                                                        {item.diagnostics?.slice(0, 3).map((diagnostic, index) => (
                                                                            <div key={`${diagnostic.query}-${diagnostic.source}-${index}`} className="rounded-md bg-white/70 px-2 py-1">
                                                                                <div>
                                                                                    Geocoder: {diagnostic.source} · Status: {diagnostic.status ?? 'n/a'} · Token: {diagnostic.tokenPresent ? 'present' : 'missing'}
                                                                                </div>
                                                                                <div className="break-words">Query: {diagnostic.query}</div>
                                                                                <div>Results: {diagnostic.resultCount}{diagnostic.topResultLabel ? ` · Top: ${diagnostic.topResultLabel}` : ''}</div>
                                                                                {diagnostic.error && <div>Error: {diagnostic.error}</div>}
                                                                            </div>
                                                                        ))}
                                                                        {item.attempts?.slice(0, 4).map((attempt, index) => (
                                                                            <div key={`${attempt.query}-${index}`} className="rounded-md bg-white/70 px-2 py-1">
                                                                                <div className="break-words">Tried: {attempt.query}</div>
                                                                                <div>Matched against: {attempt.matchAgainst}</div>
                                                                                <div>Results: {attempt.resultCount}{attempt.topResultLabel ? ` · Top: ${attempt.topResultLabel}` : ''}</div>
                                                                                <div>Reason: {attempt.rejectedReason}</div>
                                                                            </div>
                                                                        ))}
                                                                    </div>
                                                                </details>
                                                            ) : null}
                                                        </div>
                                                        {!isEditing && (
                                                            <button
                                                                type="button"
                                                                onClick={() => setEditingReviewId(item.candidate.id)}
                                                                disabled={reviewingId !== null || processing}
                                                                className="shrink-0 rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-black text-amber-900 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50"
                                                            >
                                                                Fix
                                                            </button>
                                                        )}
                                                    </div>

                                                    {isEditing && (
                                                        <div className="mt-3 rounded-lg border border-amber-100 bg-amber-50/60 p-3">
                                                            <label className="block">
                                                                <span className="text-[11px] font-black uppercase tracking-wide text-slate-500">Corrected address</span>
                                                                <textarea
                                                                    rows={2}
                                                                    value={reviewInputs[item.candidate.id] ?? item.candidate.address}
                                                                    onChange={(event) => setReviewInputs((current) => ({
                                                                        ...current,
                                                                        [item.candidate.id]: event.target.value,
                                                                    }))}
                                                                    className="mt-1 block w-full resize-y rounded-lg border border-amber-200 bg-white px-3 py-2 text-sm font-semibold leading-5 text-slate-900 outline-none focus:border-cyan-500 focus:ring-2 focus:ring-cyan-100"
                                                                    aria-label={`Correct address for ${item.candidate.address}`}
                                                                />
                                                            </label>
                                                            <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:justify-end">
                                                                <button
                                                                    type="button"
                                                                    onClick={() => setEditingReviewId(null)}
                                                                    disabled={isChecking}
                                                                    className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-black text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
                                                                >
                                                                    Cancel
                                                                </button>
                                                                <button
                                                                    type="button"
                                                                    onClick={() => void resolveReviewedAddress(item)}
                                                                    disabled={reviewingId !== null || processing}
                                                                    className="rounded-lg bg-cyan-600 px-3 py-2 text-sm font-black text-white disabled:cursor-not-allowed disabled:opacity-50"
                                                                >
                                                                    {isChecking ? 'Checking…' : 'Try fix'}
                                                                </button>
                                                            </div>
                                                        </div>
                                                    )}

                                                    {reviewErrors[item.candidate.id] && (
                                                        <div className="mt-2 rounded-lg bg-amber-100 px-3 py-2 font-semibold text-amber-950">
                                                            {reviewErrors[item.candidate.id]}
                                                        </div>
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                </div>

                <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-white px-6 py-4">
                    <div className="text-sm font-semibold text-slate-500">
                        {preview ? `${preview.mappedStops.length} stop${preview.mappedStops.length === 1 ? '' : 's'} ready${preview.unresolved.length > 0 ? ` · ${preview.unresolved.length} still need review` : ''}` : 'Upload a file to preview stops before adding them.'}
                    </div>
                    <div className="flex gap-2">
                        <button type="button" onClick={onClose} className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-black text-slate-700">Cancel</button>
                        <button
                            type="button"
                            onClick={confirmImport}
                            disabled={!preview || preview.mappedStops.length === 0 || processing}
                            className="rounded-xl bg-cyan-600 px-4 py-2 text-sm font-black text-white disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            Add mapped stops
                        </button>
                    </div>
                </footer>
            </section>
        </div>
    );
}
