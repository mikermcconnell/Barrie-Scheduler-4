import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
    assertFails,
    assertSucceeds,
    initializeTestEnvironment,
    type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
    deleteDoc,
    doc,
    getDoc,
    serverTimestamp,
    setDoc,
    writeBatch,
    type WriteBatch,
} from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;
const describeWithEmulator = emulatorHost ? describe : describe.skip;

describeWithEmulator('Route Concept Planner Firestore rules', () => {
    let testEnvironment: RulesTestEnvironment;

    beforeAll(async () => {
        const [host = '127.0.0.1', portText = '8085'] = emulatorHost!.split(':');
        testEnvironment = await initializeTestEnvironment({
            projectId: 'demo-scheduler-4',
            firestore: {
                host,
                port: Number(portText),
                rules: readFileSync(resolve(process.cwd(), 'firestore.rules'), 'utf8'),
            },
        });
    });

    afterAll(async () => {
        await testEnvironment.cleanup();
    });

    beforeEach(async () => {
        await testEnvironment.clearFirestore();
        await testEnvironment.withSecurityRulesDisabled(async (context) => {
            const db = context.firestore();
            await Promise.all([
                setDoc(doc(db, 'teams/team-a/members/internal-user'), { role: 'member', accessLevel: 'internal' }),
                setDoc(doc(db, 'teams/team-a/members/planner-user'), { role: 'member', accessLevel: 'planner' }),
                setDoc(doc(db, 'teams/team-a/members/pilot-user'), {
                    role: 'member',
                    accessLevel: 'planner',
                    workspaceOverrides: { analyticsRouteConceptPlanner: true },
                }),
                setDoc(doc(db, 'teams/team-b/members/other-user'), { role: 'member', accessLevel: 'internal' }),
            ]);
        });
    });

    async function createProject(userId: string, teamId = 'team-a', projectId = 'project-1'): Promise<void> {
        const db = testEnvironment.authenticatedContext(userId).firestore();
        const batch = writeBatch(db);
        batch.set(doc(db, `teams/${teamId}/routeConceptPlannerProjects/${projectId}`), {
            id: projectId,
            teamId,
            schemaVersion: 1,
            revision: 1,
            name: 'Network option study',
            status: 'local-saved',
            selectedAlternativeId: 'alternative-1',
            alternativeOrder: ['alternative-1'],
            alternativeCount: 1,
            createdAt: serverTimestamp(),
            createdBy: userId,
            updatedAt: serverTimestamp(),
            updatedBy: userId,
        });
        batch.set(doc(db, `teams/${teamId}/routeConceptPlannerProjects/${projectId}/alternatives/alternative-1`), {
            id: 'alternative-1',
            teamId,
            projectId,
            schemaVersion: 1,
            payload: {
                id: 'alternative-1',
                name: 'Option 1',
                status: 'draft',
                structure: 'bidirectional',
                patternOrder: ['pattern-1'],
                service: {
                    firstDepartureMinutes: 360,
                    lastDepartureMinutes: 1320,
                    frequencyMinutes: 30,
                    startTerminalLayoverMinutes: 5,
                    endTerminalLayoverMinutes: 5,
                    intermediateStopDwellSeconds: 20,
                    dayType: 'weekday',
                    planningPeriod: 'all-day',
                },
                notes: '',
                createdAt: '2026-07-16T12:00:00.000Z',
                updatedAt: '2026-07-16T12:00:00.000Z',
            },
            updatedAt: serverTimestamp(),
            updatedBy: userId,
        });
        batch.set(doc(db, `teams/${teamId}/routeConceptPlannerProjects/${projectId}/alternatives/alternative-1/patterns/pattern-1`), {
            id: 'pattern-1',
            teamId,
            projectId,
            alternativeId: 'alternative-1',
            schemaVersion: 1,
            payload: {
                id: 'pattern-1',
                name: 'Outbound',
                role: 'outbound',
                alignment: [],
                stops: [],
                runtimeEvidence: [],
                runtimeOverrides: {},
                notes: '',
                createdAt: '2026-07-16T12:00:00.000Z',
                updatedAt: '2026-07-16T12:00:00.000Z',
            },
            updatedAt: serverTimestamp(),
            updatedBy: userId,
        });
        await batch.commit();
    }

    type TestFirestore = ReturnType<ReturnType<RulesTestEnvironment['authenticatedContext']>['firestore']>;

    async function writeRevisionTwoRoot(db: TestFirestore, batch: WriteBatch) {
        const rootRef = doc(db, 'teams/team-a/routeConceptPlannerProjects/project-1');
        const root = await getDoc(rootRef);
        const data = root.data()!;
        batch.set(rootRef, {
            ...data,
            revision: 2,
            updatedAt: serverTimestamp(),
            updatedBy: 'internal-user',
        });
    }

    it('allows an internal team member to atomically create and read a project', async () => {
        await assertSucceeds(createProject('internal-user'));
        const db = testEnvironment.authenticatedContext('internal-user').firestore();
        const snapshot = await assertSucceeds(getDoc(doc(db, 'teams/team-a/routeConceptPlannerProjects/project-1')));
        expect(snapshot.data()?.revision).toBe(1);
    });

    it('allows an explicit planner pilot override but denies the normal planner profile', async () => {
        await assertSucceeds(createProject('pilot-user', 'team-a', 'pilot-project'));
        await assertFails(createProject('planner-user', 'team-a', 'planner-project'));
    });

    it('denies signed-out and cross-team access', async () => {
        await assertSucceeds(createProject('internal-user'));
        const signedOut = testEnvironment.unauthenticatedContext().firestore();
        const otherTeam = testEnvironment.authenticatedContext('other-user').firestore();
        const projectRef = doc(signedOut, 'teams/team-a/routeConceptPlannerProjects/project-1');
        await assertFails(getDoc(projectRef));
        await assertFails(getDoc(doc(otherTeam, 'teams/team-a/routeConceptPlannerProjects/project-1')));
    });

    it('rejects malformed revisions and spoofed updater identities', async () => {
        const db = testEnvironment.authenticatedContext('internal-user').firestore();
        await assertFails(setDoc(doc(db, 'teams/team-a/routeConceptPlannerProjects/bad-project'), {
            id: 'bad-project',
            teamId: 'team-a',
            schemaVersion: 1,
            revision: 4,
            name: 'Bad project',
            status: 'local-saved',
            selectedAlternativeId: 'alternative-1',
            alternativeOrder: ['alternative-1'],
            alternativeCount: 1,
            createdAt: serverTimestamp(),
            createdBy: 'other-user',
            updatedAt: serverTimestamp(),
            updatedBy: 'other-user',
        }));
    });

    it('denies direct root deletion', async () => {
        await assertSucceeds(createProject('internal-user'));
        const db = testEnvironment.authenticatedContext('internal-user').firestore();

        await assertFails(deleteDoc(doc(db, 'teams/team-a/routeConceptPlannerProjects/project-1')));
    });

    it('rejects alternative and pattern IDs omitted from their parent order', async () => {
        await assertSucceeds(createProject('internal-user'));
        const db = testEnvironment.authenticatedContext('internal-user').firestore();

        const alternativeBatch = writeBatch(db);
        await writeRevisionTwoRoot(db, alternativeBatch);
        alternativeBatch.set(doc(db, 'teams/team-a/routeConceptPlannerProjects/project-1/alternatives/orphan-alternative'), {
            id: 'orphan-alternative',
            teamId: 'team-a',
            projectId: 'project-1',
            schemaVersion: 1,
            payload: {
                id: 'orphan-alternative', name: 'Orphan', status: 'draft', structure: 'loop', patternOrder: [],
                service: {}, notes: '', createdAt: '2026-07-16T12:00:00.000Z', updatedAt: '2026-07-16T12:00:00.000Z',
            },
            updatedAt: serverTimestamp(),
            updatedBy: 'internal-user',
        });
        await assertFails(alternativeBatch.commit());

        const patternBatch = writeBatch(db);
        await writeRevisionTwoRoot(db, patternBatch);
        patternBatch.set(doc(db, 'teams/team-a/routeConceptPlannerProjects/project-1/alternatives/alternative-1/patterns/orphan-pattern'), {
            id: 'orphan-pattern',
            teamId: 'team-a',
            projectId: 'project-1',
            alternativeId: 'alternative-1',
            schemaVersion: 1,
            payload: {
                id: 'orphan-pattern', name: 'Orphan', role: 'loop', alignment: [], stops: [],
                runtimeEvidence: [], runtimeOverrides: {}, notes: '',
                createdAt: '2026-07-16T12:00:00.000Z', updatedAt: '2026-07-16T12:00:00.000Z',
            },
            updatedAt: serverTimestamp(),
            updatedBy: 'internal-user',
        });
        await assertFails(patternBatch.commit());
    });

    it('rejects Camp-specific fields in neutral alternative and pattern payloads', async () => {
        await assertSucceeds(createProject('internal-user'));
        const db = testEnvironment.authenticatedContext('internal-user').firestore();

        const alternativeRef = doc(db, 'teams/team-a/routeConceptPlannerProjects/project-1/alternatives/alternative-1');
        const alternative = (await getDoc(alternativeRef)).data()!;
        const alternativeBatch = writeBatch(db);
        await writeRevisionTwoRoot(db, alternativeBatch);
        alternativeBatch.set(alternativeRef, {
            ...alternative,
            payload: { ...alternative.payload, camperCount: 12 },
            updatedAt: serverTimestamp(),
            updatedBy: 'internal-user',
        });
        await assertFails(alternativeBatch.commit());

        const patternRef = doc(db, 'teams/team-a/routeConceptPlannerProjects/project-1/alternatives/alternative-1/patterns/pattern-1');
        const pattern = (await getDoc(patternRef)).data()!;
        const patternBatch = writeBatch(db);
        await writeRevisionTwoRoot(db, patternBatch);
        patternBatch.set(patternRef, {
            ...pattern,
            payload: { ...pattern.payload, riderManifest: [{ name: 'Private rider' }] },
            updatedAt: serverTimestamp(),
            updatedBy: 'internal-user',
        });
        await assertFails(patternBatch.commit());
    });
});
