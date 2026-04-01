/**
 * useAddTrip Hook
 * 
 * Custom hook that encapsulates all logic for adding trips to the schedule.
 * Extracts ~120 lines of logic from FixedRouteWorkspace.
 */

import { useState, useCallback } from 'react';
import { MasterRouteTable, type MasterTrip } from '../utils/parsers/masterScheduleParser';
import type { ConnectionLibrary } from '../utils/connections/connectionTypes';
import {
    applyAddTripResultToSchedules,
    stripScheduleDecorators,
    type AddTripModalContext,
    type AddTripResult
} from '../utils/schedule/addTripPlanner';

// Find table and trip by ID
const findTableAndTrip = (
    schedules: MasterRouteTable[],
    tripId: string
): { table: MasterRouteTable; trip: MasterTrip; tableIdx: number } | null => {
    for (let i = 0; i < schedules.length; i++) {
        const trip = schedules[i].trips.find(t => t.id === tripId);
        if (trip) return { table: schedules[i], trip, tableIdx: i };
    }
    return null;
};

interface UseAddTripOptions {
    schedules: MasterRouteTable[];
    setSchedules: (schedules: MasterRouteTable[]) => void;
    onSuccess?: (message: string) => void;
    onTripsAdded?: (tripIds: string[]) => void;
    connectionLibrary?: ConnectionLibrary | null;
}

interface UseAddTripReturn {
    modalContext: AddTripModalContext | null;
    openModal: (afterTripId: string, routeData: { north?: MasterRouteTable; south?: MasterRouteTable }) => void;
    closeModal: () => void;
    handleConfirm: (result: AddTripResult) => void;
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
        afterTripId: string,
        _routeData: { north?: MasterRouteTable; south?: MasterRouteTable }
    ) => {
        if (!afterTripId) return;

        const result = findTableAndTrip(schedules, afterTripId);
        if (!result) {
            console.error('Could not find trip with id:', afterTripId);
            return;
        }

        const referenceTrip = result.trip;
        const targetTable = result.table;

        // Find the "next" trip in the schedule (for midpoint calculation)
        const sortedTrips = [...targetTable.trips].sort((a, b) => a.startTime - b.startTime);
        const refIdx = sortedTrips.findIndex(t => t.id === afterTripId);
        const nextTrip = refIdx >= 0 && refIdx < sortedTrips.length - 1 ? sortedTrips[refIdx + 1] : null;

        // Get route base name for block ID generation
        const routeBaseName = stripScheduleDecorators(targetTable.routeName);

        setModalContext({
            referenceTrip,
            nextTrip,
            targetTable,
            allSchedules: schedules,
            routeBaseName,
            connectionLibrary: connectionLibrary ?? null
        });
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
    const handleConfirm = useCallback((modalResult: AddTripResult) => {
        if (!modalContext) {
            console.error('No addTripModalContext!');
            return;
        }

        const { startTime, tripCount, blockId, blockMode, targetDirection, targetRouteName, startStopName, endStopName } = modalResult;

        const { schedules: newScheds, createdTripIds } = applyAddTripResultToSchedules(
            schedules,
            modalContext,
            {
                startTime,
                tripCount,
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
            const routeNum = modalContext.routeBaseName.split(' ')[0];
            const dayLabel = modalContext.targetTable.routeName.includes('(Saturday)')
                ? 'Saturday'
                : modalContext.targetTable.routeName.includes('(Sunday)')
                    ? 'Sunday'
                    : 'Weekday';
            const directionLabel = targetDirection === 'North' ? 'northbound' : 'southbound';
            onSuccess(`✓ Added ${tripCount} ${directionLabel} trip${tripCount > 1 ? 's' : ''} to Route ${routeNum} (${dayLabel}) as block ${blockId}`);
        }

        setModalContext(null);
    }, [modalContext, schedules, setSchedules, onSuccess, onTripsAdded]);

    return {
        modalContext,
        openModal,
        closeModal,
        handleConfirm
    };
};
