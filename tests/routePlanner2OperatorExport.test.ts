import { afterEach, describe, expect, it, vi } from 'vitest';

const pdfMocks = vi.hoisted(() => {
  const doc = {
    setProperties: vi.fn(),
    setFillColor: vi.fn(),
    setDrawColor: vi.fn(),
    setTextColor: vi.fn(),
    setLineWidth: vi.fn(),
    setFont: vi.fn(),
    setFontSize: vi.fn(),
    rect: vi.fn(),
    roundedRect: vi.fn(),
    line: vi.fn(),
    text: vi.fn(),
    splitTextToSize: vi.fn((text: string) => [text]),
    addImage: vi.fn(),
    addPage: vi.fn(),
    save: vi.fn(),
    setPage: vi.fn(),
    internal: {
      pageSize: {
        getWidth: () => 297,
        getHeight: () => 210,
      },
      getNumberOfPages: () => 4,
    },
  };

  return {
    doc,
    jsPDF: vi.fn(function JsPDFMock() {
      return doc;
    }),
  };
});

vi.mock('jspdf', () => ({
  jsPDF: pdfMocks.jsPDF,
}));

import { addRoutePlanner2Stop, updateRoutePlanner2RouteShape } from '../utils/route-planner-2/routePlanner2Authoring';
import { deriveRoutePlanner2Feasibility } from '../utils/route-planner-2/routePlanner2Feasibility';
import {
  buildRoutePlanner2OperatorDirectionPlan,
  exportRoutePlanner2OperatorDirectionsPdf,
} from '../utils/route-planner-2/routePlanner2OperatorExport';
import { createRoutePlanner2Project } from '../utils/route-planner-2/routePlanner2ProjectFactory';

