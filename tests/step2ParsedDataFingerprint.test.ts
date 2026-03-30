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
                    { segmentName: ' A to B ', timeBuckets: {} },
                    { segmentName: ' B to C ', timeBuckets: {} },
                ],
            },
        ] as any);

        expect(fingerprint).toContain('step2-parsed-data:v1:');
        expect(fingerprint).toContain('"fileName":"north.csv"');
        expect(fingerprint).toContain('"segments":["A to B","B to C"]');
    });
});

