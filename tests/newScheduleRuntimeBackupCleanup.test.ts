import { describe, expect, it, vi } from 'vitest';
import {
    cleanupExpiredRuntimeMigrationBackups,
    NEW_SCHEDULE_RUNTIME_BACKUP_PREFIX,
    shouldDeleteRuntimeMigrationBackup,
} from '../functions/src/newScheduleRuntimeBackupCleanup';

describe('New Schedule runtime migration backup cleanup', () => {
    const now = new Date('2026-07-29T12:00:00.000Z');

    it('deletes only backups whose 30-day retention has expired', () => {
        expect(shouldDeleteRuntimeMigrationBackup({
            metadata: { deleteAfter: '2026-07-29T11:59:59.000Z' },
        }, now)).toBe(true);
        expect(shouldDeleteRuntimeMigrationBackup({
            metadata: { deleteAfter: '2026-07-29T12:00:01.000Z' },
        }, now)).toBe(false);
        expect(shouldDeleteRuntimeMigrationBackup({
            customTime: '2026-06-29T12:00:00.000Z',
        }, now)).toBe(true);
        expect(shouldDeleteRuntimeMigrationBackup({
            customTime: '2026-06-30T12:00:00.000Z',
        }, now)).toBe(false);
        expect(shouldDeleteRuntimeMigrationBackup({}, now)).toBe(false);
    });

    it('keeps current and unknown-age files and reports individual delete failures', async () => {
        const expiredDelete = vi.fn().mockResolvedValue(undefined);
        const currentDelete = vi.fn().mockResolvedValue(undefined);
        const failedDelete = vi.fn().mockRejectedValue(new Error('delete failed'));
        const bucket = {
            getFiles: vi.fn().mockResolvedValue([[
                {
                    name: `${NEW_SCHEDULE_RUNTIME_BACKUP_PREFIX}expired.json`,
                    getMetadata: async () => [{ metadata: { deleteAfter: '2026-07-01T00:00:00.000Z' } }],
                    delete: expiredDelete,
                },
                {
                    name: `${NEW_SCHEDULE_RUNTIME_BACKUP_PREFIX}current.json`,
                    getMetadata: async () => [{ customTime: '2026-07-20T00:00:00.000Z' }],
                    delete: currentDelete,
                },
                {
                    name: `${NEW_SCHEDULE_RUNTIME_BACKUP_PREFIX}failed.json`,
                    getMetadata: async () => [{ customTime: '2026-06-01T00:00:00.000Z' }],
                    delete: failedDelete,
                },
            ]]),
        };

        const result = await cleanupExpiredRuntimeMigrationBackups(bucket, now);

        expect(result).toEqual({ scanned: 3, deleted: 1, retained: 1, failed: 1 });
        expect(expiredDelete).toHaveBeenCalledWith({ ignoreNotFound: true });
        expect(currentDelete).not.toHaveBeenCalled();
    });
});
