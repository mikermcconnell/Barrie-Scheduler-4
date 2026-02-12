import type { MasterScheduleContent } from '../masterScheduleTypes';
import type { HubConfig } from './platformConfig';
import type { DwellEvent, HubAnalysis } from './types';
import { getDwellTimes } from './time';
import { matchStopToPlatform } from './platformMatcher';
import { getRouteDirections } from '../config/routeDirectionConfig';

interface TripHubEventIndex {
    platformEvents: DwellEvent[];
    eventIndex: number;
}

function createEventUid(
    tripId: string,
    hubName: string,
    platformId: string,
    arrivalMin: number,
    departureMin: number,
    counter: number
): string {
    return `${tripId}:${hubName}:${platformId}:${arrivalMin}:${departureMin}:${counter}`;
}

function normalizeRouteToken(value: string | undefined): string | null {
    if (!value) return null;
    const token = value.trim().toUpperCase().match(/\d+[A-Z]?/)?.[0];
    return token || null;
}

function getDirectionalRouteVariant(routeNumber: string, direction: 'North' | 'South'): string {
    const normalized = routeNumber.trim().toUpperCase();
    if (!normalized) return 'UNKNOWN';

    const directions = getRouteDirections(normalized);
    if (!directions) return normalized;

    const rawVariant = direction === 'North'
        ? directions.north.variant
        : directions.south.variant;

    return normalizeRouteToken(rawVariant) || normalized;
}

/**
 * Populate dwell events on initialized hub/platform analysis buckets.
 */
export function populateDwellEvents(
    scheduleContents: MasterScheduleContent[],
    routeNumbers: string[],
    hubAnalyses: Map<string, HubAnalysis>,
    hubList: HubConfig[]
): void {
    let dwellEventCounter = 0;

    for (let i = 0; i < scheduleContents.length; i++) {
        const content = scheduleContents[i];
        const routeNumber = routeNumbers[i] || content.metadata?.routeNumber || 'Unknown';

        for (const table of [content.northTable, content.southTable]) {
            if (!table?.trips) continue;

            const direction = table === content.northTable ? 'North' : 'South';
            const directionalRoute = getDirectionalRouteVariant(routeNumber, direction);

            // Track merged events per trip per hub (to merge arrival/departure columns)
            // Key: `${tripId}-${hubName}-${platformId}` → event index in platform.events
            const tripHubEvents = new Map<string, TripHubEventIndex>();

            for (const trip of table.trips) {
                // For each stop in the trip
                for (const [stopName, departureTime] of Object.entries(trip.stops)) {
                    if (!departureTime) continue;

                    // Get stop ID for precise matching (try original name first, then normalized)
                    const normalizedStopName = stopName
                        .replace(/\s*\(\d+\)\s*$/, '')
                        .replace(/\s+\d+\s*$/, '')
                        .trim();
                    const stopId = table.stopIds?.[stopName] || table.stopIds?.[normalizedStopName];
                    const normalizedStopId = stopId?.trim() || undefined;

                    const platformMatch = matchStopToPlatform(stopName, stopId, directionalRoute, hubList);
                    if (!platformMatch) continue;

                    const hubAnalysis = hubAnalyses.get(platformMatch.hubName);
                    if (!hubAnalysis) continue;

                    const platform = hubAnalysis.platforms.find(
                        p => p.platformId === platformMatch.platformId
                    );
                    if (!platform) continue;

                    // Calculate times (handles both scheduleGenerator and GTFS conventions)
                    let { arrivalMin, departureMin } = getDwellTimes(trip, stopName);

                    // Skip invalid times
                    if (departureMin < 0 || arrivalMin < 0) continue;

                    // Handle post-midnight trips
                    if (arrivalMin > departureMin && arrivalMin > 1200 && departureMin < 240) {
                        departureMin += 1440;
                    }
                    if (arrivalMin > departureMin) continue;

                    // Create key for merging arrival/departure at same hub
                    // Merges "Park Place" + "Park Place (2)" terminal ARR→R→DEP patterns,
                    // but NOT loop routes (e.g., Route 100 departing Downtown, looping, returning)
                    const mergeKey = `${trip.id}-${platformMatch.hubName}-${platformMatch.platformId}`;
                    const existing = tripHubEvents.get(mergeKey);

                    // Only merge if times overlap or are within 10 min (terminal dwell pattern).
                    // If gap > 10 min, this is a loop route returning to same hub — create separate event.
                    const MERGE_GAP_THRESHOLD = 10;
                    const MERGE_OVERLAP_THRESHOLD = 10;
                    if (existing) {
                        const event = existing.platformEvents[existing.eventIndex];
                        const gap = arrivalMin - event.departureMin;
                        // Guard against pathological negative gaps (e.g., later stop parsed after midnight
                        // as a low minute value). Those should be treated as separate visits.
                        const shouldMerge = gap <= MERGE_GAP_THRESHOLD && gap >= -MERGE_OVERLAP_THRESHOLD;
                        if (shouldMerge) {
                            // Merge: terminal dwell (close/overlapping times)
                            event.arrivalMin = Math.min(event.arrivalMin, arrivalMin);
                            event.departureMin = Math.max(event.departureMin, departureMin);
                        } else {
                            // Separate visit: loop route returning to same hub
                            const returnTripId = `${trip.id}-return`;
                            const newEvent: DwellEvent = {
                                eventUid: createEventUid(
                                    returnTripId,
                                    platformMatch.hubName,
                                    platformMatch.platformId,
                                    arrivalMin,
                                    departureMin,
                                    dwellEventCounter++
                                ),
                                tripId: returnTripId,
                                route: directionalRoute,
                                direction,
                                arrivalMin,
                                departureMin,
                                blockId: trip.blockId,
                                gtfsBlockId: trip.gtfsBlockId?.trim() || undefined,
                                stopName: platformMatch.normalizedStopName,
                                stopId: normalizedStopId
                            };
                            platform.events.push(newEvent);
                            // Update merge key to point to the latest event for any further merges
                            tripHubEvents.set(mergeKey, {
                                platformEvents: platform.events,
                                eventIndex: platform.events.length - 1
                            });
                        }
                    } else {
                        // Create new event
                        const newEvent: DwellEvent = {
                            eventUid: createEventUid(
                                trip.id,
                                platformMatch.hubName,
                                platformMatch.platformId,
                                arrivalMin,
                                departureMin,
                                dwellEventCounter++
                            ),
                            tripId: trip.id,
                            route: directionalRoute,
                            direction,
                            arrivalMin,
                            departureMin,
                            blockId: trip.blockId,
                            gtfsBlockId: trip.gtfsBlockId?.trim() || undefined,
                            stopName: platformMatch.normalizedStopName,
                            stopId: normalizedStopId
                        };
                        const eventIndex = platform.events.length;
                        platform.events.push(newEvent);
                        tripHubEvents.set(mergeKey, { platformEvents: platform.events, eventIndex });
                    }
                }
            }
        }
    }
}
