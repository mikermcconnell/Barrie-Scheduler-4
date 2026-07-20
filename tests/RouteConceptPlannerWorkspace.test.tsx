import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { flushSync } from 'react-dom';

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  load: vi.fn(),
  save: vi.fn(),
  saveCopy: vi.fn(),
  loadGtfs: vi.fn(),
  convertGtfs: vi.fn(),
  searchPlaces: vi.fn(),
  resume: vi.fn(),
  delayedRuntime: null as null | ((evidence: unknown[]) => void),
}));

vi.mock('../utils/route-concept-planner/routeConceptPlannerPersistence', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils/route-concept-planner/routeConceptPlannerPersistence')>();
  return {
    ...actual,
    listRouteConceptSavedProjects: mocks.list,
    loadRouteConceptProject: mocks.load,
    saveRouteConceptProject: mocks.save,
    saveRouteConceptProjectAsCopy: mocks.saveCopy,
  };
});

vi.mock('../utils/route-concept-planner/routeConceptPlannerGtfsAdapter', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils/route-concept-planner/routeConceptPlannerGtfsAdapter')>();
  return { ...actual, loadRouteConceptGtfsPatterns: mocks.loadGtfs, convertRouteConceptGtfsSelections: mocks.convertGtfs };
});

vi.mock('../utils/workspaces/fixedRouteResumeState', () => ({ saveFixedRouteResumeState: mocks.resume }));
vi.mock('../utils/route-concept-planner/routeConceptPlannerEngineAdapter', () => ({ searchRouteConceptPlaces: mocks.searchPlaces }));

vi.mock('../components/Analytics/route-concept-planner/RouteConceptMapBridge', () => ({
  RouteConceptMapBridge: (props: { pattern: { name: string }; onAddStop: (point: { lat: number; lng: number; name: string }) => void; onRuntimeEstimates: (evidence: unknown[]) => void }) => {
    if (!mocks.delayedRuntime) mocks.delayedRuntime = props.onRuntimeEstimates;
    return React.createElement('div', { 'data-testid': 'concept-map' },
      React.createElement('span', null, `Map: ${props.pattern.name}`),
      React.createElement('button', { onClick: () => props.onAddStop({ lat: 44.38, lng: -79.69, name: 'Downtown Terminal' }) }, 'Add neutral stop'),
      React.createElement('button', { onClick: () => mocks.delayedRuntime?.([]) }, 'Apply delayed evidence'));
  },
}));

vi.mock('../components/Analytics/route-concept-planner/RouteConceptGtfsImportDrawer', () => ({
  RouteConceptGtfsImportDrawer: ({ open, onImport }: { open: boolean; onImport: (patterns: unknown[]) => void }) => open
    ? React.createElement('div', { role: 'dialog', 'aria-label': 'GTFS drawer' }, React.createElement('button', { onClick: () => onImport([{ id: 'gtfs-1' }]) }, 'Import selected'))
    : null,
}));

import { createRouteConceptProject } from '../utils/route-concept-planner';
import { RouteConceptPlannerWorkspace } from '../components/Analytics/RouteConceptPlannerWorkspace';

const click = (container: HTMLElement, text: string) => {
  const element = Array.from(container.querySelectorAll('button')).find((button) => button.textContent?.toLowerCase().includes(text.toLowerCase()));
  if (!element) throw new Error(`Missing button: ${text}`);
  act(() => element.dispatchEvent(new MouseEvent('click', { bubbles: true })));
};

