import routesRaw from '../../gtfs/routes.txt?raw';
import tripsRaw from '../../gtfs/trips.txt?raw';
import calendarRaw from '../../gtfs/calendar.txt?raw';
import feedInfoRaw from '../../gtfs/feed_info.txt?raw';
import {
    buildStrategicPlanServiceProfile,
    type StrategicPlanServiceProfile,
} from './serviceProfile';

async function loadStopTimes(): Promise<string> {
    if (import.meta.env.MODE === 'test') {
        const rawModule = await import('../../gtfs/stop_times.txt?raw');
        return rawModule.default;
    }

    const urlModule = await import('../../gtfs/stop_times.txt?url');
    const response = await fetch(urlModule.default);
    if (!response.ok) {
        throw new Error(`Failed to load bundled GTFS stop times (${response.status}).`);
    }
    return response.text();
}

let profilePromise: Promise<StrategicPlanServiceProfile> | null = null;

export function loadStrategicPlanServiceProfile(): Promise<StrategicPlanServiceProfile> {
    if (!profilePromise) {
        profilePromise = loadStopTimes().then(stopTimes => buildStrategicPlanServiceProfile({
            routes: routesRaw,
            trips: tripsRaw,
            stopTimes,
            calendar: calendarRaw,
            feedInfo: feedInfoRaw,
        }));
    }
    return profilePromise;
}
