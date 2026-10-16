import { useCallback, useMemo, useState } from 'react';
import { usePerformanceDataQuery, usePerformanceMetadataQuery } from '../../hooks/usePerformanceData';
import {
    getAvailableRuntimeRoutes,
    getStep2CleanHistoryWindow,
    getStep2CleanPerformanceSummary,
    inspectPerformanceRuntimeAvailability,
} from '../../utils/performanceRuntimeComputer';
import type { DayType as PerfDayType } from '../../utils/performanceDataTypes';
import { buildFullPerformanceLoadRouteIds } from '../NewSchedule/utils/performanceRouteLoadOptions';
import type { PerformanceConfig } from '../NewSchedule/steps/Step1Upload';
import type { GuidedDayType } from './runtimeReview/guidedRuntimeReviewTypes';

/**
 * STREETS performance data for Step 1. Loads one route's history at a time
 * (the selected route, or the first available) and exposes the clean
 * post-fix history that Step 2 is allowed to use.
 */
export const useGuidedPerformanceSource = (teamId: string | undefined) => {
    const [dayType, setDayType] = useState<GuidedDayType>('Weekday');
    const [performanceConfig, setPerformanceConfig] = useState<PerformanceConfig>({ routeId: '', dateRange: null });
    const [loadRouteSelection, setLoadRouteSelection] = useState<string | null>(null);

    const metadataQuery = usePerformanceMetadataQuery(teamId);
    const loadRouteIds = useMemo(() => {
        const routeIds = [
            ...Object.keys(metadataQuery.data?.routeStoragePaths || {}),
            ...Object.keys(metadataQuery.data?.routeMonthlyStoragePaths || {}),
        ];
        return routeIds.length > 0 ? buildFullPerformanceLoadRouteIds(routeIds) : [];
    }, [metadataQuery.data?.routeMonthlyStoragePaths, metadataQuery.data?.routeStoragePaths]);

    const loadRouteId = useMemo(() => {
        if (loadRouteSelection) return loadRouteSelection;
        const configured = performanceConfig.routeId.trim();
        if (configured && loadRouteIds.includes(configured)) return configured;
        return loadRouteIds[0] ?? 'all';
    }, [loadRouteIds, loadRouteSelection, performanceConfig.routeId]);

    const dataQuery = usePerformanceDataQuery(teamId, !metadataQuery.isLoading, metadataQuery.data, loadRouteId);
    const perfData = dataQuery.data;
    const cleanData = useMemo(() => getStep2CleanPerformanceSummary(perfData), [perfData]);

    const historyStatus = useMemo(() => {
        if (!perfData) return null;
        const cleanWindow = getStep2CleanHistoryWindow(perfData.dailySummaries || [], perfData.metadata);
        return {
            totalDays: perfData.dailySummaries?.length ?? 0,
            cleanDays: cleanWindow.dailySummaries.length,
            runtimeLogicVersion: perfData.metadata?.runtimeLogicVersion,
            cleanHistoryStartDate: cleanWindow.cleanHistoryStartDate,
            excludedLegacyDayCount: cleanWindow.excludedLegacyDayCount,
            usesCleanHistoryCutoff: cleanWindow.usesCleanHistoryCutoff,
        };
    }, [perfData]);

    const availableRoutes = useMemo(() => (
        cleanData?.dailySummaries
            ? getAvailableRuntimeRoutes(
                cleanData.dailySummaries,
                dayType.toLowerCase() as PerfDayType,
                performanceConfig.dateRange || undefined
            )
            : []
    ), [cleanData?.dailySummaries, dayType, performanceConfig.dateRange]);

    const availableDateRange = cleanData?.metadata?.dateRange;

    const diagnostics = useMemo(() => {
        if (!perfData?.dailySummaries || !performanceConfig.routeId) return null;
        return inspectPerformanceRuntimeAvailability(perfData.dailySummaries, {
            routeId: performanceConfig.routeId,
            dayType: dayType.toLowerCase() as PerfDayType,
            dateRange: performanceConfig.dateRange || undefined,
            metadata: perfData.metadata,
        });
    }, [dayType, perfData?.dailySummaries, perfData?.metadata, performanceConfig.dateRange, performanceConfig.routeId]);

    const changeLoadRoute = useCallback((routeId: string) => {
        setLoadRouteSelection(routeId);
        if (routeId !== 'all') setPerformanceConfig(prev => ({ ...prev, routeId }));
    }, []);

    const errorMessage = (error: unknown, fallback: string): string | null => (
        error instanceof Error ? error.message : error ? fallback : null
    );

    return {
        dayType,
        setDayType,
        performanceConfig,
        setPerformanceConfig,
        loadRouteId,
        loadRouteIds,
        changeLoadRoute,
        cleanData,
        historyStatus,
        availableRoutes,
        availableDateRange,
        diagnostics,
        dataLoading: dataQuery.isLoading,
        metadataLoading: metadataQuery.isLoading,
        dataError: errorMessage(dataQuery.error, 'Unknown data loading error.'),
        metadataError: errorMessage(metadataQuery.error, 'Unknown route-list error.'),
        retryData: () => { void dataQuery.refetch(); },
        retryMetadata: () => { void metadataQuery.refetch(); },
    };
};

export type GuidedPerformanceSource = ReturnType<typeof useGuidedPerformanceSource>;
