import { useCallback, useMemo, useState } from 'react';
import { usePerformanceDataQuery, usePerformanceMetadataQuery } from '../../hooks/usePerformanceData';
import {
    getStep2CleanHistoryWindow,
    getStep2CleanPerformanceSummary,
    inspectPerformanceRuntimeAvailability,
    type PerformanceRuntimeDiagnostics,
} from '../../utils/performanceRuntimeComputer';
import type { DayType as PerfDayType } from '../../utils/performanceDataTypes';
import { buildFullPerformanceLoadRouteIds } from '../NewSchedule/utils/performanceRouteLoadOptions';
import {
    buildDayTypeReadiness,
    EMPTY_GUIDED_SELECTION,
    selectGuidedRoute,
    toggleGuidedDayType,
    type GuidedSelection,
} from './guidedSelection';
import type { GuidedDateRange, GuidedDayType } from './runtimeReview/guidedRuntimeReviewTypes';

/**
 * STREETS performance data for Step 1. Nothing is selected or loaded until
 * the planner picks a route; then that route's clean post-fix history loads.
 */
export const useGuidedPerformanceSource = (teamId: string | undefined) => {
    const [selection, setSelection] = useState<GuidedSelection>(EMPTY_GUIDED_SELECTION);

    const metadataQuery = usePerformanceMetadataQuery(teamId);
    const routeIds = useMemo(() => {
        const ids = [
            ...Object.keys(metadataQuery.data?.routeStoragePaths || {}),
            ...Object.keys(metadataQuery.data?.routeMonthlyStoragePaths || {}),
        ];
        return ids.length > 0 ? buildFullPerformanceLoadRouteIds(ids) : [];
    }, [metadataQuery.data?.routeMonthlyStoragePaths, metadataQuery.data?.routeStoragePaths]);

    const dataQuery = usePerformanceDataQuery(
        teamId,
        !!selection.routeId && !metadataQuery.isLoading,
        metadataQuery.data,
        selection.routeId
    );
    const perfData = selection.routeId ? dataQuery.data : undefined;
    const cleanData = useMemo(() => getStep2CleanPerformanceSummary(perfData), [perfData]);

    const historyStatus = useMemo(() => {
        if (!perfData) return null;
        const cleanWindow = getStep2CleanHistoryWindow(perfData.dailySummaries || [], perfData.metadata);
        return {
            totalDays: perfData.dailySummaries?.length ?? 0,
            cleanDays: cleanWindow.dailySummaries.length,
            cleanHistoryStartDate: cleanWindow.cleanHistoryStartDate,
            excludedLegacyDayCount: cleanWindow.excludedLegacyDayCount,
        };
    }, [perfData]);

    const readiness = useMemo(
        () => buildDayTypeReadiness(cleanData?.dailySummaries, selection.routeId, selection.dateRange),
        [cleanData?.dailySummaries, selection.dateRange, selection.routeId]
    );

    const diagnosticsFor = useCallback((dayType: GuidedDayType): PerformanceRuntimeDiagnostics | null => {
        if (!perfData?.dailySummaries || !selection.routeId) return null;
        return inspectPerformanceRuntimeAvailability(perfData.dailySummaries, {
            routeId: selection.routeId,
            dayType: dayType.toLowerCase() as PerfDayType,
            dateRange: selection.dateRange ?? undefined,
            metadata: perfData.metadata,
        });
    }, [perfData?.dailySummaries, perfData?.metadata, selection.dateRange, selection.routeId]);

    const errorMessage = (error: unknown, fallback: string): string | null => (
        error instanceof Error ? error.message : error ? fallback : null
    );

    return {
        selection,
        selectRoute: (routeId: string) => setSelection(current => selectGuidedRoute(current, routeId)),
        toggleDayType: (dayType: GuidedDayType) => setSelection(current => toggleGuidedDayType(current, dayType)),
        setDateRange: (dateRange: GuidedDateRange | null) => setSelection(current => ({ ...current, dateRange })),
        routeIds,
        cleanData,
        historyStatus,
        readiness,
        availableDateRange: cleanData?.metadata?.dateRange as GuidedDateRange | undefined,
        diagnosticsFor,
        dataLoading: !!selection.routeId && dataQuery.isLoading,
        metadataLoading: metadataQuery.isLoading,
        dataError: selection.routeId ? errorMessage(dataQuery.error, 'Unknown data loading error.') : null,
        metadataError: errorMessage(metadataQuery.error, 'Unknown route-list error.'),
        retryData: () => { void dataQuery.refetch(); },
        retryMetadata: () => { void metadataQuery.refetch(); },
    };
};

export type GuidedPerformanceSource = ReturnType<typeof useGuidedPerformanceSource>;
