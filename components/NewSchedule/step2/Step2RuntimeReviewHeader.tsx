import React from 'react';

interface Step2RuntimeReviewHeaderProps {
    hasGroupedSegmentColumns: boolean;
    viewMetric: 'p50' | 'p80';
    onViewMetricChange: (metric: 'p50' | 'p80') => void;
}

export const Step2RuntimeReviewHeader: React.FC<Step2RuntimeReviewHeaderProps> = ({
    hasGroupedSegmentColumns,
    viewMetric,
    onViewMetricChange,
}) => (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
            <h2 className="text-2xl font-bold text-gray-900 tracking-tight">Runtime Analysis</h2>
            <p className="text-gray-500">
                Review the runtimes that will be used to build this schedule.
            </p>
            {hasGroupedSegmentColumns && (
                <p className="text-xs text-gray-400 mt-1">
                    Segment columns run left to right in bus travel order.
                </p>
            )}
        </div>

        <div className="flex bg-gray-100 p-1 rounded-lg">
            <button
                onClick={() => onViewMetricChange('p50')}
                className={`px-4 py-2 text-sm font-bold rounded-md transition-all ${viewMetric === 'p50' ? 'bg-white text-brand-blue shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
            >
                50th Percentile (Median)
            </button>
            <button
                onClick={() => onViewMetricChange('p80')}
                className={`px-4 py-2 text-sm font-bold rounded-md transition-all ${viewMetric === 'p80' ? 'bg-white text-brand-blue shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
            >
                80th Percentile (Reliable)
            </button>
        </div>
    </div>
);
