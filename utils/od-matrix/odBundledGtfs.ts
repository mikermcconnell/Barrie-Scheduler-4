import type { GtfsTextFileSet } from './odRouteEstimation';
import routesTxtUrl from '../../data/gtfs/ontario-northland/routes.txt?url';
import tripsTxtUrl from '../../data/gtfs/ontario-northland/trips.txt?url';
import stopTimesTxtUrl from '../../data/gtfs/ontario-northland/stop_times.txt?url';
import stopsTxtUrl from '../../data/gtfs/ontario-northland/stops.txt?url';

export const BUNDLED_OD_GTFS_FILE_NAME = 'Ontario Northland GTFS (bundled)';

let bundledGtfsPromise: Promise<GtfsTextFileSet> | null = null;

export async function loadBundledGtfsTextFiles(): Promise<GtfsTextFileSet> {
    if (!bundledGtfsPromise) {
        bundledGtfsPromise = Promise.all([
            fetch(routesTxtUrl),
            fetch(tripsTxtUrl),
            fetch(stopTimesTxtUrl),
            fetch(stopsTxtUrl),
        ]).then(async ([routesRes, tripsRes, stopTimesRes, stopsRes]) => {
            const failed = [
                { name: 'routes.txt', response: routesRes },
                { name: 'trips.txt', response: tripsRes },
                { name: 'stop_times.txt', response: stopTimesRes },
                { name: 'stops.txt', response: stopsRes },
            ].find(file => !file.response.ok);

            if (failed) {
                throw new Error(`Failed to load bundled GTFS file: ${failed.name}`);
            }

            const [routesText, tripsText, stopTimesText, stopsText] = await Promise.all([
                routesRes.text(),
                tripsRes.text(),
                stopTimesRes.text(),
                stopsRes.text(),
            ]);

            return {
                routesText,
                tripsText,
                stopTimesText,
                stopsText,
            };
        });
    }

    return bundledGtfsPromise;
}
