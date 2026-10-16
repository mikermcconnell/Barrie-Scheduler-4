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

    it('does not enter steps that are not delivered yet, even when approved', () => {
        const gate = { hasReview: true, approvalState: 'approved' as const };
        expect(GUIDED_STEPS.find(step => step.step === 3)?.available).toBe(false);
        expect(resolveGuidedStep(3, gate)).toBe(2);
        expect(canEnterGuidedStep(5, gate)).toBe(false);
    });
});