describe('RouteConceptPlannerWorkspace', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.list.mockResolvedValue([]);
    mocks.loadGtfs.mockResolvedValue([]);
    mocks.searchPlaces.mockResolvedValue([]);
    mocks.delayedRuntime = null;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    flushSync(() => root.render(<RouteConceptPlannerWorkspace onBack={vi.fn()} teamId="team-1" userId="user-1" />));
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('starts from a neutral three-path entry screen and creates a complete-route study', () => {
    expect(container.textContent).toContain('Import GTFS route');
    expect(container.textContent).toContain('Start blank');
    expect(container.textContent).toContain('Load team project');
    click(container, 'Create concept');
    expect(container.textContent).toContain('Complete-route alternatives');
    expect(container.textContent).toContain('Outbound');
    expect(container.textContent).toContain('Inbound');
    expect(container.textContent?.toLowerCase()).not.toContain('camper');
    expect(mocks.resume).toHaveBeenCalledWith(expect.objectContaining({
      hash: '#planning/route-concept-planner',
      label: 'Planning Data · Route Concept Planner · Untitled Route Concept Study',
    }), 'user-1');
  });

  it('lets the planner choose the structure of each added alternative', () => {
    click(container, 'Create concept');
    act(() => (container.querySelector('[aria-label="Add alternative"]') as HTMLButtonElement).click());
    click(container, 'Out and back');
    expect(container.textContent).toContain('out and back');
    expect(container.textContent).toContain('Return');
    act(() => (container.querySelector('[aria-label="Add alternative"]') as HTMLButtonElement).click());
    click(container, 'Loop');
    expect(container.textContent).toContain('Compare 3');
  });

  it('keeps map authoring neutral and exposes service/review controls with actionable issues', () => {
    click(container, 'Create concept');
    click(container, 'Add neutral stop');
    expect(container.textContent).toContain('Downtown Terminal');
    click(container, 'Service');
    expect(container.querySelector('[aria-label="First departure"]')).not.toBeNull();
    expect(container.textContent).toContain('next-day service');
    click(container, 'Review');
    expect(container.textContent).toContain('Actionable issues');
    expect(container.textContent).toContain('Runtime source mix');
    expect(container.textContent).toContain('Mark ready for review');
    expect(container.textContent).toContain('needs at least two stops');
  });

  it('applies delayed runtime updates to the latest pattern without losing newer stop edits', () => {
    click(container, 'Create concept');
    click(container, 'Add neutral stop');
    click(container, 'Apply delayed evidence');
    expect(container.textContent).toContain('Downtown Terminal');
    expect(container.textContent).toContain('Stops · 1');
  });

  it('searches for an individual place and adds the selected result as a custom stop', async () => {
    mocks.searchPlaces.mockResolvedValue([{ id: 'place-1', name: 'City Hall', label: '70 Collier Street, Barrie', lat: 44.389, lng: -79.69 }]);
    click(container, 'Create concept');
    const input = container.querySelector('[aria-label="Search places or addresses"]') as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    act(() => { setter?.call(input, 'City Hall'); input.dispatchEvent(new Event('input', { bubbles: true })); });
    const searchButton = container.querySelector('[aria-label="Search places"]') as HTMLButtonElement;
    await act(async () => searchButton.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(mocks.searchPlaces).toHaveBeenCalledWith('City Hall', { limit: 5 });
    click(container, 'City Hall');
    expect(container.textContent).toContain('City Hall');
    expect(container.textContent?.toLowerCase()).not.toContain('camper');
  });

  it('shows load failures on the start screen', async () => {
    mocks.list.mockRejectedValue(new Error('Team projects are unavailable.'));
    await act(async () => click(container, 'Load team project'));
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Team projects are unavailable.');
  });

  it('preserves local work and offers only safe conflict resolutions', async () => {
    click(container, 'Create concept');
    mocks.save.mockRejectedValue(Object.assign(new Error('conflict'), { code: 'revision-conflict' }));
    await act(async () => click(container, 'Save'));
    expect(container.textContent).toContain('A newer team version exists');
    expect(container.textContent).toContain('Reload team version');
    expect(container.textContent).toContain('Save local work as a new copy');
    expect(container.textContent).toContain('Keep editing');
    expect((container.querySelector('[aria-label="Project name"]') as HTMLInputElement).value).toBe('Untitled Route Concept Study');
  });

  it('moves focus into overlays, closes on Escape, and restores the opener', async () => {
    const opener = Array.from(container.querySelectorAll('button')).find((button) => button.textContent?.includes('Load team project')) as HTMLButtonElement;
    opener.focus();
    await act(async () => opener.click());
    const dialog = container.querySelector('[role="dialog"]') as HTMLElement;
    expect(dialog?.getAttribute('aria-labelledby')).toBe('route-concept-load-title');
    expect((document.activeElement as HTMLElement)?.getAttribute('aria-label')).toBe('Close team projects');
    act(() => dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it('announces tabs and offers keyboard editing for stops, runtimes, and bends', () => {
    click(container, 'Create concept');
    click(container, 'Add neutral stop');
    click(container, 'Add neutral stop');
    const routeTab = container.querySelector('[role="tab"][aria-selected="true"]') as HTMLButtonElement;
    expect(routeTab.textContent).toBe('route');
    act(() => routeTab.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })));
    expect(container.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe('service');
    click(container, 'Route');
    click(container, 'Downtown Terminal');
    const editor = Array.from(container.querySelectorAll('summary')).find((summary) => summary.textContent?.includes('Keyboard route editor')) as HTMLElement;
    act(() => editor.click());
    expect(container.querySelector('[aria-label^="Latitude for Downtown Terminal"]')).not.toBeNull();
    const runtime = container.querySelector('[aria-label^="Runtime override for Downtown Terminal to Downtown Terminal"]') as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    act(() => { setter?.call(runtime, '12'); runtime.dispatchEvent(new Event('input', { bubbles: true })); });
    expect((container.querySelector('[aria-label^="Runtime override for Downtown Terminal to Downtown Terminal"]') as HTMLInputElement).value).toBe('12');
    click(container, 'Add bend at midpoint');
    expect(container.querySelector('[aria-label^="Latitude for bend 1"]')).not.toBeNull();
    expect(container.textContent).toContain('Remove bend 1');
  });

  it('imports GTFS alternatives without replacing the start screen until selection is confirmed', async () => {
    const imported = createRouteConceptProject({ name: 'Route 8A Study', structure: 'loop' }).alternatives.map((alternative) => ({ ...alternative, name: 'Route 8A Study' }));
    mocks.convertGtfs.mockReturnValue(imported);
    await act(async () => click(container, 'Import GTFS route'));
    expect(container.querySelector('[aria-label="GTFS drawer"]')).not.toBeNull();
    click(container, 'Import selected');
    expect(container.textContent).toContain('Route 8A Study');
    expect(container.textContent).toContain('Loop');
  });

  it('offers an editable reversed return for an incomplete one-direction import', async () => {
    const imported = createRouteConceptProject({ name: 'Route 1 Study' }).alternatives;
    imported[0]!.patterns = [imported[0]!.patterns[0]!];
    imported[0]!.patternOrder = [imported[0]!.patterns[0]!.id];
    imported[0]!.patterns[0]!.stops = [
      { id: 'a', name: 'Terminal A', lat: 44.38, lng: -79.7, sequence: 1, role: 'start-terminal', source: 'gtfs' },
      { id: 'b', name: 'Terminal B', lat: 44.39, lng: -79.69, sequence: 2, role: 'end-terminal', source: 'gtfs' },
    ];
    imported[0]!.patterns[0]!.runtimeEvidence = [{ id: 'ab', fromStopId: 'a', toStopId: 'b', runtimeMinutes: 8, source: 'gtfs' }];
    mocks.convertGtfs.mockReturnValue(imported);
    await act(async () => click(container, 'Import GTFS route'));
    click(container, 'Import selected');
    expect(container.textContent).toContain('Create editable return');
    click(container, 'Create editable return');
    expect(container.textContent).toContain('Return');
    expect(container.textContent).not.toContain('Create editable return');
  });

  it('includes vehicle hours in the comparison table', () => {
    click(container, 'Create concept');
    click(container, 'Compare 1');
    expect(container.textContent).toContain('Vehicle hours');
  });
});
