import {
    collection,
    doc,
    getDoc,
    getDocs,
    orderBy,
    query,
    runTransaction,
    Timestamp,
    writeBatch,
    type DocumentData,
} from 'firebase/firestore';
import { db } from '../firebase';
import { createDetourNotice } from './detourFactory';
import type {
    DetourNotice,
    DetourNoticeSummary,
    DetourPublication,
    DetourRouteOverlay,
} from './detourTypes';

const COLLECTION = 'detourNotices';
const OVERLAYS = 'overlays';
const PUBLICATIONS = 'publications';

export class DetourRevisionConflictError extends Error {
    constructor(public readonly expectedRevision: number, public readonly actualRevision: number | null) {
        super('This detour notice was changed by another user. Reload it before saving.');
        this.name = 'DetourRevisionConflictError';
    }
}

export interface SaveDetourNoticeInput {
    notice: DetourNotice;
    userId: string;
    expectedRevision: number;
}

export interface MarkDetourPostedInput {
    teamId: string;
    noticeId: string;
    userId: string;
    expectedRevision: number;
    myRideUrl: string;
    filenames: DetourPublication['filenames'];
    now?: Date;
}

/** Injectable boundary used by unit tests and future server-side persistence. */
export interface DetourNoticePersistenceAdapter {
    createId(teamId: string): string;
    save(input: SaveDetourNoticeInput): Promise<DetourNotice>;
    load(teamId: string, noticeId: string): Promise<DetourNotice | null>;
    list(teamId: string): Promise<DetourNoticeSummary[]>;
    delete(teamId: string, noticeId: string): Promise<void>;
    markPosted(input: MarkDetourPostedInput): Promise<DetourNotice>;
}

const assertId = (value: string, label: string): string => {
    const trimmed = value.trim();
    if (!trimmed || trimmed.length > 128 || trimmed.includes('/')) throw new Error(`${label} is invalid.`);
    return trimmed;
};

const validatePublicationInput = (input: MarkDetourPostedInput): string => {
    const myRideUrl = input.myRideUrl.trim();
    let parsedUrl: URL;
    try {
        parsedUrl = new URL(myRideUrl);
    } catch {
        throw new Error('MyRide URL is invalid.');
    }
    if (
        parsedUrl.protocol !== 'https:'
        || !['myridebarrie.ca', 'www.myridebarrie.ca'].includes(parsedUrl.hostname.toLowerCase())
        || myRideUrl.length > 2000
    ) throw new Error('MyRide URL is invalid.');
    if (!input.filenames.pdf.trim() || !input.filenames.png.trim()) throw new Error('Export filenames are required.');
    return myRideUrl;
};

const asDate = (value: unknown): Date => {
    if (value instanceof Date) return value;
    if (value instanceof Timestamp) return value.toDate();
    if (value && typeof value === 'object' && 'toDate' in value && typeof value.toDate === 'function') return value.toDate();
    return new Date(0);
};

const stripUndefined = <T>(value: T): T => {
    if (Array.isArray(value)) return value.map(stripUndefined).filter(item => item !== undefined) as T;
    if (value && typeof value === 'object' && !(value instanceof Date) && !(value instanceof Timestamp)) {
        return Object.fromEntries(Object.entries(value as Record<string, unknown>)
            .filter(([, item]) => item !== undefined)
            .map(([key, item]) => [key, stripUndefined(item)])) as T;
    }
    return value;
};

const parseOverlay = (id: string, data: DocumentData): DetourRouteOverlay => ({
    ...(data as Omit<DetourRouteOverlay, 'id' | 'createdAt' | 'updatedAt'>),
    id,
    createdAt: asDate(data.createdAt),
    updatedAt: asDate(data.updatedAt),
});

const parsePublication = (id: string, data: DocumentData): DetourPublication => ({
    ...(data as Omit<DetourPublication, 'id' | 'exportedAt' | 'postedAt'>),
    id,
    exportedAt: asDate(data.exportedAt),
    postedAt: asDate(data.postedAt),
});

const parseNoticeBase = (id: string, data: DocumentData): Omit<DetourNotice, 'overlays' | 'publications'> => {
    const { overlayCount: _overlayCount, latestPostedRevision: _latestPostedRevision, ...noticeData } = data;
    return {
        ...(noticeData as Omit<DetourNotice, 'id' | 'overlays' | 'publications' | 'createdAt' | 'updatedAt'>),
        id,
        createdAt: asDate(data.createdAt),
        updatedAt: asDate(data.updatedAt),
    };
};

