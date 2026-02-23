import React, { useMemo, useRef, useState } from 'react';
import {
    ArrowLeft, RefreshCw, LayoutDashboard, Clock, TrendingUp,
    BarChart3, ExternalLink, Timer,
} from 'lucide-react';
import type { PerformanceDataSummary, PerformanceTab, DayType } from '../../utils/performanceDataTypes';
import { SystemOverviewModule } from './SystemOverviewModule';
import { OTPModule } from './OTPModule';
import { RidershipModule } from './RidershipModule';
import { LoadProfileModule } from './LoadProfileModule';
import { PerformanceFilterBar, filterDailySummaries, type TimeRange } from './PerformanceFilterBar';
import { OperatorDwellModule } from './OperatorDwellModule';
import { PerformanceScopeProvider } from './performanceScope';
import { getPerformanceScopeLabel, resolveFilteredScope } from '../../utils/performanceDataScope';

interface PerformanceWorkspaceProps {
    data: PerformanceDataSummary;
    onReimport: () => void;
    onBack: () => void;
}

interface TabConfig {
    id: PerformanceTab;
    label: string;
    icon: React.FC<{ size?: number }>;
    status: 'complete' | 'partial' | 'not-started';
}

const TAB_CONFIG: TabConfig[] = [
    { id: 'overview', label: 'Overview', icon: LayoutDashboard, status: 'complete' },
    { id: 'otp', label: 'OTP Analysis', icon: Clock, status: 'complete' },
    { id: 'ridership', label: 'Ridership', icon: TrendingUp, status: 'complete' },
    { id: 'load-profiles', label: 'Load Profiles', icon: BarChart3, status: 'complete' },
    { id: 'operator-dwell', label: 'Operator Dwell', icon: Timer, status: 'complete' },
];

const LOCALHOST_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1']);
const isLocalhost = () => typeof window !== 'undefined' && LOCALHOST_HOSTNAMES.has(window.location.hostname);

