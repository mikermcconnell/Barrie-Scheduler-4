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

vi.mock('html2canvas', () => ({
  default: vi.fn(async () => ({
    width: 1200,
    height: 800,
    toDataURL: () => 'data:image/png;base64,mock-route-map',
  })),
}));

import { RoutePlanner2Workspace } from '../components/Analytics/RoutePlanner2Workspace';
import { buildCorridorSpeedIndex, buildCorridorSpeedMapIndex } from '../utils/gtfs/corridorSpeed';
import { addRoutePlanner2LineWaypoint, addRoutePlanner2Stop } from '../utils/route-planner-2/routePlanner2Authoring';
import { exportRoutePlanner2MapPdf } from '../utils/route-planner-2/routePlanner2MapExport';
import { createRoutePlanner2Project } from '../utils/route-planner-2/routePlanner2ProjectFactory';

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

async function waitForExportCall(timeoutMs = 1200) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (vi.mocked(exportRoutePlanner2MapPdf).mock.calls.length > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

describe('RoutePlanner2Workspace local workspace', () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  afterEach(() => {
    projectPersistenceMocks.listRoutePlanner2SavedProjects.mockClear();
    projectPersistenceMocks.loadRoutePlanner2Project.mockClear();
    projectPersistenceMocks.saveRoutePlanner2Project.mockClear();

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
    expect(view.textContent).toContain('Operator PDF');
    expect(view.textContent).toContain('Map PDF');
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
    const mapPdfButton = findButton(view, 'Map PDF');

    expect(mapPdfButton?.disabled).toBe(true);
    expect(exportRoutePlanner2MapPdf).not.toHaveBeenCalled();
  });

  it('enables Map PDF export once the selected route has at least two stops', async () => {
    const view = renderWorkspace();

    flushSync(() => {
      addMapStop(view);
      addMapStop(view);
    });

    const mapPdfButton = findButton(view, 'Map PDF');
    expect(mapPdfButton?.disabled).toBe(false);

    flushSync(() => {
      click(mapPdfButton);
    });
    await waitForExportCall();

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
    expect(view.textContent).toContain('Mapbox only');

    flushSync(() => {
      click(findButton(view, 'GTFS route run time'));
    });

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
  });

  it('adds Option 2 as a local route', () => {
    const view = renderWorkspace();

    flushSync(() => {
      click(findButton(view, 'Add route'));
    });

    expect(view.textContent).toContain('Option 2');
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

    expect(workspaceShell?.getAttribute('data-layout')).toBe('map-first');
    expect(view.textContent).toContain('Route concepts');
    expect(view.querySelector('[data-testid="rp2-left-rail"]')).toBeNull();
    expect(actionSidebar?.getAttribute('data-state')).toBe('collapsed');
    expect(rightRail?.getAttribute('data-state')).toBe('open');
    expect(mapCanvas?.style.getPropertyValue('--rp2-overlay-left')).toBe('6rem');
    expect(mapCanvas?.style.getPropertyValue('--rp2-overlay-right')).toBe('26.5rem');
    expect(view.textContent).toContain('Draw route');

    flushSync(() => {
      click(findButton(view, 'Actions'));
    });

    expect(actionSidebar?.getAttribute('data-state')).toBe('expanded');
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

  it('shows kids, kids total, and running time on stop cards', () => {
    const view = renderWorkspace();

    flushSync(() => {
      addMapStop(view);
    });

    const stopCard = view.querySelector('[data-testid^="rp2-stop-order-item-"]');

    expect(stopCard?.textContent).toContain('Kids 0');
    expect(stopCard?.textContent).toContain('Kids total 0');
    expect(stopCard?.textContent).toContain('From previous Start');
    expect(stopCard?.textContent).toContain('Running time 0 min');
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
    expect(view.querySelector('[data-testid="rp2-stop-order-panel"]')?.textContent).toContain('10Stop 10');
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

  it('moves a stop range into another route concept from the details panel', async () => {
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

    const fromSelect = view.querySelector('#rp2-transfer-from') as HTMLSelectElement | null;
    const toSelect = view.querySelector('#rp2-transfer-to') as HTMLSelectElement | null;
    const targetSelect = view.querySelector('#rp2-transfer-target') as HTMLSelectElement | null;
    expect(fromSelect).not.toBeNull();
    expect(toSelect).not.toBeNull();
    expect(targetSelect?.selectedOptions[0]?.textContent).toContain('Option 2');

    flushSync(() => {
      setInputValue(toSelect!, '3');
    });
    flushSync(() => {
      click(findButton(view, 'Move stops'));
    });

    const routeCards = Array.from(view.querySelectorAll('button')).filter((button) =>
      button.textContent?.includes('Clean Concept A') || button.textContent?.includes('Option 2'),
    );
    expect(routeCards.some((button) => button.textContent?.includes('Clean Concept A') && button.textContent?.includes('1 stops'))).toBe(true);
    expect(routeCards.some((button) => button.textContent?.includes('Option 2') && button.textContent?.includes('2 stops'))).toBe(true);
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
