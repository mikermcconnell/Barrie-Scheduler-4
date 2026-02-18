/**
 * OD Station Rankings Module (stub — fleshed out in Phase 5)
 */

import React from 'react';
import type { ODMatrixDataSummary } from '../../utils/od-matrix/odMatrixTypes';

interface ODStationRankingsModuleProps {
    data: ODMatrixDataSummary;
}

export const ODStationRankingsModule: React.FC<ODStationRankingsModuleProps> = ({ data }) => {
    return <div className="text-gray-500">Station Rankings — {data.stationCount} stations ready</div>;
};
