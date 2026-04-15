import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';
import AddTargetModal, { type AddTargetInitialData, type StopOption } from '../components/NewSchedule/connections/AddTargetModal';
import type { ConnectionTarget, ConnectionType } from '../utils/connections/connectionTypes';
import type { DayType } from '../utils/parsers/masterScheduleParser';

const setInputValue = (input: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string) => {
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
};

const click = (element: Element | null) => {
  if (!element) {
    throw new Error('Missing click target');
  }
  element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
};

const findInputByPlaceholder = (container: HTMLElement, placeholder: string) =>
  Array.from(container.querySelectorAll('input')).find(
    input => (input as HTMLInputElement).placeholder === placeholder
  ) as HTMLInputElement | undefined;

const findTextareaByPlaceholder = (container: HTMLElement, placeholder: string) =>
  Array.from(container.querySelectorAll('textarea')).find(
    textarea => (textarea as HTMLTextAreaElement).placeholder === placeholder
  ) as HTMLTextAreaElement | undefined;

const findButtonByText = (container: HTMLElement, text: string) =>
  Array.from(container.querySelectorAll('button')).find(
    button => button.textContent?.includes(text)
  ) as HTMLButtonElement | undefined;

const availableStops: StopOption[] = [
  { code: '1234', name: 'Allandale Waterfront GO Station' },
  { code: '5678', name: 'Georgian College' }
];

type AddTargetHandler = (
  target: Omit<ConnectionTarget, 'id' | 'createdAt' | 'updatedAt'>,
  routeAttachmentConfig?: {
    stopCode: string;
    stopName?: string;
    connectionType: ConnectionType;
    bufferMinutes: number;
  }
) => void;

const renderModal = (options: {
  dayType: DayType;
  onAdd?: ReturnType<typeof vi.fn> & AddTargetHandler;
  initialData?: AddTargetInitialData;
  stops?: StopOption[];
  routeAttachmentPreview?: {
    routeLabel: string;
    dayType: DayType;
  };
}) => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const onAdd = (options.onAdd ?? vi.fn()) as ReturnType<typeof vi.fn> & AddTargetHandler;

  flushSync(() => {
    root.render(
      <AddTargetModal
        isOpen
        onClose={() => {}}
        onAdd={onAdd}
        dayType={options.dayType}
        existingTargetNames={[]}
        validStopCodes={(options.stops || availableStops).map(stop => stop.code)}
        availableStops={options.stops || availableStops}
        initialData={options.initialData}
        routeAttachmentPreview={options.routeAttachmentPreview}
      />
    );
  });

  return { container, root, onAdd };
};

