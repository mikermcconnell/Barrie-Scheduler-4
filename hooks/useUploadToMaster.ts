/**
 * useUploadToMaster Hook
 *
 * The editor workflow now goes through draft -> publish only.
 * This hook remains as a safe compatibility shell, but it no longer
 * exposes direct upload actions into master schedules.
 */

import { useMemo, useCallback, useState } from 'react';
import type { MasterRouteTable } from '../utils/parsers/masterScheduleParser';
import type { DayType, UploadConfirmation } from '../utils/masterScheduleTypes';

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
    routesForUpload: never[];

    // Actions
    initiateUpload: (routeNumber: string, dayType: DayType) => Promise<void>;
    confirmUpload: () => Promise<void>;
    cancelUpload: () => void;
    openBulkUpload: () => void;
    closeBulkUpload: () => void;
    handleBulkUpload: (routes: never[]) => Promise<UploadResult[]>;
}

export function useUploadToMaster(
    _consolidatedRoutes: ConsolidatedRoute[],
    _teamId?: string,
    _userId?: string,
    _uploaderName?: string,
    showSuccessToast?: (msg: string) => void
): UseUploadToMasterResult {
    const [showUploadModal] = useState(false);
    const [showBulkUploadModal] = useState(false);
    const [uploadConfirmation] = useState<UploadConfirmation | null>(null);
    const [isUploading] = useState(false);

    const routesForUpload = useMemo<never[]>(() => [], []);

    const notifyDisabled = useCallback(() => {
        showSuccessToast?.('Upload to Master is no longer available here. Use Publish instead.');
    }, [showSuccessToast]);

    return {
        showUploadModal,
        showBulkUploadModal,
        uploadConfirmation,
        isUploading,
        routesForUpload,
        initiateUpload: async () => {
            notifyDisabled();
        },
        confirmUpload: async () => {
            notifyDisabled();
        },
        cancelUpload: () => {},
        openBulkUpload: () => {
            notifyDisabled();
        },
        closeBulkUpload: () => {},
        handleBulkUpload: async () => []
    };
}
