import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Download, Loader2, MapPinned, Plus, Save, Send, Trash2, Upload, X } from 'lucide-react';
import { Layer, Source } from 'react-map-gl/mapbox';
import { useQueryClient } from '@tanstack/react-query';
import { MapBase } from '../shared';
import { TodZoneDrawControl } from './TodZoneDrawControl';
import { useBarrieTransitStopsQuery, useTodZoneDraftQuery } from '../../hooks/useTodZones';
import { assignTodZoneMembership, normalizeTodZoneStopId, validateTodZoneDraft } from '../../utils/todZones/todZoneGeometry';
import { exportTodZoneGeoJson, parseTodZoneGeoJson } from '../../utils/todZones/todZoneGeoJson';
import { ZONE_A_REFERENCE_STOP_IDS } from '../../utils/todZones/todZoneSeed';
import { getTodZoneErrorMessage, publishTodZoneVersion, saveTodZoneDraft } from '../../utils/todZones/todZoneService';
import type { TodStopOverride, TodZoneDraft, TodZonePolygon } from '../../utils/todZones/todZoneTypes';

interface TodZoneEditorProps {
    open: boolean;
    teamId: string;
    userId: string;
    onClose: () => void;
}

const BARRIE_CENTER: [number, number] = [44.39, -79.69];
const MAX_IMPORT_BYTES = 2 * 1024 * 1024;

function editableSignature(draft: TodZoneDraft): string {
    return JSON.stringify({
        definitions: draft.definitions,
        polygons: draft.polygons,
        overrides: draft.overrides,
        effectiveFrom: draft.effectiveFrom,
        source: draft.source,
        reviewNote: draft.reviewNote,
    });
}

