/**
 * OD Flow Map Module (stub — fleshed out in Phase 6)
 */

import React from 'react';
import type { ODMatrixDataSummary, GeocodeCache } from '../../utils/od-matrix/odMatrixTypes';

interface ODFlowMapModuleProps {
    data: ODMatrixDataSummary;
    geocodeCache: GeocodeCache | null;
}

export const ODFlowMapModule: React.FC<ODFlowMapModuleProps> = ({ data }) => {
    return <div className="text-gray-500">Flow Map — {data.stationCount} stations ready</div>;
};
