import { getGoTrainEvents } from './connectionAnalysis';
import type { GoTrainEvent, RegionalGoFeed } from './types';

/** A simulated GO timetable change for demonstrating before/after connections. Never published data. */
export interface DemoGoChange {
    feed: RegionalGoFeed;
    summary: string[];
}

const DEMO_TRAIN_NUMBER = 'DEMO';

function shiftGtfsTime(value: string, minutes: number): string {
    const match = /^(\d+):(\d{2}):(\d{2})$/.exec(value.trim());
    if (!match) return value;
    const total = Math.max(0, Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) + minutes * 60);
    const pad = (part: number) => String(part).padStart(2, '0');
    return `${pad(Math.floor(total / 3600))}:${pad(Math.floor(total / 60) % 60)}:${pad(total % 60)}`;
}

function shiftTrip(stopTimes: RegionalGoFeed['stopTimes'], tripId: string, minutes: number, newTripId = tripId): RegionalGoFeed['stopTimes'] {
    return stopTimes.filter(time => time.trip_id === tripId).map(time => ({
        ...time, trip_id: newTripId, arrival_time: shiftGtfsTime(time.arrival_time, minutes), departure_time: shiftGtfsTime(time.departure_time, minutes),
    }));
}

function trainLabel(event: GoTrainEvent): string {
    return event.trainNumber ? `Train ${event.trainNumber}` : `GO trip ${event.tripId}`;
}

/**
 * Builds a demo "after" timetable from the live feed on one service date, using Allandale's trains:
 * one To GO train later, one From GO train earlier, the last From GO train removed and one To GO train added.
 */
export function buildDemoGoChange(feed: RegionalGoFeed, date: string): DemoGoChange | null {
    const result = getGoTrainEvents(feed, 'allandale', date);
    if (result.status !== 'ready') return null;
    const toGo = result.events.filter(event => event.direction === 'to-go');
    const fromGo = result.events.filter(event => event.direction === 'from-go');
    if (toGo.length < 2 || fromGo.length < 3) return null;

    const later = toGo[1];
    const earlier = fromGo[Math.floor(fromGo.length / 2)];
    const removed = fromGo[fromGo.length - 1];
    const template = toGo[0];
    const addedTripId = `${template.tripId}-demo`;
    const shifts = new Map([[later.tripId, 8], [earlier.tripId, -10]]);

    const stopTimes = feed.stopTimes
        .filter(time => time.trip_id !== removed.tripId && !shifts.has(time.trip_id))
        .concat(...[...shifts].map(([tripId, minutes]) => shiftTrip(feed.stopTimes, tripId, minutes)))
        .concat(shiftTrip(feed.stopTimes, template.tripId, 30, addedTripId));
    const templateTrip = feed.trips.find(trip => trip.trip_id === template.tripId)!;
    const trips = feed.trips
        .filter(trip => trip.trip_id !== removed.tripId)
        .concat({ ...templateTrip, trip_id: addedTripId, trip_short_name: DEMO_TRAIN_NUMBER });

    return {
        feed: { ...feed, trips, stopTimes },
        summary: [
            `${trainLabel(later)} (To GO) leaves 8 minutes later.`,
            `${trainLabel(earlier)} (From GO) arrives 10 minutes earlier.`,
            `${trainLabel(removed)} (From GO, last arrival) is cancelled.`,
            `A new To GO train (${DEMO_TRAIN_NUMBER}) runs 30 minutes after ${trainLabel(template)}.`,
        ],
    };
}
