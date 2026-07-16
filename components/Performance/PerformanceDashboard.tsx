import React, { Suspense, useEffect, useMemo, useState } from 'react';
import { ArrowRight, Loader2, Activity, AlertTriangle, CheckCircle2, ShieldAlert } from 'lucide-react';
import { useTeam } from '../contexts/TeamContext';
import { useAuth } from '../contexts/AuthContext';
import { TeamManagement } from '../TeamManagement';
import {
    usePerformanceMetadataQuery,
    usePerformanceOverviewQuery,
} from '../../hooks/usePerformanceData';
import { lazyWithRetry } from '../../utils/lazyWithRetry';
import { buildPerformanceMetadataHealth } from '../../utils/performanceImportHealth';
import { useWorkspaceAccess } from '../../hooks/useWorkspaceAccess';
import {
    filterPerformanceSummaryByRoute,
    getAvailablePerformanceRoutes,
} from '../../utils/performanceRouteFilter';

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

const PerformanceWorkspaceLoading: React.FC<{
    importedAt?: string;
    dateRange?: { start: string; end: string };
    dayCount?: number;
}> = ({ importedAt, dateRange, dayCount }) => (
    <div className="rounded-3xl border-2 border-cyan-100 bg-gradient-to-br from-cyan-50 via-white to-amber-50 p-6 shadow-sm">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
            <div className="max-w-2xl">
                <div className="inline-flex items-center gap-2 rounded-full border border-cyan-200 bg-white/80 px-3 py-1 text-[11px] font-bold uppercase tracking-wide text-cyan-700">
                    <Loader2 size={12} className="animate-spin" />
                    Loading detailed dashboard data
                </div>
                <h3 className="mt-4 text-2xl font-bold text-gray-900">Operations dashboard is opening</h3>
                <p className="mt-2 text-sm leading-relaxed text-gray-600">
                    We already found the latest performance import. The full history file is loading in the background so the route, trip, and ridership views can open.
                </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-3 lg:min-w-[420px]">
                <div className="rounded-xl border border-gray-200 bg-white p-4">
                    <div className="text-[11px] font-bold uppercase tracking-wide text-gray-400">Latest import</div>
                    <div className="mt-2 text-sm font-semibold text-gray-900">
                        {importedAt
                            ? new Date(importedAt).toLocaleString('en-US', {
                                month: 'short',
                                day: 'numeric',
                                hour: 'numeric',
                                minute: '2-digit',
                            })
                            : 'Unknown'}
                    </div>
                </div>
                <div className="rounded-xl border border-gray-200 bg-white p-4">
                    <div className="text-[11px] font-bold uppercase tracking-wide text-gray-400">Date range</div>
                    <div className="mt-2 text-sm font-semibold text-gray-900">
                        {dateRange?.start && dateRange?.end ? `${dateRange.start} → ${dateRange.end}` : 'Unknown'}
                    </div>
                </div>
                <div className="rounded-xl border border-gray-200 bg-white p-4">
                    <div className="text-[11px] font-bold uppercase tracking-wide text-gray-400">Days available</div>
                    <div className="mt-2 text-sm font-semibold text-gray-900">
                        {typeof dayCount === 'number' ? dayCount.toLocaleString() : 'Unknown'}
                    </div>
                </div>
            </div>
        </div>
    </div>
);

