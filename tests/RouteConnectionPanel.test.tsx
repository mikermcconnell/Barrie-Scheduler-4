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

const setSelectValue = (select: HTMLSelectElement, value: string) => {
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
  if (setter) {
    setter.call(select, value);
  } else {
    select.value = value;
  }
  select.dispatchEvent(new Event('input', { bubbles: true }));
  select.dispatchEvent(new Event('change', { bubbles: true }));
};

const findButtonByText = (container: HTMLElement, text: string) =>
  Array.from(container.querySelectorAll('button')).find(
    button => button.textContent?.trim().includes(text)
  ) as HTMLButtonElement | undefined;

const buildLibrary = (): ConnectionLibrary => ({
  targets: [
    {
      id: 'arrival-target',
      name: 'GO Arrivals',
      type: 'manual',
      stopCode: '9003',
      defaultEventType: 'arrival',
      times: [{ id: 'arrival-time', time: 480, daysActive: ['Weekday'], enabled: true }],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    },
    {
      id: 'departure-target',
      name: 'GO Departures',
      type: 'manual',
      stopCode: '9003',
      defaultEventType: 'departure',
      times: [{ id: 'departure-time', time: 540, daysActive: ['Weekday'], enabled: true }],
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

  it('defaults an arrival target to feed-arriving when adding a route connection', async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    const onAddConnection = vi.fn();

    flushSync(() => {
      root?.render(
        <RouteConnectionPanel
          config={buildConfig()}
          library={buildLibrary()}
          availableStops={[{ code: '9003', name: 'Allandale Waterfront GO Station' }]}
          onUpdateConfig={() => {}}
          onAddConnection={onAddConnection}
        />
      );
    });

    await new Promise(resolve => setTimeout(resolve, 0));

    flushSync(() => {
      click(findButtonByText(container as HTMLDivElement, 'Add Connection') ?? null);
    });

    const selects = container.querySelectorAll('select');
    expect(selects.length).toBeGreaterThanOrEqual(2);

    flushSync(() => setSelectValue(selects[0] as HTMLSelectElement, 'arrival-target'));
    expect(container.textContent).toContain('Buffer (minutes after)');

    flushSync(() => setSelectValue(selects[1] as HTMLSelectElement, '9003'));
    const submitButtons = Array.from(container.querySelectorAll('button')).filter(
      button => button.textContent?.trim() === 'Add Connection'
    );
    const submitButton = submitButtons[submitButtons.length - 1] as HTMLButtonElement | undefined;

    flushSync(() => {
      click(submitButton ?? null);
    });

    expect(onAddConnection).toHaveBeenCalledTimes(1);
    expect(onAddConnection.mock.calls[0][0]).toMatchObject({
      targetId: 'arrival-target',
      connectionType: 'feed_arriving',
      stopCode: '9003'
    });
  });

  it('keeps a departure target on meet-departing when selected', async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    flushSync(() => {
      root?.render(
        <RouteConnectionPanel
          config={buildConfig()}
          library={buildLibrary()}
          availableStops={[{ code: '9003', name: 'Allandale Waterfront GO Station' }]}
          onUpdateConfig={() => {}}
          onAddConnection={() => {}}
        />
      );
    });

    await new Promise(resolve => setTimeout(resolve, 0));

    flushSync(() => {
      click(findButtonByText(container as HTMLDivElement, 'Add Connection') ?? null);
    });

    const selects = container.querySelectorAll('select');
    flushSync(() => setSelectValue(selects[0] as HTMLSelectElement, 'departure-target'));

    expect(container.textContent).toContain('Buffer (minutes before)');
  });
});
