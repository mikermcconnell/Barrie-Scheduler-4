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

    it('shows retimed deltas plus small new and removed markers from the dedicated compare result', () => {
        const currentSchedules = [
            {
                routeName: '10 (North)',
                stops: ['Terminal'],
                stopIds: { Terminal: 'STOP-1' },
                trips: [
                    makeTrip('draft-a', 'North', 365, {
                        stops: { Terminal: '6:05 AM' },
                        arrivalTimes: { Terminal: '6:05 AM' },
                    }),
                    makeTrip('draft-new', 'North', 430, { blockId: '10-2' }),
                ],
            },
        ] as any;

        const masterBaseline = [
            {
                routeName: '10 (Weekday) (North) (To Downtown)',
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
        expect(text).toContain('3 changed items');
        expect(text).toContain('RETIMED');
        expect(text).toContain('NEW');
        expect(text).toContain('REMOVED');
        expect(text).toContain('+5');
        expect(text).toContain('n');
        expect(text).toContain('r');
        expect(text).toContain('removed from North');
    });

    it('shows published master deltas by default in master compare mode', () => {
        const currentSchedules = [
            {
                routeName: '10 (North)',
                stops: ['Terminal'],
                stopIds: { Terminal: 'STOP-1' },
                trips: [
                    makeTrip('draft-a', 'North', 365, {
                        stops: { Terminal: '6:05 AM' },
                        arrivalTimes: { Terminal: '6:05 AM' },
                    }),
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

        const compareSelect = container?.querySelector('select[aria-label="Compare against"]') as HTMLSelectElement | null;
        expect(compareSelect?.value).toBe('master');
        expect(compareSelect?.textContent ?? '').toContain('Published master');
        expect(container?.textContent ?? '').toContain('+5');
    });

    it('shows residual deltas after a detected baseline alignment shift', () => {
        const currentSchedules = [
            {
                routeName: '10 (North)',
                stops: ['Terminal'],
                stopIds: { Terminal: 'STOP-1' },
                trips: [
                    makeTrip('draft-a', 'North', 365, {
                        stops: { Terminal: '6:07 AM' },
                        arrivalTimes: { Terminal: '6:07 AM' },
                    }),
                    makeTrip('draft-b', 'North', 425, {
                        stops: { Terminal: '7:05 AM' },
                        arrivalTimes: { Terminal: '7:05 AM' },
                    }),
                ],
            },
        ] as any;

        const masterBaseline = [
            {
                routeName: '10 (North)',
                stops: ['Terminal'],
                stopIds: { Terminal: 'STOP-1' },
                trips: [
                    makeTrip('master-a', 'North', 360, {
                        stops: { Terminal: '6:00 AM' },
                        arrivalTimes: { Terminal: '6:00 AM' },
                    }),
                    makeTrip('master-b', 'North', 420, {
                        stops: { Terminal: '7:00 AM' },
                        arrivalTimes: { Terminal: '7:00 AM' },
                    }),
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
        expect(text).toContain('Published master auto-align N +5m');
        expect(text).toContain('+2');
        expect(container?.querySelector('[aria-label="+2 minutes after +5m master alignment (+7 raw)"]')).toBeTruthy();
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

    it('shows possible replacement hints on unmatched master rows', () => {
        const currentSchedules = [
            {
                routeName: '10 (North)',
                stops: ['Terminal'],
                stopIds: { Terminal: 'STOP-1' },
                trips: [
                    makeTrip('draft-later', 'North', 390),
                ],
            },
        ] as any;

        const masterBaseline = [
            {
                routeName: '10 (North)',
                stops: ['Terminal'],
                stopIds: { Terminal: 'STOP-1' },
                trips: [
                    makeTrip('master-original', 'North', 360),
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
        expect(text).toContain('REMOVED');
        expect(text).toContain('NEW');
        expect(text).toContain('Possible replacement');
        expect(text).toContain('+30m');
    });
});
