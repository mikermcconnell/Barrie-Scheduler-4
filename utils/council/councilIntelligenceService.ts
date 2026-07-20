import {
    collection,
    doc,
    getDoc,
    getDocs,
    orderBy,
    query,
} from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import app, { db } from '../firebase';

export type CouncilEvidenceConfidence = 'high' | 'medium' | 'low' | 'none';

export interface CouncilMeetingListItem {
    id: string;
    title: string;
    date: string;
    status: 'upcoming' | 'agenda' | 'minutes' | 'extraction-gap';
    body?: string;
    sourceUrl?: string;
    summary?: string;
    topics?: string[];
    confidence?: CouncilEvidenceConfidence;
}

export interface CouncilProfileListItem {
    id: string;
    name: string;
    ward?: string;
    role?: string;
    meetingCount?: number;
    voteCount?: number;
    positionCount?: number;
    latestPosition?: string;
    sourceUrl?: string;
    confidence?: CouncilEvidenceConfidence;
}

export interface CouncilRegisterListItem {
    id: string;
    type: 'action' | 'decision' | 'funding' | 'deadline';
    title: string;
    meetingTitle?: string;
    date?: string;
    owner?: string;
    status?: string;
    amount?: string;
    sourceUrl?: string;
    confidence?: CouncilEvidenceConfidence;
}

export interface CouncilIntelligenceWorkspaceData {
    pilot: {
        windowStart: string;
        windowEnd: string;
        lastSyncedAt: string | null;
        sourceLabel?: string;
    };
    sourceHealth?: {
        status: 'idle' | 'healthy' | 'partial' | 'error';
        discoveredMeetings: number;
        processedMeetings: number;
        extractionGaps: number;
        message?: string;
    };
    meetings: CouncilMeetingListItem[];
    councillors: CouncilProfileListItem[];
    registers: CouncilRegisterListItem[];
}

const DEFAULT_SOURCE_LABEL = 'City of Barrie eSCRIBE';

function isLocalDevelopmentHost(): boolean {
    return typeof window !== 'undefined'
        && ['localhost', '127.0.0.1', '::1'].includes(window.location.hostname.toLowerCase());
}

async function getLocalOfficialSourceWorkspace(refresh = false): Promise<CouncilIntelligenceWorkspaceData> {
    const response = await fetch(`/api/council-intelligence${refresh ? '?refresh=1' : ''}`, {
        method: 'GET',
        headers: { accept: 'application/json' },
    });
    if (!response.ok) throw new Error('The local official Council source could not be loaded.');
    return response.json() as Promise<CouncilIntelligenceWorkspaceData>;
}

function asString(value: unknown, fallback = ''): string {
    return typeof value === 'string' ? value : fallback;
}

function asOptionalString(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim() ? value : undefined;
}

