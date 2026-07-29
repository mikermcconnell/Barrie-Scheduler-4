import { getStorage } from 'firebase-admin/storage';
import { onSchedule } from 'firebase-functions/v2/scheduler';

export const NEW_SCHEDULE_RUNTIME_BACKUP_PREFIX = 'migration-backups/new-schedule-runtime-v2/';
export const NEW_SCHEDULE_RUNTIME_BACKUP_RETENTION_DAYS = 30;

const RETENTION_MS = NEW_SCHEDULE_RUNTIME_BACKUP_RETENTION_DAYS * 24 * 60 * 60 * 1000;

interface BackupObjectMetadata {
  customTime?: string;
  timeCreated?: string;
  metadata?: Record<string, string | undefined>;
}

interface BackupFile {
  name: string;
  getMetadata(): Promise<[BackupObjectMetadata, ...unknown[]]>;
  delete(options?: { ignoreNotFound?: boolean }): Promise<unknown>;
}

interface BackupBucket {
  getFiles(options: { prefix: string }): Promise<[BackupFile[], ...unknown[]]>;
}

export interface RuntimeBackupCleanupResult {
  scanned: number;
  deleted: number;
  retained: number;
  failed: number;
}

const parseTimestamp = (value: string | undefined): number | null => {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
};

export const shouldDeleteRuntimeMigrationBackup = (
  metadata: BackupObjectMetadata,
  now = new Date(),
): boolean => {
  const explicitDeleteAfter = parseTimestamp(metadata.metadata?.deleteAfter);
  if (explicitDeleteAfter !== null) {
    return explicitDeleteAfter <= now.getTime();
  }

  const createdAt = parseTimestamp(metadata.customTime) ?? parseTimestamp(metadata.timeCreated);
  return createdAt !== null && createdAt + RETENTION_MS <= now.getTime();
};

export const cleanupExpiredRuntimeMigrationBackups = async (
  bucket: BackupBucket,
  now = new Date(),
): Promise<RuntimeBackupCleanupResult> => {
  const result: RuntimeBackupCleanupResult = {
    scanned: 0,
    deleted: 0,
    retained: 0,
    failed: 0,
  };
  const [files] = await bucket.getFiles({ prefix: NEW_SCHEDULE_RUNTIME_BACKUP_PREFIX });

  for (const file of files) {
    if (!file.name.startsWith(NEW_SCHEDULE_RUNTIME_BACKUP_PREFIX)) {
      result.retained += 1;
      continue;
    }

    result.scanned += 1;
    try {
      const [metadata] = await file.getMetadata();
      if (!shouldDeleteRuntimeMigrationBackup(metadata, now)) {
        result.retained += 1;
        continue;
      }

      await file.delete({ ignoreNotFound: true });
      result.deleted += 1;
    } catch (error) {
      result.failed += 1;
      console.error(
        `Failed to clean runtime migration backup ${file.name}:`,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  return result;
};

export const cleanupNewScheduleRuntimeMigrationBackups = onSchedule(
  {
    schedule: 'every day 03:30',
    timeZone: 'America/Toronto',
    region: 'us-central1',
    timeoutSeconds: 300,
    retryCount: 3,
  },
  async () => {
    const result = await cleanupExpiredRuntimeMigrationBackups(
      getStorage().bucket() as unknown as BackupBucket,
    );
    console.info('New Schedule runtime migration backup cleanup complete', result);
    if (result.failed > 0) {
      throw new Error(`Failed to delete ${result.failed} expired runtime migration backup(s).`);
    }
  },
);
