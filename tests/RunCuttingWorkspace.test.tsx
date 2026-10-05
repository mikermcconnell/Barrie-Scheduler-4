import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
    OperationsPlanningProposalV1,
    PlanningSourceManifest,
    ProposalAssessment,
    RuleProfile,
} from '../utils/run-cutting';
import type {
    OperationsPlanningRevisionPayload,
    OperationsPlanningScenarioMetadata,
} from '../utils/services/operationsPlanningService';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const harness = vi.hoisted(() => {
    const metadata: OperationsPlanningScenarioMetadata = {
        id: 'scenario-1', schemaVersion: 1, teamId: 'team-1', name: 'Sunday service run cut',
        status: 'draft', activeRevision: 1,
        storagePath: 'teams/team-1/operationsPlanningScenarios/scenario-1/versions/1.json',
        payloadBytes: 100, sourceManifestFingerprint: 'manifest-1', sourceIsStale: false,
        sourceCheckedAt: new Date('2026-08-27T12:00:00Z'), integrityBlockerCount: 0,
        contractualBlockerCount: 0, warningCount: 0, createdAt: new Date('2026-08-27T12:00:00Z'),
        createdBy: 'user-1', updatedAt: new Date('2026-08-27T12:00:00Z'), updatedBy: 'user-1',
    };
    const manifest: PlanningSourceManifest = {
        fingerprint: 'manifest-1',
        items: [{
            sourceTeamId: 'team-1', routeIdentity: '8A-Sunday', routeNumber: '8A', dayType: 'Sunday',
            version: 3, storagePath: 'teams/team-1/masterSchedules/8A-Sunday-v3.json',
            contentFingerprint: 'content-1', blockMembershipFingerprint: 'blocks-1', pinnedAt: '2026-08-27T12:00:00Z',
        }],
    };
    const rules: RuleProfile = {
        id: 'rules-1', name: 'Barrie confirmed rules', revision: 1, confirmedAt: '2026-08-27T12:00:00Z',
        sources: [], reliefPoints: [], travelTimes: [], garage: { name: 'Garage', address: '133 Welham Road' },
        signOnMinutes: 5, circleCheckMinutes: 10, postTripMinutes: 5,
        continuousPlatformLimitMinutes: 300, continuousPlatformBreakPenaltyMinutes: 30,
        straightDrivingMaximumMinutes: 450, splitPieceDrivingMaximumMinutes: 300,
        targetBreakAfterMinutes: { minimum: 255, maximum: 285 }, paidThroughGapMaximumMinutes: 15,
        sameRouteResetMinimumMinutes: 30, routeChangeResetMinimumMinutes: 42,
        standardBreakMinutes: { minimum: 42, maximum: 75 }, nonSplitExceptionBreakMinutes: { minimum: 76, maximum: 89 },
        splitThresholdMinutes: 90, maximumWorkMinutes: 660, maximumDrivingMinutes: 660,
        maximumSpreadMinutes: 720, longSpreadMinutes: { threshold: 660, maximumShare: 0.1 },
        preferredRunMinutes: { minimum: 420, maximum: 600 }, dailyStraightRunGuideMaximumShare: 0.25, interlining: [], reliefCabCapacity: 6,
        fleetByDayType: { Weekday: { fortyFoot: 31, small: 6 }, Saturday: { fortyFoot: 31, small: 5 }, Sunday: { fortyFoot: 17, small: 5 } },
        workforce: { fixedCrews: 112, fixedSpareShuttleDrivers: 2, vacationCrews: 8, spareOperators: 13, totalOperators: 135 },
        weekly: { minimumPaidMinutes: 2310, maximumPlatformMinutes: 2400, maximumCombinedMinutes: 2640, minimumRestMinutes: 600, preferredPaidMinutes: { minimum: 2340, maximum: 2520 }, overtimePlatformThresholdMinutes: 2400, overtimeMultiplier: 1.5, preferredDaysWorked: 5, preferredConsecutiveDaysOff: 2, fourDayRosterMaximumCount: 8, minimumFourDayRosterDaysOff: 3, minimumConsecutiveDaysOff: 2, partTimeAllowed: false, allStraightRosterTargetShare: 0.2, weekdayStartConsistencyMinutes: { minimum: 30, maximum: 120 } },
        objectiveOrder: [],
    };
    const proposal: OperationsPlanningProposalV1 = { schemaVersion: 1, kind: 'operations-planning-proposal', scenarioId: 'scenario-1', sourceManifestFingerprint: 'manifest-1', codex: { generatedAt: '2026-08-27T13:00:00Z' }, dailyRuns: [], weeklyRosters: [], blockAudits: [], findings: [], methodNotes: [] };
    const assessment: ProposalAssessment = { proposal, dailyRunMetrics: [], weeklyRosterMetrics: [], findings: [], approvalReady: true };
    const payload: OperationsPlanningRevisionPayload = { schemaVersion: 1, kind: 'operations-planning-scenario-revision', teamId: 'team-1', scenarioId: 'scenario-1', revision: 1, name: metadata.name, sourceManifest: manifest, ruleProfile: rules, operationsMatrix: { entries: [] }, assessment: null, validation: { sourceIsStale: false, integrityBlockerCount: 0, contractualBlockerCount: 0, warningCount: 0 }, sourceCheckedAt: '2026-08-27T12:00:00Z', savedAt: '2026-08-27T12:00:00Z', savedBy: 'user-1' };
    return {
        metadata, manifest, rules, proposal, assessment, payload,
        user: { uid: 'user-1' }, team: { id: 'team-1', name: 'Barrie Transit' },
        toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn() },
        create: vi.fn(), save: vi.fn(), submit: vi.fn(), approve: vi.fn(),
        getScenario: vi.fn(), list: vi.fn(), loadRevision: vi.fn(),
        assess: vi.fn(), buildInput: vi.fn(),
    };
});

