/**
 * useAddTrip Hook
 * 
 * Custom hook that encapsulates all logic for adding trips to the schedule.
 * Extracts ~120 lines of logic from FixedRouteWorkspace.
 */

import { useState, useCallback } from 'react';
import { MasterRouteTable, MasterTrip, validateRouteTable } from '../utils/parsers/masterScheduleParser';
import { TimeUtils } from '../utils/timeUtils';
import { getDayTypeSuffix, getDayTypeLabel, parseBlockId } from '../utils/config/routeNameParser';
import type { AddTripModalContext, AddTripResult } from '../components/AddTripModal';

// Deep clone helper
const deepCloneSchedules = (schedules: MasterRouteTable[]): MasterRouteTable[] => {
    return JSON.parse(JSON.stringify(schedules));
};

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
    onSuccess
}: UseAddTripOptions): UseAddTripReturn => {
    const [modalContext, setModalContext] = useState<AddTripModalContext | null>(null);

    /**
     * Opens the Add Trip Modal with context
     */
    const openModal = useCallback((
        afterTripId: string,
        _routeData: { north?: MasterRouteTable; south?: MasterRouteTable }
    ) => {
        console.log('openAddTripModal called with afterTripId:', afterTripId);
        if (!afterTripId) return;

        const result = findTableAndTrip(schedules, afterTripId);
        if (!result) {
            console.error('Could not find trip with id:', afterTripId);
            return;
        }

        const referenceTrip = result.trip;
        const targetTable = result.table;
        console.log('Found reference trip:', referenceTrip.id, 'blockId:', referenceTrip.blockId, 'in table:', targetTable.routeName);

        // Find the "next" trip in the schedule (for midpoint calculation)
        const sortedTrips = [...targetTable.trips].sort((a, b) => a.startTime - b.startTime);
        const refIdx = sortedTrips.findIndex(t => t.id === afterTripId);
        const nextTrip = refIdx >= 0 && refIdx < sortedTrips.length - 1 ? sortedTrips[refIdx + 1] : null;

        // Get route base name for block ID generation
        const routeBaseName = targetTable.routeName
            .replace(/ \(North\).*$/, '')
            .replace(/ \(South\).*$/, '');
        console.log('Setting modal context with routeBaseName:', routeBaseName);

        setModalContext({
            referenceTrip,
            nextTrip,
            targetTable,
            allSchedules: schedules,
            routeBaseName
        });
    }, [schedules]);

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
        console.log('handleAddTripFromModal called with:', modalResult);
        if (!modalContext) {
            console.error('No addTripModalContext!');
            return;
        }

        const { referenceTrip, targetTable: origTable, routeBaseName } = modalContext;
        const { startTime, tripCount, newBlockId } = modalResult;

        console.log('Reference trip:', referenceTrip);
        console.log('Original table routeName:', origTable.routeName);
        console.log('Route base name:', routeBaseName);

        // Deep clone for undo/redo integrity
        const newScheds = deepCloneSchedules(schedules);
        console.log('Cloned schedules count:', newScheds.length);

        // Find the cloned version of the original target table
        const clonedOrigTable = newScheds.find(t => t.routeName === origTable.routeName);
        if (!clonedOrigTable) {
            console.error('Could not find cloned target table with name:', origTable.routeName);
            console.log('Available route names:', newScheds.map(t => t.routeName));
            setModalContext(null);
            return;
        }
        console.log('Found clonedOrigTable:', clonedOrigTable.routeName);

        // Find related tables in cloned schedules (for bidirectional routes)
        const baseName = routeBaseName;
        const northTable = newScheds.find(t => t.routeName === baseName + ' (North)');
        const southTable = newScheds.find(t => t.routeName === baseName + ' (South)');
        const isBidirectional = northTable && southTable;
        console.log('isBidirectional:', isBidirectional, 'northTable:', !!northTable, 'southTable:', !!southTable);

        // Create trips
        const travelTime = referenceTrip.travelTime || 30;
        const recoveryTime = referenceTrip.recoveryTime || 0;
        let currentTime = startTime;
        let currentDirection = referenceTrip.direction || 'North';
        console.log('Creating trips - travelTime:', travelTime, 'recoveryTime:', recoveryTime, 'startTime:', startTime);

        // Calculate stop-to-stop intervals from reference trip
        const getStopIntervals = (refTrip: MasterTrip, stops: string[]): number[] => {
            const intervals: number[] = [];
            for (let i = 0; i < stops.length - 1; i++) {
                const currentStopTime = TimeUtils.toMinutes(refTrip.stops[stops[i]]);
                const nextStopTime = TimeUtils.toMinutes(refTrip.stops[stops[i + 1]]);
                if (currentStopTime !== null && nextStopTime !== null) {
                    intervals.push(nextStopTime - currentStopTime);
                } else {
                    intervals.push(Math.round(travelTime / Math.max(stops.length - 1, 1)));
                }
            }
            return intervals;
        };

        for (let i = 0; i < tripCount; i++) {
            // Determine target table based on direction
            let targetTable: MasterRouteTable | undefined;
            if (isBidirectional) {
                targetTable = currentDirection === 'North' ? northTable : southTable;
            } else {
                targetTable = clonedOrigTable;
            }
            if (!targetTable) {
                console.error('No target table found for trip', i);
                continue;
            }
            console.log('Adding trip', i, 'to table:', targetTable.routeName);

            const tripEndTime = currentTime + travelTime;

            // Use reference trip's stop intervals for more accurate times
            const stopIntervals = getStopIntervals(referenceTrip, targetTable.stops);
            const newStops: Record<string, string> = {};
            let stopTime = currentTime;
            targetTable.stops.forEach((stop, idx) => {
                newStops[stop] = TimeUtils.fromMinutes(stopTime);
                if (idx < stopIntervals.length) {
                    stopTime += stopIntervals[idx];
                }
            });

            const newTrip: MasterTrip = {
                id: `trip_${Date.now()}_${Math.floor(Math.random() * 10000)}_${i}`,
                rowId: Date.now() + i,
                blockId: newBlockId,
                direction: currentDirection,
                tripNumber: i + 1,
                startTime: currentTime,
                endTime: tripEndTime,
                travelTime: travelTime,
                recoveryTime: recoveryTime,
                stops: newStops,
                cycleTime: travelTime + recoveryTime
            };
            console.log('Created newTrip:', JSON.stringify(newTrip, null, 2));

            targetTable.trips.push(newTrip);
            targetTable.trips.sort((a, b) => a.startTime - b.startTime);
            validateRouteTable(targetTable);

            // Setup for next trip
            currentTime = tripEndTime + recoveryTime;
            if (isBidirectional) {
                currentDirection = currentDirection === 'North' ? 'South' : 'North';
            }
        }

        // Debug: show trips in the table after adding
        console.log('Trips added! New trip count in clonedOrigTable:', clonedOrigTable.trips.length);
        console.log('Last few trips:', clonedOrigTable.trips.slice(-3).map(t => ({ id: t.id, blockId: t.blockId, startTime: t.startTime })));
        console.log('Calling setSchedules with newScheds:', newScheds.length, 'tables');

        setSchedules(newScheds);

        // Show success message
        if (onSuccess) {
            const routeNum = routeBaseName.split(' ')[0];
            const dayLabel = getDayTypeLabel(routeBaseName);
            onSuccess(`✓ Added ${tripCount} trip${tripCount > 1 ? 's' : ''} to Route ${routeNum} (${dayLabel}) as block ${newBlockId}`);
        }

        console.log('setSchedules completed, closing modal');
        setModalContext(null);
    }, [modalContext, schedules, setSchedules, onSuccess]);

    return {
        modalContext,
        openModal,
        closeModal,
        handleConfirm
    };
};
