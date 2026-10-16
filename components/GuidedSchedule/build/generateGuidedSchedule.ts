import {
    generateSchedule,
    InvalidScheduleGenerationConfigError,
    MissingApprovedRuntimeError,
    validateScheduleGenerationConfig,
} from '../../../utils/schedule/scheduleGenerator';
import { copyNearestMasterRecoveryToGenerated } from '../../../utils/schedule/masterRecoveryTransfer';
import { computeSuggestedStrictCycle } from '../../../utils/schedule/strictCycleSuggestion';
import type { MasterRouteTable } from '../../../utils/parsers/masterScheduleParser';
import type { RuntimeData } from '../../NewSchedule/utils/csvParser';
import { buildSegmentsMapFromParsedData } from '../../NewSchedule/utils/wizardState';
import { buildGeneratedScheduleInputFingerprint } from '../../NewSchedule/utils/generatedScheduleLineage';
import type { ApprovedRuntimeContract } from '../../NewSchedule/utils/step2ReviewTypes';
import type { ScheduleConfig } from '../../NewSchedule/steps/Step3Build';

export interface GuidedGenerateInput {
    contract: ApprovedRuntimeContract;
    config: ScheduleConfig;
    parsedData: RuntimeData[];
    fallbackCanonicalStops?: Partial<Record<'North' | 'South' | 'Loop', string[]>>;
    autofillFromMaster: boolean;
    gtfsStopLookup?: Record<string, string>;
    masterStopCodes?: Record<string, string>;
    /** Master tables to copy recovery from when autofill is on. */
    loadMasterTables?: () => Promise<MasterRouteTable[] | null>;
}

export type GuidedGenerateResult =
    | {
        ok: true;
        tables: MasterRouteTable[];
        config: ScheduleConfig;
        fingerprint: string;
        notices: string[];
    }
    | { ok: false; title: string; message: string };

/** Non-blocking strict-cycle guidance, same thresholds as the legacy wizard. */
export const describeStrictCycleCheck = (contract: ApprovedRuntimeContract, config: ScheduleConfig): string | null => {
    if (config.cycleMode === 'Floating' || config.cycleTime <= 0) return null;
    const suggestion = computeSuggestedStrictCycle(contract.planning.approvedBuckets, contract.planning.bands);
    if (!suggestion.minutes) return null;
    const deltaPct = Math.round(((config.cycleTime - suggestion.minutes) / suggestion.minutes) * 100);
    if (Math.abs(deltaPct) < 20) return null;
    const reference = suggestion.quality === 'high' ? 'observed cycle reference' : `${suggestion.basisLabel} reference`;
    return `Cycle ${config.cycleTime} min vs ${reference} ~${suggestion.minutes} min (${deltaPct > 0 ? '+' : ''}${deltaPct}%).`;
};

/** Runtime rows used for generation: North-start cycles first, then South-start, then all; sorted by direction. */
export const selectGenerationSegments = (parsedData: RuntimeData[]) => {
    const north = parsedData.filter(row => row.cycleStartDirection === 'North');
    const south = parsedData.filter(row => row.cycleStartDirection === 'South');
    const source = north.length > 0 ? north : south.length > 0 ? south : parsedData;
    const order: Record<string, number> = { North: 0, A: 1, Loop: 2, South: 3, B: 4 };
    const sorted = [...source].sort((a, b) => (
        (a.detectedDirection ? order[a.detectedDirection] ?? 2 : 2) - (b.detectedDirection ? order[b.detectedDirection] ?? 2 : 2)
    ));
    return buildSegmentsMapFromParsedData(sorted);
};

