import {
    doc,
    getDoc,
    setDoc,
    serverTimestamp,
    Timestamp,
} from 'firebase/firestore';
import { db } from '../firebase';
import type { PublicTimetableFareRow } from './publicTimetableContent';
import {
    PUBLIC_TIMETABLE_CONTACTS,
    PUBLIC_TIMETABLE_DISCLAIMER,
    PUBLIC_TIMETABLE_FARE_EFFECTIVE_DATE,
    PUBLIC_TIMETABLE_FARE_NOTE,
    PUBLIC_TIMETABLE_FARE_ROWS,
    PUBLIC_TIMETABLE_LEGEND_ITEMS,
    PUBLIC_TIMETABLE_PROMO_TEXT,
    PUBLIC_TIMETABLE_PROMO_TITLE,
} from './publicTimetableContent';

export interface PublicTimetableConfigDocument {
    disclaimer: string;
    fareEffectiveDate: string;
    fareRows: PublicTimetableFareRow[];
    fareNote: string;
    legendItems: string[];
    promoTitle: string;
    promoText: string;
    contacts: string[];
    updatedAt: string;
    updatedBy: string;
    version: number;
}

interface FirestoreLikeError {
    code?: string;
}

function getConfigRef(teamId: string) {
    return doc(db, 'teams', teamId, 'publicTimetable', 'default');
}

function timestampToISO(timestamp: Timestamp | string | undefined): string {
    if (!timestamp) return new Date().toISOString();
    if (typeof timestamp === 'string') return timestamp;
    return timestamp.toDate().toISOString();
}

function sanitizeStringArray(values: unknown, fallback: string[]): string[] {
    if (!Array.isArray(values)) return [...fallback];
    const cleaned = values
        .map(value => typeof value === 'string' ? value.trim() : '')
        .filter(Boolean);
    return cleaned.length > 0 ? cleaned : [...fallback];
}

function sanitizeFareRows(rows: unknown): PublicTimetableFareRow[] {
    if (!Array.isArray(rows)) return buildDefaultPublicTimetableConfig().fareRows;

    const cleaned = rows
        .map((row) => {
            if (!row || typeof row !== 'object') return null;
            const source = row as Record<string, unknown>;
            return {
                label: typeof source.label === 'string' ? source.label.trim() : '',
                adult: typeof source.adult === 'string' ? source.adult.trim() : '',
                student: typeof source.student === 'string' ? source.student.trim() : '',
                children: typeof source.children === 'string' ? source.children.trim() : '',
                senior: typeof source.senior === 'string' ? source.senior.trim() : '',
                family: typeof source.family === 'string' ? source.family.trim() : '',
            };
        })
        .filter((row): row is PublicTimetableFareRow => !!row && !!row.label);

    return cleaned.length > 0 ? cleaned : buildDefaultPublicTimetableConfig().fareRows;
}

export function buildDefaultPublicTimetableConfig(): PublicTimetableConfigDocument {
    return {
        disclaimer: PUBLIC_TIMETABLE_DISCLAIMER,
        fareEffectiveDate: PUBLIC_TIMETABLE_FARE_EFFECTIVE_DATE,
        fareRows: PUBLIC_TIMETABLE_FARE_ROWS.map(row => ({ ...row })),
        fareNote: PUBLIC_TIMETABLE_FARE_NOTE,
        legendItems: [...PUBLIC_TIMETABLE_LEGEND_ITEMS],
        promoTitle: PUBLIC_TIMETABLE_PROMO_TITLE,
        promoText: PUBLIC_TIMETABLE_PROMO_TEXT,
        contacts: [...PUBLIC_TIMETABLE_CONTACTS],
        updatedAt: new Date().toISOString(),
        updatedBy: 'system',
        version: 0,
    };
}

export function getPublicTimetableConfigErrorMessage(
    error: unknown,
    action: 'load' | 'save'
): string {
    const firestoreError = error as FirestoreLikeError | undefined;
    const code = firestoreError?.code ?? '';

    if (code.includes('permission-denied')) {
        return action === 'save'
            ? 'You do not have permission to save brochure settings. Ask a team owner or admin to make this change.'
            : 'Unable to load saved brochure settings because your account does not have access. Showing built-in defaults instead.';
    }

    if (code.includes('unauthenticated')) {
        return action === 'save'
            ? 'You need to sign in again before saving brochure settings.'
            : 'You need to sign in again before loading brochure settings.';
    }

    if (code.includes('unavailable')) {
        return action === 'save'
            ? 'Brochure settings could not be saved because the database is temporarily unavailable. Please try again.'
            : 'Brochure settings could not be loaded because the database is temporarily unavailable. Showing built-in defaults instead.';
    }

    return action === 'save'
        ? 'Failed to save brochure settings. Please try again.'
        : 'Failed to load brochure settings. Showing built-in defaults instead.';
}

export async function getPublicTimetableConfig(teamId: string): Promise<PublicTimetableConfigDocument | null> {
    try {
        const docRef = getConfigRef(teamId);
        const docSnap = await getDoc(docRef);

        if (!docSnap.exists()) {
            return null;
        }

        const data = docSnap.data();
        const defaults = buildDefaultPublicTimetableConfig();
        return {
            disclaimer: typeof data.disclaimer === 'string' ? data.disclaimer : defaults.disclaimer,
            fareEffectiveDate: typeof data.fareEffectiveDate === 'string' ? data.fareEffectiveDate : defaults.fareEffectiveDate,
            fareRows: sanitizeFareRows(data.fareRows),
            fareNote: typeof data.fareNote === 'string' ? data.fareNote : defaults.fareNote,
            legendItems: sanitizeStringArray(data.legendItems, defaults.legendItems),
            promoTitle: typeof data.promoTitle === 'string' ? data.promoTitle : defaults.promoTitle,
            promoText: typeof data.promoText === 'string' ? data.promoText : defaults.promoText,
            contacts: sanitizeStringArray(data.contacts, defaults.contacts),
            updatedAt: timestampToISO(data.updatedAt),
            updatedBy: data.updatedBy || '',
            version: data.version || 1,
        };
    } catch (error) {
        console.error('Error getting public timetable config:', error);
        throw error;
    }
}

export async function getEffectivePublicTimetableConfig(teamId: string): Promise<PublicTimetableConfigDocument> {
    const firestoreConfig = await getPublicTimetableConfig(teamId);
    return firestoreConfig ?? buildDefaultPublicTimetableConfig();
}

export async function savePublicTimetableConfig(
    teamId: string,
    config: Pick<PublicTimetableConfigDocument, 'disclaimer' | 'fareEffectiveDate' | 'fareRows' | 'fareNote' | 'legendItems' | 'promoTitle' | 'promoText' | 'contacts'>,
    userId: string
): Promise<void> {
    try {
        const existing = await getPublicTimetableConfig(teamId);
        const nextVersion = (existing?.version || 0) + 1;
        await setDoc(getConfigRef(teamId), {
            disclaimer: config.disclaimer,
            fareEffectiveDate: config.fareEffectiveDate,
            fareRows: config.fareRows,
            fareNote: config.fareNote,
            legendItems: config.legendItems,
            promoTitle: config.promoTitle,
            promoText: config.promoText,
            contacts: config.contacts,
            updatedAt: serverTimestamp(),
            updatedBy: userId,
            version: nextVersion,
        });
    } catch (error) {
        console.error('Error saving public timetable config:', error);
        throw error;
    }
}
