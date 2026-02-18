/**
 * OD Top Pairs Module (stub — fleshed out in Phase 5)
 */

import React from 'react';
import type { ODMatrixDataSummary } from '../../utils/od-matrix/odMatrixTypes';

interface ODTopPairsModuleProps {
    data: ODMatrixDataSummary;
}

export const ODTopPairsModule: React.FC<ODTopPairsModuleProps> = ({ data }) => {
    return <div className="text-gray-500">Top Pairs — {data.topPairs.length} pairs ready</div>;
};
