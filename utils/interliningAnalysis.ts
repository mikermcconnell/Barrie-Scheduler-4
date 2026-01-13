/**
 * Interlining Analysis Utility
 *
 * Analyzes schedules to find opportunities where one bus could serve
 * multiple routes based on terminus timing alignment.
 */

import type { MasterRouteTable, MasterTrip } from './masterScheduleParser';
import type { MasterScheduleContent, DayType } from './masterScheduleTypes';
import { ROUTE_DIRECTIONS, getRouteConfig } from './routeDirectionConfig';

// ============ TYPES ============

export interface RouteTerminus {
    route: string;
    terminus: string;
    direction: 'North' | 'South';
}

export interface TripArrival {
    routeNumber: string;
    routeVariant: string;      // e.g., "12A", "8A"
    tripId: string;
    tripIndex: number;
    direction: 'North' | 'South';
    terminus: string;
    arrivalTime: number;       // Minutes from midnight
    arrivalTimeStr: string;    // Formatted time string
    blockId: string;
}

export interface TripDeparture {
    routeNumber: string;
    routeVariant: string;
    tripId: string;
    tripIndex: number;
    direction: 'North' | 'South';
    terminus: string;
    departureTime: number;
    departureTimeStr: string;
    blockId: string;
}

export type InterliningFeasibility = 'good' | 'tight' | 'marginal';

export interface InterliningOpportunity {
    id: string;
    route1: {
        name: string;
        variant: string;
        tripId: string;
        tripIndex: number;
        endTime: number;
        endTimeStr: string;
        terminus: string;
        direction: 'North' | 'South';
        blockId: string;
    };
    route2: {
        name: string;
        variant: string;
        tripId: string;
        tripIndex: number;
        startTime: number;
        startTimeStr: string;
        terminus: string;
        direction: 'North' | 'South';
        blockId: string;
    };
    gapMinutes: number;
    terminus: string;
    dayType: DayType;
    feasibility: InterliningFeasibility;
    potentialSavings: string;
    isCurrentlyActive: boolean;  // True if routes already share blocks (e.g., 8A/8B)
    isSameRoute: boolean;        // True if same route number (just different directions)
}

export interface InterliningAnalysisConfig {
    minGapMinutes: number;      // Minimum acceptable gap (default: 5)
    maxGapMinutes: number;      // Maximum gap to consider (default: 20)
    dayType: DayType;
}

export interface InterliningAnalysisResult {
    opportunities: InterliningOpportunity[];
    arrivals: TripArrival[];
    departures: TripDeparture[];
    terminusLocations: string[];
    routeCount: number;
    tripCount: number;
}

// ============ HELPERS ============

/**
 * Format minutes from midnight to time string
 */
export function formatTime(minutes: number): string {
    const hours = Math.floor(minutes / 60) % 24;
    const mins = minutes % 60;
    const period = hours >= 12 ? 'PM' : 'AM';
    const displayHours = hours === 0 ? 12 : hours > 12 ? hours - 12 : hours;
    return `${displayHours}:${mins.toString().padStart(2, '0')} ${period}`;
}

/**
 * Get the terminus for a route/direction
 */
function getTerminusForDirection(routeNumber: string, direction: 'North' | 'South'): string | null {
    const config = getRouteConfig(routeNumber);
    if (!config || config.type !== 'linear') return null;
    return direction === 'North' ? config.northTerminus : config.southTerminus;
}

/**
 * Determine feasibility based on gap time
 */
function determineFeasibility(gapMinutes: number): InterliningFeasibility {
    if (gapMinutes >= 8 && gapMinutes <= 15) return 'good';
    if (gapMinutes >= 5 && gapMinutes < 8) return 'tight';
    return 'marginal';
}

/**
 * Check if two routes are already interlined (e.g., 8A and 8B)
 */
function areRoutesInterlined(route1: string, route2: string): boolean {
    // 8A and 8B are interlined
    const base1 = route1.replace(/[AB]$/i, '');
    const base2 = route2.replace(/[AB]$/i, '');

    if (base1 === '8' && base2 === '8' && route1 !== route2) {
        return true;
    }

    return false;
}

/**
 * Normalize terminus name for matching
 */
function normalizeTerminus(terminus: string): string {
    return terminus
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .replace(/terminal|station|stop/gi, '')
        .replace(/\(\d+\)/g, '')  // Remove (2), (3) suffixes
        .trim();
}

/**
 * Check if two terminus names match (fuzzy matching)
 */
function terminusMatch(t1: string, t2: string): boolean {
    const n1 = normalizeTerminus(t1);
    const n2 = normalizeTerminus(t2);

    // Exact match
    if (n1 === n2) return true;

    // One contains the other
    if (n1.includes(n2) || n2.includes(n1)) return true;

    // Common terminus keywords
    const commonTermini = [
        'downtown',
        'park place',
        'georgian',
        'barrie south',
        'allandale',
        'rvh'
    ];

    for (const term of commonTermini) {
        if (n1.includes(term) && n2.includes(term)) return true;
    }

    return false;
}

