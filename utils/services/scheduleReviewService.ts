import {
    collection,
    doc,
    getDoc,
    getDocs,
    limit,
    orderBy,
    query,
    serverTimestamp,
    setDoc,
    updateDoc,
} from 'firebase/firestore';
import {
    deleteObject,
    getBytes,
    ref,
    uploadBytes,
} from 'firebase/storage';
import { db, storage } from '../firebase';
import {
    buildDetailedMasterComparison,
    buildMasterComparisonChangeSummary,
} from '../schedule/masterComparison';
import type { MasterScheduleContent } from '../masterScheduleTypes';
import type {
    CreateScheduleReviewInput,
    ScheduleReviewMetadata,
    ScheduleReviewPayload,
    ScheduleReviewStatus,
    ScheduleReviewSummary,
    UpdateScheduleReviewStatusInput,
} from '../schedule/scheduleReviewTypes';

export const SCHEDULE_REVIEW_SCHEMA_VERSION = 1 as const;
export const MAX_SCHEDULE_REVIEW_PAYLOAD_BYTES = 10 * 1024 * 1024;
export const MAX_SCHEDULE_REVIEW_NOTE_LENGTH = 2000;
export const MAX_SCHEDULE_REVIEW_LIST_SIZE = 100;

const REVIEWS_COLLECTION = 'scheduleReviews';
const REVIEW_STATUSES: ReadonlySet<ScheduleReviewStatus> = new Set([
    'ready_for_review',
    'approved',
    'changes_requested',
]);

const assertDocumentId = (value: string, label: string): string => {
    const trimmed = value.trim();
    if (!trimmed || trimmed.length > 128 || trimmed.includes('/')) {
        throw new Error(`${label} is invalid.`);
    }
    return trimmed;
};

const assertShortText = (value: string, label: string, maxLength: number): string => {
    const trimmed = value.trim();
    if (!trimmed || trimmed.length > maxLength) {
        throw new Error(`${label} is invalid.`);
    }
    return trimmed;
};

const timestampToDate = (value: unknown): Date => {
    if (value instanceof Date) return value;
    if (value && typeof value === 'object' && 'toDate' in value && typeof value.toDate === 'function') {
        return value.toDate();
    }
    return new Date(0);
};

const countFlaggedTrips = (
    content: MasterScheduleContent,
    flag: 'isOverlap' | 'isTightRecovery',
): number => (
    [...content.northTable.trips, ...content.southTable.trips]
        .filter(trip => trip[flag] === true)
        .length
);

const reviewSummaryFields: ReadonlyArray<keyof ScheduleReviewSummary> = [
    'totalTrips', 'northTrips', 'southTrips', 'addedTrips', 'removedTrips',
    'retimedTrips', 'extendedTrips', 'shortenedTrips', 'reviewNeededTrips',
    'overlapTrips', 'tightRecoveryTrips', 'warningCount', 'blockingIssueCount',
    'totalChanges',
];

const reviewSummariesEqual = (
    left: ScheduleReviewSummary,
    right: ScheduleReviewSummary,
): boolean => reviewSummaryFields.every(field => left[field] === right[field]);

export const buildScheduleReviewSummary = (
    schedule: MasterScheduleContent,
    sourceSchedule?: MasterScheduleContent | null,
): ScheduleReviewSummary => {
    const currentTables = [schedule.northTable, schedule.southTable];
    const sourceTables = sourceSchedule
        ? [sourceSchedule.northTable, sourceSchedule.southTable]
        : null;
    const northTrips = schedule.northTable.trips.length;
    const southTrips = schedule.southTable.trips.length;
    const overlapTrips = countFlaggedTrips(schedule, 'isOverlap');
    const tightRecoveryTrips = countFlaggedTrips(schedule, 'isTightRecovery');

    if (!sourceTables) {
        return {
            totalTrips: northTrips + southTrips,
            northTrips,
            southTrips,
            addedTrips: northTrips + southTrips,
            removedTrips: 0,
            retimedTrips: 0,
            extendedTrips: 0,
            shortenedTrips: 0,
            reviewNeededTrips: 0,
            overlapTrips,
            tightRecoveryTrips,
            warningCount: tightRecoveryTrips,
            blockingIssueCount: overlapTrips,
            totalChanges: northTrips + southTrips,
        };
    }

    const detailed = buildDetailedMasterComparison(currentTables, sourceTables);
    const comparison = buildMasterComparisonChangeSummary(currentTables, detailed).counts;

    return {
        totalTrips: northTrips + southTrips,
        northTrips,
        southTrips,
        addedTrips: comparison.new,
        removedTrips: comparison.removed,
        retimedTrips: comparison.retimed,
        extendedTrips: comparison.extended,
        shortenedTrips: comparison.shortened,
        reviewNeededTrips: comparison.review,
        overlapTrips,
        tightRecoveryTrips,
        warningCount: comparison.review + tightRecoveryTrips,
        blockingIssueCount: overlapTrips,
        totalChanges: comparison.totalChanges,
    };
};

