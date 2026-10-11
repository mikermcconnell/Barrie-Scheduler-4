import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
    assertFails,
    assertSucceeds,
    initializeTestEnvironment,
    type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, getDoc, serverTimestamp, setDoc, writeBatch } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;
const describeWithEmulator = emulatorHost ? describe : describe.skip;

function workplanData(userId: string, revision: number) {
    return {
        schemaVersion: 1,
        teamId: 'team-a',
        revision,
        name: 'Barrie Transit Strategic Plan - Project Work Plan',
        scheduleStart: '2026-07-06',
        scheduleEnd: '2027-08-30',
        source: {
            title: 'Work Plan and Schedule',
            organization: 'Dillon Consulting Limited',
            proposalDate: '2026-06-16',
            fileName: '06-F.5.WorkPlanandSchedule.pdf',
            schedulePages: 'PDF pages 6-7',
            importedAt: '2026-08-27',
            datePrecision: 'week',
            note: 'Week-precision baseline.',
        },
        tasks: [] as Array<Record<string, unknown>>,
        createdAt: '2026-08-27T13:00:00.000Z',
        createdBy: 'strategic-user',
        updatedAt: '2026-08-27T13:00:00.000Z',
        updatedBy: userId,
    };
}

function auditData(userId: string) {
    return {
        editedByUid: userId,
        editedByName: userId === 'dillon-user' ? 'Dillon Planner' : 'Barrie Planner',
        editedAt: '2026-08-27T13:00:00.000Z',
        summary: 'Changed 1 task across 1 field.',
        changes: [{
            kind: 'updated',
            taskId: 'task-1',
            wbs: '1.01',
            title: 'Project initiation',
            fields: [{ field: 'Status', before: 'Unconfirmed', after: 'In progress' }],
        }],
    };
}

