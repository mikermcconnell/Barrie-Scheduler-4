import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';
import type { ConnectionTime } from '../utils/connections/connectionTypes';

const emptyTimes: ConnectionTime[] = [];

vi.mock('../utils/gtfs/goTransitService', () => ({
  QUICK_TEMPLATES: [
    {
      id: 'go-barrie-south-departures',
      name: 'Barrie South GO Departures',
      description: 'Meet trains before departure',
      icon: 'train',
      getData: () => ({
        name: 'Barrie South GO Departures',
        location: 'Barrie South GO',
        stopCode: '725',
        icon: 'train',
        defaultEventType: 'departure',
        times: emptyTimes
      })
    },
    {
      id: 'go-barrie-south-arrivals',
      name: 'Barrie South GO Arrivals',
      description: 'Connect after train arrival',
      icon: 'train',
      getData: () => ({
        name: 'Barrie South GO Arrivals',
        location: 'Barrie South GO',
        stopCode: '725',
        icon: 'train',
        defaultEventType: 'arrival',
        times: emptyTimes
      })
    },
    {
      id: 'go-allandale-waterfront-departures',
      name: 'Allandale Waterfront GO Departures',
      description: 'Meet trains before departure',
      icon: 'train',
      getData: () => ({
        name: 'Allandale Waterfront GO Departures',
        location: 'Allandale Waterfront GO',
        stopCode: '9003',
        icon: 'train',
        defaultEventType: 'departure',
        times: emptyTimes
      })
    },
    {
      id: 'go-allandale-waterfront-arrivals',
      name: 'Allandale Waterfront GO Arrivals',
      description: 'Connect after train arrival',
      icon: 'train',
      getData: () => ({
        name: 'Allandale Waterfront GO Arrivals',
        location: 'Allandale Waterfront GO',
        stopCode: '9003',
        icon: 'train',
        defaultEventType: 'arrival',
        times: emptyTimes
      })
    },
    {
      id: 'georgian',
      name: 'Georgian College Classes',
      description: 'Class start & end times',
      icon: 'clock',
      getData: () => ({
        name: 'Georgian College Classes',
        location: 'Georgian College',
        stopCode: '330',
        icon: 'clock',
        times: emptyTimes
      })
    }
  ],
  fetchGoTransitGTFS: vi.fn().mockResolvedValue(undefined),
  getBarrieGoStops: vi.fn().mockReturnValue([
    { id: 'barrie-south', name: 'Barrie South GO', stopCode: '725' },
    { id: 'allandale-waterfront', name: 'Barrie Allandale Waterfront GO', stopCode: '9003' }
  ]),
  getCachedData: vi.fn().mockReturnValue(null),
  isCacheFresh: vi.fn().mockReturnValue(false),
  getCacheAge: vi.fn().mockReturnValue(null)
}));

import ConnectionAddChooser from '../components/NewSchedule/connections/ConnectionAddChooser';

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

