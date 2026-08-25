/**
 * Analytics Dashboard
 *
 * Landing page for the Analytics section with cards for different analysis tools.
 * Routes to TransitApp, OD Matrix, and future analysis workspaces.
 */

import React, { Suspense, useState, useEffect, useCallback } from 'react';
import { Map, ArrowRight, Loader2, Smartphone, Network, GraduationCap, Route, Bus, Building2, GitBranch, Ticket } from 'lucide-react';
import { useTeam } from '../contexts/TeamContext';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { getTransitAppData, getTransitAppMetadata } from '../../utils/transit-app/transitAppService';
import { getODMatrixData, getODMatrixMetadata, loadGeocodeCache, setActiveODMatrixImport } from '../../utils/od-matrix/odMatrixService';
import { getFleetPlanMetadata, getFleetPlanWorkbook, isFleetPlanPermissionError } from '../../utils/fleet-plan/fleetPlanService';
import { getResidentialGrowthDataset, getResidentialGrowthMetadata } from '../../utils/residential-growth/service';
import { TeamManagement } from '../TeamManagement';
import { usePerformanceMetadataQuery } from '../../hooks/usePerformanceData';
import { useWorkspaceAccess } from '../../hooks/useWorkspaceAccess';
import type { FeatureKey } from '../../utils/features';
import { isFeatureUnderConstruction } from '../../utils/features';
import {
    buildAnalyticsWorkspaceHash,
    type AnalyticsWorkspaceView,
} from '../../utils/workspaces/analyticsWorkspaceRouting';
import type { TransitAppDataSummary } from '../../utils/transit-app/transitAppTypes';
import type { ODMatrixDataSummary, GeocodeCache } from '../../utils/od-matrix/odMatrixTypes';
import type { FleetPlanWorkbook } from '../../utils/fleet-plan/types';
import type { ResidentialGrowthMonthlyDataset } from '../../utils/residential-growth/types';
import { lazyWithRetry } from '../../utils/lazyWithRetry';

const TransitAppImport = lazyWithRetry(
    () => import('./TransitAppImport').then(module => ({ default: module.TransitAppImport })),
    'analytics-transit-app-import'
);
const TransitAppWorkspace = lazyWithRetry(
    () => import('./TransitAppWorkspace').then(module => ({ default: module.TransitAppWorkspace })),
    'analytics-transit-app-workspace'
);
const ODMatrixImport = lazyWithRetry(
    () => import('./ODMatrixImport').then(module => ({ default: module.ODMatrixImport })),
    'analytics-od-matrix-import'
);
const ODMatrixWorkspace = lazyWithRetry(
    () => import('./ODMatrixWorkspace').then(module => ({ default: module.ODMatrixWorkspace })),
    'analytics-od-matrix-workspace'
);
const ODCoordinateEditor = lazyWithRetry(
    () => import('./ODCoordinateEditor').then(module => ({ default: module.ODCoordinateEditor })),
    'analytics-od-coordinate-editor'
);
const HeadwayMap = lazyWithRetry(
    () => import('../Mapping/HeadwayMap').then(module => ({ default: module.HeadwayMap })),
    'analytics-headway-map'
);
const CorridorSpeedMap = lazyWithRetry(
    () => import('../Mapping/CorridorSpeedMap').then(module => ({ default: module.CorridorSpeedMap })),
    'analytics-corridor-speed-map'
);
const StudentPassModule = lazyWithRetry(
    () => import('./StudentPassModule').then(module => ({ default: module.StudentPassModule })),
    'analytics-student-pass-module'
);
const FleetPlanImport = lazyWithRetry(
    () => import('./FleetPlanImport').then(module => ({ default: module.FleetPlanImport })),
    'analytics-fleet-plan-import'
);
const FleetPlanWorkspace = lazyWithRetry(
    () => import('./FleetPlanWorkspace').then(module => ({ default: module.FleetPlanWorkspace })),
    'analytics-fleet-plan-workspace'
);
const ResidentialGrowthWorkspace = lazyWithRetry(
    () => import('./ResidentialGrowthWorkspace').then(module => ({ default: module.ResidentialGrowthWorkspace })),
    'analytics-residential-growth-workspace'
);
const ShuttlePlannerWorkspace = lazyWithRetry(
    () => import('./ShuttlePlannerWorkspace').then(module => ({ default: module.ShuttlePlannerWorkspace })),
    'analytics-shuttle-planner-workspace'
);
const RoutePlanner2Workspace = lazyWithRetry(
    () => import('./RoutePlanner2Workspace').then(module => ({ default: module.RoutePlanner2Workspace })),
    'analytics-route-planner-2-workspace'
);
const RouteConceptPlannerWorkspace = lazyWithRetry(
    () => import('./RouteConceptPlannerWorkspace').then(module => ({ default: module.RouteConceptPlannerWorkspace })),
    'analytics-route-concept-planner-workspace'
);
const NetworkConnectionsWorkspace = lazyWithRetry(
    () => import('./NetworkConnectionsWorkspace').then(module => ({ default: module.NetworkConnectionsWorkspace })),
    'analytics-network-connections-workspace'
);
const FareProgramsWorkspace = lazyWithRetry(
    () => import('./FareProgramsWorkspace').then(module => ({ default: module.FareProgramsWorkspace })),
    'analytics-fare-programs-workspace'
);

