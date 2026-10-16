import { isPrimaryDeveloperEmail } from '../../utils/developerPreview';

export interface GuidedScheduleAccessInput {
    /** The `fixedGuidedSchedule` feature flag (off by default). */
    flagEnabled: boolean;
    /** Scheduler-admin custom claim. */
    isGlobalAdmin: boolean;
    email: string | null | undefined;
}

/**
 * While in development the guided workspace is visible to everyone only when
 * the feature flag is on; otherwise only to the primary developer (scheduler
 * admin with the primary developer email), matching the Team Management rule.
 * This hides UI only; data access still goes through the existing rules.
 */
export const canAccessGuidedSchedule = (input: GuidedScheduleAccessInput): boolean => (
    input.flagEnabled || (input.isGlobalAdmin && isPrimaryDeveloperEmail(input.email))
);
