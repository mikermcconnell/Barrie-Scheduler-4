/**
 * Removes pre-v2 New Schedule runtime artifacts. Dry-run is the default.
 *
 * Usage (from functions/):
 *   node scripts/migrate-new-schedule-runtime-v2.mjs
 *   node scripts/migrate-new-schedule-runtime-v2.mjs --project PROJECT_ID --apply --confirm-project PROJECT_ID
 */
import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { pathToFileURL } from 'node:url';

export const RUNTIME_TRUST_MIGRATION_VERSION = 2;
export const RUNTIME_BACKUP_RETENTION_DAYS = 30;
const DERIVED_KEYS = [
  'analysis', 'bands', 'parsedData', 'approvedRuntimeContract',
  'approvedRuntimeModel', 'generatedSchedules', 'originalGeneratedSchedules',
];

export function sanitizeStoredWizardContent(content = {}) {
  const next = { ...content };
  for (const key of DERIVED_KEYS) delete next[key];
  return next;
}

const isRecord = value => !!value && typeof value === 'object' && !Array.isArray(value);
const isStringArray = value => Array.isArray(value) && value.every(item => typeof item === 'string');
const isNonNegativeInteger = value => Number.isInteger(value) && value >= 0;
const isOptionalNonEmptyString = value => (
  value === undefined || (typeof value === 'string' && value.trim().length > 0)
);

function hasValidSourceSnapshotShape(value) {
  if (!isRecord(value)) return false;
  const dateRange = value.performanceDateRange;
  if (
    dateRange !== undefined
    && dateRange !== null
    && (!isRecord(dateRange)
      || typeof dateRange.start !== 'string'
      || !dateRange.start.trim()
      || typeof dateRange.end !== 'string'
      || !dateRange.end.trim())
  ) return false;
  return isOptionalNonEmptyString(value.performanceRouteId)
    && (value.runtimeLogicVersion === undefined || isNonNegativeInteger(value.runtimeLogicVersion))
    && isOptionalNonEmptyString(value.importedAt)
    && isOptionalNonEmptyString(value.cleanHistoryStartDate)
    && (value.stopOrderDecision === undefined || ['accept', 'review', 'blocked'].includes(value.stopOrderDecision))
    && (value.stopOrderConfidence === undefined || ['high', 'medium', 'low'].includes(value.stopOrderConfidence))
    && (value.stopOrderSource === undefined || ['runtime-derived', 'master-fallback', 'none'].includes(value.stopOrderSource));
}

function hasValidStopOrderShape(value) {
  if (value === undefined || value === null) return true;
  if (!isRecord(value)) return false;
  if (
    !['accept', 'review', 'blocked'].includes(value.decision)
    || !['high', 'medium', 'low'].includes(value.confidence)
    || !['runtime-derived', 'master-fallback', 'none'].includes(value.sourceUsed)
    || typeof value.usedForPlanning !== 'boolean'
    || typeof value.summary !== 'string'
    || !isStringArray(value.warnings)
    || !isRecord(value.directionStats)
  ) return false;
  return Object.entries(value.directionStats).every(([direction, stats]) => (
    ['North', 'South', 'Loop'].includes(direction)
    && isRecord(stats)
    && isNonNegativeInteger(stats.tripCountUsed)
    && isNonNegativeInteger(stats.dayCountUsed)
    && isNonNegativeInteger(stats.middayTripCount)
  ));
}

