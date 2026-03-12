import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { ShiftEditor } from '../components/ShiftEditor';
import { Zone, type Shift, type SummaryMetrics } from '../utils/demandTypes';

describe('ShiftEditor grid view', () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  afterEach(() => {
    if (root) {
      flushSync(() => {
        root?.unmount();
      });
    }
    container?.remove();
    root = null;
    container = null;
  });

  it('deletes a shift from the default grid view without opening edit', () => {
    const onDeleteShift = vi.fn();
    const onEditShift = vi.fn();

    const shifts: Shift[] = [
      {
        id: 'shift-1',
        driverName: 'North 1',
        zone: Zone.NORTH,
        startSlot: 32,
        endSlot: 64,
        breakStartSlot: 48,
        breakDurationSlots: 3,
        dayType: 'Weekday',
      },
    ];

    const metrics: SummaryMetrics = {
      totalMasterHours: 0,
      totalShiftHours: 8,
      netDiffHours: 0,
      coveragePercent: 100,
    };

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    flushSync(() => {
      root?.render(
        <ShiftEditor
          shifts={shifts}
          onUpdateShift={() => {}}
          onDeleteShift={onDeleteShift}
          onAddShift={() => {}}
          onEditShift={onEditShift}
          zoneFilter="All"
          onZoneFilterChange={() => {}}
          metrics={metrics}
        />
      );
    });

    const deleteButton = container.querySelector('button[aria-label="Delete North 1 shift"]');
    expect(deleteButton).not.toBeNull();

    deleteButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(onDeleteShift).toHaveBeenCalledWith('shift-1');
    expect(onEditShift).not.toHaveBeenCalled();
  });
});