export const TodZoneEditor: React.FC<TodZoneEditorProps> = ({ open, teamId, userId, onClose }) => {
    const queryClient = useQueryClient();
    const draftQuery = useTodZoneDraftQuery(open ? teamId : undefined);
    const stopsQuery = useBarrieTransitStopsQuery(open);
    const [draft, setDraft] = useState<TodZoneDraft | null>(null);
    const [activeZoneCode, setActiveZoneCode] = useState('A');
    const [mapStyle, setMapStyle] = useState('mapbox://styles/mapbox/light-v11');
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState('');
    const [overrideStopId, setOverrideStopId] = useState('');
    const [overrideAction, setOverrideAction] = useState<TodStopOverride['action']>('include');
    const [overrideCodes, setOverrideCodes] = useState('A');
    const [overrideReason, setOverrideReason] = useState('Planner-reviewed exception');
    const fileInputRef = useRef<HTMLInputElement | null>(null);
    const dialogRef = useRef<HTMLDivElement | null>(null);
    const baselineSignatureRef = useRef('');

    useEffect(() => {
        if (draftQuery.data) {
            const next = structuredClone(draftQuery.data);
            setDraft(next);
            baselineSignatureRef.current = editableSignature(next);
        }
    }, [draftQuery.data]);

    const isDirty = !!draft && editableSignature(draft) !== baselineSignatureRef.current;
    const requestClose = useCallback(() => {
        if (isDirty && !window.confirm('Discard the unsaved TOD zone changes?')) return;
        onClose();
    }, [isDirty, onClose]);

    useEffect(() => {
        if (!open) return;
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') requestClose();
            if (event.key !== 'Tab' || !dialogRef.current) return;
            const focusable = [...dialogRef.current.querySelectorAll<HTMLElement>(
                'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
            )].filter(element => !element.hasAttribute('hidden'));
            if (focusable.length === 0) return;
            const first = focusable[0];
            const last = focusable.at(-1)!;
            if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first.focus();
            }
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [open, requestClose]);

    useEffect(() => {
        if (!open) return;
        const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        dialogRef.current?.focus();
        return () => previouslyFocused?.focus();
    }, [open]);

    const stops = useMemo(() => stopsQuery.data ?? [], [stopsQuery.data]);
    const stopMemberships = useMemo(() => {
        if (!draft) return [];
        return stops.map(stop => ({
            ...stop,
            zoneCodes: assignTodZoneMembership(stop, draft.definitions, draft.polygons, draft.overrides).zoneCodes,
        }));
    }, [draft, stops]);
    const activeCount = stopMemberships.filter(stop => stop.zoneCodes.includes(activeZoneCode)).length;
    const zoneAReferenceCount = stopMemberships.filter(stop => ZONE_A_REFERENCE_STOP_IDS.includes(stop.id) && stop.zoneCodes.includes('A')).length;
    const stopGeoJson = useMemo((): GeoJSON.FeatureCollection => ({
        type: 'FeatureCollection',
        features: stopMemberships.map(stop => ({
            type: 'Feature',
            properties: { id: stop.id, zoneCodes: stop.zoneCodes.join(',') },
            geometry: { type: 'Point', coordinates: [stop.lon, stop.lat] },
        })),
    }), [stopMemberships]);

    useEffect(() => {
        if (!draft) return;
        const activeCodes = draft.definitions.filter(zone => zone.active).map(zone => zone.code);
        if (!activeCodes.includes(activeZoneCode) && activeCodes[0]) setActiveZoneCode(activeCodes[0]);
    }, [activeZoneCode, draft]);

    const validationError = useMemo(() => {
        if (!draft) return '';
        try {
            validateTodZoneDraft(draft);
            return '';
        } catch (error) {
            return error instanceof Error ? error.message : 'The zone draft is invalid.';
        }
    }, [draft]);

    if (!open) return null;

    const updatePolygons = (polygons: TodZonePolygon[]) => setDraft(current => current ? { ...current, polygons } : current);
    const addOverride = () => {
        if (!draft || !overrideStopId.trim()) return;
        const stopId = normalizeTodZoneStopId(overrideStopId);
        const zoneCodes = [...new Set(overrideCodes.split(',').map(code => code.trim().toUpperCase()).filter(Boolean))];
        const activeCodes = new Set(draft.definitions.filter(zone => zone.active).map(zone => zone.code));
        if (zoneCodes.length === 0 || zoneCodes.some(code => !activeCodes.has(code))) {
            setMessage('Choose at least one active zone code for the stop override.');
            return;
        }
        if (!overrideReason.trim()) {
            setMessage('Add a reason for the stop override.');
            return;
        }
        const next: TodStopOverride = {
            stopId, action: overrideAction, zoneCodes, reason: overrideReason.trim(),
        };
        setDraft({ ...draft, overrides: [...draft.overrides.filter(item => normalizeTodZoneStopId(item.stopId) !== stopId), next] });
        setOverrideStopId('');
        setMessage(`Added a ${overrideAction} override for stop ${stopId}.`);
    };
    const persist = async (publish: boolean) => {
        if (!draft) return;
        if (validationError) {
            setMessage(validationError);
            return;
        }
        if (publish && !window.confirm(`Publish these zones effective ${draft.effectiveFrom}? Published versions are immutable.`)) return;
        setSaving(true);
        setMessage('');
        try {
            if (publish) {
                const result = await publishTodZoneVersion(teamId, draft, stops, userId, draft.revision);
                const next = { ...draft, revision: result.revision, lastPublishedVersionId: result.versionId };
                setDraft(next);
                baselineSignatureRef.current = editableSignature(next);
                setMessage('Published a new effective-dated zone version.');
            } else {
                const revision = await saveTodZoneDraft(teamId, draft, userId, draft.revision);
                const next = { ...draft, revision };
                setDraft(next);
                baselineSignatureRef.current = editableSignature(next);
                setMessage('Draft saved for the team.');
            }
            await Promise.all([
                queryClient.invalidateQueries({ queryKey: ['todZoneDraft', teamId] }),
                queryClient.invalidateQueries({ queryKey: ['todZoneVersions', teamId] }),
            ]);
        } catch (error) {
            setMessage(getTodZoneErrorMessage(error));
        } finally {
            setSaving(false);
        }
    };
    const importFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file || !draft) return;
        try {
            if (file.size > MAX_IMPORT_BYTES) throw new Error('GeoJSON imports must be 2 MB or smaller.');
            const polygons = parseTodZoneGeoJson(await file.text(), draft.definitions);
            setDraft({ ...draft, polygons });
            setMessage(`Imported ${polygons.length} polygon${polygons.length === 1 ? '' : 's'} for review.`);
        } catch (error) {
            setMessage(error instanceof Error ? error.message : 'GeoJSON could not be imported.');
        } finally {
            event.target.value = '';
        }
    };
    const exportGeoJson = () => {
        if (!draft) return;
        const url = URL.createObjectURL(new Blob([exportTodZoneGeoJson(draft.polygons)], { type: 'application/geo+json' }));
        const link = document.createElement('a');
        link.href = url;
        link.download = `tod-zones-draft-r${draft.revision}.geojson`;
        link.click();
        URL.revokeObjectURL(url);
    };

    return (
        <div ref={dialogRef} tabIndex={-1} className="fixed inset-0 z-[70] flex flex-col bg-slate-950/50 outline-none" role="dialog" aria-modal="true" aria-label="Edit Transit On Demand zones">
            <div className="flex min-h-0 flex-1 flex-col bg-white lg:m-4 lg:overflow-hidden lg:rounded-2xl lg:shadow-2xl">
                <header className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
                    <div>
                        <div className="flex items-center gap-2"><MapPinned size={19} className="text-violet-700" /><h2 className="font-extrabold text-slate-950">Transit On Demand zone editor</h2></div>
                        <p className="mt-1 text-xs text-slate-500">Codex Zone A seed · draw and validate against current City stops · publish only after planner review</p>
                    </div>
                    <button type="button" onClick={requestClose} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100" aria-label="Close zone editor"><X size={18} /></button>
                </header>
                {draftQuery.isError ? (
                    <div className="grid flex-1 place-items-center p-6 text-center">
                        <div><div className="text-sm font-bold text-red-800">The team zone draft could not be loaded.</div><p className="mt-1 text-sm text-slate-600">Check your connection and access, then try again.</p><button type="button" onClick={() => void draftQuery.refetch()} className="mt-3 rounded-lg bg-slate-900 px-3 py-2 text-xs font-bold text-white">Retry</button></div>
                    </div>
                ) : draftQuery.isLoading || !draft ? (
                    <div className="grid flex-1 place-items-center text-sm font-semibold text-slate-500"><span className="inline-flex items-center gap-2"><Loader2 size={16} className="animate-spin" />Loading team zone draft…</span></div>
                ) : (
                    <div className="grid min-h-0 flex-1 lg:grid-cols-[340px_minmax(0,1fr)]">
                        <aside className="overflow-y-auto border-r border-slate-200 bg-slate-50 p-4">
                            <label className="text-xs font-bold text-slate-700">Draw new polygons as</label>
                            <div className="mt-2 flex flex-wrap gap-1.5">
                                {draft.definitions.filter(zone => zone.active).map(zone => (
                                    <button key={zone.code} type="button" onClick={() => setActiveZoneCode(zone.code)} aria-pressed={activeZoneCode === zone.code}
                                        className={`rounded-full border px-2.5 py-1 text-xs font-extrabold ${activeZoneCode === zone.code ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-white text-slate-700'}`}>
                                        {zone.code}
                                    </button>
                                ))}
                            </div>
                            <div className="mt-3 rounded-xl border border-violet-200 bg-violet-50 p-3 text-xs text-violet-900">
                                <strong>{activeCount} current stops assigned to Zone {activeZoneCode}</strong>
                                <div className="mt-1">{draft.polygons.filter(item => item.zoneCode === activeZoneCode).length} polygon pockets · {draft.overrides.length} stop overrides</div>
                                {activeZoneCode === 'A' && <div className="mt-1">{zoneAReferenceCount}/25 stops labelled on the Zone A PDF are included.</div>}
                                {stopsQuery.isError && <div className="mt-1 font-bold text-red-700">The City stop layer is unavailable; publishing is disabled.</div>}
                            </div>
                            <div className="mt-4 grid gap-3">
                                <label className="text-xs font-bold text-slate-700">Effective from<input type="date" value={draft.effectiveFrom} onChange={event => setDraft({ ...draft, effectiveFrom: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-normal" /></label>
                                <label className="text-xs font-bold text-slate-700">Source<input maxLength={1000} value={draft.source} onChange={event => setDraft({ ...draft, source: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-normal" /></label>
                                <label className="text-xs font-bold text-slate-700">Review note<textarea maxLength={2000} value={draft.reviewNote} onChange={event => setDraft({ ...draft, reviewNote: event.target.value })} rows={3} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-normal" /></label>
                            </div>
                            <div className="mt-5 border-t border-slate-200 pt-4">
                                <h3 className="text-xs font-extrabold uppercase tracking-wide text-slate-600">Stop override</h3>
                                <div className="mt-2 grid grid-cols-2 gap-2">
                                    <input value={overrideStopId} onChange={event => setOverrideStopId(event.target.value)} placeholder="Stop ID" className="rounded-lg border border-slate-300 bg-white px-2 py-2 text-xs" />
                                    <select value={overrideAction} onChange={event => setOverrideAction(event.target.value as TodStopOverride['action'])} className="rounded-lg border border-slate-300 bg-white px-2 py-2 text-xs"><option value="include">Include</option><option value="exclude">Exclude</option><option value="replace">Replace</option></select>
                                    <input value={overrideCodes} onChange={event => setOverrideCodes(event.target.value)} placeholder="A,B" className="rounded-lg border border-slate-300 bg-white px-2 py-2 text-xs" />
                                    <button type="button" onClick={addOverride} className="inline-flex items-center justify-center gap-1 rounded-lg bg-slate-800 px-2 py-2 text-xs font-bold text-white"><Plus size={13} />Add</button>
                                </div>
                                <input maxLength={500} value={overrideReason} onChange={event => setOverrideReason(event.target.value)} placeholder="Reason" className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-2 py-2 text-xs" />
                                <div className="mt-2 max-h-28 space-y-1 overflow-y-auto">
                                    {draft.overrides.map(item => <div key={item.stopId} className="flex items-center justify-between rounded-lg bg-white px-2 py-1.5 text-xs"><span><strong>{item.stopId}</strong> · {item.action} {item.zoneCodes.join(', ')}</span><button type="button" onClick={() => setDraft({ ...draft, overrides: draft.overrides.filter(value => value.stopId !== item.stopId) })} aria-label={`Remove override for ${item.stopId}`}><Trash2 size={13} /></button></div>)}
                                </div>
                            </div>
                            <div className="mt-5 flex flex-wrap gap-2 border-t border-slate-200 pt-4">
                                <input ref={fileInputRef} type="file" accept=".json,.geojson,application/geo+json" onChange={importFile} className="hidden" />
                                <button type="button" onClick={() => fileInputRef.current?.click()} className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-xs font-bold"><Upload size={13} />Import</button>
                                <button type="button" onClick={exportGeoJson} className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-xs font-bold"><Download size={13} />Export</button>
                            </div>
                            {(message || validationError) && <div className={`mt-3 rounded-lg border p-2 text-xs font-semibold ${validationError ? 'border-red-200 bg-red-50 text-red-800' : 'border-slate-200 bg-white text-slate-700'}`} role="status">{validationError || message}</div>}
                            <div className="mt-4 grid grid-cols-2 gap-2">
                                <button type="button" disabled={saving || !!validationError} onClick={() => persist(false)} className="inline-flex items-center justify-center gap-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-bold disabled:opacity-50"><Save size={14} />Save draft</button>
                                <button type="button" disabled={saving || !!validationError || draft.polygons.length === 0 || stopsQuery.isError || stops.length === 0} onClick={() => persist(true)} className="inline-flex items-center justify-center gap-1 rounded-lg bg-violet-700 px-3 py-2 text-xs font-bold text-white disabled:opacity-50"><Send size={14} />Publish</button>
                            </div>
                        </aside>
                        <main className="relative min-h-[500px]">
                            <div className="absolute left-2 top-2 z-10 inline-flex rounded-lg border border-slate-200 bg-white p-1 shadow">
                                <button type="button" onClick={() => setMapStyle('mapbox://styles/mapbox/light-v11')} className={`rounded px-2 py-1 text-xs font-bold ${mapStyle.includes('light') ? 'bg-slate-900 text-white' : ''}`}>Light</button>
                                <button type="button" onClick={() => setMapStyle('mapbox://styles/mapbox/satellite-streets-v12')} className={`rounded px-2 py-1 text-xs font-bold ${mapStyle.includes('satellite') ? 'bg-slate-900 text-white' : ''}`}>Satellite</button>
                            </div>
                            <MapBase latitude={BARRIE_CENTER[0]} longitude={BARRIE_CENTER[1]} zoom={12} mapStyle={mapStyle} showNavigation>
                                <Source id="tod-zone-editor-stops" type="geojson" data={stopGeoJson}><Layer id="tod-zone-editor-stop-points" type="circle" paint={{ 'circle-radius': 4, 'circle-color': ['case', ['!=', ['get', 'zoneCodes'], ''], '#7c3aed', '#475569'], 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 1 }} /></Source>
                                <TodZoneDrawControl polygons={draft.polygons} activeZoneCode={activeZoneCode} onChange={updatePolygons} />
                            </MapBase>
                        </main>
                    </div>
                )}
            </div>
        </div>
    );
};
