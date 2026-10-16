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
    { step: 3, label: 'Set the stage', shortLabel: 'Stage', available: true },
    { step: 4, label: 'Build the schedule', shortLabel: 'Build', available: true },
    { step: 5, label: 'Package', shortLabel: 'Package', available: true },
];

export interface GuidedGateState {
    hasReview: boolean;
    approvalState: Step2ApprovalState;
    /** Every reviewed day type has a generated schedule that is current with its approval and settings. */
    hasCurrentSchedules?: boolean;
}

/**
 * Returns the step the planner may enter. Step 2 needs a computed review;
 * Step 3 and 4 need a current (not stale) approved runtime contract; Step 5
 * also needs a current generated schedule for every day type. Requests for
 * unavailable steps fall back to the furthest allowed step.
 */
export const resolveGuidedStep = (requested: GuidedStep, gate: GuidedGateState): GuidedStep => {
    const definition = GUIDED_STEPS.find(entry => entry.step === requested);
    if (requested === 1) return 1;
    if (!gate.hasReview) return 1;
    if (requested === 2) return 2;
    if (gate.approvalState !== 'approved') return 2;
    if (!definition?.available) return 2;
    if (requested === 5 && !gate.hasCurrentSchedules) return 4;
    return requested;
};

export const canEnterGuidedStep = (step: GuidedStep, gate: GuidedGateState): boolean => (
    resolveGuidedStep(step, gate) === step
);
