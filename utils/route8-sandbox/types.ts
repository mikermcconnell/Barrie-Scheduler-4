import type { DayType, MasterScheduleContent, RouteIdentity } from '../masterScheduleTypes';

export type Route8Branch = '8A' | '8B';
export type Route8SandboxStatus = 'draft';

export interface Route8SandboxSourceSnapshot {
    routeNumber: Route8Branch;
    routeIdentity: RouteIdentity;
    version: number;
    updatedAt: string;
    publishedAt?: string;
    effectiveDate?: string;
    notes?: string;
}

export interface Route8SandboxContent {
    dayType: DayType;
    sourceSnapshots: Record<Route8Branch, Route8SandboxSourceSnapshot>;
    sourceCopies: Record<Route8Branch, MasterScheduleContent>;
    workingCopies: Record<Route8Branch, MasterScheduleContent>;
    notes?: string;
}

export interface Route8SandboxProject {
    id: string;
    name: string;
    dayType: DayType;
    teamId?: string | null;
    status: Route8SandboxStatus;
    createdAt: Date;
    updatedAt: Date;
    createdBy: string;
    storagePath?: string;
    content?: Route8SandboxContent;
}

export interface Route8SandboxProjectInput extends Omit<Route8SandboxProject, 'id' | 'createdAt' | 'updatedAt'> {
    id?: string;
}

export interface Route8SandboxProjectMetadata {
    id: string;
    name: string;
    dayType: DayType;
    teamId?: string | null;
    status: Route8SandboxStatus;
    createdAt: Date;
    updatedAt: Date;
    createdBy: string;
}

export interface Route8DirectionSummary {
    id: string;
    branch: Route8Branch;
    direction: 'North' | 'South';
    routeName: string;
    tripCount: number;
    firstDeparture: string | null;
    lastDeparture: string | null;
    firstBlockId: string | null;
    lastBlockId: string | null;
    startStop: string | null;
    allandaleStop: string | null;
    endStop: string | null;
}

export interface Route8TerminalEvent {
    id: string;
    branch: Route8Branch;
    direction: 'North' | 'South';
    blockId: string;
    stopName: string;
    arrivalTime: string | null;
    departureTime: string | null;
    recoveryMinutes: number;
    nextTripSummary: string | null;
}

export interface Route8BlockFlowSegment {
    id: string;
    branch: Route8Branch;
    direction: 'North' | 'South';
    routeName: string;
    blockId: string;
    startTime: string;
    endTime: string;
    startStop: string | null;
    endStop: string | null;
    allandaleTime: string | null;
}

export interface Route8BlockFlowRow {
    blockId: string;
    firstStartTime: string | null;
    lastEndTime: string | null;
    segments: Route8BlockFlowSegment[];
}

export interface Route8TimepointSummary {
    id: string;
    branch: Route8Branch;
    direction: 'North' | 'South';
    startStop: string | null;
    allandaleStop: string | null;
    endStop: string | null;
    firstDeparture: string | null;
    lastDeparture: string | null;
}

export interface Route8FamilyModel {
    directionSummaries: Route8DirectionSummary[];
    terminalEvents: Route8TerminalEvent[];
    blockRows: Route8BlockFlowRow[];
    timepointSummaries: Route8TimepointSummary[];
}
