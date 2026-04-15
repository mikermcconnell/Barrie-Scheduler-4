import { describe, expect, it } from 'vitest';
import {
    getBlockedStep2FallbackStep,
    isStep2NavigationBlocked,
    resolveWizardStepWithStep2Gate,
} from '../components/NewSchedule/utils/step2NavigationGate';

describe('step2NavigationGate', () => {
    it('falls back to Step 1 when Step 2 has no review result yet', () => {
        expect(getBlockedStep2FallbackStep(false)).toBe(1);
        expect(resolveWizardStepWithStep2Gate({
            requestedStep: 3,
            approvalState: 'unapproved',
            hasReviewResult: false,
        })).toBe(1);
    });

    it('falls back to Step 2 when review exists but approval is not current', () => {
        expect(getBlockedStep2FallbackStep(true)).toBe(2);
        expect(resolveWizardStepWithStep2Gate({
            requestedStep: 4,
            approvalState: 'stale',
            hasReviewResult: true,
        })).toBe(2);
    });

    it('allows Step 3 and Step 4 only when approval is current', () => {
        expect(resolveWizardStepWithStep2Gate({
            requestedStep: 2,
            approvalState: 'unapproved',
            hasReviewResult: false,
        })).toBe(2);

        expect(resolveWizardStepWithStep2Gate({
            requestedStep: 4,
            approvalState: 'approved',
            hasReviewResult: true,
        })).toBe(4);
    });

    it('reports whether navigation is currently blocked by Step 2 approval', () => {
        expect(isStep2NavigationBlocked({
            requestedStep: 4,
            approvalState: 'unapproved',
            hasReviewResult: true,
        })).toBe(true);

        expect(isStep2NavigationBlocked({
            requestedStep: 4,
            approvalState: 'approved',
            hasReviewResult: true,
        })).toBe(false);
    });
});
