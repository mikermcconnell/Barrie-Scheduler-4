import React from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';

import { RoundTripTableView } from '../components/schedule/RoundTripTableView';

const minutesToTime = (minutes: number): string => {
    const normalized = ((minutes % 1440) + 1440) % 1440;
    const hour24 = Math.floor(normalized / 60);
    const minute = normalized % 60;
    const period = hour24 >= 12 ? 'PM' : 'AM';
    const hour12 = hour24 % 12 || 12;
    return `${hour12}:${String(minute).padStart(2, '0')} ${period}`;
};

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

    it('does not show an alignment residual when the current cell exactly matches master', () => {
        const currentSchedules = [
            {
                routeName: '10 (North)',
                stops: ['Terminal'],
                stopIds: { Terminal: 'STOP-1' },
                trips: [
                    makeTrip('draft-a', 'North', 360, {
                        stops: { Terminal: '6:00 AM' },
                        arrivalTimes: { Terminal: '6:00 AM' },
                    }),
                    makeTrip('draft-b', 'North', 425, {
                        stops: { Terminal: '7:05 AM' },
                        arrivalTimes: { Terminal: '7:05 AM' },
                    }),
                    makeTrip('draft-c', 'North', 485, {
                        stops: { Terminal: '8:05 AM' },
                        arrivalTimes: { Terminal: '8:05 AM' },
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
                    makeTrip('master-c', 'North', 480, {
                        stops: { Terminal: '8:00 AM' },
                        arrivalTimes: { Terminal: '8:00 AM' },
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

        expect(container?.textContent ?? '').toContain('Published master auto-align N +5m');
        expect(container?.querySelector('[aria-label="-5 minutes after +5m master alignment (0 raw)"]')).toBeFalsy();
    });

    it('suppresses exact-match residual badges across north and south arrival/departure timepoints', () => {
        const northStops = ['Park Place', 'Mid North', 'Downtown Hub'];
        const southStops = ['Downtown Hub', 'Mid South', 'Park Place'];

        const makeRouteTrip = (
            id: string,
            direction: 'North' | 'South',
            startTime: number,
            offset = 0
        ) => {
            const stops = direction === 'North' ? northStops : southStops;
            const stopTimes = {
                [stops[0]]: minutesToTime(startTime + offset),
                [stops[1]]: minutesToTime(startTime + offset + 10),
                [stops[2]]: minutesToTime(startTime + offset + 30),
            };
            const departureTimes = {
                [stops[0]]: stopTimes[stops[0]],
                [stops[1]]: minutesToTime(startTime + offset + 12),
                [stops[2]]: stopTimes[stops[2]],
            };

            return makeTrip(id, direction, startTime + offset, {
                blockId: id.split('-').slice(0, 2).join('-'),
                endTime: startTime + offset + 30,
                travelTime: 30,
                stops: departureTimes,
                arrivalTimes: stopTimes,
                recoveryTimes: {
                    [stops[1]]: 2,
                    [stops[2]]: 0,
                },
            });
        };

        const currentSchedules = [
            {
                routeName: '2 (Weekday) (North)',
                stops: northStops,
                stopIds: {},
                trips: [
                    makeRouteTrip('2-1-N', 'North', 360, 0),
                    makeRouteTrip('2-2-N', 'North', 420, 5),
                    makeRouteTrip('2-3-N', 'North', 480, 5),
                ],
            },
            {
                routeName: '2 (Weekday) (South)',
                stops: southStops,
                stopIds: {},
                trips: [
                    makeRouteTrip('2-1-S', 'South', 390, 0),
                    makeRouteTrip('2-2-S', 'South', 450, 5),
                    makeRouteTrip('2-3-S', 'South', 510, 5),
                ],
            },
        ] as any;

        const masterBaseline = [
            {
                routeName: '2 (Weekday) (North)',
                stops: northStops,
                stopIds: {},
                trips: [
                    makeRouteTrip('2-N-1', 'North', 360, 0),
                    makeRouteTrip('2-N-2', 'North', 420, 0),
                    makeRouteTrip('2-N-3', 'North', 480, 0),
                ],
            },
            {
                routeName: '2 (Weekday) (South)',
                stops: southStops,
                stopIds: {},
                trips: [
                    makeRouteTrip('2-S-1', 'South', 390, 0),
                    makeRouteTrip('2-S-2', 'South', 450, 0),
                    makeRouteTrip('2-S-3', 'South', 510, 0),
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
        expect(text).toContain('Published master auto-align');
        expect(text).toContain('+5');
        expect(container?.querySelector('[aria-label="-5 minutes after +5m master alignment (0 raw)"]')).toBeFalsy();
    });

    it('does not render an exact-time trip as a removed row when later trips establish auto-align', () => {
        const currentSchedules = [
            {
                routeName: '2 (Weekday) (North)',
                stops: ['Terminal'],
                stopIds: { Terminal: 'STOP-1' },
                trips: [
                    makeTrip('draft-exact', 'North', 360, {
                        stops: { Terminal: '6:00 AM' },
                        arrivalTimes: { Terminal: '6:00 AM' },
                    }),
                    makeTrip('draft-shifted-a', 'North', 434, {
                        stops: { Terminal: '7:14 AM' },
                        arrivalTimes: { Terminal: '7:14 AM' },
                    }),
                    makeTrip('draft-shifted-b', 'North', 494, {
                        stops: { Terminal: '8:14 AM' },
                        arrivalTimes: { Terminal: '8:14 AM' },
                    }),
                ],
            },
        ] as any;

        const masterBaseline = [
            {
                routeName: '2 (Weekday) (North)',
                stops: ['Terminal'],
                stopIds: { Terminal: 'STOP-1' },
                trips: [
                    makeTrip('master-exact', 'North', 360, {
                        stops: { Terminal: '6:00 AM' },
                        arrivalTimes: { Terminal: '6:00 AM' },
                    }),
                    makeTrip('master-shifted-a', 'North', 420, {
                        stops: { Terminal: '7:00 AM' },
                        arrivalTimes: { Terminal: '7:00 AM' },
                    }),
                    makeTrip('master-shifted-b', 'North', 480, {
                        stops: { Terminal: '8:00 AM' },
                        arrivalTimes: { Terminal: '8:00 AM' },
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
        expect(text).toContain('Published master auto-align N +14m');
        expect(text).not.toContain('removed from North');
        expect(text).not.toContain('Possible replacement 6:00 AM (0m)');
        expect(container?.querySelector('[aria-label="-14 minutes after +14m master alignment (0 raw)"]')).toBeFalsy();
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
