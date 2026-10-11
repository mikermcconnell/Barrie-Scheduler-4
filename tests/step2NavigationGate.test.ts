import { describe, expect, it } from 'vitest';
import {
    getBlockedStep2FallbackStep,
    isStep2NavigationBlocked,
    resolveWizardStepWithStep2Gate,
} from '../components/NewSchedule/utils/step2NavigationGate';

describe('step2NavigationGate', () => {
    it('keeps fallback helper behavior for callers that explicitly need it', () => {
        expect(getBlockedStep2FallbackStep(false)).toBe(1);
        expect(getBlockedStep2FallbackStep(true)).toBe(2);
    });

    it('gates later wizard steps until the v2 runtime approval is current', () => {
        expect(resolveWizardStepWithStep2Gate({
            requestedStep: 2,
            approvalState: 'unapproved',
            hasReviewResult: false,
        })).toBe(2);

        expect(resolveWizardStepWithStep2Gate({
            requestedStep: 4,
            approvalState: 'stale',
            hasReviewResult: true,
        })).toBe(2);
    });

    it('reports unapproved navigation as blocked', () => {
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

    it('returns to build when generated output does not match the current inputs', () => {
        expect(resolveWizardStepWithStep2Gate({
            requestedStep: 5,
            approvalState: 'approved',
            hasReviewResult: true,
            hasCurrentGeneratedOutput: false,
        })).toBe(3);

        expect(resolveWizardStepWithStep2Gate({
            requestedStep: 5,
            approvalState: 'approved',
            hasReviewResult: true,
            hasCurrentGeneratedOutput: true,
        })).toBe(5);
    });
});
