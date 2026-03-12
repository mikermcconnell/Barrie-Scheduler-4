export type ShuttlePattern = 'loop' | 'out-and-back';
export type ShuttleStopKind = 'barrie' | 'custom';
export type ShuttleStopRole = 'terminal' | 'timed' | 'regular';
export type ShuttleScenarioAccent = 'indigo' | 'emerald' | 'amber' | 'cyan';
export type ShuttleScenarioStatus = 'draft' | 'ready_for_review';

export interface ShuttleStop {
    id: string;
    name: string;
    kind: ShuttleStopKind;
    barrieStopId?: string;
    role: ShuttleStopRole;
    latitude: number;
    longitude: number;
    timeLabel: string;
    plannedOffsetMinutes?: number | null;
}

export interface ShuttleScenario {
    id: string;
    name: string;
    pattern: ShuttlePattern;
    accent: ShuttleScenarioAccent;
    notes: string;
    distanceKm: number;
    runtimeMinutes: number;
    cycleMinutes: number;
    busesRequired: number;
    serviceHours: number;
    firstDeparture: string;
    lastDeparture: string;
    frequencyMinutes: number;
    layoverMinutes: number;
    warnings: string[];
    departures: string[];
    waypoints: [number, number][];
    geometry: GeoJSON.LineString;
    stops: ShuttleStop[];
    status: ShuttleScenarioStatus;
}

export interface ShuttleProject {
    id: string;
    name: string;
    description?: string;
    teamId?: string | null;
    preferredScenarioId?: string | null;
    scenarios: ShuttleScenario[];
    createdAt: Date;
    updatedAt: Date;
}
