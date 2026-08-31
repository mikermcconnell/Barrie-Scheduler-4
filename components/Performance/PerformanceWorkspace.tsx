import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    ArrowLeft, RefreshCw, LayoutDashboard, Clock, TrendingUp,
    ExternalLink, Timer, Loader2,
} from 'lucide-react';
import type {
    PerformanceDataLoadOptions,
    PerformanceDataSummary,
    PerformanceDetailMode,
    PerformanceMetadata,
    PerformanceTab,
    DayType,
} from '../../utils/performanceDataTypes';
import { PerformanceFilterBar, TIME_RANGE_LABELS, filterDailySummaries, getPerformanceDateWindow, type PerformanceDateWindow, type TimeRange } from './PerformanceFilterBar';
import { PerformanceScopeProvider } from './performanceScope';
import { resolveFilteredScope } from '../../utils/performanceDataScope';
import { addDaysToISODate } from '../../utils/performanceDateUtils';
import { getPriorStopActivityPeriod } from '../../utils/performanceStopActivity';
import { lazyWithRetry } from '../../utils/lazyWithRetry';
import { PerformanceImportHealthPanel } from './PerformanceImportHealthPanel';
import { isFeatureEnabled, isFeatureUnderConstruction } from '../../utils/features';
import { useWorkspaceAccess } from '../../hooks/useWorkspaceAccess';
import type { PerformanceRouteOption } from '../../utils/performanceRouteFilter';
import { usePerformanceDataQuery } from '../../hooks/usePerformanceData';
import { selectedDayScopeLabel } from '../../utils/performanceMetricDisplay';
import { PerformanceLoadStatus } from './PerformanceLoadStatus';

interface PerformanceWorkspaceProps {
    data: PerformanceDataSummary;
    onReimport: () => void;
    canReimport?: boolean;
    onBack: () => void;
    teamId?: string;
    requestingTeamId?: string;
    metadata?: PerformanceMetadata | null;
    selectedRouteId?: string;
    routeOptions?: PerformanceRouteOption[];
    onRouteChange?: (routeId: string) => void;
    loadConfigTeamId?: string;
    loadConfigUserId?: string;
    canManageLoadConfig?: boolean;
}

interface TabConfig {
    id: PerformanceTab;
    label: string;
    icon: React.FC<{ size?: number }>;
    status: 'complete' | 'partial' | 'not-started';
    badge?: string;
    feature?: Parameters<typeof isFeatureEnabled>[0];
}

const TAB_CONFIG: TabConfig[] = [
    { id: 'overview', label: 'Overview', icon: LayoutDashboard, status: 'complete' },
    { id: 'otp', label: 'OTP Analysis', icon: Clock, status: 'complete' },
    { id: 'ridership', label: 'Ridership', icon: TrendingUp, status: 'complete' },
    { id: 'operator-dwell', label: 'Dwell Incident Review', icon: Timer, status: 'complete', badge: 'Testing', feature: 'operationsOperatorDwell' },
];

const LOCALHOST_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1']);
const isLocalhost = () => typeof window !== 'undefined' && LOCALHOST_HOSTNAMES.has(window.location.hostname);

function withFilteredMetadata(
    data: PerformanceDataSummary,
    dailySummaries: PerformanceDataSummary['dailySummaries'],
): PerformanceDataSummary {
    const sortedDates = dailySummaries.map(day => day.date).sort();
    const totalRecords = dailySummaries.reduce((sum, day) => sum + day.dataQuality.totalRecords, 0);
    return {
        ...data,
        dailySummaries,
        metadata: {
            ...data.metadata,
            dateRange: sortedDates.length > 0
                ? { start: sortedDates[0], end: sortedDates[sortedDates.length - 1] }
                : data.metadata.dateRange,
            dayCount: dailySummaries.length,
            totalRecords,
        },
    };
}

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

