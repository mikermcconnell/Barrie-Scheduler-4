import React, { Suspense, useEffect, useState } from 'react';
import { Loader2, Upload } from 'lucide-react';
import { useTeam } from '../contexts/TeamContext';
import { useAuth } from '../contexts/AuthContext';
import { TeamManagement } from '../TeamManagement';
import { usePerformanceMetadataQuery, usePerformanceDataQuery } from '../../hooks/usePerformanceData';
import { lazyWithRetry } from '../../utils/lazyWithRetry';

interface ReportsWorkspaceProps {
    onClose: () => void;
}

type ReportsView = 'landing' | 'import' | 'workspace';

const PerformanceImport = lazyWithRetry(
    () => import('../Performance/PerformanceImport').then(module => ({ default: module.PerformanceImport })),
    'reports-workspace-import',
);
const ReportsModule = lazyWithRetry(
    () => import('../Performance/ReportsModule').then(module => ({ default: module.ReportsModule })),
    'reports-workspace-module',
);

const ReportsLoadingState: React.FC<{ label: string }> = ({ label }) => (
    <div className="h-full flex items-center justify-center">
        <div className="flex flex-col items-center gap-3 text-gray-500">
            <Loader2 className="text-cyan-500 animate-spin" size={32} />
            <span className="text-sm font-medium">{label}</span>
        </div>
    </div>
);

export const ReportsWorkspace: React.FC<ReportsWorkspaceProps> = ({ onClose }) => {
    const { team } = useTeam();
    const { user } = useAuth();
    const [view, setView] = useState<ReportsView>('landing');

    const metadataQuery = usePerformanceMetadataQuery(team?.id);
    const hasExistingData = !!metadataQuery.data;
    const shouldLoadWorkspaceData = view === 'workspace' && hasExistingData;
    const dataQuery = usePerformanceDataQuery(team?.id, shouldLoadWorkspaceData, metadataQuery.data);

    useEffect(() => {
        setView('landing');
    }, [team?.id]);

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

    if (view === 'import' && user) {
        return (
            <div className="h-full overflow-auto custom-scrollbar p-6">
                <Suspense fallback={<ReportsLoadingState label="Loading import tools..." />}>
                    <PerformanceImport
                        teamId={team.id}
                        userId={user.uid}
                        onImportComplete={handleImportComplete}
                        onCancel={() => setView('landing')}
                    />
                </Suspense>
            </div>
        );
    }

    if (view === 'workspace') {
        if (metadataQuery.isLoading || !hasExistingData || dataQuery.isLoading || !dataQuery.data) {
            return <ReportsLoadingState label="Loading reports..." />;
        }

        return (
            <div className="h-full overflow-auto custom-scrollbar p-6">
                <div className="max-w-7xl mx-auto">
                    <Suspense fallback={<ReportsLoadingState label="Loading reports..." />}>
                        <ReportsModule data={dataQuery.data} />
                    </Suspense>
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
                    onClick={() => setView(hasExistingData ? 'workspace' : 'import')}
                    className="group bg-white p-6 rounded-xl border border-gray-200 shadow-sm hover:shadow-md hover:border-cyan-300 transition-all text-left flex flex-col max-w-sm active:scale-[0.99]"
                >
                    <div className="bg-cyan-50/50 p-2.5 rounded-lg text-cyan-600 group-hover:bg-cyan-100 transition-colors mb-4 w-fit">
                        <Upload size={20} />
                    </div>
                    <h3 className="text-lg font-bold text-gray-900 mb-1">
                        {hasExistingData ? 'Open STREETS Reports' : 'Import STREETS Data'}
                    </h3>
                    <p className="text-sm text-gray-500 leading-relaxed">
                        {hasExistingData
                            ? 'Open weekly summaries, route reports, and AI analysis using the latest imported performance data.'
                            : 'Import AVL/APC data to generate weekly summaries, route reports, and AI-powered insights.'}
                    </p>
                </button>
            </div>
        </div>
    );
};
