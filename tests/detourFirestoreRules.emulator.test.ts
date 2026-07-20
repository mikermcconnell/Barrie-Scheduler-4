import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
    assertFails,
    assertSucceeds,
    initializeTestEnvironment,
    type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
    doc,
    getDoc,
    serverTimestamp,
    setDoc,
    writeBatch,
} from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;
const describeWithEmulator = emulatorHost ? describe : describe.skip;

describeWithEmulator('Detour Publisher Firestore rules', () => {
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
                setDoc(doc(db, 'teams/team-a/members/planner-a'), { role: 'member', accessLevel: 'planner' }),
                setDoc(doc(db, 'teams/team-b/members/planner-b'), { role: 'member', accessLevel: 'planner' }),
            ]);
        });
    });

    async function createNotice(userId = 'planner-a', teamId = 'team-a', noticeId = 'notice-1') {
        const db = environment.authenticatedContext(userId).firestore();
        const batch = writeBatch(db);
        batch.set(doc(db, `teams/${teamId}/detourNotices/${noticeId}`), {
            teamId,
            revision: 1,
            status: 'draft',
            title: 'Livingstone Detour',
            createdAt: serverTimestamp(),
            createdBy: userId,
            updatedAt: serverTimestamp(),
            updatedBy: userId,
        });
        batch.set(doc(db, `teams/${teamId}/detourNotices/${noticeId}/overlays/overlay-1`), {
            routeShortName: '8B',
            geometry: { coordinates: [] },
        });
        await batch.commit();
    }

    it('allows a Scheduled Transit team member to create and read a notice', async () => {
        await assertSucceeds(createNotice());
        const db = environment.authenticatedContext('planner-a').firestore();
        const snapshot = await assertSucceeds(getDoc(doc(db, 'teams/team-a/detourNotices/notice-1')));
        expect(snapshot.data()?.revision).toBe(1);
    });

    it('denies signed-out and cross-team reads and writes', async () => {
        await assertSucceeds(createNotice());
        const signedOut = environment.unauthenticatedContext().firestore();
        const otherTeam = environment.authenticatedContext('planner-b').firestore();
        await assertFails(getDoc(doc(signedOut, 'teams/team-a/detourNotices/notice-1')));
        await assertFails(getDoc(doc(otherTeam, 'teams/team-a/detourNotices/notice-1')));
        await assertFails(createNotice('planner-b', 'team-a', 'spoofed'));
    });

    it('requires sequential revisions and the authenticated updater', async () => {
        await assertSucceeds(createNotice());
        const db = environment.authenticatedContext('planner-a').firestore();
        const reference = doc(db, 'teams/team-a/detourNotices/notice-1');
        await assertFails(setDoc(reference, {
            teamId: 'team-a', revision: 3, status: 'draft', title: 'Stale overwrite',
            createdAt: serverTimestamp(), createdBy: 'planner-a',
            updatedAt: serverTimestamp(), updatedBy: 'planner-a',
        }));
    });

    it('accepts only immutable publications on the current revision with a secure MyRide URL', async () => {
        await assertSucceeds(createNotice());
        const db = environment.authenticatedContext('planner-a').firestore();
        const parent = doc(db, 'teams/team-a/detourNotices/notice-1');
        const publication = doc(db, 'teams/team-a/detourNotices/notice-1/publications/pub-1');
        const batch = writeBatch(db);
        batch.update(parent, {
            status: 'posted', latestPostedRevision: 1,
            updatedAt: serverTimestamp(), updatedBy: 'planner-a',
        });
        batch.set(publication, {
            noticeId: 'notice-1', revision: 1,
            exportedAt: serverTimestamp(), exportedBy: 'planner-a',
            postedAt: serverTimestamp(), postedBy: 'planner-a',
            myRideUrl: 'https://www.myridebarrie.ca/News/1684/livingstone-detour/',
            filenames: { pdf: 'livingstone-v1.pdf', png: 'livingstone-v1.png' },
        });
        await assertSucceeds(batch.commit());
        await assertFails(setDoc(publication, { myRideUrl: 'https://example.com/changed' }, { merge: true }));
    });
});