export const PerformanceWorkspace: React.FC<PerformanceWorkspaceProps> = ({ data, onReimport, onBack }) => {
    const allowIncompleteTabs = import.meta.env.DEV || isLocalhost();
    const tabs = useMemo(
        () => TAB_CONFIG.map(tab => ({ ...tab, enabled: tab.status === 'complete' || allowIncompleteTabs })),
        [allowIncompleteTabs]
    );
    const [activeTab, setActiveTab] = useState<PerformanceTab>('overview');
    const [timeRange, setTimeRange] = useState<TimeRange>('all');
    const [dayTypeFilter, setDayTypeFilter] = useState<DayType | 'all'>('all');
    const tabBarRef = useRef<HTMLDivElement>(null);

    const availableDayTypes = useMemo(() => {
        const types = new Set(data.dailySummaries.map(d => d.dayType));
        return (['weekday', 'saturday', 'sunday'] as DayType[]).filter(t => types.has(t));
    }, [data]);

    const filteredData = useMemo((): PerformanceDataSummary => ({
        ...data,
        dailySummaries: filterDailySummaries(data.dailySummaries, timeRange, dayTypeFilter),
    }), [data, timeRange, dayTypeFilter]);

    const handleNavigate = (tabId: string) => {
        const tab = tabs.find(t => t.id === tabId);
        if (tab?.enabled) {
            setActiveTab(tab.id);
            const tabEl = tabBarRef.current?.querySelector(`[data-tab="${tabId}"]`);
            tabEl?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
        }
    };

    const showFilterBar = activeTab !== 'overview';
    const filteredScope = useMemo(() => resolveFilteredScope(timeRange), [timeRange]);
    const filteredScopeLabel = useMemo(() => getPerformanceScopeLabel(filteredScope), [filteredScope]);

    const renderPanel = () => {
        switch (activeTab) {
            case 'overview':
                return <SystemOverviewModule data={data} onNavigate={handleNavigate} />;
            case 'otp':
                return (
                    <PerformanceScopeProvider scope={filteredScope}>
                        <OTPModule data={filteredData} />
                    </PerformanceScopeProvider>
                );
            case 'ridership':
                return (
                    <PerformanceScopeProvider scope={filteredScope}>
                        <RidershipModule data={filteredData} />
                    </PerformanceScopeProvider>
                );
            case 'load-profiles':
                return (
                    <PerformanceScopeProvider scope={filteredScope}>
                        <LoadProfileModule data={filteredData} />
                    </PerformanceScopeProvider>
                );
            case 'operator-dwell':
                return (
                    <PerformanceScopeProvider scope={filteredScope}>
                        <OperatorDwellModule data={filteredData} />
                    </PerformanceScopeProvider>
                );
            default:
                return null;
        }
    };

    return (
        <div className="space-y-0">
            {/* Header */}
            <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                    <button
                        onClick={onBack}
                        className="flex items-center gap-1.5 text-gray-400 hover:text-gray-600 text-sm font-medium transition-colors"
                    >
                        <ArrowLeft size={14} /> Back
                    </button>
                    <div className="h-4 w-px bg-gray-300" />
                    <h2 className="text-lg font-bold text-gray-900">Operations Dashboard</h2>
                    <span className="text-xs text-gray-400">
                        {data.metadata.dateRange.start} — {data.metadata.dateRange.end}
                        {' · '}{data.metadata.dayCount} day{data.metadata.dayCount !== 1 ? 's' : ''}
                    </span>
                </div>
                <button
                    onClick={onReimport}
                    className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
                >
                    <RefreshCw size={14} />
                    Re-import
                </button>
            </div>

            {/* Tab Bar */}
            <div className="border-b border-gray-200 bg-gray-50/50 rounded-t-lg">
                <div ref={tabBarRef} className="flex overflow-x-auto scrollbar-hide">
                    {tabs.map(tab => {
                        const isActive = activeTab === tab.id;
                        const Icon = tab.icon;
                        return (
                            <button
                                key={tab.id}
                                data-tab={tab.id}
                                disabled={!tab.enabled}
                                onClick={() => tab.enabled && setActiveTab(tab.id)}
                                className={`relative flex items-center gap-1.5 px-4 py-3 text-sm font-medium whitespace-nowrap transition-colors ${
                                    isActive
                                        ? 'text-gray-900'
                                        : tab.enabled
                                            ? 'text-gray-500 hover:text-gray-700'
                                            : 'text-gray-300 cursor-not-allowed'
                                }`}
                            >
                                <Icon size={15} />
                                {tab.label}
                                {tab.status === 'not-started' && tab.enabled && (
                                    <span className="ml-1 px-1.5 py-0.5 text-[9px] font-bold bg-gray-200 text-gray-500 rounded-full uppercase">Soon</span>
                                )}
                                {isActive && (
                                    <span className="absolute bottom-0 left-2 right-2 h-0.5 bg-cyan-500 rounded-full" />
                                )}
                            </button>
                        );
                    })}
                    <div className="ml-auto flex items-center pr-2">
                        <button
                            onClick={() => { window.location.hash = 'operations/perf-reports'; }}
                            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-cyan-600 hover:text-cyan-700 hover:bg-cyan-50 rounded-md transition-colors whitespace-nowrap"
                        >
                            <ExternalLink size={13} />
                            STREETS Reports
                        </button>
                    </div>
                </div>
            </div>

            {/* Filter Bar */}
            {showFilterBar && (
                <div className="bg-white border border-t-0 border-gray-200 px-5">
                    <PerformanceFilterBar
                        timeRange={timeRange}
                        onTimeRangeChange={setTimeRange}
                        dayTypeFilter={dayTypeFilter}
                        onDayTypeChange={setDayTypeFilter}
                        availableDayTypes={availableDayTypes}
                        filteredDayCount={filteredData.dailySummaries.length}
                    />
                </div>
            )}

            {/* Panel */}
            <div className="bg-white border border-t-0 border-gray-200 rounded-b-lg p-5 min-h-[500px]">
                {activeTab !== 'overview' && (
                    <div className="mb-4">
                        <span className={`inline-flex items-center px-2.5 py-1 text-xs font-semibold rounded-full ${
                            filteredScope === 'yesterday'
                                ? 'bg-cyan-50 text-cyan-700 border border-cyan-100'
                                : 'bg-gray-100 text-gray-600 border border-gray-200'
                        }`}>
                            {filteredScopeLabel}
                        </span>
                    </div>
                )}
                {renderPanel()}
            </div>
        </div>
    );
};
