import { getTravelMinutes } from './rules';
import { calculatePieceTransition, resolvePieceBoardingTime } from './dutyTransitions';
import { projectOperationsPlanningInput, projectRun } from './interiorRelief';
import type {
    DailyRun,
    DailyRunMetrics,
    DutyActivity,
    OperationsPlanningInputV1,
    OperationsPlanningProposalV1,
    PlanningTrip,
    RosterDay,
    WeeklyRoster,
    WeeklyRosterMetrics,
} from './types';

const ROSTER_DAY_INDEX: Record<RosterDay, number> = {
    Monday: 0,
    Tuesday: 1,
    Wednesday: 2,
    Thursday: 3,
    Friday: 4,
    Saturday: 5,
    Sunday: 6,
};

const buildTripMap = (input: OperationsPlanningInputV1): Map<string, PlanningTrip> =>
    new Map(input.trips.map(trip => [trip.id, trip]));

export const getRunTrips = (input: OperationsPlanningInputV1, run: DailyRun): PlanningTrip[] => {
    if (input.schemaVersion === 2) return getRunTrips(projectOperationsPlanningInput(input), projectRun(input, run));
    const trips = buildTripMap(input);
    return run.pieces.flatMap(piece => piece.tripIds.map(id => trips.get(id)).filter((trip): trip is PlanningTrip => Boolean(trip)));
};

const activity = (
    type: DutyActivity['type'],
    startTime: number,
    endTime: number,
    paid: boolean,
    extra: Pick<DutyActivity, 'tripId' | 'note'> = {},
): DutyActivity => ({ type, startTime, endTime, paid, ...extra });