const PerformancePanelError: React.FC<{ onRetry: () => void }> = ({ onRetry }) => (
    <div role="alert" className="mx-auto flex min-h-[280px] max-w-xl flex-col items-center justify-center rounded-xl border border-red-200 bg-red-50 px-6 text-center">
        <h3 className="font-bold text-red-900">Performance details could not be loaded</h3>
        <p className="mt-2 text-sm text-red-800">The dashboard will not substitute incomplete overview data. Try the request again.</p>
        <button type="button" onClick={onRetry} className="mt-4 min-h-11 rounded-lg border border-red-300 bg-white px-4 py-2 text-sm font-semibold text-red-800 hover:bg-red-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400">
            Try again
        </button>
    </div>
);

function resolveDetailDateRange(
    metadata: PerformanceMetadata | null | undefined,
    timeRange: TimeRange,
    selectedDate: string | null,
    customDateRange: PerformanceDateWindow | null,
    includeComparisonPeriod = false,
): PerformanceDataLoadOptions['dateRange'] | undefined {
    const end = metadata?.dateRange?.end;
    if (!end) return undefined;

    if (timeRange === 'all') return undefined;
    if (timeRange === 'custom') {
        if (!customDateRange?.start || !customDateRange.end || customDateRange.start > customDateRange.end) {
            return undefined;
        }
        if (!includeComparisonPeriod) return customDateRange;
        const startMs = Date.parse(`${customDateRange.start}T00:00:00Z`);
        const endMs = Date.parse(`${customDateRange.end}T00:00:00Z`);
        if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return customDateRange;
        const calendarDays = Math.round((endMs - startMs) / (24 * 60 * 60 * 1000)) + 1;
        return {
            start: addDaysToISODate(customDateRange.start, -calendarDays) || customDateRange.start,
            end: customDateRange.end,
        };
    }
    if (timeRange === 'single-day') {
        const date = selectedDate || end;
        return {
            start: includeComparisonPeriod ? (addDaysToISODate(date, -7) || date) : date,
            end: date,
        };
    }
    if (timeRange === 'yesterday') {
        const start = addDaysToISODate(end, includeComparisonPeriod ? -8 : -7) || end;
        return { start, end };
    }

    const currentDaysBack = timeRange === 'past-week'
        ? 6
        : timeRange === 'past-month'
            ? 29
            : 89;
    const daysBack = includeComparisonPeriod
        ? ((currentDaysBack + 1) * 2) - 1
        : currentDaysBack;
    return { start: addDaysToISODate(end, -daysBack) || end, end };
}

function detailModeForTab(tab: PerformanceTab): PerformanceDetailMode {
    return tab === 'reports' ? 'all' : tab;
}

