import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';

import { RoundTripTableView } from '../components/schedule/RoundTripTableView';

const time = (minutes: number): string => {
    const normalized = ((minutes % 1440) + 1440) % 1440;
    const hour24 = Math.floor(normalized / 60);
    const minute = normalized % 60;
    const period = hour24 >= 12 ? 'PM' : 'AM';
    return `${hour24 % 12 || 12}:${String(minute).padStart(2, '0')} ${period}`;
};

const makeTrip = (id: string, blockId: string, startTime: number) => ({
    id,
    blockId,
    direction: 'North' as const,
    tripNumber: startTime,
    rowId: startTime,
    startTime,
    endTime: startTime + 20,
    recoveryTime: 0,
    travelTime: 20,
    cycleTime: 20,
    stops: { Start: time(startTime), End: time(startTime + 20) },
    arrivalTimes: { Start: time(startTime), End: time(startTime + 20) },
    stopMinutes: { Start: startTime, End: startTime + 20 },
});

const table = (trips: ReturnType<typeof makeTrip>[]) => [{
    routeName: '10 (North)',
    stops: ['Start', 'End'],
    stopIds: { Start: '1', End: '2' },
    trips,
}] as any;

describe('RoundTripTableView displayed row order', () => {
    let container: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
    });

    afterEach(() => {
        flushSync(() => root.unmount());
        container.remove();
    });

    it('keeps the selected sort when removed master rows are merged into the table', () => {
        flushSync(() => {
            root.render(
                <RoundTripTableView
                    schedules={table([
                        makeTrip('current-2', '10-2', 360),
                        makeTrip('current-1', '10-1', 420),
                    ])}
                    masterBaseline={table([
                        makeTrip('master-2', '10-2', 360),
                        makeTrip('master-1', '10-1', 420),
                        makeTrip('master-3', '10-3', 300),
                    ])}
                    onCellEdit={() => {}}
                />
            );
        });

        const sort = container.querySelector('select[aria-label="Sort schedule rows"]') as HTMLSelectElement;
        flushSync(() => {
            sort.value = 'blockId';
            sort.dispatchEvent(new Event('change', { bubbles: true }));
        });

        const blockOrder = Array.from(container.querySelectorAll('tbody tr'))
            .map(row => row.querySelector('td.sticky span')?.textContent?.trim())
            .filter(Boolean);
        expect(blockOrder).toEqual(['10-1', '10-2', '10-3']);

        const currentRows = Array.from(container.querySelectorAll('tr[data-row-trip-ids]'));
        expect(currentRows[0].querySelector('[data-grid-row="0"]')).toBeTruthy();
        expect(currentRows[1].querySelector('[data-grid-row="1"]')).toBeTruthy();
    });

    it('uses operational order within a block when Block # sort crosses midnight', () => {
        flushSync(() => {
            root.render(
                <RoundTripTableView
                    schedules={table([
                        makeTrip('after-midnight', '10-1', 10),
                        makeTrip('before-midnight', '10-1', 1410),
                    ])}
                    onCellEdit={() => {}}
                />
            );
        });

        const sort = container.querySelector('select[aria-label="Sort schedule rows"]') as HTMLSelectElement;
        flushSync(() => {
            sort.value = 'blockId';
            sort.dispatchEvent(new Event('change', { bubbles: true }));
        });

        const tripOrder = Array.from(container.querySelectorAll('tr[data-row-trip-ids]'))
            .map(row => row.getAttribute('data-row-trip-ids'));
        expect(tripOrder).toEqual([
            '|before-midnight|',
            '|after-midnight|',
        ]);
    });

    it('clears stale keyboard selection when changed-only filtering replaces the rows', () => {
        const schedules = table([
            makeTrip('trip-1', '10-1', 360),
            makeTrip('trip-2', '10-2', 420),
        ]);
        const renderWithFilter = (visibleTripIds: string[] | null) => {
            flushSync(() => {
                root.render(
                    <RoundTripTableView
                        schedules={schedules}
                        visibleTripIds={visibleTripIds}
                        onCellEdit={() => {}}
                    />
                );
            });
        };

        renderWithFilter(null);
        let region = container.querySelector('[aria-label="Round-trip schedule editor grid"]') as HTMLDivElement;
        flushSync(() => region.focus());
        expect(region.getAttribute('aria-activedescendant')).toBeTruthy();

        renderWithFilter(['trip-2']);
        region = container.querySelector('[aria-label="Round-trip schedule editor grid"]') as HTMLDivElement;
        expect(region.getAttribute('aria-activedescendant')).toBeNull();

        flushSync(() => {
            region.blur();
            region.focus();
        });
        const selectedCell = container.querySelector('[aria-selected="true"]');
        expect(selectedCell?.closest('tr')?.getAttribute('data-row-trip-ids')).toContain('|trip-2|');
    });

    it('uses the post-midnight south trip for actions on an overnight pair', () => {
        const onMenuOpen = vi.fn();
        const northTrip = makeTrip('north-before-midnight', '10-1', 1410);
        const southTrip = {
            ...makeTrip('south-after-midnight', '10-1', 10),
            direction: 'South' as const,
        };

        flushSync(() => {
            root.render(
                <RoundTripTableView
                    schedules={[
                        ...table([northTrip]),
                        {
                            routeName: '10 (South)',
                            stops: ['Start', 'End'],
                            stopIds: { Start: '1', End: '2' },
                            trips: [southTrip],
                        },
                    ] as any}
                    onCellEdit={() => {}}
                    onMenuOpen={onMenuOpen}
                />
            );
        });

        const actionsButton = container.querySelector('button[aria-label*="Actions for block"]');
        flushSync(() => {
            actionsButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        });

        expect(onMenuOpen).toHaveBeenCalledWith(expect.objectContaining({
            tripId: 'south-after-midnight',
        }));
    });
});