describe('ConnectionAddChooser', () => {
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

  it('requires selecting GO targets before bulk GTFS import', async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    flushSync(() => {
      root?.render(
        <ConnectionAddChooser
          isOpen
          onClose={() => {}}
          onSelectManual={() => {}}
          onSelectTemplate={() => {}}
          onSelectGtfsImport={() => {}}
          dayType="Weekday"
        />
      );
    });

    await new Promise(resolve => setTimeout(resolve, 0));

    const importButton = Array.from(container.querySelectorAll('button')).find(
      button => button.textContent?.includes('Import selected GO targets')
    ) as HTMLButtonElement | undefined;

    expect(importButton).toBeDefined();
    expect(importButton?.disabled).toBe(true);
    expect(container.textContent).toContain('0 selected');
  });

  it('uses one GO Train quick entry and lets the user choose station plus arrivals or departures', async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    const onSelectTemplate = vi.fn();

    flushSync(() => {
      root?.render(
        <ConnectionAddChooser
          isOpen
          onClose={() => {}}
          onSelectManual={() => {}}
          onSelectTemplate={onSelectTemplate}
          onSelectGtfsImport={() => {}}
          dayType="Weekday"
        />
      );
    });

    await new Promise(resolve => setTimeout(resolve, 0));

    expect(container.textContent).toContain('GO Train');
    expect(container.querySelector('#go-template-builder')).toBeNull();

    const goTrainButton = Array.from(container.querySelectorAll('button')).find(
      button => button.textContent?.includes('GO Train')
    ) as HTMLButtonElement | undefined;

    flushSync(() => {
      click(goTrainButton ?? null);
    });

    const selects = container.querySelectorAll('#go-template-builder select');
    expect(selects).toHaveLength(2);

    flushSync(() => setSelectValue(selects[0] as HTMLSelectElement, 'barrie-south'));
    flushSync(() => setSelectValue(selects[1] as HTMLSelectElement, 'arrivals'));

    const addButton = Array.from(container.querySelectorAll('#go-template-builder button')).find(
      button => button.textContent?.includes('Add GO template')
    ) as HTMLButtonElement | undefined;

    flushSync(() => {
      click(addButton ?? null);
    });

    await new Promise(resolve => setTimeout(resolve, 0));

    expect(onSelectTemplate).toHaveBeenCalledTimes(1);
    expect(onSelectTemplate.mock.calls[0][0]).toMatchObject({
      name: 'Barrie South GO Arrivals',
      defaultEventType: 'arrival',
      stopCode: '725'
    });
  });

  it('imports only the selected GO targets', async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    const onSelectGtfsImport = vi.fn();

    flushSync(() => {
      root?.render(
        <ConnectionAddChooser
          isOpen
          onClose={() => {}}
          onSelectManual={() => {}}
          onSelectTemplate={() => {}}
          onSelectGtfsImport={onSelectGtfsImport}
          dayType="Weekday"
        />
      );
    });

    await new Promise(resolve => setTimeout(resolve, 0));

    const labels = Array.from(container.querySelectorAll('label'));
    const arrivalsOption = labels.find(label =>
      label.textContent?.includes('Allandale Waterfront GO Arrivals')
    );
    const checkbox = arrivalsOption?.querySelector('input[type="checkbox"]') as HTMLInputElement | null;

    flushSync(() => {
      click(checkbox);
    });

    const importButton = Array.from(container.querySelectorAll('button')).find(
      button => button.textContent?.includes('Import selected GO targets')
    ) as HTMLButtonElement | undefined;

    expect(importButton?.disabled).toBe(false);

    flushSync(() => {
      click(importButton ?? null);
    });

    await new Promise(resolve => setTimeout(resolve, 0));

    expect(onSelectGtfsImport).toHaveBeenCalledTimes(1);
    expect(onSelectGtfsImport.mock.calls[0][0]).toHaveLength(1);
    expect(onSelectGtfsImport.mock.calls[0][0][0]).toMatchObject({
      name: 'Allandale Waterfront GO Arrivals',
      defaultEventType: 'arrival',
      stopCode: '9003'
    });
  });

  it('offers an all GO trains shortcut from the GO builder', async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    const onSelectGtfsImport = vi.fn();

    flushSync(() => {
      root?.render(
        <ConnectionAddChooser
          isOpen
          onClose={() => {}}
          onSelectManual={() => {}}
          onSelectTemplate={() => {}}
          onSelectGtfsImport={onSelectGtfsImport}
          dayType="Weekday"
        />
      );
    });

    await new Promise(resolve => setTimeout(resolve, 0));

    const goTrainButton = Array.from(container.querySelectorAll('button')).find(
      button => button.textContent?.includes('GO Train')
    ) as HTMLButtonElement | undefined;

    flushSync(() => {
      click(goTrainButton ?? null);
    });

    const allButton = Array.from(container.querySelectorAll('#go-template-builder button')).find(
      button => button.textContent?.includes('Add all GO trains')
    ) as HTMLButtonElement | undefined;

    flushSync(() => {
      click(allButton ?? null);
    });

    await new Promise(resolve => setTimeout(resolve, 0));

    expect(onSelectGtfsImport).toHaveBeenCalledTimes(1);
    expect(onSelectGtfsImport.mock.calls[0][0]).toHaveLength(4);
  });
});
