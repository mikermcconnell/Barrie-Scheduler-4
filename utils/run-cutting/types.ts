import type { DayType, RouteIdentity } from '../masterScheduleTypes';

export const OPERATIONS_PLANNING_SCHEMA_VERSION = 1 as const;

export type OperationsPlanningSchemaVersion = typeof OPERATIONS_PLANNING_SCHEMA_VERSION;
export type FindingCategory =
    | 'integrity'
    | 'contractual'
    | 'exception'
    | 'best-practice'
    | 'informational';
export type FindingSeverity = 'error' | 'warning' | 'info';
export type RuleAuthority = 'source-page' | 'planner-confirmed' | 'planner-confirmed-override';

export interface RuleSource {
    id: string;
    label: string;
    authority: RuleAuthority;
    files?: Array<{ name: string; sha256: string }>;
    confirmedBy?: string;
    note?: string;
}

export interface ReliefPointRule {
    id: string;
    name: string;
    aliases: string[];
    fullBreakPoint: boolean;
    sourceId: string;
}

export interface TravelTimeRule {
    from: string;
    to: string;
    minutes: number;
    symmetric: boolean;
    sourceId: string;
}

export interface RuleProfile {
    id: string;
    name: string;
    revision: number;
    confirmedAt: string;
    sources: RuleSource[];
    garage: { name: string; address: string };
    reliefPoints: ReliefPointRule[];
    travelTimes: TravelTimeRule[];
    signOnMinutes: number;
    circleCheckMinutes: number;
    postTripMinutes: number;
    continuousPlatformLimitMinutes: number;
    continuousPlatformBreakPenaltyMinutes: number;
    straightDrivingMaximumMinutes: number;
    splitPieceDrivingMaximumMinutes: number;
    targetBreakAfterMinutes: { minimum: number; maximum: number };
    paidThroughGapMaximumMinutes: number;
    sameRouteResetMinimumMinutes: number;
    routeChangeResetMinimumMinutes: number;
    standardBreakMinutes: { minimum: number; maximum: number };
    nonSplitExceptionBreakMinutes: { minimum: number; maximum: number };
    splitThresholdMinutes: number;
    maximumWorkMinutes: number;
    maximumDrivingMinutes: number;
    maximumSpreadMinutes: number;
    longSpreadMinutes: { threshold: number; maximumShare: number };
    preferredRunMinutes: { minimum: number; maximum: number };
    dailyStraightRunGuideMaximumShare: number;
    interlining: Array<{
        routes: string[];
        dayTypes: DayType[];
        startMinute?: number;
        note: string;
        sourceId: string;
    }>;
    reliefCabCapacity: number;
    fleetByDayType: Record<DayType, { fortyFoot: number; small: number }>;
    workforce: {
        fixedCrews: number;
        fixedSpareShuttleDrivers: number;
        vacationCrews: number;
        spareOperators: number;
        totalOperators: number;
    };
    weekly: {
        minimumPaidMinutes: number;
        maximumPlatformMinutes: number;
        maximumCombinedMinutes: number;
        minimumRestMinutes: number;
        preferredPaidMinutes: { minimum: number; maximum: number };
        overtimePlatformThresholdMinutes: number;
        overtimeMultiplier: number;
        preferredDaysWorked: number;
        preferredConsecutiveDaysOff: number;
        fourDayRosterMaximumCount: number;
        minimumFourDayRosterDaysOff: number;
        minimumConsecutiveDaysOff: number;
        partTimeAllowed: boolean;
        allStraightRosterTargetShare: number;
        weekdayStartConsistencyMinutes: { minimum: number; maximum: number };
    };
    objectiveOrder: string[];
    battParkOutCapacity?: number;
}

export interface OperationsMatrixEntry {
    fromRoute: string;
    toRoute: string;
    dayTypes: DayType[];
    allowed: boolean;
    minimumTransitionMinutes: number;
    fromReliefPoint?: string;
    toReliefPoint?: string;
    note?: string;
}

export interface OperationsMatrix {
    entries: OperationsMatrixEntry[];
}

export interface PlanningSourceManifestItem {
    sourceTeamId: string;
    routeIdentity: RouteIdentity;
    routeNumber: string;
    dayType: DayType;
    version: number;
    storagePath: string;
    contentFingerprint: string;
    blockMembershipFingerprint: string;
    pinnedAt: string;
}

export interface PlanningSourceManifest {
    items: PlanningSourceManifestItem[];
    fingerprint: string;
}

export interface PlanningTrip {
    id: string;
    sourceTripId: string;
    lineageId?: string;
    routeIdentity: RouteIdentity;
    sourceVersion: number;
    routeNumber: string;
    dayType: DayType;
    vehicleBlockKey: string;
    blockId: string;
    gtfsBlockId?: string;
    direction: 'North' | 'South';
    tripNumber: number;
    startTime: number;
    arrivalTime: number | null;
    occupiedEndTime: number | null;
    travelTime: number;
    recoveryTime: number;
    startStop: string;
    endStop: string;
    arrivalResolution: 'explicit-arrival' | 'departure-minus-recovery' | 'end-time-is-arrival' | 'unresolved';
}

