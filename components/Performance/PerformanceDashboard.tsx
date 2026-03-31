import React, { Suspense, useEffect, useMemo, useState } from 'react';
import { ArrowRight, Loader2, Activity, AlertTriangle, CheckCircle2, ShieldAlert } from 'lucide-react';
import { useTeam } from '../contexts/TeamContext';
import { useAuth } from '../contexts/AuthContext';
import { TeamManagement } from '../TeamManagement';
import { usePerformanceMetadataQuery, usePerformanceDataQuery } from '../../hooks/usePerformanceData';
import { lazyWithRetry } from '../../utils/lazyWithRetry';
import { buildPerformanceMetadataHealth } from '../../utils/performanceImportHealth';

interface PerformanceDashboardProps {
    onClose: () => void;
    autoOpen?: boolean;
}

type PerformanceView = 'landing' | 'import' | 'workspace' | 'loading';
type ImportReturnTarget = 'landing' | 'workspace' | 'close';

const PerformanceImport = lazyWithRetry(
    () => import('./PerformanceImport').then(module => ({ default: module.PerformanceImport })),
    'performance-dashboard-import',
);
const PerformanceWorkspace = lazyWithRetry(
    () => import('./PerformanceWorkspace').then(module => ({ default: module.PerformanceWorkspace })),
    'performance-dashboard-workspace',
);

const DashboardLoadingState: React.FC<{ label: string }> = ({ label }) => (
    <div className="h-full flex items-center justify-center">
        <div className="flex flex-col items-center gap-3 text-gray-500">
            <Loader2 className="text-cyan-500 animate-spin" size={32} />
            <span className="text-sm font-medium">{label}</span>
        </div>
    </div>
);

