import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';

const projectPersistenceMocks = vi.hoisted(() => ({
  listRoutePlanner2SavedProjects: vi.fn(async () => []),
  loadRoutePlanner2Project: vi.fn(async () => null),
  saveRoutePlanner2Project: vi.fn(async (_teamId: string, _userId: string, project: unknown) => ({
    ...(project as Record<string, unknown>),
    status: 'local-saved',
    updatedAt: '2026-05-12T12:00:00.000Z',
  })),
  deleteRoutePlanner2SavedProject: vi.fn(async () => undefined),
}));

vi.mock('../utils/route-planner-2/routePlanner2GtfsClient', () => ({
  loadRoutePlanner2GtfsImportPatterns: vi.fn(async () => [
    {
      id: 'pattern-400',
      routeId: '400',
      routeShortName: '400',
      routeLongName: 'Yonge Corridor',
      routeColor: '0EA5E9',
      serviceId: 'weekday',
      dayTypeLabel: 'Weekday',
      directionId: 0,
      tripHeadsign: 'To Barrie South GO',
      shapeId: 'shape-400',
      tripCount: 10,
      stopCount: 2,
      shapePointCount: 3,
      stops: [
        { stopId: 'gtfs-stop-1', gtfsStopId: 'stop-1', stopCode: '1001', name: 'Downtown Terminal', lat: 44.389, lng: -79.69, sequence: 1, arrivalMinutes: 360, departureMinutes: 360 },
        { stopId: 'gtfs-stop-2', gtfsStopId: 'stop-2', stopCode: '1002', name: 'Barrie South GO', lat: 44.34, lng: -79.63, sequence: 2, arrivalMinutes: 384, departureMinutes: 384 },
      ],
      shapePoints: [
        { lat: 44.389, lng: -79.69, sequence: 1 },
        { lat: 44.36, lng: -79.66, sequence: 2 },
        { lat: 44.34, lng: -79.63, sequence: 3 },
      ],
    },
    {
      id: 'pattern-401',
      routeId: '401',
      routeShortName: '401',
      routeLongName: 'Mapleview Corridor',
      routeColor: '10B981',
      serviceId: 'weekday',
      dayTypeLabel: 'Weekday',
      directionId: 0,
      tripHeadsign: 'To Park Place',
      shapeId: 'shape-401',
      tripCount: 8,
      stopCount: 2,
      shapePointCount: 2,
      stops: [
        { stopId: 'gtfs-401-stop-1', gtfsStopId: '401-stop-1', stopCode: '2001', name: 'Downtown Terminal', lat: 44.389, lng: -79.69, sequence: 1, arrivalMinutes: 390, departureMinutes: 390 },
        { stopId: 'gtfs-401-stop-2', gtfsStopId: '401-stop-2', stopCode: '2002', name: 'Park Place', lat: 44.34, lng: -79.70, sequence: 2, arrivalMinutes: 412, departureMinutes: 412 },
      ],
      shapePoints: [
        { lat: 44.389, lng: -79.69, sequence: 1 },
        { lat: 44.34, lng: -79.70, sequence: 2 },
      ],
    },
  ]),
}));

vi.mock('../hooks/usePerformanceData', () => ({
  usePerformanceMetadataQuery: vi.fn(() => ({ data: null })),
  usePerformanceDataQuery: vi.fn(() => ({ data: null })),
}));

vi.mock('../utils/gtfs/corridorSpeed', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils/gtfs/corridorSpeed')>();

  return {
    ...actual,
    buildCorridorSpeedIndex: vi.fn(actual.buildCorridorSpeedIndex),
    buildCorridorSpeedMapIndex: vi.fn(actual.buildCorridorSpeedMapIndex),
  };
});

vi.mock('../utils/route-planner-2/routePlanner2ProjectPersistence', () => projectPersistenceMocks);
vi.mock('../utils/route-planner-2/routePlanner2MapExport', () => ({
  buildRoutePlanner2MapBookSections: vi.fn(() => []),
  exportRoutePlanner2MapPdf: vi.fn(async () => undefined),
}));
vi.mock('../utils/route-planner-2/routePlanner2OperatorExport', () => ({
  exportRoutePlanner2OperatorDirectionsPdf: vi.fn(async () => undefined),
}));

vi.mock('html2canvas', () => ({
  default: vi.fn(async () => ({
    width: 1200,
    height: 800,
    toDataURL: () => 'data:image/png;base64,mock-route-map',
  })),
}));

import {
  RoutePlanner2Workspace,
  getRoutePlanner2VirtualWindow,
  getNextRoutePlanner2SegmentSwitchSourceSelection,
  isRoutePlanner2PairedDirectionScenario,
} from '../components/Analytics/RoutePlanner2Workspace';
import { buildCorridorSpeedIndex, buildCorridorSpeedMapIndex } from '../utils/gtfs/corridorSpeed';
import { addRoutePlanner2LineWaypoint, addRoutePlanner2Stop } from '../utils/route-planner-2/routePlanner2Authoring';
import { exportRoutePlanner2MapPdf } from '../utils/route-planner-2/routePlanner2MapExport';
import { exportRoutePlanner2OperatorDirectionsPdf } from '../utils/route-planner-2/routePlanner2OperatorExport';
import { createRoutePlanner2Project } from '../utils/route-planner-2/routePlanner2ProjectFactory';
import type { RoutePlanner2Project, RoutePlanner2Scenario } from '../utils/route-planner-2/routePlanner2Types';

