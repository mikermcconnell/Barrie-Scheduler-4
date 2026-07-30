import React, { useEffect } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';

const html2canvasMock = vi.hoisted(() => vi.fn(async () => ({
  width: 1850,
  height: 1000,
  getContext: vi.fn(),
  toDataURL: vi.fn(() => 'data:image/png;base64,mock-capture'),
})));

vi.mock('html2canvas', () => ({
  default: html2canvasMock,
}));

vi.mock('react-map-gl/mapbox', () => ({
  Source: ({ children, id, data }: { children?: React.ReactNode; id?: string; data?: { features?: unknown[] } }) => (
    <div data-testid={id ? `mock-source-${id}` : undefined} data-feature-count={data?.features?.length ?? ''}>
      {children}
    </div>
  ),
  Layer: (): null => null,
  Marker: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}));

vi.mock('../components/shared', () => ({
  MapBase: ({ children, onLoad, onClick, onMouseMove }: {
    children?: React.ReactNode;
    onLoad?: () => void;
    onMouseMove?: (event: {
      lngLat: { lat: number; lng: number };
      features: Array<{ layer: { id: string } }>;
    }) => void;
    onClick?: (event: {
      lngLat: { lat: number; lng: number };
      features: Array<{ layer: { id: string } }>;
    }) => void;
  }) => {
    useEffect(() => {
      onLoad?.();
    }, [onLoad]);

    return (
      <div>
        <button
          type="button"
          data-testid="mock-route-line-click"
          onClick={() => onClick?.({
            lngLat: { lat: 44.385, lng: -79.685 },
            features: [{ layer: { id: 'route-planner-2-line-hit' } }],
          })}
        >
          map route line
        </button>
        <button
          type="button"
          data-testid="mock-blank-map-click"
          onClick={() => onClick?.({
            lngLat: { lat: 44.395, lng: -79.675 },
            features: [],
          })}
        >
          blank map
        </button>
        <button
          type="button"
          data-testid="mock-map-move"
          onClick={() => onMouseMove?.({
            lngLat: { lat: 44.386, lng: -79.686 },
            features: [],
          })}
        >
          move pointer
        </button>
        {children}
      </div>
    );
  },
}));

vi.mock('../utils/route-planner-2/routePlanner2RoadSnap', () => ({
  buildRoutePlanner2FallbackRoadSnapResult: (scenario: {
    stops: Array<{ id: string; lat: number; lng: number }>;
  }) => {
    const segmentGeometries = scenario.stops.slice(0, -1).map((stop, index) => {
      const nextStop = scenario.stops[index + 1]!;
      return {
        id: `segment-${stop.id}-${nextStop.id}`,
        fromStopId: stop.id,
        toStopId: nextStop.id,
        coordinates: [[stop.lng, stop.lat], [nextStop.lng, nextStop.lat]],
        roadLabels: [{
          name: 'Mapleview Drive',
          coordinates: [[stop.lng, stop.lat], [nextStop.lng, nextStop.lat]],
        }],
      };
    });

    return {
      coordinates: scenario.stops.map((stop) => [stop.lng, stop.lat]),
      segmentGeometries,
      segmentEstimates: segmentGeometries.map((segment) => ({
        id: segment.id,
        fromStopId: segment.fromStopId,
        toStopId: segment.toStopId,
        runtimeMinutes: 5,
        source: 'fallback',
        confidence: 'low',
      })),
    };
  },
  snapRoutePlanner2ScenarioToRoad: vi.fn(async (scenario: {
    stops: Array<{ id: string; lat: number; lng: number }>;
  }) => ({
    coordinates: scenario.stops.map((stop) => [stop.lng, stop.lat]),
    segmentGeometries: scenario.stops.slice(0, -1).map((stop, index) => {
      const nextStop = scenario.stops[index + 1]!;
      return {
        id: `segment-${stop.id}-${nextStop.id}`,
        fromStopId: stop.id,
        toStopId: nextStop.id,
        coordinates: [[stop.lng, stop.lat], [nextStop.lng, nextStop.lat]],
        roadLabels: [{
          name: 'Mapleview Drive',
          coordinates: [[stop.lng, stop.lat], [nextStop.lng, nextStop.lat]],
        }],
      };
    }),
    segmentEstimates: [],
  })),
}));

vi.mock('../utils/route-planner-2/routePlanner2AddressSearch', () => ({
  searchRoutePlanner2Addresses: vi.fn(async () => []),
}));

import { RoutePlanner2MapCanvas, type RoutePlanner2MapCanvasHandle } from '../components/Analytics/route-planner-2/RoutePlanner2MapCanvas';
import { addRoutePlanner2LineWaypoint, addRoutePlanner2Stop, updateRoutePlanner2RouteShape } from '../utils/route-planner-2/routePlanner2Authoring';
import { createRoutePlanner2Project } from '../utils/route-planner-2/routePlanner2ProjectFactory';
import { snapRoutePlanner2ScenarioToRoad } from '../utils/route-planner-2/routePlanner2RoadSnap';

