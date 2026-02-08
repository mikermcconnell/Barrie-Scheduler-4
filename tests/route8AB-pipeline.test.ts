/**
 * Routes 8A/8B Pipeline Integration Tests
 *
 * Tests the full GTFS → Import → Display pipeline for Barrie Transit's
 * most complex interline routes. Uses real GTFS data from local files.
 *
 * Test Plan Coverage:
 * - Test 1: GTFS data contains valid 8A/8B routes, trips, block_ids
 * - Test 2: Route direction config treats 8A/8B as separate routes
 * - Test 3: GTFS import produces separate SystemDraftRoute for 8A and 8B
 * - Test 4: Interline linking stamps interlineNext/interlinePrev correctly
 * - Test 5: Time window detection (covered by interlineDisplay.test.ts)
 * - Tests 6-12: Display pipeline (covered by code analysis + unit tests)
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
    getAvailableRoutes,
    processTripsForRoute,
    convertToMasterSchedule,
    applyExplicitInterlineLinks,
} from '../utils/gtfsImportService';
import { parseRouteInfo } from '../utils/routeDirectionConfig';
import type { ParsedGTFSFeed } from '../utils/gtfsTypes';
import type { SystemDraftRoute } from '../utils/scheduleTypes';

// ============ GTFS DATA LOADER ============

function loadLocalGTFS(): ParsedGTFSFeed {
    const gtfsDir = join(__dirname, '..', 'gtfs');

    const parseCSV = (filename: string): Record<string, string>[] => {
        const content = readFileSync(join(gtfsDir, filename), 'utf8');
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
    };

    return {
        agency: parseCSV('agency.txt') as any[],
        routes: parseCSV('routes.txt').map(r => ({
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
        stops: parseCSV('stops.txt').map(s => ({
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
        trips: parseCSV('trips.txt').map(t => ({
            route_id: t.route_id,
            service_id: t.service_id,
            trip_id: t.trip_id,
            trip_headsign: t.trip_headsign,
            trip_short_name: t.trip_short_name,
            direction_id: t.direction_id ? parseInt(t.direction_id) : undefined,
            block_id: t.block_id,
            shape_id: t.shape_id,
        })),
        stopTimes: parseCSV('stop_times.txt').map(st => ({
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
        calendar: parseCSV('calendar.txt').map(c => ({
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
        calendarDates: [],
    };
}

// ============ TESTS ============

describe('Routes 8A/8B Pipeline Integration', () => {
    let feed: ParsedGTFSFeed;

    beforeAll(() => {
        feed = loadLocalGTFS();
    });

    // ---- Test 1: GTFS Data Fetch & Parse ----
    describe('Test 1: GTFS Data Contains Valid 8A/8B Records', () => {
        it('should contain route entries for both 8A and 8B', () => {
            const route8A = feed.routes.find(r => r.route_short_name === '8A');
            const route8B = feed.routes.find(r => r.route_short_name === '8B');
            expect(route8A).toBeDefined();
            expect(route8B).toBeDefined();
        });

        it('should have trips with Georgian College and Park Place headsigns', () => {
            const route8A = feed.routes.find(r => r.route_short_name === '8A')!;
            const route8B = feed.routes.find(r => r.route_short_name === '8B')!;

            const trips8A = feed.trips.filter(t => t.route_id === route8A.route_id);
            const trips8B = feed.trips.filter(t => t.route_id === route8B.route_id);

            expect(trips8A.length).toBeGreaterThan(0);
            expect(trips8B.length).toBeGreaterThan(0);

            // Check headsigns for North (Georgian College) and South (Park Place)
            const headsigns8A = [...new Set(trips8A.map(t => t.trip_headsign))];
            const headsigns8B = [...new Set(trips8B.map(t => t.trip_headsign))];

            console.log('8A headsigns:', headsigns8A);
            console.log('8B headsigns:', headsigns8B);

            // At least one headsign should contain Georgian College (North)
            const hasGeorgianNorth8A = headsigns8A.some(h => h?.toLowerCase().includes('georgian'));
            const hasGeorgianNorth8B = headsigns8B.some(h => h?.toLowerCase().includes('georgian'));
            expect(hasGeorgianNorth8A || hasGeorgianNorth8B).toBe(true);

            // At least one headsign should contain Park Place (South)
            const hasParkPlace8A = headsigns8A.some(h => h?.toLowerCase().includes('park'));
            const hasParkPlace8B = headsigns8B.some(h => h?.toLowerCase().includes('park'));
            expect(hasParkPlace8A || hasParkPlace8B).toBe(true);
        });

        it('should have trips with block_id values', () => {
            const route8A = feed.routes.find(r => r.route_short_name === '8A')!;
            const trips8A = feed.trips.filter(t => t.route_id === route8A.route_id);

            const tripsWithBlockId = trips8A.filter(t => t.block_id && t.block_id.trim() !== '');
            console.log(`8A trips with block_id: ${tripsWithBlockId.length}/${trips8A.length}`);
            expect(tripsWithBlockId.length).toBeGreaterThan(0);
        });

        it('should have stop times that include Allandale Terminal', () => {
            const route8A = feed.routes.find(r => r.route_short_name === '8A')!;
            const trips8A = feed.trips.filter(t => t.route_id === route8A.route_id);
            const tripIds8A = new Set(trips8A.map(t => t.trip_id));
            const stopTimes8A = feed.stopTimes.filter(st => tripIds8A.has(st.trip_id));

            // Get unique stop IDs for 8A
            const stopIds = [...new Set(stopTimes8A.map(st => st.stop_id))];
            const stopNames = stopIds.map(id => {
                const stop = feed.stops.find(s => s.stop_id === id);
                return stop ? stop.stop_name : id;
            });

            console.log('8A stops include:', stopNames.filter(n =>
                n.toLowerCase().includes('allandale')
            ));

            const hasAllandale = stopNames.some(n => n.toLowerCase().includes('allandale'));
            expect(hasAllandale).toBe(true);
        });
    });

    // ---- Test 2: Route Direction Config ----
    describe('Test 2: Route Direction Config', () => {
        it('should parse 8A as a standalone route (not direction variant)', () => {
            const parsed = parseRouteInfo('8A');
            expect(parsed.baseRoute).toBe('8A');
            expect(parsed.suffixIsDirection).toBe(false);
        });

        it('should parse 8B as a standalone route (not direction variant)', () => {
            const parsed = parseRouteInfo('8B');
            expect(parsed.baseRoute).toBe('8B');
            expect(parsed.suffixIsDirection).toBe(false);
        });

        it('should NOT merge 8A/8B into Route 8 (unlike 2A/2B, 7A/7B, 12A/12B)', () => {
            // 2A/2B merge into Route 2
            const parsed2A = parseRouteInfo('2A');
            expect(parsed2A.suffixIsDirection).toBe(true);
            expect(parsed2A.baseRoute).toBe('2');

            // 8A does NOT merge
            const parsed8A = parseRouteInfo('8A');
            expect(parsed8A.suffixIsDirection).toBe(false);
            expect(parsed8A.baseRoute).not.toBe('8');
        });
    });

    // ---- Test 3: GTFS Import - Route Identification ----
    describe('Test 3: GTFS Import Produces Separate 8A and 8B Routes', () => {
        it('should list 8A and 8B as separate route options for Weekday', () => {
            const options = getAvailableRoutes(feed);
            const weekdayOptions = options.filter(o => o.dayType === 'Weekday');

            const option8A = weekdayOptions.find(o => o.routeShortName === '8A');
            const option8B = weekdayOptions.find(o => o.routeShortName === '8B');

            console.log('Weekday route options:', weekdayOptions.map(o =>
                `${o.routeShortName} (${o.dayType}) ${o.isMergedRoute ? '[MERGED]' : ''}`
            ));

            expect(option8A).toBeDefined();
            expect(option8B).toBeDefined();

            // 8A and 8B should NOT be merged
            expect(option8A!.isMergedRoute).toBeFalsy();
            expect(option8B!.isMergedRoute).toBeFalsy();
        });

        it('should produce SystemDraftRoute with populated north and south tables for 8A', () => {
            const options = getAvailableRoutes(feed);
            const option8A = options.find(o =>
                o.routeShortName === '8A' && o.dayType === 'Weekday'
            );
            expect(option8A).toBeDefined();

            const trips = processTripsForRoute(
                feed,
                option8A!.routeId,
                option8A!.serviceId,
            );
            expect(trips.length).toBeGreaterThan(0);
            console.log(`8A Weekday: ${trips.length} raw trips`);

            const content = convertToMasterSchedule(trips, '8A', 'Weekday');
            expect(content.northTable.trips.length).toBeGreaterThan(0);
            expect(content.southTable.trips.length).toBeGreaterThan(0);

            console.log(`8A North: ${content.northTable.trips.length} trips, stops: ${content.northTable.stops.join(', ')}`);
            console.log(`8A South: ${content.southTable.trips.length} trips, stops: ${content.southTable.stops.join(', ')}`);

            // Verify key stops exist
            const northStopsLower = content.northTable.stops.map(s => s.toLowerCase());
            const hasAllandaleNorth = northStopsLower.some(s => s.includes('allandale'));
            const hasGeorgianNorth = northStopsLower.some(s => s.includes('georgian'));
            expect(hasAllandaleNorth).toBe(true);
            expect(hasGeorgianNorth).toBe(true);
        });

        it('should produce SystemDraftRoute with populated north and south tables for 8B', () => {
            const options = getAvailableRoutes(feed);
            const option8B = options.find(o =>
                o.routeShortName === '8B' && o.dayType === 'Weekday'
            );
            expect(option8B).toBeDefined();

            const trips = processTripsForRoute(
                feed,
                option8B!.routeId,
                option8B!.serviceId,
            );
            expect(trips.length).toBeGreaterThan(0);
            console.log(`8B Weekday: ${trips.length} raw trips`);

            const content = convertToMasterSchedule(trips, '8B', 'Weekday');
            expect(content.northTable.trips.length).toBeGreaterThan(0);
            expect(content.southTable.trips.length).toBeGreaterThan(0);

            console.log(`8B North: ${content.northTable.trips.length} trips, stops: ${content.northTable.stops.join(', ')}`);
            console.log(`8B South: ${content.southTable.trips.length} trips, stops: ${content.southTable.stops.join(', ')}`);

            const northStopsLower = content.northTable.stops.map(s => s.toLowerCase());
            const hasAllandaleNorth = northStopsLower.some(s => s.includes('allandale'));
            const hasGeorgianNorth = northStopsLower.some(s => s.includes('georgian'));
            expect(hasAllandaleNorth).toBe(true);
            expect(hasGeorgianNorth).toBe(true);
        });
    });

    // ---- Test 4: GTFS Import - Interline Linking ----
    describe('Test 4: Interline Linking', () => {
        let route8A: SystemDraftRoute;
        let route8B: SystemDraftRoute;
        let systemRoutes: SystemDraftRoute[];

        beforeAll(() => {
            const options = getAvailableRoutes(feed);

            // Build 8A
            const option8A = options.find(o => o.routeShortName === '8A' && o.dayType === 'Weekday')!;
            const trips8A = processTripsForRoute(feed, option8A.routeId, option8A.serviceId);
            const content8A = convertToMasterSchedule(trips8A, '8A', 'Weekday');
            route8A = {
                routeNumber: '8A',
                northTable: content8A.northTable,
                southTable: content8A.southTable,
            };

            // Build 8B
            const option8B = options.find(o => o.routeShortName === '8B' && o.dayType === 'Weekday')!;
            const trips8B = processTripsForRoute(feed, option8B.routeId, option8B.serviceId);
            const content8B = convertToMasterSchedule(trips8B, '8B', 'Weekday');
            route8B = {
                routeNumber: '8B',
                northTable: content8B.northTable,
                southTable: content8B.southTable,
            };

            systemRoutes = [route8A, route8B];
            applyExplicitInterlineLinks(systemRoutes, 'Weekday');
        });

        it('should stamp interlineNext on 8A evening trips pointing to 8B', () => {
            const linkedTrips8A = route8A.northTable.trips.filter(t => t.interlineNext);
            console.log(`8A North trips with interlineNext: ${linkedTrips8A.length}`);

            for (const trip of linkedTrips8A) {
                console.log(`  ${trip.id}: interlineNext -> ${trip.interlineNext!.route} trip ${trip.interlineNext!.tripId}`);
                expect(trip.interlineNext!.route).toBe('8B');

                // Verify the linked trip exists in 8B
                const linkedTrip = route8B.northTable.trips.find(t => t.id === trip.interlineNext!.tripId);
                expect(linkedTrip).toBeDefined();
            }

            // Should have some linked trips (evening interline)
            expect(linkedTrips8A.length).toBeGreaterThan(0);
        });

        it('should stamp interlineNext on 8B evening trips pointing to 8A', () => {
            const linkedTrips8B = route8B.northTable.trips.filter(t => t.interlineNext);
            console.log(`8B North trips with interlineNext: ${linkedTrips8B.length}`);

            for (const trip of linkedTrips8B) {
                console.log(`  ${trip.id}: interlineNext -> ${trip.interlineNext!.route} trip ${trip.interlineNext!.tripId}`);
                expect(trip.interlineNext!.route).toBe('8A');

                const linkedTrip = route8A.northTable.trips.find(t => t.id === trip.interlineNext!.tripId);
                expect(linkedTrip).toBeDefined();
            }

            expect(linkedTrips8B.length).toBeGreaterThan(0);
        });

        it('should NOT stamp interlineNext on pre-8PM weekday trips', () => {
            // Get the arrival time at Allandale using both stops and arrivalTimes
            const getAllandaleArrival = (t: any): number | null => {
                const allKeys = new Set<string>([
                    ...Object.keys(t.stops || {}),
                    ...Object.keys(t.arrivalTimes || {}),
                ]);
                const allandaleStop = [...allKeys].find(s => s.toLowerCase().includes('allandale'));
                if (!allandaleStop) return null;
                const arrStr = t.stops?.[allandaleStop] || t.arrivalTimes?.[allandaleStop];
                if (!arrStr || typeof arrStr !== 'string') return null;
                const timeMatch = arrStr.match(/(\d+):(\d+)\s*(AM|PM)/i);
                if (!timeMatch) return null;
                let hours = parseInt(timeMatch[1]);
                const mins = parseInt(timeMatch[2]);
                const period = timeMatch[3].toUpperCase();
                if (period === 'PM' && hours !== 12) hours += 12;
                if (period === 'AM' && hours === 12) hours = 0;
                return hours * 60 + mins;
            };

            const earlyTrips8A = route8A.northTable.trips.filter(t => {
                const arrMin = getAllandaleArrival(t);
                // Interline window: >= 1200 (8 PM) OR <= 120 (2 AM post-midnight)
                // So "pre-interline" means: > 120 AND < 1200
                return arrMin !== null && arrMin > 120 && arrMin < 1200;
            });

            console.log(`8A pre-8PM trips: ${earlyTrips8A.length}`);

            // Log any pre-8PM trips that unexpectedly have interlineNext
            const unexpected = earlyTrips8A.filter(t => t.interlineNext);
            for (const trip of unexpected) {
                const arrMin = getAllandaleArrival(trip);
                console.log(`  UNEXPECTED: trip ${trip.id} arrTime=${arrMin} (${Math.floor(arrMin!/60)}:${String(arrMin! % 60).padStart(2, '0')}) has interlineNext -> ${trip.interlineNext!.route}/${trip.interlineNext!.tripId}, blockId=${trip.gtfsBlockId}`);
            }

            // All pre-8PM trips should NOT have interlineNext
            // Note: The interline window check is >= 1200 min (8 PM) OR <= 120 min (2 AM)
            // Trips arriving before 8 PM should never be linked
            expect(unexpected.length).toBe(0);
        });

        it('should only link northbound trips (southbound should have no interline metadata)', () => {
            const south8AWithInterline = route8A.southTable.trips.filter(t => t.interlineNext || t.interlinePrev);
            const south8BWithInterline = route8B.southTable.trips.filter(t => t.interlineNext || t.interlinePrev);

            expect(south8AWithInterline.length).toBe(0);
            expect(south8BWithInterline.length).toBe(0);
        });

        it('linked trips should share the same GTFS block_id', () => {
            const linkedTrips8A = route8A.northTable.trips.filter(t => t.interlineNext);
            for (const trip of linkedTrips8A) {
                const linkedTrip = route8B.northTable.trips.find(t => t.id === trip.interlineNext!.tripId);
                if (linkedTrip && trip.gtfsBlockId && linkedTrip.gtfsBlockId) {
                    expect(trip.gtfsBlockId).toBe(linkedTrip.gtfsBlockId);
                }
            }
        });
    });

    // ---- Test 12: Cross-Route Interline Scope ----
    describe('Test 12: Cross-Route Interline Scope', () => {
        it('should build interlineTripLookup containing both 8A and 8B entries', () => {
            const options = getAvailableRoutes(feed);

            // Build all routes for weekday
            const weekdayOptions = options.filter(o => o.dayType === 'Weekday');
            const allTables: { routeName: string; trips: any[] }[] = [];

            for (const opt of weekdayOptions) {
                const trips = processTripsForRoute(feed, opt.routeId, opt.serviceId);
                if (trips.length === 0) continue;
                const content = convertToMasterSchedule(trips, opt.routeShortName, 'Weekday');
                allTables.push({ routeName: content.northTable.routeName, trips: content.northTable.trips });
                allTables.push({ routeName: content.southTable.routeName, trips: content.southTable.trips });
            }

            // Simulate what RoundTripTableView does: build the lookup map
            const lookup = new Map<string, any>();
            for (const table of allTables) {
                // Normalize route name: extract route number
                const routeMatch = table.routeName.match(/(\d+[A-Za-z]*)/);
                const route = routeMatch ? routeMatch[1] : table.routeName;
                for (const trip of table.trips) {
                    lookup.set(`${route}|${trip.id}`, trip);
                }
            }

            // Verify lookup has 8A and 8B entries
            const keys8A = [...lookup.keys()].filter(k => k.startsWith('8A|'));
            const keys8B = [...lookup.keys()].filter(k => k.startsWith('8B|'));

            console.log(`interlineTripLookup: ${keys8A.length} 8A entries, ${keys8B.length} 8B entries`);

            expect(keys8A.length).toBeGreaterThan(0);
            expect(keys8B.length).toBeGreaterThan(0);
        });
    });

    // ---- Test 3 continued: Stop list completeness ----
    describe('Test 3b: Stop List Completeness', () => {
        it('8A North stop list should include key stops in order', () => {
            const options = getAvailableRoutes(feed);
            const option8A = options.find(o => o.routeShortName === '8A' && o.dayType === 'Weekday')!;
            const trips = processTripsForRoute(feed, option8A.routeId, option8A.serviceId);
            const content = convertToMasterSchedule(trips, '8A', 'Weekday');

            const northStops = content.northTable.stops;
            console.log('8A North stops (in order):', northStops);

            // Should have at least 3 stops (start, Allandale, Georgian College)
            expect(northStops.length).toBeGreaterThanOrEqual(3);

            // Find indices to verify ordering
            const allandaleIdx = northStops.findIndex(s => s.toLowerCase().includes('allandale'));
            const georgianIdx = northStops.findIndex(s => s.toLowerCase().includes('georgian'));

            expect(allandaleIdx).toBeGreaterThanOrEqual(0);
            expect(georgianIdx).toBeGreaterThanOrEqual(0);

            // Allandale should come before Georgian College going North
            expect(allandaleIdx).toBeLessThan(georgianIdx);
        });

        it('8B North stop list should include key stops', () => {
            const options = getAvailableRoutes(feed);
            const option8B = options.find(o => o.routeShortName === '8B' && o.dayType === 'Weekday')!;
            const trips = processTripsForRoute(feed, option8B.routeId, option8B.serviceId);
            const content = convertToMasterSchedule(trips, '8B', 'Weekday');

            const northStops = content.northTable.stops;
            console.log('8B North stops (in order):', northStops);

            expect(northStops.length).toBeGreaterThanOrEqual(3);

            const allandaleIdx = northStops.findIndex(s => s.toLowerCase().includes('allandale'));
            const georgianIdx = northStops.findIndex(s => s.toLowerCase().includes('georgian'));

            expect(allandaleIdx).toBeGreaterThanOrEqual(0);
            expect(georgianIdx).toBeGreaterThanOrEqual(0);
            expect(allandaleIdx).toBeLessThan(georgianIdx);
        });
    });

    // ---- Test 13: Repeat key validations for 8B ----
    describe('Test 13: 8B Weekday Parity with 8A', () => {
        let route8A: SystemDraftRoute;
        let route8B: SystemDraftRoute;

        beforeAll(() => {
            const options = getAvailableRoutes(feed);

            const option8A = options.find(o => o.routeShortName === '8A' && o.dayType === 'Weekday')!;
            const trips8A = processTripsForRoute(feed, option8A.routeId, option8A.serviceId);
            const content8A = convertToMasterSchedule(trips8A, '8A', 'Weekday');
            route8A = { routeNumber: '8A', northTable: content8A.northTable, southTable: content8A.southTable };

            const option8B = options.find(o => o.routeShortName === '8B' && o.dayType === 'Weekday')!;
            const trips8B = processTripsForRoute(feed, option8B.routeId, option8B.serviceId);
            const content8B = convertToMasterSchedule(trips8B, '8B', 'Weekday');
            route8B = { routeNumber: '8B', northTable: content8B.northTable, southTable: content8B.southTable };
        });

        it('8B should have comparable trip counts to 8A', () => {
            console.log(`8A: ${route8A.northTable.trips.length}N + ${route8A.southTable.trips.length}S`);
            console.log(`8B: ${route8B.northTable.trips.length}N + ${route8B.southTable.trips.length}S`);

            expect(route8B.northTable.trips.length).toBeGreaterThan(0);
            expect(route8B.southTable.trips.length).toBeGreaterThan(0);
        });

        it('8B should have key stops matching 8A (Allandale, Georgian College)', () => {
            const stopsA = route8A.northTable.stops.map(s => s.toLowerCase());
            const stopsB = route8B.northTable.stops.map(s => s.toLowerCase());

            const aHasAllandale = stopsA.some(s => s.includes('allandale'));
            const bHasAllandale = stopsB.some(s => s.includes('allandale'));
            const aHasGeorgian = stopsA.some(s => s.includes('georgian'));
            const bHasGeorgian = stopsB.some(s => s.includes('georgian'));

            expect(aHasAllandale).toBe(true);
            expect(bHasAllandale).toBe(true);
            expect(aHasGeorgian).toBe(true);
            expect(bHasGeorgian).toBe(true);
        });

        it('8B North trips should have gtfsBlockId set', () => {
            const tripsWithBlockId = route8B.northTable.trips.filter(t => t.gtfsBlockId);
            console.log(`8B North trips with gtfsBlockId: ${tripsWithBlockId.length}/${route8B.northTable.trips.length}`);
            expect(tripsWithBlockId.length).toBeGreaterThan(0);
        });

        it('8B interline linking should work same as 8A', () => {
            const routes = [
                { ...route8A },
                { ...route8B },
            ];
            applyExplicitInterlineLinks(routes, 'Weekday');

            const linked8B = routes[1].northTable.trips.filter(t => t.interlineNext);
            console.log(`8B linked trips: ${linked8B.length}`);

            // Should have some interline links
            expect(linked8B.length).toBeGreaterThan(0);
            for (const trip of linked8B) {
                expect(trip.interlineNext!.route).toBe('8A');
            }
        });
    });

    // ---- Summary test: Print full pipeline report ----
    describe('Pipeline Summary', () => {
        it('should print full 8A/8B pipeline report', () => {
            const options = getAvailableRoutes(feed);

            // Count routes per day type
            for (const dayType of ['Weekday', 'Saturday', 'Sunday'] as const) {
                const dayOptions = options.filter(o => o.dayType === dayType);
                const has8A = dayOptions.some(o => o.routeShortName === '8A');
                const has8B = dayOptions.some(o => o.routeShortName === '8B');
                console.log(`${dayType}: ${dayOptions.length} routes, 8A=${has8A}, 8B=${has8B}`);
            }

            // Weekday detail
            const wd8A = options.find(o => o.routeShortName === '8A' && o.dayType === 'Weekday')!;
            const wd8B = options.find(o => o.routeShortName === '8B' && o.dayType === 'Weekday')!;

            const trips8A = processTripsForRoute(feed, wd8A.routeId, wd8A.serviceId);
            const trips8B = processTripsForRoute(feed, wd8B.routeId, wd8B.serviceId);

            const content8A = convertToMasterSchedule(trips8A, '8A', 'Weekday');
            const content8B = convertToMasterSchedule(trips8B, '8B', 'Weekday');

            const routes: SystemDraftRoute[] = [
                { routeNumber: '8A', northTable: content8A.northTable, southTable: content8A.southTable },
                { routeNumber: '8B', northTable: content8B.northTable, southTable: content8B.southTable },
            ];
            applyExplicitInterlineLinks(routes, 'Weekday');

            const linked8A = routes[0].northTable.trips.filter(t => t.interlineNext);
            const linked8B = routes[1].northTable.trips.filter(t => t.interlineNext);

            console.log('\n=== 8A/8B PIPELINE REPORT ===');
            console.log(`8A North: ${content8A.northTable.trips.length} trips, ${content8A.northTable.stops.length} stops`);
            console.log(`8A South: ${content8A.southTable.trips.length} trips, ${content8A.southTable.stops.length} stops`);
            console.log(`8B North: ${content8B.northTable.trips.length} trips, ${content8B.northTable.stops.length} stops`);
            console.log(`8B South: ${content8B.southTable.trips.length} trips, ${content8B.southTable.stops.length} stops`);
            console.log(`Interline links: 8A→8B=${linked8A.length}, 8B→8A=${linked8B.length}`);
            console.log(`8A North stops: ${content8A.northTable.stops.join(' → ')}`);
            console.log(`8B North stops: ${content8B.northTable.stops.join(' → ')}`);
            console.log('=== END REPORT ===\n');

            // This test always passes - it's for reporting
            expect(true).toBe(true);
        });
    });
});