const parentData = (notice: DetourNotice, latestPostedRevision: number | null): DocumentData => {
    const { id: _id, overlays, publications: _publications, ...base } = notice;
    return stripUndefined({ ...base, overlayCount: overlays.length, latestPostedRevision });
};

class FirebaseDetourNoticeAdapter implements DetourNoticePersistenceAdapter {
    createId(teamId: string): string {
        return doc(collection(db, 'teams', assertId(teamId, 'Team ID'), COLLECTION)).id;
    }

    async save(input: SaveDetourNoticeInput): Promise<DetourNotice> {
        const teamId = assertId(input.notice.teamId, 'Team ID');
        const noticeId = assertId(input.notice.id, 'Notice ID');
        const userId = assertId(input.userId, 'User ID');
        if (!Number.isInteger(input.expectedRevision) || input.expectedRevision < 0) throw new Error('Expected revision is invalid.');
        const parentRef = doc(db, 'teams', teamId, COLLECTION, noticeId);
        const existingOverlaySnapshot = await getDocs(collection(parentRef, OVERLAYS));
        const nextIds = new Set(input.notice.overlays.map(overlay => assertId(overlay.id, 'Overlay ID')));
        const now = new Date();
        const saved: DetourNotice = {
            ...input.notice,
            revision: input.expectedRevision + 1,
            updatedAt: now,
            updatedBy: userId,
            createdAt: input.expectedRevision === 0 ? now : input.notice.createdAt,
            createdBy: input.expectedRevision === 0 ? userId : input.notice.createdBy,
        };
        const latestPostedRevision = input.notice.publications.reduce<number | null>(
            (latest, publication) => latest === null || publication.revision > latest ? publication.revision : latest,
            null,
        );

        await runTransaction(db, async transaction => {
            const snapshot = await transaction.get(parentRef);
            const actual = snapshot.exists() ? Number(snapshot.data().revision) : null;
            const expectedActual = input.expectedRevision === 0 ? null : input.expectedRevision;
            if (actual !== expectedActual) throw new DetourRevisionConflictError(input.expectedRevision, actual);
            transaction.set(parentRef, parentData(saved, latestPostedRevision));
            saved.overlays.forEach(overlay => {
                const overlayRef = doc(parentRef, OVERLAYS, overlay.id);
                transaction.set(overlayRef, stripUndefined({ ...overlay, updatedAt: now }), { merge: false });
            });
            existingOverlaySnapshot.docs.forEach(overlay => {
                if (!nextIds.has(overlay.id)) transaction.delete(overlay.ref);
            });
        });
        return saved;
    }

    async load(teamIdInput: string, noticeIdInput: string): Promise<DetourNotice | null> {
        const teamId = assertId(teamIdInput, 'Team ID');
        const noticeId = assertId(noticeIdInput, 'Notice ID');
        const parentRef = doc(db, 'teams', teamId, COLLECTION, noticeId);
        const [noticeSnapshot, overlaysSnapshot, publicationsSnapshot] = await Promise.all([
            getDoc(parentRef),
            getDocs(collection(parentRef, OVERLAYS)),
            getDocs(query(collection(parentRef, PUBLICATIONS), orderBy('postedAt', 'desc'))),
        ]);
        if (!noticeSnapshot.exists()) return null;
        return {
            ...parseNoticeBase(noticeSnapshot.id, noticeSnapshot.data()),
            overlays: overlaysSnapshot.docs.map(item => parseOverlay(item.id, item.data())),
            publications: publicationsSnapshot.docs.map(item => parsePublication(item.id, item.data())),
        };
    }

    async list(teamIdInput: string): Promise<DetourNoticeSummary[]> {
        const teamId = assertId(teamIdInput, 'Team ID');
        const snapshot = await getDocs(query(collection(db, 'teams', teamId, COLLECTION), orderBy('updatedAt', 'desc')));
        return snapshot.docs.map(item => {
            const data = item.data();
            return {
                ...parseNoticeBase(item.id, data),
                overlayCount: Number(data.overlayCount ?? 0),
                latestPostedRevision: typeof data.latestPostedRevision === 'number' ? data.latestPostedRevision : null,
            };
        });
    }

