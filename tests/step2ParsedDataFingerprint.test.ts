import { describe, expect, it } from 'vitest';
import { buildStep2ParsedDataFingerprint } from '../components/NewSchedule/utils/step2ParsedDataFingerprint';

describe('step2ParsedDataFingerprint', () => {
    it('creates a stable fingerprint from the parsed runtime input shape', () => {
        const fingerprint = buildStep2ParsedDataFingerprint([
            {
                fileName: ' north.csv ',
                allTimeBuckets: [' 06:00 - 06:29 ', ' 06:30 - 06:59 '],
                detectedRouteNumber: ' 7 ',
                detectedDirection: ' North ',
                sampleCountMode: 'days',
                troubleshootingPatternStatus: 'anchored',
                segments: [
                    { segmentName: ' A to B ', timeBuckets: { '06:00 - 06:29': { p50: 5, p80: 6, n: 2 } } },
                    { segmentName: ' B to C ', timeBuckets: { '06:30 - 06:59': { p50: 7, p80: 8, n: 2 } } },
                ],
            },
        ] as any);

        expect(fingerprint).toContain('step2-parsed-data:v1:');
        expect(fingerprint).toContain('"detectedRouteNumber":"7"');
        expect(fingerprint).toContain('"detectedDirection":"North"');
        expect(fingerprint).toContain('"segmentName":"A to B"');
        expect(fingerprint).toContain('"bucket":"06:00 - 06:29"');
        expect(fingerprint).not.toContain('north.csv');
    });

    it('ignores upload file names when the parsed runtime shape is otherwise the same', () => {
        const baseRuntime = {
            allTimeBuckets: ['06:00 - 06:29', '06:30 - 06:59'],
            detectedRouteNumber: '7',
            detectedDirection: 'North',
            sampleCountMode: 'days',
            troubleshootingPatternStatus: 'anchored',
            segments: [
                { segmentName: 'A to B', timeBuckets: { '06:00 - 06:29': { p50: 5, p80: 6, n: 2 } } },
                { segmentName: 'B to C', timeBuckets: { '06:30 - 06:59': { p50: 7, p80: 8, n: 2 } } },
            ],
        };

        const firstFingerprint = buildStep2ParsedDataFingerprint([
            {
                ...baseRuntime,
                fileName: 'north.csv',
            },
        ] as any);

        const renamedFingerprint = buildStep2ParsedDataFingerprint([
            {
                ...baseRuntime,
                fileName: 'renamed-upload.csv',
            },
        ] as any);

        expect(firstFingerprint).toBe(renamedFingerprint);
    });

    it('changes when the parsed runtime values change materially', () => {
        const baseRuntime = {
            allTimeBuckets: ['06:00 - 06:29'],
            detectedRouteNumber: '7',
            detectedDirection: 'North',
            sampleCountMode: 'days',
            troubleshootingPatternStatus: 'anchored',
            segments: [
                {
                    segmentName: 'A to B',
                    timeBuckets: {
                        '06:00 - 06:29': { p50: 5, p80: 6, n: 2 },
                    },
                },
            ],
        };

        const firstFingerprint = buildStep2ParsedDataFingerprint([baseRuntime] as any);
        const changedFingerprint = buildStep2ParsedDataFingerprint([
            {
                ...baseRuntime,
                segments: [
                    {
                        segmentName: 'A to B',
                        timeBuckets: {
                            '06:00 - 06:29': { p50: 50, p80: 60, n: 8 },
                        },
                    },
                ],
            },
        ] as any);

        expect(firstFingerprint).not.toBe(changedFingerprint);
    });
});
