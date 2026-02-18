/**
 * OD Matrix Dashboard
 *
 * Top-level view manager for OD matrix analysis.
 * State machine: landing → import → workspace.
 */

import React, { useState, useEffect } from 'react';
import { Network, ArrowRight, Loader2 } from 'lucide-react';
import { useTeam } from '../contexts/TeamContext';
import { useAuth } from '../contexts/AuthContext';
import { getODMatrixData, getODMatrixMetadata, loadGeocodeCache } from '../../utils/od-matrix/odMatrixService';
import { ODMatrixImport } from './ODMatrixImport';
import { ODMatrixWorkspace } from './ODMatrixWorkspace';
import { TeamManagement } from '../TeamManagement';
import type { ODMatrixDataSummary, GeocodeCache } from '../../utils/od-matrix/odMatrixTypes';

type DashboardView = 'landing' | 'import' | 'workspace';

export const ODMatrixDashboard: React.FC = () => {
    const { team } = useTeam();
    const { user } = useAuth();
    const [view, setView] = useState<DashboardView>('landing');
    const [data, setData] = useState<ODMatrixDataSummary | null>(null);
    const [geocodeCache, setGeocodeCache] = useState<GeocodeCache | null>(null);
    const [loading, setLoading] = useState(true);
    const [hasExistingData, setHasExistingData] = useState(false);

    // Check for existing data on mount
    useEffect(() => {
        if (!team?.id) {
            setLoading(false);
            return;
        }
        (async () => {
            try {
                const metadata = await getODMatrixMetadata(team.id);
                setHasExistingData(!!metadata);
            } catch (error) {
                console.error('Error checking OD matrix data:', error);
            } finally {
                setLoading(false);
            }
        })();
    }, [team?.id]);

    const handleViewExisting = async () => {
        if (!team?.id) return;
        setLoading(true);
        try {
            const [loadedData, cache] = await Promise.all([
                getODMatrixData(team.id),
                loadGeocodeCache(team.id),
            ]);
            if (loadedData) {
                setData(loadedData);
                setGeocodeCache(cache);
                setView('workspace');
            } else {
                setHasExistingData(false);
            }
        } catch (error) {
            console.error('Error loading OD matrix data:', error);
        } finally {
            setLoading(false);
        }
    };

    const handleImportComplete = async () => {
        if (!team?.id) return;
        setLoading(true);
        try {
            const [loadedData, cache] = await Promise.all([
                getODMatrixData(team.id),
                loadGeocodeCache(team.id),
            ]);
            if (loadedData) {
                setData(loadedData);
                setGeocodeCache(cache);
                setHasExistingData(true);
                setView('workspace');
            }
        } catch (error) {
            console.error('Error loading imported data:', error);
        } finally {
            setLoading(false);
        }
    };

    // Team guard
    if (!team) {
        return (
            <div className="h-full overflow-auto custom-scrollbar p-6">
                <div className="max-w-4xl mx-auto">
                    <div className="mb-6 text-center">
                        <h2 className="text-2xl font-bold text-gray-900 tracking-tight mb-2">OD Matrix Analysis</h2>
                        <p className="text-gray-500">Set up or join a team to continue.</p>
                    </div>
                    <TeamManagement />
                </div>
            </div>
        );
    }

    if (loading) {
        return (
            <div className="h-full flex items-center justify-center">
                <Loader2 className="text-violet-500 animate-spin" size={32} />
            </div>
        );
    }

    // Import view
    if (view === 'import' && user) {
        return (
            <div className="h-full overflow-auto custom-scrollbar p-6">
                <ODMatrixImport
                    teamId={team.id}
                    userId={user.uid}
                    onImportComplete={handleImportComplete}
                    onCancel={() => setView('landing')}
                />
            </div>
        );
    }

    // Workspace view
    if (view === 'workspace' && data) {
        return (
            <div className="h-full overflow-auto custom-scrollbar p-6">
                <div className="max-w-7xl mx-auto">
                    <ODMatrixWorkspace
                        data={data}
                        geocodeCache={geocodeCache}
                        onReimport={() => setView('import')}
                        onBack={() => setView('landing')}
                    />
                </div>
            </div>
        );
    }

    // Landing view
    return (
        <div className="h-full overflow-auto custom-scrollbar p-6">
            <div className="max-w-4xl mx-auto">
                <div className="mb-8">
                    <h2 className="text-2xl font-bold text-gray-900 tracking-tight mb-2">OD Matrix Analysis</h2>
                    <p className="text-gray-500">Import and analyze origin-destination ridership data.</p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-2xl">
                    {/* Import New Data */}
                    <button
                        onClick={() => setView('import')}
                        className="group bg-white p-6 rounded-xl border border-gray-200 shadow-sm hover:shadow-md hover:border-violet-300 transition-all text-left flex flex-col h-full active:scale-[0.99]"
                    >
                        <div className="flex items-center justify-between mb-4">
                            <div className="bg-violet-50/50 p-2.5 rounded-lg text-violet-600 group-hover:bg-violet-100 transition-colors">
                                <Network size={20} />
                            </div>
                            <ArrowRight size={16} className="text-gray-300 group-hover:text-violet-500 transition-colors" />
                        </div>
                        <h3 className="text-lg font-bold text-gray-900 mb-1">Import Data</h3>
                        <p className="text-sm text-gray-500 leading-relaxed">
                            Upload an Excel OD matrix file to analyze travel patterns and station connectivity.
                        </p>
                    </button>

                    {/* View Existing */}
                    {hasExistingData && (
                        <button
                            onClick={handleViewExisting}
                            className="group bg-white p-6 rounded-xl border border-gray-200 shadow-sm hover:shadow-md hover:border-violet-300 transition-all text-left flex flex-col h-full active:scale-[0.99]"
                        >
                            <div className="flex items-center justify-between mb-4">
                                <div className="bg-violet-50/50 p-2.5 rounded-lg text-violet-600 group-hover:bg-violet-100 transition-colors">
                                    <Network size={20} />
                                </div>
                                <div className="flex items-center gap-2">
                                    <span className="px-2 py-0.5 bg-emerald-100 text-emerald-700 text-[10px] font-bold rounded-full uppercase tracking-wide">
                                        Data Loaded
                                    </span>
                                    <ArrowRight size={16} className="text-gray-300 group-hover:text-violet-500 transition-colors" />
                                </div>
                            </div>
                            <h3 className="text-lg font-bold text-gray-900 mb-1">View Existing</h3>
                            <p className="text-sm text-gray-500 leading-relaxed">
                                Open your previously imported OD matrix analysis.
                            </p>
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
};
