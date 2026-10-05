import type { MasterScheduleContent, MasterScheduleEntry, DayType } from '../masterScheduleTypes';

export type GoStationKey = 'allandale' | 'south';
export type ConnectionDirection = 'to-go' | 'from-go';
export interface RegionalGoFeed {
    fetchedAt: string;
    sourceUrl: string;
    timezone: string;
    stops: { stop_id: string; stop_name: string; parent_station?: string }[];
    routes: { route_id: string; route_type: number }[];
    trips: { trip_id: string; route_id: string; service_id: string; trip_short_name?: string; trip_headsign?: string; direction_id?: number | string }[];
    stopTimes: { trip_id: string; stop_id: string; arrival_time: string; departure_time: string; stop_sequence: number; pickup_type?: number; drop_off_type?: number }[];
    calendar: { service_id: string; start_date: string; end_date: string; monday: string | number; tuesday: string | number; wednesday: string | number; thursday: string | number; friday: string | number; saturday: string | number; sunday: string | number }[];
    calendarDates: { service_id: string; date: string; exception_type: string | number }[];
}
export interface GoTrainEvent {
    id: string;
    tripId: string;
    trainNumber: string;
    headsign: string;
    stationStopId: string;
    direction: ConnectionDirection;
    minutes: number;
}
export interface GoDateResult {
    status: 'ready' | 'no-service' | 'unavailable';
    events: GoTrainEvent[];
    issues: string[];
    validFrom?: string;
    validTo?: string;
}
export interface PublishedRouteSource {
    entry: MasterScheduleEntry;
    content?: MasterScheduleContent;
    error?: string;
}
export interface LocalConnectionRow {
    id: string;
    routeNumber: string;
    direction: string;
    version: number;
    stopNames: string[];
    stopCodes: string[];
    status: 'ready' | 'unavailable';
    issue?: string;
    arrivalIssue?: string;
    departureIssue?: string;
    arrivals: { tripId: string; minutes: number; stopName: string; stopCode: string }[];
    departures: { tripId: string; minutes: number; stopName: string; stopCode: string }[];
}
export interface ConnectionCell {
    status: 'comfortable' | 'tight' | 'long' | 'no-connection' | 'unavailable';
    busMinutes?: number;
    gapMinutes?: number;
    tripId?: string;
    stopName?: string;
    stopCode?: string;
    issue?: string;
}
export interface RegionalConnectionsProps {
    schedules: MasterScheduleEntry[];
    readTeamId: string;
    dayTypeForDate?: (date: string) => DayType | 'No Service';
    onRefreshSchedules?: () => Promise<void>;
}
