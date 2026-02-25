/**
 * Analytics Dashboard
 *
 * Landing page for the Analytics section with cards for different analysis tools.
 * Routes to TransitApp, OD Matrix, and future analysis workspaces.
 */

import React, { useState, useEffect } from 'react';
import { Map, ArrowRight, Loader2, Smartphone, Network } from 'lucide-react';
import { useTeam } from '../contexts/TeamContext';
import { useAuth } from '../contexts/AuthContext';
import { getTransitAppData, getTransitAppMetadata } from '../../utils/transit-app/transitAppService';
import { getODMatrixData, getODMatrixMetadata, loadGeocodeCache, loadODMatrixImportById } from '../../utils/od-matrix/odMatrixService';
import { TransitAppImport } from './TransitAppImport';
import { TransitAppWorkspace } from './TransitAppWorkspace';
import { ODMatrixImport } from './ODMatrixImport';
import { ODMatrixWorkspace } from './ODMatrixWorkspace';
import { ODCoordinateEditor } from './ODCoordinateEditor';
import { TeamManagement } from '../TeamManagement';
import { HeadwayMap } from '../Mapping/HeadwayMap';
import type { TransitAppDataSummary } from '../../utils/transit-app/transitAppTypes';
import type { ODMatrixDataSummary, GeocodeCache } from '../../utils/od-matrix/odMatrixTypes';

interface AnalyticsCardProps {
    color: 'cyan' | 'violet' | 'teal';
    icon: React.ReactNode;
    title: string;
    description: string;
    hasData: boolean;
    onClick: () => void;
}

const AnalyticsCard: React.FC<AnalyticsCardProps> = ({ color, icon, title, description, hasData, onClick }) => (
    <button
        onClick={onClick}
        className={`group bg-white p-6 rounded-xl border border-gray-200 shadow-sm hover:shadow-md hover:border-${color}-300 transition-all text-left flex flex-col h-full active:scale-[0.99]`}
    >
        <div className="flex items-center justify-between mb-4">
            <div className={`bg-${color}-50/50 p-2.5 rounded-lg text-${color}-600 group-hover:bg-${color}-100 transition-colors`}>
                {icon}
            </div>
            <div className="flex items-center gap-2">
                {hasData && (
                    <span className="px-2 py-0.5 bg-emerald-100 text-emerald-700 text-[10px] font-bold rounded-full uppercase tracking-wide">
                        Data Loaded
                    </span>
                )}
                <ArrowRight size={16} className={`text-gray-300 group-hover:text-${color}-500 transition-colors`} />
            </div>
        </div>
        <h3 className="text-lg font-bold text-gray-900 mb-1">{title}</h3>
        <p className="text-sm text-gray-500 leading-relaxed">{description}</p>
    </button>
);

interface AnalyticsDashboardProps {
    onClose: () => void;
}

type AnalyticsView =
    | 'dashboard'
    | 'import'
    | 'transit-data'
    | 'od-import'
    | 'od-fix-coords'
    | 'od-workspace'
    | 'headway-map';

