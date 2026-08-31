import { calculateDailyRunMetrics, calculateWeeklyRosterMetrics, expectedDayTypeForRosterDay, getRunTrips } from './metrics';
import { findReliefPoint, getTravelMinutes } from './rules';
import type {
    DailyRun,
    OperationsPlanningInputV1,
    OperationsPlanningProposalV1,
    PlanningTrip,
    ProposalAssessment,
    ValidationFinding,
} from './types';

export class ProposalParseError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'ProposalParseError';
    }
}

export const PROPOSAL_IMPORT_LIMITS = {
    jsonCharacters: 5_000_000,
    stringCharacters: 10_000,
    dailyRuns: 2_000,
    piecesPerRun: 50,
    tripIdsPerPiece: 2_000,
    totalPieces: 10_000,
    totalTripIds: 100_000,
    weeklyRosters: 1_000,
    assignmentsPerRoster: 14,
    blockAudits: 5_000,
    findings: 5_000,
    methodNotes: 1_000,
} as const;

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value);

const requireString = (record: Record<string, unknown>, key: string, context: string): string => {
    const value = record[key];
    if (typeof value !== 'string' || value.trim() === '') throw new ProposalParseError(`${context}.${key} must be a non-empty string.`);
    if (value.length > PROPOSAL_IMPORT_LIMITS.stringCharacters) throw new ProposalParseError(`${context}.${key} is too long.`);
    return value;
};

const requireStringArray = (value: unknown, context: string, maximum: number = PROPOSAL_IMPORT_LIMITS.tripIdsPerPiece): string[] => {
    if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) {
        throw new ProposalParseError(`${context} must be an array of strings.`);
    }
    if (value.length > maximum) throw new ProposalParseError(`${context} exceeds the maximum of ${maximum} items.`);
    if (value.some(item => item.length > PROPOSAL_IMPORT_LIMITS.stringCharacters)) throw new ProposalParseError(`${context} contains an overlong string.`);
    return value;
};

