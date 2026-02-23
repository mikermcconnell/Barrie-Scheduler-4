import React, { useState, useEffect } from 'react';
import { Loader2, Upload } from 'lucide-react';
import { useTeam } from '../contexts/TeamContext';
import { useAuth } from '../contexts/AuthContext';
import { getPerformanceData, getPerformanceMetadata } from '../../utils/performanceDataService';
import { PerformanceImport } from '../Performance/PerformanceImport';
import { ReportsModule } from '../Performance/ReportsModule';
import { TeamManagement } from '../TeamManagement';
import { usePerformanceMetadataQuery, usePerformanceDataQuery } from '../../hooks/usePerformanceData';

interface ReportsWorkspaceProps {
    onClose: () => void;
}

type ReportsView = 'landing' | 'import' | 'workspace';

export const ReportsWorkspace: React.FC<ReportsWorkspaceProps> = ({ onClose }) => {
    const { team } = useTeam();
    const { user } = useAuth();
    const [view, setView] = useState<ReportsView>('landing');
    const [initialLoadDone, setInitialLoadDone] = useState(false);

    const metadataQuery = usePerformanceMetadataQuery(team?.id);
    const hasExistingData = !!metadataQuery.data;

    const dataQuery = usePerformanceDataQuery(team?.id, hasExistingData);

    useEffect(() => {
        setView('landing');
        setInitialLoadDone(false);
    }, [team?.id]);

    useEffect(() => {
        if (!team?.id || initialLoadDone) return;

        if (!metadataQuery.isLoading) {
            if (metadataQuery.data) {
                if (!dataQuery.isLoading && dataQuery.data) {
                    setView('workspace');
                    setInitialLoadDone(true);
                }
            } else {
                setInitialLoadDone(true);
            }
        }
    }, [team?.id, initialLoadDone, metadataQuery.isLoading, metadataQuery.data, dataQuery.isLoading, dataQuery.data]);

    const handleImportComplete = () => {
        setView('workspace');
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

    const isLoading = !initialLoadDone || metadataQuery.isLoading || (hasExistingData && dataQuery.isLoading);

    if (isLoading) {
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

    if (view === 'workspace' && dataQuery.data) {
        return (
            <div className="h-full overflow-auto custom-scrollbar p-6">
                <div className="max-w-7xl mx-auto">
                    <ReportsModule data={dataQuery.data} />
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
