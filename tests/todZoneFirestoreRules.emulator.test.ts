import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, serverTimestamp, setDoc, writeBatch } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;
const describeWithEmulator = emulatorHost ? describe : describe.skip;

const polygon = {
    id: 'a-1', zoneCode: 'A', pocketName: 'Zone A',
    coordinates: [
        { lon: -79.7, lat: 44.4 },
        { lon: -79.6, lat: 44.4 },
        { lon: -79.6, lat: 44.5 },
        { lon: -79.7, lat: 44.4 },
    ],
};

function zoneData(userId: string, revision: number, polygons: Array<Record<string, unknown>> = [polygon]) {
    return {
        schemaVersion: 1,
        revision,
        definitions: [{ code: 'A', label: 'Zone A', color: '#7c3aed', kind: 'permanent', active: true }],
        polygons,
        overrides: [] as Array<Record<string, unknown>>,
        effectiveFrom: '2025-09-21',
        source: 'Planner-reviewed Zone A PDF',
        reviewNote: 'Reviewed against current City stops',
        updatedAt: serverTimestamp(),
        updatedBy: userId,
    };
}

describeWithEmulator('TOD zone Firestore rules', () => {
    let environment: RulesTestEnvironment;
    beforeAll(async () => {
        const [host = '127.0.0.1', portText = '8085'] = emulatorHost!.split(':');
        environment = await initializeTestEnvironment({
            projectId: 'demo-scheduler-4',
            firestore: { host, port: Number(portText), rules: readFileSync(resolve(process.cwd(), 'firestore.rules'), 'utf8') },
        });
    });
    afterAll(async () => environment.cleanup());
    beforeEach(async () => {
        await environment.clearFirestore();
        await environment.withSecurityRulesDisabled(async context => {
            const db = context.firestore();
            await Promise.all([
                setDoc(doc(db, 'teams/team-a/members/owner-a'), { role: 'owner' }),
                setDoc(doc(db, 'teams/team-a/members/viewer-a'), { role: 'member' }),
                setDoc(doc(db, 'teams/team-b/members/owner-b'), { role: 'owner' }),
            ]);
        });
    });

    it('keeps mutable drafts manager-only', async () => {
        const owner = environment.authenticatedContext('owner-a').firestore();
        const viewer = environment.authenticatedContext('viewer-a').firestore();
        const outsider = environment.authenticatedContext('owner-b').firestore();
        const reference = doc(owner, 'teams/team-a/todZoneConfig/default');
        await assertSucceeds(setDoc(reference, zoneData('owner-a', 1)));
        await assertFails(getDoc(doc(viewer, 'teams/team-a/todZoneConfig/default')));
        await assertFails(getDoc(doc(outsider, 'teams/team-a/todZoneConfig/default')));
        await assertFails(setDoc(doc(viewer, 'teams/team-a/todZoneConfig/default'), zoneData('viewer-a', 2)));
        await assertFails(setDoc(reference, zoneData('owner-a', 3)));
        await assertFails(setDoc(doc(owner, 'teams/team-a/todZoneConfig/other'), zoneData('owner-a', 1)));
    });

    it('allows an atomic publication once and denies version mutation', async () => {
        const db = environment.authenticatedContext('owner-a').firestore();
        const root = doc(db, 'teams/team-a/todZoneConfig/default');
        await assertSucceeds(setDoc(root, zoneData('owner-a', 1)));
        const version = doc(db, 'teams/team-a/todZoneConfig/default/versions/version-2');
        const batch = writeBatch(db);
        batch.set(root, { ...zoneData('owner-a', 2), lastPublishedVersionId: 'version-2' });
        batch.set(version, { ...zoneData('owner-a', 2), stopSnapshot: [], publishedAt: serverTimestamp(), publishedBy: 'owner-a' });
        await assertSucceeds(batch.commit());
        expect((await getDoc(version)).exists()).toBe(true);
        const viewer = environment.authenticatedContext('viewer-a').firestore();
        await assertSucceeds(getDoc(doc(viewer, 'teams/team-a/todZoneConfig/default/versions/version-2')));
        await assertFails(setDoc(version, { reviewNote: 'Changed later' }, { merge: true }));
    });

    it('rejects non-calendar-shaped dates and empty publications', async () => {
        const db = environment.authenticatedContext('owner-a').firestore();
        const root = doc(db, 'teams/team-a/todZoneConfig/default');
        await assertFails(setDoc(root, { ...zoneData('owner-a', 1), effectiveFrom: '2026-19-39' }));
        await assertSucceeds(setDoc(root, zoneData('owner-a', 1)));
        const version = doc(db, 'teams/team-a/todZoneConfig/default/versions/empty-version');
        const batch = writeBatch(db);
        batch.set(root, { ...zoneData('owner-a', 2, []), lastPublishedVersionId: 'empty-version' });
        batch.set(version, { ...zoneData('owner-a', 2, []), stopSnapshot: [], publishedAt: serverTimestamp(), publishedBy: 'owner-a' });
        await assertFails(batch.commit());
    });
});