export const parseOperationsPlanningProposal = (value: unknown): OperationsPlanningProposalV1 => {
    if (typeof value === 'string' && value.length > PROPOSAL_IMPORT_LIMITS.jsonCharacters) {
        throw new ProposalParseError(`Proposal JSON exceeds ${PROPOSAL_IMPORT_LIMITS.jsonCharacters} characters.`);
    }
    const parsed = typeof value === 'string' ? (() => {
        try { return JSON.parse(value) as unknown; } catch { throw new ProposalParseError('Proposal is not valid JSON.'); }
    })() : value;
    if (!isRecord(parsed)) throw new ProposalParseError('Proposal must be a JSON object.');
    if (parsed.schemaVersion !== 1) throw new ProposalParseError('Proposal schemaVersion must be 1.');
    if (parsed.kind !== 'operations-planning-proposal') throw new ProposalParseError('Proposal kind must be operations-planning-proposal.');
    requireString(parsed, 'scenarioId', 'proposal');
    requireString(parsed, 'sourceManifestFingerprint', 'proposal');
    if (!isRecord(parsed.codex)) throw new ProposalParseError('proposal.codex must be an object.');
    requireString(parsed.codex, 'generatedAt', 'proposal.codex');
    if (!Array.isArray(parsed.dailyRuns)) throw new ProposalParseError('proposal.dailyRuns must be an array.');
    if (!Array.isArray(parsed.weeklyRosters)) throw new ProposalParseError('proposal.weeklyRosters must be an array.');
    if (!Array.isArray(parsed.blockAudits)) throw new ProposalParseError('proposal.blockAudits must be an array.');
    if (!Array.isArray(parsed.findings)) throw new ProposalParseError('proposal.findings must be an array.');
    if (parsed.dailyRuns.length > PROPOSAL_IMPORT_LIMITS.dailyRuns) throw new ProposalParseError('proposal.dailyRuns exceeds the import limit.');
    if (parsed.weeklyRosters.length > PROPOSAL_IMPORT_LIMITS.weeklyRosters) throw new ProposalParseError('proposal.weeklyRosters exceeds the import limit.');
    if (parsed.blockAudits.length > PROPOSAL_IMPORT_LIMITS.blockAudits) throw new ProposalParseError('proposal.blockAudits exceeds the import limit.');
    if (parsed.findings.length > PROPOSAL_IMPORT_LIMITS.findings) throw new ProposalParseError('proposal.findings exceeds the import limit.');
    requireStringArray(parsed.methodNotes, 'proposal.methodNotes', PROPOSAL_IMPORT_LIMITS.methodNotes);

    parsed.blockAudits.forEach((audit, auditIndex) => {
        const context = `proposal.blockAudits[${auditIndex}]`;
        if (!isRecord(audit)) throw new ProposalParseError(`${context} must be an object.`);
        requireString(audit, 'id', context);
        requireString(audit, 'membershipFingerprint', context);
        requireStringArray(audit.tripIds, `${context}.tripIds`);
    });
    parsed.findings.forEach((item, findingIndex) => {
        const context = `proposal.findings[${findingIndex}]`;
        if (!isRecord(item)) throw new ProposalParseError(`${context} must be an object.`);
        requireString(item, 'code', context);
        requireString(item, 'message', context);
    });

    let totalPieces = 0;
    let totalTripIds = 0;
    parsed.dailyRuns.forEach((run, runIndex) => {
        if (!isRecord(run)) throw new ProposalParseError(`proposal.dailyRuns[${runIndex}] must be an object.`);
        requireString(run, 'id', `proposal.dailyRuns[${runIndex}]`);
        requireString(run, 'runNumber', `proposal.dailyRuns[${runIndex}]`);
        if (!['Weekday', 'Saturday', 'Sunday'].includes(String(run.dayType))) {
            throw new ProposalParseError(`proposal.dailyRuns[${runIndex}].dayType is invalid.`);
        }
        if (!Array.isArray(run.pieces) || run.pieces.length === 0) {
            throw new ProposalParseError(`proposal.dailyRuns[${runIndex}].pieces must be a non-empty array.`);
        }
        if (run.pieces.length > PROPOSAL_IMPORT_LIMITS.piecesPerRun) throw new ProposalParseError(`proposal.dailyRuns[${runIndex}].pieces exceeds the import limit.`);
        totalPieces += run.pieces.length;
        if (totalPieces > PROPOSAL_IMPORT_LIMITS.totalPieces) throw new ProposalParseError('proposal exceeds the total piece import limit.');
        run.pieces.forEach((piece, pieceIndex) => {
            const context = `proposal.dailyRuns[${runIndex}].pieces[${pieceIndex}]`;
            if (!isRecord(piece)) throw new ProposalParseError(`${context} must be an object.`);
            requireString(piece, 'id', context);
            requireString(piece, 'blockId', context);
            requireString(piece, 'routeNumber', context);
            requireString(piece, 'startReliefPoint', context);
            requireString(piece, 'endReliefPoint', context);
            const tripIds = requireStringArray(piece.tripIds, `${context}.tripIds`, PROPOSAL_IMPORT_LIMITS.tripIdsPerPiece);
            totalTripIds += tripIds.length;
            if (totalTripIds > PROPOSAL_IMPORT_LIMITS.totalTripIds) throw new ProposalParseError('proposal exceeds the total trip-reference import limit.');
            if (tripIds.length === 0) {
                throw new ProposalParseError(`${context}.tripIds must not be empty.`);
            }
        });
    });

    parsed.weeklyRosters.forEach((roster, rosterIndex) => {
        const context = `proposal.weeklyRosters[${rosterIndex}]`;
        if (!isRecord(roster)) throw new ProposalParseError(`${context} must be an object.`);
        requireString(roster, 'id', context);
        requireString(roster, 'crewNumber', context);
        if (!Array.isArray(roster.assignments)) throw new ProposalParseError(`${context}.assignments must be an array.`);
        if (roster.assignments.length > PROPOSAL_IMPORT_LIMITS.assignmentsPerRoster) throw new ProposalParseError(`${context}.assignments exceeds the import limit.`);
        roster.assignments.forEach((assignment, assignmentIndex) => {
            if (!isRecord(assignment)) throw new ProposalParseError(`${context}.assignments[${assignmentIndex}] must be an object.`);
            if (!['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].includes(String(assignment.day))) {
                throw new ProposalParseError(`${context}.assignments[${assignmentIndex}].day is invalid.`);
            }
            if (assignment.runId !== null && typeof assignment.runId !== 'string') {
                throw new ProposalParseError(`${context}.assignments[${assignmentIndex}].runId must be a string or null.`);
            }
        });
    });
    return parsed as unknown as OperationsPlanningProposalV1;
};

const finding = (
    findings: ValidationFinding[],
    category: ValidationFinding['category'],
    code: string,
    message: string,
    context: Partial<Pick<ValidationFinding, 'dayType' | 'runId' | 'crewId' | 'blockId' | 'tripId' | 'details'>> = {},
): void => {
    findings.push({
        id: `app:${findings.length}:${code}`,
        category,
        severity: category === 'integrity' || category === 'contractual' ? 'error' : category === 'informational' ? 'info' : 'warning',
        code,
        message,
        ...context,
    });
};

const normalize = (value: string) => value.trim().toLocaleLowerCase();

const validatePiece = (
    input: OperationsPlanningInputV1,
    run: DailyRun,
    piece: DailyRun['pieces'][number],
    tripById: Map<string, PlanningTrip>,
    findings: ValidationFinding[],
): PlanningTrip[] => {
    const trips = piece.tripIds.map(id => tripById.get(id)).filter((trip): trip is PlanningTrip => Boolean(trip));
    piece.tripIds.forEach(id => {
        if (!tripById.has(id)) finding(findings, 'integrity', 'unknown-trip', `Piece ${piece.id} references unknown trip ${id}.`, { runId: run.id, tripId: id });
    });
    if (new Set(piece.tripIds).size !== piece.tripIds.length) {
        finding(findings, 'integrity', 'duplicate-trip-in-piece', `Piece ${piece.id} repeats a trip.`, { runId: run.id });
    }
    if (trips.some(trip => trip.dayType !== run.dayType)) {
        finding(findings, 'integrity', 'piece-day-type-mismatch', `Piece ${piece.id} contains a trip outside ${run.dayType}.`, { runId: run.id, dayType: run.dayType });
    }
    if (trips.some(trip => trip.vehicleBlockKey !== piece.blockId || trip.routeNumber !== piece.routeNumber)) {
        finding(findings, 'integrity', 'piece-block-membership-changed', `Piece ${piece.id} does not preserve its source route/block membership.`, { runId: run.id, blockId: piece.blockId });
    }
    const audit = input.blockAudits.find(candidate =>
        candidate.vehicleBlockKey === piece.blockId,
    );
    let firstPosition = -1;
    let lastPosition = -1;
    if (audit && trips.length > 0) {
        const positions = trips.map(trip => audit.tripIds.indexOf(trip.id));
        firstPosition = positions[0];
        lastPosition = positions.at(-1) ?? -1;
        const contiguous = positions.every((position, index) => position >= 0 && (index === 0 || position === positions[index - 1] + 1));
        if (!contiguous) {
            finding(findings, 'integrity', 'piece-not-contiguous', `Piece ${piece.id} must use a contiguous, source-ordered section of block ${piece.blockId}.`, { runId: run.id, blockId: piece.blockId });
        }
    }
    const first = trips[0];
    const last = trips.at(-1);
    const startRelief = findReliefPoint(input.ruleProfile, piece.startReliefPoint);
    const endRelief = findReliefPoint(input.ruleProfile, piece.endReliefPoint);
    const startMatches = Boolean(first) && (
        normalize(piece.startReliefPoint) === normalize(first.startStop)
        || Boolean(startRelief && (startRelief.aliases.some(alias => normalize(alias) === normalize(first.startStop)) || normalize(startRelief.name) === normalize(first.startStop)))
    );
    const endMatches = Boolean(last) && (
        normalize(piece.endReliefPoint) === normalize(last.endStop)
        || Boolean(endRelief && (endRelief.aliases.some(alias => normalize(alias) === normalize(last.endStop)) || normalize(endRelief.name) === normalize(last.endStop)))
    );
    const startsAtBlockPullOut = firstPosition === 0;
    const endsAtBlockPullIn = Boolean(audit) && lastPosition === audit.tripIds.length - 1;
    if (!first || !startMatches || (!startsAtBlockPullOut && !startRelief)) {
        finding(findings, 'integrity', 'invalid-piece-start-relief', `Piece ${piece.id} does not start at a recognized relief point matching its first trip.`, { runId: run.id, tripId: first?.id });
    }
    if (!last || !endMatches || (!endsAtBlockPullIn && !endRelief)) {
        finding(findings, 'integrity', 'invalid-piece-end-relief', `Piece ${piece.id} does not end at a recognized relief point matching its final trip arrival.`, { runId: run.id, tripId: last?.id });
    }
    if (last?.arrivalTime === null) {
        finding(findings, 'integrity', 'relief-arrival-unresolved', `Piece ${piece.id} relief cannot be placed because final arrival is unresolved.`, { runId: run.id, tripId: last.id });
    }
    return trips;
};

const validateRun = (
    input: OperationsPlanningInputV1,
    run: DailyRun,
    tripById: Map<string, PlanningTrip>,
    findings: ValidationFinding[],
): void => {
    const pieceTrips = run.pieces.map(piece => validatePiece(input, run, piece, tripById, findings));
    const metrics = calculateDailyRunMetrics(input, run);
    const rules = input.ruleProfile;
    pieceTrips.forEach((trips, index) => {
        if (index === 0 || trips.length === 0) return;
        const previous = pieceTrips[index - 1].at(-1);
        const next = trips[0];
        if (!previous || previous.arrivalTime === null) return;
        const gap = next.startTime - previous.arrivalTime;
        if (gap < 0) finding(findings, 'integrity', 'run-piece-overlap', `Run ${run.runNumber} has overlapping pieces.`, { runId: run.id, dayType: run.dayType });
        if (gap >= rules.nonSplitExceptionBreakMinutes.minimum && gap <= rules.nonSplitExceptionBreakMinutes.maximum) {
            finding(findings, 'exception', 'non-split-long-break', `Run ${run.runNumber} has a ${gap}-minute non-split break requiring review.`, { runId: run.id, dayType: run.dayType });
        }
        if (previous.routeNumber === next.routeNumber
            && gap >= rules.sameRouteResetMinimumMinutes
            && gap < rules.standardBreakMinutes.minimum) {
            finding(findings, 'best-practice', 'break-shorter-than-standard', `Run ${run.runNumber} has a ${gap}-minute reset, shorter than the standard ${rules.standardBreakMinutes.minimum}-minute break.`, { runId: run.id, dayType: run.dayType });
        }
        if (gap >= rules.splitThresholdMinutes) {
            const returnMinutes = getTravelMinutes(rules, run.pieces[index - 1].endReliefPoint, rules.garage.name);
            const outboundMinutes = getTravelMinutes(rules, rules.garage.name, run.pieces[index].startReliefPoint);
            if (returnMinutes === null || outboundMinutes === null) {
                finding(findings, 'integrity', 'split-shuttle-time-missing', `Run ${run.runNumber} split cannot be evaluated because a Garage shuttle time is missing.`, { runId: run.id, dayType: run.dayType });
            } else if (returnMinutes + outboundMinutes > gap) {
                finding(findings, 'contractual', 'split-shuttle-infeasible', `Run ${run.runNumber} has only ${gap} minutes for ${returnMinutes + outboundMinutes} minutes of split shuttle travel.`, { runId: run.id, dayType: run.dayType });
            }
        }
        if (previous.routeNumber !== next.routeNumber) {
            const matrix = input.operationsMatrix.entries.find(entry =>
                entry.fromRoute === previous.routeNumber && entry.toRoute === next.routeNumber && entry.dayTypes.includes(run.dayType),
            );
            const interlineRule = rules.interlining.find(rule =>
                rule.routes.includes(previous.routeNumber) && rule.routes.includes(next.routeNumber) && rule.dayTypes.includes(run.dayType),
            );
            const timeAllowed = interlineRule?.startMinute === undefined || next.startTime >= interlineRule.startMinute;
            if (!matrix?.allowed || gap < matrix.minimumTransitionMinutes || !timeAllowed) {
                finding(findings, 'contractual', 'route-transition-not-allowed', `Run ${run.runNumber} transition ${previous.routeNumber} to ${next.routeNumber} is not allowed by the operations matrix.`, { runId: run.id, dayType: run.dayType });
            }
            if (gap < rules.routeChangeResetMinimumMinutes) {
                finding(findings, 'contractual', 'route-change-break-too-short', `Run ${run.runNumber} route-change break is ${gap} minutes; ${rules.routeChangeResetMinimumMinutes} are required.`, { runId: run.id, dayType: run.dayType });
            }
        }
    });

    if (metrics.platformMinutes > rules.maximumDrivingMinutes) finding(findings, 'contractual', 'maximum-driving-exceeded', `Run ${run.runNumber} exceeds ${rules.maximumDrivingMinutes} driving minutes.`, { runId: run.id, dayType: run.dayType });
    if (metrics.paidMinutes > rules.maximumWorkMinutes) finding(findings, 'contractual', 'maximum-work-exceeded', `Run ${run.runNumber} exceeds ${rules.maximumWorkMinutes} work minutes.`, { runId: run.id, dayType: run.dayType });
    if (metrics.spreadMinutes > rules.maximumSpreadMinutes) finding(findings, 'contractual', 'maximum-spread-exceeded', `Run ${run.runNumber} exceeds ${rules.maximumSpreadMinutes} spread minutes.`, { runId: run.id, dayType: run.dayType });
    if (!metrics.isSplit && metrics.platformMinutes > rules.straightDrivingMaximumMinutes) finding(findings, 'contractual', 'straight-driving-exceeded', `Straight run ${run.runNumber} exceeds ${rules.straightDrivingMaximumMinutes} driving minutes.`, { runId: run.id, dayType: run.dayType });
    if (metrics.isSplit) {
        pieceTrips.forEach((trips, index) => {
            const pieceDriving = trips.reduce((sum, trip) => sum + trip.travelTime, 0);
            if (pieceDriving > rules.splitPieceDrivingMaximumMinutes) finding(findings, 'contractual', 'split-piece-driving-exceeded', `Run ${run.runNumber} piece ${index + 1} exceeds ${rules.splitPieceDrivingMaximumMinutes} driving minutes.`, { runId: run.id, dayType: run.dayType });
            if (index === 0 && (pieceDriving < rules.targetBreakAfterMinutes.minimum || pieceDriving > rules.targetBreakAfterMinutes.maximum)) {
                finding(findings, 'best-practice', 'split-break-timing-outside-target', `Run ${run.runNumber} first break follows ${pieceDriving} platform minutes; the target is ${rules.targetBreakAfterMinutes.minimum}-${rules.targetBreakAfterMinutes.maximum}.`, { runId: run.id, dayType: run.dayType });
            }
        });
    }
    if (metrics.paidMinutes < rules.preferredRunMinutes.minimum || metrics.paidMinutes > rules.preferredRunMinutes.maximum) {
        finding(findings, 'best-practice', 'run-length-outside-preference', `Run ${run.runNumber} is outside the preferred 7-to-10-hour range.`, { runId: run.id, dayType: run.dayType });
    }
    const firstPiece = run.pieces[0];
    const lastPiece = run.pieces.at(-1);
    if (firstPiece && getTravelMinutes(rules, rules.garage.name, firstPiece.startReliefPoint) === null) {
        finding(findings, 'integrity', 'pull-out-time-missing', `Run ${run.runNumber} has no Garage-to-${firstPiece.startReliefPoint} travel time.`, { runId: run.id, dayType: run.dayType });
    }
    if (lastPiece && getTravelMinutes(rules, lastPiece.endReliefPoint, rules.garage.name) === null) {
        finding(findings, 'integrity', 'pull-in-time-missing', `Run ${run.runNumber} has no ${lastPiece.endReliefPoint}-to-Garage travel time.`, { runId: run.id, dayType: run.dayType });
    }
};

const validateRosterCoverage = (
    input: OperationsPlanningInputV1,
    proposal: OperationsPlanningProposalV1,
    findings: ValidationFinding[],
): void => {
    const runById = new Map(proposal.dailyRuns.map(run => [run.id, run]));
    const coverage = new Map<string, number>();
    const rosterIds = new Set<string>();
    const crewNumbers = new Set<string>();
    const rosterDays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const;
    proposal.weeklyRosters.forEach(roster => {
        if (rosterIds.has(roster.id)) finding(findings, 'integrity', 'duplicate-roster-id', `Roster id ${roster.id} is duplicated.`, { crewId: roster.id });
        if (crewNumbers.has(roster.crewNumber.toLocaleLowerCase())) finding(findings, 'integrity', 'duplicate-crew-number', `Crew number ${roster.crewNumber} is duplicated.`, { crewId: roster.id });
        if (!/^(?:crew[ _-]?)?\d{1,4}$/i.test(roster.crewNumber.trim())) finding(findings, 'integrity', 'crew-number-not-anonymous', `Crew ${roster.crewNumber} must use an anonymous numeric crew identifier such as Crew 001.`, { crewId: roster.id });
        rosterIds.add(roster.id);
        crewNumbers.add(roster.crewNumber.toLocaleLowerCase());
        const seenDays = new Set<string>();
        roster.assignments.forEach(assignment => {
            if (seenDays.has(assignment.day)) finding(findings, 'integrity', 'duplicate-roster-day', `Crew ${roster.crewNumber} has duplicate ${assignment.day} assignments.`, { crewId: roster.id });
            seenDays.add(assignment.day);
            if (!assignment.runId) return;
            const run = runById.get(assignment.runId);
            if (!run) {
                finding(findings, 'integrity', 'unknown-roster-run', `Crew ${roster.crewNumber} references unknown run ${assignment.runId}.`, { crewId: roster.id });
                return;
            }
            if (run.dayType !== expectedDayTypeForRosterDay(assignment.day)) {
                finding(findings, 'integrity', 'roster-day-type-mismatch', `${assignment.day} cannot use a ${run.dayType} run.`, { crewId: roster.id, runId: run.id });
            }
            const key = `${assignment.day}:${run.id}`;
            coverage.set(key, (coverage.get(key) ?? 0) + 1);
        });
        rosterDays.forEach(day => {
            if (!seenDays.has(day)) finding(findings, 'integrity', 'roster-day-missing', `Crew ${roster.crewNumber} must explicitly assign work or Off for ${day}.`, { crewId: roster.id });
        });
        const metrics = calculateWeeklyRosterMetrics(input, proposal, roster);
        const weekly = input.ruleProfile.weekly;
        if (metrics.paidMinutes < weekly.minimumPaidMinutes) finding(findings, 'contractual', 'weekly-minimum-not-met', `Crew ${roster.crewNumber} has ${metrics.paidMinutes} paid minutes; ${weekly.minimumPaidMinutes} are required.`, { crewId: roster.id });
        if (metrics.platformMinutes > weekly.maximumPlatformMinutes) finding(findings, 'contractual', 'weekly-platform-maximum-exceeded', `Crew ${roster.crewNumber} exceeds the weekly platform maximum.`, { crewId: roster.id });
        if (metrics.combinedMinutes > weekly.maximumCombinedMinutes) finding(findings, 'contractual', 'weekly-combined-maximum-exceeded', `Crew ${roster.crewNumber} exceeds the weekly combined maximum.`, { crewId: roster.id });
        if (metrics.restViolations > 0) finding(findings, 'contractual', 'minimum-rest-violated', `Crew ${roster.crewNumber} has ${metrics.restViolations} rest violation(s).`, { crewId: roster.id });
        if (metrics.daysWorked !== weekly.preferredDaysWorked && metrics.daysWorked !== 4) finding(findings, 'best-practice', 'days-worked-outside-preference', `Crew ${roster.crewNumber} works ${metrics.daysWorked} days.`, { crewId: roster.id });
        if (metrics.paidMinutes < weekly.preferredPaidMinutes.minimum || metrics.paidMinutes > weekly.preferredPaidMinutes.maximum) finding(findings, 'best-practice', 'weekly-hours-outside-preference', `Crew ${roster.crewNumber} is outside the preferred weekly paid-hour range.`, { crewId: roster.id });
        const workedIndexes = new Set(roster.assignments
            .filter(assignment => assignment.runId)
            .map(assignment => ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].indexOf(assignment.day)));
        let longestDaysOff = 0;
        for (let start = 0; start < 7; start += 1) {
            let daysOff = 0;
            while (daysOff < 7 && !workedIndexes.has((start + daysOff) % 7)) daysOff += 1;
            longestDaysOff = Math.max(longestDaysOff, daysOff);
        }
        const requiredDaysOff = metrics.daysWorked === 4 ? weekly.minimumFourDayRosterDaysOff : weekly.minimumConsecutiveDaysOff;
        if (longestDaysOff < requiredDaysOff) finding(findings, 'contractual', 'consecutive-days-off-not-met', `Crew ${roster.crewNumber} has only ${longestDaysOff} consecutive day(s) off; ${requiredDaysOff} are required.`, { crewId: roster.id });
        const weekdayStarts = roster.assignments.flatMap(assignment => {
            if (!assignment.runId || !['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'].includes(assignment.day)) return [];
            const run = runById.get(assignment.runId);
            if (!run) return [];
            const reportTime = calculateDailyRunMetrics(input, run).reportTime;
            return reportTime === null ? [] : [reportTime];
        });
        if (weekdayStarts.length > 1 && Math.max(...weekdayStarts) - Math.min(...weekdayStarts) > weekly.weekdayStartConsistencyMinutes.maximum) {
            finding(findings, 'best-practice', 'weekday-start-inconsistent', `Crew ${roster.crewNumber} weekday report times vary by more than ${weekly.weekdayStartConsistencyMinutes.maximum} minutes.`, { crewId: roster.id });
        }
    });

    proposal.dailyRuns.forEach(run => {
        rosterDays.filter(day => expectedDayTypeForRosterDay(day) === run.dayType).forEach(day => {
            const count = coverage.get(`${day}:${run.id}`) ?? 0;
            if (count !== 1) finding(findings, 'integrity', 'run-roster-coverage-invalid', `${run.runNumber} must be assigned exactly once on ${day}; found ${count}.`, { runId: run.id, dayType: run.dayType });
        });
    });

    const fourDayCount = proposal.weeklyRosters.filter(roster =>
        roster.assignments.filter(assignment => assignment.runId).length === 4,
    ).length;
    if (fourDayCount > input.ruleProfile.weekly.fourDayRosterMaximumCount) {
        finding(findings, 'contractual', 'four-day-roster-limit-exceeded', `${fourDayCount} four-day rosters exceed the limit of ${input.ruleProfile.weekly.fourDayRosterMaximumCount}.`);
    }
    if (proposal.weeklyRosters.length > input.ruleProfile.workforce.fixedCrews) {
        finding(findings, 'contractual', 'fixed-crew-capacity-exceeded', `${proposal.weeklyRosters.length} weekly rosters exceed the ${input.ruleProfile.workforce.fixedCrews} fixed crew positions.`);
    }
    finding(findings, 'informational', 'fixed-crew-utilization', `${proposal.weeklyRosters.length} of ${input.ruleProfile.workforce.fixedCrews} fixed crew positions are used by this proposal.`);
    const metrics = proposal.weeklyRosters.map(roster => calculateWeeklyRosterMetrics(input, proposal, roster));
    const straightShare = metrics.length === 0 ? 0 : metrics.filter(metric => metric.allStraight).length / metrics.length;
    if (metrics.length > 0 && straightShare < input.ruleProfile.weekly.allStraightRosterTargetShare) {
        finding(findings, 'best-practice', 'all-straight-roster-target-missed', `${Math.round(straightShare * 100)}% of rosters are all-straight; the target is ${Math.round(input.ruleProfile.weekly.allStraightRosterTargetShare * 100)}%.`);
    }
};

