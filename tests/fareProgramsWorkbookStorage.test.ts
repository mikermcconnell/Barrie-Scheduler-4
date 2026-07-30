import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import {
    loadFareProgramsWorkbook,
    removeFareProgramsWorkbook,
    saveFareProgramsWorkbook,
} from '../utils/fare-programs/fareProgramsWorkbookStorage';

describe('Fare Programs workbook storage', () => {
    it('saves, restores, replaces, and removes the device-local workbook', async () => {
        const indexedDb = new IDBFactory();
        const first = new File(['first workbook'], 'first.xlsx', {
            type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            lastModified: 100,
        });
        const replacement = new File(['replacement workbook'], 'replacement.xlsx', {
            type: first.type,
            lastModified: 200,
        });

        expect(await saveFareProgramsWorkbook(first, indexedDb)).toBe(true);
        const restoredFirst = await loadFareProgramsWorkbook(indexedDb);
        expect(restoredFirst?.name).toBe('first.xlsx');
        expect(restoredFirst?.lastModified).toBe(100);

        expect(await saveFareProgramsWorkbook(replacement, indexedDb)).toBe(true);
        const restoredReplacement = await loadFareProgramsWorkbook(indexedDb);
        expect(restoredReplacement?.name).toBe('replacement.xlsx');
        expect(restoredReplacement?.lastModified).toBe(200);

        expect(await removeFareProgramsWorkbook(indexedDb)).toBe(true);
        expect(await loadFareProgramsWorkbook(indexedDb)).toBeNull();
    });

    it('falls back cleanly when IndexedDB is unavailable', async () => {
        expect(await loadFareProgramsWorkbook(undefined)).toBeNull();
    });
});