vi.mock('../components/contexts/AuthContext', () => ({ useAuth: () => ({ user: harness.user, isGlobalAdmin: false }) }));
vi.mock('../components/contexts/TeamContext', () => ({ useTeam: () => ({ team: harness.team, teamMember: { role: 'admin' }, teamRole: 'admin', canManageTeam: true, developerPreview: null as null }) }));
vi.mock('../components/contexts/ToastContext', () => ({ useToast: () => harness.toast }));
vi.mock('../hooks/useWorkspaceAccess', () => ({ useWorkspaceAccess: () => ({ accessLevel: 'internal', canAccess: () => true, loading: false }) }));
vi.mock('../utils/services/masterScheduleService', () => ({
    getAllMasterSchedules: vi.fn(async () => [{ id: '8A-Sunday', routeNumber: '8A', dayType: 'Sunday', currentVersion: 3, storagePath: 'master.json', tripCount: 0, northStopCount: 0, southStopCount: 0, updatedAt: new Date(), updatedBy: 'user-1', uploaderName: 'Planner', source: 'draft' }]),
    getMasterSchedule: vi.fn(async () => ({ entry: { id: '8A-Sunday', routeNumber: '8A', dayType: 'Sunday', currentVersion: 3, storagePath: 'master.json', tripCount: 0, northStopCount: 0, southStopCount: 0, updatedAt: new Date(), updatedBy: 'user-1', uploaderName: 'Planner', source: 'draft' }, content: { northTable: { routeNumber: '8A', direction: 'North', stops: [], trips: [] }, southTable: { routeNumber: '8A', direction: 'South', stops: [], trips: [] }, metadata: { routeNumber: '8A', dayType: 'Sunday', uploadedAt: '2026-08-27T12:00:00Z' } } })),
    getVersionContent: vi.fn(async () => null),
}));
vi.mock('../utils/services/operationsPlanningService', () => ({
    listOperationsPlanningScenarios: harness.list,
    getOperationsPlanningScenario: harness.getScenario,
    loadOperationsPlanningScenarioRevision: harness.loadRevision,
    createOperationsPlanningScenario: harness.create,
    saveOperationsPlanningRevision: harness.save,
    submitOperationsPlanningScenario: harness.submit,
    approveOperationsPlanningScenario: harness.approve,
}));
vi.mock('../utils/run-cutting', () => ({
    buildOperationsPlanningInput: harness.buildInput,
    assessOperationsPlanningProposal: harness.assess,
    assessSourceFreshness: vi.fn(() => []),
    downloadJson: vi.fn(),
    downloadOperationsPlanningWorkbook: vi.fn(),
    splitDailyRun: vi.fn(), mergeDailyRuns: vi.fn(), moveRunPiece: vi.fn(), renumberDailyRun: vi.fn(), assignDailyRunToCrew: vi.fn(),
}));

