import type { MasterRouteTable } from '../../../utils/parsers/masterScheduleParser';

export interface WizardPersistenceOverrides {
    generatedSchedules?: MasterRouteTable[];
    originalGeneratedSchedules?: MasterRouteTable[];
}

export const resolveWizardPersistenceStep = (
    step: 1 | 2 | 3 | 4,
    overrides?: WizardPersistenceOverrides
): 1 | 2 | 3 | 4 => {
    const hasStep4Payload =
        overrides?.generatedSchedules !== undefined ||
        overrides?.originalGeneratedSchedules !== undefined;

    if (hasStep4Payload && step < 4) {
        return 4;
    }

    return step;
};
