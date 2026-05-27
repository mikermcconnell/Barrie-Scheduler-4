import { describe, expect, it } from 'vitest';

import { addRoutePlanner2Stop, updateRoutePlanner2StopRole } from '../utils/route-planner-2/routePlanner2Authoring';
import { markRoutePlanner2PreferredScenario } from '../utils/route-planner-2/routePlanner2ProjectController';
import { createRoutePlanner2Project } from '../utils/route-planner-2/routePlanner2ProjectFactory';
import { summarizeRoutePlanner2Project, summarizeRoutePlanner2Scenario } from '../utils/route-planner-2/routePlanner2Summary';
import type { RoutePlanner2Project, RoutePlanner2Scenario } from '../utils/route-planner-2/routePlanner2Types';

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

  it('shows partial one-way runtime before cycle time is ready', () => {
    let project = createRoutePlanner2Project({ id: 'project-1', scenarioId: 'scenario-1', now });
    project = addRoutePlanner2Stop(project, 'scenario-1', { id: 'stop-1', name: 'Stop 1', lat: 44.38, lng: -79.7, now });
    project = addRoutePlanner2Stop(project, 'scenario-1', { id: 'stop-2', name: 'Stop 2', lat: 44.4, lng: -79.65, now });

    const summary = summarizeRoutePlanner2Scenario(project.scenarios[0]!);

    expect(summary.readiness).toBe('not-ready');
    expect(summary.oneWayRuntimeLabel).toMatch(/min$/);
    expect(summary.cycleTimeLabel).toBe('Not ready');
    expect(summary.busesRequiredLabel).toBe('Not ready');
    expect(summary.nextAction).toContain('Mark Stop 1 as start and Stop 2 as end');
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

  it('summarizes merged A/B route families as one operating cycle while preserving direction labels', () => {
    function familyScenario(
      id: string,
      routeShortName: '2A' | '2B',
      directionLabel: 'Out' | 'Back',
      runtimeMinutes: number,
    ): RoutePlanner2Scenario {
      return {
        id,
        name: `Route 2 ${directionLabel}`,
        status: 'draft',
        routeShape: 'one-way',
        routeFamily: {
          key: 'barrie-merged-2',
          name: 'Route 2',
          shortName: '2',
          memberShortName: routeShortName,
          directionRole: directionLabel === 'Out' ? 'out' : 'back',
          directionLabel,
        },
        source: {
          type: 'gtfs',
          routeId: routeShortName,
          routeShortName,
          serviceId: 'weekday',
        },
        alignment: [],
        stops: [
          { id: `${id}-start`, name: 'Start', lat: 44.38, lng: -79.7, sequence: 1, role: 'start-terminal', source: 'barrie-stop' },
          { id: `${id}-end`, name: 'End', lat: 44.4, lng: -79.65, sequence: 2, role: 'end-terminal', source: 'barrie-stop' },
        ],
        service: {
          firstTripTime: '06:00',
          lastTripTime: '22:00',
          frequencyMinutes: 30,
          targetBuses: 3,
          startTerminalLayoverMinutes: 0,
          endTerminalLayoverMinutes: 0,
          intermediateStopDwellSeconds: 0,
          dayType: 'weekday',
          planningPeriod: 'all-day',
        },
        runtimeSourceMode: 'gtfs',
        runtimeEstimates: [{
          id: `segment-${id}-full-day`,
          fromStopId: `${id}-start`,
          toStopId: `${id}-end`,
          runtimeMinutes,
          source: 'scheduled-proxy',
          confidence: 'high',
          matchedRoutes: [routeShortName],
          evidenceDayType: 'weekday',
          evidencePeriod: 'full-day',
        }],
        notes: '',
        createdAt: now,
        updatedAt: now,
      };
    }

    const project: RoutePlanner2Project = {
      id: 'project-family',
      name: 'Family project',
      status: 'local-draft',
      selectedScenarioId: 'scenario-2a',
      scenarios: [
        familyScenario('scenario-2a', '2A', 'Out', 42),
        familyScenario('scenario-2b', '2B', 'Back', 39),
      ],
      createdAt: now,
      updatedAt: now,
    };

    const summary = summarizeRoutePlanner2Project(project);

    expect(summary.routeFamilySummaries).toHaveLength(1);
    expect(summary.selectedRouteFamilySummary).toMatchObject({
      key: 'barrie-merged-2-weekday',
      familyName: 'Route 2',
      directionLabels: ['Out · 2A', 'Back · 2B'],
      runtimeMinutes: 81,
      cycleTimeMinutes: 90,
      recoveryTimeMinutes: 9,
      recoveryPercent: 11,
      busesRequired: 3,
      frequencyMinutes: 30,
      confidence: 'high',
    });
    expect(summary.selectedRouteFamilySummary?.runtimeLabel).toBe('81 min');
    expect(summary.selectedRouteFamilySummary?.cycleTimeLabel).toBe('90 min');
    expect(summary.selectedRouteFamilySummary?.recoveryLabel).toBe('9 min (11%)');
    expect(summary.selectedRouteFamilySummary?.busesRequiredLabel).toBe('3 buses');
  });

  it('uses scheduled cycle windows for merged route family summaries when GTFS blocks vary by period', () => {
    function route12Scenario(
      id: string,
      routeShortName: '12A' | '12B',
      directionLabel: 'Out' | 'Back',
      runtimeMinutes: number,
    ): RoutePlanner2Scenario {
      return {
        id,
        name: `Route 12 ${directionLabel}`,
        status: 'draft',
        routeShape: 'one-way',
        routeFamily: {
          key: 'barrie-merged-12',
          name: 'Route 12',
          shortName: '12',
          memberShortName: routeShortName,
          directionRole: directionLabel === 'Out' ? 'out' : 'back',
          directionLabel,
        },
        source: {
          type: 'gtfs',
          routeId: routeShortName,
          routeShortName,
          serviceId: 'weekday',
        },
        alignment: [],
        stops: [
          { id: `${id}-start`, name: 'Start', lat: 44.38, lng: -79.7, sequence: 1, role: 'start-terminal', source: 'barrie-stop' },
          { id: `${id}-end`, name: 'End', lat: 44.4, lng: -79.65, sequence: 2, role: 'end-terminal', source: 'barrie-stop' },
        ],
        service: {
          firstTripTime: '06:00',
          lastTripTime: '22:00',
          frequencyMinutes: 35,
          targetBuses: 4,
          startTerminalLayoverMinutes: 0,
          endTerminalLayoverMinutes: 0,
          intermediateStopDwellSeconds: 0,
          dayType: 'weekday',
          planningPeriod: 'all-day',
          scheduledCycleWindows: {
            'all-day': { cycleTimeMinutes: 130, sampleSize: 19, source: 'gtfs-block' },
            'pm-peak': { cycleTimeMinutes: 140, sampleSize: 12, source: 'gtfs-block' },
          },
        },
        runtimeSourceMode: 'gtfs',
        runtimeEstimates: [{
          id: `segment-${id}-full-day`,
          fromStopId: `${id}-start`,
          toStopId: `${id}-end`,
          runtimeMinutes,
          source: 'scheduled-proxy',
          confidence: 'high',
          matchedRoutes: [routeShortName],
          evidenceDayType: 'weekday',
          evidencePeriod: 'full-day',
        }],
        notes: '',
        createdAt: now,
        updatedAt: now,
      };
    }

    const project: RoutePlanner2Project = {
      id: 'project-route-12',
      name: 'Route 12 project',
      status: 'local-draft',
      selectedScenarioId: 'scenario-12a',
      scenarios: [
        route12Scenario('scenario-12a', '12A', 'Out', 60),
        route12Scenario('scenario-12b', '12B', 'Back', 64),
      ],
      createdAt: now,
      updatedAt: now,
    };

    const summary = summarizeRoutePlanner2Project(project);

    expect(summary.selectedRouteFamilySummary).toMatchObject({
      key: 'barrie-merged-12-weekday',
      runtimeMinutes: 124,
      cycleTimeMinutes: 130,
      recoveryTimeMinutes: 6,
      busesRequired: 4,
      frequencyMinutes: 35,
    });
  });
});
