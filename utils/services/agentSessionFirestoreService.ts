import {
    Timestamp,
    collection,
    deleteDoc,
    doc,
    getDocs,
    onSnapshot,
    orderBy,
    query,
    setDoc,
} from 'firebase/firestore';
import { db } from '../firebase';
import {
    AgentSession,
    normalizeAgentSession,
    sortAgentSessions,
} from '../agentSessions';
import { loadAgentSessions } from './agentSessionService';

const AGENT_SESSIONS_COLLECTION = 'agentSessions';

function getAgentSessionsCollection(userId: string) {
    return collection(db, 'users', userId, AGENT_SESSIONS_COLLECTION);
}

function toTimestamp(value: string): Timestamp {
    const date = new Date(value);
    return Timestamp.fromDate(Number.isNaN(date.getTime()) ? new Date() : date);
}

function fromFirestoreTimestamp(value: unknown): string {
    if (value instanceof Timestamp) {
        return value.toDate().toISOString();
    }
    if (value instanceof Date) {
        return value.toISOString();
    }
    return new Date().toISOString();
}

function snapshotToAgentSession(
    id: string,
    value: Record<string, unknown>
): AgentSession | null {
    return normalizeAgentSession({
        id,
        title: value.title,
        purpose: value.purpose,
        currentTask: value.currentTask,
        lastPrompt: value.lastPrompt,
        status: value.status,
        priority: value.priority,
        lastSummary: value.lastSummary,
        nextAction: value.nextAction,
        blockedBy: value.blockedBy,
        chatReference: value.chatReference,
        createdAt: fromFirestoreTimestamp(value.createdAt),
        lastUpdatedAt: fromFirestoreTimestamp(value.updatedAt),
    });
}

export async function getAgentSessionsFromCloud(userId: string): Promise<AgentSession[]> {
    const sessionsQuery = query(getAgentSessionsCollection(userId), orderBy('updatedAt', 'desc'));
    const snapshot = await getDocs(sessionsQuery);

    return sortAgentSessions(
        snapshot.docs
            .map((docSnapshot) => snapshotToAgentSession(docSnapshot.id, docSnapshot.data()))
            .filter((session): session is AgentSession => session !== null)
    );
}

export function subscribeToAgentSessions(
    userId: string,
    onUpdate: (sessions: AgentSession[]) => void,
    onError: (error: Error) => void
): () => void {
    const sessionsQuery = query(getAgentSessionsCollection(userId), orderBy('updatedAt', 'desc'));

    return onSnapshot(
        sessionsQuery,
        (snapshot) => {
            const sessions = sortAgentSessions(
                snapshot.docs
                    .map((docSnapshot) => snapshotToAgentSession(docSnapshot.id, docSnapshot.data()))
                    .filter((session): session is AgentSession => session !== null)
            );
            onUpdate(sessions);
        },
        (error) => {
            onError(error);
        }
    );
}

export async function saveAgentSessionToCloud(
    userId: string,
    session: AgentSession
): Promise<void> {
    const sessionRef = doc(getAgentSessionsCollection(userId), session.id);

    await setDoc(sessionRef, {
        title: session.title,
        purpose: session.purpose,
        currentTask: session.currentTask,
        lastPrompt: session.lastPrompt,
        status: session.status,
        priority: session.priority,
        lastSummary: session.lastSummary,
        nextAction: session.nextAction,
        blockedBy: session.blockedBy,
        chatReference: session.chatReference,
        createdAt: toTimestamp(session.createdAt),
        updatedAt: toTimestamp(session.lastUpdatedAt),
    }, { merge: true });
}

export async function deleteAgentSessionFromCloud(userId: string, sessionId: string): Promise<void> {
    const sessionRef = doc(getAgentSessionsCollection(userId), sessionId);
    await deleteDoc(sessionRef);
}

export async function hydrateLocalAgentSessionsToCloud(userId: string): Promise<number> {
    const localSessions = loadAgentSessions();
    if (localSessions.length === 0) {
        return 0;
    }

    const cloudSessions = await getAgentSessionsFromCloud(userId);
    if (cloudSessions.length > 0) {
        return 0;
    }

    await Promise.all(localSessions.map((session) => saveAgentSessionToCloud(userId, session)));
    return localSessions.length;
}