export const calculateDailyRunMetrics = (
    input: OperationsPlanningInputV1,
    run: DailyRun,
): DailyRunMetrics => {
    if (input.schemaVersion === 2) return calculateDailyRunMetrics(projectOperationsPlanningInput(input), projectRun(input, run));
    const rules = input.ruleProfile;
    const tripById = buildTripMap(input);
    const pieceTrips = run.pieces.map(piece => piece.tripIds
        .map(id => tripById.get(id))
        .filter((trip): trip is PlanningTrip => Boolean(trip)));
    const trips = pieceTrips.flat();
    if (trips.length === 0) {
        return {
            runId: run.id,
            reportTime: null,
            offTime: null,
            spreadMinutes: 0,
            platformMinutes: 0,
            paidMinutes: 0,
            unpaidBreakMinutes: 0,
            longestContinuousPlatformMinutes: 0,
            pieceCount: run.pieces.length,
            isSplit: false,
            activities: [],
        };
    }

    const first = trips[0];
    const last = trips[trips.length - 1];
    const firstPiece = run.pieces[0];
    const lastPiece = run.pieces.at(-1)!;
    const firstAudit = input.blockAudits.find(item => item.vehicleBlockKey === firstPiece.blockId);
    const lastAudit = input.blockAudits.find(item => item.vehicleBlockKey === lastPiece.blockId);
    const isBusPullOut = firstAudit?.tripIds[0] === first.id;
    const isBusPullIn = lastAudit?.tripIds.at(-1) === last.id;
    const boardingTime = resolvePieceBoardingTime(input, firstPiece, tripById) ?? first.startTime;
    const circleCheckMinutes = isBusPullOut ? rules.circleCheckMinutes : 0;
    const postTripMinutes = isBusPullIn ? rules.postTripMinutes : 0;
    const pullOut = getTravelMinutes(rules, rules.garage.name, run.pieces[0]?.startReliefPoint ?? first.startStop) ?? 0;
    const pullIn = getTravelMinutes(rules, run.pieces.at(-1)?.endReliefPoint ?? last.endStop, rules.garage.name) ?? 0;
    const reportTime = boardingTime - pullOut - circleCheckMinutes - rules.signOnMinutes;
    const finalArrival = last.arrivalTime ?? last.startTime + last.travelTime;
    const offTime = finalArrival + pullIn + postTripMinutes;
    const activities: DutyActivity[] = [];
    activities.push(activity('sign-on', reportTime, reportTime + rules.signOnMinutes, true));
    if (circleCheckMinutes > 0) activities.push(activity(
        'circle-check',
        reportTime + rules.signOnMinutes,
        reportTime + rules.signOnMinutes + circleCheckMinutes,
        true,
    ));
    if (pullOut > 0) activities.push(activity(isBusPullOut ? 'deadhead' : 'shuttle', boardingTime - pullOut, boardingTime, true, {
        note: isBusPullOut ? 'Garage bus pull-out' : 'Garage shuttle to relief',
    }));

    let paidGapMinutes = Math.max(0, first.startTime - boardingTime);
    if (paidGapMinutes > 0) activities.push(activity('paid-gap', boardingTime, first.startTime, true, { note: 'Boarding at source arrival' }));
    let shuttleMinutes = 0;
    let internalBusDrivingMinutes = 0;
    let internalPreparationMinutes = 0;
    let unpaidBreakMinutes = 0;
    let continuousPlatformMinutes = isBusPullOut ? pullOut : 0;
    let longestContinuousPlatformMinutes = continuousPlatformMinutes;
    let largestInterPieceGap = 0;

    trips.forEach((trip, index) => {
        activities.push(activity('platform', trip.startTime, trip.arrivalTime ?? trip.startTime + trip.travelTime, true, { tripId: trip.id }));
        continuousPlatformMinutes += trip.travelTime;
        longestContinuousPlatformMinutes = Math.max(longestContinuousPlatformMinutes, continuousPlatformMinutes);
        const next = trips[index + 1];
        if (!next) return;
        const currentPiece = pieceTrips.findIndex(piece => piece.includes(trip));
        const nextPiece = pieceTrips.findIndex(piece => piece.includes(next));
        const changesPiece = currentPiece !== nextPiece;
        if (!changesPiece) {
            // Remaining with the source block is occupied work, not an inferred meal relief.
            const gap = Math.max(0, next.startTime - (trip.arrivalTime ?? trip.startTime + trip.travelTime));
            paidGapMinutes += gap;
            if (gap > 0) activities.push(activity('paid-gap', next.startTime - gap, next.startTime, true, { note: 'Source block recovery; no operator relief' }));
            return;
        }
        const transition = calculatePieceTransition(input, run.pieces[currentPiece], run.pieces[nextPiece], tripById);
        if (!transition) return;
        largestInterPieceGap = Math.max(largestInterPieceGap, transition.gapMinutes);
        const { travelBeforeBreak, travelAfterBreak, breakStartTime, breakEndTime, availableBreakMinutes } = transition;
        shuttleMinutes += travelBeforeBreak + travelAfterBreak;
        internalPreparationMinutes += transition.postTripMinutes + transition.circleCheckMinutes;
        const beforeDriving = transition.isBusPullIn ? travelBeforeBreak : 0;
        const afterDriving = transition.isBusPullOut ? travelAfterBreak : 0;
        internalBusDrivingMinutes += beforeDriving + afterDriving;
        continuousPlatformMinutes += beforeDriving;
        longestContinuousPlatformMinutes = Math.max(longestContinuousPlatformMinutes, continuousPlatformMinutes);
        if (travelBeforeBreak > 0) activities.push(activity(transition.isBusPullIn ? 'deadhead' : 'shuttle', transition.startTime, transition.startTime + travelBeforeBreak, true, {
            note: transition.isBusPullIn ? 'Intermediate bus pull-in' : `Transfer to ${transition.breakLocation}`,
        }));
        if (transition.postTripMinutes > 0) activities.push(activity('post-trip', breakStartTime - transition.postTripMinutes, breakStartTime, true));
        if (transition.paidGap) paidGapMinutes += availableBreakMinutes;
        else unpaidBreakMinutes += availableBreakMinutes;
        if (availableBreakMinutes > 0) activities.push(activity(transition.paidGap ? 'paid-gap' : 'break', breakStartTime, breakEndTime, transition.paidGap, {
            note: `${transition.isSplit ? 'Split break' : 'Relief gap'} at ${transition.breakLocation}`,
        }));
        if (transition.circleCheckMinutes > 0) activities.push(activity('circle-check', breakEndTime, breakEndTime + transition.circleCheckMinutes, true));
        if (travelAfterBreak > 0) activities.push(activity(transition.isBusPullOut ? 'deadhead' : 'shuttle', transition.boardingTime - travelAfterBreak, transition.boardingTime, true, {
            note: transition.isBusPullOut ? 'Intermediate bus pull-out' : 'Transfer to next relief',
        }));
        const boardingWait = Math.max(0, transition.departureTime - transition.boardingTime);
        paidGapMinutes += boardingWait;
        if (boardingWait > 0) activities.push(activity('paid-gap', transition.boardingTime, transition.departureTime, true, { note: 'Boarding at source arrival' }));
        const resetMinimum = trip.routeNumber === next.routeNumber
            ? rules.sameRouteResetMinimumMinutes
            : rules.routeChangeResetMinimumMinutes;
        if (transition.qualifyingBreakMinutes >= resetMinimum) continuousPlatformMinutes = 0;
        continuousPlatformMinutes += afterDriving;
    });

    if (pullIn > 0) activities.push(activity(isBusPullIn ? 'deadhead' : 'shuttle', finalArrival, finalArrival + pullIn, true, {
        note: isBusPullIn ? 'Garage bus pull-in' : 'Shuttle to Garage after relief',
    }));
    if (postTripMinutes > 0) activities.push(activity('post-trip', offTime - postTripMinutes, offTime, true));
    continuousPlatformMinutes += isBusPullIn ? pullIn : 0;
    longestContinuousPlatformMinutes = Math.max(longestContinuousPlatformMinutes, continuousPlatformMinutes);

    const platformMinutes = trips.reduce((sum, trip) => sum + Math.max(0, trip.travelTime), 0)
        + (isBusPullOut ? pullOut : 0) + (isBusPullIn ? pullIn : 0) + internalBusDrivingMinutes;
    const paidBreakPenalty = longestContinuousPlatformMinutes > rules.continuousPlatformLimitMinutes
        ? rules.continuousPlatformBreakPenaltyMinutes
        : 0;
    const occupiedTripMinutes = trips.reduce((sum, trip) => sum + Math.max(0,
        (trip.arrivalTime ?? trip.startTime + trip.travelTime) - trip.startTime), 0);
    const paidMinutes = rules.signOnMinutes + circleCheckMinutes + pullOut + pullIn
        + postTripMinutes + occupiedTripMinutes + paidGapMinutes + shuttleMinutes + internalPreparationMinutes + paidBreakPenalty;

    return {
        runId: run.id,
        reportTime,
        offTime,
        spreadMinutes: Math.max(0, offTime - reportTime),
        platformMinutes,
        paidMinutes,
        unpaidBreakMinutes,
        longestContinuousPlatformMinutes,
        pieceCount: run.pieces.length,
        isSplit: largestInterPieceGap >= rules.splitThresholdMinutes,
        activities: activities.sort((left, right) => left.startTime - right.startTime || left.type.localeCompare(right.type)),
    };
};