const validateReliefCabCapacity = (
    input: OperationsPlanningInputV1,
    proposal: OperationsPlanningProposalV1,
    findings: ValidationFinding[],
): void => {
    const tripById = new Map(input.trips.map(trip => [trip.id, trip]));
    const auditByKey = new Map(input.blockAudits.map(audit => [audit.vehicleBlockKey, audit]));
    const intervals: Array<{ dayType: DailyRun['dayType']; start: number; end: number }> = [];
    proposal.dailyRuns.forEach(run => run.pieces.forEach(piece => {
        const audit = auditByKey.get(piece.blockId);
        const first = tripById.get(piece.tripIds[0]);
        const last = tripById.get(piece.tripIds.at(-1) ?? '');
        if (!audit || !first || !last || last.arrivalTime === null) return;
        const firstPosition = audit.tripIds.indexOf(first.id);
        const lastPosition = audit.tripIds.indexOf(last.id);
        if (firstPosition > 0) {
            const outbound = getTravelMinutes(input.ruleProfile, input.ruleProfile.garage.name, piece.startReliefPoint);
            if (outbound !== null && outbound > 0) intervals.push({ dayType: run.dayType, start: first.startTime - outbound, end: first.startTime });
        }
        if (lastPosition >= 0 && lastPosition < audit.tripIds.length - 1) {
            const inbound = getTravelMinutes(input.ruleProfile, piece.endReliefPoint, input.ruleProfile.garage.name);
            if (inbound !== null && inbound > 0) intervals.push({ dayType: run.dayType, start: last.arrivalTime, end: last.arrivalTime + inbound });
        }
    }));
    (['Weekday', 'Saturday', 'Sunday'] as const).forEach(dayType => {
        const events = intervals.filter(interval => interval.dayType === dayType).flatMap(interval => [
            { time: interval.start, delta: 1 },
            { time: interval.end, delta: -1 },
        ]).sort((left, right) => left.time - right.time || left.delta - right.delta);
        let active = 0;
        let peak = 0;
        events.forEach(event => { active += event.delta; peak = Math.max(peak, active); });
        if (peak > input.ruleProfile.reliefCabCapacity) {
            finding(findings, 'contractual', 'relief-cab-capacity-exceeded', `${dayType} requires ${peak} concurrent relief cabs; only ${input.ruleProfile.reliefCabCapacity} are available.`, { dayType });
        }
    });
};

