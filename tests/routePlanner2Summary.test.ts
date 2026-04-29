import { describe, expect, it } from 'vitest';

import { addRoutePlanner2Stop, updateRoutePlanner2StopRole } from '../utils/route-planner-2/routePlanner2Authoring';
import { markRoutePlanner2PreferredScenario } from '../utils/route-planner-2/routePlanner2ProjectController';
import { createRoutePlanner2Project } from '../utils/route-planner-2/routePlanner2ProjectFactory';
import { summarizeRoutePlanner2Project, summarizeRoutePlanner2Scenario } from '../utils/route-planner-2/routePlanner2Summary';

describe('Route Planner 2 summary', () => {
  const now = '2026-04-29T12:00:00.000Z';

  function validTwoStopProject() {
    let project = createRoutePlanner2Project({ id: 'project-1', scenarioId: 'scenario-1', now });
    project = addRoutePlanner2Stop(project, 'scenario-1', { id: 'stop-1', name: 'Start', lat: 44.38, lng: -79.7, now });
    project = addRoutePlanner2Stop(project, 'scenario-1', { id: 'stop-2', name: 'End', lat: 44.4, lng: -79.65, now });
    project = updateRoutePlanner2StopRole(project, 'scenario-1', 'stop-1', 'start-terminal', now);
    project = updateRoutePlanner2StopRole(project, 'scenario-1', 'stop-2', 'end-terminal', now);
    return project;
  }

  it('summarizes blank scenarios as not ready with a next action', () => {
    const project = createRoutePlanner2Project({ id: 'project-1', scenarioId: 'scenario-1', now });
    const summary = summarizeRoutePlanner2Scenario(project.scenarios[0]!);

    expect(summary.readiness).toBe('not-ready');
    expect(summary.readinessLabel).toBe('Not ready');
    expect(summary.summaryText).toContain('blocking issue');
    expect(summary.nextAction).toContain('Add at least');
    expect(summary.oneWayRuntimeLabel).toBe('Not ready');
  });

  it('summarizes valid fallback estimates for comparison', () => {
    const project = validTwoStopProject();
    const summary = summarizeRoutePlanner2Scenario(project.scenarios[0]!);

    expect(summary.readiness).toBe('needs-review');
    expect(summary.readinessLabel).toBe('Planning estimate');
    expect(summary.summaryText).toContain('fallback feasibility estimate');
    expect(summary.oneWayRuntimeLabel).toMatch(/min$/);
    expect(summary.cycleTimeLabel).toMatch(/min$/);
    expect(summary.busesRequiredLabel).toMatch(/bus/);
    expect(summary.warningCount).toBeGreaterThan(0);
    expect(summary.blockingWarningCount).toBe(0);
  });

  it('summarizes preferred and comparable project counts', () => {
    let project = validTwoStopProject();
    project = markRoutePlanner2PreferredScenario(project, 'scenario-1', now);
    const summary = summarizeRoutePlanner2Project(project);

    expect(summary.totalScenarios).toBe(1);
    expect(summary.comparableScenarioCount).toBe(1);
    expect(summary.notReadyScenarioCount).toBe(0);
    expect(summary.preferredScenarioSummary?.scenarioName).toBe('Clean Concept A');
    expect(summary.selectedScenarioSummary?.scenarioId).toBe('scenario-1');
  });
});