const runDayTypeForRosterDay = (day: RosterDay) => day === 'Saturday' ? 'Saturday' : day === 'Sunday' ? 'Sunday' : 'Weekday';

export const calculateWeeklyRosterMetrics = (
    input: OperationsPlanningInputV1,
    proposal: Pick<OperationsPlanningProposalV1, 'dailyRuns'>,
    roster: WeeklyRoster,
): WeeklyRosterMetrics => {
    const runById = new Map(proposal.dailyRuns.map(run => [run.id, run]));
    const worked = roster.assignments
        .filter((assignment): assignment is typeof assignment & { runId: string } => Boolean(assignment.runId))
        .map(assignment => {
            const run = runById.get(assignment.runId);
            return run ? {
                assignment,
                run,
                metrics: calculateDailyRunMetrics(input, run),
                dayIndex: ROSTER_DAY_INDEX[assignment.day],
            } : null;
        })
        .filter((value): value is NonNullable<typeof value> => Boolean(value))
        .sort((left, right) => left.dayIndex - right.dayIndex);

    let restViolations = 0;
    worked.forEach((current, index) => {
        // Anonymous weekly patterns repeat: include the last duty to the first
        // duty of the following week, preserving any intervening days off.
        const next = worked[index + 1] ?? worked[0];
        if (!next || current.metrics.offTime === null || next.metrics.reportTime === null) return;
        const dayGap = (next.dayIndex - current.dayIndex + (index === worked.length - 1 ? 7 : 0)) * 1440;
        const rest = dayGap + next.metrics.reportTime - current.metrics.offTime;
        if (rest < input.ruleProfile.weekly.minimumRestMinutes) restViolations += 1;
    });
    const paidMinutes = worked.reduce((sum, item) => sum + item.metrics.paidMinutes, 0);
    const platformMinutes = worked.reduce((sum, item) => sum + item.metrics.platformMinutes, 0);
    const allStraight = worked.length > 0 && worked.every(item => !item.metrics.isSplit);
    return {
        rosterId: roster.id,
        paidMinutes,
        platformMinutes,
        combinedMinutes: paidMinutes,
        overtimePlatformMinutes: Math.max(0, platformMinutes - input.ruleProfile.weekly.overtimePlatformThresholdMinutes),
        daysWorked: worked.length,
        restViolations,
        allStraight,
    };
};

export const expectedDayTypeForRosterDay = runDayTypeForRosterDay;