// ============ EXTRACTION ============

/**
 * Extract arrivals from a schedule table
 */
function extractArrivals(
    table: MasterRouteTable,
    routeNumber: string,
    direction: 'North' | 'South'
): TripArrival[] {
    const arrivals: TripArrival[] = [];

    // Determine terminus - it's the last stop for this direction
    const terminus = table.stops[table.stops.length - 1] ||
                    getTerminusForDirection(routeNumber, direction) ||
                    'Unknown';

    // Extract route variant from table name
    const variantMatch = table.routeName.match(/(\d+[AB]?)/);
    const routeVariant = variantMatch ? variantMatch[1] : routeNumber;

    table.trips.forEach((trip, index) => {
        arrivals.push({
            routeNumber,
            routeVariant,
            tripId: trip.id,
            tripIndex: index,
            direction,
            terminus,
            arrivalTime: trip.endTime,
            arrivalTimeStr: formatTime(trip.endTime),
            blockId: trip.blockId
        });
    });

    return arrivals;
}

/**
 * Extract departures from a schedule table
 */
function extractDepartures(
    table: MasterRouteTable,
    routeNumber: string,
    direction: 'North' | 'South'
): TripDeparture[] {
    const departures: TripDeparture[] = [];

    // Determine terminus - it's the first stop for this direction
    const terminus = table.stops[0] ||
                    getTerminusForDirection(routeNumber, direction === 'North' ? 'South' : 'North') ||
                    'Unknown';

    // Extract route variant from table name
    const variantMatch = table.routeName.match(/(\d+[AB]?)/);
    const routeVariant = variantMatch ? variantMatch[1] : routeNumber;

    table.trips.forEach((trip, index) => {
        departures.push({
            routeNumber,
            routeVariant,
            tripId: trip.id,
            tripIndex: index,
            direction,
            terminus,
            departureTime: trip.startTime,
            departureTimeStr: formatTime(trip.startTime),
            blockId: trip.blockId
        });
    });

    return departures;
}

// ============ ANALYSIS ============

/**
 * Analyze schedules to find interlining opportunities
 */
export function analyzeInterliningOpportunities(
    schedules: Map<string, MasterScheduleContent>,
    config: InterliningAnalysisConfig
): InterliningAnalysisResult {
    const { minGapMinutes, maxGapMinutes, dayType } = config;

    const allArrivals: TripArrival[] = [];
    const allDepartures: TripDeparture[] = [];
    const terminusSet = new Set<string>();
    let tripCount = 0;

    // Extract arrivals and departures from all schedules
    schedules.forEach((content, routeIdentity) => {
        // routeIdentity format: "400-Weekday"
        const [routeNumber] = routeIdentity.split('-');

        // North direction
        if (content.northTable) {
            const northArrivals = extractArrivals(content.northTable, routeNumber, 'North');
            const northDepartures = extractDepartures(content.northTable, routeNumber, 'North');

            allArrivals.push(...northArrivals);
            allDepartures.push(...northDepartures);

            northArrivals.forEach(a => terminusSet.add(a.terminus));
            northDepartures.forEach(d => terminusSet.add(d.terminus));

            tripCount += content.northTable.trips.length;
        }

        // South direction
        if (content.southTable) {
            const southArrivals = extractArrivals(content.southTable, routeNumber, 'South');
            const southDepartures = extractDepartures(content.southTable, routeNumber, 'South');

            allArrivals.push(...southArrivals);
            allDepartures.push(...southDepartures);

            southArrivals.forEach(a => terminusSet.add(a.terminus));
            southDepartures.forEach(d => terminusSet.add(d.terminus));

            tripCount += content.southTable.trips.length;
        }
    });

    // Find opportunities: match arrivals to departures at same terminus
    const opportunities: InterliningOpportunity[] = [];
    let opportunityId = 0;

    for (const arrival of allArrivals) {
        for (const departure of allDepartures) {
            // Skip same trip
            if (arrival.tripId === departure.tripId) continue;

            // Skip if already in same block (would be internal, not an "opportunity")
            // We still show this if routes differ (8A/8B case)
            const sameBlock = arrival.blockId === departure.blockId;
            const sameRoute = arrival.routeNumber === departure.routeNumber;

            // Skip internal same-route, same-block trips
            if (sameRoute && sameBlock) continue;

            // Check terminus match
            if (!terminusMatch(arrival.terminus, departure.terminus)) continue;

            // Calculate gap
            let gapMinutes = departure.departureTime - arrival.arrivalTime;

            // Handle midnight crossing
            if (gapMinutes < 0) {
                gapMinutes += 1440; // Add 24 hours
            }

            // Filter by gap range
            if (gapMinutes < minGapMinutes || gapMinutes > maxGapMinutes) continue;

            // Determine if currently active (8A/8B interline)
            const isCurrentlyActive = areRoutesInterlined(arrival.routeNumber, departure.routeNumber);

            // Create opportunity
            opportunities.push({
                id: `interline-${opportunityId++}`,
                route1: {
                    name: arrival.routeNumber,
                    variant: arrival.routeVariant,
                    tripId: arrival.tripId,
                    tripIndex: arrival.tripIndex,
                    endTime: arrival.arrivalTime,
                    endTimeStr: arrival.arrivalTimeStr,
                    terminus: arrival.terminus,
                    direction: arrival.direction,
                    blockId: arrival.blockId
                },
                route2: {
                    name: departure.routeNumber,
                    variant: departure.routeVariant,
                    tripId: departure.tripId,
                    tripIndex: departure.tripIndex,
                    startTime: departure.departureTime,
                    startTimeStr: departure.departureTimeStr,
                    terminus: departure.terminus,
                    direction: departure.direction,
                    blockId: departure.blockId
                },
                gapMinutes,
                terminus: arrival.terminus,
                dayType,
                feasibility: determineFeasibility(gapMinutes),
                potentialSavings: isCurrentlyActive ? 'Currently in use' : '1 vehicle-trip saved',
                isCurrentlyActive,
                isSameRoute: sameRoute
            });
        }
    }

    // Sort by feasibility (good first), then by gap time
    opportunities.sort((a, b) => {
        const feasOrder = { good: 0, tight: 1, marginal: 2 };
        const fDiff = feasOrder[a.feasibility] - feasOrder[b.feasibility];
        if (fDiff !== 0) return fDiff;
        return a.gapMinutes - b.gapMinutes;
    });

    return {
        opportunities,
        arrivals: allArrivals,
        departures: allDepartures,
        terminusLocations: Array.from(terminusSet),
        routeCount: schedules.size,
        tripCount
    };
}

