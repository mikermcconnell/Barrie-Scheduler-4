import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Loader2, Plus, Save, Settings2, Trash2, X } from 'lucide-react';
import type { PerformanceLoadCapacityConfig } from '../../utils/performanceDataTypes';
import { MAX_LOAD_CAPACITY, MIN_LOAD_CAPACITY } from '../../utils/performanceDataTypes';
import {
    DEFAULT_PERFORMANCE_LOAD_CAPACITY_CONFIG,
    normalizeVehicleId,
} from '../../utils/performanceLoadCapacity';
import {
    getEffectivePerformanceLoadCapacityConfig,
    getPerformanceLoadConfigErrorMessage,
    savePerformanceLoadCapacityConfig,
} from '../../utils/performanceLoadConfigService';

interface PerformanceLoadCapacityPanelProps {
    teamId?: string;
    userId?: string;
    canManage: boolean;
    onConfigChange: (config: PerformanceLoadCapacityConfig | undefined) => void;
}

interface EditableVehicleCapacity {
    rowId: string;
    vehicleId: string;
    capacity: string;
}

let rowSequence = 0;
function toRows(config: PerformanceLoadCapacityConfig): EditableVehicleCapacity[] {
    return Object.entries(config.vehicleCapacities).map(([vehicleId, capacity]) => ({
        rowId: `capacity-${rowSequence++}`,
        vehicleId,
        capacity: String(capacity),
    }));
}

