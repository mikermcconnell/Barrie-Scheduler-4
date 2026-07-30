import { describe, expect, it } from 'vitest';
import {
    FARE_PROGRAMS_SNAPSHOT,
    getMonthlyServiceMirroringUses,
    getSchoolLinkedUses,
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

    it('keeps the supplied Field Trip Pass total separate from workbook-derived geography', () => {
        expect(FARE_PROGRAMS_SNAPSHOT.fieldTripPass.uses).toBe(982);
        expect(FARE_PROGRAMS_SNAPSHOT.fieldTripPass.mappingStatus).toMatch(/no Field Trip Pass transaction rows/i);
    });
});
