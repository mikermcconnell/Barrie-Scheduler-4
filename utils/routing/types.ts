// RAPTOR Engine Types
// Ported from BTTP localRouter.js, routingDataService.js, itineraryBuilder.js

// ─── GTFS Input Types ───────────────────────────────────────────────

export interface GtfsStop {
  stopId: string;
  stopName: string;
  lat: number;
  lon: number;
}

export interface GtfsTrip {
  tripId: string;
  routeId: string;
  serviceId: string;
  directionId: number;
  headsign: string;
  shapeId?: string;
}

export interface GtfsStopTime {
  tripId: string;
  stopId: string;
  arrivalTime: number;   // seconds since midnight (supports > 86400 for post-midnight)
  departureTime: number;
  stopSequence: number;
  pickupType?: number;
  dropOffType?: number;
}

export interface GtfsRoute {
  routeId: string;
  routeShortName: string;
  routeLongName?: string;
  routeColor?: string;
}

export interface CalendarEntry {
  serviceId: string;
  startDate: string;  // YYYYMMDD
  endDate: string;     // YYYYMMDD
  monday: boolean;
  tuesday: boolean;
  wednesday: boolean;
  thursday: boolean;
  friday: boolean;
  saturday: boolean;
  sunday: boolean;
}

export interface CalendarDate {
  serviceId: string;
  date: string;          // YYYYMMDD
  exceptionType: 1 | 2; // 1 = service added, 2 = service removed
}

export type DayOfWeek = 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday' | 'sunday';

// ─── Service Calendar ───────────────────────────────────────────────

/** Map of YYYYMMDD date strings to sets of active service IDs */
export type ServiceCalendar = Record<string, Set<string>>;

// ─── GTFS Data Bundle ───────────────────────────────────────────────

export interface GtfsData {
  stops: GtfsStop[];
  trips: GtfsTrip[];
  stopTimes: GtfsStopTime[];
  routes: GtfsRoute[];
  calendar: CalendarEntry[];
  calendarDates: CalendarDate[];
}

// ─── Routing Index Types ────────────────────────────────────────────

export interface Departure {
  tripId: string;
  routeId: string;
  serviceId: string;
  directionId: number;
  patternId: string;
  headsign: string;
  departureTime: number;  // seconds since midnight
  arrivalTime: number;
  stopSequence: number;
  pickupType?: number;
}

export interface RoutePattern {
  patternId: string;
  routeId: string;
  directionId: number;
  stopSequence: string[];
  tripIds: string[];
}

export interface Transfer {
  toStopId: string;
  walkMeters: number;
  walkSeconds: number;
}

export interface NearbyStop {
  stop: GtfsStop;
  walkMeters: number;
  walkSeconds: number;
}

export interface RoutingData {
  stopDepartures: Record<string, Departure[]>;
  routePatterns: Record<string, Record<string, RoutePattern[]>>;
  transfers: Record<string, Transfer[]>;
  tripIndex: Record<string, GtfsTrip>;
  routeIndex: Record<string, GtfsRoute>;
  tripPatternIndex: Record<string, string>;
  stopIndex: Record<string, GtfsStop>;
  stopRoutes: Record<string, Set<string>>;
  stopTimesIndex: Record<string, GtfsStopTime>;  // compound key "tripId_stopId" (last visit wins for loop routes)
  tripStopTimes: Record<string, GtfsStopTime[]>; // tripId → stop times sorted by sequence
  serviceCalendar: ServiceCalendar;
  stops: GtfsStop[];
  trips: GtfsTrip[];
  routes: GtfsRoute[];
  stopTimes: GtfsStopTime[];
}

// ─── RAPTOR Algorithm Types ─────────────────────────────────────────

export interface OriginWalkSegment {
  type: 'ORIGIN_WALK';
  toStopId: string;
  walkSeconds: number;
}

export interface TransitSegment {
  type: 'TRANSIT';
  tripId: string;
  routeId: string;
  directionId: number;
  headsign: string;
  boardingStopId: string;
  alightingStopId: string;
  boardingTime: number;
  alightingTime: number;
}

