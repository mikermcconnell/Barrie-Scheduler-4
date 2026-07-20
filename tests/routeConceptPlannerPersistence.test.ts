import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { RouteConceptProject } from '../utils/route-concept-planner/routeConceptPlannerTypes';

const mocks = vi.hoisted(() => ({
    rootExists: false,
    rootData: {} as Record<string, unknown>,
    getDocExists: false,
    getDocData: {} as Record<string, unknown>,
    sets: [] as Array<{ path: string; data: Record<string, unknown> }>,
}));

vi.mock('../utils/firebase', () => ({ db: {} }));

vi.mock('firebase/firestore', () => {
    const makeRef = (parts: string[]) => ({ path: parts.join('/'), id: parts.at(-1) });
    return {
        collection: (_db: unknown, ...parts: string[]) => makeRef(parts),
        doc: (...args: unknown[]) => {
            if (args.length === 1) return makeRef([String((args[0] as { path: string }).path), 'generated-copy-id']);
            return makeRef((args.slice(1) as string[]));
        },
        getDoc: vi.fn(async (ref: { id: string }) => ({
            id: ref.id,
            exists: () => mocks.getDocExists,
            data: () => mocks.getDocData,
        })),
        getDocs: vi.fn(async () => ({ docs: [] })),
        orderBy: vi.fn(() => ({})),
        query: vi.fn((ref: unknown) => ref),
        serverTimestamp: vi.fn(() => ({ __serverTimestamp: true })),
        runTransaction: vi.fn(async (_db: unknown, callback: (transaction: unknown) => Promise<void>) => {
            const transaction = {
                get: vi.fn(async () => ({
                    exists: () => mocks.rootExists,
                    data: () => mocks.rootData,
                })),
                set: vi.fn((ref: { path: string }, data: Record<string, unknown>) => {
                    mocks.sets.push({ path: ref.path, data });
                }),
                delete: vi.fn(),
            };
            return callback(transaction);
        }),
    };
});

import {
    RouteConceptPersistenceConflictError,
    RouteConceptPersistenceValidationError,
    loadRouteConceptProject,
    saveRouteConceptProject,
} from '../utils/route-concept-planner/routeConceptPlannerPersistence';

function projectFixture(): RouteConceptProject {
    return {
        id: 'project-1',
        name: 'New route concept',
        status: 'local-draft',
        schemaVersion: 1,
        revision: 0,
        selectedAlternativeId: 'alternative-1',
        alternativeOrder: ['alternative-1'],
        alternatives: [{
            id: 'alternative-1',
            name: 'Option A',
            status: 'draft',
            structure: 'loop',
            patternOrder: ['pattern-1'],
            patterns: [{
                id: 'pattern-1',
                name: 'Loop',
                role: 'loop',
                alignment: [],
                stops: [{
                    id: 'stop-1',
                    name: 'Terminal',
                    lat: 44.39,
                    lng: -79.69,
                    sequence: 0,
                    role: 'start-terminal',
                    source: 'custom',
                }],
                runtimeEvidence: [],
                runtimeOverrides: {},
                notes: '',
                createdAt: '2026-07-16T12:00:00.000Z',
                updatedAt: '2026-07-16T12:00:00.000Z',
            }],
            service: {
                firstDepartureMinutes: 360,
                lastDepartureMinutes: 1320,
                frequencyMinutes: 30,
                startTerminalLayoverMinutes: 5,
                endTerminalLayoverMinutes: 0,
                intermediateStopDwellSeconds: 20,
                dayType: 'weekday',
                planningPeriod: 'all-day',
            },
            notes: '',
            createdAt: '2026-07-16T12:00:00.000Z',
            updatedAt: '2026-07-16T12:00:00.000Z',
        }],
        createdAt: '2026-07-16T12:00:00.000Z',
        updatedAt: '2026-07-16T12:00:00.000Z',
    };
}

describe('Route Concept Planner persistence', () => {
    beforeEach(() => {
        mocks.rootExists = false;
        mocks.rootData = {};
        mocks.getDocExists = false;
        mocks.getDocData = {};
        mocks.sets = [];
    });

    it('creates revision one and stores alternatives and patterns in isolated subcollections', async () => {
        const saved = await saveRouteConceptProject('team-1', 'user-1', projectFixture(), 0);

        expect(saved.revision).toBe(1);
        expect(saved.updatedBy).toBe('user-1');
        expect(mocks.sets.map((write) => write.path)).toEqual([
            'teams/team-1/routeConceptPlannerProjects/project-1',
            'teams/team-1/routeConceptPlannerProjects/project-1/alternatives/alternative-1',
            'teams/team-1/routeConceptPlannerProjects/project-1/alternatives/alternative-1/patterns/pattern-1',
        ]);
        expect(JSON.stringify(mocks.sets)).not.toMatch(/camper|riderManifest|sourceRows/i);
    });

    it('rejects stale revisions with explicit reload and save-as-copy resolutions', async () => {
        mocks.rootExists = true;
        mocks.rootData = {
            revision: 2,
            createdAt: 'existing',
            createdBy: 'other-user',
        };

        const project = projectFixture();
        project.revision = 1;
        const error = await saveRouteConceptProject('team-1', 'user-1', project, 1).catch((reason: unknown) => reason);

        expect(error).toBeInstanceOf(RouteConceptPersistenceConflictError);
        expect(error).toMatchObject({
            expectedRevision: 1,
            actualRevision: 2,
            resolutions: ['reload', 'save-as-copy'],
        });
        expect(mocks.sets).toEqual([]);
    });

    it('validates alternative ownership and ordering before writing', async () => {
        const project = projectFixture();
        project.alternativeOrder = ['missing-alternative'];

        await expect(saveRouteConceptProject('team-1', 'user-1', project, 0))
            .rejects.toBeInstanceOf(RouteConceptPersistenceValidationError);
        expect(mocks.sets).toEqual([]);
    });

    it('rejects Camp-specific fields instead of persisting them in the neutral model', async () => {
        const project = projectFixture();
        Object.assign(project.alternatives[0].patterns[0].stops[0], { camperCount: 12 });

        await expect(saveRouteConceptProject('team-1', 'user-1', project, 0))
            .rejects.toBeInstanceOf(RouteConceptPersistenceValidationError);
        expect(mocks.sets).toEqual([]);
    });

    it('rejects loaded project metadata that does not belong to the requested team', async () => {
        mocks.getDocExists = true;
        mocks.getDocData = {
            id: 'project-1',
            teamId: 'different-team',
            schemaVersion: 1,
            revision: 1,
            name: 'Wrong owner',
            status: 'local-saved',
            selectedAlternativeId: '',
            alternativeOrder: [],
            alternativeCount: 0,
            createdAt: new Date(),
            updatedAt: new Date(),
            updatedBy: 'user-1',
        };

        await expect(loadRouteConceptProject('team-1', 'project-1'))
            .rejects.toBeInstanceOf(RouteConceptPersistenceValidationError);
    });
});