function hasValidHealthSnapshotShape(value, readinessStatus, reviewBucketCount, approvedBucketCount, segmentColumnCount) {
  if (!isRecord(value)) return false;
  const requiredCounts = [
    value.expectedDirections, value.expectedSegmentCount, value.matchedSegmentCount,
    value.availableBucketCount, value.completeBucketCount,
    value.incompleteBucketCount, value.lowConfidenceBucketCount,
  ];
  if (requiredCounts.some(count => !isNonNegativeInteger(count))) return false;
  if (
    value.status !== readinessStatus
    || !['ready', 'warning'].includes(value.status)
    || !isStringArray(value.blockers)
    || !isStringArray(value.warnings)
    || !isStringArray(value.matchedDirections)
    || !isStringArray(value.missingSegments)
    || typeof value.runtimeSourceSummary !== 'string'
    || !value.runtimeSourceSummary.trim()
    || !Number.isFinite(value.confidenceThreshold)
    || value.confidenceThreshold <= 0
    || typeof value.usesLegacyRuntimeLogic !== 'boolean'
  ) return false;
  if (
    value.expectedSegmentCount !== segmentColumnCount
    || value.matchedSegmentCount > segmentColumnCount
    || value.availableBucketCount !== reviewBucketCount
    || (value.coverageCompleteBucketCount !== undefined
      && (!isNonNegativeInteger(value.coverageCompleteBucketCount)
        || value.completeBucketCount !== value.coverageCompleteBucketCount))
    || (value.trustedReadyBucketCount !== undefined
      && (!isNonNegativeInteger(value.trustedReadyBucketCount)
        || value.trustedReadyBucketCount !== approvedBucketCount))
    || value.incompleteBucketCount > reviewBucketCount
    || value.lowConfidenceBucketCount > reviewBucketCount
  ) return false;
  if (value.sampleCountMode !== undefined && !['days', 'observations'].includes(value.sampleCountMode)) return false;
  const optionalCounts = [
    'repairedBucketCount', 'boundaryBucketCount', 'singleGapBucketCount',
    'internalGapBucketCount', 'fragmentedGapBucketCount', 'excludedLegacyDayCount',
  ];
  if (optionalCounts.some(key => value[key] !== undefined && !isNonNegativeInteger(value[key]))) return false;
  return isOptionalNonEmptyString(value.importedAt)
    && (value.runtimeLogicVersion === undefined || isNonNegativeInteger(value.runtimeLogicVersion))
    && isOptionalNonEmptyString(value.cleanHistoryStartDate)
    && (value.usesCleanHistoryCutoff === undefined || typeof value.usesCleanHistoryCutoff === 'boolean')
    && hasValidStopOrderShape(value.stopOrder);
}

function isIndependentlyEligibleApprovedBucket(bucket) {
  if (!bucket || typeof bucket !== 'object' || Array.isArray(bucket)) return false;
  const bandingTotal = bucket.observedCycleP50 ?? bucket.totalP50;
  const observedSegmentCount = bucket.observedSegmentCount ?? bucket.details?.length ?? 0;
  const expectedSegmentCount = bucket.expectedSegmentCount ?? 0;
  if (
    !Number.isFinite(bandingTotal)
    || bandingTotal <= 0
    || bucket.ignored !== false
    || bucket.isOutlier !== false
    || typeof bucket.assignedBand !== 'string'
    || !bucket.assignedBand.trim()
    || expectedSegmentCount <= 0
    || observedSegmentCount < expectedSegmentCount
    || (bucket.missingSegmentNames?.length ?? 0) > 0
    || (bucket.coverageCause && bucket.coverageCause !== 'complete')
    || bucket.runtimePatternKind === 'detour'
  ) return false;

  const evidence = bucket.evidence;
  if (
    !evidence
    || typeof evidence !== 'object'
    || !Number.isInteger(evidence.qualifyingCount)
    || evidence.qualifyingCount < 0
  ) return false;

  if (evidence.kind === 'paired-cycle') {
    const distinctDays = new Set(
      (bucket.contributingDays ?? [])
        .map(contribution => typeof contribution?.date === 'string' ? contribution.date.trim() : '')
        .filter(Boolean)
    ).size;
    return bucket.sampleCountMode === 'days'
      && evidence.requiredCount === 5
      && evidence.qualifyingCount >= 5
      && distinctDays >= 5;
  }
  if (evidence.kind === 'uploaded-percentiles') {
    const segmentCounts = Array.isArray(bucket.details)
      ? bucket.details.map(detail => detail?.n ?? 0)
      : [];
    return bucket.sampleCountMode === 'observations'
      && evidence.requiredCount === 10
      && evidence.qualifyingCount >= 10
      && segmentCounts.length > 0
      && segmentCounts.every(count => Number.isInteger(count) && count >= 10);
  }
  return false;
}

