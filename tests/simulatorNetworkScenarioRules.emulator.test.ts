import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { deleteDoc, doc, getDoc, setDoc } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';

const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;
const describeWithEmulator = emulatorHost ? describe : describe.skip;

/** Barrie Simulator's Network editor keeps the team's scenarios here (Barrie-Simulator src/network/cloud.ts). */
describeWithEmulator('Simulator network scenario Firestore rules', () => {
    let environment: RulesTestEnvironment;
    const path = 'teams/team-a/simulatorNetworkScenarios/ab12cd34';
    const scenario = { file: '{"format":"barrie-network-draft"}', name: 'Swap 2 and 12', updatedAt: new Date(), updatedBy: 'member-a@example.com' };

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
                setDoc(doc(db, 'teams/team-a'), { name: 'Team A', createdBy: 'owner-a' }),
                setDoc(doc(db, 'teams/team-a/members/member-a'), { role: 'member', accessLevel: 'planner' }),
                setDoc(doc(db, 'teams/team-b'), { name: 'Team B', createdBy: 'owner-b' }),
                setDoc(doc(db, 'teams/team-b/members/member-b'), { role: 'member', accessLevel: 'planner' }),
            ]);
        });
    });

    const memberDb = () => environment.authenticatedContext('member-a').firestore();
    const otherTeamDb = () => environment.authenticatedContext('member-b').firestore();
    const guestDb = () => environment.unauthenticatedContext().firestore();

    it('lets a team member save, read and delete a scenario', async () => {
        await assertSucceeds(setDoc(doc(memberDb(), path), scenario));
        await assertSucceeds(getDoc(doc(memberDb(), path)));
        await assertSucceeds(setDoc(doc(memberDb(), path), { ...scenario, name: 'Renamed' }));
        await assertSucceeds(deleteDoc(doc(memberDb(), path)));
    });

    it('blocks people who are not on the team, and signed-out visitors', async () => {
        await assertFails(setDoc(doc(otherTeamDb(), path), scenario));
        await assertFails(getDoc(doc(otherTeamDb(), path)));
        await assertFails(getDoc(doc(guestDb(), path)));
        await assertFails(setDoc(doc(guestDb(), path), scenario));
    });

    it('accepts only the scenario fields', async () => {
        await assertFails(setDoc(doc(memberDb(), path), { ...scenario, extra: true }));
        await assertFails(setDoc(doc(memberDb(), path), { ...scenario, file: 42 }));
    });
});