/** Keep block start/end stops and direction in line with the generated trips. */
export const syncBlocksWithTables = (config: ScheduleConfig, tables: MasterRouteTable[]): ScheduleConfig => {
    const toOp = (minutes: number) => (minutes < 240 ? minutes + 1440 : minutes);
    const first = new Map<string, { startTime: number; stops: Record<string, string>; direction: string }>();
    const last = new Map<string, { endTime: number; stops: Record<string, string> }>();
    for (const table of tables) {
        for (const trip of table.trips) {
            const existing = first.get(trip.blockId);
            if (!existing || toOp(trip.startTime) < toOp(existing.startTime)) {
                first.set(trip.blockId, { startTime: trip.startTime, stops: trip.stops, direction: trip.direction });
            }
            const existingLast = last.get(trip.blockId);
            if (!existingLast || toOp(trip.endTime) > toOp(existingLast.endTime)) {
                last.set(trip.blockId, { endTime: trip.endTime, stops: trip.stops });
            }
        }
    }
    return {
        ...config,
        blocks: config.blocks.map(block => {
            const firstTrip = first.get(block.id);
            if (!firstTrip) return block;
            const lastStops = Object.keys(last.get(block.id)?.stops ?? {});
            return {
                ...block,
                startStop: block.startStop || Object.keys(firstTrip.stops)[0],
                endStop: lastStops[lastStops.length - 1] || block.endStop,
                startDirection: firstTrip.direction === 'North' || firstTrip.direction === 'South' ? firstTrip.direction : block.startDirection,
            };
        }),
    };
};

/**
 * Generates one day type's schedule from its approved runtime contract. This
 * mirrors the legacy wizard's generate step: the generator runs in strict
 * approved-runtime mode and is not changed.
 */
export const generateGuidedSchedule = async (input: GuidedGenerateInput): Promise<GuidedGenerateResult> => {
    const { contract, config, parsedData } = input;
    if (parsedData.length === 0) return { ok: false, title: 'No Data', message: 'No runtime rows. Re-analyze in Step 1.' };
    const planning = contract.planning;
    const issues = validateScheduleGenerationConfig(config);
    if (issues.length > 0) return { ok: false, title: 'Invalid Schedule Settings', message: issues[0].message };
    if (!planning.directionBandSummary) {
        return { ok: false, title: 'Runtime Model Missing', message: 'The approved direction summary is unavailable. Re-approve Step 2.' };
    }

    const segmentsMap = selectGenerationSegments(parsedData);
    let tables: MasterRouteTable[];
    try {
        tables = generateSchedule(
            config,
            planning.approvedBuckets,
            planning.bands,
            planning.directionBandSummary,
            segmentsMap,
            contract.dayType,
            input.gtfsStopLookup,
            input.masterStopCodes,
            planning.canonicalDirectionStops ?? input.fallbackCanonicalStops,
            planning.approvedCycleBucketsByStartDirection,
            {
                strictApprovedRuntime: true,
                approvedBucketMode: contract.importMode === 'performance' ? 'paired-cycle-start' : 'trip-start',
            }
        );
    } catch (error) {
        if (error instanceof MissingApprovedRuntimeError) {
            return {
                ok: false,
                title: 'Trusted Runtime Missing',
                message: `${error.direction} ${error.timeBucket} is missing trusted data for ${error.segmentName}. Return to Step 2 or change the service span.`,
            };
        }
        if (error instanceof InvalidScheduleGenerationConfigError) {
            return { ok: false, title: 'Invalid Schedule Settings', message: error.issues[0]?.message || error.message };
        }
        console.error(error);
        return { ok: false, title: 'Generation Failed', message: 'Could not generate the schedule. Check the cycle time and blocks.' };
    }
    if (tables.length === 0) {
        return { ok: false, title: 'Generation Failed', message: 'Could not generate the schedule. Check the cycle time and blocks.' };
    }

    const notices: string[] = [];
    if (input.autofillFromMaster && input.loadMasterTables) {
        try {
            const masterTables = await input.loadMasterTables();
            if (masterTables && masterTables.length > 0) {
                const recovery = copyNearestMasterRecoveryToGenerated(tables, masterTables);
                tables = recovery.tables;
                if (recovery.appliedCount > 0) {
                    notices.push(`Copied recovery from the nearest master trip for ${recovery.appliedCount} trip${recovery.appliedCount === 1 ? '' : 's'}.`);
                }
            }
        } catch (error) {
            console.warn('Could not copy recovery times from master schedule', error);
            notices.push('Master recovery times could not be copied.');
        }
    }

    const nextConfig = syncBlocksWithTables(config, tables);
    return {
        ok: true,
        tables,
        config: nextConfig,
        fingerprint: buildGeneratedScheduleInputFingerprint({
            approvedRuntimeFingerprint: contract.inputFingerprint,
            dayType: contract.dayType,
            autofillFromMaster: input.autofillFromMaster,
            config: nextConfig,
        }),
        notices,
    };
};
