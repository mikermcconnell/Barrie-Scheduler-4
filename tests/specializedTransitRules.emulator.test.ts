import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { deleteDoc, doc, getDoc, setDoc } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';

const firestoreHost = process.env.FIRESTORE_EMULATOR_HOST;
const storageHost = process.env.FIREBASE_STORAGE_EMULATOR_HOST;
const describeWithEmulators = firestoreHost && storageHost ? describe : describe.skip;
const storageBucket = 'demo-scheduler-4.appspot.com';
const storageObjectPath = 'teams/team-a/specializedTransitData/revision-1-test.json';

function mockStorageToken(userId: string): string {
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'none', type: 'JWT' })}.${encode({
    iss: 'https://securetoken.google.com/demo-scheduler-4',
    aud: 'demo-scheduler-4',
    iat: 0,
    exp: 3600,
    auth_time: 0,
    sub: userId,
    user_id: userId,
    firebase: { sign_in_provider: 'custom', identities: {} },
  })}.`;
}

async function storageRequest(
  method: 'GET' | 'POST' | 'DELETE',
  objectPath: string,
  actor?: string,
  body?: string,
  contentType = 'application/octet-stream',
): Promise<Response> {
  const objectName = encodeURIComponent(objectPath);
  const baseUrl = `http://${storageHost}/v0/b/${storageBucket}/o`;
  const url = method === 'POST' ? `${baseUrl}?name=${objectName}` : `${baseUrl}/${objectName}`;
  const headers: Record<string, string> = {};
  if (actor) headers.Authorization = `Bearer ${actor === 'owner' ? 'owner' : mockStorageToken(actor)}`;
  let requestBody = body;
  if (method === 'POST' && body !== undefined) {
    const boundary = `scheduler4-${crypto.randomUUID()}`;
    headers['X-Goog-Upload-Protocol'] = 'multipart';
    headers['Content-Type'] = `multipart/related; boundary=${boundary}`;
    requestBody = [
      `--${boundary}\r\nContent-Type: application/json; charset=utf-8\r\n\r\n${JSON.stringify({ name: objectPath, contentType })}`,
      `--${boundary}\r\nContent-Type: ${contentType}\r\n\r\n${body}`,
      `--${boundary}--`,
    ].join('\r\n');
  }
  try {
    return await fetch(url, { method, headers, body: requestBody, signal: AbortSignal.timeout(10_000) });
  } catch (cause) {
    throw new Error(`Storage emulator ${method} ${objectPath} did not respond.`, { cause });
  }
}

