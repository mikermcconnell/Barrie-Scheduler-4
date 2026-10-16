import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc, updateDoc, writeBatch } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';

const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;
const describeWithEmulator = emulatorHost ? describe : describe.skip;

/**
 * Workspace access is granted by scheduler admins only. A team owner (for example
 * someone who created their own team) must not be able to raise their own or their
 * team's workspace access.
 */
describeWithEmulator('Team workspace access Firestore rules', () => {
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
                setDoc(doc(db, 'teams/team-a'), { name: 'Team A', createdBy: 'owner-a', inviteCode: 'ABC123', defaultMemberAccessLevel: 'external-planner' }),
                setDoc(doc(db, 'teams/team-a/members/owner-a'), { role: 'owner', accessLevel: 'external-planner' }),
                setDoc(doc(db, 'teams/team-a/members/member-a'), { role: 'member', accessLevel: 'external-planner' }),
                setDoc(doc(db, 'teams/team-a/members/scheduler-admin'), { role: 'owner', accessLevel: 'internal' }),
                setDoc(doc(db, 'teamInvites/ABC123'), { teamId: 'team-a', teamName: 'Team A', defaultMemberAccessLevel: 'external-planner' }),
            ]);
        });
    });

    const ownerDb = () => environment.authenticatedContext('owner-a').firestore();
    const adminDb = () => environment.authenticatedContext('scheduler-admin', { schedulerAdmin: true, email: 'mike.mcconnell@barrie.ca' }).firestore();
    const otherAdminDb = () => environment.authenticatedContext('other-admin', { schedulerAdmin: true, email: 'codex.dev@example.com' }).firestore();

    it('blocks a team owner from changing member workspace access, including their own', async () => {
        await assertFails(updateDoc(doc(ownerDb(), 'teams/team-a/members/owner-a'), { accessLevel: 'internal' }));
        await assertFails(updateDoc(doc(ownerDb(), 'teams/team-a/members/member-a'), { accessLevel: 'admin' }));
        await assertFails(updateDoc(doc(ownerDb(), 'teams/team-a/members/member-a'), { workspaceOverrides: { workspaceFixedRoute: true } }));
    });

    it('still lets a team owner manage roles and rename the team', async () => {
        await assertSucceeds(updateDoc(doc(ownerDb(), 'teams/team-a/members/member-a'), { role: 'admin' }));
        await assertSucceeds(updateDoc(doc(ownerDb(), 'teams/team-a'), { name: 'Team A renamed' }));
    });

    it('blocks a team owner from changing the team access package or invite defaults', async () => {
        await assertFails(updateDoc(doc(ownerDb(), 'teams/team-a'), { defaultMemberAccessLevel: 'internal' }));
        await assertFails(updateDoc(doc(ownerDb(), 'teams/team-a'), { defaultMemberWorkspaceOverrides: { workspaceParking: true } }));
        await assertFails(setDoc(doc(ownerDb(), 'teamInvites/ABC123'), { teamId: 'team-a', teamName: 'Team A', defaultMemberAccessLevel: 'internal' }));
        await assertSucceeds(setDoc(doc(ownerDb(), 'teamInvites/NEW123'), { teamId: 'team-a', teamName: 'Team A', defaultMemberAccessLevel: 'external-planner', defaultMemberWorkspaceOverrides: {} }));
    });

    it('blocks a team owner from adding a member with workspace access', async () => {
        await assertFails(setDoc(doc(ownerDb(), 'teams/team-a/members/added'), { role: 'member', accessLevel: 'internal' }));
        await assertSucceeds(setDoc(doc(ownerDb(), 'teams/team-a/members/added'), { role: 'member', accessLevel: 'none' }));
    });

    it('blocks other scheduler admins from changing access or editing through a support session', async () => {
        await environment.withSecurityRulesDisabled(async (context) => {
            const db = context.firestore();
            await setDoc(doc(db, 'teams/team-a/members/other-admin'), { role: 'owner', accessLevel: 'internal' });
            await setDoc(doc(db, 'developerSupportSessions/other-admin'), {
                teamId: 'team-a', mode: 'edit', reason: 'Developer edit', expiresAt: new Date(Date.now() + 30 * 60_000),
            });
        });
        await assertFails(updateDoc(doc(otherAdminDb(), 'teams/team-a/members/member-a'), { accessLevel: 'planner' }));
        await assertFails(updateDoc(doc(otherAdminDb(), 'teams/team-a'), { defaultMemberAccessLevel: 'planner' }));
        await assertSucceeds(updateDoc(doc(otherAdminDb(), 'teams/team-a'), { name: 'Renamed by co-owner' }));
    });

    it('lets the primary developer edit another team through a support session', async () => {
        await environment.withSecurityRulesDisabled(async (context) => {
            await setDoc(doc(context.firestore(), 'developerSupportSessions/primary-dev'), {
                teamId: 'team-a', mode: 'edit', reason: 'Developer edit', expiresAt: new Date(Date.now() + 30 * 60_000),
            });
        });
        const primaryDb = environment.authenticatedContext('primary-dev', { schedulerAdmin: true, email: 'mike.mcconnell@barrie.ca' }).firestore();
        await assertSucceeds(updateDoc(doc(primaryDb, 'teams/team-a/members/member-a'), { accessLevel: 'planner' }));
        await assertSucceeds(updateDoc(doc(primaryDb, 'teams/team-a'), { name: 'Renamed in edit session' }));
    });

    describe('deleting a team in a primary developer edit session', () => {
        const primaryDb = () => environment.authenticatedContext('primary-dev', { schedulerAdmin: true, email: 'mike.mcconnell@barrie.ca' }).firestore();
        beforeEach(async () => {
            await environment.withSecurityRulesDisabled(async (context) => {
                const db = context.firestore();
                await setDoc(doc(db, 'teams/team-b'), { name: 'Team B', createdBy: 'owner-b', inviteCode: 'GONE00' });
                await setDoc(doc(db, 'teams/team-b/members/owner-b'), { role: 'owner', accessLevel: 'none' });
                await setDoc(doc(db, 'developerSupportSessions/primary-dev'), {
                    teamId: 'team-b', mode: 'edit', reason: 'Developer edit', expiresAt: new Date(Date.now() + 30 * 60_000),
                });
            });
        });

        it('fails when the batch also deletes an invite record that does not exist', async () => {
            const db = primaryDb();
            const batch = writeBatch(db);
            batch.delete(doc(db, 'teams/team-b/members/owner-b'));
            batch.delete(doc(db, 'teams/team-b'));
            batch.delete(doc(db, 'teamInvites/GONE00'));
            await assertFails(batch.commit());
        });

        it('fails when the batch deletes an invite record that belongs to another team', async () => {
            const db = primaryDb();
            const batch = writeBatch(db);
            batch.delete(doc(db, 'teams/team-b/members/owner-b'));
            batch.delete(doc(db, 'teams/team-b'));
            batch.delete(doc(db, 'teamInvites/ABC123'));
            await assertFails(batch.commit());
        });

        it('succeeds when only the team and its members are deleted', async () => {
            const db = primaryDb();
            const batch = writeBatch(db);
            batch.delete(doc(db, 'teams/team-b/members/owner-b'));
            batch.delete(doc(db, 'teams/team-b'));
            await assertSucceeds(batch.commit());
        });
    });

    it('lets a scheduler admin change member access and the team package', async () => {
        await assertSucceeds(updateDoc(doc(adminDb(), 'teams/team-a/members/member-a'), { accessLevel: 'planner', workspaceOverrides: {} }));
        await assertSucceeds(updateDoc(doc(adminDb(), 'teams/team-a'), { defaultMemberAccessLevel: 'planner', defaultMemberWorkspaceOverrides: {} }));
    });

    it('creates a self-service team only with no workspace access', async () => {
        const create = (db: ReturnType<typeof ownerDb>, teamId: string, uid: string, level: string, teamDefault: string) => {
            const batch = writeBatch(db);
            batch.set(doc(db, `teams/${teamId}`), { name: 'New team', createdBy: uid, inviteCode: `${teamId}-code`, defaultMemberAccessLevel: teamDefault });
            batch.set(doc(db, `teams/${teamId}/members/${uid}`), { userId: uid, role: 'owner', accessLevel: level });
            batch.set(doc(db, `teamInvites/${teamId}-code`), { teamId, teamName: 'New team', createdBy: uid, defaultMemberAccessLevel: teamDefault });
            return batch.commit();
        };
        const newUserDb = environment.authenticatedContext('new-user').firestore();
        await assertFails(create(newUserDb, 'team-internal', 'new-user', 'internal', 'none'));
        await assertFails(create(newUserDb, 'team-default', 'new-user', 'none', 'internal'));
        await assertSucceeds(create(newUserDb, 'team-none', 'new-user', 'none', 'none'));
    });

    it('blocks a self-service team from pointing at another team as a data source', async () => {
        await assertFails(setDoc(doc(environment.authenticatedContext('new-user').firestore(), 'teams/team-b'), {
            name: 'Team B', createdBy: 'new-user', defaultMemberAccessLevel: 'none', dataSourceTeamIds: { masterSchedules: 'team-a' },
        }));
    });
});
