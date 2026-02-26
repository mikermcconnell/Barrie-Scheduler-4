import type { VercelRequest, VercelResponse } from '@vercel/node';
import AdmZip from 'adm-zip';
import { checkRateLimit, getRequestIp, validateGtfsUrl } from '../lib/apiSecurity';

/**
 * GTFS Proxy API
 *
 * Fetches GTFS feed ZIP, extracts and parses CSV files, returns structured JSON.
 * This runs server-side to bypass CORS restrictions.
 *
 * Usage: GET /api/gtfs?url=https://www.myridebarrie.ca/gtfs/google_transit.zip
 */

// Simple CSV parser (GTFS files don't have complex escaping)
function parseCSV(content: string): Record<string, string>[] {
    const lines = content.trim().split(/\r?\n/);
    if (lines.length < 2) return [];

    const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
    const records: Record<string, string>[] = [];

    for (let i = 1; i < lines.length; i++) {
        const line = lines[i];
        if (!line.trim()) continue;

        // Handle quoted fields with commas inside
        const values: string[] = [];
        let current = '';
        let inQuotes = false;

        for (let j = 0; j < line.length; j++) {
            const char = line[j];
            if (char === '"') {
                inQuotes = !inQuotes;
            } else if (char === ',' && !inQuotes) {
                values.push(current.trim().replace(/^"|"$/g, ''));
                current = '';
            } else {
                current += char;
            }
        }
        values.push(current.trim().replace(/^"|"$/g, ''));

        const record: Record<string, string> = {};
        headers.forEach((header, idx) => {
            record[header] = values[idx] || '';
        });
        records.push(record);
    }

    return records;
}

