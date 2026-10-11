import type { MasterScheduleContent, MasterScheduleEntry, DayType } from '../masterScheduleTypes';

export type { RegionalGoFeed } from './goFeedTypes';

export type GoStationKey = 'allandale' | 'south';
export type ConnectionDirection = 'to-go' | 'from-go';
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
export interface RejectedBusTrip {
    tripId: string;
    /** Service minutes the trip could call at the station; null when its anchors are unusable. */
    window: [number, number] | null;
    issue: string;
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
    /** Trips excluded from assessment; each blocks only cells its service window could reach. */
    rejectedArrivals?: RejectedBusTrip[];
    rejectedDepartures?: RejectedBusTrip[];
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