export interface TransferSegment {
  type: 'TRANSFER';
  fromStopId: string;
  toStopId: string;
  walkSeconds: number;
  walkMeters: number;
}

export type PathSegment = OriginWalkSegment | TransitSegment | TransferSegment;

export interface RaptorResult {
  destinationStopId: string;
  walkToDestSeconds: number;
  arrivalTime: number;
  path: PathSegment[];
  directWalkMeters?: number;
}

// ─── RAPTOR Label (internal to algorithm) ───────────────────────────

export type LabelEntry =
  | { type: 'ORIGIN_WALK'; walkSeconds: number }
  | { type: 'TRANSIT'; tripId: string; routeId: string; directionId: number; headsign: string; boardingStopId: string; boardingTime: number }
  | { type: 'TRANSFER'; fromStopId: string; walkSeconds: number; walkMeters: number };

// ─── Routing Error ──────────────────────────────────────────────────

export const ROUTING_ERROR_CODES = {
  NO_NEARBY_STOPS: 'NO_NEARBY_STOPS',
  NO_SERVICE: 'NO_SERVICE',
  NO_ROUTE_FOUND: 'NO_ROUTE_FOUND',
  OUTSIDE_SERVICE_AREA: 'OUTSIDE_SERVICE_AREA',
} as const;

export type RoutingErrorCode = typeof ROUTING_ERROR_CODES[keyof typeof ROUTING_ERROR_CODES];

export class RoutingError extends Error {
  code: RoutingErrorCode;
  constructor(code: RoutingErrorCode, message: string) {
    super(message);
    this.name = 'RoutingError';
    this.code = code;
  }
}

// ─── Itinerary Output Types ─────────────────────────────────────────

export interface Place {
  name: string;
  stopId?: string;
  lat: number;
  lon: number;
}

export interface RouteInfo {
  id: string;
  shortName: string;
  longName: string;
  color: string;
}

export interface LegGeometry {
  points: string;  // encoded polyline
  length: number;
}

export interface WalkLeg {
  mode: 'WALK';
  startTime: number;   // Unix ms
  endTime: number;
  duration: number;     // seconds
  distance: number;     // meters
  from: Place;
  to: Place;
  route: null;
  headsign: null;
  tripId: null;
  intermediateStops: null;
  legGeometry: LegGeometry | null;
}

export interface TransitLeg {
  mode: 'BUS';
  startTime: number;
  endTime: number;
  duration: number;
  distance: number;
  from: Place;
  to: Place;
  route: RouteInfo;
  headsign: string;
  tripId: string;
  intermediateStops: Place[];
  legGeometry: LegGeometry | null;
}

export type Leg = WalkLeg | TransitLeg;

export interface Itinerary {
  id: string;
  duration: number;      // seconds
  startTime: number;     // Unix ms
  endTime: number;
  walkTime: number;      // seconds
  transitTime: number;
  waitingTime: number;
  walkDistance: number;   // meters
  transfers: number;
  legs: Leg[];
}

// ─── Walking Service Types ──────────────────────────────────────────

export interface WalkStep {
  instruction: string;
  distance: number;
  duration: number;
  type: string;
  modifier: string | null;
  name: string;
}

export interface WalkingDirections {
  distance: number;     // meters
  duration: number;     // seconds
  geometry: string | null;  // encoded polyline
  steps: WalkStep[];
  source: 'mapbox' | 'estimate';
}

// ─── Plan Trip Options ──────────────────────────────────────────────

export interface PlanTripOptions {
  fromLat: number;
  fromLon: number;
  toLat: number;
  toLon: number;
  date: Date;
  time?: Date;
  routingData: RoutingData;
  originStopIds?: string[];
  destinationStopIds?: string[];
}

// ─── Coordinate Type ────────────────────────────────────────────────

export interface Coordinate {
  latitude: number;
  longitude: number;
}