export const PerformanceDashboard: React.FC<PerformanceDashboardProps> = ({ onClose, autoOpen = false }) => {
    const { team, canManageTeam } = useTeam();
    const { user } = useAuth();
    const { canAccess } = useWorkspaceAccess();
    const [view, setView] = useState<PerformanceView>(() => (autoOpen ? 'loading' : 'landing'));
    const [importReturnTarget, setImportReturnTarget] = useState<ImportReturnTarget>(() => (autoOpen ? 'close' : 'landing'));
    const [selectedRouteId, setSelectedRouteId] = useState<string>('all');
    const performanceDataTeamId = team?.dataSourceTeamIds?.performance || team?.id;
    const usesSharedPerformanceData = !!team?.dataSourceTeamIds?.performance && team.dataSourceTeamIds.performance !== team.id;

    const metadataQuery = usePerformanceMetadataQuery(performanceDataTeamId, team?.id);
    const hasExistingData = metadataQuery.data != null;
    const shouldLoadOverviewData = hasExistingData && (view === 'landing' || view === 'workspace' || (autoOpen && view === 'loading'));
    const overviewQuery = usePerformanceOverviewQuery(performanceDataTeamId, shouldLoadOverviewData, metadataQuery.data, team?.id);
    const routeOptions = useMemo(
        () => getAvailablePerformanceRoutes(overviewQuery.data),
        [overviewQuery.data],
    );
    const scopedOverviewData = useMemo(
        () => filterPerformanceSummaryByRoute(overviewQuery.data, selectedRouteId),
        [overviewQuery.data, selectedRouteId],
    );
    const quickHealth = useMemo(
        () => buildPerformanceMetadataHealth(metadataQuery.data),
        [metadataQuery.data],
    );
    const canSeeAdvancedOperationsTabs = canAccess('operationsLoadProfiles') || canAccess('operationsOperatorDwell');
    const dashboardDescription = canSeeAdvancedOperationsTabs
        ? 'On-time performance, ridership, and load profiles from STREETS AVL/APC data.'
        : 'On-time performance and ridership from STREETS AVL/APC data.';

    useEffect(() => {
        setView(autoOpen ? 'loading' : 'landing');
        setImportReturnTarget(autoOpen ? 'close' : 'landing');
        setSelectedRouteId('all');
    }, [team?.id, performanceDataTeamId, autoOpen]);

    useEffect(() => {
        if (selectedRouteId === 'all') return;
        if (routeOptions.some(route => route.routeId === selectedRouteId)) return;
        setSelectedRouteId('all');
    }, [routeOptions, selectedRouteId]);

    useEffect(() => {
        if (!autoOpen || view !== 'loading' || !team?.id || metadataQuery.isLoading) {
            return;
        }

        if (hasExistingData) {
            setImportReturnTarget('workspace');
            setView('workspace');
            return;
        }

        if (user && canManageTeam && !usesSharedPerformanceData) {
            setImportReturnTarget('close');
            setView('import');
            return;
        }

        setView('landing');
    }, [autoOpen, canManageTeam, hasExistingData, metadataQuery.isLoading, team?.id, user, usesSharedPerformanceData, view]);

    const handleCardClick = () => {
        if (!team?.id) return;
        if (hasExistingData) {
            setView('workspace');
        } else if (canManageTeam && !usesSharedPerformanceData) {
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

    if (view === 'import' && user && canManageTeam) {
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
        if (metadataQuery.isLoading || !hasExistingData) {
            return <DashboardLoadingState label="Loading performance data..." />;
        }

        const workspaceData = scopedOverviewData;

        return (
            <div className="h-full overflow-auto custom-scrollbar p-6">
                <div className="max-w-7xl mx-auto">
                    {workspaceData ? (
                        <Suspense fallback={<DashboardLoadingState label="Loading dashboard..." />}>
                            <PerformanceWorkspace
                                data={workspaceData}
                                teamId={performanceDataTeamId}
                                requestingTeamId={team.id}
                                metadata={metadataQuery.data}
                                selectedRouteId={selectedRouteId}
                                routeOptions={routeOptions}
                                onRouteChange={setSelectedRouteId}
                                canReimport={canManageTeam && !usesSharedPerformanceData}
                                onReimport={() => {
                                    if (usesSharedPerformanceData || !canManageTeam) return;
                                    setImportReturnTarget('workspace');
                                    setView('import');
                                }}
                                onBack={handleWorkspaceBack}
                            />
                        </Suspense>
                    ) : (
                        <PerformanceWorkspaceLoading
                            importedAt={metadataQuery.data.importedAt}
                            dateRange={metadataQuery.data.dateRange}
                            dayCount={metadataQuery.data.dayCount}
                        />
                    )}
                </div>
            </div>
        );
    }

    return (
        <div className="h-full overflow-auto custom-scrollbar p-6">
            <div className="max-w-4xl mx-auto">
                <div className="mb-8">
                    <h2 className="text-2xl font-bold text-gray-900 tracking-tight mb-2">Performance Dashboard</h2>
                    <p className="text-gray-500">{dashboardDescription}</p>
                </div>

                {hasExistingData && (
                    <div className="mb-5 rounded-xl border border-cyan-100 bg-white p-4 shadow-sm">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                            <div>
                                <div className="text-sm font-bold text-gray-900">Load scope</div>
                                <p className="text-xs text-gray-500">
                                    Default loads all routes. Pick one route first to open a lighter route-focused dashboard.
                                </p>
                            </div>
                            <select
                                value={selectedRouteId}
                                onChange={(event) => setSelectedRouteId(event.target.value)}
                                className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-700 shadow-sm focus:border-cyan-400 focus:outline-none focus:ring-2 focus:ring-cyan-100"
                                disabled={overviewQuery.isLoading || routeOptions.length === 0}
                            >
                                <option value="all">All routes</option>
                                {routeOptions.map(route => (
                                    <option key={route.routeId} value={route.routeId}>
                                        Route {route.routeId}{route.routeName ? ` — ${route.routeName}` : ''}
                                    </option>
                                ))}
                            </select>
                        </div>
                    </div>
                )}

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
                                ? canSeeAdvancedOperationsTabs
                                    ? 'View OTP, ridership trends, and load profiles. Data updates daily.'
                                    : 'View OTP and ridership trends. Data updates daily.'
                                : canSeeAdvancedOperationsTabs
                                    ? 'Import AVL/APC data to view OTP, ridership trends, and load profiles by route.'
                                    : 'Import AVL/APC data to view OTP and ridership trends by route.'}
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
