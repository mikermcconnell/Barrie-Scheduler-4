import React, { useMemo } from 'react';
import type { DailySummary, DayType, PerformanceDataSummary } from '../../../utils/performanceDataTypes';
import { OperatorDwellModule } from '../OperatorDwellModule';

interface OperatorDwellReportProps {
    filteredDays: DailySummary[];
    allDays: DailySummary[];
    startDate: string;
    endDate: string;
    dayTypeFilter: DayType | 'all';
}

/**
 * The reports workspace deliberately reuses the dashboard review experience so
 * incident definitions, filters, summaries, and exports cannot drift apart.
 */
export const OperatorDwellReport: React.FC<OperatorDwellReportProps> = ({
    filteredDays,
    startDate,
    endDate,
}) => {
    const data = useMemo<PerformanceDataSummary>(() => ({
        dailySummaries: filteredDays,
        metadata: {
            importedAt: '',
            importedBy: '',
            dateRange: { start: startDate, end: endDate },
            dayCount: filteredDays.length,
            totalRecords: 0,
        },
        schemaVersion: filteredDays.reduce((max, day) => Math.max(max, day.schemaVersion ?? 0), 0),
    }), [endDate, filteredDays, startDate]);

    return <OperatorDwellModule data={data} />;
};

export default OperatorDwellReport;
