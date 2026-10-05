import { findReliefPoint, getTravelMinutes } from './rules';
import type { OperationsPlanningInputV1, PlanningTrip, RuleProfile, RunPiece } from './types';

const sameLocation = (rules: RuleProfile, left: string, right: string): boolean => {
    const a = findReliefPoint(rules, left);
    const b = findReliefPoint(rules, right);
    return a && b ? a.id === b.id : left.trim().toLocaleLowerCase() === right.trim().toLocaleLowerCase();
};

const travelMinutes = (rules: RuleProfile, from: string, to: string): number | null =>
    sameLocation(rules, from, to) ? 0 : getTravelMinutes(rules, from, to);

/** Incoming relief occurs at the preceding vehicle trip's arrival, not departure. */
export const resolvePieceBoardingTime = (
    input: OperationsPlanningInputV1,
    piece: RunPiece,
    tripById: Map<string, PlanningTrip>,
): number | null => {
    const first = tripById.get(piece.tripIds[0]);
    const audit = input.blockAudits.find(item => item.vehicleBlockKey === piece.blockId);
    if (!first || !audit) return null;
    const position = audit.tripIds.indexOf(first.id);
    if (position === 0) return first.startTime;
    if (position < 0) return null;
    const previous = tripById.get(audit.tripIds[position - 1]);
    if (!previous || previous.arrivalTime === null
        || previous.arrivalTime > first.startTime
        || !sameLocation(input.ruleProfile, previous.endStop, first.startStop)) return null;
    return previous.arrivalTime;
};

export interface PieceTransition {
    startTime: number;
    boardingTime: number;
    departureTime: number;
    gapMinutes: number;
    isSplit: boolean;
    travelBeforeBreak: number;
    travelAfterBreak: number;
    isBusPullIn: boolean;
    isBusPullOut: boolean;
    postTripMinutes: number;
    circleCheckMinutes: number;
    breakStartTime: number;
    breakEndTime: number;
    availableBreakMinutes: number;
    qualifyingBreakMinutes: number;
    paidGap: boolean;
    breakLocation: string;
    breakLocationAllowed: boolean;
    travelResolved: boolean;
    timingResolved: boolean;
    travelFits: boolean;
}

/** One shared decomposition drives time/pay calculations and compliance checks. */
export const calculatePieceTransition = (
    input: OperationsPlanningInputV1,
    previousPiece: RunPiece,
    nextPiece: RunPiece,
    tripById: Map<string, PlanningTrip>,
): PieceTransition | null => {
    const previous = tripById.get(previousPiece.tripIds.at(-1) ?? '');
    const next = tripById.get(nextPiece.tripIds[0]);
    if (!previous || !next) return null;
    const rules = input.ruleProfile;
    const resolvedBoarding = resolvePieceBoardingTime(input, nextPiece, tripById);
    // Provisional values keep invalid drafts inspectable; the validator blocks unresolved timing.
    const boardingTime = resolvedBoarding ?? next.startTime;
    const startTime = previous.arrivalTime ?? previous.startTime + previous.travelTime;
    const gapMinutes = boardingTime - startTime;
    const isSplit = gapMinutes >= rules.splitThresholdMinutes;
    const from = previousPiece.endReliefPoint;
    const to = nextPiece.startReliefPoint;
    const previousAudit = input.blockAudits.find(item => item.vehicleBlockKey === previousPiece.blockId);
    const nextAudit = input.blockAudits.find(item => item.vehicleBlockKey === nextPiece.blockId);
    const isBusPullIn = previousAudit?.tripIds.at(-1) === previous.id;
    const isBusPullOut = nextAudit?.tripIds[0] === next.id;
    const postTripMinutes = isBusPullIn ? rules.postTripMinutes : 0;
    const circleCheckMinutes = isBusPullOut ? rules.circleCheckMinutes : 0;
    let before: number | null;
    let after: number | null;
    let breakLocation: string;
    if (isSplit || isBusPullIn || isBusPullOut) {
        before = travelMinutes(rules, from, rules.garage.name);
        after = travelMinutes(rules, rules.garage.name, to);
        breakLocation = rules.garage.name;
    } else if (findReliefPoint(rules, from)?.fullBreakPoint) {
        before = 0;
        after = travelMinutes(rules, from, to);
        breakLocation = from;
    } else {
        before = travelMinutes(rules, from, to);
        after = 0;
        breakLocation = to;
    }
    const travelResolved = before !== null && after !== null;
    const travelBeforeBreak = before ?? 0;
    const travelAfterBreak = after ?? 0;
    const travelFits = gapMinutes >= travelBeforeBreak + postTripMinutes + circleCheckMinutes + travelAfterBreak;
    const breakStartTime = startTime + travelBeforeBreak + postTripMinutes;
    const breakEndTime = boardingTime - travelAfterBreak - circleCheckMinutes;
    const availableBreakMinutes = Math.max(0, breakEndTime - breakStartTime);
    const paidGap = !isSplit && availableBreakMinutes <= rules.paidThroughGapMaximumMinutes;
    const breakLocationAllowed = sameLocation(rules, breakLocation, rules.garage.name)
        || Boolean(findReliefPoint(rules, breakLocation)?.fullBreakPoint);
    const timingResolved = previous.arrivalTime !== null && resolvedBoarding !== null;
    return {
        startTime, boardingTime, departureTime: next.startTime, gapMinutes, isSplit,
        travelBeforeBreak, travelAfterBreak, breakStartTime, breakEndTime,
        isBusPullIn, isBusPullOut, postTripMinutes, circleCheckMinutes,
        availableBreakMinutes,
        qualifyingBreakMinutes: timingResolved && travelResolved && travelFits && breakLocationAllowed && !paidGap
            ? availableBreakMinutes : 0,
        paidGap, breakLocation, breakLocationAllowed, travelResolved, timingResolved, travelFits,
    };
};
