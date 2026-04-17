/**
 * useAddTrip Hook
 * 
 * Custom hook that encapsulates all logic for adding trips to the schedule.
 * Extracts ~120 lines of logic from FixedRouteWorkspace.
 */

import { useState, useCallback } from 'react';
import { MasterRouteTable } from '../utils/parsers/masterScheduleParser';
import type { ConnectionLibrary } from '../utils/connections/connectionTypes';
import {
    applyAddTripResultToSchedules,
    buildAddTripModalContext,
    buildEditTripModalContext,
    applyEditTripResultToSchedules,
    type AddTripPlacement,
    type AddTripModalContext,
    type AddTripResult
} from '../utils/schedule/addTripPlanner';

interface UseAddTripOptions {
    schedules: MasterRouteTable[];
    setSchedules: (schedules: MasterRouteTable[]) => void;
    onSuccess?: (message: string) => void;
    onTripsAdded?: (tripIds: string[]) => void;
    connectionLibrary?: ConnectionLibrary | null;
}

interface UseAddTripReturn {
    modalContext: AddTripModalContext | null;
    openModal: (anchorTripId: string, routeData: { north?: MasterRouteTable; south?: MasterRouteTable }, placement?: AddTripPlacement) => void;
    openEditModal: (tripId: string) => void;
    closeModal: () => void;
    handleConfirm: (result: AddTripResult, contextOverride?: AddTripModalContext) => void;
}

export const useAddTrip = ({
    schedules,
    setSchedules,
    onSuccess,
    onTripsAdded,
    connectionLibrary
}: UseAddTripOptions): UseAddTripReturn => {
    const [modalContext, setModalContext] = useState<AddTripModalContext | null>(null);

    /**
     * Opens the Add Trip Modal with context
     */
    const openModal = useCallback((
        anchorTripId: string,
        _routeData: { north?: MasterRouteTable; south?: MasterRouteTable },
        placement: AddTripPlacement = 'after'
    ) => {
        if (!anchorTripId) return;

        const modalContext = buildAddTripModalContext(
            schedules,
            anchorTripId,
            placement,
            connectionLibrary ?? null,
            _routeData.north && _routeData.south ? 'custom' : 'trip'
        );

        if (!modalContext) {
            console.error('Could not build add-trip context for trip id:', anchorTripId);
            return;
        }

        setModalContext(modalContext);
    }, [connectionLibrary, schedules]);

    const openEditModal = useCallback((tripId: string) => {
        if (!tripId) return;

        const modalContext = buildEditTripModalContext(
            schedules,
            tripId,
            connectionLibrary ?? null
        );

        if (!modalContext) {
            console.error('Could not build edit-trip context for trip id:', tripId);
            return;
        }

        setModalContext(modalContext);
    }, [connectionLibrary, schedules]);

    /**
     * Close the modal
     */
    const closeModal = useCallback(() => {
        setModalContext(null);
    }, []);

    /**
     * Handle confirmed add trip from modal
     */
    const handleConfirm = useCallback((modalResult: AddTripResult, contextOverride?: AddTripModalContext) => {
        const effectiveContext = contextOverride ?? modalContext;

        if (!effectiveContext) {
            console.error('No addTripModalContext!');
            return;
        }

        const {
            startTime,
            tripCount,
            serviceMode = 'trip',
            absorbShortTrailingGapIntoRecovery = false,
            blockId,
            blockMode,
            targetDirection,
            targetRouteName,
            startStopName,
            endStopName
        } = modalResult;

        if (effectiveContext.actionMode === 'edit') {
            const { schedules: newScheds, blockConflicts } = applyEditTripResultToSchedules(
                schedules,
                effectiveContext,
                {
                    startTime,
                    tripCount: 1,
                    serviceMode: 'trip',
                    absorbShortTrailingGapIntoRecovery: false,
                    blockMode: 'reference',
                    blockId: effectiveContext.referenceTrip.blockId,
                    targetDirection: effectiveContext.referenceTrip.direction,
                    targetRouteName: effectiveContext.targetTable.routeName,
                    startStopName,
                    endStopName
                }
            );

            if (blockConflicts.length > 0) {
                console.error('Edit trip would create a block conflict:', blockConflicts[0]);
                return;
            }

            setSchedules(newScheds);

            if (onSuccess) {
                const routeNum = effectiveContext.routeBaseName.split(' ')[0];
                const dayLabel = effectiveContext.targetTable.routeName.includes('(Saturday)')
                    ? 'Saturday'
                    : effectiveContext.targetTable.routeName.includes('(Sunday)')
                        ? 'Sunday'
                        : 'Weekday';
                const directionLabel = effectiveContext.referenceTrip.direction.toLowerCase();
                onSuccess(`✓ Updated ${directionLabel}bound trip on Route ${routeNum} (${dayLabel})`);
            }
        } else {
            const { schedules: newScheds, createdTripIds } = applyAddTripResultToSchedules(
                schedules,
                effectiveContext,
                {
                    startTime,
                    tripCount,
                    serviceMode,
                    absorbShortTrailingGapIntoRecovery,
                    blockMode,
                    blockId,
                    targetDirection,
                    targetRouteName,
                    startStopName,
                    endStopName
                }
            );

            setSchedules(newScheds);
            onTripsAdded?.(createdTripIds);

            // Show success message
            if (onSuccess) {
                const routeNum = effectiveContext.routeBaseName.split(' ')[0];
                const dayLabel = effectiveContext.targetTable.routeName.includes('(Saturday)')
                    ? 'Saturday'
                    : effectiveContext.targetTable.routeName.includes('(Sunday)')
                        ? 'Sunday'
                        : 'Weekday';
                if (serviceMode === 'cycle') {
                    const directionLabel = targetDirection === 'North' ? 'northbound' : 'southbound';
                    onSuccess(`✓ Added ${tripCount} full cycle${tripCount > 1 ? 's' : ''} starting ${directionLabel} on Route ${routeNum} (${dayLabel}) as block ${blockId}`);
                } else if (serviceMode === 'custom') {
                    const directionLabel = targetDirection === 'North' ? 'northbound' : 'southbound';
                    onSuccess(`✓ Added ${tripCount} custom round trip${tripCount > 1 ? 's' : ''} starting ${directionLabel} on Route ${routeNum} (${dayLabel}) as block ${blockId}`);
                } else {
                    const directionLabel = targetDirection === 'North' ? 'northbound' : 'southbound';
                    onSuccess(`✓ Added ${tripCount} ${directionLabel} trip${tripCount > 1 ? 's' : ''} to Route ${routeNum} (${dayLabel}) as block ${blockId}`);
                }
            }
        }

        setModalContext(null);
    }, [modalContext, schedules, setSchedules, onSuccess, onTripsAdded]);

    return {
        modalContext,
        openModal,
        openEditModal,
        closeModal,
        handleConfirm
    };
};
