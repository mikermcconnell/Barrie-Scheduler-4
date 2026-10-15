/**
 * Adds Barrie GTFS feeds to the packaged schedule bundle used for missed-trip matching.
 * Writes data/gtfsScheduleBundle.json and the functions copy in functions/src/data/.
 *
 * Usage: npx tsx scripts/buildGtfsScheduleBundle.ts <feed.zip | feed-folder> [...]
 *
 * Existing feeds stay in the bundle; a feed with the same version or start date replaces
 * the older entry. Deployed functions also pick up feeds archived after the last build
 * (see functions/src/gtfsScheduleIndex.ts).
 */
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'fs';
import { basename, dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { unzipSync } from 'fflate';
import { buildScheduleFeed, mergeScheduleFeeds, type ScheduleBundle } from '../utils/gtfs/gtfsScheduleBundle';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUTS = [
    resolve(__dirname, '..', 'data', 'gtfsScheduleBundle.json'),
    resolve(__dirname, '..', 'functions', 'src', 'data', 'gtfsScheduleBundle.json'),
];
const NEEDED = ['calendar.txt', 'calendar_dates.txt', 'trips.txt', 'stop_times.txt', 'feed_info.txt'];

function readFeedFiles(source: string): Record<string, string> {
    const files: Record<string, string> = {};
    if (statSync(source).isDirectory()) {
        for (const name of readdirSync(source)) {
            if (NEEDED.includes(name.toLowerCase())) files[name.toLowerCase()] = readFileSync(join(source, name), 'utf8');
        }
        return files;
    }
    const entries = unzipSync(new Uint8Array(readFileSync(source)), {
        filter: entry => NEEDED.includes((entry.name.split('/').pop() ?? '').toLowerCase()),
    });
    for (const [name, bytes] of Object.entries(entries)) {
        files[(name.split('/').pop() ?? '').toLowerCase()] = new TextDecoder().decode(bytes);
    }
    return files;
}

const sources = process.argv.slice(2);
if (sources.length === 0) {
    console.error('Usage: npx tsx scripts/buildGtfsScheduleBundle.ts <feed.zip | feed-folder> [...]');
    process.exit(1);
}

const bundle: ScheduleBundle = existsSync(OUTPUTS[0])
    ? JSON.parse(readFileSync(OUTPUTS[0], 'utf8'))
    : { feeds: [] };
const incoming = sources.map(source => {
    const feed = buildScheduleFeed(readFeedFiles(resolve(source)), basename(source));
    console.log(`  ${feed.feedVersion}: ${feed.feedStartDate}–${feed.feedEndDate}, ${feed.trips.length} trips (${source})`);
    return feed;
});
bundle.feeds = mergeScheduleFeeds(bundle.feeds, incoming);

const json = JSON.stringify(bundle);
for (const output of OUTPUTS) writeFileSync(output, json);
console.log(`✓ ${bundle.feeds.length} feeds → ${OUTPUTS.join(', ')} (${Math.round(json.length / 1024)} KB)`);
for (const feed of bundle.feeds) console.log(`  ${feed.feedStartDate} ${feed.feedVersion}`);
