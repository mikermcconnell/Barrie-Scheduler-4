import { describe, expect, it } from 'vitest';
import { createStrategicWorkplanBaseline } from '../utils/strategic-plan/workplanBaseline';

describe('Strategic Plan work-plan baseline', () => {
    it('transcribes the proposal schedule without inventing current status', () => {
        const workplan = createStrategicWorkplanBaseline('team-a', 'planner-a');

        expect(workplan.tasks).toHaveLength(73);
        expect(new Set(workplan.tasks.map(task => task.id)).size).toBe(73);
        expect(workplan.source.fileName).toBe('06-F.5.WorkPlanandSchedule.pdf');
        expect(workplan.source.proposalDate).toBe('2026-06-16');
        expect(workplan.scheduleStart).toBe('2026-08-03');
        expect(workplan.scheduleEnd).toBe('2027-09-27');
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
            startDate: '2027-09-27',
            datePrecision: 'week',
        });
    });

    it('retains weekly alignment after the four-week project-control shift', () => {
        const workplan = createStrategicWorkplanBaseline('team-a', 'planner-a');
        const initiation = workplan.tasks.find(task => task.wbs === '1.01');

        expect(initiation).toMatchObject({
            startDate: '2026-08-03',
            endDate: '2026-08-03',
        });
        expect(workplan.tasks.flatMap(task => task.segments).every(segment => {
            return new Date(`${segment.startDate}T00:00:00.000Z`).getUTCDay() === 1;
        })).toBe(true);
    });

    it('adds only resolvable project-control dependencies', () => {
        const workplan = createStrategicWorkplanBaseline('team-a', 'planner-a');
        const knownWbs = new Set(workplan.tasks.map(task => task.wbs));
        const task = (wbs: string) => workplan.tasks.find(candidate => candidate.wbs === wbs);

        expect(task('1.02')?.dependencies).toEqual(['1.01']);
        expect(task('3.25')?.dependencies).toEqual(['3.19', '3.20', '3.21', '3.22', '3.23', '3.24']);
        expect(task('4.01')?.dependencies).toEqual([
            '2.09', '3.03', '3.07', '3.13', '3.18', '3.25',
            '3.29', '3.33', '3.40', '3.44', '3.51', '3.54',
        ]);
        expect(workplan.tasks.every(candidate => {
            return candidate.dependencies.every(dependency => dependency !== candidate.wbs && knownWbs.has(dependency));
        })).toBe(true);
    });

    it('preserves tasks that have no dated bar in the source as unscheduled', () => {
        const workplan = createStrategicWorkplanBaseline('team-a', 'planner-a');

        expect(workplan.tasks.find(task => task.wbs === '1.05')).toMatchObject({ startDate: null, endDate: null });
        expect(workplan.tasks.find(task => task.wbs === '3.34')).toMatchObject({ startDate: null, endDate: null });
    });
});