describeWithEmulator('Strategic work-plan Firestore rules', () => {
    let environment: RulesTestEnvironment;

    beforeAll(async () => {
        const [host = '127.0.0.1', portText = '8085'] = emulatorHost!.split(':');
        environment = await initializeTestEnvironment({
            projectId: 'demo-scheduler-4',
            firestore: {
                host,
                port: Number(portText),
                rules: readFileSync(resolve(process.cwd(), 'firestore.rules'), 'utf8'),
            },
        });
    });

    afterAll(async () => environment.cleanup());

    beforeEach(async () => {
        await environment.clearFirestore();
        await environment.withSecurityRulesDisabled(async context => {
            const db = context.firestore();
            await Promise.all([
                setDoc(doc(db, 'teams/team-a/members/strategic-user'), {
                    role: 'member',
                    accessLevel: 'none',
                    workspaceOverrides: { analyticsStrategicPlan: true },
                }),
                setDoc(doc(db, 'teams/team-a/members/no-access-user'), {
                    role: 'member',
                    accessLevel: 'none',
                }),
                setDoc(doc(db, 'teams/team-c/members/other-team-user'), {
                    role: 'member',
                    accessLevel: 'internal',
                }),
                setDoc(doc(db, 'teams/team-b/members/dillon-user'), {
                    role: 'member',
                    accessLevel: 'none',
                    workspaceOverrides: { analyticsStrategicPlan: true },
                }),
                setDoc(doc(db, 'teams/team-b'), {
                    dataSourceTeamIds: { strategicPlanWorkplan: 'team-a' },
                }),
                setDoc(doc(db, 'users/dillon-user'), { teamId: 'team-b' }),
                setDoc(doc(db, 'teams/team-c'), { dataSourceTeamIds: {} }),
                setDoc(doc(db, 'users/other-team-user'), { teamId: 'team-c' }),
            ]);
        });
    });

    async function publishRevision(revision: number, userId = 'strategic-user') {
        const db = environment.authenticatedContext(userId).firestore();
        const root = doc(db, 'teams/team-a/strategicPlanWorkplans/default');
        const version = doc(db, `teams/team-a/strategicPlanWorkplans/default/versions/${revision}`);
        const data = workplanData(userId, revision);
        const batch = writeBatch(db);
        batch.set(root, { ...data, updatedAtServer: serverTimestamp() });
        batch.set(version, { ...data, audit: auditData(userId), savedAtServer: serverTimestamp() });
        return batch.commit();
    }

    it('allows Strategic Plan members to publish and read an atomic first revision', async () => {
        await assertSucceeds(publishRevision(1));
        const db = environment.authenticatedContext('strategic-user').firestore();
        expect((await getDoc(doc(db, 'teams/team-a/strategicPlanWorkplans/default'))).exists()).toBe(true);
        expect((await getDoc(doc(db, 'teams/team-a/strategicPlanWorkplans/default/versions/1'))).exists()).toBe(true);
    });

    it('denies users without same-team Strategic Plan access', async () => {
        await assertSucceeds(publishRevision(1));
        const noAccess = environment.authenticatedContext('no-access-user').firestore();
        const outsider = environment.authenticatedContext('other-team-user').firestore();
        await assertFails(getDoc(doc(noAccess, 'teams/team-a/strategicPlanWorkplans/default')));
        await assertFails(getDoc(doc(outsider, 'teams/team-a/strategicPlanWorkplans/default')));
    });

    it('allows a configured Dillon member to maintain the Barrie-owned work plan', async () => {
        await assertSucceeds(publishRevision(1, 'dillon-user'));
        const dillonDb = environment.authenticatedContext('dillon-user').firestore();
        const barrieDb = environment.authenticatedContext('strategic-user').firestore();
        await assertSucceeds(getDoc(doc(dillonDb, 'teams/team-a/strategicPlanWorkplans/default')));
        await assertSucceeds(getDoc(doc(barrieDb, 'teams/team-a/strategicPlanWorkplans/default')));
        await assertSucceeds(publishRevision(2, 'dillon-user'));
    });

    it('rejects an audit entry attributed to someone other than the caller', async () => {
        const db = environment.authenticatedContext('strategic-user').firestore();
        const data = workplanData('strategic-user', 1);
        const batch = writeBatch(db);
        batch.set(doc(db, 'teams/team-a/strategicPlanWorkplans/default'), { ...data, updatedAtServer: serverTimestamp() });
        batch.set(doc(db, 'teams/team-a/strategicPlanWorkplans/default/versions/1'), {
            ...data,
            audit: auditData('dillon-user'),
            savedAtServer: serverTimestamp(),
        });
        await assertFails(batch.commit());
    });

    it('rejects a version snapshot that does not match the active work plan', async () => {
        const db = environment.authenticatedContext('strategic-user').firestore();
        const data = workplanData('strategic-user', 1);
        const batch = writeBatch(db);
        batch.set(doc(db, 'teams/team-a/strategicPlanWorkplans/default'), { ...data, updatedAtServer: serverTimestamp() });
        batch.set(doc(db, 'teams/team-a/strategicPlanWorkplans/default/versions/1'), {
            ...data,
            name: 'Different snapshot',
            audit: auditData('strategic-user'),
            savedAtServer: serverTimestamp(),
        });
        await assertFails(batch.commit());
    });

    it('requires consecutive revisions and immutable matching version snapshots', async () => {
        await assertSucceeds(publishRevision(1));
        await assertSucceeds(publishRevision(2));

        const db = environment.authenticatedContext('strategic-user').firestore();
        const root = doc(db, 'teams/team-a/strategicPlanWorkplans/default');
        await assertFails(setDoc(root, { ...workplanData('strategic-user', 4), updatedAtServer: serverTimestamp() }));
        await assertFails(setDoc(doc(db, 'teams/team-a/strategicPlanWorkplans/default/versions/2'), { note: 'Changed later' }, { merge: true }));
    });

    it('rejects a root write that omits its immutable version snapshot', async () => {
        const db = environment.authenticatedContext('strategic-user').firestore();
        await assertFails(setDoc(doc(db, 'teams/team-a/strategicPlanWorkplans/default'), {
            ...workplanData('strategic-user', 1),
            updatedAtServer: serverTimestamp(),
        }));
    });
});
