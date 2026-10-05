import { describe, expect, it } from 'vitest';
import { buildStrategicWorkplanAudit } from '../utils/strategic-plan/workplanAudit';
import { createStrategicWorkplanBaseline } from '../utils/strategic-plan/workplanBaseline';

describe('strategic work-plan audit', () => {
    it('attributes the initial proposal baseline publication', () => {
        const baseline = createStrategicWorkplanBaseline('barrie-team', 'planner-a');
        const audit = buildStrategicWorkplanAudit(
            null,
            baseline,
            { uid: 'planner-a', name: 'Barrie Planner' },
            '2026-08-27T13:00:00.000Z',
        );

        expect(audit.editedByUid).toBe('planner-a');
        expect(audit.editedByName).toBe('Barrie Planner');
        expect(audit.summary).toBe('Published proposal baseline with 73 tasks.');
        expect(audit.changes).toHaveLength(73);
        expect(audit.changes[0]).toMatchObject({ kind: 'added', wbs: '1.01' });
    });

    it('records changed fields plus added and deleted tasks', () => {
        const before = createStrategicWorkplanBaseline('barrie-team', 'planner-a');
        const first = before.tasks[0];
        const removed = before.tasks[1];
        const after = structuredClone(before);
        after.tasks = [
            { ...first, status: 'in-progress', progress: 25, notes: 'Kickoff complete.' },
            ...after.tasks.slice(2),
            { ...removed, id: 'new-task', wbs: 'NEW-1', title: 'New task' },
        ];

        const audit = buildStrategicWorkplanAudit(
            before,
            after,
            { uid: 'dillon-user', name: 'Dillon Planner' },
            '2026-08-27T14:00:00.000Z',
        );

        expect(audit.summary).toBe('Changed 3 tasks across 5 fields.');
        expect(audit.changes.find(change => change.taskId === first.id)?.fields).toEqual(expect.arrayContaining([
            { field: 'Status', before: 'unconfirmed', after: 'in-progress' },
            { field: 'Progress', before: '0%', after: '25%' },
            { field: 'Update note', before: 'Not set', after: 'Kickoff complete.' },
        ]));
        expect(audit.changes).toEqual(expect.arrayContaining([
            expect.objectContaining({ kind: 'added', taskId: 'new-task' }),
            expect.objectContaining({ kind: 'deleted', taskId: removed.id }),
        ]));
    });

    it('separates first-publication edits from the unchanged proposal baseline', () => {
        const baseline = createStrategicWorkplanBaseline('barrie-team', 'planner-a');
        const published = structuredClone(baseline);
        published.revision = 1;
        published.tasks[0] = { ...published.tasks[0], status: 'in-progress', progress: 10 };

        const audit = buildStrategicWorkplanAudit(
            baseline,
            published,
            { uid: 'planner-a', name: 'Barrie Planner' },
            '2026-08-27T15:00:00.000Z',
        );

        expect(audit.summary).toBe('Published proposal baseline with 73 tasks and changed 1 task across 2 fields.');
        expect(audit.changes).toHaveLength(1);
        expect(audit.changes[0].fields.map(field => field.field)).toEqual(['Status', 'Progress']);
    });
});