const validateAggregateConstraints = (
    input: OperationsPlanningInputV1,
    proposal: OperationsPlanningProposalV1,
    findings: ValidationFinding[],
): void => {
    (['Weekday', 'Saturday', 'Sunday'] as const).forEach(dayType => {
        const runs = proposal.dailyRuns.filter(run => run.dayType === dayType);
        const runMetrics = runs.map(run => calculateDailyRunMetrics(input, run));
        const longCount = runMetrics.filter(metrics => metrics.spreadMinutes > input.ruleProfile.longSpreadMinutes.threshold).length;
        if (runs.length > 0 && longCount / runs.length > input.ruleProfile.longSpreadMinutes.maximumShare) {
            finding(findings, 'contractual', 'long-spread-share-exceeded', `${dayType} has ${longCount} long-spread runs out of ${runs.length}; no more than ${Math.round(input.ruleProfile.longSpreadMinutes.maximumShare * 100)}% are allowed.`, { dayType });
        }
        const straightCount = runMetrics.filter(metrics => !metrics.isSplit).length;
        if (runs.length > 0 && straightCount / runs.length > input.ruleProfile.dailyStraightRunGuideMaximumShare) {
            finding(findings, 'best-practice', 'daily-straight-run-guide-exceeded', `${dayType} has ${straightCount} straight runs out of ${runs.length}; the normal guide is about ${Math.round(input.ruleProfile.dailyStraightRunGuideMaximumShare * 100)}%.`, { dayType });
        }
        const blocks = input.blockAudits.filter(audit => audit.dayType === dayType);
        const events = blocks.flatMap(block => block.finalArrival === null ? [] : [
            { time: block.firstDeparture, delta: 1 },
            { time: block.finalArrival, delta: -1 },
        ]).sort((left, right) => left.time - right.time || left.delta - right.delta);
        let active = 0;
        let peak = 0;
        events.forEach(event => { active += event.delta; peak = Math.max(peak, active); });
        const fleet = input.ruleProfile.fleetByDayType[dayType];
        if (peak > fleet.fortyFoot + fleet.small) finding(findings, 'contractual', 'fleet-capacity-exceeded', `${dayType} needs ${peak} concurrent vehicles but only ${fleet.fortyFoot + fleet.small} are available.`, { dayType });
        else if (peak > fleet.fortyFoot) finding(findings, 'best-practice', 'small-bus-use-required', `${dayType} needs ${peak - fleet.fortyFoot} small vehicle(s), while fixed routes prefer 40-foot vehicles.`, { dayType });
    });
    finding(findings, 'informational', 'batt-park-out-not-evaluated', 'B.A.T.T. park-out capacity is not evaluated because no numeric capacity was supplied.');
};

