import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { RouteConnectionPanel } from '../components/NewSchedule/connections/RouteConnectionPanel';
import type { ConnectionLibrary, RouteConnectionConfig } from '../utils/connections/connectionTypes';

const click = (element: Element | null) => {
  if (!element) {
    throw new Error('Missing click target');
  }
  element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
};

const findButtonByText = (container: HTMLElement, text: string) =>
  Array.from(container.querySelectorAll('button')).find(
    button => button.textContent?.trim().includes(text)
  ) as HTMLButtonElement | undefined;

const buildLibrary = (): ConnectionLibrary => ({
  targets: [
    {
      id: 'departure-target',
      name: 'GO Departures',
      type: 'manual',
      stopCode: '9003',
      defaultEventType: 'departure',
      times: [{ id: 'departure-time', time: 540, daysActive: ['Weekday'], enabled: true }],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    },
    {
      id: 'downtown-target',
      name: 'Downtown Departures',
      type: 'manual',
      stopCode: '1001',
      defaultEventType: 'departure',
      times: [{ id: 'downtown-time', time: 510, daysActive: ['Weekday'], enabled: true }],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    },
    {
      id: 'arrival-target',
      name: 'GO Arrivals',
      type: 'manual',
      stopCode: '9003',
      defaultEventType: 'arrival',
      times: [{ id: 'arrival-time', time: 480, daysActive: ['Weekday'], enabled: true }],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }
  ],
  updatedAt: new Date().toISOString(),
  updatedBy: 'test-user'
});

const buildConfig = (): RouteConnectionConfig => ({
  routeIdentity: '11-Weekday',
  connections: [],
  optimizationMode: 'hybrid'
});

describe('RouteConnectionPanel', () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  afterEach(() => {
    if (root) {
      flushSync(() => {
        root?.unmount();
      });
    }

    container?.remove();
    container = null;
    root = null;
  });

  it('applies a selected existing arrival connection with route defaults', async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    const onAddConnection = vi.fn();

    flushSync(() => {
      root?.render(
        <RouteConnectionPanel
          config={buildConfig()}
          library={buildLibrary()}
          availableStops={[
            { code: '1001', name: 'Downtown Terminal' },
            { code: '9003', name: 'Allandale Waterfront GO Station' }
          ]}
          onUpdateConfig={() => {}}
          onAddConnection={onAddConnection}
        />
      );
    });

    await new Promise(resolve => setTimeout(resolve, 0));

    flushSync(() => {
      click(findButtonByText(container as HTMLDivElement, 'GO Arrivals') ?? null);
    });

    expect(container.textContent).toContain('Apply existing connection');

    flushSync(() => {
      click(findButtonByText(container as HTMLDivElement, 'Apply existing connection') ?? null);
    });

    expect(onAddConnection).toHaveBeenCalledTimes(1);
    expect(onAddConnection.mock.calls[0][0]).toMatchObject({
      targetId: 'arrival-target',
      connectionType: 'feed_arriving',
      stopCode: '9003'
    });
  });

  it('sorts existing connections by stop code and highlights arrivals and departures', async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    flushSync(() => {
      root?.render(
        <RouteConnectionPanel
          config={buildConfig()}
          library={buildLibrary()}
          availableStops={[
            { code: '1001', name: 'Downtown Terminal' },
            { code: '9003', name: 'Allandale Waterfront GO Station' }
          ]}
          onUpdateConfig={() => {}}
          onAddConnection={() => {}}
        />
      );
    });

    await new Promise(resolve => setTimeout(resolve, 0));

    const targetButtons = Array.from(container.querySelectorAll('button')).filter(button => (
      button.textContent?.includes('Departures') || button.textContent?.includes('Arrivals')
    ));

    expect(targetButtons[0]?.textContent).toContain('Downtown Departures');
    expect(container.textContent).toContain('From train');
    expect(container.textContent).toContain('To Downtown Departures');
    expect(container.textContent).toContain('Stop 1001');
    expect(container.textContent).toContain('Stop 9003');
  });

  it('offers a route-first create flow when no saved targets exist yet', async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    const onCreateTarget = vi.fn();

    flushSync(() => {
      root?.render(
        <RouteConnectionPanel
          config={buildConfig()}
          library={{ targets: [], updatedAt: new Date().toISOString(), updatedBy: 'test-user' }}
          availableStops={[{ code: '9003', name: 'Allandale Waterfront GO Station' }]}
          onUpdateConfig={() => {}}
          onAddConnection={() => {}}
          onCreateTarget={onCreateTarget}
        />
      );
    });

    await new Promise(resolve => setTimeout(resolve, 0));

    expect(container.textContent).toContain('Use existing connection');
    expect(container.textContent).toContain('Create new connection');
    expect(container.textContent).toContain('No existing connections are available yet.');

    flushSync(() => {
      click(findButtonByText(container as HTMLDivElement, 'Create new connection') ?? null);
    });

    expect(onCreateTarget).toHaveBeenCalledTimes(1);
  });

  it('builds an other-route draft from the selected stop, timing rule, and buffer', async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    const onAddOtherRouteConnection = vi.fn();

    flushSync(() => {
      root?.render(
        <RouteConnectionPanel
          config={buildConfig()}
          library={buildLibrary()}
          availableStops={[{ code: '1001', name: 'Downtown Terminal' }]}
          onUpdateConfig={() => {}}
          onAddConnection={() => {}}
          onAddOtherRouteConnection={onAddOtherRouteConnection}
          otherRouteOptions={[
            {
              key: 'route-2-north-downtown',
              routeIdentity: '2-Weekday',
              routeLabel: '2',
              direction: 'North',
              stopCode: '1001',
              stopName: 'Downtown Terminal',
            },
          ]}
        />
      );
    });

    await new Promise(resolve => setTimeout(resolve, 0));

    flushSync(() => {
      click(findButtonByText(container as HTMLDivElement, 'Open route-to-route options') ?? null);
    });

    const selects = Array.from(container.querySelectorAll('select'));
    const ruleSelect = selects.find(select =>
      Array.from(select.querySelectorAll('option')).some(option => option.textContent?.includes('From other route'))
    ) as HTMLSelectElement | undefined;

    flushSync(() => {
      ruleSelect!.value = 'feed_arriving';
      ruleSelect!.dispatchEvent(new Event('change', { bubbles: true }));
    });

    const minuteInput = Array.from(container.querySelectorAll('input')).find(input => (
      input.getAttribute('type') === 'number'
    )) as HTMLInputElement | undefined;

    flushSync(() => {
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      valueSetter?.call(minuteInput, '7');
      minuteInput!.dispatchEvent(new Event('input', { bubbles: true }));
      minuteInput!.dispatchEvent(new Event('change', { bubbles: true }));
    });

    flushSync(() => {
      click(findButtonByText(container as HTMLDivElement, 'Route 2') ?? null);
    });

    expect(onAddOtherRouteConnection).toHaveBeenCalledTimes(1);
    expect(onAddOtherRouteConnection).toHaveBeenCalledWith({
      routeIdentity: '2-Weekday',
      routeLabel: '2',
      direction: 'North',
      currentStopCode: '1001',
      currentStopName: 'Downtown Terminal',
      targetStopCode: '1001',
      targetStopName: 'Downtown Terminal',
      connectionType: 'feed_arriving',
      bufferMinutes: 7,
    });
  });
});