    async delete(teamIdInput: string, noticeIdInput: string): Promise<void> {
        const teamId = assertId(teamIdInput, 'Team ID');
        const noticeId = assertId(noticeIdInput, 'Notice ID');
        const parentRef = doc(db, 'teams', teamId, COLLECTION, noticeId);
        const [overlays, publications] = await Promise.all([
            getDocs(collection(parentRef, OVERLAYS)),
            getDocs(collection(parentRef, PUBLICATIONS)),
        ]);
        const batch = writeBatch(db);
        overlays.docs.forEach(item => batch.delete(item.ref));
        publications.docs.forEach(item => batch.delete(item.ref));
        batch.delete(parentRef);
        await batch.commit();
    }

    async markPosted(input: MarkDetourPostedInput): Promise<DetourNotice> {
        const teamId = assertId(input.teamId, 'Team ID');
        const noticeId = assertId(input.noticeId, 'Notice ID');
        const userId = assertId(input.userId, 'User ID');
        const myRideUrl = validatePublicationInput(input);
        const parentRef = doc(db, 'teams', teamId, COLLECTION, noticeId);
        const publicationRef = doc(collection(parentRef, PUBLICATIONS));
        const now = input.now ?? new Date();
        await runTransaction(db, async transaction => {
            const snapshot = await transaction.get(parentRef);
            const actual = snapshot.exists() ? Number(snapshot.data().revision) : null;
            if (actual !== input.expectedRevision) throw new DetourRevisionConflictError(input.expectedRevision, actual);
            transaction.update(parentRef, {
                status: 'posted',
                latestPostedRevision: actual,
                updatedAt: now,
                updatedBy: userId,
            });
            transaction.set(publicationRef, stripUndefined({
                noticeId,
                revision: actual,
                exportedAt: now,
                exportedBy: userId,
                postedAt: now,
                postedBy: userId,
                myRideUrl,
                filenames: input.filenames,
            }));
        });
        const loaded = await this.load(teamId, noticeId);
        if (!loaded) throw new Error('Posted notice could not be reloaded.');
        return loaded;
    }
}

export const firebaseDetourNoticeAdapter: DetourNoticePersistenceAdapter = new FirebaseDetourNoticeAdapter();

export const saveDetourNotice = async (
    input: SaveDetourNoticeInput,
    adapter: DetourNoticePersistenceAdapter = firebaseDetourNoticeAdapter,
): Promise<DetourNotice> => {
    const notice = input.notice.id ? input.notice : { ...input.notice, id: adapter.createId(input.notice.teamId) };
    return adapter.save({ ...input, notice });
};

export const loadDetourNotice = (
    teamId: string,
    noticeId: string,
    adapter: DetourNoticePersistenceAdapter = firebaseDetourNoticeAdapter,
): Promise<DetourNotice | null> => adapter.load(teamId, noticeId);

export const listDetourNotices = (
    teamId: string,
    adapter: DetourNoticePersistenceAdapter = firebaseDetourNoticeAdapter,
): Promise<DetourNoticeSummary[]> => adapter.list(teamId);

export const deleteDetourNotice = (
    teamId: string,
    noticeId: string,
    adapter: DetourNoticePersistenceAdapter = firebaseDetourNoticeAdapter,
): Promise<void> => adapter.delete(teamId, noticeId);

export const duplicateDetourNotice = async (
    teamId: string,
    noticeId: string,
    userId: string,
    adapter: DetourNoticePersistenceAdapter = firebaseDetourNoticeAdapter,
): Promise<DetourNotice> => {
    const source = await adapter.load(teamId, noticeId);
    if (!source) throw new Error('Detour notice not found.');
    const duplicate: DetourNotice = {
        ...createDetourNotice({ teamId, userId, type: source.type }),
        ...source,
        id: adapter.createId(teamId),
        title: `${source.title} (Copy)`,
        status: 'draft' as const,
        revision: 0,
        createdBy: userId,
        updatedBy: userId,
        overlays: source.overlays.map(overlay => ({ ...overlay })),
        publications: [],
    };
    return adapter.save({ notice: duplicate, userId, expectedRevision: 0 });
};

export const markDetourPosted = (
    input: MarkDetourPostedInput,
    adapter: DetourNoticePersistenceAdapter = firebaseDetourNoticeAdapter,
): Promise<DetourNotice> => {
    validatePublicationInput(input);
    return adapter.markPosted(input);
};