interface AnalyticsCardProps {
    color: 'cyan' | 'violet' | 'teal' | 'amber';
    icon: React.ReactNode;
    title: string;
    description: string;
    hasData: boolean;
    underConstruction?: boolean;
    onClick: () => void;
}

const cardStyles = {
    cyan: {
        hover: 'hover:border-cyan-300',
        bg: 'bg-cyan-50/50 text-cyan-600 group-hover:bg-cyan-100',
        arrow: 'group-hover:text-cyan-500',
    },
    violet: {
        hover: 'hover:border-violet-300',
        bg: 'bg-violet-50/50 text-violet-600 group-hover:bg-violet-100',
        arrow: 'group-hover:text-violet-500',
    },
    teal: {
        hover: 'hover:border-teal-300',
        bg: 'bg-teal-50/50 text-teal-600 group-hover:bg-teal-100',
        arrow: 'group-hover:text-teal-500',
    },
    amber: {
        hover: 'hover:border-amber-300',
        bg: 'bg-amber-50/50 text-amber-600 group-hover:bg-amber-100',
        arrow: 'group-hover:text-amber-500',
    },
};

const AnalyticsCard: React.FC<AnalyticsCardProps> = ({ color, icon, title, description, hasData, underConstruction = false, onClick }) => {
    const s = cardStyles[color];
    return (
        <button
            onClick={onClick}
            className={`group bg-white p-6 rounded-xl border border-gray-200 shadow-sm hover:shadow-md ${s.hover} transition-all text-left flex flex-col h-full active:scale-[0.99]`}
        >
            <div className="flex items-center justify-between mb-4">
                <div className={`p-2.5 rounded-lg transition-colors ${s.bg}`}>
                    {icon}
                </div>
                <div className="flex items-center gap-2">
                    {underConstruction && (
                        <span className="px-2 py-0.5 bg-amber-100 text-amber-700 text-[10px] font-semibold rounded-full">
                            Under Construction
                        </span>
                    )}
                    {hasData && (
                        <span className="px-2 py-0.5 bg-emerald-100 text-emerald-700 text-[10px] font-semibold rounded-full">
                            Data Loaded
                        </span>
                    )}
                    <ArrowRight size={16} className={`text-gray-300 ${s.arrow} transition-colors`} />
                </div>
            </div>
            <h3 className="text-lg font-bold text-gray-900 mb-1">{title}</h3>
            <p className="text-sm text-gray-500 leading-relaxed">{description}</p>
        </button>
    );
};

interface AnalyticsDashboardProps {
    onClose: () => void;
    initialView?: AnalyticsWorkspaceView;
    routePrefix?: string;
}

type AnalyticsView = AnalyticsWorkspaceView;

const ANALYTICS_VIEW_FEATURES: Partial<Record<AnalyticsView, FeatureKey>> = {
    import: 'analyticsTransitApp',
    'transit-data': 'analyticsTransitApp',
    'od-import': 'analyticsOdMatrix',
    'od-fix-coords': 'analyticsOdMatrix',
    'od-workspace': 'analyticsOdMatrix',
    'headway-map': 'analyticsCorridorHeadway',
    'corridor-speed': 'analyticsCorridorSpeed',
    'student-pass': 'analyticsStudentPass',
    'fleet-plan-import': 'analyticsFleetPlan',
    'fleet-plan-workspace': 'analyticsFleetPlan',
    'residential-growth': 'analyticsResidentialGrowth',
    'route-planner-2': 'analyticsRoutePlanner2',
    'route-concept-planner': 'analyticsRouteConceptPlanner',
    'network-connections': 'analyticsNetworkConnections',
    'shuttle-planner': 'analyticsShuttlePlanner',
    'fare-programs': 'analyticsFarePrograms',
};

