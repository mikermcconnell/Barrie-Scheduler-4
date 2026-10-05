import type { MasterRouteTable } from '../../../utils/parsers/masterScheduleParser';

export interface WizardPersistenceOverrides {
    generatedSchedules?: MasterRouteTable[];
    originalGeneratedSchedules?: MasterRouteTable[];
    hasStep3Payload?: boolean;
}

export const resolveWizardPersistenceStep = (
    step: 1 | 2 | 3 | 4 | 5,
    overrides?: WizardPersistenceOverrides
): 1 | 2 | 3 | 4 | 5 => {
    const hasStep4Payload =
        overrides?.generatedSchedules !== undefined ||
        overrides?.originalGeneratedSchedules !== undefined;

    if (hasStep4Payload && step < 4) {
        return 4;
    }

    if (overrides?.hasStep3Payload && step < 3) {
        return 3;
    }

    return step;
};