function asNumber(value: unknown): number {
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function asConfidence(value: unknown): CouncilEvidenceConfidence {
    return value === 'high' || value === 'medium' || value === 'low' || value === 'none'
        ? value
        : 'none';
}

function asIsoString(value: unknown): string | null {
    if (typeof value === 'string') return value;
    if (value && typeof value === 'object' && 'toDate' in value && typeof value.toDate === 'function') {
        return value.toDate().toISOString();
    }
    return null;
}

function defaultWindow(now = new Date()): CouncilIntelligenceWorkspaceData['pilot'] {
    const start = new Date(now);
    start.setUTCDate(start.getUTCDate() - 90);
    return {
        windowStart: start.toISOString(),
        windowEnd: now.toISOString(),
        lastSyncedAt: null,
        sourceLabel: DEFAULT_SOURCE_LABEL,
    };
}

function mapMeeting(id: string, data: Record<string, unknown>): CouncilMeetingListItem {
    const rawStatus = data.status;
    const status: CouncilMeetingListItem['status'] = rawStatus === 'upcoming'
        || rawStatus === 'agenda'
        || rawStatus === 'minutes'
        || rawStatus === 'extraction-gap'
        ? rawStatus
        : 'extraction-gap';
    return {
        id,
        title: asString(data.title, 'Untitled meeting'),
        date: asString(data.date),
        status,
        body: asOptionalString(data.body),
        sourceUrl: asOptionalString(data.sourceUrl),
        summary: asOptionalString(data.summary),
        topics: Array.isArray(data.topics) ? data.topics.filter((item): item is string => typeof item === 'string') : [],
        confidence: asConfidence(data.confidence),
    };
}

function mapCouncillor(id: string, data: Record<string, unknown>): CouncilProfileListItem {
    return {
        id,
        name: asString(data.name, 'Unknown councillor'),
        ward: asOptionalString(data.ward),
        role: asOptionalString(data.role),
        meetingCount: asNumber(data.meetingCount),
        voteCount: asNumber(data.voteCount),
        positionCount: asNumber(data.positionCount),
        latestPosition: asOptionalString(data.latestPosition),
        sourceUrl: asOptionalString(data.sourceUrl),
        confidence: asConfidence(data.confidence),
    };
}

function mapRegister(id: string, data: Record<string, unknown>): CouncilRegisterListItem {
    const rawType = data.type;
    const type: CouncilRegisterListItem['type'] = rawType === 'decision'
        || rawType === 'funding'
        || rawType === 'deadline'
        ? rawType
        : 'action';
    return {
        id,
        type,
        title: asString(data.title, 'Untitled register item'),
        meetingTitle: asOptionalString(data.meetingTitle),
        date: asOptionalString(data.date),
        owner: asOptionalString(data.owner),
        status: asOptionalString(data.status),
        amount: asOptionalString(data.amount),
        sourceUrl: asOptionalString(data.sourceUrl),
        confidence: asConfidence(data.confidence),
    };
}

export async function getCouncilIntelligenceWorkspace(teamId: string): Promise<CouncilIntelligenceWorkspaceData> {
    if (!teamId.trim()) throw new Error('A team is required to load Council Intelligence.');
    if (isLocalDevelopmentHost()) return getLocalOfficialSourceWorkspace();

    const rootRef = doc(db, 'teams', teamId, 'councilIntelligence', 'default');
    const [rootSnapshot, meetingsSnapshot, councillorsSnapshot, registersSnapshot] = await Promise.all([
        getDoc(rootRef),
        getDocs(query(collection(rootRef, 'meetings'), orderBy('date', 'desc'))),
        getDocs(query(collection(rootRef, 'councillors'), orderBy('name', 'asc'))),
        getDocs(query(collection(rootRef, 'registers'), orderBy('date', 'desc'))),
    ]);

    const root = rootSnapshot.exists() ? rootSnapshot.data() : {};
    const fallback = defaultWindow();
    const rawHealth = root.sourceHealth && typeof root.sourceHealth === 'object'
        ? root.sourceHealth as Record<string, unknown>
        : {};
    const rawHealthStatus = rawHealth.status;
    const healthStatus: NonNullable<CouncilIntelligenceWorkspaceData['sourceHealth']>['status'] = rawHealthStatus === 'healthy'
        || rawHealthStatus === 'partial'
        || rawHealthStatus === 'error'
        ? rawHealthStatus
        : 'idle';

    return {
        pilot: {
            windowStart: asString(root.windowStart, fallback.windowStart),
            windowEnd: asString(root.windowEnd, fallback.windowEnd),
            lastSyncedAt: asIsoString(root.lastSyncedAt),
            sourceLabel: asString(root.sourceLabel, DEFAULT_SOURCE_LABEL),
        },
        sourceHealth: {
            status: healthStatus,
            discoveredMeetings: asNumber(rawHealth.discoveredMeetings),
            processedMeetings: asNumber(rawHealth.processedMeetings),
            extractionGaps: asNumber(rawHealth.extractionGaps),
            message: asOptionalString(rawHealth.message),
        },
        meetings: meetingsSnapshot.docs.map((entry) => mapMeeting(entry.id, entry.data())),
        councillors: councillorsSnapshot.docs.map((entry) => mapCouncillor(entry.id, entry.data())),
        registers: registersSnapshot.docs.map((entry) => mapRegister(entry.id, entry.data())),
    };
}

export async function refreshCouncilIntelligence(
    teamId: string,
    userId: string | null,
): Promise<CouncilIntelligenceWorkspaceData> {
    if (!teamId.trim()) throw new Error('A team is required to refresh Council Intelligence.');
    if (!userId) throw new Error('Sign in to refresh Council Intelligence.');

    if (isLocalDevelopmentHost()) return getLocalOfficialSourceWorkspace(true);

    const refresh = httpsCallable<{ teamId: string }, { refreshed: boolean }>(
        getFunctions(app),
        'refreshCouncilIntelligence',
    );
    await refresh({ teamId });
    return getCouncilIntelligenceWorkspace(teamId);
}
