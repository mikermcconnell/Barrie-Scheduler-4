import { findReliefPoint } from './rules';
import type { OperationsPlanningInputV1, OperationsPlanningProposalV1, RosterDay, RunPiece } from './types';

export class RunCuttingEditError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'RunCuttingEditError';
    }
}

const cloneProposal = (proposal: OperationsPlanningProposalV1): OperationsPlanningProposalV1 =>
    structuredClone(proposal);

const assertUniqueRunIdentity = (
    proposal: OperationsPlanningProposalV1,
    id: string,
    runNumber: string,
    dayType: string,
): void => {
    if (proposal.dailyRuns.some(run => run.id === id)) throw new RunCuttingEditError(`Run id ${id} already exists.`);
    if (proposal.dailyRuns.some(run => run.dayType === dayType && run.runNumber === runNumber)) {
        throw new RunCuttingEditError(`Run number ${runNumber} already exists for ${dayType}.`);
    }
};

export const splitDailyRun = (
    input: OperationsPlanningInputV1,
    proposal: OperationsPlanningProposalV1,
    runId: string,
    splitAfterTripId: string,
    newRun: { id: string; runNumber: string },
): OperationsPlanningProposalV1 => {
    const draft = cloneProposal(proposal);
    const index = draft.dailyRuns.findIndex(run => run.id === runId);
    const run = draft.dailyRuns[index];
    if (!run) throw new RunCuttingEditError(`Run ${runId} does not exist.`);
    assertUniqueRunIdentity(draft, newRun.id, newRun.runNumber, run.dayType);
    const tripById = new Map(input.trips.map(trip => [trip.id, trip]));
    const flatIds = run.pieces.flatMap(piece => piece.tripIds);
    const splitIndex = flatIds.indexOf(splitAfterTripId);
    if (splitIndex < 0 || splitIndex === flatIds.length - 1) {
        throw new RunCuttingEditError('Split trip must be in the run and cannot be its final trip.');
    }
    const splitTrip = tripById.get(splitAfterTripId);
    const nextTrip = tripById.get(flatIds[splitIndex + 1]);
    if (!splitTrip || !nextTrip || splitTrip.arrivalTime === null) {
        throw new RunCuttingEditError('Split boundary requires a resolved arrival and following trip.');
    }
    const endRelief = findReliefPoint(input.ruleProfile, splitTrip.endStop);
    const startRelief = findReliefPoint(input.ruleProfile, nextTrip.startStop);
    if (!endRelief || !startRelief) throw new RunCuttingEditError('Split boundary must use recognized relief points.');

    const leftPieces: RunPiece[] = [];
    const rightPieces: RunPiece[] = [];
    let reachedBoundary = false;
    run.pieces.forEach(piece => {
        if (reachedBoundary) {
            rightPieces.push(piece);
            return;
        }
        const pieceSplitIndex = piece.tripIds.indexOf(splitAfterTripId);
        if (pieceSplitIndex < 0) {
            leftPieces.push(piece);
            return;
        }
        const leftIds = piece.tripIds.slice(0, pieceSplitIndex + 1);
        const rightIds = piece.tripIds.slice(pieceSplitIndex + 1);
        leftPieces.push({ ...piece, id: rightIds.length ? `${piece.id}-a` : piece.id, tripIds: leftIds, endReliefPoint: endRelief.name });
        if (rightIds.length) rightPieces.push({ ...piece, id: `${piece.id}-b`, tripIds: rightIds, startReliefPoint: startRelief.name });
        reachedBoundary = true;
    });
    run.pieces = leftPieces;
    draft.dailyRuns.splice(index + 1, 0, {
        id: newRun.id,
        runNumber: newRun.runNumber,
        dayType: run.dayType,
        pieces: rightPieces,
        notes: run.notes,
    });
    return draft;
};