const buildStoragePath = (teamId: string, reviewId: string, userId: string): string => (
    `teams/${teamId}/${REVIEWS_COLLECTION}/${reviewId}/${userId}/schedule.json`
);

const parseMetadata = (id: string, data: Record<string, unknown>): ScheduleReviewMetadata => ({
    id,
    schemaVersion: SCHEDULE_REVIEW_SCHEMA_VERSION,
    teamId: String(data.teamId ?? ''),
    routeNumber: String(data.routeNumber ?? ''),
    dayType: data.dayType as ScheduleReviewMetadata['dayType'],
    draftId: String(data.draftId ?? ''),
    sourceVersion: Number(data.sourceVersion ?? 0),
    status: data.status as ScheduleReviewStatus,
    plannerNote: String(data.plannerNote ?? ''),
    summary: data.summary as ScheduleReviewSummary,
    storagePath: String(data.storagePath ?? ''),
    payloadBytes: Number(data.payloadBytes ?? 0),
    createdBy: String(data.createdBy ?? ''),
    createdByName: String(data.createdByName ?? ''),
    createdAt: timestampToDate(data.createdAt),
    updatedAt: timestampToDate(data.updatedAt),
    ...(data.reviewedBy ? { reviewedBy: String(data.reviewedBy) } : {}),
    ...(data.reviewedAt ? { reviewedAt: timestampToDate(data.reviewedAt) } : {}),
});

export const createScheduleReview = async (
    input: CreateScheduleReviewInput,
): Promise<ScheduleReviewMetadata> => {
    const teamId = assertDocumentId(input.teamId, 'Team ID');
    const userId = assertDocumentId(input.userId, 'User ID');
    const draftId = assertDocumentId(input.draftId, 'Draft ID');
    const routeNumber = assertShortText(input.routeNumber, 'Route number', 16);
    const createdByName = assertShortText(input.plannerName, 'Planner name', 200);
    const plannerNote = (input.plannerNote ?? '').trim();

    if (plannerNote.length > MAX_SCHEDULE_REVIEW_NOTE_LENGTH) {
        throw new Error(`Planner note must be ${MAX_SCHEDULE_REVIEW_NOTE_LENGTH} characters or fewer.`);
    }
    if (!Number.isInteger(input.sourceVersion) || input.sourceVersion < 0 || input.sourceVersion > 1_000_000) {
        throw new Error('Source version is invalid.');
    }

    const reviewsRef = collection(db, 'teams', teamId, REVIEWS_COLLECTION);
    const reviewRef = doc(reviewsRef);
    const reviewId = reviewRef.id;
    const storagePath = buildStoragePath(teamId, reviewId, userId);
    const summary = buildScheduleReviewSummary(input.schedule, input.sourceSchedule);
    const payload: ScheduleReviewPayload = {
        schemaVersion: SCHEDULE_REVIEW_SCHEMA_VERSION,
        reviewId,
        teamId,
        createdBy: userId,
        routeNumber,
        dayType: input.dayType,
        draftId,
        sourceVersion: input.sourceVersion,
        summary,
        schedule: input.schedule,
    };
    const payloadBytes = new TextEncoder().encode(JSON.stringify(payload));

    if (payloadBytes.byteLength === 0 || payloadBytes.byteLength > MAX_SCHEDULE_REVIEW_PAYLOAD_BYTES) {
        throw new Error('Schedule review payload exceeds the 10 MB limit.');
    }

    const payloadRef = ref(storage, storagePath);
    await uploadBytes(payloadRef, payloadBytes, { contentType: 'application/json' });

    try {
        await setDoc(reviewRef, {
            schemaVersion: SCHEDULE_REVIEW_SCHEMA_VERSION,
            teamId,
            routeNumber,
            dayType: input.dayType,
            draftId,
            sourceVersion: input.sourceVersion,
            status: 'ready_for_review',
            plannerNote,
            summary,
            storagePath,
            payloadBytes: payloadBytes.byteLength,
            createdBy: userId,
            createdByName,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
        });
    } catch (error) {
        try {
            await deleteObject(payloadRef);
        } catch {
            // The metadata write error remains authoritative. Orphan cleanup can be retried by support.
        }
        throw error;
    }

    const now = new Date();
    return {
        id: reviewId,
        schemaVersion: SCHEDULE_REVIEW_SCHEMA_VERSION,
        teamId,
        routeNumber,
        dayType: input.dayType,
        draftId,
        sourceVersion: input.sourceVersion,
        status: 'ready_for_review',
        plannerNote,
        summary,
        storagePath,
        payloadBytes: payloadBytes.byteLength,
        createdBy: userId,
        createdByName,
        createdAt: now,
        updatedAt: now,
    };
};

