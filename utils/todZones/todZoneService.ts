import {
    collection,
    doc,
    getDoc,
    getDocs,
    runTransaction,
    serverTimestamp,
    Timestamp,
} from 'firebase/firestore';
import { db } from '../firebase';
import { buildTodStopSnapshot, validateTodZoneDraft } from './todZoneGeometry';
import { createTodZoneASeedDraft } from './todZoneSeed';
import type { TodCityStop, TodZoneDraft, TodZoneVersion } from './todZoneTypes';

interface StoredTodZonePosition {
    lon: number;
    lat: number;
}

interface StoredTodZonePolygon {
    id: string;
    zoneCode: string;
    pocketName: string;
    coordinates: StoredTodZonePosition[];
}

function rootRef(teamId: string) {
    return doc(db, 'teams', teamId, 'todZoneConfig', 'default');
}

function versionsRef(teamId: string) {
    return collection(db, 'teams', teamId, 'todZoneConfig', 'default', 'versions');
}

function timestampToISO(value: unknown): string | undefined {
    if (value instanceof Timestamp) return value.toDate().toISOString();
    return typeof value === 'string' && value ? value : undefined;
}

export function deserializeTodZonePolygonsFromFirestore(value: unknown): TodZoneDraft['polygons'] | null {
    if (!Array.isArray(value)) return null;
    const polygons = value.flatMap(item => {
        if (!item || typeof item !== 'object') return [];
        const candidate = item as Record<string, unknown>;
        if (!Array.isArray(candidate.coordinates)) return [];
        const coordinates = candidate.coordinates.flatMap(position => {
            if (Array.isArray(position) && position.length >= 2) {
                const lon = Number(position[0]);
                const lat = Number(position[1]);
                return Number.isFinite(lon) && Number.isFinite(lat) ? [[lon, lat] as [number, number]] : [];
            }
            if (position && typeof position === 'object') {
                const stored = position as Partial<StoredTodZonePosition>;
                const lon = Number(stored.lon);
                const lat = Number(stored.lat);
                return Number.isFinite(lon) && Number.isFinite(lat) ? [[lon, lat] as [number, number]] : [];
            }
            return [];
        });
        return [{
            id: String(candidate.id ?? ''),
            zoneCode: String(candidate.zoneCode ?? ''),
            pocketName: String(candidate.pocketName ?? ''),
            coordinates,
        }];
    });
    return polygons;
}

export function serializeTodZonePolygonsForFirestore(polygons: TodZoneDraft['polygons']): StoredTodZonePolygon[] {
    return polygons.map(polygon => ({
        id: polygon.id,
        zoneCode: polygon.zoneCode,
        pocketName: polygon.pocketName,
        coordinates: polygon.coordinates.map(([lon, lat]) => ({ lon, lat })),
    }));
}

function normalizeDraft(data: Record<string, unknown>): TodZoneDraft {
    const seed = createTodZoneASeedDraft();
    return {
        schemaVersion: 1,
        revision: Number.isInteger(data.revision) ? Number(data.revision) : 0,
        definitions: Array.isArray(data.definitions) ? data.definitions as TodZoneDraft['definitions'] : seed.definitions,
        polygons: deserializeTodZonePolygonsFromFirestore(data.polygons) ?? seed.polygons,
        overrides: Array.isArray(data.overrides) ? data.overrides as TodZoneDraft['overrides'] : [],
        effectiveFrom: typeof data.effectiveFrom === 'string' ? data.effectiveFrom : seed.effectiveFrom,
        source: typeof data.source === 'string' ? data.source : seed.source,
        reviewNote: typeof data.reviewNote === 'string' ? data.reviewNote : seed.reviewNote,
        ...(typeof data.lastPublishedVersionId === 'string' ? { lastPublishedVersionId: data.lastPublishedVersionId } : {}),
        ...(timestampToISO(data.updatedAt) ? { updatedAt: timestampToISO(data.updatedAt) } : {}),
        ...(typeof data.updatedBy === 'string' ? { updatedBy: data.updatedBy } : {}),
    };
}

export async function getTodZoneDraft(teamId: string): Promise<TodZoneDraft> {
    const snapshot = await getDoc(rootRef(teamId));
    return snapshot.exists() ? normalizeDraft(snapshot.data()) : createTodZoneASeedDraft();
}

