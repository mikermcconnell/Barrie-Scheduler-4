import React, { useMemo, useState, useCallback } from 'react';
import { FileBarChart, Route, Sparkles, Timer } from 'lucide-react';
import type { PerformanceDataSummary, DailySummary } from '../../utils/performanceDataTypes';
import { DateRangePicker, type DateRangeSelection } from './reports/DateRangePicker';
import { WeeklySummaryReport } from './reports/WeeklySummaryReport';
import { RoutePerformanceReport } from './reports/RoutePerformanceReport';
import { AIQueryPanel } from './reports/AIQueryPanel';
import { OperatorDwellReport } from './reports/OperatorDwellReport';
import { compareDateStrings, normalizeToISODate, toDateSortKey } from '../../utils/performanceDateUtils';

interface ReportsModuleProps {
    data: PerformanceDataSummary;
}

type ReportPanel = 'summary' | 'route' | 'dwell' | 'ai';

const PANEL_CONFIG: { id: ReportPanel; label: string; icon: React.FC<{ size?: number }> }[] = [
    { id: 'summary', label: 'Weekly / Monthly Summary', icon: FileBarChart },
    { id: 'route', label: 'Route Performance', icon: Route },
    { id: 'dwell', label: 'Operator Dwell', icon: Timer },
    { id: 'ai', label: 'AI Assistant', icon: Sparkles },
];

export const ReportsModule: React.FC<ReportsModuleProps> = ({ data }) => {
    const [activePanel, setActivePanel] = useState<ReportPanel>('summary');

    const availableDates = useMemo(
        () => [...new Set(
            data.dailySummaries
                .map(d => normalizeToISODate(d.date) ?? d.date)
                .filter(Boolean)
        )].sort(compareDateStrings),
        [data]
    );

    const [dateRange, setDateRange] = useState<DateRangeSelection>(() => ({
        startDate: availableDates[0] ?? '',
        endDate: availableDates[availableDates.length - 1] ?? '',
        dayTypeFilter: 'all',
    }));

    const handleDateChange = useCallback((selection: DateRangeSelection) => {
        setDateRange(selection);
    }, []);

    const filteredDays = useMemo((): DailySummary[] => {
        const startKey = toDateSortKey(dateRange.startDate);
        const endKey = toDateSortKey(dateRange.endDate);
        return data.dailySummaries.filter(d => {
            const dayKey = toDateSortKey(d.date);
            if (Number.isFinite(dayKey) && Number.isFinite(startKey) && Number.isFinite(endKey)) {
                if (dayKey < startKey || dayKey > endKey) return false;
            } else {
                if (d.date < dateRange.startDate || d.date > dateRange.endDate) return false;
            }
            if (dateRange.dayTypeFilter !== 'all' && d.dayType !== dateRange.dayTypeFilter) return false;
            return true;
        });
    }, [data, dateRange]);

    const renderPanel = () => {
        switch (activePanel) {
            case 'summary':
                return (
                    <WeeklySummaryReport
                        filteredDays={filteredDays}
                        allDays={data.dailySummaries}
                        startDate={dateRange.startDate}
                        endDate={dateRange.endDate}
                    />
                );
            case 'route':
                return <RoutePerformanceReport filteredDays={filteredDays} startDate={dateRange.startDate} endDate={dateRange.endDate} />;
            case 'dwell':
                return (
                    <OperatorDwellReport
                        filteredDays={filteredDays}
                        allDays={data.dailySummaries}
                        startDate={dateRange.startDate}
                        endDate={dateRange.endDate}
                    />
                );
            case 'ai':
                return <AIQueryPanel filteredDays={filteredDays} />;
        }
    };

    return (
        <div className="space-y-4">
            {/* Date Range Picker */}
            <DateRangePicker
                availableDates={availableDates}
                value={dateRange}
                onChange={handleDateChange}
            />

            {/* Sub-navigation */}
            <div className="flex gap-1 border-b border-gray-200">
                {PANEL_CONFIG.map(panel => {
                    const isActive = activePanel === panel.id;
                    const Icon = panel.icon;
                    return (
                        <button
                            key={panel.id}
                            onClick={() => setActivePanel(panel.id)}
                            className={`relative flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium whitespace-nowrap transition-colors ${
                                isActive ? 'text-gray-900' : 'text-gray-500 hover:text-gray-700'
                            }`}
                        >
                            <Icon size={15} />
                            {panel.label}
                            {isActive && (
                                <span className="absolute bottom-0 left-2 right-2 h-0.5 bg-cyan-500 rounded-full" />
                            )}
                        </button>
                    );
                })}
            </div>

            {/* Panel Content */}
            {renderPanel()}
        </div>
    );
};