function click(element: Element | null | undefined) {
  element?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
}

function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

describe('RoutePlanner2MapCanvas runtime popover', () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  afterEach(() => {
    if (root) {
      flushSync(() => root?.unmount());
    }
    container?.remove();
    root = null;
    container = null;
    html2canvasMock.mockClear();
    vi.mocked(snapRoutePlanner2ScenarioToRoad).mockClear();
  });

  it('lets planners save a manual runtime override from a clicked map segment', async () => {
    let project = createRoutePlanner2Project({ id: 'project-1', scenarioId: 'scenario-1', now: '2026-05-13T12:00:00.000Z' });
    project = addRoutePlanner2Stop(project, 'scenario-1', { id: 'stop-1', name: 'Downtown Terminal', lat: 44.38, lng: -79.69 });
    project = addRoutePlanner2Stop(project, 'scenario-1', { id: 'stop-2', name: 'Georgian Mall', lat: 44.39, lng: -79.68 });
    const scenario = project.scenarios[0]!;
    const onSetSegmentRuntimeOverride = vi.fn();

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    flushSync(() => {
      root?.render(
        <RoutePlanner2MapCanvas
          scenario={scenario}
          selectedStopId={null}
          onSelectStop={() => {}}
          onAddStop={() => {}}
          onDeleteStop={() => {}}
          onMoveStop={() => {}}
          onAddLineWaypoint={() => {}}
          onInsertStopOnLine={() => {}}
          onMoveLineWaypoint={() => {}}
          onDeleteLineWaypoint={() => {}}
          onSegmentRuntimeEstimates={() => {}}
          onSetSegmentRuntimeOverride={onSetSegmentRuntimeOverride}
          segmentRuntimes={[{
            id: 'segment-stop-1-stop-2',
            fromStopId: 'stop-1',
            toStopId: 'stop-2',
            runtimeMinutes: 8,
            source: 'mapbox',
            confidence: 'medium',
          }]}
        />,
      );
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    flushSync(() => {
      click(container?.querySelector('[data-testid="mock-route-line-click"]'));
    });

    expect(container.textContent).toContain('Segment runtime');
    expect(container.textContent).toContain('Downtown Terminal');
    expect(container.textContent).toContain('Current travel time');
    expect(container.textContent).toContain('8 min');

    const input = container.querySelector('input[aria-label="Manual segment travel time in minutes"]') as HTMLInputElement | null;
    expect(input).not.toBeNull();

    flushSync(() => {
      setInputValue(input!, '11');
      click(Array.from(container!.querySelectorAll('button')).find((button) => button.textContent?.includes('Save override')));
    });

    expect(onSetSegmentRuntimeOverride).toHaveBeenCalledWith('segment-stop-1-stop-2', 11);
  });

  it('defaults bend anchors to the clicked direction only', async () => {
    let project = createRoutePlanner2Project({ id: 'project-1', scenarioId: 'scenario-1', now: '2026-05-13T12:00:00.000Z' });
    project = addRoutePlanner2Stop(project, 'scenario-1', { id: 'stop-1', name: 'Downtown Terminal', lat: 44.38, lng: -79.69 });
    project = addRoutePlanner2Stop(project, 'scenario-1', { id: 'stop-2', name: 'Georgian Mall', lat: 44.39, lng: -79.68 });
    project = updateRoutePlanner2RouteShape(project, 'scenario-1', 'out-and-back', { turnaroundStopId: 'stop-2' });
    const onAddLineWaypoint = vi.fn();

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    flushSync(() => {
      root?.render(
        <RoutePlanner2MapCanvas
          scenario={project.scenarios[0]!}
          selectedStopId={null}
          onSelectStop={() => {}}
          onAddStop={() => {}}
          onDeleteStop={() => {}}
          onMoveStop={() => {}}
          onAddLineWaypoint={onAddLineWaypoint}
          onInsertStopOnLine={() => {}}
          onMoveLineWaypoint={() => {}}
          onDeleteLineWaypoint={() => {}}
          onSegmentRuntimeEstimates={() => {}}
        />,
      );
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    flushSync(() => {
      click(container?.querySelector('[data-testid="mock-route-line-click"]'));
    });

    expect(container.textContent).toContain('Apply to return direction too');

    flushSync(() => {
      click(Array.from(container!.querySelectorAll('button')).find((button) => button.textContent?.includes('Add bend here')));
    });

    expect(onAddLineWaypoint).toHaveBeenCalledWith(expect.objectContaining({
      fromStopId: 'stop-1',
      toStopId: 'stop-2',
      applyToOppositeDirection: false,
    }));
  });

  it('uses 1 to add a stop at the current mouse position without a map click', async () => {
    let project = createRoutePlanner2Project({ id: 'project-1', scenarioId: 'scenario-1', now: '2026-05-13T12:00:00.000Z' });
    project = addRoutePlanner2Stop(project, 'scenario-1', { id: 'stop-1', name: 'Downtown Terminal', lat: 44.38, lng: -79.69 });
    project = addRoutePlanner2Stop(project, 'scenario-1', { id: 'stop-2', name: 'Georgian Mall', lat: 44.39, lng: -79.68 });
    const onAddStop = vi.fn();

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    flushSync(() => {
      root?.render(
        <RoutePlanner2MapCanvas
          scenario={project.scenarios[0]!}
          selectedStopId={null}
          onSelectStop={() => {}}
          onAddStop={onAddStop}
          onDeleteStop={() => {}}
          onMoveStop={() => {}}
          onAddLineWaypoint={() => {}}
          onInsertStopOnLine={() => {}}
          onMoveLineWaypoint={() => {}}
          onDeleteLineWaypoint={() => {}}
          onSegmentRuntimeEstimates={() => {}}
        />,
      );
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    flushSync(() => {
      click(container?.querySelector('[data-testid="mock-map-move"]'));
    });

    flushSync(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: '1', bubbles: true }));
    });

    expect(onAddStop).toHaveBeenCalledWith(expect.objectContaining({
      lat: 44.386,
      lng: -79.686,
    }));
  });

  it('keeps fallback runtime estimates when large routes skip automatic road snapping', async () => {
    let project = createRoutePlanner2Project({ id: 'project-1', scenarioId: 'scenario-1', now: '2026-05-13T12:00:00.000Z' });
    for (let index = 0; index < 352; index += 1) {
      project = addRoutePlanner2Stop(project, 'scenario-1', {
        id: `stop-${index + 1}`,
        name: `Stop ${index + 1}`,
        lat: 44.38 + (index * 0.0001),
        lng: -79.69 + (index * 0.0001),
      });
    }
    const onSegmentRuntimeEstimates = vi.fn();

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    flushSync(() => {
      root?.render(
        <RoutePlanner2MapCanvas
          scenario={project.scenarios[0]!}
          selectedStopId={null}
          onSelectStop={() => {}}
          onAddStop={() => {}}
          onDeleteStop={() => {}}
          onMoveStop={() => {}}
          onAddLineWaypoint={() => {}}
          onInsertStopOnLine={() => {}}
          onMoveLineWaypoint={() => {}}
          onDeleteLineWaypoint={() => {}}
          onSegmentRuntimeEstimates={onSegmentRuntimeEstimates}
        />,
      );
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(snapRoutePlanner2ScenarioToRoad).not.toHaveBeenCalled();
    expect(onSegmentRuntimeEstimates).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          fromStopId: 'stop-1',
          toStopId: 'stop-2',
          source: 'fallback',
        }),
      ]),
      expect.objectContaining({
        requestKind: 'background',
        failures: [expect.objectContaining({ code: 'segment-limit' })],
      }),
    );
    expect(onSegmentRuntimeEstimates.mock.calls[0]?.[0]).toHaveLength(351);
  });

  it('uses 2 to add a bend at the current mouse position on the nearest segment', async () => {
    let project = createRoutePlanner2Project({ id: 'project-1', scenarioId: 'scenario-1', now: '2026-05-13T12:00:00.000Z' });
    project = addRoutePlanner2Stop(project, 'scenario-1', { id: 'stop-1', name: 'Downtown Terminal', lat: 44.38, lng: -79.69 });
    project = addRoutePlanner2Stop(project, 'scenario-1', { id: 'stop-2', name: 'Georgian Mall', lat: 44.39, lng: -79.68 });
    const onAddLineWaypoint = vi.fn();

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    flushSync(() => {
      root?.render(
        <RoutePlanner2MapCanvas
          scenario={project.scenarios[0]!}
          selectedStopId={null}
          onSelectStop={() => {}}
          onAddStop={() => {}}
          onDeleteStop={() => {}}
          onMoveStop={() => {}}
          onAddLineWaypoint={onAddLineWaypoint}
          onInsertStopOnLine={() => {}}
          onMoveLineWaypoint={() => {}}
          onDeleteLineWaypoint={() => {}}
          onSegmentRuntimeEstimates={() => {}}
        />,
      );
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    flushSync(() => {
      click(container?.querySelector('[data-testid="mock-map-move"]'));
    });

    flushSync(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: '2', bubbles: true }));
    });

    expect(onAddLineWaypoint).toHaveBeenCalledWith(expect.objectContaining({
      fromStopId: 'stop-1',
      toStopId: 'stop-2',
      coordinate: { lat: 44.386, lng: -79.686 },
    }));
  });

  it('can apply a bend anchor to the return direction when selected', async () => {
    let project = createRoutePlanner2Project({ id: 'project-1', scenarioId: 'scenario-1', now: '2026-05-13T12:00:00.000Z' });
    project = addRoutePlanner2Stop(project, 'scenario-1', { id: 'stop-1', name: 'Downtown Terminal', lat: 44.38, lng: -79.69 });
    project = addRoutePlanner2Stop(project, 'scenario-1', { id: 'stop-2', name: 'Georgian Mall', lat: 44.39, lng: -79.68 });
    project = updateRoutePlanner2RouteShape(project, 'scenario-1', 'out-and-back', { turnaroundStopId: 'stop-2' });
    const onAddLineWaypoint = vi.fn();

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    flushSync(() => {
      root?.render(
        <RoutePlanner2MapCanvas
          scenario={project.scenarios[0]!}
          selectedStopId={null}
          onSelectStop={() => {}}
          onAddStop={() => {}}
          onDeleteStop={() => {}}
          onMoveStop={() => {}}
          onAddLineWaypoint={onAddLineWaypoint}
          onInsertStopOnLine={() => {}}
          onMoveLineWaypoint={() => {}}
          onDeleteLineWaypoint={() => {}}
          onSegmentRuntimeEstimates={() => {}}
        />,
      );
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    flushSync(() => {
      click(container?.querySelector('[data-testid="mock-route-line-click"]'));
    });

    flushSync(() => {
      click(container?.querySelector('input[aria-label="Apply bend anchor to return direction too"]'));
    });

    flushSync(() => {
      click(Array.from(container!.querySelectorAll('button')).find((button) => button.textContent?.includes('Add bend here')));
    });

    expect(onAddLineWaypoint).toHaveBeenCalledWith(expect.objectContaining({
      fromStopId: 'stop-1',
      toStopId: 'stop-2',
      applyToOppositeDirection: true,
    }));
  });

  it('uses a blank map click to close the segment popover without adding a stop', async () => {
    let project = createRoutePlanner2Project({ id: 'project-1', scenarioId: 'scenario-1', now: '2026-05-13T12:00:00.000Z' });
    project = addRoutePlanner2Stop(project, 'scenario-1', { id: 'stop-1', name: 'Downtown Terminal', lat: 44.38, lng: -79.69 });
    project = addRoutePlanner2Stop(project, 'scenario-1', { id: 'stop-2', name: 'Georgian Mall', lat: 44.39, lng: -79.68 });
    const onAddStop = vi.fn();

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    flushSync(() => {
      root?.render(
        <RoutePlanner2MapCanvas
          scenario={project.scenarios[0]!}
          selectedStopId={null}
          onSelectStop={() => {}}
          onAddStop={onAddStop}
          onDeleteStop={() => {}}
          onMoveStop={() => {}}
          onAddLineWaypoint={() => {}}
          onInsertStopOnLine={() => {}}
          onMoveLineWaypoint={() => {}}
          onDeleteLineWaypoint={() => {}}
          onSegmentRuntimeEstimates={() => {}}
        />,
      );
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    flushSync(() => {
      click(container?.querySelector('[data-testid="mock-route-line-click"]'));
    });

    expect(container.querySelector('[data-testid="rp2-segment-runtime-popover"]')).not.toBeNull();

    flushSync(() => {
      click(container?.querySelector('[data-testid="mock-blank-map-click"]'));
    });

    expect(container.querySelector('[data-testid="rp2-segment-runtime-popover"]')).toBeNull();
    expect(onAddStop).not.toHaveBeenCalled();
  });

  it('highlights hovered stop and bend markers from the review rail', async () => {
    let project = createRoutePlanner2Project({ id: 'project-1', scenarioId: 'scenario-1', now: '2026-05-13T12:00:00.000Z' });
    project = addRoutePlanner2Stop(project, 'scenario-1', { id: 'stop-1', name: 'Downtown Terminal', lat: 44.38, lng: -79.69 });
    project = addRoutePlanner2Stop(project, 'scenario-1', { id: 'stop-2', name: 'Georgian Mall', lat: 44.39, lng: -79.68 });
    project = addRoutePlanner2LineWaypoint(project, 'scenario-1', {
      id: 'bend-1',
      afterStopId: 'stop-1',
      beforeStopId: 'stop-2',
      lat: 44.385,
      lng: -79.685,
    });

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    flushSync(() => {
      root?.render(
        <RoutePlanner2MapCanvas
          scenario={project.scenarios[0]!}
          selectedStopId={null}
          highlightedStopId="stop-1"
          highlightedWaypointId="bend-1"
          onSelectStop={() => {}}
          onAddStop={() => {}}
          onDeleteStop={() => {}}
          onMoveStop={() => {}}
          onAddLineWaypoint={() => {}}
          onInsertStopOnLine={() => {}}
          onMoveLineWaypoint={() => {}}
          onDeleteLineWaypoint={() => {}}
          onSegmentRuntimeEstimates={() => {}}
        />,
      );
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(container.querySelector('button[aria-label="Select Downtown Terminal"]')?.getAttribute('data-highlighted')).toBe('true');
    expect(container.querySelector('button[aria-label="Drag route line anchor"]')?.getAttribute('data-highlighted')).toBe('true');
  });

  it('highlights a segment when requested by the runtime card hover state', async () => {
    let project = createRoutePlanner2Project({ id: 'project-1', scenarioId: 'scenario-1', now: '2026-05-13T12:00:00.000Z' });
    project = addRoutePlanner2Stop(project, 'scenario-1', { id: 'stop-1', name: 'Downtown Terminal', lat: 44.38, lng: -79.69 });
    project = addRoutePlanner2Stop(project, 'scenario-1', { id: 'stop-2', name: 'Georgian Mall', lat: 44.39, lng: -79.68 });

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    flushSync(() => {
      root?.render(
        <RoutePlanner2MapCanvas
          scenario={project.scenarios[0]!}
          selectedStopId={null}
          highlightedSegmentId="segment-stop-1-stop-2"
          onSelectStop={() => {}}
          onAddStop={() => {}}
          onDeleteStop={() => {}}
          onMoveStop={() => {}}
          onAddLineWaypoint={() => {}}
          onInsertStopOnLine={() => {}}
          onMoveLineWaypoint={() => {}}
          onDeleteLineWaypoint={() => {}}
          onSegmentRuntimeEstimates={() => {}}
        />,
      );
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    const highlightedSource = container.querySelector('[data-testid="mock-source-route-planner-2-highlighted-segment"]');
    expect(highlightedSource?.getAttribute('data-feature-count')).toBe('1');
  });

  it('renders road-name labels when the planner toggles them on', async () => {
    let project = createRoutePlanner2Project({ id: 'project-1', scenarioId: 'scenario-1', now: '2026-05-13T12:00:00.000Z' });
    project = addRoutePlanner2Stop(project, 'scenario-1', { id: 'stop-1', name: 'Downtown Terminal', lat: 44.38, lng: -79.69 });
    project = addRoutePlanner2Stop(project, 'scenario-1', { id: 'stop-2', name: 'Georgian Mall', lat: 44.39, lng: -79.68 });

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    flushSync(() => {
      root?.render(
        <RoutePlanner2MapCanvas
          scenario={project.scenarios[0]!}
          selectedStopId={null}
          showRoadNameLabels
          onSelectStop={() => {}}
          onAddStop={() => {}}
          onDeleteStop={() => {}}
          onMoveStop={() => {}}
          onAddLineWaypoint={() => {}}
          onInsertStopOnLine={() => {}}
          onMoveLineWaypoint={() => {}}
          onDeleteLineWaypoint={() => {}}
          onSegmentRuntimeEstimates={() => {}}
        />,
      );
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    const overviewRoadLabelSource = container.querySelector('[data-testid="mock-source-route-planner-2-road-name-overview-labels"]');
    const lineRoadLabelSource = container.querySelector('[data-testid="mock-source-route-planner-2-road-name-line-labels"]');
    expect(overviewRoadLabelSource?.getAttribute('data-feature-count')).toBe('1');
    expect(lineRoadLabelSource?.getAttribute('data-feature-count')).toBe('1');
  });

  it('forces road-name labels on while capturing the map PDF image', async () => {
    let project = createRoutePlanner2Project({ id: 'project-1', scenarioId: 'scenario-1', now: '2026-05-13T12:00:00.000Z' });
    project = addRoutePlanner2Stop(project, 'scenario-1', { id: 'stop-1', name: 'Downtown Terminal', lat: 44.38, lng: -79.69 });
    project = addRoutePlanner2Stop(project, 'scenario-1', { id: 'stop-2', name: 'Georgian Mall', lat: 44.39, lng: -79.68 });
    const mapRef = React.createRef<RoutePlanner2MapCanvasHandle>();

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    flushSync(() => {
      root?.render(
        <RoutePlanner2MapCanvas
          ref={mapRef}
          scenario={project.scenarios[0]!}
          selectedStopId={null}
          onSelectStop={() => {}}
          onAddStop={() => {}}
          onDeleteStop={() => {}}
          onMoveStop={() => {}}
          onAddLineWaypoint={() => {}}
          onInsertStopOnLine={() => {}}
          onMoveLineWaypoint={() => {}}
          onDeleteLineWaypoint={() => {}}
          onSegmentRuntimeEstimates={() => {}}
        />,
      );
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(container.querySelector('[data-testid="mock-source-route-planner-2-road-name-overview-labels"]')).toBeNull();
    expect(container.querySelector('[data-testid="mock-source-route-planner-2-road-name-line-labels"]')).toBeNull();

    html2canvasMock.mockImplementationOnce(async () => {
      const overviewRoadLabelSource = container?.querySelector('[data-testid="mock-source-route-planner-2-road-name-overview-labels"]');
      const lineRoadLabelSource = container?.querySelector('[data-testid="mock-source-route-planner-2-road-name-line-labels"]');
      expect(overviewRoadLabelSource?.getAttribute('data-feature-count')).toBe('1');
      expect(lineRoadLabelSource?.getAttribute('data-feature-count')).toBe('1');
      return {
        width: 1850,
        height: 1000,
        getContext: vi.fn(),
        toDataURL: vi.fn(() => 'data:image/png;base64,mock-capture'),
      };
    });

    const capture = await mapRef.current?.captureMapImage();

    expect(capture?.dataUrl).toBe('data:image/png;base64,mock-capture');
    expect(html2canvasMock).toHaveBeenCalledOnce();
  });

  it('can hide stop labels for the full-route overview export capture only', async () => {
    let project = createRoutePlanner2Project({ id: 'project-1', scenarioId: 'scenario-1', now: '2026-05-13T12:00:00.000Z' });
    project = addRoutePlanner2Stop(project, 'scenario-1', { id: 'stop-1', name: 'Downtown Terminal', lat: 44.38, lng: -79.69 });
    project = addRoutePlanner2Stop(project, 'scenario-1', { id: 'stop-2', name: 'Georgian Mall', lat: 44.39, lng: -79.68 });
    const mapRef = React.createRef<RoutePlanner2MapCanvasHandle>();

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    flushSync(() => {
      root?.render(
        <RoutePlanner2MapCanvas
          ref={mapRef}
          scenario={project.scenarios[0]!}
          selectedStopId={null}
          stopLabelDetails={[
            { stopId: 'stop-1', stopName: 'Downtown Terminal', kidsAtStop: 2, travelTimeLabel: '0 min' },
            { stopId: 'stop-2', stopName: 'Georgian Mall', kidsAtStop: 1, travelTimeLabel: '7 min' },
          ]}
          onSelectStop={() => {}}
          onAddStop={() => {}}
          onDeleteStop={() => {}}
          onMoveStop={() => {}}
          onAddLineWaypoint={() => {}}
          onInsertStopOnLine={() => {}}
          onMoveLineWaypoint={() => {}}
          onDeleteLineWaypoint={() => {}}
          onSegmentRuntimeEstimates={() => {}}
        />,
      );
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(container.querySelector('[data-testid="rp2-map-stop-label-stop-1"]')).not.toBeNull();

    html2canvasMock.mockImplementationOnce(async () => {
      expect(container?.querySelector('[data-testid="rp2-export-stop-label"]')).not.toBeNull();
      return {
        width: 1850,
        height: 1000,
        getContext: vi.fn(),
        toDataURL: vi.fn(() => 'data:image/png;base64,mock-default-capture'),
      };
    });
    await mapRef.current?.captureMapImage();

    html2canvasMock.mockImplementationOnce(async () => {
      expect(container?.querySelector('[data-testid="rp2-export-stop-label"]')).toBeNull();
      expect(container?.querySelector('[data-testid="rp2-export-stop-marker-stop-1"]')).not.toBeNull();
      return {
        width: 1850,
        height: 1000,
        getContext: vi.fn(),
        toDataURL: vi.fn(() => 'data:image/png;base64,mock-overview-capture'),
      };
    });
    const capture = await mapRef.current?.captureMapImage({ showStopLabels: false });

    expect(capture?.dataUrl).toBe('data:image/png;base64,mock-overview-capture');
  });

  it('uses map layers instead of hundreds of DOM stop markers during dense export capture', async () => {
    let project = createRoutePlanner2Project({ id: 'project-1', scenarioId: 'scenario-1', now: '2026-05-13T12:00:00.000Z' });
    for (let index = 0; index < 305; index += 1) {
      project = addRoutePlanner2Stop(project, 'scenario-1', {
        id: `stop-${index + 1}`,
        name: `Stop ${index + 1}`,
        lat: 44.38 + (index * 0.0001),
        lng: -79.69 + (index * 0.0001),
      });
    }
    const mapRef = React.createRef<RoutePlanner2MapCanvasHandle>();

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    flushSync(() => {
      root?.render(
        <RoutePlanner2MapCanvas
          ref={mapRef}
          scenario={project.scenarios[0]!}
          selectedStopId={null}
          onSelectStop={() => {}}
          onAddStop={() => {}}
          onDeleteStop={() => {}}
          onMoveStop={() => {}}
          onAddLineWaypoint={() => {}}
          onInsertStopOnLine={() => {}}
          onMoveLineWaypoint={() => {}}
          onDeleteLineWaypoint={() => {}}
          onSegmentRuntimeEstimates={() => {}}
        />,
      );
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    html2canvasMock.mockImplementationOnce(async () => {
      const markerSource = container?.querySelector('[data-testid="mock-source-route-planner-2-stop-markers"]');
      expect(markerSource?.getAttribute('data-feature-count')).toBe('305');
      expect(container?.querySelector('[data-testid^="rp2-export-stop-marker-"]')).toBeNull();
      return {
        width: 1850,
        height: 1000,
        getContext: vi.fn(),
        toDataURL: vi.fn(() => 'data:image/png;base64,mock-dense-capture'),
      };
    });

    const capture = await mapRef.current?.captureMapImage({ showStopLabels: false });

    expect(capture?.dataUrl).toBe('data:image/png;base64,mock-dense-capture');
  });

  it('limits export stop labels to the fitted detail map area', async () => {
    let project = createRoutePlanner2Project({ id: 'project-1', scenarioId: 'scenario-1', now: '2026-05-13T12:00:00.000Z' });
    for (let index = 0; index < 80; index += 1) {
      project = addRoutePlanner2Stop(project, 'scenario-1', {
        id: `stop-${index + 1}`,
        name: `Stop ${index + 1}`,
        lat: 44.38 + (index * 0.01),
        lng: -79.69 + (index * 0.01),
      });
    }
    const stopLabelDetails = project.scenarios[0]!.stops.map((stop) => ({
      stopId: stop.id,
      stopName: stop.name,
      kidsAtStop: 1,
      travelTimeLabel: `${stop.sequence} min`,
    }));
    const mapRef = React.createRef<RoutePlanner2MapCanvasHandle>();

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    flushSync(() => {
      root?.render(
        <RoutePlanner2MapCanvas
          ref={mapRef}
          scenario={project.scenarios[0]!}
          selectedStopId={null}
          stopLabelDetails={stopLabelDetails}
          onSelectStop={() => {}}
          onAddStop={() => {}}
          onDeleteStop={() => {}}
          onMoveStop={() => {}}
          onAddLineWaypoint={() => {}}
          onInsertStopOnLine={() => {}}
          onMoveLineWaypoint={() => {}}
          onDeleteLineWaypoint={() => {}}
          onSegmentRuntimeEstimates={() => {}}
        />,
      );
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    html2canvasMock.mockImplementationOnce(async () => {
      const labels = container?.querySelectorAll('[data-testid="rp2-export-stop-label"]') ?? ([] as Element[]);
      expect(labels.length).toBeGreaterThan(0);
      expect(labels.length).toBeLessThanOrEqual(4);
      expect(container?.textContent).toContain('Stop 1');
      expect(container?.textContent).not.toContain('Stop 20');
      return {
        width: 1850,
        height: 1000,
        getContext: vi.fn(),
        toDataURL: vi.fn(() => 'data:image/png;base64,mock-detail-capture'),
      };
    });

    const capture = await mapRef.current?.captureMapImage({
      showStopLabels: true,
      fitCoordinates: [
        [-79.69, 44.38],
        [-79.67, 44.4],
      ],
    });

    expect(capture?.dataUrl).toBe('data:image/png;base64,mock-detail-capture');
  });

  it('deletes a selected bus stop directly from its map marker', async () => {
    let project = createRoutePlanner2Project({ id: 'project-1', scenarioId: 'scenario-1', now: '2026-05-13T12:00:00.000Z' });
    project = addRoutePlanner2Stop(project, 'scenario-1', { id: 'stop-1', name: 'Sproule at Kraus', lat: 44.38, lng: -79.69 });
    project = addRoutePlanner2Stop(project, 'scenario-1', { id: 'stop-2', name: 'Pringle at Sproule', lat: 44.39, lng: -79.68 });
    const onDeleteStop = vi.fn();

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    flushSync(() => {
      root?.render(
        <RoutePlanner2MapCanvas
          scenario={project.scenarios[0]!}
          selectedStopId="stop-1"
          onSelectStop={() => {}}
          onAddStop={() => {}}
          onDeleteStop={onDeleteStop}
          onMoveStop={() => {}}
          onAddLineWaypoint={() => {}}
          onInsertStopOnLine={() => {}}
          onMoveLineWaypoint={() => {}}
          onDeleteLineWaypoint={() => {}}
          onSegmentRuntimeEstimates={() => {}}
        />,
      );
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    const deleteStopButton = container.querySelector('button[aria-label="Delete Sproule at Kraus"]');
    expect(deleteStopButton).not.toBeNull();
    expect(deleteStopButton?.className).toContain('opacity-100');

    flushSync(() => {
      click(deleteStopButton);
    });

    expect(onDeleteStop).toHaveBeenCalledOnce();
    expect(onDeleteStop).toHaveBeenCalledWith('stop-1');
  });

  it('adds a bus stop at a blank map click while placement mode is active', async () => {
    const project = createRoutePlanner2Project({ id: 'project-1', scenarioId: 'scenario-1', now: '2026-05-13T12:00:00.000Z' });
    const onAddStop = vi.fn();
    const onCancelStopPlacement = vi.fn();

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    flushSync(() => {
      root?.render(
        <RoutePlanner2MapCanvas
          scenario={project.scenarios[0]!}
          selectedStopId={null}
          stopPlacementMode
          onCancelStopPlacement={onCancelStopPlacement}
          onSelectStop={() => {}}
          onAddStop={onAddStop}
          onDeleteStop={() => {}}
          onMoveStop={() => {}}
          onAddLineWaypoint={() => {}}
          onInsertStopOnLine={() => {}}
          onMoveLineWaypoint={() => {}}
          onDeleteLineWaypoint={() => {}}
          onSegmentRuntimeEstimates={() => {}}
        />,
      );
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(container.querySelector('[data-testid="rp2-stop-placement-banner"]')?.textContent).toContain('Click the map or route line');
    expect(container.querySelector('[data-testid="rp2-map-canvas"]')?.className).toContain('cursor-crosshair');

    flushSync(() => {
      click(container?.querySelector('[data-testid="mock-blank-map-click"]'));
    });

    expect(onAddStop).toHaveBeenCalledWith({ lat: 44.395, lng: -79.675 });

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(onCancelStopPlacement).toHaveBeenCalledOnce();
  });

  it('inserts a placed bus stop into the clicked route segment', async () => {
    let project = createRoutePlanner2Project({ id: 'project-1', scenarioId: 'scenario-1', now: '2026-05-13T12:00:00.000Z' });
    project = addRoutePlanner2Stop(project, 'scenario-1', { id: 'stop-1', name: 'Stop 1', lat: 44.38, lng: -79.69 });
    project = addRoutePlanner2Stop(project, 'scenario-1', { id: 'stop-2', name: 'Stop 2', lat: 44.39, lng: -79.68 });
    const onAddStop = vi.fn();
    const onInsertStopOnLine = vi.fn();

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    flushSync(() => {
      root?.render(
        <RoutePlanner2MapCanvas
          scenario={project.scenarios[0]!}
          selectedStopId={null}
          stopPlacementMode
          onSelectStop={() => {}}
          onAddStop={onAddStop}
          onDeleteStop={() => {}}
          onMoveStop={() => {}}
          onAddLineWaypoint={() => {}}
          onInsertStopOnLine={onInsertStopOnLine}
          onMoveLineWaypoint={() => {}}
          onDeleteLineWaypoint={() => {}}
          onSegmentRuntimeEstimates={() => {}}
        />,
      );
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    flushSync(() => {
      click(container?.querySelector('[data-testid="mock-route-line-click"]'));
    });

    expect(onInsertStopOnLine).toHaveBeenCalledWith(expect.objectContaining({
      fromStopId: 'stop-1',
      toStopId: 'stop-2',
      coordinate: { lat: 44.385, lng: -79.685 },
    }));
    expect(onAddStop).not.toHaveBeenCalled();
  });

  it('does not add a stop from a blank map click when no popover is open', async () => {
    let project = createRoutePlanner2Project({ id: 'project-1', scenarioId: 'scenario-1', now: '2026-05-13T12:00:00.000Z' });
    project = addRoutePlanner2Stop(project, 'scenario-1', { id: 'stop-1', name: 'Downtown Terminal', lat: 44.38, lng: -79.69 });
    project = addRoutePlanner2Stop(project, 'scenario-1', { id: 'stop-2', name: 'Georgian Mall', lat: 44.39, lng: -79.68 });
    const onAddStop = vi.fn();

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    flushSync(() => {
      root?.render(
        <RoutePlanner2MapCanvas
          scenario={project.scenarios[0]!}
          selectedStopId={null}
          onSelectStop={() => {}}
          onAddStop={onAddStop}
          onDeleteStop={() => {}}
          onMoveStop={() => {}}
          onAddLineWaypoint={() => {}}
          onInsertStopOnLine={() => {}}
          onMoveLineWaypoint={() => {}}
          onDeleteLineWaypoint={() => {}}
          onSegmentRuntimeEstimates={() => {}}
        />,
      );
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    flushSync(() => {
      click(container?.querySelector('[data-testid="mock-blank-map-click"]'));
    });

    expect(onAddStop).not.toHaveBeenCalled();
  });
});
