import React, { useState, useEffect } from 'react';
import { BarChart3, ArrowRight, Loader2, Activity } from 'lucide-react';
import { useTeam } from '../contexts/TeamContext';
import { useAuth } from '../contexts/AuthContext';
import { getPerformanceData, getPerformanceMetadata } from '../../utils/performanceDataService';
import { PerformanceImport } from './PerformanceImport';
import { PerformanceWorkspace } from './PerformanceWorkspace';
import { TeamManagement } from '../TeamManagement';
import type { PerformanceDataSummary } from '../../utils/performanceDataTypes';

interface PerformanceDashboardProps {
    onClose: () => void;
}

type PerformanceView = 'landing' | 'import' | 'workspace';

export const PerformanceDashboard: React.FC<PerformanceDashboardProps> = ({ onClose }) => {
    const { team } = useTeam();
    const { user } = useAuth();
    const [view, setView] = useState<PerformanceView>('landing');
    const [data, setData] = useState<PerformanceDataSummary | null>(null);
    const [loading, setLoading] = useState(true);
    const [hasExistingData, setHasExistingData] = useState(false);

    useEffect(() => {
        if (!team?.id) {
            setLoading(false);
            return;
        }
        (async () => {
            try {
                const metadata = await getPerformanceMetadata(team.id);
                setHasExistingData(!!metadata);
            } catch (error) {
                console.error('Error checking performance data:', error);
            } finally {
                setLoading(false);
            }
        })();
    }, [team?.id]);

    const handleCardClick = async () => {
        if (!team?.id) return;
        if (hasExistingData) {
            setLoading(true);
            try {
                const loaded = await getPerformanceData(team.id);
                if (loaded) {
                    setData(loaded);
                    setView('workspace');
                } else {
                    setHasExistingData(false);
                    setView('import');
                }
            } catch (error) {
                console.error('Error loading performance data:', error);
            } finally {
                setLoading(false);
            }
        } else {
            setView('import');
        }
    };

    const handleImportComplete = async () => {
        if (!team?.id) return;
        setLoading(true);
        try {
            const loaded = await getPerformanceData(team.id);
            if (loaded) {
                setData(loaded);
                setHasExistingData(true);
                setView('workspace');
            }
        } catch (error) {
            console.error('Error loading imported data:', error);
        } finally {
            setLoading(false);
        }
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

    if (loading) {
        return (
            <div className="h-full flex items-center justify-center">
                <Loader2 className="text-cyan-500 animate-spin" size={32} />
            </div>
        );
    }

    if (view === 'import' && user) {
        return (
            <div className="h-full overflow-auto custom-scrollbar p-6">
                <PerformanceImport
                    teamId={team.id}
                    userId={user.uid}
                    onImportComplete={handleImportComplete}
                    onCancel={() => setView('landing')}
                />
            </div>
        );
    }

    if (view === 'workspace' && data) {
        return (
            <div className="h-full overflow-auto custom-scrollbar p-6">
                <div className="max-w-7xl mx-auto">
                    <PerformanceWorkspace
                        data={data}
                        onReimport={() => setView('import')}
                        onBack={() => setView('landing')}
                    />
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
                                {hasExistingData && (
                                    <span className="px-2 py-0.5 bg-emerald-100 text-emerald-700 text-[10px] font-bold rounded-full uppercase tracking-wide">
                                        Data Loaded
                                    </span>
                                )}
                                <ArrowRight size={16} className="text-gray-300 group-hover:text-cyan-500 transition-colors" />
                            </div>
                        </div>
                        <h3 className="text-lg font-bold text-gray-900 mb-1">STREETS AVL Data</h3>
                        <p className="text-sm text-gray-500 leading-relaxed">
                            Import AVL/APC data to view OTP, ridership trends, and load profiles by route.
                        </p>
                    </button>

                    <div className="relative bg-gray-50 p-6 rounded-xl border border-gray-200 shadow-sm text-left flex flex-col h-full opacity-60 cursor-not-allowed">
                        <div className="absolute top-3 right-3 px-2 py-0.5 bg-gray-200 text-gray-500 text-[10px] font-bold rounded-full uppercase tracking-wide">
                            Phase 2
                        </div>
                        <div className="flex items-center justify-between mb-4">
                            <div className="bg-gray-100 p-2.5 rounded-lg text-gray-400">
                                <BarChart3 size={20} />
                            </div>
                        </div>
                        <h3 className="text-lg font-bold text-gray-500 mb-1">Connection Analysis</h3>
                        <p className="text-sm text-gray-400 leading-relaxed">
                            GO Train and inter-route connection reliability analysis.
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
};