describe('AddTargetModal', () => {
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

  it('keeps several manual times in order and applies the selected shared day pattern', async () => {
    const rendered = renderModal({ dayType: 'Weekday' });
    container = rendered.container;
    root = rendered.root;

    await new Promise(resolve => setTimeout(resolve, 0));

    const nameInput = findInputByPlaceholder(container, 'e.g., GO Train to Toronto');
    const stopSearchInput = findInputByPlaceholder(container, 'Search by stop name or ID');
    const timesTextarea = findTextareaByPlaceholder(
      container,
      '7:15 AM, 8:45 AM or one per line'
    );
    const dayPatternSelect = container.querySelector(
      'select[title="Day pattern for new times"]'
    ) as HTMLSelectElement | null;
    const addTimeButton = container.querySelector('button[title="Add times"]');

    expect(nameInput).toBeDefined();
    expect(stopSearchInput).toBeDefined();
    expect(timesTextarea).toBeDefined();
    expect(dayPatternSelect).toBeDefined();
    expect(findButtonByText(container, 'Advanced timing')).toBeDefined();
    expect(container.querySelector('input[placeholder="8:00 AM"]')).toBeNull();
    expect(container.querySelector('select[aria-label="Default connection event"]')).toBeNull();

    flushSync(() => setInputValue(nameInput as HTMLInputElement, 'Downtown Hub Morning'));
    flushSync(() => setInputValue(stopSearchInput as HTMLInputElement, 'Allandale'));
    const stopOptionButton = Array.from(container.querySelectorAll('button')).find(
      button => button.textContent?.includes('Allandale Waterfront GO Station')
    );
    flushSync(() => click(stopOptionButton ?? null));
    flushSync(() => setInputValue(timesTextarea as HTMLTextAreaElement, '8:45 AM, 7:15 AM'));
    flushSync(() => setInputValue(dayPatternSelect as HTMLSelectElement, 'daily'));

    flushSync(() => {
      click(addTimeButton ?? null);
    });

    expect(container.textContent).toContain('7:15a');
    expect(container.textContent).toContain('8:45a');

    const submitButton = Array.from(container.querySelectorAll('button')).find(
      button => button.textContent?.trim() === 'Save custom connection'
    );

    flushSync(() => {
      click(submitButton ?? null);
    });

    expect(rendered.onAdd).toHaveBeenCalledTimes(1);
    const payload = rendered.onAdd.mock.calls[0][0];
    expect(payload.name).toBe('Downtown Hub Morning');
    expect(payload.stopCode).toBe('1234');
    expect(payload.stopName).toBe('Allandale Waterfront GO Station');
    expect(payload.times.map((time: { time: number }) => time.time)).toEqual([435, 525]);
    expect(
      payload.times.every(
        (time: { daysActive: string[] }) =>
          JSON.stringify(time.daysActive) === JSON.stringify(['Weekday', 'Saturday', 'Sunday'])
      )
    ).toBe(true);
  });

  it('reveals advanced controls when expanded and preserves the chosen default event type', async () => {
    const rendered = renderModal({ dayType: 'Weekday' });
    container = rendered.container;
    root = rendered.root;

    await new Promise(resolve => setTimeout(resolve, 0));

    const advancedButton = findButtonByText(container, 'Advanced timing');
    expect(advancedButton).toBeDefined();
    expect(advancedButton?.getAttribute('aria-expanded')).toBe('false');

    flushSync(() => {
      click(advancedButton ?? null);
    });

    expect(advancedButton?.getAttribute('aria-expanded')).toBe('true');

    const defaultEventSelect = container.querySelector(
      'select[aria-label="Default connection event"]'
    ) as HTMLSelectElement | null;
    const eventOverrideSelect = container.querySelector(
      'select[aria-label="New time event override"]'
    ) as HTMLSelectElement | null;
    const timesTextarea = findTextareaByPlaceholder(
      container,
      '7:15 AM, 8:45 AM or one per line'
    );
    const nameInput = findInputByPlaceholder(container, 'e.g., GO Train to Toronto');
    const stopSearchInput = findInputByPlaceholder(container, 'Search by stop name or ID');
    const addTimeButton = container.querySelector('button[title="Add times"]');

    expect(defaultEventSelect).toBeDefined();
    expect(eventOverrideSelect).toBeDefined();
    expect(timesTextarea).toBeDefined();
    expect(nameInput).toBeDefined();
    expect(stopSearchInput).toBeDefined();

    flushSync(() => setInputValue(defaultEventSelect as HTMLSelectElement, 'arrival'));
    flushSync(() => setInputValue(nameInput as HTMLInputElement, 'Arrival Connection'));
    flushSync(() => setInputValue(stopSearchInput as HTMLInputElement, 'Allandale'));
    const stopOptionButton = Array.from(container.querySelectorAll('button')).find(
      button => button.textContent?.includes('Allandale Waterfront GO Station')
    );
    flushSync(() => click(stopOptionButton ?? null));
    flushSync(() => setInputValue(timesTextarea as HTMLTextAreaElement, '8:15 AM'));

    flushSync(() => {
      click(addTimeButton ?? null);
    });

    const submitButton = findButtonByText(container, 'Save custom connection');
    flushSync(() => {
      click(submitButton ?? null);
    });

    expect(rendered.onAdd).toHaveBeenCalledTimes(1);
    const payload = rendered.onAdd.mock.calls[0][0];
    expect(payload.defaultEventType).toBe('arrival');
    expect(payload.times).toHaveLength(1);
    expect(payload.times[0].eventType).toBeUndefined();
  });

  it('defaults newly added times to the current day when no override is chosen', async () => {
    const rendered = renderModal({ dayType: 'Saturday' });
    container = rendered.container;
    root = rendered.root;

    await new Promise(resolve => setTimeout(resolve, 0));

    const nameInput = findInputByPlaceholder(container, 'e.g., GO Train to Toronto');
    const stopSearchInput = findInputByPlaceholder(container, 'Search by stop name or ID');
    const timesTextarea = findTextareaByPlaceholder(
      container,
      '7:15 AM, 8:45 AM or one per line'
    );
    const addTimeButton = container.querySelector('button[title="Add times"]');

    expect(nameInput).toBeDefined();
    expect(stopSearchInput).toBeDefined();
    expect(timesTextarea).toBeDefined();

    flushSync(() => setInputValue(nameInput as HTMLInputElement, 'Saturday Bell'));
    flushSync(() => setInputValue(stopSearchInput as HTMLInputElement, 'Georgian'));
    const stopOptionButton = Array.from(container.querySelectorAll('button')).find(
      button => button.textContent?.includes('Georgian College')
    );
    flushSync(() => click(stopOptionButton ?? null));
    flushSync(() => setInputValue(timesTextarea as HTMLTextAreaElement, '9:30 AM, 11:00 AM'));

    flushSync(() => {
      click(addTimeButton ?? null);
    });

    const submitButton = Array.from(container.querySelectorAll('button')).find(
      button => button.textContent?.trim() === 'Save custom connection'
    );

    flushSync(() => {
      click(submitButton ?? null);
    });

    expect(rendered.onAdd).toHaveBeenCalledTimes(1);
    const payload = rendered.onAdd.mock.calls[0][0];
    expect(payload.times).toHaveLength(2);
    expect(payload.stopCode).toBe('5678');
    expect(payload.stopName).toBe('Georgian College');
    expect(payload.times.map((time: { time: number }) => time.time)).toEqual([570, 660]);
    expect(
      payload.times.every(
        (time: { daysActive: string[] }) => JSON.stringify(time.daysActive) === JSON.stringify(['Saturday'])
      )
    ).toBe(true);
  });

  it('auto-selects the stop when only one route stop is available', async () => {
    const rendered = renderModal({
      dayType: 'Weekday',
      stops: [{ code: '9999', name: 'Downtown Terminal' }]
    });
    container = rendered.container;
    root = rendered.root;

    await new Promise(resolve => setTimeout(resolve, 0));

    const nameInput = findInputByPlaceholder(container, 'e.g., GO Train to Toronto');
    const timesTextarea = findTextareaByPlaceholder(
      container,
      '7:15 AM, 8:45 AM or one per line'
    );
    const addTimeButton = container.querySelector('button[title="Add times"]');

    expect(nameInput).toBeDefined();
    expect(timesTextarea).toBeDefined();
    expect(container.textContent).toContain('Selected place: Downtown Terminal (9999)');

    flushSync(() => setInputValue(nameInput as HTMLInputElement, 'Downtown Pulse'));
    flushSync(() => setInputValue(timesTextarea as HTMLTextAreaElement, '8:00 AM'));
    flushSync(() => {
      click(addTimeButton ?? null);
    });

    const submitButton = findButtonByText(container, 'Save custom connection');
    flushSync(() => {
      click(submitButton ?? null);
    });

    expect(rendered.onAdd).toHaveBeenCalledTimes(1);
    expect(rendered.onAdd.mock.calls[0][0]).toMatchObject({
      stopCode: '9999',
      stopName: 'Downtown Terminal'
    });
  });

  it('shows a route-first preview before save when attaching to the current route', async () => {
    const rendered = renderModal({
      dayType: 'Weekday',
      routeAttachmentPreview: {
        routeLabel: 'Route 400',
        dayType: 'Weekday'
      },
      initialData: {
        name: 'GO Departures',
        location: 'Allandale Waterfront GO Station',
        stopCode: '1234',
        icon: 'train',
        defaultEventType: 'departure',
        times: [
          { id: 't1', time: 450, daysActive: ['Weekday'], enabled: true },
          { id: 't2', time: 480, daysActive: ['Weekday'], enabled: true },
          { id: 't3', time: 510, daysActive: ['Weekday'], enabled: true },
          { id: 't4', time: 540, daysActive: ['Weekday'], enabled: true }
        ]
      }
    });
    container = rendered.container;
    root = rendered.root;

    await new Promise(resolve => setTimeout(resolve, 0));

    expect(container.textContent).toContain('Route preview for Route 400');
    expect(container.textContent).toContain('GO Departures');
    expect(container.textContent).toContain('Allandale Waterfront GO Station (1234)');
    expect(container.textContent).toContain('Bus arrives 5 min before departure');
    expect(container.textContent).toContain('4 active events on Weekday');
    expect(container.textContent).toContain('7:30a DEP');
    expect(container.textContent).toContain('+1 more');
  });

  it('uses the route-first builder flow and returns the chosen route attachment settings', async () => {
    const rendered = renderModal({
      dayType: 'Weekday',
      routeAttachmentPreview: {
        routeLabel: 'Route 400',
        dayType: 'Weekday'
      }
    });
    container = rendered.container;
    root = rendered.root;

    await new Promise(resolve => setTimeout(resolve, 0));

    expect(container.textContent).toContain('Step 1 · Route connection setup');
    expect(container.textContent).toContain('Step 2 · Connection time(s) *');
    expect(container.textContent).toContain('Step 3 · Connection name *');
    expect(findInputByPlaceholder(container, 'e.g., GO Train to Toronto')).toBeUndefined();

    const routeStopSelect = Array.from(container.querySelectorAll('select')).find(select =>
      select.textContent?.includes('Allandale Waterfront GO Station')
    ) as HTMLSelectElement | undefined;
    const timesTextarea = findTextareaByPlaceholder(
      container,
      'Enter one time or a list, e.g. 7:15 AM, 8:45 AM'
    );
    const nameInput = findInputByPlaceholder(container, 'e.g., Georgian morning arrival');
    const bufferInput = Array.from(container.querySelectorAll('input')).find(input =>
      (input as HTMLInputElement).type === 'number'
    ) as HTMLInputElement | undefined;
    const leaveAfterButton = findButtonByText(container, 'Leave after time');
    const addTimeButton = container.querySelector('button[title="Add times"]');

    expect(routeStopSelect).toBeDefined();
    expect(timesTextarea).toBeDefined();
    expect(nameInput).toBeDefined();
    expect(bufferInput).toBeDefined();

    flushSync(() => setInputValue(routeStopSelect as HTMLSelectElement, '1234'));
    flushSync(() => click(leaveAfterButton ?? null));
    flushSync(() => setInputValue(bufferInput as HTMLInputElement, '7'));
    flushSync(() => setInputValue(timesTextarea as HTMLTextAreaElement, '8:15 AM, 9:45 AM'));
    flushSync(() => click(addTimeButton));
    flushSync(() => setInputValue(nameInput as HTMLInputElement, 'Campus arrival'));

    const submitButton = findButtonByText(container, 'Save connection and add to Route 400');
    flushSync(() => {
      click(submitButton ?? null);
    });

    expect(rendered.onAdd).toHaveBeenCalledTimes(1);
    expect(rendered.onAdd.mock.calls[0][0]).toMatchObject({
      name: 'Campus arrival',
      stopCode: '1234',
      stopName: 'Allandale Waterfront GO Station',
      defaultEventType: 'arrival'
    });
    expect(rendered.onAdd.mock.calls[0][1]).toMatchObject({
      stopCode: '1234',
      stopName: 'Allandale Waterfront GO Station',
      connectionType: 'feed_arriving',
      bufferMinutes: 7
    });
  });

  it('uses a route-first review mode for template-based connections and lets the user expand details', async () => {
    const rendered = renderModal({
      dayType: 'Weekday',
      routeAttachmentPreview: {
        routeLabel: 'Route 400',
        dayType: 'Weekday'
      },
      initialData: {
        name: 'Georgian College Classes',
        location: 'Georgian College',
        stopCode: '5678',
        icon: 'clock',
        times: [
          { id: 't1', time: 540, daysActive: ['Weekday'], enabled: true }
        ]
      }
    });
    container = rendered.container;
    root = rendered.root;

    await new Promise(resolve => setTimeout(resolve, 0));

    expect(container.textContent).toContain('Review connection for Route 400');
    expect(container.textContent).toContain('Save connection and add to Route 400');
    expect(container.textContent).toContain('Connection details');
    expect(container.textContent).toContain('Edit details');
    expect(findInputByPlaceholder(container, 'e.g., GO Train to Toronto')).toBeUndefined();

    const editDetailsButton = findButtonByText(container, 'Edit details');
    flushSync(() => {
      click(editDetailsButton ?? null);
    });

    expect(findInputByPlaceholder(container, 'e.g., Georgian morning arrival')).toBeDefined();
  });
});
