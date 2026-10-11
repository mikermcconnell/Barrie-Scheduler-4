import * as admin from 'firebase-admin';
import { onDocumentUpdated } from 'firebase-functions/v2/firestore';
import { publishSimulatorDaysForImport, SIMULATOR_FEED_METADATA_PATH, type SimulatorImportRun } from './simulatorDayPublish';

/**
 * Publishes the simulator day feed whenever a STREETS import (queued or in-app) reaches
 * `completed`. It runs after, and independently of, the performance import: a failure here is
 * logged on the feed metadata and never changes the import's status. Replays are safe, and
 * `functions/scripts/backfill-simulator-days.mjs` can rebuild any range.
 */
export const publishSimulatorDays = onDocumentUpdated(
  {
    document: 'teams/{teamId}/performanceImports/{runId}',
    memory: '2GiB',
    timeoutSeconds: 540,
    maxInstances: 1,
    concurrency: 1,
    retry: false,
    region: 'northamerica-northeast2',
  },
  async event => {
    const before = event.data?.before.data() as ({ status?: string } & SimulatorImportRun) | undefined;
    const after = event.data?.after.data() as ({ status?: string } & SimulatorImportRun) | undefined;
    if (!after || after.status !== 'completed' || before?.status === 'completed') return;

    const { teamId, runId } = event.params;
    const db = admin.firestore();
    try {
      const result = await publishSimulatorDaysForImport({ db, bucket: admin.storage().bucket(), teamId, importId: runId, run: after });
      console.log(`Simulator feed for import ${runId}: published ${result.published.join(', ') || 'none'}`
        + `${result.skippedOlder.length ? `; kept newer data for ${result.skippedOlder.join(', ')}` : ''}`);
    } catch (error) {
      console.error(`Simulator feed publication failed for import ${runId}:`, error);
      await db.doc(SIMULATOR_FEED_METADATA_PATH(teamId)).set({
        lastError: {
          importId: runId,
          message: (error instanceof Error ? error.message : String(error)).slice(0, 500),
          at: admin.firestore.FieldValue.serverTimestamp(),
        },
      }, { merge: true });
    }
  },
);
