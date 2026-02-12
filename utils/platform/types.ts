export interface DwellEvent {
    eventUid: string;
    tripId: string;
    route: string;
    direction: 'North' | 'South';
    arrivalMin: number;      // Minutes from midnight
    departureMin: number;
    blockId: string;
    gtfsBlockId?: string;
    stopName: string;
    stopId?: string;
}

export interface ConflictWindow {
    startMin: number;
    endMin: number;
    busCount: number;
    events: DwellEvent[];
}

export interface PlatformAnalysis {
    platformId: string;
    routes: string[];
    capacity: number;
    events: DwellEvent[];
    peakCount: number;
    peakWindows: ConflictWindow[];
    totalVisits: number;
    hasConflict: boolean;    // buses > capacity at same time
    conflictWindows: ConflictWindow[];
}

export interface HubAnalysis {
    hubName: string;
    platforms: PlatformAnalysis[];
    totalDailyVisits: number;
    conflictCount: number;   // Total platforms with conflicts
    totalConflictWindows: number;
}
