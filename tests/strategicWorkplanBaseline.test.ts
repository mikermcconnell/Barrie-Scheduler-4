import { describe, expect, it } from 'vitest';
import { createStrategicWorkplanBaseline } from '../utils/strategic-plan/workplanBaseline';

describe('Strategic Plan work-plan baseline', () => {
    it('transcribes the proposal schedule without inventing current status', () => {
        const workplan = createStrategicWorkplanBaseline('team-a', 'planner-a');

        expect(workplan.tasks).toHaveLength(73);
        expect(new Set(workplan.tasks.map(task => task.id)).size).toBe(73);
        expect(workplan.source.fileName).toBe('06-F.5.WorkPlanandSchedule.pdf');
        expect(workplan.source.proposalDate).toBe('2026-06-16');
        expect(workplan.tasks.every(task => task.status === 'unconfirmed')).toBe(true);
        expect(workplan.tasks.every(task => task.progress === 0)).toBe(true);
    });

    it('retains weekly task, deliverable, review, meeting, and engagement markers', () => {
        const workplan = createStrategicWorkplanBaseline('team-a', 'planner-a');
        const engagementPlan = workplan.tasks.find(task => task.wbs === '2.01');
        const projectEngagement = workplan.tasks.find(task => task.wbs === '2.02');
        const finalPlan = workplan.tasks.find(task => task.wbs === '4.03');

        expect(engagementPlan?.segments.map(segment => segment.type)).toEqual([
            'task',
            'draft-deliverable',
            'review',
            'final-deliverable',
        ]);
        expect(projectEngagement?.segments.some(segment => segment.label === 'Working session 7')).toBe(true);
        expect(finalPlan?.segments.at(-1)).toMatchObject({
            type: 'final-deliverable',
            startDate: '2027-08-30',
            datePrecision: 'week',
        });
    });

    it('preserves tasks that have no dated bar in the source as unscheduled', () => {
        const workplan = createStrategicWorkplanBaseline('team-a', 'planner-a');

        expect(workplan.tasks.find(task => task.wbs === '1.05')).toMatchObject({ startDate: null, endDate: null });
        expect(workplan.tasks.find(task => task.wbs === '3.34')).toMatchObject({ startDate: null, endDate: null });
    });
});
