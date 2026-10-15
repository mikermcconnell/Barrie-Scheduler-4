import React, { useState } from 'react';
import { ArrowRight, Loader2, Map } from 'lucide-react';
import { useTeam } from '../contexts/TeamContext';
import { isFeatureEnabled } from '../../utils/features';
import { canOpenSimulator, openSimulator, type SimulatorView } from '../../utils/simulatorLink';

/** True when this user may follow a link into the Barrie Simulator. */
export function useCanOpenSimulator(): boolean {
    const { accessLevel } = useTeam();
    return isFeatureEnabled('operationsSimulatorLink') && canOpenSimulator(accessLevel);
}

function useOpenSimulator(view?: SimulatorView) {
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const open = async () => {
        setBusy(true);
        setError(null);
        try {
            await openSimulator(view);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Could not open the Barrie Simulator.');
            setBusy(false);
        }
    };
    return { busy, error, open };
}

/** Strip above the Operations Dashboard: Bus Monitoring and Replay in the Barrie Simulator (demo). */
export const SimulatorLinkBanner: React.FC = () => {
    const canOpen = useCanOpenSimulator();
    const { busy, error, open } = useOpenSimulator();
    if (!canOpen) return null;
    return (
        <div className="mb-4 flex flex-col gap-2 rounded-xl border border-amber-200 bg-amber-50/60 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
                <Map size={18} className="shrink-0 text-amber-600" aria-hidden="true" />
                <div>
                    <div className="text-sm font-bold text-gray-900">
                        Bus Monitoring and Replay{' '}
                        <span className="ml-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-700">Demo</span>
                    </div>
                    <p className="text-xs text-gray-600">
                        Try the Barrie Simulator: every bus live on the map, or replay a past day trip by trip. Results are not validated yet.
                    </p>
                    {error && <p className="mt-1 text-xs font-semibold text-rose-700">{error}</p>}
                </div>
            </div>
            <button
                type="button"
                onClick={open}
                disabled={busy}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-amber-600 px-3 py-1.5 text-sm font-bold text-white hover:bg-amber-700 disabled:opacity-60"
            >
                {busy ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : null}
                Open in Barrie Simulator <ArrowRight size={14} aria-hidden="true" />
            </button>
        </div>
    );
};

/** Home-page quick link with the same target. */
export const SimulatorQuickLink: React.FC = () => {
    const canOpen = useCanOpenSimulator();
    const { busy, error, open } = useOpenSimulator();
    if (!canOpen) return null;
    return (
        <button
            type="button"
            onClick={open}
            disabled={busy}
            title={error ?? 'Opens the Barrie Simulator (demo), signed in as you'}
            className="group flex min-h-20 items-center gap-3 rounded-xl border border-gray-200 bg-white px-4 py-3 text-left shadow-sm transition-all hover:border-amber-300 hover:bg-amber-50/40 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 focus-visible:ring-offset-2 disabled:opacity-60"
        >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-amber-100 text-amber-600 transition-colors group-hover:bg-amber-200">
                {busy ? <Loader2 size={20} className="animate-spin" aria-hidden="true" /> : <Map size={20} aria-hidden="true" />}
            </span>
            <span className="min-w-0">
                <span className="block text-sm font-extrabold text-gray-900">Bus Monitoring and Replay</span>
                <span className="mt-0.5 block text-xs font-semibold text-gray-500">{error ?? 'Barrie Simulator (demo)'}</span>
            </span>
            <ArrowRight size={16} aria-hidden="true" className="ml-auto shrink-0 text-gray-300 transition-colors group-hover:text-amber-600" />
        </button>
    );
};
