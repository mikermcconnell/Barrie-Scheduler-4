import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildSelectedMonthParkingAnalysis,
  ParkingFilterPendingIndicator,
  SettingNumber,
} from '../components/workspaces/ParkingDataWorkspace';
import {
  DEFAULT_PARKING_SETTINGS,
  type ParkingMonthlyDataset,
  type ParkingRawRow,
} from '../utils/parking/parkingTypes';

const setInputValue = (input: HTMLInputElement, value: string) => {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
};

describe('Parking indicator threshold editing', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('keeps multi-digit edits local and commits once on blur', () => {
    const onChange = vi.fn();
    act(() => root.render(<SettingNumber label="High plate value" value={50} onChange={onChange} />));
    const input = container.querySelector<HTMLInputElement>('input')!;
    act(() => input.focus());

    act(() => setInputValue(input, '1'));
    act(() => setInputValue(input, '10'));
    act(() => setInputValue(input, '100'));
    expect(onChange).not.toHaveBeenCalled();

    act(() => input.blur());
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(100);
  });

  it('does not commit a blank or negative threshold', () => {
    const onChange = vi.fn();
    act(() => root.render(<SettingNumber label="High plate value" value={50} onChange={onChange} />));
    const input = container.querySelector<HTMLInputElement>('input')!;
    act(() => input.focus());

    act(() => setInputValue(input, ''));
    act(() => input.blur());
    expect(onChange).not.toHaveBeenCalled();
    expect(input.value).toBe('50');
    expect(input.getAttribute('aria-invalid')).toBe('true');

    act(() => input.focus());
    act(() => setInputValue(input, '-1'));
    act(() => input.blur());
    expect(onChange).not.toHaveBeenCalled();
    expect(input.value).toBe('50');
  });

  it('cancels a draft with Escape without committing it', () => {
    const onChange = vi.fn();
    act(() => root.render(<SettingNumber label="High plate value" value={50} onChange={onChange} />));
    const input = container.querySelector<HTMLInputElement>('input')!;
    act(() => input.focus());
    act(() => setInputValue(input, '100'));

    act(() => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));

    expect(onChange).not.toHaveBeenCalled();
    expect(input.value).toBe('50');
  });
});

describe('Parking revenue filter feedback', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('announces filter application only while deferred results are pending', () => {
    act(() => root.render(<ParkingFilterPendingIndicator pending />));

    const status = container.querySelector<HTMLElement>('[role="status"]');
    expect(status?.textContent).toContain('Applying filters');
    expect(status?.getAttribute('aria-live')).toBe('polite');

    act(() => root.render(<ParkingFilterPendingIndicator pending={false} />));
    expect(container.querySelector('[role="status"]')).toBeNull();
  });
});

const row: ParkingRawRow = {
  id: 'row-1',
  plate: 'ABC123',
  hasMissingPlate: false,
  startRaw: '2026-06-01 09:00',
  startDate: '2026-06-01',
  startMonth: '2026-06',
  startMinutes: 540,
  endMinutes: 600,
  weekday: 1,
  isWeekend: false,
  spotId: '7100',
  locationName: 'Waterfront Lot',
  durationMinutes: 60,
  tapType: 'Spot',
  discountCode: 'RS2026',
  codeFamilyKey: 'RS',
  department: 'Recreation Services',
  description: 'Shared parking',
  discountAmount: 60,
};

describe('selected-month indicator recalculation', () => {
  it('rebuilds flags from preview rows using the current rules instead of stale preview patterns', () => {
    const dataset: ParkingMonthlyDataset = {
      month: '2026-06',
      importedAt: '2026-07-15T00:00:00.000Z',
      importedBy: 'user-1',
      sourceFileName: 'preview.xlsx',
      rowCount: 1,
      skippedRows: 0,
      totalValue: 60,
      rows: [row],
      departmentSummaries: [],
      platePatterns: [{
        month: '2026-06', plate: 'ABC123', displayPlate: 'ABC123', department: 'Recreation Services',
        totalValue: 60, sessionCount: 1, activeDays: 1, longSessionCount: 0, topSpotId: '7100',
        topLocationName: 'Waterfront Lot', topLocationDays: 1, maxConsecutiveWeekdays: 1,
        unusualTimingCount: 0, multipleDailySessionDays: 0, flags: ['high_value'],
      }],
    };
    const currentSettings = {
      ...DEFAULT_PARKING_SETTINGS,
      flagRules: { ...DEFAULT_PARKING_SETTINGS.flagRules, plateMonthlyValueDollars: 100 },
    };

    const analysis = buildSelectedMonthParkingAnalysis(dataset, currentSettings);

    expect(dataset.platePatterns[0].flags).toContain('high_value');
    expect(analysis.platePatterns[0].flags).not.toContain('high_value');
  });
});
