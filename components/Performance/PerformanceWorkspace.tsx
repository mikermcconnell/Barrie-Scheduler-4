import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    ArrowLeft, RefreshCw, LayoutDashboard, Clock, TrendingUp,
    BarChart3, ExternalLink, Timer, Loader2,
} from 'lucide-react';
import type { PerformanceDataSummary, PerformanceTab, DayType } from '../../utils/performanceDataTypes';
import { PerformanceFilterBar, filterDailySummaries, type TimeRange } from './PerformanceFilterBar';
import { PerformanceScopeProvider } from './performanceScope';
import { resolveFilteredScope } from '../../utils/performanceDataScope';
import { lazyWithRetry } from '../../utils/lazyWithRetry';
import { PerformanceImportHealthPanel } from './PerformanceImportHealthPanel';
import { isFeatureEnabled } from '../../utils/features';

interface PerformanceWorkspaceProps {
    data: PerformanceDataSummary;
    onReimport: () => void;
    onBack: () => void;
    detailsReady?: boolean;
}

interface TabConfig {
    id: PerformanceTab;
    label: string;
    icon: React.FC<{ size?: number }>;
    status: 'complete' | 'partial' | 'not-started';
    badge?: string;
}

const TAB_CONFIG: TabConfig[] = [
    { id: 'overview', label: 'Overview', icon: LayoutDashboard, status: 'complete' },
    { id: 'otp', label: 'OTP Analysis', icon: Clock, status: 'complete' },
    { id: 'ridership', label: 'Ridership', icon: TrendingUp, status: 'complete' },
    { id: 'load-profiles', label: 'Load Profiles', icon: BarChart3, status: 'complete', badge: 'Testing' },
    { id: 'operator-dwell', label: 'Operator Dwell', icon: Timer, status: 'complete', badge: 'Testing' },
];

const PERFORMANCE_TAB_FEATURES: Partial<Record<PerformanceTab, Parameters<typeof isFeatureEnabled>[0]>> = {
    'load-profiles': 'operationsLoadProfiles',
    'operator-dwell': 'operationsOperatorDwell',
};

const isPerformanceTabVisible = (tabId: PerformanceTab): boolean => {
    const feature = PERFORMANCE_TAB_FEATURES[tabId];
    return feature ? isFeatureEnabled(feature) : true;
};
const DAY_TYPE_LABELS: Record<DayType, string> = { weekday: 'Weekday', saturday: 'Saturday', sunday: 'Sunday' };

const LOCALHOST_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1']);
const isLocalhost = () => typeof window !== 'undefined' && LOCALHOST_HOSTNAMES.has(window.location.hostname);

const SystemOverviewModule = lazyWithRetry(
    () => import('./SystemOverviewModule').then(module => ({ default: module.SystemOverviewModule })),
    'performance-system-overview',
);
const OTPModule = lazyWithRetry(
    () => import('./OTPModule').then(module => ({ default: module.OTPModule })),
    'performance-otp-module',
);
const RidershipModule = lazyWithRetry(
    () => import('./RidershipModule').then(module => ({ default: module.RidershipModule })),
    'performance-ridership-module',
);
const LoadProfileModule = lazyWithRetry(
    () => import('./LoadProfileModule').then(module => ({ default: module.LoadProfileModule })),
    'performance-load-profiles-module',
);
const OperatorDwellModule = lazyWithRetry(
    () => import('./OperatorDwellModule').then(module => ({ default: module.OperatorDwellModule })),
    'performance-operator-dwell-module',
);

const PerformancePanelLoading: React.FC<{ label: string }> = ({ label }) => (
    <div className="flex min-h-[320px] items-center justify-center">
        <div className="flex flex-col items-center gap-3 text-gray-500">
            <Loader2 className="animate-spin text-cyan-500" size={28} />
            <span className="text-sm font-medium">{label}</span>
        </div>
    </div>
);

const OVERVIEW_ONLY_TIME_RANGES: TimeRange[] = ['past-week', 'single-day'];

