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
