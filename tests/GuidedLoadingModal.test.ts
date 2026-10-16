import { describe, expect, it } from 'vitest';
import { describeLoadProgress } from '../components/GuidedSchedule/GuidedLoadingModal';

describe('describeLoadProgress', () => {
    it('describes download and processing progress', () => {
        expect(describeLoadProgress({ phase: 'downloading', completedUnits: 3, totalUnits: 12, unitLabel: 'monthly-file' }))
            .toBe('Downloading 3 of 12 monthly files');
        expect(describeLoadProgress({ phase: 'processing', completedUnits: 1, totalUnits: 1, unitLabel: 'file' }))
            .toBe('Processing 1 of 1 file');
    });

    it('caps completed units and hides empty progress', () => {
        expect(describeLoadProgress({ phase: 'downloading', completedUnits: 9, totalUnits: 4, unitLabel: 'file' }))
            .toBe('Downloading 4 of 4 files');
        expect(describeLoadProgress({ phase: 'downloading', completedUnits: 0, totalUnits: 0, unitLabel: 'file' })).toBeNull();
        expect(describeLoadProgress(null)).toBeNull();
    });
});
