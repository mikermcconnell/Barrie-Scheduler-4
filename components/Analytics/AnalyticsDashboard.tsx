/**
 * Analytics Dashboard
 *
 * Landing page for the Analytics section with cards for different analysis tools.
 * Routes to TransitApp, OD Matrix, and future analysis workspaces.
 */

import React, { useState, useEffect } from 'react';
import { MapPin, ArrowRight, Loader2, Smartphone, Network } from 'lucide-react';
import { useTeam } from '../contexts/TeamContext';
import { useAuth } from '../contexts/AuthContext';
import { getTransitAppData, getTransitAppMetadata } from '../../utils/transit-app/transitAppService';
import { getODMatrixData, getODMatrixMetadata, loadGeocodeCache } from '../../utils/od-matrix/odMatrixService';
import { TransitAppImport } from './TransitAppImport';
import { TransitAppWorkspace } from './TransitAppWorkspace';
import { ODMatrixImport } from './ODMatrixImport';
import { ODMatrixWorkspace } from './ODMatrixWorkspace';
import { TeamManagement } from '../TeamManagement';
import type { TransitAppDataSummary } from '../../utils/transit-app/transitAppTypes';
import type { ODMatrixDataSummary, GeocodeCache } from '../../utils/od-matrix/odMatrixTypes';

interface AnalyticsCardProps {
    color: 'cyan' | 'violet';
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
    | 'od-workspace';

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

    const loadODData = async (opts: { fallbackToImport?: boolean; markAsLoaded?: boolean }) => {
        if (!team?.id) return;
        setLoading(true);
        try {
            const [loadedData, cache] = await Promise.all([
                getODMatrixData(team.id),
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
                        data={odData}
                        geocodeCache={odGeocodeCache}
                        onReimport={() => setView('od-import')}
                        onBack={() => setView('dashboard')}
                    />
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
                        title="OD Matrix"
                        description="Import origin-destination ridership matrices, visualize travel patterns, and analyze station connectivity."
                        hasData={hasODData}
                        onClick={handleODMatrixClick}
                    />

                    {/* Coverage Gaps Card - Phase 2 */}
                    <div className="relative bg-gray-50 p-6 rounded-xl border border-gray-200 shadow-sm text-left flex flex-col h-full opacity-60 cursor-not-allowed">
                        <div className="absolute top-3 right-3 px-2 py-0.5 bg-gray-200 text-gray-500 text-[10px] font-bold rounded-full uppercase tracking-wide">
                            Phase 2
                        </div>
                        <div className="flex items-center justify-between mb-4">
                            <div className="bg-gray-100 p-2.5 rounded-lg text-gray-400">
                                <MapPin size={20} />
                            </div>
                        </div>
                        <h3 className="text-lg font-bold text-gray-500 mb-1">Coverage Gaps</h3>
                        <p className="text-sm text-gray-400 leading-relaxed">
                            Identify service gaps by time and route to justify schedule changes.
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
};
