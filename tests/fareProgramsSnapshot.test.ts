import { describe, expect, it } from 'vitest';
import {
    FARE_PROGRAMS_SNAPSHOT,
    getFareProgramOriginUses,
    getMonthlyServiceMirroringUses,
    getSchoolLinkedUses,
    getSourcePassUses,
} from '../utils/fare-programs/fareProgramsSnapshot';

describe('Fare Programs snapshot', () => {
    it('reconciles the Service Mirroring pass types and monthly totals', () => {
        const passTotal = FARE_PROGRAMS_SNAPSHOT.serviceMirroring.passTypes.reduce((sum, pass) => sum + pass.uses, 0);

        expect(passTotal).toBe(2_059);
        expect(getMonthlyServiceMirroringUses()).toBe(2_059);
        expect(FARE_PROGRAMS_SNAPSHOT.serviceMirroring.excludedReviewPasses).toEqual([
            expect.objectContaining({ label: 'Innisdale Student Pass', uses: 1 }),
        ]);
    });

    it('keeps school-linked and unattributed uses mutually reconcilable', () => {
        expect(getSchoolLinkedUses()).toBe(243);
        expect(
            getSchoolLinkedUses()
            + FARE_PROGRAMS_SNAPSHOT.serviceMirroring.ambiguousSchoolUses
            + FARE_PROGRAMS_SNAPSHOT.serviceMirroring.unattributedUses,
        ).toBe(2_059);
        expect(FARE_PROGRAMS_SNAPSHOT.serviceMirroring.usableEndLocations).toBe(400);
    });

    it('exposes source fare counts that reconcile to every workbook transaction', () => {
        expect(FARE_PROGRAMS_SNAPSHOT.sourcePassCounts).toHaveLength(14);
        expect(getSourcePassUses()).toBe(FARE_PROGRAMS_SNAPSHOT.sourceRows);
        expect(FARE_PROGRAMS_SNAPSHOT.sourcePassCounts).toEqual(expect.arrayContaining([
            { label: 'High School Student Pass 25/26', uses: 2_059 },
            { label: 'Innisdale Student Pass', uses: 1 },
        ]));
    });

    it('publishes privacy-safe starting-area groups with weekday and time filters', () => {
        const originUsage = FARE_PROGRAMS_SNAPSHOT.serviceMirroring.originUsage;
        expect(originUsage.minimumGroupUses).toBe(3);
        expect(originUsage.usableStartUses).toBe(1_663);
        expect(originUsage.displayedUses).toBe(1_475);
        expect(originUsage.suppressedUses).toBe(188);
        expect(originUsage.origins).toHaveLength(103);
        expect(originUsage.origins.every(origin => !/\b(?:unit|apt|apartment|suite)\b|#\s*\d|[A-Z]\d[A-Z]\s*\d[A-Z]\d/i.test(origin.label))).toBe(true);
        expect(originUsage.origins.reduce((sum, origin) => sum + getFareProgramOriginUses(origin), 0)).toBe(1_475);
    });
});