import { FixedRouteWorkspace } from '../components/workspaces/FixedRouteWorkspace';
import { RunCuttingWorkspace, validateOperationsPlanningProposalFile } from '../components/workspaces/RunCuttingWorkspace';

const findButton = (container: HTMLElement, label: string) => Array.from(container.querySelectorAll('button')).find(button => button.textContent?.includes(label)) as HTMLButtonElement | undefined;
const flush = async () => { await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); }); };

describe('RunCuttingWorkspace', () => {
    let container: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
        harness.list.mockReset().mockResolvedValue([]);
        harness.create.mockReset().mockResolvedValue({ metadata: harness.metadata, payload: harness.payload });
        harness.save.mockReset().mockImplementation(async (input: { assessment: unknown }) => ({
            metadata: { ...harness.metadata, activeRevision: 2 },
            payload: { ...harness.payload, revision: 2, assessment: input.assessment },
        }));
        harness.submit.mockReset().mockResolvedValue(undefined);
        harness.getScenario.mockReset().mockResolvedValue({ ...harness.metadata, status: 'submitted' });
        harness.assess.mockReset().mockReturnValue(harness.assessment);
        harness.buildInput.mockReset().mockImplementation((options: { scenarioId: string; scenarioName: string }) => ({
            schemaVersion: 1, kind: 'operations-planning-input', scenarioId: options.scenarioId,
            scenarioName: options.scenarioName, exportedAt: '2026-08-27T12:00:00Z',
            sourceManifest: harness.manifest, ruleProfile: harness.rules, operationsMatrix: { entries: [] },
            trips: [], blockAudits: [],
        }));
    });

    afterEach(() => {
        act(() => root.unmount());
        container.remove();
        window.location.hash = '';
    });

    it('rejects non-JSON and oversized proposal files before parsing', () => {
        expect(validateOperationsPlanningProposalFile(new File(['x'], 'proposal.txt', { type: 'text/plain' }))).toContain('.json');
        const oversized = new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'proposal.json', { type: 'application/json' });
        expect(validateOperationsPlanningProposalFile(oversized)).toContain('10 MB');
    });

    it('exposes the dashboard card and canonical fixed-route hash', async () => {
        window.location.hash = '#fixed';
        await act(async () => root.render(<FixedRouteWorkspace />));
        const card = findButton(container, 'Run Cutting & Rostering');
        expect(card).toBeTruthy();
        await act(async () => card?.click());
        await flush();
        expect(window.location.hash).toBe('#fixed/run-cutting');
    });

    it('requires an imported proposal to be saved before submission', async () => {
        await act(async () => root.render(<RunCuttingWorkspace onClose={vi.fn()} />));
        await flush();
        await act(async () => findButton(container, 'Create and pin current versions')?.click());
        await flush();
        expect(container.textContent).toContain('External Codex handoff');

        const input = container.querySelector('input[type="file"]') as HTMLInputElement;
        const file = new File(['{}'], 'operations-planning-proposal-v1.json', { type: 'application/json' });
        Object.defineProperty(file, 'text', { value: async () => '{}' });
        Object.defineProperty(input, 'files', { configurable: true, value: [file] });
        await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
        await flush();

        expect(container.textContent).toContain('Unsaved proposal or source-check changes');
        expect(findButton(container, 'Submit for approval')?.disabled).toBe(true);
        await act(async () => findButton(container, 'Save revision')?.click());
        await flush();
        expect(container.textContent).not.toContain('Unsaved proposal or source-check changes');
        expect(findButton(container, 'Submit for approval')?.disabled).toBe(false);
        await act(async () => findButton(container, 'Submit for approval')?.click());
        await flush();
        expect(harness.submit).toHaveBeenCalledOnce();
    });
});