export const assessOperationsPlanningProposal = (
    input: OperationsPlanningInputV1,
    proposalValue: unknown,
): ProposalAssessment => {
    let proposal: OperationsPlanningProposalV1;
    try {
        proposal = parseOperationsPlanningProposal(proposalValue);
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Proposal could not be parsed.';
        return {
            proposal: null,
            dailyRunMetrics: [],
            weeklyRosterMetrics: [],
            findings: [{ id: 'app:0:proposal-parse-failed', category: 'integrity', severity: 'error', code: 'proposal-parse-failed', message }],
            approvalReady: false,
        };
    }
    const findings = input.blockAudits.flatMap(audit => audit.findings);
    if (proposal.scenarioId !== input.scenarioId) finding(findings, 'integrity', 'scenario-id-mismatch', 'Proposal scenarioId does not match the exported input.');
    if (proposal.sourceManifestFingerprint !== input.sourceManifest.fingerprint) finding(findings, 'integrity', 'source-manifest-mismatch', 'Proposal was generated from a different pinned Master Schedule manifest.');

    const proposalAuditById = new Map(proposal.blockAudits.map(audit => [audit.id, audit]));
    input.blockAudits.forEach(audit => {
        const proposed = proposalAuditById.get(audit.id);
        if (!proposed) finding(findings, 'integrity', 'codex-block-audit-missing', `Codex proposal is missing block audit ${audit.id}.`, { dayType: audit.dayType, blockId: audit.blockId });
        else if (proposed.membershipFingerprint !== audit.membershipFingerprint || proposed.tripIds.join('|') !== audit.tripIds.join('|')) {
            finding(findings, 'integrity', 'codex-block-membership-changed', `Codex block audit ${audit.id} does not preserve source trip membership.`, { dayType: audit.dayType, blockId: audit.blockId });
        }
    });
    proposal.findings.forEach((proposed, index) => findings.push({
        ...proposed,
        id: `codex-advisory:${index}:${proposed.code}`,
        category: 'informational',
        severity: 'info',
        code: `codex-advisory:${proposed.code}`,
        message: `Codex advisory: ${proposed.message}`,
    }));

    const runIds = new Set<string>();
    const runNumbers = new Set<string>();
    const assignedTrips = new Map<string, string[]>();
    const tripById = new Map(input.trips.map(trip => [trip.id, trip]));
    proposal.dailyRuns.forEach(run => {
        if (runIds.has(run.id)) finding(findings, 'integrity', 'duplicate-run-id', `Run id ${run.id} is duplicated.`, { runId: run.id });
        if (runNumbers.has(`${run.dayType}:${run.runNumber}`)) finding(findings, 'integrity', 'duplicate-run-number', `Run number ${run.runNumber} is duplicated for ${run.dayType}.`, { runId: run.id, dayType: run.dayType });
        runIds.add(run.id);
        runNumbers.add(`${run.dayType}:${run.runNumber}`);
        getRunTrips(input, run).forEach(trip => assignedTrips.set(trip.id, [...(assignedTrips.get(trip.id) ?? []), run.id]));
        validateRun(input, run, tripById, findings);
    });
    input.trips.forEach(trip => {
        const assigned = assignedTrips.get(trip.id) ?? [];
        if (assigned.length === 0) finding(findings, 'integrity', 'trip-unassigned', `Trip ${trip.id} is not assigned to a daily run.`, { tripId: trip.id, dayType: trip.dayType, blockId: trip.blockId });
        if (assigned.length > 1) finding(findings, 'integrity', 'trip-assigned-multiple-times', `Trip ${trip.id} is assigned to ${assigned.length} daily runs.`, { tripId: trip.id, dayType: trip.dayType, blockId: trip.blockId });
    });
    validateRosterCoverage(input, proposal, findings);
    validateReliefCabCapacity(input, proposal, findings);
    validateAggregateConstraints(input, proposal, findings);
    const dailyRunMetrics = proposal.dailyRuns.map(run => calculateDailyRunMetrics(input, run));
    const weeklyRosterMetrics = proposal.weeklyRosters.map(roster => calculateWeeklyRosterMetrics(input, proposal, roster));
    return {
        proposal,
        dailyRunMetrics,
        weeklyRosterMetrics,
        findings,
        approvalReady: !findings.some(item => item.category === 'integrity' || item.category === 'contractual'),
    };
};
