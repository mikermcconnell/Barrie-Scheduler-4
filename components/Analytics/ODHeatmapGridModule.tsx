/**
 * OD Heatmap Grid Module (stub — fleshed out in Phase 7)
 */

import React from 'react';
import type { ODMatrixDataSummary } from '../../utils/od-matrix/odMatrixTypes';

interface ODHeatmapGridModuleProps {
    data: ODMatrixDataSummary;
}

export const ODHeatmapGridModule: React.FC<ODHeatmapGridModuleProps> = ({ data }) => {
    return <div className="text-gray-500">Heatmap Grid — {data.stationCount} stations ready</div>;
};
