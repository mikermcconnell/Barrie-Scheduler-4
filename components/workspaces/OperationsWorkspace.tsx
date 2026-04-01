import React, { Suspense, useState, useCallback, useEffect } from 'react';
import { ArrowRight, ArrowLeft, Clock, FileText, Loader2 } from 'lucide-react';
import { lazyWithRetry } from '../../utils/lazyWithRetry';
import { isFeatureEnabled } from '../../utils/features';

type OperationsViewMode = 'dashboard' | 'performance' | 'perf-reports';

const OPERATIONS_VIEW_FEATURES: Partial<Record<OperationsViewMode, Parameters<typeof isFeatureEnabled>[0]>> = {
    performance: 'operationsPerformanceDashboard',
    'perf-reports': 'operationsPerfReports',
};

const isOperationsViewEnabled = (viewMode: OperationsViewMode): boolean => {
    const feature = OPERATIONS_VIEW_FEATURES[viewMode];
    return feature ? isFeatureEnabled(feature) : true;
};

const VIEW_MODE_LABELS: Record<OperationsViewMode, string> = {
    dashboard: '',
    performance: 'Operations Dashboard',
    'perf-reports': 'STREETS Reports',
};

const PerformanceDashboard = lazyWithRetry(
    () => import('../Performance/PerformanceDashboard').then(module => ({ default: module.PerformanceDashboard })),
    'operations-performance-dashboard',
);
const PerfReportsWorkspace = lazyWithRetry(
    () => import('./ReportsWorkspace').then(module => ({ default: module.ReportsWorkspace })),
    'operations-reports-workspace',
);

function parseHashViewMode(): OperationsViewMode {
    const hash = window.location.hash.slice(1);
    const parts = hash.split('/');
    if (parts[0] === 'operations' && parts[1]) {
        if ((parts[1] === 'performance' || parts[1] === 'perf-reports') && isOperationsViewEnabled(parts[1])) return parts[1];
    }
    return 'dashboard';
}

interface DashboardCardProps {
    onClick: () => void;
    icon: React.ReactNode;
    title: string;
    description: string;
    color: 'amber' | 'cyan';
}

const DashboardCard: React.FC<DashboardCardProps> = ({ onClick, icon, title, description, color }) => {
    const colorClasses = {
        amber: { bg: 'bg-amber-50/50', text: 'text-amber-600', border: 'hover:border-amber-300', arrow: 'group-hover:text-amber-500' },
        cyan: { bg: 'bg-cyan-50/50', text: 'text-cyan-600', border: 'hover:border-cyan-300', arrow: 'group-hover:text-cyan-500' },
    };
    const c = colorClasses[color];

    return (
        <button onClick={onClick} className={`group bg-white p-6 rounded-xl border border-gray-200 shadow-sm hover:shadow-md ${c.border} transition-all text-left flex flex-col h-full active:scale-[0.99]`}>
            <div className="flex items-center justify-between mb-4">
                <div className={`${c.bg} p-2.5 rounded-lg ${c.text} transition-colors`}>{icon}</div>
                <ArrowRight size={16} className={`text-gray-300 ${c.arrow} transition-colors`} />
            </div>
            <h3 className="text-lg font-bold text-gray-900 mb-1">{title}</h3>
            <p className="text-sm text-gray-500 leading-relaxed">{description}</p>
        </button>
    );
};

const OperationsSubviewLoading: React.FC<{ label: string }> = ({ label }) => (
    <div className="flex h-full items-center justify-center">
        <div className="flex flex-col items-center gap-3 text-gray-500">
            <Loader2 className="animate-spin text-cyan-500" size={28} />
            <span className="text-sm font-medium">{label}</span>
        </div>
    </div>
);

export const OperationsWorkspace: React.FC = () => {
    const [viewMode, setViewModeState] = useState<OperationsViewMode>(parseHashViewMode);

    const setViewMode = useCallback((mode: OperationsViewMode) => {
        const safeMode = isOperationsViewEnabled(mode) ? mode : 'dashboard';
        setViewModeState(safeMode);
        window.location.hash = safeMode === 'dashboard' ? 'operations' : `operations/${safeMode}`;
    }, []);

    useEffect(() => {
        const handler = () => {
            const nextMode = parseHashViewMode();
            setViewModeState(nextMode);
            if (nextMode === 'dashboard' && window.location.hash && window.location.hash !== '#operations') {
                window.location.hash = 'operations';
            }
        };
        handler();
        window.addEventListener('hashchange', handler);
        return () => window.removeEventListener('hashchange', handler);
    }, []);

    useEffect(() => {
        if (viewMode !== 'dashboard' && !isOperationsViewEnabled(viewMode)) {
            setViewMode('dashboard');
        }
    }, [setViewMode, viewMode]);

    if (viewMode === 'dashboard') {
        return (
            <div className="animate-in fade-in slide-in-from-bottom-2 duration-500 max-w-6xl mx-auto pt-8">
                <div className="mb-8 px-4">
                    <button
                        onClick={() => { window.location.hash = ''; }}
                        className="flex items-center gap-1.5 text-gray-400 hover:text-gray-600 text-sm font-medium transition-colors mb-3"
                    >
                        <ArrowLeft size={14} /> Back to Main
                    </button>
                    <h2 className="text-2xl font-bold text-gray-900 tracking-tight mb-2">Dashboard & Reporting</h2>
                    <p className="text-gray-500">Performance dashboards and operational reports.</p>
                    <p className="text-xs text-amber-600 font-medium mt-1">Scheduled transit (fixed-route) data only.</p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 px-4 max-w-3xl">
                    {isFeatureEnabled('operationsPerformanceDashboard') && (
                        <DashboardCard onClick={() => setViewMode('performance')} icon={<Clock size={20} />} color="amber"
                            title="Operations Dashboard" description="OTP, ridership, and load profiles from STREETS AVL/APC data." />
                    )}

                    {isFeatureEnabled('operationsPerfReports') && (
                        <DashboardCard onClick={() => setViewMode('perf-reports')} icon={<FileText size={20} />} color="cyan"
                            title="STREETS Reports" description="Weekly summaries, route deep-dives, and AI-powered analysis of STREETS data." />
                    )}
                </div>
            </div>
        );
    }

    return (
        <div className="flex flex-col h-full">
            <div className="flex items-center gap-2 mb-3 px-4">
                <button
                    onClick={() => setViewMode('dashboard')}
                    className="flex items-center gap-1.5 text-gray-400 hover:text-gray-600 text-sm font-medium transition-colors"
                >
                    <ArrowLeft size={14} /> Back to Dashboard
                </button>
                <div className="h-4 w-px bg-gray-300"></div>
                <div className="text-xs font-bold text-gray-500 uppercase tracking-wider">
                    {VIEW_MODE_LABELS[viewMode]}
                </div>
            </div>

            <div className="flex-grow overflow-hidden relative bg-white rounded-3xl border-2 border-gray-100 shadow-sm">
                <div className="absolute inset-0">
                    <Suspense fallback={<OperationsSubviewLoading label="Loading operations view..." />}>
                        {viewMode === 'performance' && (
                            <PerformanceDashboard onClose={() => setViewMode('dashboard')} autoOpen />
                        )}

                        {viewMode === 'perf-reports' && (
                            <PerfReportsWorkspace onClose={() => setViewMode('dashboard')} />
                        )}
                    </Suspense>
                </div>
            </div>
        </div>
    );
};
