import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
    assertFails,
    assertSucceeds,
    initializeTestEnvironment,
    type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { getBytes, ref, uploadString } from 'firebase/storage';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';

const firestoreHost = process.env.FIRESTORE_EMULATOR_HOST;
const storageHost = process.env.FIREBASE_STORAGE_EMULATOR_HOST;
const describeWithEmulators = firestoreHost && storageHost ? describe : describe.skip;

describeWithEmulators('Transit App evidence rules', () => {
    let environment: RulesTestEnvironment;

    beforeAll(async () => {
        const [firestoreHostname = '127.0.0.1', firestorePort = '8085'] = firestoreHost!.split(':');
        const [storageHostname = '127.0.0.1', storagePort = '9199'] = storageHost!.split(':');
        environment = await initializeTestEnvironment({
            projectId: 'demo-scheduler-4',
            firestore: {
                host: firestoreHostname,
                port: Number(firestorePort),
                rules: readFileSync(resolve(process.cwd(), 'firestore.rules'), 'utf8'),
            },
            storage: {
                host: storageHostname,
                port: Number(storagePort),
                rules: readFileSync(resolve(process.cwd(), 'storage.rules'), 'utf8'),
            },
        });
    });

    afterAll(async () => environment.cleanup());

    beforeEach(async () => {
        await Promise.all([environment.clearFirestore(), environment.clearStorage()]);
        await environment.withSecurityRulesDisabled(async context => {
            const db = context.firestore();
            await Promise.all([
                setDoc(doc(db, 'teams/team-a/members/strategic-user'), {
                    role: 'member',
                    accessLevel: 'none',
                    workspaceOverrides: { analyticsStrategicPlan: true },
                }),
                setDoc(doc(db, 'teams/team-a/members/transit-user'), {
                    role: 'member',
                    accessLevel: 'transit-app-only',
                }),
                setDoc(doc(db, 'teams/team-a/members/no-access-user'), {
                    role: 'member',
                    accessLevel: 'none',
                }),
                setDoc(doc(db, 'teams/team-a/members/master-manager'), {
                    role: 'owner',
                    accessLevel: 'none',
                }),
                setDoc(doc(db, 'teams/team-b/members/other-team-user'), {
                    role: 'member',
                    accessLevel: 'internal',
                }),
                setDoc(doc(db, 'teams/team-b/members/shared-strategic-user'), {
                    role: 'member',
                    accessLevel: 'none',
                    workspaceOverrides: { analyticsStrategicPlan: true },
                }),
                setDoc(doc(db, 'teams/team-b'), {
                    dataSourceTeamIds: { masterSchedules: 'team-a' },
                }),
                setDoc(doc(db, 'users/shared-strategic-user'), { teamId: 'team-b' }),
                setDoc(doc(db, 'teams/team-a/transitAppData/default'), {
                    storagePath: 'teams/team-a/transitAppData/1724600000000.json',
                }),
                setDoc(doc(db, 'teams/team-a/masterSchedules/2-Weekday'), {
                    routeNumber: '2',
                    dayType: 'Weekday',
                    storagePath: 'teams/team-a/masterSchedules/2-Weekday_v1_test.json',
                }),
                setDoc(doc(db, 'teams/team-a/fleetPlan/default'), {
                    currentVersion: 3,
                    storagePath: 'teams/team-a/fleetPlan/v3_test.json',
                }),
                setDoc(doc(db, 'teams/team-a/fleetPlan/default/versions/3'), {
                    versionNumber: 3,
                    storagePath: 'teams/team-a/fleetPlan/v3_test.json',
                }),
            ]);
        });

        const transitStorage = environment.authenticatedContext('transit-user').storage();
        await assertSucceeds(uploadString(
            ref(transitStorage, 'teams/team-a/transitAppData/1724600000000.json'),
            JSON.stringify({ metadata: { dateRange: { start: '2026-01-01', end: '2026-07-31' } } }),
            'raw',
            { contentType: 'application/json' },
        ));
        const managerStorage = environment.authenticatedContext('master-manager').storage();
        await assertSucceeds(uploadString(
            ref(managerStorage, 'teams/team-a/masterSchedules/2-Weekday_v1_test.json'),
            JSON.stringify({ northTable: { trips: [] }, southTable: { trips: [] } }),
            'raw',
            { contentType: 'application/json' },
        ));
        await assertSucceeds(uploadString(
            ref(managerStorage, 'teams/team-a/fleetPlan/v3_test.json'),
            JSON.stringify({ schemaVersion: 1, sheets: [] }),
            'raw',
            { contentType: 'application/json' },
        ));
    });

    it('allows Strategic Plan-only reads but denies imports and overwrites', async () => {
        const context = environment.authenticatedContext('strategic-user');
        await assertSucceeds(getDoc(doc(context.firestore(), 'teams/team-a/transitAppData/default')));
        await assertSucceeds(getBytes(ref(context.storage(), 'teams/team-a/transitAppData/1724600000000.json')));
        await assertFails(setDoc(doc(context.firestore(), 'teams/team-a/transitAppData/attempted-write'), {}));
        await assertFails(uploadString(
            ref(context.storage(), 'teams/team-a/transitAppData/attempted-write.json'),
            '{}',
        ));
    });

    it('retains Transit App read and write access for import users', async () => {
        const context = environment.authenticatedContext('transit-user');
        await assertSucceeds(getDoc(doc(context.firestore(), 'teams/team-a/transitAppData/default')));
        await assertSucceeds(setDoc(doc(context.firestore(), 'teams/team-a/transitAppData/import-write'), {
            storagePath: 'teams/team-a/transitAppData/1724600000001.json',
        }));
        await assertSucceeds(uploadString(
            ref(context.storage(), 'teams/team-a/transitAppData/1724600000001.json'),
            '{}',
        ));
    });

    it('allows Strategic Plan-only Master Schedule reads but denies writes', async () => {
        const context = environment.authenticatedContext('strategic-user');
        await assertSucceeds(getDoc(doc(context.firestore(), 'teams/team-a/masterSchedules/2-Weekday')));
        await assertSucceeds(getBytes(ref(context.storage(), 'teams/team-a/masterSchedules/2-Weekday_v1_test.json')));
        await assertFails(setDoc(doc(context.firestore(), 'teams/team-a/masterSchedules/attempted-write'), {}));
        await assertFails(uploadString(
            ref(context.storage(), 'teams/team-a/masterSchedules/attempted-write.json'),
            '{}',
        ));
    });

    it('allows Strategic Plan-only active Fleet Plan reads but denies history and writes', async () => {
        const context = environment.authenticatedContext('strategic-user');
        await assertSucceeds(getDoc(doc(context.firestore(), 'teams/team-a/fleetPlan/default')));
        await assertSucceeds(getBytes(ref(context.storage(), 'teams/team-a/fleetPlan/v3_test.json')));
        await assertFails(getDoc(doc(context.firestore(), 'teams/team-a/fleetPlan/default/versions/3')));
        await assertFails(setDoc(doc(context.firestore(), 'teams/team-a/fleetPlan/default'), {
            currentVersion: 4,
            storagePath: 'teams/team-a/fleetPlan/v4.json',
        }));
        await assertFails(uploadString(
            ref(context.storage(), 'teams/team-a/fleetPlan/attempted-write.json'),
            '{}',
        ));
    });

    it('allows a configured Strategic Plan team to read the source team Master Schedule', async () => {
        const context = environment.authenticatedContext('shared-strategic-user');
        await assertSucceeds(getDoc(doc(context.firestore(), 'teams/team-a/masterSchedules/2-Weekday')));
        await assertSucceeds(getBytes(ref(context.storage(), 'teams/team-a/masterSchedules/2-Weekday_v1_test.json')));
    });

    it('denies users without either workspace permission, including other teams', async () => {
        for (const userId of ['no-access-user', 'other-team-user']) {
            const context = environment.authenticatedContext(userId);
            await assertFails(getDoc(doc(context.firestore(), 'teams/team-a/transitAppData/default')));
            await assertFails(getBytes(ref(context.storage(), 'teams/team-a/transitAppData/1724600000000.json')));
            await assertFails(getDoc(doc(context.firestore(), 'teams/team-a/masterSchedules/2-Weekday')));
            await assertFails(getBytes(ref(context.storage(), 'teams/team-a/masterSchedules/2-Weekday_v1_test.json')));
            await assertFails(getDoc(doc(context.firestore(), 'teams/team-a/fleetPlan/default')));
            await assertFails(getBytes(ref(context.storage(), 'teams/team-a/fleetPlan/v3_test.json')));
        }
    });
});
