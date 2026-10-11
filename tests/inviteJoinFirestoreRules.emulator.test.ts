import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, doc, getDoc, getDocs, setDoc } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';

const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;
const describeWithEmulator = emulatorHost ? describe : describe.skip;

/**
 * Joining a team with an invite code: the new member gets the team's default access, never a level
 * they pick themselves (an invite-code holder could otherwise give themselves 'internal').
 */
describeWithEmulator('Invite join Firestore rules', () => {
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
        await environment.withSecurityRulesDisabled(async (context) => {
            const db = context.firestore();
            await Promise.all([
                setDoc(doc(db, 'teams/team-a'), { name: 'Team A', createdBy: 'owner-a', defaultMemberAccessLevel: 'production' }),
                setDoc(doc(db, 'teams/team-a/members/owner-a'), { role: 'owner', accessLevel: 'internal' }),
                setDoc(doc(db, 'teamInvites/ABC123'), { teamId: 'team-a', teamName: 'Team A', defaultMemberAccessLevel: 'production' }),
                // An older invite without the denormalized defaults.
                setDoc(doc(db, 'teamInvites/OLD123'), { teamId: 'team-a', teamName: 'Team A' }),
            ]);
        });
    });

    const join = (data: Record<string, unknown>, invite = 'ABC123', uid = 'new-user') =>
        setDoc(doc(environment.authenticatedContext(uid).firestore(), `teams/team-a/members/${uid}`), {
            userId: uid, role: 'member', displayName: 'New', email: 'new@example.com', inviteCode: invite, ...data,
        });

    it('lets an invited user join with the team default access, or with none', async () => {
        await assertSucceeds(join({ accessLevel: 'production' }));
        await assertSucceeds(join({ accessLevel: 'none' }, 'OLD123', 'older-invite-user'));
        await assertSucceeds(join({ accessLevel: 'production' }, 'OLD123', 'older-invite-team-default'));
    });

    it('refuses a self-chosen access level, a missing one, or extra workspace overrides', async () => {
        await assertFails(join({ accessLevel: 'internal' }));
        await assertFails(join({ accessLevel: 'planner' }, 'OLD123'));
        await assertFails(join({}));
        await assertFails(join({ accessLevel: 'production', workspaceOverrides: { workspaceOperations: true } }));
    });

    it('lets a signed-in user look up one invite but not list them all', async () => {
        const db = environment.authenticatedContext('stranger').firestore();
        await assertSucceeds(getDoc(doc(db, 'teamInvites/ABC123')));
        await assertFails(getDocs(collection(db, 'teamInvites')));
    });

    it('still refuses a wrong invite code or a non-member role', async () => {
        await assertFails(join({ accessLevel: 'production' }, 'NOPE00'));
        await assertFails(join({ accessLevel: 'production', role: 'admin' }));
    });
});
