import type { OperationsMatrix, RuleProfile } from './types';

const MINUTE = 60;

export const BARRIE_RULE_SOURCE_IDS = {
    unionPages: 'union-rule-pages-2026-08-27',
    plannerConfirmations: 'planner-confirmations-2026-08-27',
    parkPlaceOverride: 'park-place-break-override-2026-08-27',
} as const;

export const createDefaultBarrieRuleProfile = (
    confirmedAt = '2026-08-27T13:37:00.000Z',
): RuleProfile => ({
    id: 'barrie-operations-rules-v1',
    name: 'Barrie Transit operations rules',
    revision: 1,
    confirmedAt,
    sources: [
        {
            id: BARRIE_RULE_SOURCE_IDS.unionPages,
            label: 'Union and operations source pages supplied by planner',
            authority: 'source-page',
            files: [
                { name: '20260827_091718.jpg', sha256: 'fd3928f7800527bc55357a19b9f5ac829ef6ad3ab5dedd30b7f17a1d08997d1e' },
                { name: '20260827_091726.jpg', sha256: '77c30b9675b5b8d3713a963d6dad0e08268a8f4d1c78ec51397ca6eeaeefc3b3' },
                { name: '20260827_091732.jpg', sha256: 'a219ae74327371b01b83a9fb685a11d0835a32ad2897ded21b49c4f869920918' },
                { name: '20260827_091739.jpg', sha256: '6cc9bbe927527d48b2971fbc69b8a375b90593b269b5ab30e46d0e29ec459e0f' },
                { name: '20260827_091744.jpg', sha256: '7b9e6983448311127cda18c8c667eb478187c2224692f3670ca79ef9f4c0235d' },
                { name: '20260827_091749.jpg', sha256: 'ba440dd1358078140a788566ef989bd58f6a5855f974bb98738515b0f1cea765' },
                { name: '20260827_091752.jpg', sha256: '5023b77d0e989b2c81e2b91a65ed9a210b3743a174e10b15b5c80d1570c88100' },
                { name: '20260827_094725.jpg', sha256: '7baee1398628b5630616c0f45aa301f13b1c08e3a0ead01a8192291863de439e' },
                { name: '20260827_094729.jpg', sha256: 'eaa5f3cf436e20fca5a3b79dafe7b56494c8bd46a9cecccfd8fc53e7f4e45813' },
                { name: '20260827_094734.jpg', sha256: 'c4d025866e66f6c95e7ed0bd4b96227dc7e985c98c7395d4414f4b05dcb936fa' },
                { name: '20260827_094737.jpg', sha256: 'e3553e99f8b75b5ddc04d26ffca1ed21c80b88759415277868962d960a2e8b10' },
                { name: '20260827_094741.jpg', sha256: '0ec0c3e6ee1dcbb036ba3326c05dc748c56a02b48081ad732f6c94bf61589d3b' },
                { name: '20260827_094746.jpg', sha256: '53efd15e711dd1d4c36baf1631b6954ec620557051e184e94dd1d094baf2b3e3' },
                { name: '20260827_094748.jpg', sha256: 'ef94710ef8691565abf4511542bcc1988483b0377754c0b433d7530871105032' },
            ],
            note: 'Fourteen unique source photographs are retained by filename and SHA-256 only. 20260827_091726 (1).jpg was an exact duplicate and is not double-counted.',
        },
        {
            id: BARRIE_RULE_SOURCE_IDS.plannerConfirmations,
            label: 'Planner confirmations supplied with the source pages',
            authority: 'planner-confirmed',
            confirmedBy: 'Planner',
        },
        {
            id: BARRIE_RULE_SOURCE_IDS.parkPlaceOverride,
            label: 'Park Place full-break-point override',
            authority: 'planner-confirmed-override',
            confirmedBy: 'Planner',
            note: 'The supplied pages name B.A.T.T. and Garage; the planner explicitly confirmed Park Place as an additional full break point.',
        },
    ],
    garage: { name: 'Garage', address: '133 Welham Road' },
    reliefPoints: [
        {
            id: 'park-place',
            name: 'Park Place',
            aliases: ['Park Place'],
            fullBreakPoint: true,
            sourceId: BARRIE_RULE_SOURCE_IDS.parkPlaceOverride,
        },
        {
            id: 'batt',
            name: 'B.A.T.T.',
            aliases: ['B.A.T.T.', 'BATT', 'Barrie Allandale Transit Terminal', 'Allandale Transit Terminal'],
            fullBreakPoint: true,
            sourceId: BARRIE_RULE_SOURCE_IDS.unionPages,
        },
        {
            id: 'downtown-hub',
            name: 'Downtown Hub',
            aliases: ['Downtown Hub', 'Downtown Terminal', 'Downtown Transit Terminal'],
            fullBreakPoint: false,
            sourceId: BARRIE_RULE_SOURCE_IDS.unionPages,
        },
        {
            id: 'garage',
            name: 'Garage',
            aliases: ['Garage', '133 Welham Road'],
            fullBreakPoint: true,
            sourceId: BARRIE_RULE_SOURCE_IDS.unionPages,
        },
    ],
    travelTimes: ([
        ['Downtown Hub', 15],
        ['B.A.T.T.', 12],
        ['Barrie South GO', 8],
        ['Park Place', 6],
        ['Georgian Mall', 20],
        ['Georgian College', 20],
        ['RVH', 20],
        ['Sproule at Kraus', 20],
    ] as Array<[string, number]>).map(([location, minutes]) => ({
        from: 'Garage',
        to: location,
        minutes,
        symmetric: true,
        sourceId: BARRIE_RULE_SOURCE_IDS.plannerConfirmations as string,
    })).concat([{
        from: 'B.A.T.T.',
        to: 'Downtown Hub',
        minutes: 11,
        symmetric: false,
        sourceId: BARRIE_RULE_SOURCE_IDS.unionPages as string,
    }]),
    signOnMinutes: 5,
    circleCheckMinutes: 10,
    postTripMinutes: 5,
    continuousPlatformLimitMinutes: 5 * MINUTE,
    continuousPlatformBreakPenaltyMinutes: 30,
    straightDrivingMaximumMinutes: 7.5 * MINUTE,
    splitPieceDrivingMaximumMinutes: 5 * MINUTE,
    targetBreakAfterMinutes: { minimum: 4.25 * MINUTE, maximum: 4.75 * MINUTE },
    paidThroughGapMaximumMinutes: 15,
    sameRouteResetMinimumMinutes: 30,
    routeChangeResetMinimumMinutes: 42,
    standardBreakMinutes: { minimum: 42, maximum: 75 },
    nonSplitExceptionBreakMinutes: { minimum: 76, maximum: 89 },
    splitThresholdMinutes: 90,
    maximumWorkMinutes: 11 * MINUTE,
    maximumDrivingMinutes: 11 * MINUTE,
    maximumSpreadMinutes: 12 * MINUTE,
    longSpreadMinutes: { threshold: 11 * MINUTE, maximumShare: 0.10 },
    preferredRunMinutes: { minimum: 7 * MINUTE, maximum: 10 * MINUTE },
    dailyStraightRunGuideMaximumShare: 0.25,
    interlining: [{
        routes: ['8A', '8B'],
        dayTypes: ['Weekday', 'Saturday'],
        startMinute: 20 * MINUTE,
        note: '8A/8B interlining is allowed after 8:00 PM.',
        sourceId: BARRIE_RULE_SOURCE_IDS.plannerConfirmations,
    }, {
        routes: ['8A', '8B'],
        dayTypes: ['Sunday'],
        note: '8A/8B interlining is allowed all day Sunday.',
        sourceId: BARRIE_RULE_SOURCE_IDS.plannerConfirmations,
    }],
    reliefCabCapacity: 6,
    fleetByDayType: {
        Weekday: { fortyFoot: 31, small: 6 },
        Saturday: { fortyFoot: 31, small: 5 },
        Sunday: { fortyFoot: 17, small: 5 },
    },
    workforce: {
        fixedCrews: 112,
        fixedSpareShuttleDrivers: 2,
        vacationCrews: 8,
        spareOperators: 13,
        totalOperators: 135,
    },
    weekly: {
        minimumPaidMinutes: 38.5 * MINUTE,
        maximumPlatformMinutes: 40 * MINUTE,
        maximumCombinedMinutes: 44 * MINUTE,
        minimumRestMinutes: 10 * MINUTE,
        preferredPaidMinutes: { minimum: 39 * MINUTE, maximum: 42 * MINUTE },
        overtimePlatformThresholdMinutes: 40 * MINUTE,
        overtimeMultiplier: 1.5,
        preferredDaysWorked: 5,
        preferredConsecutiveDaysOff: 2,
        fourDayRosterMaximumCount: 8,
        minimumFourDayRosterDaysOff: 3,
        minimumConsecutiveDaysOff: 2,
        partTimeAllowed: false,
        allStraightRosterTargetShare: 0.20,
        weekdayStartConsistencyMinutes: { minimum: 30, maximum: 120 },
    },
    objectiveOrder: [
        'integrity-and-contract-compliance',
        'run-quality',
        'fewer-splits-and-awkward-reliefs',
        'overtime-and-guarantee-exposure',
        'fewer-runs',
        'operating-cost',
    ],
    // Capacity was not provided. Leaving it undefined makes the validator report
    // "not evaluated" instead of inventing an operating constraint.
    battParkOutCapacity: undefined,
});

