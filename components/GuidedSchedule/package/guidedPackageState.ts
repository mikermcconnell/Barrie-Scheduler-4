import type { MasterScheduleEntry } from '../../../utils/masterScheduleTypes';
import type { MasterRouteTable } from '../../../utils/parsers/masterScheduleParser';

export interface GuidedPublishedVersion {
    version: number;
    publishedAt: string | null;
}

export interface GuidedPackageEntry {
    draftId: string | null;
    /** The Step 4 schedule the draft was opened from; a later change makes the draft out of date. */
    draftSource: MasterRouteTable[] | null;
    published: GuidedPublishedVersion | null;
}

export const EMPTY_PACKAGE_ENTRY: GuidedPackageEntry = { draftId: null, draftSource: null, published: null };

export type GuidedPackageStatus = 'no-draft' | 'draft-outdated' | 'draft' | 'published';

export const getPackageStatus = (entry: GuidedPackageEntry, schedules: MasterRouteTable[]): GuidedPackageStatus => {
    if (!entry.draftId) return 'no-draft';
    if (entry.draftSource !== schedules) return 'draft-outdated';
    return entry.published ? 'published' : 'draft';
};

/**
 * A day type counts as published only when Master's current version was
 * published from this set's draft. Anything else (no entry, another draft,
 * an older publish) leaves it unconfirmed.
 */
export const confirmPublishedVersion = (
    entry: MasterScheduleEntry | null,
    draftId: string | null
): GuidedPublishedVersion | null => {
    if (!entry || !draftId || entry.publishedFromDraft !== draftId) return null;
    const publishedAt = entry.publishedAt instanceof Date && !Number.isNaN(entry.publishedAt.getTime())
        ? entry.publishedAt.toISOString()
        : null;
    return { version: entry.currentVersion, publishedAt };
};

/** Exports unlock only when every day type in the set has a confirmed published version from its current draft. */
export const canExportPackage = (statuses: GuidedPackageStatus[]): boolean => (
    statuses.length > 0 && statuses.every(status => status === 'published')
);