export const PerformanceDashboard: React.FC<PerformanceDashboardProps> = ({ onClose, autoOpen = false }) => {
    const { team } = useTeam();
    const { user } = useAuth();
    const [view, setView] = useState<PerformanceView>(() => (autoOpen ? 'loading' : 'landing'));
    const [importReturnTarget, setImportReturnTarget] = useState<ImportReturnTarget>(() => (autoOpen ? 'close' : 'landing'));

    const metadataQuery = usePerformanceMetadataQuery(team?.id);
    const hasExistingData = metadataQuery.data != null;
    const shouldLoadWorkspaceData = view === 'workspace' && hasExistingData;
    const dataQuery = usePerformanceDataQuery(team?.id, shouldLoadWorkspaceData);
    const quickHealth = useMemo(
        () => buildPerformanceMetadataHealth(metadataQuery.data),
        [metadataQuery.data],
    );

    useEffect(() => {
        setView(autoOpen ? 'loading' : 'landing');
        setImportReturnTarget(autoOpen ? 'close' : 'landing');
    }, [team?.id, autoOpen]);

    useEffect(() => {
        if (!autoOpen || view !== 'loading' || !team?.id || metadataQuery.isLoading) {
            return;
        }

        if (hasExistingData) {
            setImportReturnTarget('workspace');
            setView('workspace');
            return;
        }

        if (user) {
            setImportReturnTarget('close');
            setView('import');
            return;
        }

        setView('landing');
    }, [autoOpen, hasExistingData, metadataQuery.isLoading, team?.id, user, view]);

    const handleCardClick = () => {
        if (!team?.id) return;
        if (hasExistingData) {
            setView('workspace');
        } else {
            setImportReturnTarget('landing');
            setView('import');
        }
    };

    const handleImportComplete = () => {
        setView('workspace');
    };

    const handleImportCancel = () => {
        if (importReturnTarget === 'workspace') {
            setView('workspace');
            return;
        }

        if (importReturnTarget === 'close') {
            onClose();
            return;
        }

        setView('landing');
    };

    const handleWorkspaceBack = () => {
        if (autoOpen) {
            onClose();
            return;
        }

        setView('landing');
    };

    if (!team) {
        return (
            <div className="h-full overflow-auto custom-scrollbar p-6">
                <div className="max-w-4xl mx-auto">
                    <div className="mb-6 text-center">
                        <h2 className="text-2xl font-bold text-gray-900 tracking-tight mb-2">Performance Dashboard</h2>
                        <p className="text-gray-500">Set up or join a team to continue.</p>
                    </div>
                    <TeamManagement onClose={onClose} />
                </div>
            </div>
        );
    }

    if (view === 'loading') {
        return <DashboardLoadingState label="Opening operations dashboard..." />;
    }

    if (view === 'import' && user) {
        return (
            <div className="h-full overflow-auto custom-scrollbar p-6">
                <Suspense fallback={<DashboardLoadingState label="Loading import tools..." />}>
                    <PerformanceImport
                        teamId={team.id}
                        userId={user.uid}
                        onImportComplete={handleImportComplete}
                        onCancel={handleImportCancel}
                    />
                </Suspense>
            </div>
        );
    }

    if (view === 'workspace') {
        if (metadataQuery.isLoading || !hasExistingData || dataQuery.isLoading || !dataQuery.data) {
            return <DashboardLoadingState label="Loading performance data..." />;
        }

        return (
            <div className="h-full overflow-auto custom-scrollbar p-6">
                <div className="max-w-7xl mx-auto">
                    <Suspense fallback={<DashboardLoadingState label="Loading dashboard..." />}>
                        <PerformanceWorkspace
                            data={dataQuery.data}
                            onReimport={() => {
                                setImportReturnTarget('workspace');
                                setView('import');
                            }}
                            onBack={handleWorkspaceBack}
                        />
                    </Suspense>
                </div>
            </div>
        );
    }

    return (
        <div className="h-full overflow-auto custom-scrollbar p-6">
            <div className="max-w-4xl mx-auto">
                <div className="mb-8">
                    <h2 className="text-2xl font-bold text-gray-900 tracking-tight mb-2">Performance Dashboard</h2>
                    <p className="text-gray-500">On-time performance, ridership, and load profiles from STREETS AVL/APC data.</p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    <button
                        onClick={handleCardClick}
                        className="group bg-white p-6 rounded-xl border border-gray-200 shadow-sm hover:shadow-md hover:border-cyan-300 transition-all text-left flex flex-col h-full active:scale-[0.99]"
                    >
                        <div className="flex items-center justify-between mb-4">
                            <div className="bg-cyan-50/50 p-2.5 rounded-lg text-cyan-600 group-hover:bg-cyan-100 transition-colors">
                                <Activity size={20} />
                            </div>
                            <div className="flex items-center gap-2">
                                {quickHealth && (
                                    <span
                                        className={`inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-bold rounded-full uppercase tracking-wide border ${
                                            quickHealth.status === 'healthy'
                                                ? 'bg-emerald-100 text-emerald-700 border-emerald-200'
                                                : quickHealth.status === 'warning'
                                                    ? 'bg-amber-100 text-amber-700 border-amber-200'
                                                    : 'bg-rose-100 text-rose-700 border-rose-200'
                                        }`}
                                    >
                                        {quickHealth.status === 'healthy' ? (
                                            <CheckCircle2 size={10} />
                                        ) : quickHealth.status === 'warning' ? (
                                            <AlertTriangle size={10} />
                                        ) : (
                                            <ShieldAlert size={10} />
                                        )}
                                        {quickHealth.label}
                                    </span>
                                )}
                                {hasExistingData && (
                                    <span className="px-2 py-0.5 bg-emerald-100 text-emerald-700 text-[10px] font-bold rounded-full uppercase tracking-wide">
                                        Data Loaded
                                    </span>
                                )}
                                {metadataQuery.isLoading && !hasExistingData && (
                                    <span className="px-2 py-0.5 bg-gray-100 text-gray-500 text-[10px] font-bold rounded-full uppercase tracking-wide">
                                        Checking…
                                    </span>
                                )}
                                <ArrowRight size={16} className="text-gray-300 group-hover:text-cyan-500 transition-colors" />
                            </div>
                        </div>
                        <h3 className="text-lg font-bold text-gray-900 mb-1">STREETS AVL Data</h3>
                        <p className="text-sm text-gray-500 leading-relaxed">
                            {hasExistingData
                                ? 'View OTP, ridership trends, and load profiles. Data updates daily.'
                                : 'Import AVL/APC data to view OTP, ridership trends, and load profiles by route.'}
                        </p>
                        {quickHealth && (
                            <p className={`mt-3 text-xs leading-relaxed ${
                                quickHealth.status === 'healthy'
                                    ? 'text-emerald-700'
                                    : quickHealth.status === 'warning'
                                        ? 'text-amber-700'
                                        : 'text-rose-700'
                            }`}>
                                {quickHealth.summary}
                            </p>
                        )}
                    </button>

                </div>
            </div>
        </div>
    );
};
