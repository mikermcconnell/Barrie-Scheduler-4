import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it, vi } from 'vitest';
import {
    loadRoutePlanner2LocalDraft,
    removeRoutePlanner2LocalDraft,
    ROUTE_PLANNER_LOCAL_DRAFT_MAX_AGE_MS,
    saveRoutePlanner2LocalDraft,
} from '../utils/route-planner-2/routePlanner2LocalDraft';
import { createRoutePlanner2Project } from '../utils/route-planner-2/routePlanner2ProjectFactory';

describe('Route Planner 2 device-local draft storage', () => {
    it('saves, restores, replaces, and removes the latest scoped project', async () => {
        const indexedDb = new IDBFactory();
        const scope = { teamId: 'team-1', userId: 'user-1' };
        const first = { ...createRoutePlanner2Project({ id: 'project-1' }), name: 'First draft' };
        const replacement = { ...first, name: 'Recovered draft', updatedAt: '2026-07-31T12:00:00.000Z' };

        expect(await saveRoutePlanner2LocalDraft(scope, first, indexedDb)).toBe(true);
        expect((await loadRoutePlanner2LocalDraft(scope, indexedDb))?.project.name).toBe('First draft');

        expect(await saveRoutePlanner2LocalDraft(scope, replacement, indexedDb)).toBe(true);
        expect((await loadRoutePlanner2LocalDraft(scope, indexedDb))?.project).toEqual(replacement);

        expect(await removeRoutePlanner2LocalDraft(scope, indexedDb)).toBe(true);
        expect(await loadRoutePlanner2LocalDraft(scope, indexedDb)).toBeNull();
    });

    it('keeps drafts isolated by team and user', async () => {
        const indexedDb = new IDBFactory();
        const project = { ...createRoutePlanner2Project({ id: 'project-1' }), name: 'Private team draft' };

        await saveRoutePlanner2LocalDraft({ teamId: 'team-1', userId: 'user-1' }, project, indexedDb);

        expect(await loadRoutePlanner2LocalDraft({ teamId: 'team-2', userId: 'user-1' }, indexedDb)).toBeNull();
        expect(await loadRoutePlanner2LocalDraft({ teamId: 'team-1', userId: 'user-2' }, indexedDb)).toBeNull();
    });

    it('removes recovery copies after 30 days', async () => {
        const indexedDb = new IDBFactory();
        const scope = { teamId: 'team-1', userId: 'user-1' };
        const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(1_000);
        const project = createRoutePlanner2Project({ id: 'project-1' });

        await saveRoutePlanner2LocalDraft(scope, project, indexedDb);
        nowSpy.mockReturnValue(1_000 + ROUTE_PLANNER_LOCAL_DRAFT_MAX_AGE_MS + 1);

        expect(await loadRoutePlanner2LocalDraft(scope, indexedDb)).toBeNull();
        expect(await loadRoutePlanner2LocalDraft(scope, indexedDb)).toBeNull();
        nowSpy.mockRestore();
    });

    it('falls back cleanly when IndexedDB is unavailable', async () => {
        expect(await loadRoutePlanner2LocalDraft({ teamId: 'team-1', userId: 'user-1' }, undefined)).toBeNull();
    });
});
