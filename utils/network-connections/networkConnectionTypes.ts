import type { DayType, MasterScheduleContent, MasterScheduleEntry } from '../masterScheduleTypes';

export type NetworkConnectionSourceKind = 'published-master';
export type NetworkConnectionTimeBand = 'full_day' | 'am_peak' | 'midday' | 'pm_peak' | 'evening';
export type NetworkConnectionHubType = 'shared_stop' | 'nearby_cluster';
export type NetworkConnectionSeverity = 'strong' | 'mixed' | 'weak';
export type NetworkConnectionRecommendationType = 'protect' | 'retime' | 'pulse' | 'retarget' | 'structural';
export type NetworkConnectionClass = 'missed' | 'tight' | 'good' | 'long';

export interface NetworkConnectionThresholds {
    nearbyRadiusMeters: number;
    maxWaitMinutes: number;
    nearbyWalkPenaltyMinutes: number;
    tightMaxMinutes: number;
    goodMaxMinutes: number;
    longMaxMinutes: number;
}

export interface NetworkConnectionScheduleInput {
    entry: MasterScheduleEntry;
    content: MasterScheduleContent;
}

export interface NetworkConnectionServiceRef {
    key: string;
    routeIdentity: string;
    routeNumber: string;
    dayType: DayType;
    direction: 'North' | 'South';
    label: string;
    routeColor?: string | null;
}

export interface NetworkConnectionHubStop {
    stopId: string;
    stopName: string;
    lat: number;
    lon: number;
    routeNumbers: string[];
    serviceKeys: string[];
}

export interface NetworkConnectionHub {
    id: string;
    name: string;
    lat: number;
    lon: number;
    hubType: NetworkConnectionHubType;
    routeNumbers: string[];
    serviceKeys: string[];
    stops: NetworkConnectionHubStop[];
    patternIds: string[];
    issueScore: number;
    severity: NetworkConnectionSeverity;
    topRecommendationSummary: string;
}

export interface NetworkConnectionOpportunity {
    hubId: string;
    fromServiceKey: string;
    toServiceKey: string;
    fromTripId: string;
    toTripId: string | null;
    fromStopId: string;
    fromStopName: string;
    toStopId: string | null;
    toStopName: string | null;
    fromTime: number;
    toTime: number | null;
    waitMinutes: number | null;
    classification: NetworkConnectionClass;
    timeBand: NetworkConnectionTimeBand;
}

export interface NetworkConnectionRecommendation {
    id: string;
    type: NetworkConnectionRecommendationType;
    title: string;
    summary: string;
    rationale: string;
    confidence: 'high' | 'medium' | 'low';
}

export interface NetworkConnectionPattern {
    id: string;
    hubId: string;
    fromService: NetworkConnectionServiceRef;
    toService: NetworkConnectionServiceRef;
    opportunityCount: number;
    missedCount: number;
    tightCount: number;
    goodCount: number;
    longWaitCount: number;
    missRate: number;
    medianWaitMinutes: number | null;
    avgWaitMinutes: number | null;
    severity: NetworkConnectionSeverity;
    score: number;
    opportunities: NetworkConnectionOpportunity[];
    recommendations: NetworkConnectionRecommendation[];
}

export interface NetworkConnectionSummary {
    sourceKind: NetworkConnectionSourceKind;
    sourceLabel: string;
    dayType: DayType;
    timeBand: NetworkConnectionTimeBand;
    hubCount: number;
    patternCount: number;
    weakPatternCount: number;
    avgObservedWaitMinutes: number | null;
}

export interface NetworkConnectionAnalysisResult {
    summary: NetworkConnectionSummary;
    thresholds: NetworkConnectionThresholds;
    hubs: NetworkConnectionHub[];
    patterns: NetworkConnectionPattern[];
    services: NetworkConnectionServiceRef[];
}
