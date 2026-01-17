import type { DayType, MasterScheduleContent, RouteIdentity } from './masterScheduleTypes';

export type DraftStatus = 'draft' | 'ready_for_review';

export type DraftBasedOn = {
    type: 'master' | 'gtfs' | 'generated' | 'legacy';
    id?: string;
    importedAt?: Date;
};

export interface DraftSchedule {
    id: string;
    name: string;
    routeNumber: string;
    dayType: DayType;
    content?: MasterScheduleContent;
    status: DraftStatus;
    createdAt: Date;
    updatedAt: Date;
    createdBy: string;
    basedOn?: DraftBasedOn;
    storagePath?: string;
}

export interface DraftScheduleInput extends Omit<DraftSchedule, 'id' | 'createdAt' | 'updatedAt'> {
    id?: string;
}

export interface PublishedVersion {
    version: number;
    content: MasterScheduleContent;
    publishedAt: Date;
    publishedBy: string;
    publishedFromDraft?: string;
}

export interface PublishedSchedule {
    id: RouteIdentity;
    routeNumber: string;
    dayType: DayType;
    content: MasterScheduleContent;
    version: number;
    publishedAt: Date;
    publishedBy: string;
    publishedFromDraft?: string;
    history?: PublishedVersion[];
}