export async function getTodZoneVersions(teamId: string): Promise<TodZoneVersion[]> {
    const snapshot = await getDocs(versionsRef(teamId));
    return snapshot.docs.map(versionDoc => {
        const data = versionDoc.data();
        const draft = normalizeDraft(data);
        return {
            id: versionDoc.id,
            schemaVersion: 1,
            revision: draft.revision,
            definitions: draft.definitions,
            polygons: draft.polygons,
            overrides: draft.overrides,
            effectiveFrom: draft.effectiveFrom,
            source: draft.source,
            reviewNote: draft.reviewNote,
            stopSnapshot: Array.isArray(data.stopSnapshot) ? data.stopSnapshot : [],
            publishedBy: typeof data.publishedBy === 'string' ? data.publishedBy : '',
            ...(timestampToISO(data.publishedAt) ? { publishedAt: timestampToISO(data.publishedAt) } : {}),
        } as TodZoneVersion;
    });
}

function writableDraft(draft: TodZoneDraft, revision: number, userId: string, includePublishedPointer = true) {
    return {
        schemaVersion: 1,
        revision,
        definitions: draft.definitions,
        polygons: serializeTodZonePolygonsForFirestore(draft.polygons),
        overrides: draft.overrides,
        effectiveFrom: draft.effectiveFrom,
        source: draft.source.trim(),
        reviewNote: draft.reviewNote.trim(),
        ...(includePublishedPointer && draft.lastPublishedVersionId ? { lastPublishedVersionId: draft.lastPublishedVersionId } : {}),
        updatedAt: serverTimestamp(),
        updatedBy: userId,
    };
}

export async function saveTodZoneDraft(
    teamId: string,
    draft: TodZoneDraft,
    userId: string,
    expectedRevision: number,
): Promise<number> {
    validateTodZoneDraft(draft);
    return runTransaction(db, async transaction => {
        const reference = rootRef(teamId);
        const snapshot = await transaction.get(reference);
        const currentRevision = snapshot.exists() ? Number(snapshot.data().revision ?? 0) : 0;
        if (currentRevision !== expectedRevision) {
            const error = new Error('Zone draft changed elsewhere. Reload it and try again.');
            (error as Error & { code?: string }).code = 'aborted';
            throw error;
        }
        const nextRevision = currentRevision + 1;
        transaction.set(reference, writableDraft(draft, nextRevision, userId));
        return nextRevision;
    });
}

export async function publishTodZoneVersion(
    teamId: string,
    draft: TodZoneDraft,
    stops: TodCityStop[],
    userId: string,
    expectedRevision: number,
): Promise<{ versionId: string; revision: number }> {
    validateTodZoneDraft(draft);
    if (draft.polygons.length === 0) throw new Error('Add at least one zone polygon before publishing.');
    if (stops.length === 0) throw new Error('Current City stops must be loaded before publishing.');

    const versionReference = doc(versionsRef(teamId));
    const revision = await runTransaction(db, async transaction => {
        const reference = rootRef(teamId);
        const snapshot = await transaction.get(reference);
        const currentRevision = snapshot.exists() ? Number(snapshot.data().revision ?? 0) : 0;
        if (currentRevision !== expectedRevision) {
            const error = new Error('Zone draft changed elsewhere. Reload it and try again.');
            (error as Error & { code?: string }).code = 'aborted';
            throw error;
        }
        const nextRevision = currentRevision + 1;
        const stopSnapshot = buildTodStopSnapshot(stops, draft.definitions, draft.polygons, draft.overrides);
        transaction.set(versionReference, {
            ...writableDraft(draft, nextRevision, userId, false),
            stopSnapshot,
            publishedAt: serverTimestamp(),
            publishedBy: userId,
        });
        transaction.set(reference, {
            ...writableDraft({ ...draft, lastPublishedVersionId: versionReference.id }, nextRevision, userId),
            lastPublishedVersionId: versionReference.id,
        });
        return nextRevision;
    });
    return { versionId: versionReference.id, revision };
}

export function getTodZoneErrorMessage(error: unknown): string {
    const code = typeof error === 'object' && error && 'code' in error
        ? String((error as { code?: unknown }).code ?? '') : '';
    if (code.includes('permission-denied')) return 'Only team owners and admins can change TOD zones.';
    if (code.includes('aborted')) return 'The zone draft changed elsewhere. Reload it before saving.';
    return error instanceof Error ? error.message : 'TOD zones could not be saved.';
}