const AnalyticsFeatureNotice: React.FC<{ feature: Parameters<typeof isFeatureUnderConstruction>[0] }> = ({ feature }) => {
    if (!isFeatureUnderConstruction(feature)) return null;

    return (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <div className="font-semibold">Under construction</div>
            <div className="mt-1 text-amber-800">
                This feature is available in demo mode for preview, but it is still being refined and may change.
            </div>
        </div>
    );
};

const AnalyticsPanelLoading: React.FC<{ label?: string }> = ({ label = 'Loading analytics module...' }) => (
    <div className="flex h-full items-center justify-center">
        <div className="flex flex-col items-center gap-3 text-gray-500">
            <Loader2 className="text-cyan-500 animate-spin" size={32} />
            <span className="text-sm font-medium">{label}</span>
        </div>
    </div>
);

export const AnalyticsDashboard: React.FC<AnalyticsDashboardProps> = ({ onClose, initialView = 'dashboard', routePrefix }) => {
    const { team } = useTeam();
    const { user } = useAuth();
    const toast = useToast();
    const [view, setView] = useState<AnalyticsView>('dashboard');
    const [transitData, setTransitData] = useState<TransitAppDataSummary | null>(null);
    const [odData, setOdData] = useState<ODMatrixDataSummary | null>(null);
    const [odGeocodeCache, setOdGeocodeCache] = useState<GeocodeCache | null>(null);
    const [fleetPlanData, setFleetPlanData] = useState<FleetPlanWorkbook | null>(null);
    const [residentialGrowthData, setResidentialGrowthData] = useState<ResidentialGrowthMonthlyDataset | null>(null);
    const [loading, setLoading] = useState(true);
    const [hasExistingData, setHasExistingData] = useState(false);
    const [hasODData, setHasODData] = useState(false);
    const [hasFleetPlanData, setHasFleetPlanData] = useState(false);
    const [hasResidentialGrowthData, setHasResidentialGrowthData] = useState(false);
    const transitAppDataTeamId = team?.dataSourceTeamIds?.transitApp || team?.id;
    const performanceDataTeamId = team?.dataSourceTeamIds?.performance || team?.id;
    const usesSharedTransitAppData = !!team?.dataSourceTeamIds?.transitApp && team.dataSourceTeamIds.transitApp !== team.id;
    const performanceMetadataQuery = usePerformanceMetadataQuery(performanceDataTeamId, team?.id);
    const hasPerformanceData = !!performanceMetadataQuery.data;
    const { canAccess, loading: accessLoading } = useWorkspaceAccess();
    const initialViewHandledRef = React.useRef(false);

    const canAccessAnalyticsView = useCallback((nextView: AnalyticsView): boolean => {
        const feature = ANALYTICS_VIEW_FEATURES[nextView];
        return feature ? canAccess(feature) : true;
    }, [canAccess]);

    useEffect(() => {
        if (view !== 'dashboard' && !canAccessAnalyticsView(view)) {
            setView('dashboard');
        }
    }, [view, canAccessAnalyticsView]);

    // Check for existing data on mount
    useEffect(() => {
        if (!team?.id) {
            setLoading(false);
            return;
        }
        (async () => {
            try {
                const canReadTransitApp = canAccess('analyticsTransitApp');
                const canReadODMatrix = canAccess('analyticsOdMatrix');
                const canReadFleetPlan = canAccess('analyticsFleetPlan');
                const canReadResidentialGrowth = canAccess('analyticsResidentialGrowth');
                const [transitMeta, odMeta, fleetPlanMeta, residentialGrowthMeta] = await Promise.all([
                    canReadTransitApp && transitAppDataTeamId ? getTransitAppMetadata(transitAppDataTeamId, team.id) : Promise.resolve(null),
                    canReadODMatrix ? getODMatrixMetadata(team.id) : Promise.resolve(null),
                    canReadFleetPlan ? getFleetPlanMetadata(team.id) : Promise.resolve(null),
                    canReadResidentialGrowth ? getResidentialGrowthMetadata(team.id) : Promise.resolve(null),
                ]);
                setHasExistingData(!!transitMeta);
                setHasODData(!!odMeta);
                setHasFleetPlanData(!!fleetPlanMeta);
                setHasResidentialGrowthData(!!residentialGrowthMeta);
            } catch (error) {
                console.error('Error checking analytics data:', error);
            } finally {
                setLoading(false);
            }
        })();
    }, [team?.id, transitAppDataTeamId, canAccess]);

    // Handle clicking the Transit App Data card
    const handleTransitAppClick = async () => {
        if (!team?.id || !transitAppDataTeamId) return;

        if (hasExistingData) {
            // Load full data and show dashboard
            setLoading(true);
            try {
                const data = await getTransitAppData(transitAppDataTeamId, team.id);
                if (data) {
                    setTransitData(data);
                    setView('transit-data');
                } else {
                    // Data disappeared — show import
                    setHasExistingData(false);
                    setView(usesSharedTransitAppData ? 'dashboard' : 'import');
                }
            } catch (error) {
                console.error('Error loading transit app data:', error);
            } finally {
                setLoading(false);
            }
        } else if (!usesSharedTransitAppData) {
            setView('import');
        }
    };

    // Handle import complete — load data and switch to dashboard
    const handleImportComplete = async () => {
        if (!team?.id || !transitAppDataTeamId) return;
        setLoading(true);
        try {
            const data = await getTransitAppData(transitAppDataTeamId, team.id);
            if (data) {
                setTransitData(data);
                setHasExistingData(true);
                setView('transit-data');
            }
        } catch (error) {
            console.error('Error loading imported data:', error);
        } finally {
            setLoading(false);
        }
    };

    const loadODData = async (opts: { fallbackToImport?: boolean; markAsLoaded?: boolean; importId?: string }) => {
        if (!team?.id) return;
        setLoading(true);
        try {
            if (opts.importId) {
                await setActiveODMatrixImport(team.id, opts.importId);
            }

            const [loadedData, cache] = await Promise.all([
                getODMatrixData(team.id),
                loadGeocodeCache(team.id),
            ]);
            if (loadedData) {
                setOdData(loadedData);
                setOdGeocodeCache(cache);
                if (opts.markAsLoaded || opts.importId) setHasODData(true);
                setView('od-workspace');
            } else if (opts.fallbackToImport) {
                setHasODData(false);
                setView('od-import');
            }
        } catch (error) {
            console.error('Error loading OD matrix data:', error);
            if (opts.fallbackToImport) {
                setHasODData(false);
                setView('od-import');
            }
        } finally {
            setLoading(false);
        }
    };

    const handleODMatrixClick = async () => {
        if (hasODData) { await loadODData({ fallbackToImport: true }); }
        else { setView('od-import'); }
    };

    const handleODImportComplete = () => loadODData({ markAsLoaded: true });
    const handleODFixCoordinates = () => setView('od-fix-coords');

    const handleSwitchImport = (importId: string) =>
        loadODData({ importId, fallbackToImport: true });

    const handleDeletedImport = (_deletedId: string, result: string | null | 'unchanged') => {
        if (result === 'unchanged') {
            // Defensive fallback for any out-of-sync active state.
            if (odData?.metadata.importId === _deletedId) {
                loadODData({ fallbackToImport: true });
            }
            return;
        }
        if (result !== null) {
            loadODData({ importId: result, fallbackToImport: true });
        } else {
            setOdData(null);
            setHasODData(false);
            setView('od-import');
        }
    };

    const loadFleetPlan = async (opts: { fallbackToImport?: boolean } = {}) => {
        if (!team?.id) return;
        setLoading(true);
        try {
            const workbook = await getFleetPlanWorkbook(team.id);
            if (workbook) {
                setFleetPlanData(workbook);
                setHasFleetPlanData(true);
                setView('fleet-plan-workspace');
            } else if (opts.fallbackToImport) {
                setHasFleetPlanData(false);
                setView('fleet-plan-import');
            }
        } catch (error) {
            console.error('Error loading Fleet Plan data:', error);
            toast?.error(
                'Fleet Plan unavailable',
                error instanceof Error ? error.message : 'Failed to load Fleet Plan.',
            );
            if (opts.fallbackToImport && !isFleetPlanPermissionError(error)) {
                setHasFleetPlanData(false);
                setView('fleet-plan-import');
            }
        } finally {
            setLoading(false);
        }
    };

    const handleFleetPlanClick = async () => {
        if (hasFleetPlanData) {
            await loadFleetPlan({ fallbackToImport: true });
        } else {
            setView('fleet-plan-import');
        }
    };

    const handleResidentialGrowthClick = async () => {
        if (!team?.id) return;
        setLoading(true);
        try {
            const loaded = await getResidentialGrowthDataset(team.id);
            setResidentialGrowthData(loaded);
            setHasResidentialGrowthData(!!loaded);
            setView('residential-growth');
        } catch (error) {
            console.error('Error loading Residential Growth data:', error);
            toast?.error('Residential Growth unavailable', error instanceof Error ? error.message : 'Failed to load Residential Growth.');
            setResidentialGrowthData(null);
            setView('residential-growth');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (initialViewHandledRef.current || loading || accessLoading) return;
        initialViewHandledRef.current = true;

        if (!canAccessAnalyticsView(initialView)) {
            setView('dashboard');
            return;
        }

        if (initialView === 'transit-data') {
            void handleTransitAppClick();
            return;
        }

        if (initialView === 'fleet-plan-workspace') {
            void handleFleetPlanClick();
            return;
        }

        setView(initialView);
    }, [accessLoading, canAccessAnalyticsView, handleFleetPlanClick, handleTransitAppClick, initialView, loading]);

    useEffect(() => {
        if (!routePrefix || loading || accessLoading || !initialViewHandledRef.current) return;

        const nextHash = buildAnalyticsWorkspaceHash(routePrefix, view);
        if (window.location.hash !== nextHash) {
            window.location.hash = nextHash;
        }
    }, [accessLoading, loading, routePrefix, view]);

    // No team guard: show direct team setup instead of a dead-end message.
    if (!team) {
        return (
            <div className="h-full overflow-auto custom-scrollbar p-6">
                <div className="max-w-4xl mx-auto">
                    <div className="mb-6 text-center">
                        <h2 className="text-2xl font-bold text-gray-900 tracking-tight mb-2">Analytics</h2>
                        <p className="text-gray-500">Set up or join a team to continue.</p>
                    </div>
                    <TeamManagement onClose={onClose} />
                </div>
            </div>
        );
    }

    // Loading state
    if (loading || accessLoading) {
        return (
            <div className="h-full flex items-center justify-center">
                <Loader2 className="text-cyan-500 animate-spin" size={32} />
            </div>
        );
    }

    // Transit App import view
    if (view === 'import' && user) {
        return (
            <div className="h-full overflow-auto custom-scrollbar p-6">
                <Suspense fallback={<AnalyticsPanelLoading label="Loading Transit App import..." />}>
                    <TransitAppImport
                        teamId={team.id}
                        userId={user.uid}
                        onImportComplete={handleImportComplete}
                        onCancel={() => setView('dashboard')}
                    />
                </Suspense>
            </div>
        );
    }

    // Transit data workspace view
    if (view === 'transit-data' && transitData) {
        return (
            <div className="h-full overflow-auto custom-scrollbar p-6">
                <div className="max-w-7xl mx-auto">
                    <AnalyticsFeatureNotice feature="analyticsTransitApp" />
                    <Suspense fallback={<AnalyticsPanelLoading label="Loading Transit App workspace..." />}>
                        <TransitAppWorkspace
                            data={transitData}
                            onReimport={() => setView(usesSharedTransitAppData ? 'dashboard' : 'import')}
                            onBack={() => setView('dashboard')}
                        />
                    </Suspense>
                </div>
            </div>
        );
    }

    // OD Matrix import view
    if (view === 'od-import' && user) {
        return (
            <div className="h-full overflow-auto custom-scrollbar p-6">
                <Suspense fallback={<AnalyticsPanelLoading label="Loading OD matrix import..." />}>
                    <ODMatrixImport
                        teamId={team.id}
                        userId={user.uid}
                        onImportComplete={handleODImportComplete}
                        onCancel={() => setView('dashboard')}
                    />
                </Suspense>
            </div>
        );
    }

    // OD Matrix workspace view
    if (view === 'od-workspace' && odData) {
        return (
            <div className="h-full overflow-auto custom-scrollbar p-6">
                <div className="max-w-7xl mx-auto">
                    <AnalyticsFeatureNotice feature="analyticsOdMatrix" />
                    <Suspense fallback={<AnalyticsPanelLoading label="Loading OD matrix workspace..." />}>
                        <ODMatrixWorkspace
                            key={odData.metadata.importId ?? 'default'}
                            data={odData}
                            geocodeCache={odGeocodeCache}
                            teamId={team.id}
                            onReimport={() => setView('od-import')}
                            onFixCoordinates={handleODFixCoordinates}
                            onBack={() => setView('dashboard')}
                            onSwitchImport={handleSwitchImport}
                            onDeletedImport={handleDeletedImport}
                        />
                    </Suspense>
                </div>
            </div>
        );
    }

    // OD coordinate editor (no file re-upload)
    if (view === 'od-fix-coords' && user && odData) {
        return (
            <Suspense fallback={<AnalyticsPanelLoading label="Loading coordinate editor..." />}>
                <ODCoordinateEditor
                    teamId={team.id}
                    userId={user.uid}
                    data={odData}
                    geocodeCache={odGeocodeCache}
                    onComplete={() => loadODData({ markAsLoaded: true })}
                    onCancel={() => setView('od-workspace')}
                />
            </Suspense>
        );
    }

    // Student Transit Pass
    if (view === 'student-pass') {
        return (
            <div className="flex h-full flex-col overflow-hidden">
                <div className="px-6 pt-6 shrink-0">
                    <AnalyticsFeatureNotice feature="analyticsStudentPass" />
                </div>
                <div className="min-h-0 flex-1 overflow-hidden">
                    <Suspense fallback={<AnalyticsPanelLoading label="Loading student pass tools..." />}>
                        <StudentPassModule onBack={() => setView('dashboard')} teamId={performanceDataTeamId ?? team.id} accessTeamId={team.id} />
                    </Suspense>
                </div>
            </div>
        );
    }

    if (view === 'fleet-plan-import' && user) {
        return (
            <div className="h-full overflow-auto custom-scrollbar p-6 bg-[#F7F7F7]">
                <AnalyticsFeatureNotice feature="analyticsFleetPlan" />
                <Suspense fallback={<AnalyticsPanelLoading label="Loading Fleet Plan import..." />}>
                    <FleetPlanImport
                        teamId={team.id}
                        userId={user.uid}
                        currentVersion={fleetPlanData?.metadata.currentVersion}
                        onImportComplete={(workbook) => {
                            setFleetPlanData(workbook);
                            setHasFleetPlanData(true);
                            setView('fleet-plan-workspace');
                        }}
                        onCancel={() => setView('dashboard')}
                    />
                </Suspense>
            </div>
        );
    }

    if (view === 'fleet-plan-workspace' && fleetPlanData && user) {
        return (
            <div className="h-full overflow-auto custom-scrollbar p-6 bg-[#F7F7F7]">
                <AnalyticsFeatureNotice feature="analyticsFleetPlan" />
                <Suspense fallback={<AnalyticsPanelLoading label="Loading Fleet Plan workspace..." />}>
                    <FleetPlanWorkspace
                        data={fleetPlanData}
                        teamId={team.id}
                        userId={user.uid}
                        onBack={() => setView('dashboard')}
                        onReimport={() => setView('fleet-plan-import')}
                        onSaved={(workbook) => setFleetPlanData(workbook)}
                    />
                </Suspense>
            </div>
        );
    }

    if (view === 'residential-growth' && user) {
        return (
            <div className="flex h-full flex-col overflow-hidden">
                <div className="px-6 pt-6 shrink-0">
                    <AnalyticsFeatureNotice feature="analyticsResidentialGrowth" />
                </div>
                <div className="min-h-0 flex-1 overflow-hidden">
                    <Suspense fallback={<AnalyticsPanelLoading label="Loading Residential Growth map..." />}>
                        <ResidentialGrowthWorkspace
                            data={residentialGrowthData}
                            teamId={team.id}
                            userId={user.uid}
                            onBack={() => setView('dashboard')}
                            onSaved={(dataset) => {
                                setResidentialGrowthData(dataset);
                                setHasResidentialGrowthData(true);
                            }}
                        />
                    </Suspense>
                </div>
            </div>
        );
    }

    // Corridor Headway Map
    if (view === 'headway-map') {
        return (
            <div className="flex h-full flex-col overflow-hidden">
                <div className="px-6 pt-6 shrink-0">
                    <AnalyticsFeatureNotice feature="analyticsCorridorHeadway" />
                </div>
                <div className="min-h-0 flex-1 overflow-hidden">
                    <Suspense fallback={<AnalyticsPanelLoading label="Loading headway map..." />}>
                        <HeadwayMap onBack={() => setView('dashboard')} />
                    </Suspense>
                </div>
            </div>
        );
    }

    if (view === 'corridor-speed') {
        return (
            <div className="flex h-full flex-col overflow-hidden">
                <div className="px-6 pt-6 shrink-0">
                    <AnalyticsFeatureNotice feature="analyticsCorridorSpeed" />
                </div>
                <div className="min-h-0 flex-1 overflow-hidden">
                    <Suspense fallback={<AnalyticsPanelLoading label="Loading Corridor Performance..." />}>
                        <CorridorSpeedMap onBack={() => setView('dashboard')} teamId={performanceDataTeamId ?? team.id} accessTeamId={team.id} />
                    </Suspense>
                </div>
            </div>
        );
    }

    if (view === 'route-planner-2') {
        return (
            <div className="flex h-full flex-col overflow-hidden">
                <div className="px-6 pt-6 shrink-0">
                    <AnalyticsFeatureNotice feature="analyticsRoutePlanner2" />
                </div>
                <div className="min-h-0 flex-1 overflow-hidden">
                    <Suspense fallback={<AnalyticsPanelLoading label="Loading Camp Shuttle Planner..." />}>
                        <RoutePlanner2Workspace
                            onBack={() => setView('dashboard')}
                            userId={user?.uid ?? null}
                            teamId={team.id}
                        />
                    </Suspense>
                </div>
            </div>
        );
    }

    if (view === 'route-concept-planner') {
        return (
            <div className="flex h-full flex-col overflow-hidden">
                <div className="px-6 pt-6 shrink-0">
                    <AnalyticsFeatureNotice feature="analyticsRouteConceptPlanner" />
                </div>
                <div className="min-h-0 flex-1 overflow-hidden">
                    <Suspense fallback={<AnalyticsPanelLoading label="Loading Route Concept Planner..." />}>
                        <RouteConceptPlannerWorkspace
                            onBack={() => setView('dashboard')}
                            userId={user?.uid ?? null}
                            teamId={team.id}
                        />
                    </Suspense>
                </div>
            </div>
        );
    }

    if (view === 'network-connections') {
        return (
            <div className="flex h-full flex-col overflow-hidden">
                <div className="px-6 pt-6 shrink-0">
                    <AnalyticsFeatureNotice feature="analyticsNetworkConnections" />
                </div>
                <div className="min-h-0 flex-1 overflow-hidden">
                    <Suspense fallback={<AnalyticsPanelLoading label="Loading network connections..." />}>
                        <NetworkConnectionsWorkspace
                            onBack={() => setView('dashboard')}
                            teamId={team.id}
                            userId={user?.uid ?? null}
                            observedTransitData={transitData}
                        />
                    </Suspense>
                </div>
            </div>
        );
    }

    if (view === 'shuttle-planner') {
        return (
            <div className="flex h-full flex-col overflow-hidden">
                <div className="px-6 pt-6 shrink-0">
                    <AnalyticsFeatureNotice feature="analyticsShuttlePlanner" />
                </div>
                <div className="min-h-0 flex-1 overflow-hidden">
                    <Suspense fallback={<AnalyticsPanelLoading label="Loading shuttle planner..." />}>
                        <ShuttlePlannerWorkspace
                            onBack={() => setView('dashboard')}
                            userId={user?.uid ?? null}
                            teamId={team.id}
                        />
                    </Suspense>
                </div>
            </div>
        );
    }

    if (view === 'fare-programs') {
        return (
            <div className="flex h-full flex-col overflow-hidden">
                <div className="px-6 pt-6 shrink-0">
                    <AnalyticsFeatureNotice feature="analyticsFarePrograms" />
                </div>
                <div className="min-h-0 flex-1 overflow-hidden">
                    <Suspense fallback={<AnalyticsPanelLoading label="Loading Fare Programs..." />}>
                        <FareProgramsWorkspace onBack={() => setView('dashboard')} />
                    </Suspense>
                </div>
            </div>
        );
    }

    // Main dashboard with cards
    return (
        <div className="h-full overflow-auto custom-scrollbar p-6">
            <div className="max-w-4xl mx-auto">
                <div className="mb-8">
                    <h2 className="text-2xl font-bold text-gray-900 tracking-tight mb-2">Analytics</h2>
                    <p className="text-gray-500">Analyze rider demand, route performance, and connections.</p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {canAccess('analyticsTransitApp') && (
                        <AnalyticsCard
                            color="cyan"
                            icon={<Smartphone size={20} />}
                            title="Transit App Data"
                            description="Import and analyze rider demand, trip patterns, and route engagement from Transit App."
                            hasData={hasExistingData}
                            underConstruction={isFeatureUnderConstruction('analyticsTransitApp')}
                            onClick={handleTransitAppClick}
                        />
                    )}
                    {canAccess('analyticsOdMatrix') && (
                        <AnalyticsCard
                            color="violet"
                            icon={<Network size={20} />}
                            title="Agency OD Analysis"
                            description="Import origin-destination ridership matrices, visualize agency travel patterns, and analyze station connectivity."
                            hasData={hasODData}
                            underConstruction={isFeatureUnderConstruction('analyticsOdMatrix')}
                            onClick={handleODMatrixClick}
                        />
                    )}
                    {canAccess('analyticsCorridorSpeed') && (
                        <AnalyticsCard
                            color="teal"
                            icon={<Map size={20} />}
                            title="Corridor Performance"
                            description="Find runtime pressure and reliability by corridor with visible STREETS and GTFS evidence quality."
                            hasData={hasPerformanceData}
                            underConstruction={isFeatureUnderConstruction('analyticsCorridorSpeed')}
                            onClick={() => setView('corridor-speed')}
                        />
                    )}
                    {canAccess('analyticsCorridorHeadway') && (
                        <AnalyticsCard
                            color="teal"
                            icon={<Map size={20} />}
                            title="Corridor Headway"
                            description="Visualize combined service headway where multiple routes share corridors. Identify high-frequency spines and coverage gaps."
                            hasData={false}
                            underConstruction={isFeatureUnderConstruction('analyticsCorridorHeadway')}
                            onClick={() => setView('headway-map')}
                        />
                    )}
                    {canAccess('analyticsStudentPass') && (
                        <AnalyticsCard
                            color="amber"
                            icon={<GraduationCap size={20} />}
                            title="Student Transit Pass"
                            description="Generate one-page transit flyers for students showing how to reach school by bus from any residential zone."
                            hasData={false}
                            underConstruction={isFeatureUnderConstruction('analyticsStudentPass')}
                            onClick={() => setView('student-pass')}
                        />
                    )}
                    {canAccess('analyticsFleetPlan') && (
                        <AnalyticsCard
                            color="violet"
                            icon={<Bus size={20} />}
                            title="Fleet Plan"
                            description="Digitize the shared fleet workbook, edit buses in a planner-friendly workspace, and export the plan back to formatted Excel."
                            hasData={hasFleetPlanData}
                            underConstruction={isFeatureUnderConstruction('analyticsFleetPlan')}
                            onClick={handleFleetPlanClick}
                        />
                    )}
                    {canAccess('analyticsResidentialGrowth') && (
                        <AnalyticsCard
                            color="teal"
                            icon={<Building2 size={20} />}
                            title="Residential Growth"
                            description="Map issued residential permits and occupied units from monthly Excel reports for service planning."
                            hasData={hasResidentialGrowthData}
                            underConstruction={isFeatureUnderConstruction('analyticsResidentialGrowth')}
                            onClick={() => void handleResidentialGrowthClick()}
                        />
                    )}
                    {canAccess('analyticsNetworkConnections') && (
                        <AnalyticsCard
                            color="violet"
                            icon={<GitBranch size={20} />}
                            title="Network Connections"
                            description="Map-first transfer hub analysis using published master schedules. See where routes really connect, where they miss, and which hubs deserve protection."
                            hasData={false}
                            underConstruction={isFeatureUnderConstruction('analyticsNetworkConnections')}
                            onClick={() => setView('network-connections')}
                        />
                    )}
                    {canAccess('analyticsRoutePlanner2') && (
                        <AnalyticsCard
                            color="teal"
                            icon={<Route size={20} />}
                            title="Camp Shuttle Planner"
                            description="Build Camp and address-based shuttle concepts with map authoring, road travel times, service assumptions, and field-ready exports."
                            hasData={false}
                            underConstruction={isFeatureUnderConstruction('analyticsRoutePlanner2')}
                            onClick={() => setView('route-planner-2')}
                        />
                    )}
                    {canAccess('analyticsFarePrograms') && (
                        <AnalyticsCard
                            color="amber"
                            icon={<Ticket size={20} />}
                            title="Fare Programs"
                            description="Summarize Service Mirroring and Field Trip Pass uses, review school-area proxies, and map the location evidence available."
                            hasData
                            underConstruction={isFeatureUnderConstruction('analyticsFarePrograms')}
                            onClick={() => setView('fare-programs')}
                        />
                    )}
                    {canAccess('analyticsRouteConceptPlanner') && (
                        <AnalyticsCard
                            color="cyan"
                            icon={<Route size={20} />}
                            title="Route Concept Planner"
                            description="Test complete route alternatives with GTFS, road travel times, and service assumptions."
                            hasData={false}
                            underConstruction={isFeatureUnderConstruction('analyticsRouteConceptPlanner')}
                            onClick={() => setView('route-concept-planner')}
                        />
                    )}
                </div>
            </div>
        </div>
    );
};
