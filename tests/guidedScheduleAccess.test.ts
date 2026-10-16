import { describe, expect, it } from 'vitest';
import { canAccessGuidedSchedule } from '../components/GuidedSchedule/guidedScheduleAccess';

describe('guided schedule access', () => {
    it('shows the workspace to the primary developer while the flag is off', () => {
        expect(canAccessGuidedSchedule({ flagEnabled: false, isGlobalAdmin: true, email: 'Mike.McConnell@barrie.ca ' })).toBe(true);
    });

    it('hides it from other scheduler admins and ordinary users while the flag is off', () => {
        expect(canAccessGuidedSchedule({ flagEnabled: false, isGlobalAdmin: true, email: 'codex.test@barrie.ca' })).toBe(false);
        expect(canAccessGuidedSchedule({ flagEnabled: false, isGlobalAdmin: false, email: 'mike.mcconnell@barrie.ca' })).toBe(false);
        expect(canAccessGuidedSchedule({ flagEnabled: false, isGlobalAdmin: false, email: undefined })).toBe(false);
    });

    it('shows it to everyone once the flag is turned on', () => {
        expect(canAccessGuidedSchedule({ flagEnabled: true, isGlobalAdmin: false, email: 'planner@barrie.ca' })).toBe(true);
    });
});