export function isStructurallyValidV2Contract(value) {
  if (!value || typeof value !== 'object') return false;
  if (
    value.schemaVersion !== RUNTIME_TRUST_MIGRATION_VERSION
    || value.approvalState !== 'approved'
    || typeof value.inputFingerprint !== 'string'
    || value.inputFingerprint.trim().length === 0
    || typeof value.routeIdentity !== 'string'
    || typeof value.routeNumber !== 'string'
    || !['Weekday', 'Saturday', 'Sunday'].includes(value.dayType)
    || !['csv', 'performance'].includes(value.importMode)
  ) return false;
  if (!hasValidSourceSnapshotShape(value.sourceSnapshot)) return false;
  const planning = value.planning;
  if (!planning || typeof planning !== 'object' || Array.isArray(planning)) return false;
  const reviewBuckets = planning.reviewBuckets;
  const approvedBuckets = planning.approvedBuckets;
  const compatibilityBuckets = planning.buckets;
  const bands = planning.bands;
  const directions = planning.directions;
  const canonicalStops = planning.canonicalDirectionStops;
  const segmentColumns = planning.segmentColumns;
  if (
    !Array.isArray(reviewBuckets)
    || !Array.isArray(approvedBuckets)
    || approvedBuckets.length === 0
    || !Array.isArray(compatibilityBuckets)
    || compatibilityBuckets.length !== reviewBuckets.length
    || !Array.isArray(bands)
    || bands.length === 0
    || !Array.isArray(directions)
    || directions.length === 0
    || !Array.isArray(segmentColumns)
    || segmentColumns.length === 0
    || segmentColumns.some(column => (
      !isRecord(column)
      || typeof column.segmentName !== 'string'
      || !column.segmentName.trim()
      || (column.direction !== undefined && typeof column.direction !== 'string')
      || (column.groupLabel !== undefined && typeof column.groupLabel !== 'string')
    ))
    || !canonicalStops
    || typeof canonicalStops !== 'object'
    || Array.isArray(canonicalStops)
    || !planning.directionBandSummary
    || typeof planning.directionBandSummary !== 'object'
    || Array.isArray(planning.directionBandSummary)
  ) return false;

  const validDirections = new Set(['North', 'South', 'Loop']);
  const normalizedDirections = directions.map(direction => (
    typeof direction === 'string' ? direction.trim() : ''
  ));
  if (
    normalizedDirections.some(direction => !validDirections.has(direction))
    || new Set(normalizedDirections).size !== normalizedDirections.length
  ) return false;
  const directionSummary = planning.directionBandSummary;
  if (!normalizedDirections.every(direction => {
    const stops = canonicalStops[direction];
    if (!Array.isArray(stops) || stops.length < 2) return false;
    const normalizedStops = stops.map(stop => typeof stop === 'string' ? stop.trim() : '');
    return normalizedStops.every(Boolean)
      && normalizedStops.some((stop, index) => index > 0 && stop !== normalizedStops[index - 1]);
  })) return false;
  if (normalizedDirections.some(direction => (
    !Array.isArray(directionSummary[direction]) || directionSummary[direction].length === 0
  ))) return false;

  if (approvedBuckets.some(bucket => !isIndependentlyEligibleApprovedBucket(bucket))) return false;
  const approvedBucketKeys = approvedBuckets.map(bucket => bucket?.timeBucket);
  if (
    approvedBucketKeys.some(key => typeof key !== 'string' || !key.trim())
    || new Set(approvedBucketKeys).size !== approvedBucketKeys.length
  ) return false;
  const orderedReviewBucketKeys = reviewBuckets.map(bucket => bucket?.timeBucket);
  const orderedCompatibilityBucketKeys = compatibilityBuckets.map(bucket => bucket?.timeBucket);
  if (orderedReviewBucketKeys.some((key, index) => key !== orderedCompatibilityBucketKeys[index])) return false;
  const reviewBucketKeys = new Set(orderedReviewBucketKeys);
  if (approvedBucketKeys.some(key => !reviewBucketKeys.has(key))) return false;

  const assignedBandIds = new Set(approvedBuckets.map(bucket => bucket.assignedBand));
  const definedBandIds = new Set(bands.map(band => band?.id));
  return hasValidHealthSnapshotShape(
    value.healthSnapshot,
    value.readinessStatus,
    reviewBuckets.length,
    approvedBuckets.length,
    segmentColumns.length
  )
    && Number.isInteger(planning.usableBucketCount)
    && planning.usableBucketCount === approvedBuckets.length
    && Number.isInteger(planning.ignoredBucketCount)
    && planning.ignoredBucketCount === reviewBuckets.filter(bucket => bucket?.ignored === true).length
    && Number.isInteger(planning.usableBandCount)
    && planning.usableBandCount === assignedBandIds.size
    && planning.usableBandCount > 0
    && definedBandIds.size === bands.length
    && Array.from(definedBandIds).every(id => typeof id === 'string' && id.trim())
    && Array.from(assignedBandIds).every(id => definedBandIds.has(id));
}