export const mergeDailyRuns = (
    input: OperationsPlanningInputV1,
    proposal: OperationsPlanningProposalV1,
    firstRunId: string,
    secondRunId: string,
): OperationsPlanningProposalV1 => {
    if (firstRunId === secondRunId) throw new RunCuttingEditError('Choose two different runs to merge.');
    const draft = cloneProposal(proposal);
    const first = draft.dailyRuns.find(run => run.id === firstRunId);
    const second = draft.dailyRuns.find(run => run.id === secondRunId);
    if (!first || !second) throw new RunCuttingEditError('Both runs must exist.');
    if (first.dayType !== second.dayType) throw new RunCuttingEditError('Only runs for the same day type can be merged.');
    const tripById = new Map(input.trips.map(trip => [trip.id, trip]));
    const firstLast = tripById.get(first.pieces.at(-1)?.tripIds.at(-1) ?? '');
    const secondFirst = tripById.get(second.pieces[0]?.tripIds[0] ?? '');
    if (!firstLast || !secondFirst || firstLast.arrivalTime === null || firstLast.arrivalTime > secondFirst.startTime) {
        throw new RunCuttingEditError('Runs overlap or have unresolved boundary timing.');
    }
    if (!findReliefPoint(input.ruleProfile, firstLast.endStop) || !findReliefPoint(input.ruleProfile, secondFirst.startStop)) {
        throw new RunCuttingEditError('Merge boundary must use recognized relief points.');
    }
    first.pieces.push(...second.pieces);
    draft.dailyRuns = draft.dailyRuns.filter(run => run.id !== secondRunId);
    draft.weeklyRosters.forEach(roster => roster.assignments.forEach(assignment => {
        if (assignment.runId === secondRunId) assignment.runId = firstRunId;
    }));
    return draft;
};

export const moveRunPiece = (
    proposal: OperationsPlanningProposalV1,
    pieceId: string,
    fromRunId: string,
    toRunId: string,
    toIndex?: number,
): OperationsPlanningProposalV1 => {
    if (fromRunId === toRunId) throw new RunCuttingEditError('Source and target runs must differ.');
    const draft = cloneProposal(proposal);
    const from = draft.dailyRuns.find(run => run.id === fromRunId);
    const to = draft.dailyRuns.find(run => run.id === toRunId);
    if (!from || !to) throw new RunCuttingEditError('Source and target runs must exist.');
    if (from.dayType !== to.dayType) throw new RunCuttingEditError('A piece cannot move to another day type.');
    const pieceIndex = from.pieces.findIndex(piece => piece.id === pieceId);
    if (pieceIndex < 0) throw new RunCuttingEditError(`Piece ${pieceId} is not in run ${fromRunId}.`);
    if (from.pieces.length === 1) throw new RunCuttingEditError('Moving the only piece would leave an empty run.');
    const [piece] = from.pieces.splice(pieceIndex, 1);
    const insertAt = Math.max(0, Math.min(toIndex ?? to.pieces.length, to.pieces.length));
    to.pieces.splice(insertAt, 0, piece);
    return draft;
};

export const renumberDailyRun = (
    proposal: OperationsPlanningProposalV1,
    runId: string,
    runNumber: string,
): OperationsPlanningProposalV1 => {
    const draft = cloneProposal(proposal);
    const run = draft.dailyRuns.find(candidate => candidate.id === runId);
    if (!run) throw new RunCuttingEditError(`Run ${runId} does not exist.`);
    if (!runNumber.trim()) throw new RunCuttingEditError('Run number cannot be blank.');
    if (draft.dailyRuns.some(candidate => candidate.id !== runId && candidate.dayType === run.dayType && candidate.runNumber === runNumber)) {
        throw new RunCuttingEditError(`Run number ${runNumber} already exists for ${run.dayType}.`);
    }
    run.runNumber = runNumber;
    return draft;
};

export const assignDailyRunToCrew = (
    proposal: OperationsPlanningProposalV1,
    rosterId: string,
    day: RosterDay,
    runId: string | null,
): OperationsPlanningProposalV1 => {
    const draft = cloneProposal(proposal);
    const roster = draft.weeklyRosters.find(candidate => candidate.id === rosterId);
    if (!roster) throw new RunCuttingEditError(`Roster ${rosterId} does not exist.`);
    if (runId && !draft.dailyRuns.some(run => run.id === runId)) throw new RunCuttingEditError(`Run ${runId} does not exist.`);
    const existing = roster.assignments.find(assignment => assignment.day === day);
    if (existing) existing.runId = runId;
    else roster.assignments.push({ day, runId });
    return draft;
};
