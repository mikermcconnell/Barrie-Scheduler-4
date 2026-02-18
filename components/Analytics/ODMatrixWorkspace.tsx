/**
 * OD Matrix Workspace (stub — fleshed out in Phase 4)
 */

import React from 'react';
import type { ODMatrixDataSummary, GeocodeCache } from '../../utils/od-matrix/odMatrixTypes';

interface ODMatrixWorkspaceProps {
    data: ODMatrixDataSummary;
    geocodeCache: GeocodeCache | null;
    onReimport: () => void;
    onBack: () => void;
}

export const ODMatrixWorkspace: React.FC<ODMatrixWorkspaceProps> = ({
    data,
    onReimport,
    onBack,
}) => {
    return (
        <div>
            <div className="flex items-center justify-between mb-6">
                <div>
                    <h2 className="text-2xl font-bold text-gray-900">OD Matrix Analysis</h2>
                    <p className="text-sm text-gray-500">
                        {data.stationCount} stations &middot; {data.totalJourneys.toLocaleString()} journeys
                    </p>
                </div>
                <div className="flex gap-2">
                    <button onClick={onBack} className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-900 transition-colors">
                        Back
                    </button>
                    <button onClick={onReimport} className="px-3 py-1.5 text-sm bg-violet-600 text-white rounded-lg hover:bg-violet-700 transition-colors">
                        Re-import
                    </button>
                </div>
            </div>
            <p className="text-gray-500">Workspace panels loading in Phase 4...</p>
        </div>
    );
};
