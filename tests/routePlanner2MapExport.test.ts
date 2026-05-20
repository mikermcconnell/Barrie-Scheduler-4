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
    addImage: vi.fn(),
    addPage: vi.fn(),
    save: vi.fn(),
    internal: {
      pageSize: {
        getWidth: () => 297,
        getHeight: () => 210,
      },
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

import { addRoutePlanner2Stop, updateRoutePlanner2StopRole } from '../utils/route-planner-2/routePlanner2Authoring';
import {
  buildRoutePlanner2MapBookSections,
  buildRoutePlanner2MapExportPlan,
  exportRoutePlanner2MapPdf,
} from '../utils/route-planner-2/routePlanner2MapExport';
import { createRoutePlanner2Project } from '../utils/route-planner-2/routePlanner2ProjectFactory';

describe('Route Planner 2 map export', () => {
  const now = '2026-05-15T12:00:00.000Z';

  afterEach(() => {
    pdfMocks.jsPDF.mockClear();
    Object.values(pdfMocks.doc).forEach((value) => {
      if (typeof value === 'function' && 'mockClear' in value) {
        value.mockClear();
      }
    });
  });

  it('builds a map-first export plan with kids callouts and route road labels', async () => {
    let project = createRoutePlanner2Project({ id: 'project-1', scenarioId: 'scenario-1', now });
    project = addRoutePlanner2Stop(project, 'scenario-1', {
      id: 'stop-1',
      name: 'Sadlon Arena',
      lat: 44.34,
      lng: -79.69,
      role: 'start-terminal',
      now,
    });
    project = addRoutePlanner2Stop(project, 'scenario-1', {
      id: 'stop-2',
      name: 'Johnson pickup',
      lat: 44.41,
      lng: -79.66,
      now,
    });
    project = updateRoutePlanner2StopRole(project, 'scenario-1', 'stop-2', 'end-terminal', now);
    project = {
      ...project,
      scenarios: [{
        ...project.scenarios[0]!,
        stops: project.scenarios[0]!.stops.map((stop) =>
          stop.id === 'stop-2'
            ? { ...stop, address: '304 Johnson Street, Barrie, ON L4M 5C3', riderCount: 2, sourceRows: [4, 8] }
            : stop,
        ),
      }],
    };

    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        code: 'Ok',
        routes: [{
          legs: [{
            steps: [
              { name: 'Mapleview Drive', maneuver: { instruction: 'Head east on Mapleview Drive' }, distance: 500, duration: 60 },
              { name: 'Yonge Street', maneuver: { instruction: 'Turn left onto Yonge Street' }, distance: 1200, duration: 180 },
              { name: 'Yonge Street', maneuver: { instruction: 'Continue on Yonge Street' }, distance: 800, duration: 120 },
            ],
          }],
        }],
      }),
    })) as unknown as typeof fetch;

    const plan = await buildRoutePlanner2MapExportPlan(project.scenarios[0]!, {
      projectName: 'Camp Access - July 14 to July 18',
      routeLabel: 'Route 1 Morning',
      token: 'token-123',
      fetchImpl,
      now: new Date('2026-05-15T12:00:00.000Z'),
    });

    expect(plan.title).toBe('Camp Access - July 14 to July 18 - Route 1 Morning');
    expect(plan.stopCallouts.map((callout) => callout.label)).toContain('304 Johnson Street - 2 Kids');
    expect(plan.stopCallouts.find((callout) => callout.stopId === 'stop-1')?.badge).toBe('Start');
    expect(plan.stopCallouts.find((callout) => callout.stopId === 'stop-2')?.badge).toBe('End');
    expect(plan.roadLabels.map((label) => label.name)).toEqual(['Mapleview Drive', 'Yonge Street']);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('draws the map PDF header as sharp vector PDF text instead of a rasterized SVG image', async () => {
    const project = createRoutePlanner2Project({ id: 'project-1', scenarioId: 'scenario-1', now });

    await exportRoutePlanner2MapPdf(project.scenarios[0]!, {
      projectName: 'Camp Shuttle',
      routeLabel: 'Clean Concept A',
      now: new Date('2026-05-15T12:00:00.000Z'),
      mapImage: {
        dataUrl: 'data:image/png;base64,mock-route-map',
        width: 1200,
        height: 800,
      },
      summaryItems: [
        { label: 'Stops', value: '11' },
        { label: 'Runtime', value: '64 min' },
      ],
    });

    expect(pdfMocks.doc.addImage).toHaveBeenCalledTimes(1);
    expect(pdfMocks.doc.addImage).toHaveBeenCalledWith(
      'data:image/png;base64,mock-route-map',
      'PNG',
      expect.any(Number),
      expect.any(Number),
      expect.any(Number),
      expect.any(Number),
    );

    expect(pdfMocks.doc.text).toHaveBeenCalledWith(
      'Camp Shuttle - Clean Concept A',
      expect.any(Number),
      expect.any(Number),
      expect.objectContaining({ baseline: 'middle' }),
    );
    expect(pdfMocks.doc.text).toHaveBeenCalledWith(
      'STOPS',
      expect.any(Number),
      expect.any(Number),
      expect.objectContaining({ baseline: 'middle' }),
    );
    expect(pdfMocks.doc.text).toHaveBeenCalledWith(
      '64 min',
      expect.any(Number),
      expect.any(Number),
      expect.objectContaining({ baseline: 'middle' }),
    );
  });

  it('builds overlapping map book sections for long routes', () => {
    let project = createRoutePlanner2Project({ id: 'project-1', scenarioId: 'scenario-1', now });
    for (let index = 0; index < 11; index += 1) {
      project = addRoutePlanner2Stop(project, 'scenario-1', {
        id: `stop-${index + 1}`,
        name: `Stop ${index + 1}`,
        lat: 44.34 + (index * 0.005),
        lng: -79.70 + (index * 0.004),
        now,
      });
    }

    const sections = buildRoutePlanner2MapBookSections(project.scenarios[0]!);

    expect(sections.map((section) => section.subtitle)).toEqual([
      'Stops 1-3 · 3 stops',
      'Stops 3-5 · 3 stops',
      'Stops 5-7 · 3 stops',
      'Stops 7-9 · 3 stops',
      'Stops 9-11 · 3 stops',
    ]);
    expect(sections.every((section) => section.coordinates.length >= 2)).toBe(true);
  });

  it('adds detail pages when map book pages are provided', async () => {
    const project = createRoutePlanner2Project({ id: 'project-1', scenarioId: 'scenario-1', now });

    await exportRoutePlanner2MapPdf(project.scenarios[0]!, {
      projectName: 'Camp Shuttle',
      routeLabel: 'ampshuttle1',
      now: new Date('2026-05-15T12:00:00.000Z'),
      mapImage: {
        dataUrl: 'data:image/png;base64,mock-route-overview',
        width: 1200,
        height: 800,
      },
      mapPages: [
        {
          title: 'Section 1 of route',
          subtitle: 'Stops 1-4 · 4 stops',
          mapImage: {
            dataUrl: 'data:image/png;base64,mock-route-section',
            width: 1200,
            height: 800,
          },
        },
      ],
    });

    expect(pdfMocks.doc.addPage).toHaveBeenCalledTimes(1);
    expect(pdfMocks.doc.addImage).toHaveBeenCalledTimes(2);
    expect(pdfMocks.doc.addImage).toHaveBeenLastCalledWith(
      'data:image/png;base64,mock-route-section',
      'PNG',
      expect.any(Number),
      expect.any(Number),
      expect.any(Number),
      expect.any(Number),
    );
  });
});
