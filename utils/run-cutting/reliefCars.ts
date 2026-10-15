import { calculatePieceTransition, resolvePieceBoardingTime } from './dutyTransitions';
import { findReliefPoint, getTravelMinutes } from './rules';
import type { DailyRun, OperationsPlanningInputV1, PlanningTrip, RuleProfile } from './types';

/**
 * Relief cars carry operators between the Garage and a relief point, as the board-period paddles
 * show (September 20, 2026): only where a run starts or ends partway through a bus's day, or around
 * a Garage break. Lunches, walking to the next bus, and moves between relief points within a run
 * (shuttles) do not use a relief car. Operators leaving the same place for the same place within
 * this many minutes share one car.
 */
export const RELIEF_CAR_SHARING_MINUTES = 5;

export interface ReliefCarTrip {
    runId: string;
    dayType: DailyRun['dayType'];
    direction: 'to-relief' | 'to-garage';
    reliefPoint: string;
    start: number;
    end: number;
}

export const calculateReliefCarTrips = (
    input: OperationsPlanningInputV1,
    run: DailyRun,
    tripById: Map<string, PlanningTrip>,
): ReliefCarTrip[] => {
    const rules = input.ruleProfile;
    const garage = rules.garage.name;
    const trips: ReliefCarTrip[] = [];
    run.pieces.forEach((piece, index) => {
        const audit = input.blockAudits.find(item => item.vehicleBlockKey === piece.blockId);
        const first = tripById.get(piece.tripIds[0]);
        const last = tripById.get(piece.tripIds.at(-1) ?? '');
        if (!audit || !first || !last || last.arrivalTime === null) return;
        const before = index > 0 ? calculatePieceTransition(input, run.pieces[index - 1], piece, tripById) : null;
        const after = index < run.pieces.length - 1 ? calculatePieceTransition(input, piece, run.pieces[index + 1], tripById) : null;
        const arrivesFromGarage = index === 0 || before?.breakLocation === garage;
        const leavesForGarage = index === run.pieces.length - 1 || after?.breakLocation === garage;
        if (arrivesFromGarage && audit.tripIds[0] !== first.id) {
            const travel = getTravelMinutes(rules, garage, piece.startReliefPoint);
            const boarding = resolvePieceBoardingTime(input, piece, tripById) ?? first.startTime;
            if (travel !== null && travel > 0) trips.push({ runId: run.id, dayType: run.dayType, direction: 'to-relief', reliefPoint: piece.startReliefPoint, start: boarding - travel, end: boarding });
        }
        if (leavesForGarage && audit.tripIds.at(-1) !== last.id) {
            const travel = getTravelMinutes(rules, piece.endReliefPoint, garage);
            if (travel !== null && travel > 0) trips.push({ runId: run.id, dayType: run.dayType, direction: 'to-garage', reliefPoint: piece.endReliefPoint, start: last.arrivalTime, end: last.arrivalTime + travel });
        }
    });
    return trips;
};

/** Most relief cars on the road at once, after operators travelling together share a car. */
export const peakReliefCarsOnRoad = (rules: RuleProfile, trips: ReliefCarTrip[]): number => {
    const place = (name: string) => findReliefPoint(rules, name)?.id ?? name;
    const cars: Array<{ direction: string; place: string; firstStart: number; start: number; end: number }> = [];
    [...trips].sort((left, right) => left.start - right.start).forEach(trip => {
        const shared = cars.find(car => car.direction === trip.direction && car.place === place(trip.reliefPoint)
            && trip.start - car.firstStart <= RELIEF_CAR_SHARING_MINUTES);
        if (shared) {
            shared.start = Math.min(shared.start, trip.start);
            shared.end = Math.max(shared.end, trip.end);
        } else {
            cars.push({ direction: trip.direction, place: place(trip.reliefPoint), firstStart: trip.start, start: trip.start, end: trip.end });
        }
    });
    const events = cars.flatMap(car => [{ time: car.start, delta: 1 }, { time: car.end, delta: -1 }])
        .sort((left, right) => left.time - right.time || left.delta - right.delta);
    let active = 0;
    let peak = 0;
    events.forEach(event => { active += event.delta; peak = Math.max(peak, active); });
    return peak;
};
