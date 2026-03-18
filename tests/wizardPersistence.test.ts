import { describe, expect, it } from 'vitest';
import { resolveWizardPersistenceStep } from '../components/NewSchedule/utils/wizardPersistence';

describe('resolveWizardPersistenceStep', () => {
    it('keeps the current step when no Step 4 payload is provided', () => {
        expect(resolveWizardPersistenceStep(3)).toBe(3);
        expect(resolveWizardPersistenceStep(4)).toBe(4);
    });

    it('promotes persistence to Step 4 when generated schedules are provided during Step 3', () => {
        expect(resolveWizardPersistenceStep(3, { generatedSchedules: [] })).toBe(4);
        expect(resolveWizardPersistenceStep(3, { originalGeneratedSchedules: [] })).toBe(4);
    });

    it('does not move backward when already at Step 4', () => {
        expect(resolveWizardPersistenceStep(4, { generatedSchedules: [] })).toBe(4);
    });
});