describeWithEmulators('Specialized Transit aggregate rules', () => {
  let environment: RulesTestEnvironment;

  beforeAll(async () => {
    const [firestoreHostname = '127.0.0.1', firestorePort = '8085'] = firestoreHost!.split(':');
    const [storageHostname = '127.0.0.1', storagePort = '9199'] = storageHost!.split(':');
    environment = await initializeTestEnvironment({
      projectId: 'demo-scheduler-4',
      firestore: { host: firestoreHostname, port: Number(firestorePort), rules: readFileSync(resolve(process.cwd(), 'firestore.rules'), 'utf8') },
      storage: { host: storageHostname, port: Number(storagePort), rules: readFileSync(resolve(process.cwd(), 'storage.rules'), 'utf8') },
    });
  }, 30_000);

  afterAll(async () => environment?.cleanup(), 30_000);

  beforeEach(async () => {
    await Promise.all([
      environment.clearFirestore(),
      storageRequest('DELETE', storageObjectPath, 'owner'),
    ]);
    await environment.withSecurityRulesDisabled(async context => {
      const db = context.firestore();
      await Promise.all([
        setDoc(doc(db, 'teams/team-a/members/manager'), { role: 'owner', accessLevel: 'internal' }),
        setDoc(doc(db, 'teams/team-a/members/team-admin'), { role: 'admin', accessLevel: 'admin' }),
        setDoc(doc(db, 'teams/team-b/members/outsider'), { role: 'owner' }),
        setDoc(doc(db, 'teams/team-a/members/admin-reader'), { role: 'member', accessLevel: 'admin' }),
        setDoc(doc(db, 'teams/team-a/members/planner'), { role: 'member', accessLevel: 'planner' }),
        setDoc(doc(db, 'teams/team-a/members/authorized-planner'), { role: 'member', accessLevel: 'planner' }),
        setDoc(doc(db, 'teams/team-a/specializedTransitData/metadata'), {
          schemaVersion: 1,
          activeRevision: 1,
          storagePath: 'teams/team-a/specializedTransitData/revision-1-test.json',
        }),
      ]);
    });
    const seeded = await storageRequest('POST', storageObjectPath, 'owner', '{"schemaVersion":1}');
    if (!seeded.ok) throw new Error(`Storage emulator fixture failed with HTTP ${seeded.status}.`);
  }, 30_000);

  it('lets every team member read without a dedicated feature permission', async () => {
    for (const userId of ['manager', 'admin-reader', 'planner', 'authorized-planner']) {
      const context = environment.authenticatedContext(userId);
      await assertSucceeds(getDoc(doc(context.firestore(), 'teams/team-a/specializedTransitData/metadata')));
      const response = await storageRequest('GET', storageObjectPath, userId);
      if (!response.ok) throw new Error(`Expected ${userId} Storage read to succeed; received HTTP ${response.status}.`);
    }
  });

  it('rejects authenticated non-members and anonymous readers', async () => {
    const tester = environment.authenticatedContext('development-tester');
    await assertFails(getDoc(doc(tester.firestore(), 'teams/team-a/specializedTransitData/metadata')));
    const testerRead = await storageRequest('GET', storageObjectPath, 'development-tester');
    if (testerRead.status !== 403) throw new Error(`Expected non-member Storage read to fail; received ${testerRead.status}.`);
    await assertFails(getDoc(doc(environment.unauthenticatedContext().firestore(), 'teams/team-a/specializedTransitData/metadata')));
    const anonymousRead = await storageRequest('GET', storageObjectPath);
    if (anonymousRead.status !== 403) throw new Error(`Expected anonymous Storage read to return 403; received ${anonymousRead.status}.`);
  });

  it('allows manager publication while rejecting PDFs and anonymous writes', async () => {
    const tester = environment.authenticatedContext('manager');
    const anonymous = environment.unauthenticatedContext();
    const [, testerJsonWrite, testerPdfWrite, , anonymousWrite] = await Promise.all([
      assertSucceeds(setDoc(doc(tester.firestore(), 'teams/team-a/specializedTransitData/metadata'), { activeRevision: 2 })),
      storageRequest(
        'POST',
        'teams/team-a/specializedTransitData/revision-2-test.json',
        'manager',
        '{}',
        'application/json',
      ),
      storageRequest(
        'POST',
        'teams/team-a/specializedTransitData/source.pdf',
        'manager',
        'raw-pdf',
        'application/pdf',
      ),
      assertFails(setDoc(doc(anonymous.firestore(), 'teams/team-a/specializedTransitData/metadata'), { activeRevision: 3 })),
      storageRequest(
        'POST',
        'teams/team-a/specializedTransitData/revision-3-test.json',
        undefined,
        '{}',
      ),
    ]);
    if (!testerJsonWrite.ok) throw new Error(`Expected authenticated JSON Storage write to succeed; received ${testerJsonWrite.status}.`);
    if (testerPdfWrite.status !== 403) throw new Error(`Expected PDF Storage write to return 403; received ${testerPdfWrite.status}.`);
    if (anonymousWrite.status !== 403) throw new Error(`Expected anonymous Storage write to return 403; received ${anonymousWrite.status}.`);
  }, 30_000);

  it('rejects member and cross-team writes and deletes in both stores', async () => {
    for (const actor of ['planner', 'admin-reader', 'outsider', 'development-tester']) {
      const db = environment.authenticatedContext(actor).firestore();
      await assertFails(setDoc(doc(db, 'teams/team-a/specializedTransitData/metadata'), { activeRevision: 2 }));
      await assertFails(deleteDoc(doc(db, 'teams/team-a/specializedTransitData/metadata')));
      const write = await storageRequest('POST', storageObjectPath, actor, '{}', 'application/json');
      const deletion = await storageRequest('DELETE', storageObjectPath, actor);
      if (write.status !== 403 || deletion.status !== 403) throw new Error(`${actor} unexpectedly changed team-a Storage data.`);
    }
    const admin = environment.authenticatedContext('team-admin').firestore();
    await assertSucceeds(setDoc(doc(admin, 'teams/team-a/specializedTransitData/metadata'), { activeRevision: 2 }));
    const write = await storageRequest('POST', storageObjectPath, 'team-admin', '{}', 'application/json');
    if (!write.ok) throw new Error('Team admin could not publish.');
  }, 30_000);
});
