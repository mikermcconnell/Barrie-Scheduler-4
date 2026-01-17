import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { optimizeImplementation } from './api/optimize';
import AdmZip from 'adm-zip';

/**
 * Vite Configuration
 */

// GTFS Helper: Parse CSV content
function parseGtfsCsv(content: string): Record<string, string>[] {
  const lines = content.trim().split(/\r?\n/);
  if (lines.length < 2) return [];

  const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
  const records: Record<string, string>[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;

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

// GTFS Helper: Parse ZIP file using adm-zip
function parseGtfsZip(buffer: Buffer): Map<string, string> {
  const files = new Map<string, string>();
  const zip = new AdmZip(buffer);
  const entries = zip.getEntries();

  for (const entry of entries) {
    if (!entry.isDirectory && entry.entryName.endsWith('.txt')) {
      const content = entry.getData().toString('utf8');
      // Store with just the filename (strip directory path)
      const fileName = entry.entryName.split('/').pop() || entry.entryName;
      files.set(fileName, content);
    }
  }

  return files;
}
console.log('✅ vite.config.ts is loading...');

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  console.log('✅ defineConfig called');

  // Define API Middleware Plugin
  const apiMiddlewarePlugin = () => ({
    name: 'configure-server',
    configureServer(server) {
      console.log('✅ Plugin configureServer called');
      server.middlewares.use(async (req, res, next) => {
        console.log('Incoming request:', req.method, req.url);

        if (req.url === '/api/optimize' && req.method === 'POST') {
          try {
            const buffers = [];
            for await (const chunk of req) {
              buffers.push(chunk);
            }
            const bodyString = Buffer.concat(buffers).toString();

            if (!bodyString) {
              throw new Error('Empty request body');
            }

            const data = JSON.parse(bodyString);
            const apiKey = env.GEMINI_API_KEY;

            if (!apiKey) {
              console.error('Missing GEMINI_API_KEY');
              res.statusCode = 500;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ error: 'Missing API Key' }));
              return;
            }

            console.log('🚀 Processing optimization request for', data.mode);
            const { requirements, mode, currentShifts } = data;

            const shifts = await optimizeImplementation(requirements, apiKey, mode, currentShifts);

            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ shifts }));

          } catch (error: any) {
            console.error('❌ API Error:', error);
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: 'Internal Server Error', message: error.message }));
          }
          return;
        }

        // GTFS Proxy endpoint
        if (req.url?.startsWith('/api/gtfs') && req.method === 'GET') {
          try {
            const urlParams = new URL(req.url, 'http://localhost').searchParams;
            const feedUrl = urlParams.get('url') || 'https://www.myridebarrie.ca/gtfs/google_transit.zip';

            console.log('🚌 Fetching GTFS feed from:', feedUrl);
            const gtfsResponse = await fetch(feedUrl, {
              headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Barrie Transit Scheduler',
                'Accept': 'application/zip, application/octet-stream, */*',
              }
            });

            if (!gtfsResponse.ok) {
              throw new Error(`Failed to fetch GTFS: ${gtfsResponse.status} ${gtfsResponse.statusText}`);
            }

            const arrayBuffer = await gtfsResponse.arrayBuffer();
            const buffer = Buffer.from(arrayBuffer);
            console.log('📦 Downloaded GTFS ZIP, size:', buffer.length);

            // Parse ZIP using adm-zip (handles all compression methods)
            const normalizedFiles = parseGtfsZip(buffer);
            console.log('📂 Extracted files:', Array.from(normalizedFiles.keys()));

            // Required GTFS files
            const requiredFiles = ['routes.txt', 'trips.txt', 'stop_times.txt', 'stops.txt', 'calendar.txt'];
            const missingFiles = requiredFiles.filter(f => !normalizedFiles.has(f));

            if (missingFiles.length > 0) {
              throw new Error(`Missing required GTFS files: ${missingFiles.join(', ')}. Found: ${Array.from(normalizedFiles.keys()).join(', ')}`);
            }

            // Parse CSV files (use normalizedFiles)
            const feed = {
              agency: normalizedFiles.has('agency.txt') ? parseGtfsCsv(normalizedFiles.get('agency.txt')!) : [],
              routes: parseGtfsCsv(normalizedFiles.get('routes.txt')!).map(r => ({
                route_id: r.route_id,
                agency_id: r.agency_id,
                route_short_name: r.route_short_name,
                route_long_name: r.route_long_name,
                route_type: parseInt(r.route_type) || 3,
                route_color: r.route_color,
              })),
              stops: parseGtfsCsv(normalizedFiles.get('stops.txt')!).map(s => ({
                stop_id: s.stop_id,
                stop_code: s.stop_code,
                stop_name: s.stop_name,
                stop_lat: parseFloat(s.stop_lat) || 0,
                stop_lon: parseFloat(s.stop_lon) || 0,
              })),
              trips: parseGtfsCsv(normalizedFiles.get('trips.txt')!).map(t => ({
                route_id: t.route_id,
                service_id: t.service_id,
                trip_id: t.trip_id,
                trip_headsign: t.trip_headsign,
                direction_id: t.direction_id ? parseInt(t.direction_id) : undefined,
                block_id: t.block_id,
              })),
              stopTimes: parseGtfsCsv(normalizedFiles.get('stop_times.txt')!).map(st => ({
                trip_id: st.trip_id,
                arrival_time: st.arrival_time,
                departure_time: st.departure_time,
                stop_id: st.stop_id,
                stop_sequence: parseInt(st.stop_sequence) || 0,
                timepoint: st.timepoint ? parseInt(st.timepoint) : undefined,
              })),
              calendar: parseGtfsCsv(normalizedFiles.get('calendar.txt')!).map(c => ({
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
              calendarDates: normalizedFiles.has('calendar_dates.txt')
                ? parseGtfsCsv(normalizedFiles.get('calendar_dates.txt')!).map(cd => ({
                    service_id: cd.service_id,
                    date: cd.date,
                    exception_type: parseInt(cd.exception_type) || 1,
                  }))
                : [],
            };

            console.log('✅ Parsed GTFS feed:', {
              routes: feed.routes.length,
              stops: feed.stops.length,
              trips: feed.trips.length,
              stopTimes: feed.stopTimes.length,
            });

            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(feed));

          } catch (error: any) {
            console.error('❌ GTFS Error:', error);
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: 'Failed to fetch/parse GTFS feed', details: error.message }));
          }
          return;
        }

        if (req.url === '/api/download-file' && req.method === 'POST') {
          try {
            const buffers = [];
            for await (const chunk of req) {
              buffers.push(chunk);
            }
            const bodyString = Buffer.concat(buffers).toString();

            if (!bodyString) {
              throw new Error('Empty request body');
            }

            const { downloadUrl, format = 'text' } = JSON.parse(bodyString);

            if (!downloadUrl) {
              throw new Error('Missing downloadUrl');
            }

            console.log('🔄 Proxying file download:', downloadUrl, 'Format:', format);
            const response = await fetch(downloadUrl);

            if (!response.ok) {
              throw new Error(`Failed to fetch: ${response.status} ${response.statusText}`);
            }

            let content;
            if (format === 'base64') {
              const arrayBuffer = await response.arrayBuffer();
              content = Buffer.from(arrayBuffer).toString('base64');
            } else {
              content = await response.text();
            }

            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ success: true, content, format }));

          } catch (error: any) {
            console.error('❌ Proxy Download Error:', error);
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: 'Failed to download file', details: error.message }));
          }
          return;
        }

        next();
      });
    },
  });

  return {
    server: {
      port: 3008,
      strictPort: true,
      host: '0.0.0.0',
    },
    plugins: [
      react(),
      apiMiddlewarePlugin()
    ],
    test: {
      globals: true,
      environment: 'jsdom',
      setupFiles: [],
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      }
    }
  };
});
