import React, { useEffect, useRef, useState } from 'react';
import { ArrowRight, ExternalLink, Loader2, Map, Play } from 'lucide-react';
import { useTeam } from '../contexts/TeamContext';
import { isFeatureEnabled } from '../../utils/features';
import { canOpenSimulator, openSimulator, SIMULATOR_LIMITED_TABS, type SimulatorView } from '../../utils/simulatorLink';

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

const REPLAY_ROUTES = [
    { color: '#f43f5e', d: 'M-10 60 C 80 40, 140 120, 230 90 S 360 30, 460 70', dur: 22 },
    { color: '#22c55e', d: 'M40 230 C 90 160, 170 170, 210 120 S 300 20, 380 -10', dur: 19 },
    { color: '#38bdf8', d: 'M-10 170 C 100 190, 200 150, 290 190 S 420 210, 470 160', dur: 25 },
    { color: '#f59e0b', d: 'M120 -10 C 140 70, 110 130, 170 200 S 260 250, 300 240', dur: 17 },
    { color: '#a78bfa', d: 'M300 240 C 320 170, 280 120, 340 80 S 430 60, 470 20', dur: 21 },
];

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

function usePrefersReducedMotion(): boolean {
    const [reduced, setReduced] = useState(() =>
        typeof window.matchMedia === 'function' && window.matchMedia(REDUCED_MOTION_QUERY).matches);
    useEffect(() => {
        if (typeof window.matchMedia !== 'function') return undefined;
        const query = window.matchMedia(REDUCED_MOTION_QUERY);
        const onChange = () => setReduced(query.matches);
        query.addEventListener('change', onChange);
        return () => query.removeEventListener('change', onChange);
    }, []);
    return reduced;
}

/** Decorative map with buses moving along route lines. Buses hold still when the user prefers reduced motion. */
const ReplayMap: React.FC = () => {
    const svgRef = useRef<SVGSVGElement>(null);
    const reducedMotion = usePrefersReducedMotion();
    useEffect(() => {
        const svg = svgRef.current;
        if (!svg) return;
        if (reducedMotion) svg.pauseAnimations?.();
        else svg.unpauseAnimations?.();
    }, [reducedMotion]);
    return (
        <svg ref={svgRef} viewBox="0 0 460 240" preserveAspectRatio="xMidYMid slice" className="absolute inset-0 h-full w-full opacity-90" aria-hidden="true">
            {Array.from({ length: 16 }, (_, i) => <line key={`v${i}`} x1={i * 30} x2={i * 30 - 20} y1={0} y2={240} stroke="#1e293b" />)}
            {Array.from({ length: 9 }, (_, i) => <line key={`h${i}`} x1={0} x2={460} y1={i * 30} y2={i * 30 + 8} stroke="#1e293b" />)}
            {REPLAY_ROUTES.map((route, i) => (
                <g key={route.color}>
                    <path d={route.d} fill="none" stroke={route.color} strokeWidth={3} strokeLinecap="round" opacity={0.55} />
                    {[0, 0.5].map(offset => (
                        <circle key={offset} r={5} fill={route.color} stroke="#fff" strokeWidth={2}>
                            <animateMotion
                                dur={`${route.dur}s`}
                                begin={`-${(((i * 0.17 + offset) % 1) * route.dur).toFixed(1)}s`}
                                repeatCount="indefinite"
                                path={route.d}
                            />
                        </circle>
                    ))}
                </g>
            ))}
        </svg>
    );
};

/** Home-page workspace card that opens the Barrie Simulator. */
export const SimulatorWorkspaceCard: React.FC = () => {
    const canOpen = useCanOpenSimulator();
    const { accessLevel } = useTeam();
    const limitedTabs = SIMULATOR_LIMITED_TABS[accessLevel];
    const { busy, error, open } = useOpenSimulator();
    if (!canOpen) return null;
    return (
        <button
            type="button"
            onClick={open}
            disabled={busy}
            className="group relative flex flex-col overflow-hidden rounded-3xl border-b-8 border-indigo-500 bg-slate-900 p-6 text-left transition-all duration-200 hover:-translate-y-1 hover:border-indigo-300 hover:shadow-[0_18px_40px_-16px_rgba(99,102,241,0.8)] disabled:opacity-80"
        >
            <ReplayMap />
            <div className="absolute inset-0 bg-gradient-to-b from-slate-900/35 to-slate-900/90 to-60%" aria-hidden="true" />
            <div className="relative flex flex-1 flex-col">
                <div className="mb-3 flex items-center gap-3">
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-indigo-300/40 bg-indigo-500/25 text-indigo-200 transition-transform group-hover:scale-110">
                        {busy ? <Loader2 size={22} className="animate-spin" aria-hidden="true" /> : <Play size={22} aria-hidden="true" />}
                    </div>
                    <div className="min-w-0">
                        <h3 className="text-xl font-extrabold leading-tight text-white">Barrie Transit Simulator</h3>
                        <div className="mt-1 flex flex-wrap items-center gap-2">
                            <span className="text-xs font-extrabold uppercase tracking-[0.14em] text-indigo-300">{limitedTabs ? limitedTabs.join(' · ') : 'Bus Replay'}</span>
                            <span className="inline-flex items-center gap-1 rounded-full border border-green-300/35 bg-green-500/15 px-2 py-px text-[10px] font-extrabold uppercase tracking-[0.12em] text-green-300">
                                <span className="h-1.5 w-1.5 rounded-full bg-green-500 motion-safe:animate-pulse" aria-hidden="true" />
                                New · Demo
                            </span>
                        </div>
                    </div>
                </div>
                {error ? (
                    <p className="mb-4 line-clamp-3 text-sm font-bold text-rose-300">{error}</p>
                ) : (
                    <p className="mb-4 line-clamp-3 text-sm font-bold text-slate-300">
                        {limitedTabs
                            ? 'Parking lots and curb rules, plus planning layers, on the city map.'
                            : 'See every bus on the map, or replay a past day trip by trip.'}
                    </p>
                )}
                <div className="mt-auto flex items-center gap-2 whitespace-nowrap text-sm font-extrabold uppercase tracking-wide text-indigo-300" title="Opens the Barrie Simulator">
                    Open Simulator <ExternalLink size={15} aria-hidden="true" />
                </div>
            </div>
        </button>
    );
};