export const createDefaultBarrieOperationsMatrix = (): OperationsMatrix => ({
    entries: [
        {
            fromRoute: '8A',
            toRoute: '8B',
            dayTypes: ['Sunday'],
            allowed: true,
            minimumTransitionMinutes: 0,
            note: 'Sunday all-day interlining.',
        },
        {
            fromRoute: '8B',
            toRoute: '8A',
            dayTypes: ['Sunday'],
            allowed: true,
            minimumTransitionMinutes: 0,
            note: 'Sunday all-day interlining.',
        },
        {
            fromRoute: '8A',
            toRoute: '8B',
            dayTypes: ['Weekday', 'Saturday'],
            allowed: true,
            minimumTransitionMinutes: 0,
            note: 'Allowed only after 8:00 PM; the time-window validator applies the additional condition.',
        },
        {
            fromRoute: '8B',
            toRoute: '8A',
            dayTypes: ['Weekday', 'Saturday'],
            allowed: true,
            minimumTransitionMinutes: 0,
            note: 'Allowed only after 8:00 PM; the time-window validator applies the additional condition.',
        },
    ],
});

export const findReliefPoint = (profile: RuleProfile, stopName: string) => {
    const normalize = (value: string) => value
        .replace(/\s+\(\d+\)\s*$/, '')
        .replace(/\s+Platform\s+\d+\s*$/i, '')
        .trim()
        .toLocaleLowerCase();
    const normalized = normalize(stopName);
    return profile.reliefPoints.find(point =>
        normalize(point.name) === normalized
        || point.aliases.some(alias => normalize(alias) === normalized),
    );
};

export const getTravelMinutes = (profile: RuleProfile, from: string, to: string): number | null => {
    const normalize = (value: string) => {
        const normalized = value
            .replace(/\s+\(\d+\)\s*$/, '')
            .replace(/\s+Platform\s+\d+\s*$/i, '')
            .trim()
            .toLocaleLowerCase();
        if (normalized === 'barrie south go station') return 'barrie south go';
        if (normalized === 'rvh main entrance') return 'rvh';
        if (/^(barrie\s+)?allandale(?:\s+go|\s+transit\s+terminal)?$/.test(normalized)) return 'b.a.t.t.';
        if (/^downtown(?:\s+hub|\s+terminal|\s+transit\s+terminal)?$/.test(normalized)) return 'downtown hub';
        return normalized;
    };
    const direct = profile.travelTimes.find(rule =>
        normalize(rule.from) === normalize(from) && normalize(rule.to) === normalize(to),
    );
    if (direct) return direct.minutes;
    const reverse = profile.travelTimes.find(rule =>
        rule.symmetric && normalize(rule.from) === normalize(to) && normalize(rule.to) === normalize(from),
    );
    return reverse?.minutes ?? null;
};
