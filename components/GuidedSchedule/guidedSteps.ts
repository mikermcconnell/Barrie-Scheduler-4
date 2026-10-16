import type { Step2ApprovalState } from '../NewSchedule/utils/step2ReviewTypes';

export type GuidedStep = 1 | 2 | 3 | 4 | 5;

export interface GuidedStepDefinition {
    step: GuidedStep;
    label: string;
    shortLabel: string;
    /** Steps not yet delivered in the guided workspace are shown but cannot be entered. */
    available: boolean;
}

export const GUIDED_STEPS: GuidedStepDefinition[] = [
    { step: 1, label: 'Select data', shortLabel: 'Data', available: true },
    { step: 2, label: 'Review time bands', shortLabel: 'Bands', available: true },
    { step: 3, label: 'Set the stage', shortLabel: 'Stage', available: false },
    { step: 4, label: 'Build the schedule', shortLabel: 'Build', available: false },
    { step: 5, label: 'Package', shortLabel: 'Package', available: false },
];

export interface GuidedGateState {
    hasReview: boolean;
    approvalState: Step2ApprovalState;
}

/**
 * Returns the step the planner may enter. Step 2 needs a computed review;
 * Step 3 and later need a current (not stale) approved runtime contract.
 * Requests for unavailable steps fall back to the furthest allowed step.
 */
export const resolveGuidedStep = (requested: GuidedStep, gate: GuidedGateState): GuidedStep => {
    const definition = GUIDED_STEPS.find(entry => entry.step === requested);
    if (requested === 1) return 1;
    if (!gate.hasReview) return 1;
    if (requested === 2) return 2;
    if (gate.approvalState !== 'approved') return 2;
    if (!definition?.available) return 2;
    return requested;
};

export const canEnterGuidedStep = (step: GuidedStep, gate: GuidedGateState): boolean => (
    resolveGuidedStep(step, gate) === step
);
