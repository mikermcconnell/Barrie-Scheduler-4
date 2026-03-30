import { describe, expect, it } from 'vitest';
import { areStep2ReviewFingerprintsEqual, buildStep2ReviewFingerprint } from '../components/NewSchedule/utils/step2ReviewFingerprint';
import type { Step2ReviewInput } from '../components/NewSchedule/utils/step2ReviewTypes';

const baseInput: Step2ReviewInput = {
    routeIdentity: ' 400-Weekday ',
    routeNumber: ' 400 ',
    dayType: 'Weekday',
    importMode: 'performance',
    performanceConfig: {
        routeId: ' 400 ',
        dateRange: {
            start: ' 2026-03-01 ',
            end: ' 2026-03-07 ',
        },
    },
    performanceDiagnostics: {
        routeId: ' 400 ',
        dateRange: {
            start: ' 2026-03-01 ',
            end: ' 2026-03-07 ',
        },
        runtimeLogicVersion: 7,
        importedAt: ' 2026-03-27T12:00:00.000Z ',
    },
    parsedDataFingerprint: '  runtime-data-v1  ',
    canonicalDirectionStops: {
        North: [' Park Place ', ' Downtown '],
        South: [' Downtown ', ' Park Place '],
    },
    canonicalRouteSource: {
        type: 'master',
        routeIdentity: ' 400-Weekday ',
        versionHint: ' v1 ',
    },
    plannerOverrides: {
        excludedBuckets: [' 07:00 - 07:29 ', '06:30 - 06:59', '07:00 - 07:29'],
    },
};

describe('step2ReviewFingerprint', () => {
    it('normalizes route scope, bucket exclusions, and source metadata into a stable fingerprint', () => {
        const fingerprint = buildStep2ReviewFingerprint(baseInput);
        const reordered = buildStep2ReviewFingerprint({
            ...baseInput,
            plannerOverrides: {
                excludedBuckets: ['07:00 - 07:29', ' 06:30 - 06:59 '],
            },
        });

        expect(fingerprint).toBe(reordered);
        expect(fingerprint).toContain('step2-review:v1:');
        expect(fingerprint).toContain('"excludedBuckets":["06:30 - 06:59","07:00 - 07:29"]');
        expect(fingerprint).toContain('"runtimeLogicVersion":7');
        expect(fingerprint).toContain('"parsedDataFingerprint":"runtime-data-v1"');
    });

    it('changes when the approved planning chain changes', () => {
        const original = buildStep2ReviewFingerprint(baseInput);
        const changed = buildStep2ReviewFingerprint({
            ...baseInput,
            canonicalDirectionStops: {
                ...baseInput.canonicalDirectionStops,
                North: [' Downtown ', ' Park Place '],
            },
        });

        expect(original).not.toBe(changed);
        expect(areStep2ReviewFingerprintsEqual(baseInput, {
            ...baseInput,
            parsedDataFingerprint: 'runtime-data-v2',
        })).toBe(false);
    });
});

