import { describe, expect, it } from 'vitest';
import { canEnterGuidedStep, GUIDED_STEPS, resolveGuidedStep } from '../components/GuidedSchedule/guidedSteps';

describe('guided step gate', () => {
    it('names the five guided steps in order', () => {
        expect(GUIDED_STEPS.map(step => step.label)).toEqual([
            'Select data',
            'Review time bands',
            'Set the stage',
            'Build the schedule',
            'Package',
        ]);
    });

    it('keeps the planner on Step 1 until a review exists', () => {
        const gate = { hasReview: false, approvalState: 'unapproved' as const };
        expect(resolveGuidedStep(2, gate)).toBe(1);
        expect(resolveGuidedStep(3, gate)).toBe(1);
        expect(canEnterGuidedStep(1, gate)).toBe(true);
    });

    it('requires a current approval before leaving Step 2', () => {
        expect(resolveGuidedStep(3, { hasReview: true, approvalState: 'unapproved' })).toBe(2);
        expect(resolveGuidedStep(3, { hasReview: true, approvalState: 'stale' })).toBe(2);
        expect(resolveGuidedStep(2, { hasReview: true, approvalState: 'unapproved' })).toBe(2);
    });

    it('opens Set the stage and Build once approved, and Package only with current schedules', () => {
        const gate = { hasReview: true, approvalState: 'approved' as const };
        expect(GUIDED_STEPS.every(step => step.available)).toBe(true);
        expect(resolveGuidedStep(3, gate)).toBe(3);
        expect(resolveGuidedStep(4, gate)).toBe(4);
        expect(resolveGuidedStep(5, gate)).toBe(4);
        expect(canEnterGuidedStep(5, { ...gate, hasCurrentSchedules: true })).toBe(true);
        expect(resolveGuidedStep(5, { hasReview: true, approvalState: 'stale', hasCurrentSchedules: true })).toBe(2);
    });
});
