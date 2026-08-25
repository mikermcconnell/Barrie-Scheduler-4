import type { ScheduleConfig } from '../steps/Step3Build';

export interface GeneratedScheduleLineageInput {
    approvedRuntimeFingerprint: string;
    dayType: 'Weekday' | 'Saturday' | 'Sunday';
    autofillFromMaster: boolean;
    config: ScheduleConfig;
}

const normalizeConfig = (config: ScheduleConfig) => ({
    routeNumber: config.routeNumber.trim(),
    cycleMode: config.cycleMode ?? 'Strict',
    cycleTime: config.cycleTime,
    recoveryRatio: config.recoveryRatio ?? null,
    recoveryDistribution: config.recoveryDistribution ?? null,
    blocks: config.blocks.map(block => ({
        id: block.id.trim(),
        startTime: block.startTime,
        endTime: block.endTime,
        startStop: block.startStop?.trim() || null,
        endStop: block.endStop?.trim() || null,
        startDirection: block.startDirection ?? null,
    })),
    bandRecoveryDefaults: [...(config.bandRecoveryDefaults ?? [])]
        .map(band => ({
            bandId: band.bandId.trim(),
            avgCycleTime: band.avgCycleTime,
            avgRecoveryRatio: band.avgRecoveryRatio,
            tripCount: band.tripCount,
        }))
        .sort((left, right) => left.bandId.localeCompare(right.bandId)),
});

/**
 * Binds a generated schedule to the exact approved runtime review and planner
 * configuration that produced it. Edited output remains current; changing an
 * input requires explicit regeneration.
 */
export const buildGeneratedScheduleInputFingerprint = (
    input: GeneratedScheduleLineageInput
): string => `generated-schedule-input:v1:${JSON.stringify({
    approvedRuntimeFingerprint: input.approvedRuntimeFingerprint.trim(),
    dayType: input.dayType,
    autofillFromMaster: input.autofillFromMaster,
    config: normalizeConfig(input.config),
})}`;