export const AnalyticsDashboard: React.FC<AnalyticsDashboardProps> = ({ onClose }) => {
    const { team } = useTeam();
    const { user } = useAuth();
    const [view, setView] = useState<AnalyticsView>('dashboard');
    const [transitData, setTransitData] = useState<TransitAppDataSummary | null>(null);
    const [odData, setOdData] = useState<ODMatrixDataSummary | null>(null);
    const [odGeocodeCache, setOdGeocodeCache] = useState<GeocodeCache | null>(null);
    const [loading, setLoading] = useState(true);
    const [hasExistingData, setHasExistingData] = useState(false);
    const [hasODData, setHasODData] = useState(false);

    // Check for existing data on mount
    useEffect(() => {
        if (!team?.id) {
            setLoading(false);
            return;
        }
        (async () => {
            try {
                const [transitMeta, odMeta] = await Promise.all([
                    getTransitAppMetadata(team.id),
                    getODMatrixMetadata(team.id),
                ]);
                setHasExistingData(!!transitMeta);
                setHasODData(!!odMeta);
            } catch (error) {
                console.error('Error checking analytics data:', error);
            } finally {
                setLoading(false);
            }
        })();
    }, [team?.id]);

    // Handle clicking the Transit App Data card
    const handleTransitAppClick = async () => {
        if (!team?.id) return;

        if (hasExistingData) {
            // Load full data and show dashboard
            setLoading(true);
            try {
                const data = await getTransitAppData(team.id);
                if (data) {
                    setTransitData(data);
                    setView('transit-data');
                } else {
                    // Data disappeared — show import
                    setHasExistingData(false);
                    setView('import');
                }
            } catch (error) {
                console.error('Error loading transit app data:', error);
            } finally {
                setLoading(false);
            }
        } else {
            setView('import');
        }
    };

    // Handle import complete — load data and switch to dashboard
    const handleImportComplete = async () => {
        if (!team?.id) return;
        setLoading(true);
        try {
            const data = await getTransitAppData(team.id);
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
            const [loadedData, cache] = await Promise.all([
                opts.importId
                    ? loadODMatrixImportById(team.id, opts.importId)
                    : getODMatrixData(team.id),
                loadGeocodeCache(team.id),
            ]);
            if (loadedData) {
                setOdData(loadedData);
                setOdGeocodeCache(cache);
                if (opts.markAsLoaded) setHasODData(true);
                setView('od-workspace');
            } else if (opts.fallbackToImport) {
                setHasODData(false);
                setView('od-import');
            }
        } catch (error) {
            console.error('Error loading OD matrix data:', error);
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
        if (result === 'unchanged') return;
        if (result !== null) {
            loadODData({ importId: result });
        } else {
            setOdData(null);
            setHasODData(false);
            setView('od-import');
        }
    };

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
    if (loading) {
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
                <TransitAppImport
                    teamId={team.id}
                    userId={user.uid}
                    onImportComplete={handleImportComplete}
                    onCancel={() => setView('dashboard')}
                />
            </div>
        );
    }

    // Transit data workspace view
    if (view === 'transit-data' && transitData) {
        return (
            <div className="h-full overflow-auto custom-scrollbar p-6">
                <div className="max-w-7xl mx-auto">
                    <TransitAppWorkspace
                        data={transitData}
                        onReimport={() => setView('import')}
                        onBack={() => setView('dashboard')}
                    />
                </div>
            </div>
        );
    }

    // OD Matrix import view
    if (view === 'od-import' && user) {
        return (
            <div className="h-full overflow-auto custom-scrollbar p-6">
                <ODMatrixImport
                    teamId={team.id}
                    userId={user.uid}
                    onImportComplete={handleODImportComplete}
                    onCancel={() => setView('dashboard')}
                />
            </div>
        );
    }

    // OD Matrix workspace view
    if (view === 'od-workspace' && odData) {
        return (
            <div className="h-full overflow-auto custom-scrollbar p-6">
                <div className="max-w-7xl mx-auto">
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
                </div>
            </div>
        );
    }

    // OD coordinate editor (no file re-upload)
    if (view === 'od-fix-coords' && user && odData) {
        return (
            <ODCoordinateEditor
                teamId={team.id}
                userId={user.uid}
                data={odData}
                geocodeCache={odGeocodeCache}
                onComplete={() => loadODData({ markAsLoaded: true })}
                onCancel={() => setView('od-workspace')}
            />
        );
    }

    // Corridor Headway Map
    if (view === 'headway-map') {
        return (
            <div className="h-full overflow-hidden">
                <HeadwayMap onBack={() => setView('dashboard')} />
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
                    <AnalyticsCard
                        color="cyan"
                        icon={<Smartphone size={20} />}
                        title="Transit App Data"
                        description="Import and analyze rider demand, trip patterns, and route engagement from Transit App."
                        hasData={hasExistingData}
                        onClick={handleTransitAppClick}
                    />
                    <AnalyticsCard
                        color="violet"
                        icon={<Network size={20} />}
                        title="Ontario Northland"
                        description="Import origin-destination ridership matrices, visualize travel patterns, and analyze station connectivity."
                        hasData={hasODData}
                        onClick={handleODMatrixClick}
                    />
                    <AnalyticsCard
                        color="teal"
                        icon={<Map size={20} />}
                        title="Corridor Headway"
                        description="Visualize combined service headway where multiple routes share corridors. Identify high-frequency spines and coverage gaps."
                        hasData={false}
                        onClick={() => setView('headway-map')}
                    />
                </div>
            </div>
        </div>
    );
};
