import { buildRoutePlanner2GtfsImportPatterns, type RoutePlanner2GtfsImportPattern } from './routePlanner2GtfsImport';

export interface LoadRoutePlanner2GtfsPatternsOptions {
    feedUrl?: string;
    fetchImpl?: typeof fetch;
}

export async function loadRoutePlanner2GtfsImportPatterns(
    options: LoadRoutePlanner2GtfsPatternsOptions = {},
): Promise<RoutePlanner2GtfsImportPattern[]> {
    const fetchImpl = options.fetchImpl ?? fetch;
    const params = new URLSearchParams({ includeShapes: 'true' });
    if (options.feedUrl) params.set('url', options.feedUrl);

    const response = await fetchImpl(`/api/gtfs?${params.toString()}`);
    if (!response.ok) {
        throw new Error('GTFS routes could not be loaded. Please try again.');
    }

    const feed = await response.json();
    return buildRoutePlanner2GtfsImportPatterns(feed);
}
