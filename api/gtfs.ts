import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Readable } from 'stream';

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

// Parse ZIP file (simple implementation for GTFS)
async function parseZip(buffer: ArrayBuffer): Promise<Map<string, string>> {
    const files = new Map<string, string>();
    const view = new DataView(buffer);
    const decoder = new TextDecoder('utf-8');

    // ZIP local file header signature: 0x04034b50
    let offset = 0;
    while (offset < buffer.byteLength - 4) {
        const signature = view.getUint32(offset, true);

        if (signature === 0x04034b50) {
            // Local file header
            const compressionMethod = view.getUint16(offset + 8, true);
            const compressedSize = view.getUint32(offset + 18, true);
            const uncompressedSize = view.getUint32(offset + 22, true);
            const fileNameLength = view.getUint16(offset + 26, true);
            const extraFieldLength = view.getUint16(offset + 28, true);

            const fileNameStart = offset + 30;
            const fileNameBytes = new Uint8Array(buffer, fileNameStart, fileNameLength);
            const fileName = decoder.decode(fileNameBytes);

            const dataStart = fileNameStart + fileNameLength + extraFieldLength;

            if (compressionMethod === 0) {
                // Stored (no compression)
                const dataBytes = new Uint8Array(buffer, dataStart, uncompressedSize);
                files.set(fileName, decoder.decode(dataBytes));
                offset = dataStart + uncompressedSize;
            } else if (compressionMethod === 8) {
                // Deflate compression - use DecompressionStream API
                try {
                    const compressedData = new Uint8Array(buffer, dataStart, compressedSize);

                    // Create a readable stream from the compressed data
                    const stream = new ReadableStream({
                        start(controller) {
                            controller.enqueue(compressedData);
                            controller.close();
                        }
                    });

                    // Decompress using DecompressionStream
                    const decompressedStream = stream.pipeThrough(
                        new DecompressionStream('deflate-raw')
                    );

                    const reader = decompressedStream.getReader();
                    const chunks: Uint8Array[] = [];

                    while (true) {
                        const { done, value } = await reader.read();
                        if (done) break;
                        chunks.push(value);
                    }

                    // Combine chunks
                    const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
                    const result = new Uint8Array(totalLength);
                    let position = 0;
                    for (const chunk of chunks) {
                        result.set(chunk, position);
                        position += chunk.length;
                    }

                    files.set(fileName, decoder.decode(result));
                } catch (e) {
                    console.warn(`Failed to decompress ${fileName}:`, e);
                }
                offset = dataStart + compressedSize;
            } else {
                // Unsupported compression
                console.warn(`Unsupported compression method ${compressionMethod} for ${fileName}`);
                offset = dataStart + compressedSize;
            }
        } else if (signature === 0x02014b50) {
            // Central directory header - we're done with file data
            break;
        } else {
            offset++;
        }
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

    const url = req.query.url as string || 'https://www.myridebarrie.ca/gtfs/google_transit.zip';

    try {
        console.log('Fetching GTFS feed from:', url);

        // Fetch the GTFS ZIP
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Failed to fetch GTFS: ${response.status} ${response.statusText}`);
        }

        const arrayBuffer = await response.arrayBuffer();
        console.log('Downloaded GTFS ZIP, size:', arrayBuffer.byteLength);

        // Parse ZIP
        const files = await parseZip(arrayBuffer);
        console.log('Extracted files:', Array.from(files.keys()));

        // Required GTFS files
        const requiredFiles = ['routes.txt', 'trips.txt', 'stop_times.txt', 'stops.txt', 'calendar.txt'];
        const missingFiles = requiredFiles.filter(f => !files.has(f));

        if (missingFiles.length > 0) {
            throw new Error(`Missing required GTFS files: ${missingFiles.join(', ')}`);
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
            calendar: parseCSV(files.get('calendar.txt')!).map(c => ({
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
            })),
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
