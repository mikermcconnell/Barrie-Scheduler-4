import { describe, expect, it } from 'vitest';
import {
    MAX_SAVED_FILE_SIZE_BYTES,
    validateSavedFileUpload,
} from '../utils/services/dataService';

describe('File Manager upload validation', () => {
    it('accepts non-empty CSV and Excel files within the limit', () => {
        expect(() => validateSavedFileUpload({ name: 'schedule.csv', size: 128 })).not.toThrow();
        expect(() => validateSavedFileUpload({ name: 'schedule.XLSX', size: MAX_SAVED_FILE_SIZE_BYTES })).not.toThrow();
    });

    it('rejects unsupported, empty, and oversized files', () => {
        expect(() => validateSavedFileUpload({ name: 'notes.pdf', size: 128 })).toThrow(/CSV, XLS, and XLSX/);
        expect(() => validateSavedFileUpload({ name: 'empty.csv', size: 0 })).toThrow(/empty/);
        expect(() => validateSavedFileUpload({
            name: 'large.xlsx',
            size: MAX_SAVED_FILE_SIZE_BYTES + 1,
        })).toThrow(/25 MB/);
    });
});
