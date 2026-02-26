import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { optimizeImplementation } from './api/optimize';
import { performanceQueryHandler } from './api/performance-query';
import AdmZip from 'adm-zip';
import {
  authenticateFirebaseRequest,
  checkRateLimit,
  getRequestIp,
  validateDownloadUrl,
  validateGtfsUrl,
} from './lib/apiSecurity';

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
    if (!entry.isDirectory && entry.entryName.toLowerCase().endsWith('.txt')) {
      const content = entry.getData().toString('utf8');
      // Store with just the filename (strip directory path)
      const fileName = (entry.entryName.split('/').pop() || entry.entryName).toLowerCase();
      files.set(fileName, content);
    }
  }

  return files;
}
console.log('✅ vite.config.ts is loading...');

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  // Expose env vars to process.env so api/security.ts can read them
  // (loadEnv only returns an object; it does NOT populate process.env)
  if (!process.env.FIREBASE_WEB_API_KEY && env.FIREBASE_WEB_API_KEY) {
    process.env.FIREBASE_WEB_API_KEY = env.FIREBASE_WEB_API_KEY;
  }
  console.log('✅ defineConfig called');

  // Define API Middleware Plugin
  const apiMiddlewarePlugin = () => ({
    name: 'configure-server',
    configureServer(server: any) {
      console.log('✅ Plugin configureServer called');
      server.middlewares.use(async (req: any, res: any, next: any) => {
        console.log('Incoming request:', req.method, req.url);

        if (req.url === '/api/optimize' && req.method === 'POST') {
          try {
            const authedUser = await authenticateFirebaseRequest(req as any);
            if (!authedUser) {
              res.statusCode = 401;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ error: 'Authentication required' }));
              return;
            }

            const requestIp = getRequestIp(req as any);
            const maxRequestsPerHour = Number(env.OPTIMIZE_RATE_LIMIT_PER_HOUR || 20);
            const rateLimitKey = `optimize:${authedUser.uid}:${requestIp}`;
            if (!checkRateLimit(rateLimitKey, maxRequestsPerHour, 60 * 60 * 1000)) {
              res.statusCode = 429;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ error: 'Rate limit exceeded. Please try again later.' }));
              return;
            }

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

        // Performance Query endpoint
        if (req.url === '/api/performance-query' && req.method === 'POST') {
          try {
            const buffers: Buffer[] = [];
            for await (const chunk of req) {
              buffers.push(chunk);
            }
            const bodyString = Buffer.concat(buffers).toString();
            if (!bodyString) throw new Error('Empty request body');

            const { question, context } = JSON.parse(bodyString);
            const apiKey = env.GEMINI_API_KEY;

            if (!apiKey) {
              res.statusCode = 500;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ error: 'Missing GEMINI_API_KEY' }));
              return;
            }

            console.log('🤖 Performance query:', question?.slice(0, 80));
            const result = await performanceQueryHandler(question, context, apiKey);

            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(result));
          } catch (error: any) {
            console.error('❌ Performance query error:', error);
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
            const urlValidation = validateGtfsUrl(feedUrl);

            if (!urlValidation.ok) {
              const errorReason = 'reason' in urlValidation ? urlValidation.reason : 'Invalid GTFS URL';
              res.statusCode = 400;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ error: errorReason }));
              return;
            }

            const requestIp = getRequestIp(req as any);
            const rateLimitKey = `gtfs:${requestIp}`;
            if (!checkRateLimit(rateLimitKey, 120, 60 * 60 * 1000)) {
              res.statusCode = 429;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ error: 'Rate limit exceeded. Please try again later.' }));
              return;
            }

            const validatedFeedUrl = urlValidation.parsedUrl.toString();
            console.log('🚌 Fetching GTFS feed from:', validatedFeedUrl);
            const gtfsResponse = await fetch(validatedFeedUrl, {
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

            // Required GTFS files (calendar.txt is optional if calendar_dates.txt exists)
            const requiredFiles = ['routes.txt', 'trips.txt', 'stop_times.txt', 'stops.txt'];
            const missingFiles = requiredFiles.filter(f => !normalizedFiles.has(f));

            if (missingFiles.length > 0) {
              throw new Error(`Missing required GTFS files: ${missingFiles.join(', ')}. Found: ${Array.from(normalizedFiles.keys()).join(', ')}`);
            }

            if (!normalizedFiles.has('calendar.txt') && !normalizedFiles.has('calendar_dates.txt')) {
              throw new Error(`Missing required GTFS service files: calendar.txt or calendar_dates.txt. Found: ${Array.from(normalizedFiles.keys()).join(', ')}`);
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
              calendar: normalizedFiles.has('calendar.txt')
                ? parseGtfsCsv(normalizedFiles.get('calendar.txt')!).map(c => ({
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
            const requestIp = getRequestIp(req as any);
            const rateLimitKey = `download-proxy:${requestIp}`;
            if (!checkRateLimit(rateLimitKey, 120, 60 * 60 * 1000)) {
              res.statusCode = 429;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ error: 'Rate limit exceeded. Please try again later.' }));
              return;
            }

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
            const urlValidation = validateDownloadUrl(downloadUrl);
            if (!urlValidation.ok) {
              const errorReason = 'reason' in urlValidation ? urlValidation.reason : 'Invalid download URL';
              res.statusCode = 400;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ error: errorReason }));
              return;
            }

            console.log('🔄 Proxying file download:', urlValidation.parsedUrl.toString(), 'Format:', format);
            const response = await fetch(urlValidation.parsedUrl.toString());

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