export const PerformanceWorkspace: React.FC<PerformanceWorkspaceProps> = ({ data, onReimport, onBack, detailsReady = true }) => {
    const allowIncompleteTabs = import.meta.env.DEV || isLocalhost();
    const tabs = useMemo(
        () => TAB_CONFIG
            .filter(tab => isPerformanceTabVisible(tab.id))
            .map(tab => ({
                ...tab,
                enabled: tab.id === 'overview'
                    ? true
                    : detailsReady && (tab.status === 'complete' || allowIncompleteTabs),
            })),
        [allowIncompleteTabs, detailsReady]
    );
    const [activeTab, setActiveTab] = useState<PerformanceTab>('overview');
    const [timeRanges, setTimeRanges] = useState<Partial<Record<PerformanceTab, TimeRange>>>({});
    const [selectedDate, setSelectedDate] = useState<string | null>(null);
    const [dayTypeFilter, setDayTypeFilter] = useState<DayType | 'all'>('all');

    const timeRange = timeRanges[activeTab] ?? 'past-week';
    const tabBarRef = useRef<HTMLDivElement>(null);
    const allowedTimeRanges = detailsReady ? undefined : OVERVIEW_ONLY_TIME_RANGES;

    const availableDayTypes = useMemo(() => {
        const types = new Set(data.dailySummaries.map(d => d.dayType));
        return (['weekday', 'saturday', 'sunday'] as DayType[]).filter(t => types.has(t));
    }, [data]);

    const availableDates = useMemo(
        () => [...new Set(data.dailySummaries.map(d => d.date))].sort(),
        [data.dailySummaries]
    );
    const latestAvailableDate = availableDates.at(-1) ?? null;

    const setTimeRange = useCallback((tr: TimeRange) => {
        setTimeRanges(prev => ({ ...prev, [activeTab]: tr }));
        if (tr === 'single-day') {
            setSelectedDate(prev => prev ?? latestAvailableDate);
            return;
        }
        setSelectedDate(null);
    }, [activeTab, latestAvailableDate]);

    const filteredData = useMemo((): PerformanceDataSummary => ({
        ...data,
        dailySummaries: filterDailySummaries(data.dailySummaries, timeRange, dayTypeFilter, selectedDate),
    }), [data, timeRange, dayTypeFilter, selectedDate]);

    useEffect(() => {
        if (timeRange !== 'single-day') return;
        if (selectedDate && availableDates.includes(selectedDate)) return;
        setSelectedDate(latestAvailableDate);
    }, [timeRange, selectedDate, availableDates, latestAvailableDate]);

    useEffect(() => {
        if (detailsReady) return;
        if (activeTab !== 'overview') {
            setActiveTab('overview');
        }
        if (!OVERVIEW_ONLY_TIME_RANGES.includes(timeRange)) {
            setTimeRanges(prev => ({ ...prev, overview: 'past-week' }));
            setSelectedDate(null);
        }
    }, [activeTab, detailsReady, timeRange]);

    useEffect(() => {
        if (tabs.some(tab => tab.id === activeTab)) return;
        setActiveTab(tabs[0]?.id ?? 'overview');
    }, [activeTab, tabs]);

    const handleNavigate = (tabId: string) => {
        const tab = tabs.find(t => t.id === tabId);
        if (tab?.enabled) {
            setActiveTab(tab.id);
            const tabEl = tabBarRef.current?.querySelector(`[data-tab="${tabId}"]`);
            tabEl?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
        }
    };

    const showFilterBar = true;
    const filteredScope = useMemo(() => resolveFilteredScope(timeRange), [timeRange]);

    const filteredScopeLabel = useMemo(() => {
        const n = filteredData.dailySummaries.length;
        if (n === 0) return 'No data';
        if (filteredScope === 'yesterday') {
            const d = filteredData.dailySummaries[0];
            if (d) {
                const dt = new Date(d.date + 'T12:00:00');
                return dt.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
            }
            return 'Single day';
        }
        if (dayTypeFilter !== 'all') {
            return `${n} ${DAY_TYPE_LABELS[dayTypeFilter]}${n !== 1 ? 's' : ''} avg`;
        }
        return `${n}-day avg`;
    }, [filteredData, filteredScope, dayTypeFilter]);

    const renderPanel = () => {
        switch (activeTab) {
            case 'overview':
                return (
                    <SystemOverviewModule
                        data={filteredData}
                        onNavigate={handleNavigate}
                        scope={filteredScope}
                        scopeLabel={filteredScopeLabel}
                        dayTypeFilter={dayTypeFilter}
                    />
                );
            case 'otp':
                return (
                    <PerformanceScopeProvider scope={filteredScope} label={filteredScopeLabel}>
                        <OTPModule data={filteredData} />
                    </PerformanceScopeProvider>
                );
            case 'ridership':
                return (
                    <PerformanceScopeProvider scope={filteredScope} label={filteredScopeLabel}>
                        <RidershipModule data={filteredData} />
                    </PerformanceScopeProvider>
                );
            case 'load-profiles':
                return (
                    <PerformanceScopeProvider scope={filteredScope} label={filteredScopeLabel}>
                        <LoadProfileModule data={filteredData} />
                    </PerformanceScopeProvider>
                );
            case 'operator-dwell':
                return (
                    <PerformanceScopeProvider scope={filteredScope} label={filteredScopeLabel}>
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

            {detailsReady && isFeatureEnabled('operationsImportHealth') && (
                <PerformanceImportHealthPanel data={data} />
            )}

            {!detailsReady && (
                <div className="mb-3 rounded-xl border border-cyan-200 bg-cyan-50/70 px-4 py-3 text-sm text-cyan-800">
                    Showing the most recent 7 days on Overview first. Detailed tabs are still loading in the background.
                </div>
            )}

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
                                {!detailsReady && tab.id !== 'overview' && (
                                    <span className="ml-1 px-1.5 py-0.5 text-[9px] font-bold bg-cyan-100 text-cyan-700 border border-cyan-200 rounded-full uppercase">Loading</span>
                                )}
                                {tab.badge && (
                                    <span className="ml-1 px-1.5 py-0.5 text-[9px] font-bold bg-amber-100 text-amber-700 border border-amber-200 rounded-full uppercase">{tab.badge}</span>
                                )}
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
                        selectedDate={selectedDate}
                        onSelectedDateChange={setSelectedDate}
                            availableDates={availableDates}
                            dayTypeFilter={dayTypeFilter}
                            onDayTypeChange={setDayTypeFilter}
                            availableDayTypes={availableDayTypes}
                            filteredDayCount={filteredData.dailySummaries.length}
                            allowedTimeRanges={allowedTimeRanges}
                        />
                    </div>
                )}

            {/* Panel */}
            <div className="bg-white border border-t-0 border-gray-200 rounded-b-lg p-5 min-h-[500px]">
                <div className="mb-4">
                    <span className="inline-flex items-center px-2.5 py-1 text-xs font-semibold rounded-full bg-cyan-50 text-cyan-700 border border-cyan-100">
                        {filteredScopeLabel}
                    </span>
                </div>
                <Suspense fallback={<PerformancePanelLoading label="Loading panel..." />}>
                    {renderPanel()}
                </Suspense>
            </div>
        </div>
    );
};