describe('Route Planner 2 operator export', () => {
  const now = '2026-05-01T12:00:00.000Z';

  afterEach(() => {
    pdfMocks.jsPDF.mockClear();
    Object.values(pdfMocks.doc).forEach((value) => {
      if (typeof value === 'function' && 'mockClear' in value) {
        value.mockClear();
      }
    });
  });

  it('builds a clean fallback operator direction plan from the selected route shape', async () => {
    let project = createRoutePlanner2Project({ id: 'project-1', scenarioId: 'scenario-1', now });
    project = addRoutePlanner2Stop(project, 'scenario-1', { id: 'stop-1', name: 'Terminal', lat: 44.38, lng: -79.7, now });
    project = addRoutePlanner2Stop(project, 'scenario-1', { id: 'stop-2', name: 'Mall', lat: 44.39, lng: -79.68, now });
    project = addRoutePlanner2Stop(project, 'scenario-1', { id: 'stop-3', name: 'Hospital', lat: 44.4, lng: -79.66, now });
    project = updateRoutePlanner2RouteShape(project, 'scenario-1', 'closed-loop', { now });

    const scenario = project.scenarios[0]!;
    const feasibility = deriveRoutePlanner2Feasibility(scenario);
    const plan = await buildRoutePlanner2OperatorDirectionPlan(scenario, {
      projectName: project.name,
      feasibility,
      token: null,
      now: new Date('2026-05-01T12:00:00.000Z'),
    });

    expect(plan.routeName).toBe('Clean Concept A');
    expect(plan.routeShapeLabel).toBe('Closed loop');
    expect(plan.stopSequenceLabel).toBe('1 - 2 - 3 - 1');
    expect(plan.routeCardTitle).toBe('Operator route card');
    expect(plan.directionSourceLabel).toContain('Planning alignment fallback');
    expect(plan.stopChecklist.map((stop) => `${stop.visitNumber}:${stop.stopName}:${stop.roleLabel}:${stop.nextStopName ?? 'END'}`)).toEqual([
      '1:Terminal:Start terminal:Mall',
      '2:Mall:Regular stop:Hospital',
      '3:Hospital:Regular stop:Terminal',
      '4:Terminal:Loop completion:END',
    ]);
    expect(plan.segments.map((segment) => segment.phaseLabel)).toEqual([
      'Loop',
      'Loop',
      'Loop return to start',
    ]);
    expect(plan.fieldReviewWarnings).toContain('Planning alignment fallback: exact turn-by-turn directions are not confirmed.');
    expect(plan.segments.map((segment) => `${segment.fromStopName}->${segment.toStopName}`)).toEqual([
      '1. Terminal->2. Mall',
      '2. Mall->3. Hospital',
      '3. Hospital->1. Terminal',
    ]);
    expect(plan.segments[0]?.steps[0]?.instruction).toContain('Proceed from Terminal to Mall');
    expect(plan.segments[0]?.steps[0]?.actionLabel).toBe('CONTINUE');
  });

  it('adds operator action labels and phase labels to Mapbox turn-by-turn steps', async () => {
    let project = createRoutePlanner2Project({ id: 'project-1', scenarioId: 'scenario-1', now });
    project = addRoutePlanner2Stop(project, 'scenario-1', { id: 'stop-1', name: 'Terminal', lat: 44.38, lng: -79.7, now });
    project = addRoutePlanner2Stop(project, 'scenario-1', { id: 'stop-2', name: 'Mall', lat: 44.39, lng: -79.68, now });
    project = addRoutePlanner2Stop(project, 'scenario-1', { id: 'stop-3', name: 'Hospital', lat: 44.4, lng: -79.66, now });
    project = updateRoutePlanner2RouteShape(project, 'scenario-1', 'out-and-back', { now });

    const scenario = project.scenarios[0]!;
    const feasibility = deriveRoutePlanner2Feasibility(scenario);
    const fetchImpl = async () => new Response(JSON.stringify({
      code: 'Ok',
      routes: [{
        distance: 850,
        duration: 180,
        legs: [{
          steps: [
            { distance: 120, duration: 30, name: 'Bayfield Street', maneuver: { instruction: 'Turn left onto Bayfield Street' } },
            { distance: 730, duration: 150, name: 'Dunlop Street', maneuver: { instruction: 'Continue on Dunlop Street' } },
          ],
        }],
      }],
    }));

    const plan = await buildRoutePlanner2OperatorDirectionPlan(scenario, {
      projectName: project.name,
      feasibility,
      token: 'token',
      fetchImpl: fetchImpl as typeof fetch,
      now: new Date('2026-05-01T12:00:00.000Z'),
    });

    expect(plan.segments.map((segment) => segment.phaseLabel)).toEqual([
      'Outbound to turnaround',
      'Outbound to turnaround',
      'Return to start',
      'Return to start',
    ]);
    expect(plan.stopChecklist.map((stop) => `${stop.visitNumber}:${stop.stopName}:${stop.roleLabel}`)).toEqual([
      '1:Terminal:Start terminal',
      '2:Mall:Regular stop',
      '3:Hospital:Turnaround',
      '4:Mall:Regular stop',
      '5:Terminal:Start terminal / finish',
    ]);
    expect(plan.segments[0]?.steps.map((step) => step.actionLabel)).toEqual(['LEFT', 'STRAIGHT']);
  });

  it('exports an overview map and a focused map page before segment directions', async () => {
    let project = createRoutePlanner2Project({ id: 'project-1', scenarioId: 'scenario-1', now });
    project = addRoutePlanner2Stop(project, 'scenario-1', { id: 'stop-1', name: 'Terminal', lat: 44.38, lng: -79.7, now });
    project = addRoutePlanner2Stop(project, 'scenario-1', { id: 'stop-2', name: 'Mall', lat: 44.39, lng: -79.68, now });

    const scenario = project.scenarios[0]!;
    const feasibility = deriveRoutePlanner2Feasibility(scenario);

    await exportRoutePlanner2OperatorDirectionsPdf(scenario, {
      projectName: project.name,
      feasibility,
      token: null,
      now: new Date('2026-05-01T12:00:00.000Z'),
      mapImage: {
        dataUrl: 'data:image/png;base64,operator-overview',
        width: 1200,
        height: 800,
      },
      segmentMapPages: [{
        segmentNumber: 1,
        title: 'Segment 1: 1. Terminal to 2. Mall',
        subtitle: 'Stop 1 to Stop 2 - operator travel path',
        mapImage: {
          dataUrl: 'data:image/png;base64,segment-1-map',
          width: 1200,
          height: 800,
        },
      }],
    });

    expect(pdfMocks.doc.addImage).toHaveBeenCalledTimes(2);
    expect(pdfMocks.doc.addImage).toHaveBeenNthCalledWith(
      1,
      'data:image/png;base64,operator-overview',
      'PNG',
      expect.any(Number),
      expect.any(Number),
      expect.any(Number),
      expect.any(Number),
    );
    expect(pdfMocks.doc.addImage).toHaveBeenNthCalledWith(
      2,
      'data:image/png;base64,segment-1-map',
      'PNG',
      expect.any(Number),
      expect.any(Number),
      expect.any(Number),
      expect.any(Number),
    );
    expect(pdfMocks.doc.text).toHaveBeenCalledWith(
      'Clean Concept A - Segment 1: 1. Terminal to 2. Mall',
      expect.any(Number),
      expect.any(Number),
      expect.objectContaining({ baseline: 'middle' }),
    );
    expect(pdfMocks.doc.text).toHaveBeenCalledWith('Turn-by-turn directions', expect.any(Number), expect.any(Number));
  });
});