export interface ValidationFinding {
    id: string;
    category: FindingCategory;
    severity: FindingSeverity;
    code: string;
    message: string;
    dayType?: DayType;
    runId?: string;
    crewId?: string;
    blockId?: string;
    tripId?: string;
    details?: Record<string, string | number | boolean | null>;
}

export interface VehicleBlockAudit {
    id: string;
    routeIdentity: RouteIdentity;
    routeIdentities: RouteIdentity[];
    sourceVersion: number;
    dayType: DayType;
    vehicleBlockKey: string;
    blockId: string;
    sourceBlockIds: string[];
    tripIds: string[];
    membershipFingerprint: string;
    firstDeparture: number;
    finalArrival: number | null;
    findings: ValidationFinding[];
}

export interface OperationsPlanningInputV1 {
    schemaVersion: OperationsPlanningSchemaVersion;
    kind: 'operations-planning-input';
    scenarioId: string;
    scenarioName: string;
    exportedAt: string;
    sourceManifest: PlanningSourceManifest;
    ruleProfile: RuleProfile;
    operationsMatrix: OperationsMatrix;
    trips: PlanningTrip[];
    blockAudits: VehicleBlockAudit[];
}

export interface RunPiece {
    id: string;
    blockId: string;
    routeNumber: string;
    tripIds: string[];
    startReliefPoint: string;
    endReliefPoint: string;
}

export interface DailyRun {
    id: string;
    runNumber: string;
    dayType: DayType;
    pieces: RunPiece[];
    notes?: string;
}

export type RosterDay = 'Monday' | 'Tuesday' | 'Wednesday' | 'Thursday' | 'Friday' | 'Saturday' | 'Sunday';

export interface WeeklyRosterAssignment {
    day: RosterDay;
    runId: string | null;
}

export interface WeeklyRoster {
    id: string;
    crewNumber: string;
    assignments: WeeklyRosterAssignment[];
    notes?: string;
}

export interface CodexProposalMetadata {
    generatedAt: string;
    model?: string;
    rationale?: string;
}

export interface OperationsPlanningProposalV1 {
    schemaVersion: OperationsPlanningSchemaVersion;
    kind: 'operations-planning-proposal';
    scenarioId: string;
    sourceManifestFingerprint: string;
    codex: CodexProposalMetadata;
    blockAudits: VehicleBlockAudit[];
    dailyRuns: DailyRun[];
    weeklyRosters: WeeklyRoster[];
    findings: ValidationFinding[];
    methodNotes: string[];
}

export interface DutyActivity {
    type: 'sign-on' | 'circle-check' | 'deadhead' | 'shuttle' | 'platform' | 'paid-gap' | 'break' | 'post-trip';
    startTime: number;
    endTime: number;
    paid: boolean;
    tripId?: string;
    note?: string;
}

export interface DailyRunMetrics {
    runId: string;
    reportTime: number | null;
    offTime: number | null;
    spreadMinutes: number;
    platformMinutes: number;
    paidMinutes: number;
    unpaidBreakMinutes: number;
    longestContinuousPlatformMinutes: number;
    pieceCount: number;
    isSplit: boolean;
    activities: DutyActivity[];
}

export interface WeeklyRosterMetrics {
    rosterId: string;
    paidMinutes: number;
    platformMinutes: number;
    combinedMinutes: number;
    overtimePlatformMinutes: number;
    daysWorked: number;
    restViolations: number;
    allStraight: boolean;
}

export interface ProposalAssessment {
    proposal: OperationsPlanningProposalV1 | null;
    dailyRunMetrics: DailyRunMetrics[];
    weeklyRosterMetrics: WeeklyRosterMetrics[];
    findings: ValidationFinding[];
    approvalReady: boolean;
}

export interface OperationsPlanningScenario {
    id: string;
    name: string;
    status: 'draft' | 'submitted' | 'approved';
    sourceManifest: PlanningSourceManifest;
    ruleProfile: RuleProfile;
    operationsMatrix: OperationsMatrix;
    activeRevision: number;
    createdAt: string;
    createdBy: string;
    updatedAt: string;
    updatedBy: string;
    submittedAt?: string;
    submittedBy?: string;
    approvedAt?: string;
    approvedBy?: string;
}

export interface PinnedMasterSchedule {
    sourceTeamId: string;
    entry: import('../masterScheduleTypes').MasterScheduleEntry;
    content: import('../masterScheduleTypes').MasterScheduleContent;
    pinnedAt: string;
}