export function needsRuntimeTrustMigration(data = {}, storageContent = {}) {
  const storageIsActive = storageContent && typeof storageContent === 'object'
    && Object.keys(storageContent).length > 0;
  const activeContract = storageIsActive
    ? storageContent.approvedRuntimeContract
    : data.approvedRuntimeContract;
  // A valid saved v2 contract is authoritative even if an older migration
  // marker was never written. Conversely, a marker never blesses legacy data.
  if (isStructurallyValidV2Contract(activeContract)) return false;
  const hasDerivedData = source => DERIVED_KEYS.some(key => {
    const value = source[key];
    return Array.isArray(value) ? value.length > 0 : value != null;
  });
  return hasDerivedData(data) || hasDerivedData(storageContent) || data.isGenerated === true;
}

export function assertApplyProjectConfirmation({ apply, explicitProjectId = undefined, confirmedProjectId = undefined }) {
  if (!apply) return;
  if (!explicitProjectId || !confirmedProjectId || explicitProjectId !== confirmedProjectId) {
    throw new Error(
      'Destructive apply requires matching --project PROJECT_ID and --confirm-project PROJECT_ID arguments.'
    );
  }
}

function readArg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

export async function migrateNewScheduleRuntimeProjects({ db, bucket, apply = false, now = new Date() }) {
  const counters = { scanned: 0, changed: 0, skipped: 0, failed: 0, cleanupWarnings: 0, backups: [] };
  const snapshot = await db.collectionGroup('newScheduleProjects').get();

  for (const project of snapshot.docs) {
    counters.scanned += 1;
    const pathParts = project.ref.path.split('/');
    if (pathParts.length !== 4 || pathParts[0] !== 'users' || pathParts[2] !== 'newScheduleProjects') {
      counters.skipped += 1;
      continue;
    }

    const data = project.data() ?? {};
    const oldStoragePath = typeof data.storagePath === 'string' ? data.storagePath : undefined;
    let storageContent = {};
    let originalBuffer;
    try {
      if (oldStoragePath) {
        if (!oldStoragePath.startsWith(`users/${pathParts[1]}/newScheduleProjects/`)) {
          throw new Error(`Unsafe storage path: ${oldStoragePath}`);
        }
        [originalBuffer] = await bucket.file(oldStoragePath).download();
        storageContent = JSON.parse(originalBuffer.toString('utf8'));
      }

      if (!needsRuntimeTrustMigration(data, storageContent)) {
        counters.skipped += 1;
        continue;
      }
      if (!apply) {
        counters.changed += 1;
        continue;
      }

      let newStoragePath;
      let backupPath;
      if (originalBuffer) {
        const stamp = now.toISOString().replace(/[:.]/g, '-');
        const deleteAfter = new Date(
          now.getTime() + RUNTIME_BACKUP_RETENTION_DAYS * 24 * 60 * 60 * 1000
        ).toISOString();
        backupPath = `migration-backups/new-schedule-runtime-v2/${stamp}/${pathParts[1]}/${project.id}.json`;
        await bucket.file(backupPath).save(originalBuffer, {
          resumable: false,
          contentType: 'application/json',
          metadata: {
            customTime: now.toISOString(),
            metadata: {
              retentionPolicy: 'delete-after-30-days',
              deleteAfter,
              sourceProjectPath: project.ref.path,
            },
          },
        });
        counters.backups.push(backupPath);

        newStoragePath = `users/${pathParts[1]}/newScheduleProjects/${project.id}_${Date.now()}_v2-reset.json`;
        const cleanBuffer = Buffer.from(JSON.stringify(sanitizeStoredWizardContent(storageContent)));
        await bucket.file(newStoragePath).save(cleanBuffer, { resumable: false, contentType: 'application/json' });
        const [verified] = await bucket.file(newStoragePath).download();
        if (verified.toString('utf8') !== cleanBuffer.toString('utf8')) {
          throw new Error('Storage verification failed');
        }
      }

      let concurrentEdit = false;
      try {
        await db.runTransaction(async transaction => {
          const current = await transaction.get(project.ref);
          if (!current.exists || current.updateTime?.toMillis() !== project.updateTime?.toMillis()) {
            concurrentEdit = true;
            return;
          }
          const update = {
            analysis: [], bands: [], generatedSchedules: [], originalGeneratedSchedules: [],
            approvedRuntimeContract: FieldValue.delete(), approvedRuntimeModel: FieldValue.delete(),
            parsedData: FieldValue.delete(), isGenerated: false,
            runtimeTrustSchemaVersion: FieldValue.delete(),
            runtimeTrustMigrationVersion: RUNTIME_TRUST_MIGRATION_VERSION,
            runtimeTrustMigratedAt: FieldValue.serverTimestamp(),
          };
          if (newStoragePath) update.storagePath = newStoragePath;
          transaction.update(project.ref, update);
        });
      } catch (error) {
        if (newStoragePath) await bucket.file(newStoragePath).delete({ ignoreNotFound: true });
        throw error;
      }

      if (concurrentEdit) {
        if (newStoragePath) await bucket.file(newStoragePath).delete({ ignoreNotFound: true });
        counters.skipped += 1;
        continue;
      }
      if (oldStoragePath && newStoragePath) {
        try {
          await bucket.file(oldStoragePath).delete({ ignoreNotFound: true });
        } catch (error) {
          counters.cleanupWarnings += 1;
          process.stderr.write(
            `${project.ref.path}: migration committed but old Storage cleanup failed: ${error instanceof Error ? error.message : String(error)}\n`
          );
        }
      }
      counters.changed += 1;
    } catch (error) {
      counters.failed += 1;
      process.stderr.write(`${project.ref.path}: ${error instanceof Error ? error.message : String(error)}\n`);
    }
  }
  return counters;
}

async function main() {
  const apply = process.argv.includes('--apply');
  const explicitProjectId = readArg('--project');
  const confirmedProjectId = readArg('--confirm-project');
  assertApplyProjectConfirmation({ apply, explicitProjectId, confirmedProjectId });
  const projectId = explicitProjectId || process.env.GOOGLE_CLOUD_PROJECT || 'barrie-scheduler-7844a';
  const storageBucket = readArg('--bucket') || `${projectId}.firebasestorage.app`;
  if (getApps().length === 0) initializeApp({ credential: applicationDefault(), projectId, storageBucket });
  const counters = await migrateNewScheduleRuntimeProjects({
    db: getFirestore(), bucket: getStorage().bucket(storageBucket), apply,
  });
  process.stdout.write(`${JSON.stringify({ mode: apply ? 'applied' : 'dry-run', ...counters }, null, 2)}\n`);
  if (counters.failed > 0) process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) await main();