function setInputValue(input: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string) {
  const prototype = input instanceof HTMLTextAreaElement
    ? HTMLTextAreaElement.prototype
    : input instanceof HTMLSelectElement
      ? HTMLSelectElement.prototype
    : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;

  if (setter) {
    setter.call(input, value);
  } else {
    input.value = value;
  }

  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

function click(element: Element | null | undefined) {
  element?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
}

function findButton(container: HTMLElement, text: string): HTMLButtonElement | null {
  return Array.from(container.querySelectorAll('button')).find((button) =>
    button.textContent?.includes(text),
  ) ?? null;
}

function addMapStop(view: HTMLElement) {
  click(findButton(view, 'Add Stop 1') ?? findButton(view, 'Add next stop') ?? findButton(view, 'Add Stop'));
}

const familyProjectNow = '2026-05-12T12:00:00.000Z';

function makeFamilyScenario(params: {
  id: string;
  name: string;
  familyKey: string;
  familyName: string;
  shortName: string;
  memberShortName: string;
  directionRole: 'out' | 'back';
  directionLabel: string;
  stops: Array<{ code: string; name: string; lat: number; lng: number }>;
}): RoutePlanner2Scenario {
  return {
    id: params.id,
    name: params.name,
    status: 'draft',
    routeShape: 'one-way',
    routeFamily: {
      key: params.familyKey,
      name: params.familyName,
      shortName: params.shortName,
      memberShortName: params.memberShortName,
      directionRole: params.directionRole,
      directionLabel: params.directionLabel,
    },
    source: { type: 'gtfs', routeShortName: params.memberShortName, serviceId: 'weekday' },
    stops: params.stops.map((stop, index) => ({
      id: `${params.id}-stop-${stop.code}`,
      stopCode: stop.code,
      name: stop.name,
      lat: stop.lat,
      lng: stop.lng,
      sequence: index + 1,
      role: index === 0 ? 'start-terminal' : index === params.stops.length - 1 ? 'end-terminal' : 'regular',
      source: 'custom',
    })),
    alignment: [],
    service: {
      firstTripTime: '06:00',
      lastTripTime: '22:00',
      frequencyMinutes: 30,
      targetBuses: 2,
      startTerminalLayoverMinutes: 0,
      endTerminalLayoverMinutes: 0,
      intermediateStopDwellSeconds: 0,
      dayType: 'weekday',
      planningPeriod: 'all-day',
    },
    notes: '',
    createdAt: familyProjectNow,
    updatedAt: familyProjectNow,
  };
}

function buildFamilySwitchProject(): RoutePlanner2Project {
  return {
    id: 'family-switch-project',
    name: 'Family switch project',
    status: 'local-saved',
    selectedScenarioId: 'route-2a',
    scenarios: [
      makeFamilyScenario({
        id: 'route-2a',
        name: 'Route 2A',
        familyKey: 'barrie-merged-2',
        familyName: 'Route 2',
        shortName: '2',
        memberShortName: '2A',
        directionRole: 'out',
        directionLabel: 'Out',
        stops: [
          { code: 'A', name: 'Park Place', lat: 44.34, lng: -79.7 },
          { code: 'B', name: 'Downtown', lat: 44.38, lng: -79.69 },
          { code: 'C', name: 'Georgian', lat: 44.41, lng: -79.67 },
        ],
      }),
      makeFamilyScenario({
        id: 'route-2b',
        name: 'Route 2B',
        familyKey: 'barrie-merged-2',
        familyName: 'Route 2',
        shortName: '2',
        memberShortName: '2B',
        directionRole: 'back',
        directionLabel: 'Back',
        stops: [
          { code: 'C', name: 'Georgian', lat: 44.41, lng: -79.67 },
          { code: 'B', name: 'Downtown', lat: 44.38, lng: -79.69 },
          { code: 'A', name: 'Park Place', lat: 44.34, lng: -79.7 },
        ],
      }),
      makeFamilyScenario({
        id: 'route-7a',
        name: 'Route 7A',
        familyKey: 'barrie-merged-7',
        familyName: 'Route 7',
        shortName: '7',
        memberShortName: '7A',
        directionRole: 'out',
        directionLabel: 'Out',
        stops: [
          { code: 'X', name: 'Allandale', lat: 44.36, lng: -79.68 },
          { code: 'Y', name: 'RVH', lat: 44.42, lng: -79.64 },
        ],
      }),
      makeFamilyScenario({
        id: 'route-7b',
        name: 'Route 7B',
        familyKey: 'barrie-merged-7',
        familyName: 'Route 7',
        shortName: '7',
        memberShortName: '7B',
        directionRole: 'back',
        directionLabel: 'Back',
        stops: [
          { code: 'Y', name: 'RVH', lat: 44.42, lng: -79.64 },
          { code: 'X', name: 'Allandale', lat: 44.36, lng: -79.68 },
        ],
      }),
    ],
    createdAt: familyProjectNow,
    updatedAt: familyProjectNow,
  };
}

async function waitForMapExportCall(timeoutMs = 1200) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (vi.mocked(exportRoutePlanner2MapPdf).mock.calls.length > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

async function waitForOperatorExportCall(timeoutMs = 1200) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (vi.mocked(exportRoutePlanner2OperatorDirectionsPdf).mock.calls.length > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

describe('Route Planner 2 background route filtering', () => {
  it('treats generated Out and Back scenarios as paired directions', () => {
    let project = createRoutePlanner2Project({ id: 'project-1', scenarioId: 'route-out', now: familyProjectNow });
    project = {
      ...project,
      scenarios: [
        { ...project.scenarios[0]!, id: 'route-out', name: 'Sagewood Route Out' },
        { ...project.scenarios[0]!, id: 'route-back', name: 'Sagewood Route Back' },
      ],
    };

    expect(isRoutePlanner2PairedDirectionScenario(project.scenarios[1]!, project.scenarios[0]!)).toBe(true);
  });

  it('treats route-family out and back scenarios as paired directions', () => {
    const outScenario = makeFamilyScenario({
      id: 'route-7a',
      name: 'Route 7A',
      familyKey: 'barrie-merged-7',
      familyName: 'Route 7',
      shortName: '7',
      memberShortName: '7A',
      directionRole: 'out',
      directionLabel: 'Out',
      stops: [
        { code: 'X', name: 'Allandale', lat: 44.36, lng: -79.68 },
        { code: 'Y', name: 'RVH', lat: 44.42, lng: -79.64 },
      ],
    });
    const backScenario = makeFamilyScenario({
      id: 'route-7b',
      name: 'Route 7B',
      familyKey: 'barrie-merged-7',
      familyName: 'Route 7',
      shortName: '7',
      memberShortName: '7B',
      directionRole: 'back',
      directionLabel: 'Back',
      stops: [
        { code: 'Y', name: 'RVH', lat: 44.42, lng: -79.64 },
        { code: 'X', name: 'Allandale', lat: 44.36, lng: -79.68 },
      ],
    });

    expect(isRoutePlanner2PairedDirectionScenario(outScenario, backScenario)).toBe(true);
  });
});

describe('RoutePlanner2Workspace virtual stop order', () => {
  it('windows large stop-order lists without hiding the full route', () => {
    const topWindow = getRoutePlanner2VirtualWindow(1000, 0, {
      rowHeight: 100,
      viewportHeight: 300,
      overscan: 2,
    });
    const scrolledWindow = getRoutePlanner2VirtualWindow(1000, 4500, {
      rowHeight: 100,
      viewportHeight: 300,
      overscan: 2,
    });
    const clampedWindow = getRoutePlanner2VirtualWindow(10, 999999, {
      rowHeight: 100,
      viewportHeight: 300,
      overscan: 2,
    });

    expect(topWindow).toEqual({
      startIndex: 0,
      endIndex: 5,
      topPadding: 0,
      bottomPadding: 99500,
      totalHeight: 100000,
    });
    expect(scrolledWindow.startIndex).toBe(43);
    expect(scrolledWindow.endIndex).toBe(50);
    expect(scrolledWindow.topPadding).toBe(4300);
    expect(scrolledWindow.bottomPadding).toBe(95000);
    expect(scrolledWindow.totalHeight).toBe(100000);
    expect(clampedWindow).toEqual({
      startIndex: 5,
      endIndex: 10,
      topPadding: 500,
      bottomPadding: 0,
      totalHeight: 1000,
    });
  });
});

describe('RoutePlanner2Workspace local workspace', () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  afterEach(() => {
    projectPersistenceMocks.listRoutePlanner2SavedProjects.mockClear();
    projectPersistenceMocks.loadRoutePlanner2Project.mockClear();
    projectPersistenceMocks.saveRoutePlanner2Project.mockClear();
    projectPersistenceMocks.deleteRoutePlanner2SavedProject.mockClear();

    if (root) {
      flushSync(() => {
        root?.unmount();
      });
    }

    container?.remove();
    root = null;
    container = null;
  });

  function renderWorkspace() {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    flushSync(() => {
      root?.render(
        <RoutePlanner2Workspace
          onBack={() => {}}
          userId="user-1"
          teamId="team-1"
        />,
      );
    });

    return container;
  }

  it('renders the clean local blank-concept foundation', () => {
    const view = renderWorkspace();
    const notes = view.querySelector('#rp2-notes') as HTMLTextAreaElement | null;

    expect(view.textContent).toContain('Route Planner');
    expect(view.textContent).toContain('Local draft');
    expect(view.textContent).toContain('Select');
    expect(view.textContent).toContain('Export');
    expect(view.querySelector('[data-testid="rp2-export-menu"]')).toBeNull();
    expect(view.textContent).toContain('Import addresses');
    expect(view.textContent).toContain('Move the mouse over the map and press 1 to place Stop 1');
    expect(view.textContent).toContain('Route concepts');
    expect(view.textContent).toContain('Clean Concept A');
    expect(notes?.value).toContain('Blank route concept');
    expect(view.textContent).not.toContain('Shuttle Template');
    expect(view.textContent).not.toContain('Project foundation');
    expect(view.textContent).not.toContain('Firebase persistence');
  });

  it('keeps Map PDF disabled until the selected route has at least two stops', () => {
    const view = renderWorkspace();
    flushSync(() => {
      click(findButton(view, 'Export'));
    });
    const mapPdfButton = findButton(view, 'Map PDF');

    expect(mapPdfButton?.disabled).toBe(true);
    expect(exportRoutePlanner2MapPdf).not.toHaveBeenCalled();
  });

  it('opens the main export menu with operator and map PDF choices', async () => {
    const view = renderWorkspace();

    flushSync(() => {
      addMapStop(view);
      addMapStop(view);
      click(findButton(view, 'Export'));
    });

    expect(view.querySelector('[data-testid="rp2-export-menu"]')?.textContent).toContain('Operator PDF');
    expect(view.querySelector('[data-testid="rp2-export-menu"]')?.textContent).toContain('Map PDF');

    flushSync(() => {
      click(findButton(view, 'Operator PDF'));
    });
    await waitForOperatorExportCall();

    expect(exportRoutePlanner2OperatorDirectionsPdf).toHaveBeenCalledWith(
      expect.objectContaining({ stops: expect.arrayContaining([expect.objectContaining({ name: 'Stop 1' })]) }),
      expect.objectContaining({
        projectName: expect.any(String),
        mapImage: expect.objectContaining({
          dataUrl: 'data:image/png;base64,mock-route-map',
          width: 1200,
          height: 800,
        }),
        segmentMapPages: [
          expect.objectContaining({
            segmentNumber: 1,
            title: expect.stringContaining('Segment 1: 1. Stop 1 to 2.'),
            subtitle: 'Stop 1 to Stop 2 - operator travel path',
            mapImage: expect.objectContaining({
              dataUrl: 'data:image/png;base64,mock-route-map',
              width: 1200,
              height: 800,
            }),
          }),
        ],
      }),
    );
  });

  it('enables Map PDF export once the selected route has at least two stops', async () => {
    const view = renderWorkspace();

    flushSync(() => {
      addMapStop(view);
      addMapStop(view);
      click(findButton(view, 'Export'));
    });

    const mapPdfButton = findButton(view, 'Map PDF');
    expect(mapPdfButton?.disabled).toBe(false);

    flushSync(() => {
      click(mapPdfButton);
    });
    await waitForMapExportCall();

    expect(exportRoutePlanner2MapPdf).toHaveBeenCalledWith(
      expect.objectContaining({ stops: expect.arrayContaining([expect.objectContaining({ name: 'Stop 1' })]) }),
      expect.objectContaining({
        projectName: expect.any(String),
        routeLabel: expect.any(String),
        mapImage: expect.objectContaining({
          dataUrl: 'data:image/png;base64,mock-route-map',
          width: 1200,
          height: 800,
        }),
      }),
    );
  });

  it('opens map selection tools with box, lasso, and bulk delete controls', () => {
    const view = renderWorkspace();

    flushSync(() => {
      click(findButton(view, 'Select'));
    });

    const selectionMenu = view.querySelector('[data-testid="rp2-selection-menu"]');
    expect(selectionMenu?.textContent).toContain('Box');
    expect(selectionMenu?.textContent).toContain('Lasso');
    expect(selectionMenu?.textContent).toContain('Delete selected');
    expect((view.querySelector('[data-testid="rp2-delete-selected-map-items"]') as HTMLButtonElement | null)?.disabled).toBe(true);

    flushSync(() => {
      click(findButton(view, 'Box'));
    });

    expect(view.querySelector('[data-testid="rp2-map-canvas"]')?.textContent).toContain('Box selection active');
  });

  it('defaults road-name labels on once a route has enough stops', () => {
    const view = renderWorkspace();

    flushSync(() => {
      addMapStop(view);
      addMapStop(view);
    });

    const roadNameToggle = view.querySelector('[data-testid="rp2-road-name-label-toggle"]') as HTMLButtonElement | null;

    expect(roadNameToggle?.disabled).toBe(false);
    expect(roadNameToggle?.getAttribute('aria-pressed')).toBe('true');
    expect(roadNameToggle?.textContent).toContain('Hide road names');
  });

  it('updates road-name label density when planners choose More, Normal, or Fewer', () => {
    const view = renderWorkspace();

    flushSync(() => {
      addMapStop(view);
      addMapStop(view);
      click(findButton(view, 'Actions'));
    });

    const mapCanvas = view.querySelector('[data-testid="rp2-map-canvas"]');
    const densityControls = view.querySelector('[data-testid="rp2-road-name-density-controls"]') as HTMLElement | null;
    const findDensityButton = (label: string) => Array.from(densityControls?.querySelectorAll('button') ?? [])
      .find((button) => button.textContent?.trim() === label) as HTMLButtonElement | undefined;

    const fewerButton = findDensityButton('fewer');
    const normalButton = findDensityButton('normal');
    const moreButton = findDensityButton('more');

    expect(mapCanvas?.getAttribute('data-road-name-label-density')).toBe('normal');
    expect(normalButton?.getAttribute('aria-pressed')).toBe('true');

    flushSync(() => {
      click(moreButton);
    });
    expect(mapCanvas?.getAttribute('data-road-name-label-density')).toBe('more');
    expect(moreButton?.getAttribute('aria-pressed')).toBe('true');

    flushSync(() => {
      click(fewerButton);
    });
    expect(mapCanvas?.getAttribute('data-road-name-label-density')).toBe('fewer');
    expect(fewerButton?.getAttribute('aria-pressed')).toBe('true');

    flushSync(() => {
      click(normalButton);
    });
    expect(mapCanvas?.getAttribute('data-road-name-label-density')).toBe('normal');
    expect(normalButton?.getAttribute('aria-pressed')).toBe('true');
  });

  it('defaults camp shuttle stop labels on and lets planners hide them', () => {
    const view = renderWorkspace();

    flushSync(() => {
      addMapStop(view);
      addMapStop(view);
    });

    const mapCanvas = view.querySelector('[data-testid="rp2-map-canvas"]');
    expect(mapCanvas?.getAttribute('data-camp-shuttle-labels')).toBe('on');

    const campToggle = view.querySelector('[data-testid="rp2-camp-shuttle-label-toggle"]') as HTMLButtonElement | null;
    const actionSidebar = view.querySelector('[data-testid="rp2-action-sidebar"]');
    expect(campToggle).not.toBeNull();
    expect(actionSidebar?.contains(campToggle)).toBe(true);
    expect(campToggle?.getAttribute('aria-pressed')).toBe('true');
    expect(campToggle?.textContent).toContain('Camp Shuttle');

    flushSync(() => {
      click(campToggle);
    });

    expect(campToggle?.getAttribute('aria-pressed')).toBe('false');
    expect(mapCanvas?.getAttribute('data-camp-shuttle-labels')).toBe('off');

    flushSync(() => {
      click(campToggle);
    });

    expect(campToggle?.getAttribute('aria-pressed')).toBe('true');
    expect(mapCanvas?.getAttribute('data-camp-shuttle-labels')).toBe('on');
  });

  it('saves the current route plan to the team workspace', async () => {
    const view = renderWorkspace();

    flushSync(() => {
      click(findButton(view, 'Save'));
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(projectPersistenceMocks.saveRoutePlanner2Project).toHaveBeenCalledWith(
      'team-1',
      'user-1',
      expect.objectContaining({
        name: expect.any(String),
        scenarios: expect.any(Array),
      }),
    );
    expect(view.textContent).toContain('Saved to the team workspace.');
  });

  it('saves the current route plan as a new team workspace copy', async () => {
    const view = renderWorkspace();

    flushSync(() => {
      click(findButton(view, 'Save As'));
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(projectPersistenceMocks.saveRoutePlanner2Project).toHaveBeenCalledWith(
      'team-1',
      'user-1',
      expect.objectContaining({
        name: 'Untitled Route Study copy',
        status: 'local-draft',
        scenarios: expect.any(Array),
      }),
    );
    const savedProject = projectPersistenceMocks.saveRoutePlanner2Project.mock.calls[0]?.[2] as RoutePlanner2Project;
    expect(savedProject.id).toMatch(/^project-/);
    expect(view.textContent).toContain('Saved as a new route plan.');
  });

  it('shows a specific message when route plan save is denied', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    projectPersistenceMocks.saveRoutePlanner2Project.mockRejectedValueOnce({ code: 'permission-denied' });
    const view = renderWorkspace();

    flushSync(() => {
      click(findButton(view, 'Save'));
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(view.textContent).toContain('Save failed: your account does not have access to save route plans for this workspace.');
    consoleErrorSpy.mockRestore();
  });

  it('opens a saved route plan picker when Load is clicked', async () => {
    projectPersistenceMocks.listRoutePlanner2SavedProjects.mockResolvedValueOnce([
      {
        id: 'saved-project-1',
        name: 'Downtown shuttle',
        status: 'local-saved',
        selectedScenarioId: 'scenario-1',
        scenarioOrder: ['scenario-1'],
        scenarioCount: 1,
        createdAt: '2026-05-01T12:00:00.000Z',
        updatedAt: '2026-05-12T12:00:00.000Z',
        updatedBy: 'user-1',
      },
      {
        id: 'saved-project-2',
        name: 'North network options',
        status: 'local-saved',
        selectedScenarioId: 'scenario-2',
        scenarioOrder: ['scenario-2', 'scenario-3'],
        scenarioCount: 2,
        createdAt: '2026-05-02T12:00:00.000Z',
        updatedAt: '2026-05-13T12:00:00.000Z',
        updatedBy: 'user-1',
      },
    ]);
    const view = renderWorkspace();

    await new Promise((resolve) => setTimeout(resolve, 0));

    flushSync(() => {
      click(findButton(view, 'Load'));
    });

    expect(view.textContent).toContain('Load route plan');
    expect(view.textContent).toContain('Downtown shuttle');
    expect(view.textContent).toContain('North network options');
    expect(view.querySelector('[aria-label="Saved route plans"]')).toBeNull();
  });

  it('loads a saved route plan from the picker', async () => {
    projectPersistenceMocks.listRoutePlanner2SavedProjects.mockResolvedValueOnce([
      {
        id: 'saved-project-1',
        name: 'Downtown shuttle',
        status: 'local-saved',
        selectedScenarioId: 'scenario-1',
        scenarioOrder: ['scenario-1'],
        scenarioCount: 1,
        createdAt: '2026-05-01T12:00:00.000Z',
        updatedAt: '2026-05-12T12:00:00.000Z',
        updatedBy: 'user-1',
      },
    ]);
    projectPersistenceMocks.loadRoutePlanner2Project.mockResolvedValueOnce({
      ...createRoutePlanner2Project({ id: 'saved-project-1', scenarioId: 'scenario-1', now: '2026-05-12T12:00:00.000Z' }),
      name: 'Downtown shuttle',
      status: 'local-saved',
    });
    const view = renderWorkspace();

    await new Promise((resolve) => setTimeout(resolve, 0));

    flushSync(() => {
      click(findButton(view, 'Load'));
    });
    flushSync(() => {
      click(findButton(view, 'Downtown shuttle'));
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(projectPersistenceMocks.loadRoutePlanner2Project).toHaveBeenCalledWith('team-1', 'saved-project-1');
    expect(view.textContent).toContain('Loaded saved route plan.');
    expect(view.textContent).not.toContain('Load route plan');
  });

  it('deletes a saved route plan from the picker', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    projectPersistenceMocks.listRoutePlanner2SavedProjects
      .mockResolvedValueOnce([
        {
          id: 'saved-project-1',
          name: 'Downtown shuttle',
          status: 'local-saved',
          selectedScenarioId: 'scenario-1',
          scenarioOrder: ['scenario-1'],
          scenarioCount: 1,
          createdAt: '2026-05-01T12:00:00.000Z',
          updatedAt: '2026-05-12T12:00:00.000Z',
          updatedBy: 'user-1',
        },
      ])
      .mockResolvedValueOnce([]);
    const view = renderWorkspace();

    await new Promise((resolve) => setTimeout(resolve, 0));

    flushSync(() => {
      click(findButton(view, 'Load'));
    });
    const deleteButton = view.querySelector('[data-testid="rp2-delete-saved-route-plan-saved-project-1"]');

    flushSync(() => {
      click(deleteButton);
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(confirmSpy).toHaveBeenCalledWith('Delete saved route plan "Downtown shuttle"? This cannot be undone.');
    expect(projectPersistenceMocks.deleteRoutePlanner2SavedProject).toHaveBeenCalledWith('team-1', 'saved-project-1');
    expect(view.textContent).toContain('Deleted saved route plan.');
    expect(view.textContent).toContain('No saved route plans yet.');

    confirmSpy.mockRestore();
  });

  it('turns an open deleted route plan into an unsaved copy', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const savedProject = {
      ...createRoutePlanner2Project({ id: 'saved-project-1', scenarioId: 'scenario-1', now: '2026-05-12T12:00:00.000Z' }),
      name: 'Downtown shuttle',
      status: 'local-saved' as const,
    };
    projectPersistenceMocks.listRoutePlanner2SavedProjects
      .mockResolvedValueOnce([
        {
          id: 'saved-project-1',
          name: 'Downtown shuttle',
          status: 'local-saved',
          selectedScenarioId: 'scenario-1',
          scenarioOrder: ['scenario-1'],
          scenarioCount: 1,
          createdAt: '2026-05-01T12:00:00.000Z',
          updatedAt: '2026-05-12T12:00:00.000Z',
          updatedBy: 'user-1',
        },
      ])
      .mockResolvedValueOnce([]);
    projectPersistenceMocks.loadRoutePlanner2Project.mockResolvedValueOnce(savedProject);
    const view = renderWorkspace();

    await new Promise((resolve) => setTimeout(resolve, 0));

    flushSync(() => {
      click(findButton(view, 'Load'));
    });
    flushSync(() => {
      click(findButton(view, 'Downtown shuttle'));
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    flushSync(() => {
      click(findButton(view, 'Load'));
    });
    flushSync(() => {
      click(view.querySelector('[data-testid="rp2-delete-saved-route-plan-saved-project-1"]'));
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(projectPersistenceMocks.deleteRoutePlanner2SavedProject).toHaveBeenCalledWith('team-1', 'saved-project-1');
    expect(view.textContent).toContain('Deleted saved route plan. The open copy is now unsaved.');

    flushSync(() => {
      click(findButton(view, 'Save'));
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    const resavedProject = projectPersistenceMocks.saveRoutePlanner2Project.mock.calls.at(-1)?.[2] as RoutePlanner2Project;
    expect(resavedProject.id).not.toBe('saved-project-1');
    expect(resavedProject.name).toBe('Downtown shuttle');

    confirmSpy.mockRestore();
  });

  it('shows route bend anchors in the right-side stop order', async () => {
    let savedProject = createRoutePlanner2Project({ id: 'saved-project-1', scenarioId: 'scenario-1', now: '2026-05-12T12:00:00.000Z' });
    savedProject = addRoutePlanner2Stop(savedProject, 'scenario-1', { id: 'stop-1', name: 'Downtown Terminal', lat: 44.38, lng: -79.69 });
    savedProject = addRoutePlanner2Stop(savedProject, 'scenario-1', { id: 'stop-2', name: 'Georgian Mall', lat: 44.39, lng: -79.68 });
    savedProject = addRoutePlanner2LineWaypoint(savedProject, 'scenario-1', {
      id: 'bend-1',
      afterStopId: 'stop-1',
      beforeStopId: 'stop-2',
      lat: 44.385,
      lng: -79.685,
    });
    projectPersistenceMocks.listRoutePlanner2SavedProjects.mockResolvedValueOnce([
      {
        id: 'saved-project-1',
        name: 'Downtown shuttle',
        status: 'local-saved',
        selectedScenarioId: 'scenario-1',
        scenarioOrder: ['scenario-1'],
        scenarioCount: 1,
        createdAt: '2026-05-01T12:00:00.000Z',
        updatedAt: '2026-05-12T12:00:00.000Z',
        updatedBy: 'user-1',
      },
    ]);
    projectPersistenceMocks.loadRoutePlanner2Project.mockResolvedValueOnce({
      ...savedProject,
      name: 'Downtown shuttle',
      status: 'local-saved',
    });
    const view = renderWorkspace();

    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    flushSync(() => {
      click(findButton(view, 'Load'));
    });
    flushSync(() => {
      click(findButton(view, 'Downtown shuttle'));
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    const stopOrder = view.querySelector('[data-testid="rp2-stop-order-panel"]');
    expect(stopOrder?.textContent).toContain('Downtown Terminal');
    expect(stopOrder?.textContent).toContain('Bend 1');
    expect(stopOrder?.textContent).toContain('Between Downtown Terminal and Georgian Mall');
    expect(stopOrder?.textContent).toContain('Georgian Mall');
    expect(stopOrder?.querySelector('[data-testid="rp2-stop-order-item-bend-1"]')?.getAttribute('draggable')).toBe('true');
    expect(stopOrder?.textContent).toContain('Move up');
    expect(stopOrder?.textContent).toContain('Move down');
  });

  it('opens the address import preview flow', () => {
    const view = renderWorkspace();

    flushSync(() => {
      click(findButton(view, 'Import addresses'));
    });

    expect(view.textContent).toContain('Import stops from addresses');
    expect(view.textContent).toContain('Names are not imported');
    expect(view.textContent).toContain('Supports .xlsx, .xls, and .csv');
  });

  it('does not show the old Camp Focus view', () => {
    const view = renderWorkspace();

    expect(findButton(view, 'Camp Focus')).toBeNull();
    expect(view.querySelector('[data-testid="rp2-map-first-shell"]')?.getAttribute('data-focus-mode')).toBe('standard');
    expect(view.querySelector('[data-testid="rp2-camp-shuttle-focus"]')).toBeNull();
  });


  it('imports a GTFS route as a selected local route concept', async () => {
    const view = renderWorkspace();

    expect(view.textContent).toContain('Import GTFS');

    flushSync(() => {
      click(findButton(view, 'Import GTFS'));
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(view.textContent).toContain('Import GTFS route');
    expect(view.textContent).toContain('Route 400');
    expect(view.textContent).toContain('This creates an editable planning copy. It does not modify GTFS.');

    flushSync(() => {
      click(findButton(view, 'Route 400'));
    });
    flushSync(() => {
      click(findButton(view, 'Import as editable route'));
    });

    expect(view.textContent).toContain('Route 400 - To Barrie South GO');
    expect(view.textContent).toContain('Barrie South GO');
    expect(view.textContent).toContain('Imported from GTFS as an editable planning copy');

    expect(view.textContent).toContain('Scheduled runtime / high');
    expect(view.querySelector('[data-testid="rp2-map-metrics"]')?.textContent).toContain('Scheduled GTFS · Route 400');
    expect(view.querySelector('[data-testid="rp2-map-metrics"]')?.textContent).toContain('Weekday · Full Day');
    expect(view.textContent).toContain('Runtime source summary');
    expect(view.textContent).toContain('1 segment');
    expect(view.textContent).toContain('Confidencehigh');
  });

  it('shows original scheduled source when a planner overrides a segment runtime', async () => {
    const view = renderWorkspace();

    flushSync(() => {
      click(findButton(view, 'Import GTFS'));
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    flushSync(() => {
      click(findButton(view, 'Route 400'));
    });
    flushSync(() => {
      click(findButton(view, 'Import as editable route'));
    });
    flushSync(() => {
      click(findButton(view, 'GTFS route run time'));
    });

    const overrideInput = Array.from(view.querySelectorAll('input[aria-label^="Override runtime"]'))[0] as HTMLInputElement | undefined;
    expect(overrideInput).toBeTruthy();

    flushSync(() => {
      setInputValue(overrideInput!, '30');
    });

    expect(view.textContent).toContain('Planner override');
    expect(view.textContent).toContain('Original: Scheduled GTFS · Route 400');
  });

  it('keeps imported scheduled GTFS runtimes when the selected period has no replacement evidence', async () => {
    const view = renderWorkspace();

    flushSync(() => {
      click(findButton(view, 'Import GTFS'));
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    flushSync(() => {
      click(findButton(view, 'Route 400'));
    });
    flushSync(() => {
      click(findButton(view, 'Import as editable route'));
    });
    flushSync(() => {
      click(findButton(view, 'GTFS route run time'));
    });

    const runtimePeriodSelect = Array.from(view.querySelectorAll('select')).find((select) =>
      Array.from(select.options).some((option) => option.value === 'am-peak'),
    ) as HTMLSelectElement | undefined;

    expect(runtimePeriodSelect).toBeTruthy();

    flushSync(() => {
      setInputValue(runtimePeriodSelect!, 'am-peak');
    });

    expect(view.textContent).toContain('Scheduled runtime / high');
    expect(view.querySelector('[data-testid="rp2-map-metrics"]')?.textContent).toContain('Scheduled GTFS · Route 400');
    expect(view.textContent).not.toContain('Fallback estimate / low');
  });

  it('renders runtime day and period controls in service assumptions', () => {
    const view = renderWorkspace();
    const labels = Array.from(view.querySelectorAll('label'));

    expect(labels.some((label) => label.textContent?.includes('Runtime day'))).toBe(true);
    expect(labels.some((label) => label.textContent?.includes('Runtime period'))).toBe(true);
  });

  it('builds runtime evidence from the stop-to-stop GTFS speed index, not the map corridor index', () => {
    vi.mocked(buildCorridorSpeedIndex).mockClear();
    vi.mocked(buildCorridorSpeedMapIndex).mockClear();

    renderWorkspace();

    expect(buildCorridorSpeedIndex).toHaveBeenCalled();
    expect(buildCorridorSpeedMapIndex).not.toHaveBeenCalled();
  });

  it('imports multiple GTFS routes into the same local workspace', async () => {
    const view = renderWorkspace();

    flushSync(() => {
      click(findButton(view, 'Import GTFS'));
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    flushSync(() => {
      click(findButton(view, 'Route 400'));
      click(findButton(view, 'Route 401'));
    });
    expect(view.textContent).toContain('2 routes selected');

    flushSync(() => {
      click(findButton(view, 'Import 2 editable routes'));
    });

    expect(view.textContent).toContain('Route 400 - To Barrie South GO');
    expect(view.textContent).toContain('Route 401 - To Park Place');
    expect(view.textContent).toContain('Route concepts');
    expect(view.querySelector('[data-testid="rp2-action-sidebar"]')?.getAttribute('data-state')).toBe('expanded');
  });

  it('adds Option 2 as a local route', () => {
    const view = renderWorkspace();

    flushSync(() => {
      click(findButton(view, 'Add route'));
    });

    expect(view.textContent).toContain('Option 2');
  });

  it('copies an existing route concept inside the current route plan', () => {
    const view = renderWorkspace();

    flushSync(() => {
      click(findButton(view, 'Actions'));
    });

    const copyButton = view.querySelector('[data-testid^="rp2-copy-route-concept-"]');
    expect(copyButton).not.toBeNull();

    flushSync(() => {
      click(copyButton);
    });

    expect(view.textContent).toContain('Clean Concept A copy');
    expect(view.textContent).toContain('Clean Concept A');
  });

  it('edits the selected route name', () => {
    const view = renderWorkspace();
    const nameInput = view.querySelector('#rp2-scenario-name') as HTMLInputElement | null;

    expect(nameInput).not.toBeNull();

    flushSync(() => {
      setInputValue(nameInput!, 'Downtown Loop Option');
    });

    expect(view.textContent).toContain('Downtown Loop Option');
  });

  it('edits the selected route concept name from the concept list', () => {
    const view = renderWorkspace();

    flushSync(() => {
      click(findButton(view, 'Actions'));
    });

    const conceptNameInput = view.querySelector('[data-testid="rp2-route-concept-name-input"]') as HTMLInputElement | null;
    expect(conceptNameInput).not.toBeNull();

    flushSync(() => {
      setInputValue(conceptNameInput!, 'North Barrie Shuttle');
    });

    const routeNameInput = view.querySelector('#rp2-scenario-name') as HTMLInputElement | null;
    expect(conceptNameInput?.value).toBe('North Barrie Shuttle');
    expect(routeNameInput?.value).toBe('North Barrie Shuttle');
    expect(view.textContent).toContain('North Barrie Shuttle');
  });

  it('marks the selected route as preferred', () => {
    const view = renderWorkspace();

    expect(view.textContent).toContain('No preferred route yet');

    flushSync(() => {
      click(findButton(view, 'Mark preferred'));
    });

    expect(view.textContent).not.toContain('No preferred route yet');
    expect(view.textContent).toContain('(preferred)');
  });

  it('deletes the selected route when more than one exists', () => {
    const view = renderWorkspace();

    flushSync(() => {
      click(findButton(view, 'Add route'));
    });
    expect(view.textContent).toContain('Option 2');

    flushSync(() => {
      click(findButton(view, 'Delete'));
    });

    expect(view.textContent).not.toContain('Option 2');
    expect(view.textContent).toContain('Clean Concept A');
  });

  it('shows a visible delete route concept action in the left sidebar', () => {
    const view = renderWorkspace();

    flushSync(() => {
      click(findButton(view, 'Add route'));
    });
    flushSync(() => {
      const actionSidebar = view.querySelector('[data-testid="rp2-action-sidebar"]');
      click(actionSidebar?.querySelector('button[aria-expanded="false"]'));
    });

    const deleteConceptButton = view.querySelector('[data-testid="rp2-delete-selected-route-concept"]') as HTMLButtonElement | null;
    expect(deleteConceptButton).not.toBeNull();
    expect(deleteConceptButton?.textContent).toContain('Delete concept');
    expect(deleteConceptButton?.disabled).toBe(false);

    flushSync(() => {
      click(deleteConceptButton);
    });

    expect(view.textContent).not.toContain('Option 2');
    expect(view.textContent).toContain('Clean Concept A');
  });

  it('renders the route comparison table', () => {
    const view = renderWorkspace();

    expect(view.textContent).toContain('Route comparison');
    expect(view.textContent).toContain('Stops');
    expect(view.textContent).toContain('Runtime');
    expect(view.textContent).toContain('Dwell');
    expect(view.textContent).toContain('Buses');
    expect(view.textContent).toContain('Warnings');
  });

  it('renders a simplified guided map workflow', () => {
    const view = renderWorkspace();

    expect(view.textContent).toContain('Draw route');
    expect(view.textContent).not.toContain('Inspect');
    expect(view.textContent).not.toContain('Shape alignment');
    expect(view.textContent).not.toContain('Add shape point');
    expect(view.textContent).not.toContain('Route snap:');
    expect(view.textContent).not.toContain('click the route line to create a waypoint');
    expect(view.textContent).not.toContain('drag the + handle');
  });

  it('renders Route Planner as a map-first workspace with a collapsible action sidebar', () => {
    const view = renderWorkspace();
    const workspaceShell = view.querySelector('[data-testid="rp2-map-first-shell"]');
    const rightRail = view.querySelector('[data-testid="rp2-right-rail"]');
    const mapCanvas = view.querySelector('[data-testid="rp2-map-canvas"]') as HTMLElement | null;
    const actionSidebar = view.querySelector('[data-testid="rp2-action-sidebar"]');
    const actionSidebarScroll = view.querySelector('[data-testid="rp2-action-sidebar-scroll"]');

    expect(workspaceShell?.getAttribute('data-layout')).toBe('map-first');
    expect(view.textContent).toContain('Route concepts');
    expect(view.querySelector('[data-testid="rp2-left-rail"]')).toBeNull();
    expect(actionSidebar?.getAttribute('data-state')).toBe('collapsed');
    expect(actionSidebar?.className).toContain('w-20');
    expect(actionSidebarScroll?.className).toContain('rp2-action-scrollbar');
    expect(actionSidebarScroll?.className).toContain('pr-2');
    expect(rightRail?.getAttribute('data-state')).toBe('open');
    expect(mapCanvas?.style.getPropertyValue('--rp2-overlay-left')).toBe('6rem');
    expect(mapCanvas?.style.getPropertyValue('--rp2-overlay-right')).toBe('26.5rem');
    expect(view.textContent).toContain('Draw route');

    flushSync(() => {
      click(findButton(view, 'Actions'));
    });

    expect(actionSidebar?.getAttribute('data-state')).toBe('expanded');
    expect(actionSidebar?.className).toContain('w-72');
    expect(actionSidebarScroll?.className).toContain('rp2-action-scrollbar');
    expect(actionSidebarScroll?.className).toContain('pr-1');
    expect(mapCanvas?.style.getPropertyValue('--rp2-overlay-left')).toBe('20rem');

    flushSync(() => {
      click(view.querySelector('[aria-label="Close review route panel"]'));
    });

    expect(rightRail?.getAttribute('data-state')).toBe('closed');
    expect(mapCanvas?.style.getPropertyValue('--rp2-overlay-left')).toBe('20rem');
    expect(mapCanvas?.style.getPropertyValue('--rp2-overlay-right')).toBe('6rem');
    expect(view.querySelector('[aria-label="Expand review route panel"]')).not.toBeNull();
    expect(view.textContent).toContain('Review route');
  });

  it('keeps the map-first workspace contained so the map can fill the available height', () => {
    const view = renderWorkspace();
    const workspaceShell = view.querySelector('[data-testid="rp2-map-first-shell"]') as HTMLElement | null;
    const rightRail = view.querySelector('[data-testid="rp2-right-rail"]') as HTMLElement | null;
    const mapCanvas = view.querySelector('[data-testid="rp2-map-canvas"]') as HTMLElement | null;

    expect(workspaceShell?.className).toContain('overflow-hidden');
    expect(workspaceShell?.className).not.toContain('overflow-y-auto');
    expect(rightRail?.className).toContain('overflow-y-auto');
    expect(mapCanvas?.className).toContain('h-full');
    expect(mapCanvas?.className).toContain('min-h-0');
  });

  it('opens and scrolls to runtime source details from the map runtime data source', async () => {
    const view = renderWorkspace();
    const scrollIntoView = vi.fn();
    const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;
    const originalRequestAnimationFrame = window.requestAnimationFrame;
    HTMLElement.prototype.scrollIntoView = scrollIntoView;
    window.requestAnimationFrame = ((callback: FrameRequestCallback) => {
      callback(0);
      return 0;
    }) as typeof window.requestAnimationFrame;

    try {
      const rightRail = view.querySelector('[data-testid="rp2-right-rail"]');
      const runtimeMetric = view.querySelector('[data-testid="rp2-map-metric-runtime"]') as HTMLButtonElement | null;

      flushSync(() => {
        click(view.querySelector('[aria-label="Close review route panel"]'));
      });

      expect(rightRail?.getAttribute('data-state')).toBe('closed');
      expect(runtimeMetric?.textContent).toContain('Data source:');

      flushSync(() => {
        click(runtimeMetric);
      });
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(rightRail?.getAttribute('data-state')).toBe('open');
      expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' });
      expect(view.querySelector('[data-testid="rp2-runtime-source-details"]')?.textContent).toContain('Mapbox only');
    } finally {
      if (originalScrollIntoView) {
        HTMLElement.prototype.scrollIntoView = originalScrollIntoView;
      } else {
        delete (HTMLElement.prototype as typeof HTMLElement.prototype & { scrollIntoView?: unknown }).scrollIntoView;
      }
      window.requestAnimationFrame = originalRequestAnimationFrame;
    }
  });

  it('enters focused draw mode by hiding details and keeping metrics on the map', () => {
    const view = renderWorkspace();

    flushSync(() => {
      click(findButton(view, 'Draw route'));
    });

    expect(view.querySelector('[data-testid="rp2-map-first-shell"]')?.getAttribute('data-focus-mode')).toBe('draw');
    expect(view.querySelector('[data-testid="rp2-left-rail"]')).toBeNull();
    expect(view.querySelector('[data-testid="rp2-right-rail"]')?.getAttribute('data-state')).toBe('closed');
    expect(view.querySelector('[data-testid="rp2-map-metrics"]')?.textContent).toContain('Runtime');
    expect(view.querySelector('[data-testid="rp2-map-metrics"]')?.textContent).toContain('Recovery');
    expect(view.querySelector('[data-testid="rp2-map-metrics"]')?.textContent).toContain('Confidence');
    expect(view.textContent).toContain('Not ready: required route inputs are missing before the estimate can be trusted.');
    expect(view.textContent).toContain('Exit focus');
  });

  it('adds stops from the authoring canvas', () => {
    const view = renderWorkspace();

    flushSync(() => {
      addMapStop(view);
    });

    const stopNameInput = view.querySelector('#rp2-stop-name') as HTMLInputElement | null;

    expect(view.textContent).toContain('1 stop');
    expect(stopNameInput?.value).toBe('Stop 1');
  });

  it('shows campers, campers total, and running time on stop cards', () => {
    const view = renderWorkspace();

    flushSync(() => {
      addMapStop(view);
    });

    const stopCard = view.querySelector('[data-testid^="rp2-stop-order-item-"]');

    expect(stopCard?.textContent).toContain('Campers 0');
    expect(stopCard?.textContent).toContain('Campers total 0');
    expect(stopCard?.textContent).toContain('From previous Start');
    expect(stopCard?.textContent).toContain('Running time 0 min');
  });

  it('lets planners edit campers directly from the stop order', () => {
    const view = renderWorkspace();

    flushSync(() => {
      addMapStop(view);
    });

    const kidsInput = view.querySelector('input[aria-label="Campers count for Stop 1"]') as HTMLInputElement | null;
    expect(kidsInput).not.toBeNull();

    flushSync(() => {
      setInputValue(kidsInput!, '6');
    });

    const stopCard = kidsInput!.closest('li');
    expect(stopCard?.textContent).toContain('Campers 6');
    expect(stopCard?.textContent).toContain('Campers total 6');
    expect(kidsInput?.value).toBe('6');
  });

  it('lets planners edit running time directly from the stop order', () => {
    const view = renderWorkspace();

    flushSync(() => {
      addMapStop(view);
    });
    flushSync(() => {
      addMapStop(view);
    });

    const runningTimeInput = view.querySelector('input[aria-label="Override running time to Stop 2 in minutes"]') as HTMLInputElement | null;
    expect(runningTimeInput).not.toBeNull();

    flushSync(() => {
      setInputValue(runningTimeInput!, '9');
    });

    const stopTwoCard = runningTimeInput!.closest('li');
    expect(stopTwoCard?.textContent).toContain('From previous 9 min');
    expect(stopTwoCard?.textContent).toContain('Running time 9 min');
    expect(stopTwoCard?.textContent).toContain('Planner override');
  });

  it('supports undo and redo for route planner edits', () => {
    const view = renderWorkspace();

    expect((findButton(view, 'Undo') as HTMLButtonElement | null)?.disabled).toBe(true);

    flushSync(() => {
      addMapStop(view);
    });

    expect(view.textContent).toContain('1 stop');
    expect((findButton(view, 'Undo') as HTMLButtonElement | null)?.disabled).toBe(false);

    flushSync(() => {
      click(findButton(view, 'Undo'));
    });

    expect(view.textContent).not.toContain('1 stop');
    expect((findButton(view, 'Redo') as HTMLButtonElement | null)?.disabled).toBe(false);

    flushSync(() => {
      click(findButton(view, 'Redo'));
    });

    expect(view.textContent).toContain('1 stop');
  });

  it('does not pin a floating notification when saved plan listing fails', async () => {
    projectPersistenceMocks.listRoutePlanner2SavedProjects.mockRejectedValueOnce(new Error('offline'));
    const view = renderWorkspace();

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(view.textContent).not.toContain('Saved route plans could not be loaded.');
  });

  it('keeps the full stop list in the review rail without a duplicate map stop tray', () => {
    const view = renderWorkspace();

    for (let index = 0; index < 11; index += 1) {
      flushSync(() => {
        addMapStop(view);
      });
    }

    expect(view.querySelector('[data-testid="rp2-map-stop-tray"]')).toBeNull();
    expect(view.textContent).not.toContain('Review stops');

    flushSync(() => {
      click(findButton(view, 'Review route'));
    });

    expect(view.querySelector('[data-testid="rp2-right-rail"]')?.getAttribute('data-state')).toBe('open');
    const virtualStopList = view.querySelector('[data-testid="rp2-stop-order-virtual-list"]');
    expect(virtualStopList?.getAttribute('data-total-items')).toBe('11');
    expect(virtualStopList?.getAttribute('data-rendered-items')).toBe('11');
    expect(view.querySelector('[data-testid="rp2-stop-order-panel"]')?.textContent).toContain('10Stop 10');
    expect(view.querySelector('[data-testid="rp2-stop-order-panel"]')?.textContent).not.toContain('more items are hidden');
  });

  it('puts the runtime source overlay control in the action sidebar', () => {
    const view = renderWorkspace();

    flushSync(() => {
      addMapStop(view);
      addMapStop(view);
    });

    expect(view.textContent).not.toContain('ViewShow source overlay');

    const sourceOverlayButton = view.querySelector('[data-testid="rp2-runtime-source-overlay-toggle"]') as HTMLButtonElement | null;
    expect(sourceOverlayButton).not.toBeNull();
    expect(sourceOverlayButton?.textContent).toContain('Show source overlay');

    flushSync(() => {
      click(sourceOverlayButton);
    });

    expect(sourceOverlayButton?.getAttribute('aria-pressed')).toBe('true');
    expect(sourceOverlayButton?.textContent).toContain('Hide source overlay');
  });

  it('keeps source segment start and end map clicks independent', async () => {
    expect(getNextRoutePlanner2SegmentSwitchSourceSelection({
      step: 'select-source-start',
      fromSequence: 1,
      toSequence: 1,
      startSelected: false,
      endSelected: false,
    }, 2, true)).toEqual({
      step: 'select-source-end',
      fromSequence: 2,
      toSequence: 1,
      startSelected: true,
      endSelected: false,
    });

    expect(getNextRoutePlanner2SegmentSwitchSourceSelection({
      step: 'select-source-end',
      fromSequence: 2,
      toSequence: 1,
      startSelected: true,
      endSelected: false,
    }, 3, true)).toEqual({
      step: 'select-insertion',
      fromSequence: 2,
      toSequence: 3,
      startSelected: true,
      endSelected: true,
    });

    const view = renderWorkspace();

    flushSync(() => {
      addMapStop(view);
    });
    flushSync(() => {
      addMapStop(view);
    });
    flushSync(() => {
      addMapStop(view);
    });
    flushSync(() => {
      click(findButton(view, 'Add route'));
    });
    flushSync(() => {
      click(Array.from(view.querySelectorAll('button')).find((button) => button.textContent?.includes('Clean Concept A')));
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    flushSync(() => {
      click(findButton(view, 'Segment switch'));
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    const fromSelect = view.querySelector('#rp2-transfer-from') as HTMLSelectElement | null;
    const toSelect = view.querySelector('#rp2-transfer-to') as HTMLSelectElement | null;
    expect(fromSelect).not.toBeNull();
    expect(toSelect).not.toBeNull();

    flushSync(() => {
      setInputValue(fromSelect!, '2');
    });

    const statusAfterStart = view.querySelector('[data-testid="rp2-segment-switch-mode-status"]');
    expect(fromSelect?.value).toBe('2');
    expect(toSelect?.value).toBe('1');
    expect(statusAfterStart?.textContent).toContain('Start stop2. Stop 2');
    expect(statusAfterStart?.textContent).toContain('End stopPick on map');
    expect(statusAfterStart?.textContent).toContain('Click the last stop');
    expect(findButton(view, 'Move stops')?.disabled).toBe(true);
    expect(view.querySelector('[data-testid="rp2-stop-transfer-preview"]')).toBeNull();

    flushSync(() => {
      setInputValue(toSelect!, '3');
    });

    expect(fromSelect?.value).toBe('2');
    expect(toSelect?.value).toBe('3');
    expect(view.querySelector('[data-testid="rp2-segment-switch-mode-status"]')?.textContent).toContain('Source segment selected');
    expect(findButton(view, 'Move stops')?.disabled).toBe(false);
    expect(view.querySelector('[data-testid="rp2-stop-transfer-preview"]')?.textContent).toContain('Move 2 stops into Option 2');
  });

  it('moves a stop range into another route concept from map-based segment switch mode', async () => {
    const view = renderWorkspace();

    flushSync(() => {
      addMapStop(view);
    });
    flushSync(() => {
      addMapStop(view);
    });
    flushSync(() => {
      addMapStop(view);
    });

    flushSync(() => {
      click(findButton(view, 'Add route'));
    });
    flushSync(() => {
      click(Array.from(view.querySelectorAll('button')).find((button) => button.textContent?.includes('Clean Concept A')));
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    flushSync(() => {
      click(findButton(view, 'Stop 2'));
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(view.querySelector('[data-testid="rp2-reassign-stops-panel"]')).toBeNull();
    const rightRail = view.querySelector('[data-testid="rp2-right-rail"]') as HTMLElement | null;
    expect(rightRail?.textContent).not.toContain('Segment switch');

    flushSync(() => {
      click(findButton(view, 'Segment switch'));
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(view.querySelector('[data-testid="rp2-segment-switch-drawer"]')?.textContent).toContain('Segment switch mode');
    expect(view.querySelector('[data-testid="rp2-segment-switch-mode-status"]')?.textContent).toContain('Click the first stop');

    const fromSelect = view.querySelector('#rp2-transfer-from') as HTMLSelectElement | null;
    const toSelect = view.querySelector('#rp2-transfer-to') as HTMLSelectElement | null;
    const targetSelect = view.querySelector('#rp2-transfer-target') as HTMLSelectElement | null;
    expect(view.querySelector('[data-testid="rp2-reassign-stops-panel"]')?.textContent).toContain('Map segment switch');
    expect(view.textContent).not.toContain('Reverse stop order');
    expect(view.textContent).toContain('No paired direction match found');
    expect(fromSelect).not.toBeNull();
    expect(toSelect).not.toBeNull();
    expect(targetSelect?.selectedOptions[0]?.textContent).toContain('Option 2');
    expect(findButton(view, 'Move stops')?.disabled).toBe(true);
    expect(view.textContent).toContain('pick at least two stops');

    flushSync(() => {
      setInputValue(fromSelect!, '2');
    });
    flushSync(() => {
      setInputValue(toSelect!, '3');
    });
    expect(fromSelect?.value).toBe('2');
    expect(toSelect?.value).toBe('3');

    const preview = view.querySelector('[data-testid="rp2-stop-transfer-preview"]');
    expect(preview?.textContent).toContain('Transfer preview');
    expect(preview?.textContent).toContain('Move 2 stops into Option 2');
    expect(preview?.textContent).toContain('Target moved runtime');
    expect(preview?.textContent).toContain('Copy uses the same target preview');
    expect(view.querySelector('[data-testid="rp2-stop-transfer-impact-cards"]')?.textContent).toContain('Cycle');
    expect(view.querySelector('[data-testid="rp2-stop-transfer-impact-cards"]')?.textContent).toContain('Recovery');

    flushSync(() => {
      click(findButton(view, 'Move stops'));
    });

    const reviewPanel = view.querySelector('[data-testid="rp2-stop-transfer-impact-panel"]');
    expect(reviewPanel?.textContent).toContain('Segment switch review');
    expect(reviewPanel?.textContent).toContain('Schedule impact');
    expect(reviewPanel?.textContent).toContain('Runtime shifted');
    expect(reviewPanel?.textContent).toContain('Clean Concept A');
    expect(reviewPanel?.textContent).toContain('Option 2');
    expect(view.querySelector('[data-testid="rp2-stop-transfer-impact-modal"]')).toBeNull();

    let routeCards = Array.from(view.querySelectorAll('button')).filter((button) =>
      button.textContent?.includes('Clean Concept A') || button.textContent?.includes('Option 2'),
    );
    expect(routeCards.some((button) => button.textContent?.includes('Clean Concept A') && button.textContent?.includes('3 stops'))).toBe(true);
    expect(routeCards.some((button) => button.textContent?.includes('Option 2') && button.textContent?.includes('0 stops'))).toBe(true);

    flushSync(() => {
      click(findButton(view, 'Back'));
    });
    expect(view.querySelector('[data-testid="rp2-stop-transfer-impact-panel"]')).toBeNull();
    routeCards = Array.from(view.querySelectorAll('button')).filter((button) =>
      button.textContent?.includes('Clean Concept A') || button.textContent?.includes('Option 2'),
    );
    expect(routeCards.some((button) => button.textContent?.includes('Clean Concept A') && button.textContent?.includes('3 stops'))).toBe(true);
    expect(routeCards.some((button) => button.textContent?.includes('Option 2') && button.textContent?.includes('0 stops'))).toBe(true);

    flushSync(() => {
      click(findButton(view, 'Move stops'));
    });
    flushSync(() => {
      click(findButton(view, 'Confirm move stops'));
    });

    const impact = view.querySelector('[data-testid="rp2-segment-transfer-impact"]');
    expect(impact?.textContent).toContain('Runtime impact');
    expect(impact?.textContent).toContain('Moved 2 stops from Clean Concept A to Option 2');
    const undoToast = view.querySelector('[data-testid="rp2-transfer-undo-toast"]');
    expect(undoToast?.textContent).toContain('Segment switch applied');
    routeCards = Array.from(view.querySelectorAll('button')).filter((button) =>
      button.textContent?.includes('Clean Concept A') || button.textContent?.includes('Option 2'),
    );
    expect(routeCards.some((button) => button.textContent?.includes('Clean Concept A') && button.textContent?.includes('1 stops'))).toBe(true);
    expect(routeCards.some((button) => button.textContent?.includes('Option 2') && button.textContent?.includes('2 stops'))).toBe(true);

    flushSync(() => {
      click(undoToast?.querySelector('button'));
    });
    routeCards = Array.from(view.querySelectorAll('button')).filter((button) =>
      button.textContent?.includes('Clean Concept A') || button.textContent?.includes('Option 2'),
    );
    expect(routeCards.some((button) => button.textContent?.includes('Clean Concept A') && button.textContent?.includes('3 stops'))).toBe(true);
    expect(routeCards.some((button) => button.textContent?.includes('Option 2') && button.textContent?.includes('0 stops'))).toBe(true);
  });

  it('can apply a family segment switch to the paired direction from the main segment switch panel', async () => {
    projectPersistenceMocks.listRoutePlanner2SavedProjects.mockResolvedValueOnce([
      {
        id: 'family-switch-project',
        name: 'Family switch project',
        updatedAt: familyProjectNow,
        scenarioCount: 4,
      },
    ]);
    projectPersistenceMocks.loadRoutePlanner2Project.mockResolvedValueOnce(buildFamilySwitchProject());

    const view = renderWorkspace();

    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    flushSync(() => {
      click(findButton(view, 'Load'));
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    flushSync(() => {
      click(findButton(view, 'Family switch project'));
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(view.textContent).toContain('Route 2A');

    flushSync(() => {
      click(findButton(view, 'Segment switch'));
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    const targetSelect = view.querySelector('#rp2-transfer-target') as HTMLSelectElement | null;
    const toSelect = view.querySelector('#rp2-transfer-to') as HTMLSelectElement | null;
    expect(targetSelect).not.toBeNull();
    expect(toSelect).not.toBeNull();

    flushSync(() => {
      setInputValue(targetSelect!, 'route-7a');
    });
    flushSync(() => {
      setInputValue(toSelect!, '3');
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(view.textContent).not.toContain('Reverse stop order');
    expect(view.textContent).toContain('Paired direction will also update');
    expect(view.textContent).toContain('Route 2B → Route 7B');

    flushSync(() => {
      click(findButton(view, 'Move stops'));
    });

    const reviewPanel = view.querySelector('[data-testid="rp2-stop-transfer-impact-panel"]');
    expect(reviewPanel?.textContent).toContain('Also apply matching opposite direction');
    expect(view.querySelector('[data-testid="rp2-stop-transfer-impact-modal"]')).toBeNull();

    flushSync(() => {
      click(findButton(view, 'Confirm move stops'));
    });

    const undoToast = view.querySelector('[data-testid="rp2-transfer-undo-toast"]');
    expect(undoToast?.textContent).toContain('Segment switch applied in both directions');
  });

  it('deletes a stop from the review rail stop order list', () => {
    const view = renderWorkspace();

    flushSync(() => {
      addMapStop(view);
    });
    expect(view.textContent).toContain('1 stop');
    expect(view.textContent).toContain('Stop 1');

    const deleteStopButton = view.querySelector('button[aria-label="Delete Stop 1"]');
    expect(deleteStopButton).not.toBeNull();

    flushSync(() => {
      click(deleteStopButton);
    });

    expect(view.textContent).not.toContain('1 stop');
    expect(view.textContent).toContain('Move the mouse over the map and press 1 to place Stop 1');
  });

  it('clears all stops and bends from the stop order list', () => {
    const view = renderWorkspace();

    flushSync(() => {
      addMapStop(view);
    });
    flushSync(() => {
      addMapStop(view);
    });

    expect(view.textContent).toContain('2 stops');
    expect(view.textContent).toContain('Clear all');

    flushSync(() => {
      click(findButton(view, 'Clear all'));
    });

    expect(view.textContent).not.toContain('2 stops');
    expect(view.textContent).not.toContain('Stop 2');
    expect(view.textContent).toContain('Move the mouse over the map and press 1 to place Stop 1');
  });

  it('marks start and end terminals through stop role editing', () => {
    const view = renderWorkspace();

    expect(view.textContent).toContain('Move the mouse over the map and press 1 to place Stop 1');
    expect(view.textContent).not.toContain('Route status');

    flushSync(() => {
      addMapStop(view);
    });
    expect(view.textContent).toContain('Stop role');

    const roleSelect = view.querySelector('#rp2-stop-role') as HTMLSelectElement | null;
    expect(roleSelect).not.toBeNull();

    flushSync(() => {
      setInputValue(roleSelect!, 'start-terminal');
    });
    flushSync(() => {
      addMapStop(view);
    });
    flushSync(() => {
      click(findButton(view, 'Stop 2'));
    });

    expect(view.textContent).toContain('Press 1 to add stops at the mouse pointer');
    expect(view.textContent).toContain('Press 2 near a route segment to add a bend');

    const updatedRoleSelect = view.querySelector('#rp2-stop-role') as HTMLSelectElement | null;
    flushSync(() => {
      setInputValue(updatedRoleSelect!, 'end-terminal');
    });
    expect(view.textContent).toContain('Fallback estimate');
    expect(view.textContent).toContain('Segment runtimes');
    expect(view.textContent).toContain('Dwell / stop sec');
    expect(view.textContent).toContain('Terminal layover stays separate');
    expect(view.textContent).toContain('Override min');
  });

  it('lets planners choose closed-loop and out-and-back route shapes from the map guide', () => {
    const view = renderWorkspace();

    flushSync(() => {
      addMapStop(view);
    });
    flushSync(() => {
      addMapStop(view);
    });
    expect(view.textContent).toContain('One-way');
    expect(view.textContent).toContain('Out and back');
    expect(view.textContent).not.toContain('Closed loop');

    flushSync(() => {
      addMapStop(view);
    });
    expect(view.textContent).toContain('Closed loop');

    flushSync(() => {
      click(findButton(view, 'Closed loop'));
    });

    expect(view.textContent).toContain('Closed loop route');
    expect(view.textContent).toContain('Closed loop: 1 → 2 → 3 → 1');

    flushSync(() => {
      click(findButton(view, 'Out and back'));
    });

    expect(view.textContent).toContain('Out and back to Stop 3');
    expect(view.textContent).toContain('Out and back: 1 → 2 → 3 → 2 → 1');
    expect(view.textContent).not.toContain('Mark selected stop as bus turnaround');
  });

  it('creates an editable back direction from a one-way out route', () => {
    const view = renderWorkspace();

    flushSync(() => {
      addMapStop(view);
    });
    flushSync(() => {
      addMapStop(view);
    });
    flushSync(() => {
      addMapStop(view);
    });

    expect(view.textContent).toContain('Create back direction');

    flushSync(() => {
      click(findButton(view, 'Create back direction'));
    });

    expect(view.textContent).toContain('Clean Concept A Out');
    expect(view.textContent).toContain('Clean Concept A Back');
    expect(view.querySelector('[data-testid="rp2-stop-order-panel"]')?.textContent).toContain('1Stop 3');
  });

  it('updates feasibility outputs when service assumptions change', () => {
    const view = renderWorkspace();

    flushSync(() => {
      addMapStop(view);
    });
    const roleSelect = view.querySelector('#rp2-stop-role') as HTMLSelectElement | null;
    flushSync(() => {
      setInputValue(roleSelect!, 'start-terminal');
    });
    flushSync(() => {
      addMapStop(view);
    });
    flushSync(() => {
      click(findButton(view, 'Stop 2'));
    });
    const updatedRoleSelect = view.querySelector('#rp2-stop-role') as HTMLSelectElement | null;
    flushSync(() => {
      setInputValue(updatedRoleSelect!, 'end-terminal');
    });

    const numberInputs = Array.from(view.querySelectorAll('input[type="number"]')) as HTMLInputElement[];
    const frequencyInput = numberInputs.find((input) => input.value === '30');
    expect(frequencyInput).toBeTruthy();

    flushSync(() => {
      setInputValue(frequencyInput!, '0');
    });

    expect(view.textContent).not.toContain('Needs attention');
    expect(view.textContent).not.toContain('Ready for runtime review');
    expect(view.textContent).toContain('Segment runtimes');
  });
});
