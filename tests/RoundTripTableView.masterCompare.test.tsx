import React from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';

import { RoundTripTableView } from '../components/schedule/RoundTripTableView';

const makeTrip = (
    id: string,
    direction: 'North' | 'South',
    startTime: number,
    overrides: Record<string, unknown> = {}
) => ({
    id,
    blockId: '10-1',
    direction,
    tripNumber: 1,
    rowId: startTime,
    startTime,
    endTime: startTime + 30,
    recoveryTime: 0,
    travelTime: 30,
    cycleTime: 30,
    stops: { Terminal: '6:00 AM' },
    arrivalTimes: { Terminal: '6:00 AM' },
    recoveryTimes: {},
    ...overrides,
});

describe('RoundTripTableView compare-to-master badges', () => {
    let container: HTMLDivElement | null = null;
    let root: Root | null = null;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
    });

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

    it('shows aligned, new, and removed states from the dedicated compare result', () => {
        const currentSchedules = [
            {
                routeName: '10 (North)',
                stops: ['Terminal'],
                stopIds: { Terminal: 'STOP-1' },
                trips: [
                    makeTrip('draft-a', 'North', 365),
                    makeTrip('draft-new', 'North', 430, { blockId: '10-2' }),
                ],
            },
        ] as any;

        const masterBaseline = [
            {
                routeName: '10 (North)',
                stops: ['Terminal'],
                stopIds: { Terminal: 'STOP-1' },
                trips: [
                    makeTrip('master-a', 'North', 360),
                    makeTrip('master-removed', 'North', 500, { blockId: '10-9' }),
                ],
            },
        ] as any;

        flushSync(() => {
            root?.render(
                <RoundTripTableView
                    schedules={currentSchedules}
                    masterBaseline={masterBaseline}
                    onCellEdit={() => {}}
                />
            );
        });

        const text = container?.textContent ?? '';
        expect(text).toContain('ALIGNED');
        expect(text).toContain('NEW');
        expect(text).toContain('REMOVED');
    });

    it('shows a review-needed state for ambiguous compare matches', () => {
        const currentSchedules = [
            {
                routeName: '10 (North)',
                stops: ['Terminal'],
                stopIds: { Terminal: 'STOP-1' },
                trips: [
                    makeTrip('draft-a', 'North', 365),
                ],
            },
        ] as any;

        const masterBaseline = [
            {
                routeName: '10 (North)',
                stops: ['Terminal'],
                stopIds: { Terminal: 'STOP-1' },
                trips: [
                    makeTrip('master-a', 'North', 360),
                    makeTrip('master-b', 'North', 361),
                ],
            },
        ] as any;

        flushSync(() => {
            root?.render(
                <RoundTripTableView
                    schedules={currentSchedules}
                    masterBaseline={masterBaseline}
                    onCellEdit={() => {}}
                />
            );
        });

        const text = container?.textContent ?? '';
        expect(text).toContain('REVIEW');
        expect(text).toContain('Compare review needed');
        expect(text).toContain('Jump to row');
        expect(text).not.toContain('REMOVED');

        const jumpButton = Array.from(container?.querySelectorAll('button') ?? []).find(
            button => button.textContent?.includes('Jump to row')
        );

        flushSync(() => {
            jumpButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        });

        expect(container?.textContent ?? '').toContain('Focused in table');
    });
});
