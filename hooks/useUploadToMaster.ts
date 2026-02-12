/**
 * useUploadToMaster Hook
 *
 * Extracted from ScheduleEditor.tsx to handle:
 * - Single route upload to Master Schedule
 * - Bulk upload multiple routes
 * - Upload confirmation and progress tracking
 */

import { useState, useMemo, useCallback } from 'react';
import type { MasterRouteTable } from '../utils/parsers/masterScheduleParser';
import type { DayType, UploadConfirmation } from '../utils/masterScheduleTypes';
import { uploadToMasterSchedule, prepareUpload } from '../utils/services/masterScheduleService';
import type { RouteForUpload } from '../components/modals/BulkUploadToMasterModal';

export interface ConsolidatedRoute {
    name: string;
    days: Record<string, {
        north?: MasterRouteTable;
        south?: MasterRouteTable;
    }>;
}

export interface UploadResult {
    routeNumber: string;
    dayType: DayType;
    success: boolean;
    error?: string;
    newVersion?: number;
}

export interface UseUploadToMasterResult {
    // State
    showUploadModal: boolean;
    showBulkUploadModal: boolean;
    uploadConfirmation: UploadConfirmation | null;
    isUploading: boolean;
    routesForUpload: RouteForUpload[];

    // Actions
    initiateUpload: (routeNumber: string, dayType: DayType) => Promise<void>;
    confirmUpload: () => Promise<void>;
    cancelUpload: () => void;
    openBulkUpload: () => void;
    closeBulkUpload: () => void;
    handleBulkUpload: (routes: RouteForUpload[]) => Promise<UploadResult[]>;
}