export const getScheduleReview = async (
    teamIdInput: string,
    reviewIdInput: string,
): Promise<ScheduleReviewMetadata | null> => {
    const teamId = assertDocumentId(teamIdInput, 'Team ID');
    const reviewId = assertDocumentId(reviewIdInput, 'Review ID');
    const snapshot = await getDoc(doc(db, 'teams', teamId, REVIEWS_COLLECTION, reviewId));
    return snapshot.exists() ? parseMetadata(snapshot.id, snapshot.data()) : null;
};

export const listScheduleReviews = async (
    teamIdInput: string,
    maxResults = 50,
): Promise<ScheduleReviewMetadata[]> => {
    const teamId = assertDocumentId(teamIdInput, 'Team ID');
    const resultLimit = Math.max(1, Math.min(Math.floor(maxResults), MAX_SCHEDULE_REVIEW_LIST_SIZE));
    const reviewsQuery = query(
        collection(db, 'teams', teamId, REVIEWS_COLLECTION),
        orderBy('createdAt', 'desc'),
        limit(resultLimit),
    );
    const snapshot = await getDocs(reviewsQuery);
    return snapshot.docs.map(review => parseMetadata(review.id, review.data()));
};

export const loadScheduleReviewPayload = async (
    metadata: Pick<ScheduleReviewMetadata,
        'teamId' | 'id' | 'createdBy' | 'storagePath' | 'payloadBytes'
        | 'routeNumber' | 'dayType' | 'draftId' | 'sourceVersion' | 'summary'>,
): Promise<ScheduleReviewPayload> => {
    const expectedPath = buildStoragePath(
        assertDocumentId(metadata.teamId, 'Team ID'),
        assertDocumentId(metadata.id, 'Review ID'),
        assertDocumentId(metadata.createdBy, 'Creator ID'),
    );
    if (metadata.storagePath !== expectedPath) {
        throw new Error('Schedule review storage path is invalid.');
    }
    if (!Number.isInteger(metadata.payloadBytes) || metadata.payloadBytes <= 0 || metadata.payloadBytes > MAX_SCHEDULE_REVIEW_PAYLOAD_BYTES) {
        throw new Error('Schedule review payload size is invalid.');
    }

    const bytes = await getBytes(ref(storage, expectedPath), MAX_SCHEDULE_REVIEW_PAYLOAD_BYTES);
    if (bytes.byteLength !== metadata.payloadBytes) {
        throw new Error('Schedule review payload size does not match its metadata.');
    }
    const payload = JSON.parse(new TextDecoder().decode(bytes)) as ScheduleReviewPayload;
    if (
        payload.schemaVersion !== SCHEDULE_REVIEW_SCHEMA_VERSION
        || payload.reviewId !== metadata.id
        || payload.teamId !== metadata.teamId
        || payload.createdBy !== metadata.createdBy
        || payload.routeNumber !== metadata.routeNumber
        || payload.dayType !== metadata.dayType
        || payload.draftId !== metadata.draftId
        || payload.sourceVersion !== metadata.sourceVersion
        || !reviewSummariesEqual(payload.summary, metadata.summary)
        || payload.schedule.metadata?.routeNumber !== metadata.routeNumber
        || payload.schedule.metadata?.dayType !== metadata.dayType
    ) {
        throw new Error('Schedule review payload does not match its metadata.');
    }
    return payload;
};

export const updateScheduleReviewStatus = async (
    input: UpdateScheduleReviewStatusInput,
): Promise<void> => {
    const teamId = assertDocumentId(input.teamId, 'Team ID');
    const reviewId = assertDocumentId(input.reviewId, 'Review ID');
    const reviewerId = assertDocumentId(input.reviewerId, 'Reviewer ID');
    if (!REVIEW_STATUSES.has(input.status)) {
        throw new Error('Review status is invalid.');
    }

    await updateDoc(doc(db, 'teams', teamId, REVIEWS_COLLECTION, reviewId), {
        status: input.status,
        reviewedBy: reviewerId,
        reviewedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
    });
};