/**
 * Filter opportunities by criteria
 */
export function filterOpportunities(
    opportunities: InterliningOpportunity[],
    filters: {
        terminus?: string;
        route?: string;
        feasibility?: InterliningFeasibility[];
        showActive?: boolean;
        showSameRoute?: boolean;
        timeRangeStart?: number;
        timeRangeEnd?: number;
    }
): InterliningOpportunity[] {
    return opportunities.filter(opp => {
        // Terminus filter
        if (filters.terminus && !terminusMatch(opp.terminus, filters.terminus)) {
            return false;
        }

        // Route filter
        if (filters.route &&
            !opp.route1.name.includes(filters.route) &&
            !opp.route2.name.includes(filters.route)) {
            return false;
        }

        // Feasibility filter
        if (filters.feasibility && !filters.feasibility.includes(opp.feasibility)) {
            return false;
        }

        // Active interlines filter
        if (filters.showActive === false && opp.isCurrentlyActive) {
            return false;
        }

        // Same route filter
        if (filters.showSameRoute === false && opp.isSameRoute) {
            return false;
        }

        // Time range filter
        if (filters.timeRangeStart !== undefined && opp.route1.endTime < filters.timeRangeStart) {
            return false;
        }
        if (filters.timeRangeEnd !== undefined && opp.route1.endTime > filters.timeRangeEnd) {
            return false;
        }

        return true;
    });
}

/**
 * Export opportunities to CSV format
 */
export function exportOpportunitiesToCSV(opportunities: InterliningOpportunity[]): string {
    const headers = [
        'From Route',
        'From Direction',
        'Arrives At',
        'Arrival Time',
        'To Route',
        'To Direction',
        'Departs From',
        'Departure Time',
        'Gap (min)',
        'Feasibility',
        'Currently Active',
        'Day Type'
    ];

    const rows = opportunities.map(opp => [
        opp.route1.variant,
        opp.route1.direction,
        opp.route1.terminus,
        opp.route1.endTimeStr,
        opp.route2.variant,
        opp.route2.direction,
        opp.route2.terminus,
        opp.route2.startTimeStr,
        opp.gapMinutes.toString(),
        opp.feasibility,
        opp.isCurrentlyActive ? 'Yes' : 'No',
        opp.dayType
    ]);

    return [headers, ...rows].map(row => row.join(',')).join('\n');
}

/**
 * Get summary statistics for opportunities
 */
export function getOpportunitySummary(opportunities: InterliningOpportunity[]): {
    total: number;
    byFeasibility: Record<InterliningFeasibility, number>;
    currentlyActive: number;
    newOpportunities: number;
    uniqueRoutes: number;
    uniqueTermini: number;
} {
    const byFeasibility: Record<InterliningFeasibility, number> = {
        good: 0,
        tight: 0,
        marginal: 0
    };

    const routes = new Set<string>();
    const termini = new Set<string>();
    let currentlyActive = 0;

    for (const opp of opportunities) {
        byFeasibility[opp.feasibility]++;
        routes.add(opp.route1.name);
        routes.add(opp.route2.name);
        termini.add(opp.terminus);
        if (opp.isCurrentlyActive) currentlyActive++;
    }

    return {
        total: opportunities.length,
        byFeasibility,
        currentlyActive,
        newOpportunities: opportunities.length - currentlyActive,
        uniqueRoutes: routes.size,
        uniqueTermini: termini.size
    };
}
