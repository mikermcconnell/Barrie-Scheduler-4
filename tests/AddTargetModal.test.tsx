import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';
import AddTargetModal, { type AddTargetInitialData, type StopOption } from '../components/NewSchedule/connections/AddTargetModal';
import type { ConnectionTarget } from '../utils/connections/connectionTypes';
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

type AddTargetHandler = (target: Omit<ConnectionTarget, 'id' | 'createdAt' | 'updatedAt'>) => void;

const renderModal = (options: {
  dayType: DayType;
  onAdd?: ReturnType<typeof vi.fn> & AddTargetHandler;
  initialData?: AddTargetInitialData;
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
        validStopCodes={availableStops.map(stop => stop.code)}
        availableStops={availableStops}
        initialData={options.initialData}
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
    const stopSearchInput = findInputByPlaceholder(container, 'Search stop name or code');
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
    expect(findButtonByText(container, 'Advanced')).toBeDefined();
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
      button => button.textContent?.trim() === 'Add Target'
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

    const advancedButton = findButtonByText(container, 'Advanced');
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
    const stopSearchInput = findInputByPlaceholder(container, 'Search stop name or code');
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

    const submitButton = findButtonByText(container, 'Add Target');
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
    const stopSearchInput = findInputByPlaceholder(container, 'Search stop name or code');
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
      button => button.textContent?.trim() === 'Add Target'
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
});
