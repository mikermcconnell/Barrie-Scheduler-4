import { getTravelMinutes } from './rules';
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
    const pullOut = getTravelMinutes(rules, rules.garage.name, run.pieces[0]?.startReliefPoint ?? first.startStop) ?? 0;
    const pullIn = getTravelMinutes(rules, run.pieces.at(-1)?.endReliefPoint ?? last.endStop, rules.garage.name) ?? 0;
    const reportTime = first.startTime - pullOut - rules.circleCheckMinutes - rules.signOnMinutes;
    const finalArrival = last.arrivalTime ?? last.startTime + last.travelTime;
    const offTime = finalArrival + pullIn + rules.postTripMinutes;
    const activities: DutyActivity[] = [];
    activities.push(activity('sign-on', reportTime, reportTime + rules.signOnMinutes, true));
    activities.push(activity(
        'circle-check',
        reportTime + rules.signOnMinutes,
        reportTime + rules.signOnMinutes + rules.circleCheckMinutes,
        true,
    ));
    if (pullOut > 0) activities.push(activity('deadhead', first.startTime - pullOut, first.startTime, true, { note: 'Garage pull-out' }));

    let paidGapMinutes = 0;
    let shuttleMinutes = 0;
    let unpaidBreakMinutes = 0;
    let continuousPlatformMinutes = 0;
    let longestContinuousPlatformMinutes = 0;
    let largestInterPieceGap = 0;

    trips.forEach((trip, index) => {
        activities.push(activity('platform', trip.startTime, trip.arrivalTime ?? trip.startTime + trip.travelTime, true, { tripId: trip.id }));
        continuousPlatformMinutes += trip.travelTime;
        longestContinuousPlatformMinutes = Math.max(longestContinuousPlatformMinutes, continuousPlatformMinutes);
        const next = trips[index + 1];
        if (!next) return;
        const gap = Math.max(0, next.startTime - (trip.arrivalTime ?? trip.startTime + trip.travelTime));
        const currentPiece = pieceTrips.findIndex(piece => piece.includes(trip));
        const nextPiece = pieceTrips.findIndex(piece => piece.includes(next));
        const changesPiece = currentPiece !== nextPiece;
        if (changesPiece) largestInterPieceGap = Math.max(largestInterPieceGap, gap);
        if (changesPiece && gap >= rules.splitThresholdMinutes) {
            const backToGarage = getTravelMinutes(
                rules,
                run.pieces[currentPiece]?.endReliefPoint ?? trip.endStop,
                rules.garage.name,
            ) ?? 0;
            const outFromGarage = getTravelMinutes(
                rules,
                rules.garage.name,
                run.pieces[nextPiece]?.startReliefPoint ?? next.startStop,
            ) ?? 0;
            const availableBreak = Math.max(0, gap - backToGarage - outFromGarage);
            shuttleMinutes += backToGarage + outFromGarage;
            unpaidBreakMinutes += availableBreak;
            if (backToGarage > 0) activities.push(activity(
                'shuttle',
                (trip.arrivalTime ?? trip.startTime + trip.travelTime),
                (trip.arrivalTime ?? trip.startTime + trip.travelTime) + backToGarage,
                true,
                { note: 'Split return to Garage' },
            ));
            if (availableBreak > 0) activities.push(activity(
                'break',
                next.startTime - outFromGarage - availableBreak,
                next.startTime - outFromGarage,
                false,
                { note: 'Split break at Garage' },
            ));
            if (outFromGarage > 0) activities.push(activity(
                'shuttle',
                next.startTime - outFromGarage,
                next.startTime,
                true,
                { note: 'Split return to service' },
            ));
        } else {
            const paid = gap <= rules.paidThroughGapMaximumMinutes;
            if (paid) paidGapMinutes += gap;
            else unpaidBreakMinutes += gap;
            activities.push(activity(paid ? 'paid-gap' : 'break', next.startTime - gap, next.startTime, paid));
        }
        const resetMinimum = trip.routeNumber === next.routeNumber
            ? rules.sameRouteResetMinimumMinutes
            : rules.routeChangeResetMinimumMinutes;
        if (gap >= resetMinimum) continuousPlatformMinutes = 0;
    });

    if (pullIn > 0) activities.push(activity('deadhead', finalArrival, finalArrival + pullIn, true, { note: 'Garage pull-in' }));
    activities.push(activity('post-trip', offTime - rules.postTripMinutes, offTime, true));

    const platformMinutes = trips.reduce((sum, trip) => sum + Math.max(0, trip.travelTime), 0);
    const paidBreakPenalty = longestContinuousPlatformMinutes > rules.continuousPlatformLimitMinutes
        ? rules.continuousPlatformBreakPenaltyMinutes
        : 0;
    const paidMinutes = rules.signOnMinutes + rules.circleCheckMinutes + pullOut + pullIn
        + rules.postTripMinutes + platformMinutes + paidGapMinutes + shuttleMinutes + paidBreakPenalty;

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
        const next = worked[index + 1];
        if (!next || current.metrics.offTime === null || next.metrics.reportTime === null) return;
        const dayGap = (next.dayIndex - current.dayIndex) * 1440;
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