export const PerformanceWorkspace: React.FC<PerformanceWorkspaceProps> = ({
    data,
    onReimport,
    canReimport = true,
    onBack,
    teamId,
    requestingTeamId,
    metadata,
    selectedRouteId = 'all',
    routeOptions = [],
    onRouteChange,
    loadConfigTeamId,
    loadConfigUserId,
    canManageLoadConfig = false,
}) => {
    const { canAccess } = useWorkspaceAccess();
    const allowIncompleteTabs = import.meta.env.DEV || isLocalhost();
    const [activeTab, setActiveTab] = useState<PerformanceTab>('overview');
    const [timeRange, setTimeRangeState] = useState<TimeRange>('past-week');
    const [selectedDate, setSelectedDate] = useState<string | null>(null);
    const [customDateRange, setCustomDateRange] = useState<PerformanceDateWindow | null>(null);
    const [dayTypeFilter, setDayTypeFilter] = useState<DayType | 'all'>('all');

    const tabBarRef = useRef<HTMLDivElement>(null);
    const hasValidCustomRange = timeRange !== 'custom'
        || !!(customDateRange?.start && customDateRange.end && customDateRange.start <= customDateRange.end);
    const detailOptions = useMemo<PerformanceDataLoadOptions | undefined>(() => ({
        dateRange: resolveDetailDateRange(metadata, timeRange, selectedDate, customDateRange, activeTab === 'ridership'),
        detailMode: detailModeForTab(activeTab),
    }), [activeTab, customDateRange, metadata, selectedDate, timeRange]);
    const shouldLoadDetailData = !!teamId && !!metadata && hasValidCustomRange && (
        activeTab !== 'overview'
        || timeRange === 'all'
        || timeRange === 'past-month'
        || timeRange === 'past-three-months'
        || timeRange === 'yesterday'
        || timeRange === 'single-day'
        || timeRange === 'custom'
    );
    const detailQuery = usePerformanceDataQuery(
        teamId,
        shouldLoadDetailData,
        metadata,
        selectedRouteId,
        requestingTeamId,
        detailOptions,
    );
    const detailData = detailQuery.data ?? null;
    const detailLoadFailed = shouldLoadDetailData && detailQuery.isError;
    const isCurrentDetailLoading = shouldLoadDetailData && detailQuery.isFetching && !detailData;
    const isPendingDetailLoad = shouldLoadDetailData && !detailData && !detailLoadFailed;
    const detailsReady = !shouldLoadDetailData || !!detailData;
    const workspaceData = detailData ?? data;
    const showImportHealthPanel = !import.meta.env.PROD
        && detailsReady
        && isFeatureEnabled('operationsImportHealth');
    const tabs = useMemo(
        () => TAB_CONFIG
            .filter(tab => !tab.feature || canAccess(tab.feature))
            .map(tab => ({
                ...tab,
                enabled: tab.id === 'overview'
                    ? true
                    : (tab.status === 'complete' || allowIncompleteTabs),
            })),
        [allowIncompleteTabs, canAccess]
    );
    const activeTabConfig = tabs.find(tab => tab.id === activeTab);
    const showUnderConstructionNotice = !!activeTabConfig?.feature && isFeatureUnderConstruction(activeTabConfig.feature);

    const availableDayTypes = useMemo(() => {
        const types = new Set(workspaceData.dailySummaries.map(d => d.dayType));
        return (['weekday', 'saturday', 'sunday'] as DayType[]).filter(t => types.has(t));
    }, [workspaceData]);

    const availableDates = useMemo(
        () => [...new Set(workspaceData.dailySummaries.map(d => d.date))].sort(),
        [workspaceData.dailySummaries]
    );
    const latestAvailableDate = availableDates.at(-1) ?? null;
    const minAvailableDate = metadata?.dateRange.start || availableDates[0];
    const maxAvailableDate = metadata?.dateRange.end || latestAvailableDate || undefined;

    const setTimeRange = useCallback((tr: TimeRange) => {
        if (tr === 'custom') {
            setCustomDateRange(previous => previous ?? (maxAvailableDate
                ? {
                    start: [addDaysToISODate(maxAvailableDate, -6) || maxAvailableDate, minAvailableDate]
                        .filter((date): date is string => !!date)
                        .sort()
                        .at(-1) || maxAvailableDate,
                    end: maxAvailableDate,
                }
                : null));
        }
        setTimeRangeState(tr);
        if (tr === 'single-day') {
            setSelectedDate(prev => prev ?? latestAvailableDate);
        }
    }, [latestAvailableDate, maxAvailableDate, minAvailableDate]);

    const filteredData = useMemo((): PerformanceDataSummary => {
        if (isPendingDetailLoad) {
            return data;
        }
        const dailySummaries = filterDailySummaries(
            workspaceData.dailySummaries,
            timeRange,
            dayTypeFilter,
            selectedDate,
            customDateRange,
        );
        return withFilteredMetadata(workspaceData, dailySummaries);
    }, [customDateRange, data, dayTypeFilter, isPendingDetailLoad, selectedDate, timeRange, workspaceData]);

    const ridershipComparisonPeriod = useMemo(() => {
        if (activeTab !== 'ridership' || timeRange === 'all') return null;
        const currentWindow = getPerformanceDateWindow(
            workspaceData.dailySummaries,
            timeRange,
            selectedDate,
            customDateRange,
        );
        return currentWindow
            ? getPriorStopActivityPeriod(workspaceData.dailySummaries, currentWindow, dayTypeFilter)
            : null;
    }, [activeTab, customDateRange, dayTypeFilter, selectedDate, timeRange, workspaceData.dailySummaries]);

    useEffect(() => {
        if (timeRange !== 'single-day') return;
        if (selectedDate && availableDates.includes(selectedDate)) return;
        setSelectedDate(latestAvailableDate);
    }, [timeRange, selectedDate, availableDates, latestAvailableDate]);

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
    const selectedRoute = routeOptions.find(route => route.routeId === selectedRouteId);
    const routeScopeLabel = selectedRouteId === 'all'
        ? 'All routes'
        : `Route ${selectedRoute?.routeId ?? selectedRouteId}`;
    const filteredScope = useMemo(() => resolveFilteredScope(timeRange), [timeRange]);
    const requestedLoadLabel = useMemo(() => {
        const rangeLabel = timeRange === 'custom' && customDateRange
            ? `${customDateRange.start} to ${customDateRange.end}`
            : TIME_RANGE_LABELS[timeRange];
        return `${rangeLabel} · ${routeScopeLabel} · ${activeTabConfig?.label ?? 'Overview'}`;
    }, [activeTabConfig?.label, customDateRange, routeScopeLabel, timeRange]);

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
        return selectedDayScopeLabel(n, dayTypeFilter);
    }, [filteredData, filteredScope, dayTypeFilter]);

    const renderPanel = () => {
        if (detailLoadFailed) return <PerformancePanelError onRetry={() => { void detailQuery.refetch(); }} />;
        switch (activeTab) {
            case 'overview':
                return (
                    <SystemOverviewModule
                        data={filteredData}
                        allData={workspaceData}
                        onNavigate={handleNavigate}
                        scope={filteredScope}
                        scopeLabel={filteredScopeLabel}
                        dayTypeFilter={dayTypeFilter}
                    />
                );
            case 'otp':
                if (isCurrentDetailLoading) return <PerformancePanelLoading label="Loading OTP details..." />;
                return (
                    <PerformanceScopeProvider scope={filteredScope} label={filteredScopeLabel}>
                        <OTPModule data={filteredData} />
                    </PerformanceScopeProvider>
                );
            case 'ridership':
                if (isCurrentDetailLoading) return <PerformancePanelLoading label="Loading ridership details..." />;
                return (
                    <PerformanceScopeProvider scope={filteredScope} label={filteredScopeLabel}>
                        <RidershipModule
                            data={filteredData}
                            dayTypeFilter={dayTypeFilter}
                            loadConfigTeamId={loadConfigTeamId}
                            loadConfigUserId={loadConfigUserId}
                            canManageLoadConfig={canManageLoadConfig}
                            comparisonDays={ridershipComparisonPeriod?.days ?? []}
                            comparisonRange={ridershipComparisonPeriod
                                ? { start: ridershipComparisonPeriod.startDate, end: ridershipComparisonPeriod.endDate }
                                : null}
                        />
                    </PerformanceScopeProvider>
                );
            case 'operator-dwell':
                if (isCurrentDetailLoading) return <PerformancePanelLoading label="Loading dwell incident evidence..." />;
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
            <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex flex-wrap items-center gap-3">
                    <button
                        onClick={onBack}
                        className="flex min-h-11 items-center gap-1.5 text-sm font-medium text-gray-500 transition-colors hover:text-gray-700"
                    >
                        <ArrowLeft size={14} /> Back
                    </button>
                    <div className="h-4 w-px bg-gray-300" />
                    <h2 className="text-lg font-bold text-gray-900">Operations Dashboard</h2>
                    <span className="text-xs text-gray-500">
                        {filteredData.metadata.dateRange.start} — {filteredData.metadata.dateRange.end}
                        {' · '}{filteredData.metadata.dayCount} day{filteredData.metadata.dayCount !== 1 ? 's' : ''}
                        {' · '}{routeScopeLabel}
                    </span>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    {onRouteChange && (
                        <select
                            aria-label="Filter dashboard by route"
                            value={selectedRouteId}
                            onChange={(event) => onRouteChange(event.target.value)}
                            className="min-h-11 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm font-semibold text-gray-700 shadow-sm focus:border-cyan-400 focus:outline-none focus:ring-2 focus:ring-cyan-100"
                        >
                            <option value="all">All routes</option>
                            {routeOptions.map(route => (
                                <option key={route.routeId} value={route.routeId}>
                                    Route {route.routeId}{route.routeName ? ` — ${route.routeName}` : ''}
                                </option>
                            ))}
                        </select>
                    )}
                    {canReimport && (
                        <button
                            onClick={onReimport}
                            className="flex min-h-11 items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700"
                        >
                            <RefreshCw size={14} />
                            Re-import
                        </button>
                    )}
                </div>
            </div>

            {showImportHealthPanel && (
                <>
                    {isFeatureUnderConstruction('operationsImportHealth') && (
                        <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                            <div className="font-semibold">Under construction</div>
                            <div className="mt-1 text-amber-800">
                                This import-health panel is available in demo mode for preview, but it is still being refined and may change.
                            </div>
                        </div>
                    )}
                    <PerformanceImportHealthPanel data={data} />
                </>
            )}

            {isPendingDetailLoad && (
                <div className="mb-3">
                    <PerformanceLoadStatus
                        isLoading={detailQuery.isFetching}
                        profileKey={detailQuery.loadProfileKey ?? 'operations:detail'}
                        progress={detailQuery.loadProgress}
                        label={requestedLoadLabel}
                        description={`Showing ${data.metadata.dateRange.start} to ${data.metadata.dateRange.end} on Overview until the requested data is ready.`}
                    />
                </div>
            )}

            {showUnderConstructionNotice && (
                <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                    <div className="font-semibold">Under construction</div>
                    <div className="mt-1 text-amber-800">
                        This tab is available in demo mode for preview, but it is still being refined and may change.
                    </div>
                </div>
            )}

            {/* Tab Bar */}
            <div className="border-b border-gray-200 bg-gray-50/50 rounded-t-lg">
                <div ref={tabBarRef} className="flex overflow-x-auto scrollbar-hide" role="group" aria-label="Operations dashboard sections">
                    {tabs.map(tab => {
                        const isActive = activeTab === tab.id;
                        const Icon = tab.icon;
                        return (
                            <button
                                key={tab.id}
                                data-tab={tab.id}
                                aria-pressed={isActive}
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
                                {tab.feature && isFeatureUnderConstruction(tab.feature) && (
                                    <span className="ml-1 px-1.5 py-0.5 text-[9px] font-bold bg-amber-100 text-amber-700 border border-amber-200 rounded-full uppercase">Under Construction</span>
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
                            className="flex min-h-11 items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-medium text-cyan-600 transition-colors hover:bg-cyan-50 hover:text-cyan-700"
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
                        customDateRange={customDateRange}
                        onCustomDateRangeChange={setCustomDateRange}
                        availableDates={availableDates}
                        minAvailableDate={minAvailableDate}
                        maxAvailableDate={maxAvailableDate}
                        dayTypeFilter={dayTypeFilter}
                        onDayTypeChange={setDayTypeFilter}
                        availableDayTypes={availableDayTypes}
                        filteredDayCount={filteredData.dailySummaries.length}
                    />
                    </div>
                )}

            {/* Panel */}
            <div className="min-h-[500px] rounded-b-lg border border-t-0 border-gray-200 bg-white p-5">
                <div className="mb-4">
                    <span className="inline-flex items-center px-2.5 py-1 text-xs font-semibold rounded-full bg-cyan-50 text-cyan-700 border border-cyan-100">
                        {filteredScopeLabel}
                    </span>
                    {detailQuery.isFetching && detailData && (
                        <div className="ml-2 inline-block align-middle">
                            <PerformanceLoadStatus
                                isLoading
                                profileKey={detailQuery.loadProfileKey ?? 'operations:detail'}
                                progress={detailQuery.loadProgress}
                                label={requestedLoadLabel}
                                compact
                            />
                        </div>
                    )}
                </div>
                <Suspense fallback={<PerformancePanelLoading label="Loading panel..." />}>
                    {renderPanel()}
                </Suspense>
            </div>
        </div>
    );
};
