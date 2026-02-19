import React, { useState, useEffect } from 'react';
import { Loader2, Upload } from 'lucide-react';
import { useTeam } from '../contexts/TeamContext';
import { useAuth } from '../contexts/AuthContext';
import { getPerformanceData, getPerformanceMetadata } from '../../utils/performanceDataService';
import { PerformanceImport } from '../Performance/PerformanceImport';
import { ReportsModule } from '../Performance/ReportsModule';
import { TeamManagement } from '../TeamManagement';
import type { PerformanceDataSummary } from '../../utils/performanceDataTypes';

interface ReportsWorkspaceProps {
    onClose: () => void;
}

type ReportsView = 'landing' | 'import' | 'workspace';

export const ReportsWorkspace: React.FC<ReportsWorkspaceProps> = ({ onClose }) => {
    const { team } = useTeam();
    const { user } = useAuth();
    const [view, setView] = useState<ReportsView>('landing');
    const [data, setData] = useState<PerformanceDataSummary | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let cancelled = false;
        setView('landing');
        setData(null);

        if (!team?.id) {
            setLoading(false);
            return () => { cancelled = true; };
        }

        setLoading(true);
        (async () => {
            try {
                const metadata = await getPerformanceMetadata(team.id);
                if (cancelled) return;
                if (metadata) {
                    const loaded = await getPerformanceData(team.id);
                    if (cancelled) return;
                    if (loaded) {
                        setData(loaded);
                        setView('workspace');
                    }
                }
            } catch (error) {
                console.error('Error checking performance data:', error);
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();

        return () => { cancelled = true; };
    }, [team?.id]);

    const handleImportComplete = async () => {
        if (!team?.id) return;
        setLoading(true);
        try {
            const loaded = await getPerformanceData(team.id);
            if (loaded) {
                setData(loaded);
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
                        <h2 className="text-2xl font-bold text-gray-900 tracking-tight mb-2">STREETS Reports</h2>
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
                    <ReportsModule data={data} />
                </div>
            </div>
        );
    }

    // Landing — no data yet
    return (
        <div className="h-full overflow-auto custom-scrollbar p-6">
            <div className="max-w-4xl mx-auto">
                <h2 className="text-2xl font-bold text-gray-900 tracking-tight mb-2">STREETS Reports</h2>
                <p className="text-gray-500 mb-8">Weekly summaries, route deep-dives, and AI-powered analysis of STREETS performance data.</p>

                <button
                    onClick={() => setView('import')}
                    className="group bg-white p-6 rounded-xl border border-gray-200 shadow-sm hover:shadow-md hover:border-cyan-300 transition-all text-left flex flex-col max-w-sm active:scale-[0.99]"
                >
                    <div className="bg-cyan-50/50 p-2.5 rounded-lg text-cyan-600 group-hover:bg-cyan-100 transition-colors mb-4 w-fit">
                        <Upload size={20} />
                    </div>
                    <h3 className="text-lg font-bold text-gray-900 mb-1">Import STREETS Data</h3>
                    <p className="text-sm text-gray-500 leading-relaxed">
                        Import AVL/APC data to generate weekly summaries, route reports, and AI-powered insights.
                    </p>
                </button>
            </div>
        </div>
    );
};
