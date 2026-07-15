import type { DayType, MasterScheduleContent } from '../masterScheduleTypes';

export type ScheduleReviewStatus = 'ready_for_review' | 'approved' | 'changes_requested';

export interface ScheduleReviewSummary {
    totalTrips: number;
    northTrips: number;
    southTrips: number;
    addedTrips: number;
    removedTrips: number;
    retimedTrips: number;
    extendedTrips: number;
    shortenedTrips: number;
    reviewNeededTrips: number;
    overlapTrips: number;
    tightRecoveryTrips: number;
    warningCount: number;
    blockingIssueCount: number;
    totalChanges: number;
}

export interface ScheduleReviewMetadata {
    id: string;
    schemaVersion: 1;
    teamId: string;
    routeNumber: string;
    dayType: DayType;
    draftId: string;
    sourceVersion: number;
    status: ScheduleReviewStatus;
    plannerNote: string;
    summary: ScheduleReviewSummary;
    storagePath: string;
    payloadBytes: number;
    createdBy: string;
    createdByName: string;
    createdAt: Date;
    updatedAt: Date;
    reviewedBy?: string;
    reviewedAt?: Date;
}

export interface ScheduleReviewPayload {
    schemaVersion: 1;
    reviewId: string;
    teamId: string;
    createdBy: string;
    routeNumber: string;
    dayType: DayType;
    draftId: string;
    sourceVersion: number;
    summary: ScheduleReviewSummary;
    schedule: MasterScheduleContent;
}

export interface CreateScheduleReviewInput {
    teamId: string;
    userId: string;
    plannerName: string;
    routeNumber: string;
    dayType: DayType;
    draftId: string;
    sourceVersion: number;
    plannerNote?: string;
    schedule: MasterScheduleContent;
    sourceSchedule?: MasterScheduleContent | null;
}

export interface UpdateScheduleReviewStatusInput {
    teamId: string;
    reviewId: string;
    reviewerId: string;
    status: ScheduleReviewStatus;
}