export function useUploadToMaster(
    consolidatedRoutes: ConsolidatedRoute[],
    teamId?: string,
    userId?: string,
    uploaderName?: string,
    showSuccessToast?: (msg: string) => void
): UseUploadToMasterResult {
    // Upload state
    const [showUploadModal, setShowUploadModal] = useState(false);
    const [showBulkUploadModal, setShowBulkUploadModal] = useState(false);
    const [uploadConfirmation, setUploadConfirmation] = useState<UploadConfirmation | null>(null);
    const [isUploading, setIsUploading] = useState(false);
    const [uploadRouteKey, setUploadRouteKey] = useState<{ routeNumber: string; dayType: DayType } | null>(null);

    // Get routes available for upload
    const routesForUpload = useMemo((): RouteForUpload[] => {
        const result: RouteForUpload[] = [];
        consolidatedRoutes.forEach(group => {
            Object.entries(group.days).forEach(([dayType, dayData]) => {
                const north = dayData.north;
                const south = dayData.south;
                if (north || south) {
                    result.push({
                        routeNumber: group.name,
                        dayType: dayType as DayType,
                        displayName: `Route ${group.name} (${dayType})`,
                        tripCount: (north?.trips.length || 0) + (south?.trips.length || 0),
                        northStopCount: north?.stops.length || 0,
                        southStopCount: south?.stops.length || 0
                    });
                }
            });
        });
        return result;
    }, [consolidatedRoutes]);

    // Get North/South tables for a specific route-day
    const getTablesForRoute = useCallback((
        routeNumber: string,
        dayType: DayType
    ): { north: MasterRouteTable | null; south: MasterRouteTable | null } => {
        const group = consolidatedRoutes.find(g => g.name === routeNumber);
        if (!group) return { north: null, south: null };
        const dayData = group.days[dayType];
        if (!dayData) return { north: null, south: null };
        return { north: dayData.north || null, south: dayData.south || null };
    }, [consolidatedRoutes]);

    // Initiate single route upload
    const initiateUpload = useCallback(async (routeNumber: string, dayType: DayType) => {
        if (!teamId || !userId) {
            showSuccessToast?.('Please join a team to upload to Master Schedule');
            return;
        }

        const { north, south } = getTablesForRoute(routeNumber, dayType);
        if (!north && !south) {
            showSuccessToast?.('No schedule data found for this route');
            return;
        }

        try {
            const northTable = north || {
                routeName: `${routeNumber} (${dayType}) (North)`,
                stops: [],
                stopIds: {},
                trips: []
            };
            const southTable = south || {
                routeName: `${routeNumber} (${dayType}) (South)`,
                stops: [],
                stopIds: {},
                trips: []
            };

            const confirmation = await prepareUpload(teamId, northTable, southTable, routeNumber, dayType);
            setUploadConfirmation(confirmation);
            setUploadRouteKey({ routeNumber, dayType });
            setShowUploadModal(true);
        } catch (error) {
            console.error('Error preparing upload:', error);
            showSuccessToast?.('Failed to prepare upload');
        }
    }, [teamId, userId, getTablesForRoute, showSuccessToast]);

    // Confirm single route upload
    const confirmUpload = useCallback(async () => {
        if (!teamId || !userId || !uploaderName || !uploadRouteKey) return;

        setIsUploading(true);
        try {
            const { north, south } = getTablesForRoute(uploadRouteKey.routeNumber, uploadRouteKey.dayType);
            const northTable = north || {
                routeName: `${uploadRouteKey.routeNumber} (${uploadRouteKey.dayType}) (North)`,
                stops: [],
                stopIds: {},
                trips: []
            };
            const southTable = south || {
                routeName: `${uploadRouteKey.routeNumber} (${uploadRouteKey.dayType}) (South)`,
                stops: [],
                stopIds: {},
                trips: []
            };

            await uploadToMasterSchedule(
                teamId,
                userId,
                uploaderName,
                northTable,
                southTable,
                uploadRouteKey.routeNumber,
                uploadRouteKey.dayType,
                'tweaker'
            );

            showSuccessToast?.(`Route ${uploadRouteKey.routeNumber} (${uploadRouteKey.dayType}) uploaded to Master`);
            setShowUploadModal(false);
            setUploadConfirmation(null);
            setUploadRouteKey(null);
        } catch (error) {
            console.error('Error uploading to master:', error);
            showSuccessToast?.('Failed to upload to Master Schedule');
        } finally {
            setIsUploading(false);
        }
    }, [teamId, userId, uploaderName, uploadRouteKey, getTablesForRoute, showSuccessToast]);

    // Cancel upload
    const cancelUpload = useCallback(() => {
        setShowUploadModal(false);
        setUploadConfirmation(null);
        setUploadRouteKey(null);
    }, []);

    // Open bulk upload modal
    const openBulkUpload = useCallback(() => {
        setShowBulkUploadModal(true);
    }, []);

    // Close bulk upload modal
    const closeBulkUpload = useCallback(() => {
        setShowBulkUploadModal(false);
    }, []);

    // Bulk upload handler
    const handleBulkUpload = useCallback(async (selectedRoutes: RouteForUpload[]): Promise<UploadResult[]> => {
        if (!teamId || !userId || !uploaderName) return [];

        const results: UploadResult[] = [];

        for (const route of selectedRoutes) {
            try {
                const { north, south } = getTablesForRoute(route.routeNumber, route.dayType);
                const northTable = north || {
                    routeName: `${route.routeNumber} (${route.dayType}) (North)`,
                    stops: [],
                    stopIds: {},
                    trips: []
                };
                const southTable = south || {
                    routeName: `${route.routeNumber} (${route.dayType}) (South)`,
                    stops: [],
                    stopIds: {},
                    trips: []
                };

                const entry = await uploadToMasterSchedule(
                    teamId,
                    userId,
                    uploaderName,
                    northTable,
                    southTable,
                    route.routeNumber,
                    route.dayType,
                    'tweaker'
                );

                results.push({
                    routeNumber: route.routeNumber,
                    dayType: route.dayType,
                    success: true,
                    newVersion: entry.currentVersion
                });
            } catch (error) {
                results.push({
                    routeNumber: route.routeNumber,
                    dayType: route.dayType,
                    success: false,
                    error: error instanceof Error ? error.message : 'Unknown error'
                });
            }
        }

        const successCount = results.filter(r => r.success).length;
        if (successCount > 0) {
            showSuccessToast?.(`${successCount} route(s) uploaded to Master Schedule`);
        }

        return results;
    }, [teamId, userId, uploaderName, getTablesForRoute, showSuccessToast]);

    return {
        showUploadModal,
        showBulkUploadModal,
        uploadConfirmation,
        isUploading,
        routesForUpload,
        initiateUpload,
        confirmUpload,
        cancelUpload,
        openBulkUpload,
        closeBulkUpload,
        handleBulkUpload
    };
}