export const PerformanceLoadCapacityPanel: React.FC<PerformanceLoadCapacityPanelProps> = ({
    teamId,
    userId,
    canManage,
    onConfigChange,
}) => {
    const [config, setConfig] = useState<PerformanceLoadCapacityConfig>(DEFAULT_PERFORMANCE_LOAD_CAPACITY_CONFIG);
    const [loading, setLoading] = useState(!!teamId);
    const [loadFailed, setLoadFailed] = useState(false);
    const [editing, setEditing] = useState(false);
    const [saving, setSaving] = useState(false);
    const [defaultCapacity, setDefaultCapacity] = useState(String(DEFAULT_PERFORMANCE_LOAD_CAPACITY_CONFIG.defaultCapacity));
    const [vehicles, setVehicles] = useState<EditableVehicleCapacity[]>([]);
    const [error, setError] = useState('');

    useEffect(() => {
        let active = true;
        if (!teamId) {
            setConfig(DEFAULT_PERFORMANCE_LOAD_CAPACITY_CONFIG);
            setLoading(false);
            setLoadFailed(false);
            onConfigChange(undefined);
            return () => { active = false; };
        }
        setLoading(true);
        setLoadFailed(false);
        getEffectivePerformanceLoadCapacityConfig(teamId)
            .then(next => {
                if (!active) return;
                setConfig(next);
                setDefaultCapacity(String(next.defaultCapacity));
                setVehicles(toRows(next));
                setError('');
                setLoadFailed(false);
                onConfigChange(next);
            })
            .catch(loadError => {
                if (!active) return;
                setConfig(DEFAULT_PERFORMANCE_LOAD_CAPACITY_CONFIG);
                setLoadFailed(true);
                setError(getPerformanceLoadConfigErrorMessage(loadError, 'load'));
                onConfigChange(undefined);
            })
            .finally(() => { if (active) setLoading(false); });
        return () => { active = false; };
    }, [onConfigChange, teamId]);

    const duplicateVehicleIds = useMemo(() => {
        const counts = new Map<string, number>();
        vehicles.forEach(row => {
            const id = normalizeVehicleId(row.vehicleId);
            if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
        });
        return new Set([...counts].filter(([, count]) => count > 1).map(([id]) => id));
    }, [vehicles]);

    const resetEditor = () => {
        setDefaultCapacity(String(config.defaultCapacity));
        setVehicles(toRows(config));
        setError('');
        setEditing(false);
    };

    const save = async () => {
        if (!teamId || !userId) return;
        const parsedDefault = Number(defaultCapacity);
        const vehicleCapacities: Record<string, number> = {};
        for (const row of vehicles) {
            const vehicleId = normalizeVehicleId(row.vehicleId);
            if (vehicleId) vehicleCapacities[vehicleId] = Number(row.capacity);
        }
        if (duplicateVehicleIds.size > 0) {
            setError(`Remove duplicate vehicle IDs: ${[...duplicateVehicleIds].join(', ')}.`);
            return;
        }
        setSaving(true);
        setError('');
        try {
            const nextVersion = await savePerformanceLoadCapacityConfig(
                teamId,
                { defaultCapacity: parsedDefault, vehicleCapacities },
                userId,
                config.version,
            );
            const next: PerformanceLoadCapacityConfig = {
                defaultCapacity: parsedDefault,
                vehicleCapacities,
                version: nextVersion,
                updatedAt: new Date().toISOString(),
                updatedBy: userId,
            };
            setConfig(next);
            setVehicles(toRows(next));
            setEditing(false);
            onConfigChange(next);
        } catch (saveError) {
            setError(saveError instanceof Error && !('code' in saveError)
                ? saveError.message
                : getPerformanceLoadConfigErrorMessage(saveError, 'save'));
        } finally {
            setSaving(false);
        }
    };

    return (
        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm" aria-label="Passenger load capacity settings">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <div className="flex items-center gap-2">
                        <Settings2 size={16} className="text-cyan-700" aria-hidden="true" />
                        <h3 className="text-sm font-bold text-slate-900">Passenger-load capacity model</h3>
                    </div>
                    <p className="mt-1 text-xs text-slate-500">
                        {!teamId
                            ? 'Using capacities stored with the imported trip data'
                            : loading
                            ? 'Loading the team capacity policy...'
                            : loadFailed
                                ? 'Team capacity policy unavailable · saved import capacities remain in use'
                            : `${config.defaultCapacity}-passenger default · ${Object.keys(config.vehicleCapacities).length} vehicle override${Object.keys(config.vehicleCapacities).length === 1 ? '' : 's'}`}
                    </p>
                </div>
                {canManage && teamId && userId && !loadFailed && !editing && (
                    <button type="button" onClick={() => setEditing(true)} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50">
                        Edit capacities
                    </button>
                )}
            </div>

            {error && <p role="alert" className="mt-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800"><AlertTriangle size={14} className="mt-0.5 shrink-0" />{error}</p>}

            {editing && (
                <div className="mt-4 space-y-4 border-t border-slate-100 pt-4">
                    <label className="block max-w-xs text-xs font-semibold text-slate-700">
                        Default passenger capacity
                        <input type="number" min={MIN_LOAD_CAPACITY} max={MAX_LOAD_CAPACITY} step={1} value={defaultCapacity} onChange={event => setDefaultCapacity(event.target.value)} className="mt-1 block w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
                        <span className="mt-1 block font-normal text-slate-400">Whole number from {MIN_LOAD_CAPACITY} to {MAX_LOAD_CAPACITY}.</span>
                    </label>
                    <div>
                        <div className="flex items-center justify-between gap-3">
                            <h4 className="text-xs font-bold uppercase tracking-wide text-slate-500">Vehicle overrides</h4>
                            <button type="button" onClick={() => setVehicles(rows => [...rows, { rowId: `capacity-${rowSequence++}`, vehicleId: '', capacity: defaultCapacity }])} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold text-cyan-700 hover:bg-cyan-50"><Plus size={13} /> Add vehicle</button>
                        </div>
                        <div className="mt-2 space-y-2">
                            {vehicles.length === 0 && <p className="text-xs text-slate-400">No vehicle-specific capacities.</p>}
                            {vehicles.map(row => (
                                <div key={row.rowId} className="grid grid-cols-[minmax(0,1fr)_120px_36px] gap-2">
                                    <input aria-label="Vehicle ID" placeholder="Vehicle ID" value={row.vehicleId} onChange={event => setVehicles(rows => rows.map(item => item.rowId === row.rowId ? { ...item, vehicleId: event.target.value } : item))} className="rounded-lg border border-slate-200 px-3 py-2 text-sm" />
                                    <input aria-label={`Capacity for ${row.vehicleId || 'vehicle'}`} type="number" min={MIN_LOAD_CAPACITY} max={MAX_LOAD_CAPACITY} value={row.capacity} onChange={event => setVehicles(rows => rows.map(item => item.rowId === row.rowId ? { ...item, capacity: event.target.value } : item))} className="rounded-lg border border-slate-200 px-3 py-2 text-sm" />
                                    <button type="button" aria-label={`Remove ${row.vehicleId || 'vehicle'} capacity`} onClick={() => setVehicles(rows => rows.filter(item => item.rowId !== row.rowId))} className="rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600"><Trash2 size={15} className="mx-auto" /></button>
                                </div>
                            ))}
                        </div>
                    </div>
                    <p className="rounded-lg bg-sky-50 px-3 py-2 text-xs leading-relaxed text-sky-800">
                        Saved capacity changes apply immediately to Passenger Flow estimates. Existing APC values were capped during import: archived CSV history must be rebuilt, while workbook history must be re-uploaded, to apply a new cap to observed history.
                    </p>
                    <div className="flex justify-end gap-2">
                        <button type="button" onClick={resetEditor} disabled={saving} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600"><X size={13} /> Cancel</button>
                        <button type="button" onClick={save} disabled={saving} className="inline-flex items-center gap-1 rounded-lg bg-cyan-700 px-3 py-2 text-xs font-semibold text-white disabled:opacity-60">{saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />} Save capacities</button>
                    </div>
                </div>
            )}
        </section>
    );
};