// Parse ZIP file robustly using adm-zip.
async function parseZip(buffer: ArrayBuffer): Promise<Map<string, string>> {
    const files = new Map<string, string>();
    const zip = new AdmZip(Buffer.from(buffer));
    const entries = zip.getEntries();

    for (const entry of entries) {
        if (entry.isDirectory) continue;
        const name = (entry.entryName.split('/').pop() || entry.entryName).toLowerCase();
        if (!name.endsWith('.txt')) continue;
        files.set(name, zip.readAsText(entry, 'utf8'));
    }

    return files;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const rawUrl = req.query.url;
    const requestedUrl = (Array.isArray(rawUrl) ? rawUrl[0] : rawUrl) || 'https://www.myridebarrie.ca/gtfs/google_transit.zip';
    const urlValidation = validateGtfsUrl(requestedUrl);
    if (!urlValidation.ok) {
        const errorReason = 'reason' in urlValidation ? urlValidation.reason : 'Invalid GTFS URL';
        return res.status(400).json({ error: errorReason });
    }

    const requestIp = getRequestIp(req);
    const rateKey = `gtfs:${requestIp}`;
    const allowed = checkRateLimit(rateKey, 120, 60 * 60 * 1000);
    if (!allowed) {
        return res.status(429).json({ error: 'Rate limit exceeded. Please try again later.' });
    }

    try {
        const feedUrl = urlValidation.parsedUrl.toString();
        console.log('Fetching GTFS feed from:', feedUrl);

        const abortController = new AbortController();
        const timeout = setTimeout(() => abortController.abort(), 30_000);

        // Fetch the GTFS ZIP
        const response = await fetch(feedUrl, {
            signal: abortController.signal,
            headers: {
                'User-Agent': 'OntarioNorthlandScheduler-GTFSProxy',
                'Accept': 'application/zip, application/octet-stream, */*',
            },
        }).finally(() => clearTimeout(timeout));

        if (!response.ok) {
            throw new Error(`Failed to fetch GTFS: ${response.status} ${response.statusText}`);
        }

        const declaredLength = Number(response.headers.get('content-length') || 0);
        const maxBytes = 50 * 1024 * 1024;
        if (declaredLength > maxBytes) {
            return res.status(413).json({ error: 'GTFS ZIP is too large' });
        }

        const arrayBuffer = await response.arrayBuffer();
        if (arrayBuffer.byteLength > maxBytes) {
            return res.status(413).json({ error: 'GTFS ZIP is too large' });
        }
        console.log('Downloaded GTFS ZIP, size:', arrayBuffer.byteLength);

        // Parse ZIP
        const files = await parseZip(arrayBuffer);
        console.log('Extracted files:', Array.from(files.keys()));

        // Required GTFS files
        // Some feeds (including Metrolinx GO) publish calendar_dates.txt without calendar.txt.
        const requiredFiles = ['routes.txt', 'trips.txt', 'stop_times.txt', 'stops.txt'];
        const missingFiles = requiredFiles.filter(f => !files.has(f));

        if (missingFiles.length > 0) {
            throw new Error(`Missing required GTFS files: ${missingFiles.join(', ')}`);
        }

        if (!files.has('calendar.txt') && !files.has('calendar_dates.txt')) {
            throw new Error('Missing required GTFS service files: calendar.txt or calendar_dates.txt');
        }

        // Parse CSV files
        const feed = {
            agency: files.has('agency.txt') ? parseCSV(files.get('agency.txt')!) : [],
            routes: parseCSV(files.get('routes.txt')!).map(r => ({
                route_id: r.route_id,
                agency_id: r.agency_id,
                route_short_name: r.route_short_name,
                route_long_name: r.route_long_name,
                route_desc: r.route_desc,
                route_type: parseInt(r.route_type) || 3,
                route_url: r.route_url,
                route_color: r.route_color,
                route_text_color: r.route_text_color,
            })),
            stops: parseCSV(files.get('stops.txt')!).map(s => ({
                stop_id: s.stop_id,
                stop_code: s.stop_code,
                stop_name: s.stop_name,
                stop_desc: s.stop_desc,
                stop_lat: parseFloat(s.stop_lat) || 0,
                stop_lon: parseFloat(s.stop_lon) || 0,
                zone_id: s.zone_id,
                stop_url: s.stop_url,
                location_type: parseInt(s.location_type) || 0,
                parent_station: s.parent_station,
            })),
            trips: parseCSV(files.get('trips.txt')!).map(t => ({
                route_id: t.route_id,
                service_id: t.service_id,
                trip_id: t.trip_id,
                trip_headsign: t.trip_headsign,
                trip_short_name: t.trip_short_name,
                direction_id: t.direction_id ? parseInt(t.direction_id) : undefined,
                block_id: t.block_id,
                shape_id: t.shape_id,
            })),
            stopTimes: parseCSV(files.get('stop_times.txt')!).map(st => ({
                trip_id: st.trip_id,
                arrival_time: st.arrival_time,
                departure_time: st.departure_time,
                stop_id: st.stop_id,
                stop_sequence: parseInt(st.stop_sequence) || 0,
                stop_headsign: st.stop_headsign,
                pickup_type: st.pickup_type ? parseInt(st.pickup_type) : undefined,
                drop_off_type: st.drop_off_type ? parseInt(st.drop_off_type) : undefined,
                timepoint: st.timepoint ? parseInt(st.timepoint) : undefined,
            })),
            calendar: files.has('calendar.txt')
                ? parseCSV(files.get('calendar.txt')!).map(c => ({
                    service_id: c.service_id,
                    monday: parseInt(c.monday) || 0,
                    tuesday: parseInt(c.tuesday) || 0,
                    wednesday: parseInt(c.wednesday) || 0,
                    thursday: parseInt(c.thursday) || 0,
                    friday: parseInt(c.friday) || 0,
                    saturday: parseInt(c.saturday) || 0,
                    sunday: parseInt(c.sunday) || 0,
                    start_date: c.start_date,
                    end_date: c.end_date,
                }))
                : [],
            calendarDates: files.has('calendar_dates.txt')
                ? parseCSV(files.get('calendar_dates.txt')!).map(cd => ({
                    service_id: cd.service_id,
                    date: cd.date,
                    exception_type: parseInt(cd.exception_type) || 1,
                }))
                : [],
            feedInfo: files.has('feed_info.txt')
                ? (() => {
                    const info = parseCSV(files.get('feed_info.txt')!)[0];
                    return info ? {
                        feedPublisherName: info.feed_publisher_name,
                        feedPublisherUrl: info.feed_publisher_url,
                        feedLang: info.feed_lang,
                        feedStartDate: info.feed_start_date,
                        feedEndDate: info.feed_end_date,
                        feedVersion: info.feed_version,
                    } : undefined;
                })()
                : undefined,
        };

        console.log('Parsed GTFS feed:', {
            routes: feed.routes.length,
            stops: feed.stops.length,
            trips: feed.trips.length,
            stopTimes: feed.stopTimes.length,
            calendar: feed.calendar.length,
        });

        return res.status(200).json(feed);
    } catch (error: any) {
        console.error('GTFS fetch error:', error);
        return res.status(500).json({
            error: 'Failed to fetch/parse GTFS feed',
            details: error.message,
        });
    }
}
