import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';

import { RoundTripTableView } from '../components/schedule/RoundTripTableView';

const time = (minutes: number): string => {
    const hour24 = Math.floor(minutes / 60);
    return `${hour24 % 12 || 12}:${String(minutes % 60).padStart(2, '0')} ${hour24 >= 12 ? 'PM' : 'AM'}`;
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

const schedules = [{
    routeName: '10 (North)',
    stops: ['Start', 'End'],
    stopIds: { Start: '1', End: '2' },
    trips: [makeTrip('a', '10-1', 360), makeTrip('b', '10-2', 390)],
}] as any;

const setInputValue = (input: HTMLInputElement, value: string) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
};

describe('RoundTripTableView target headway column', () => {
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

    it('is hidden unless target headways are passed', () => {
        flushSync(() => {
            root.render(<RoundTripTableView schedules={schedules} onCellEdit={() => {}} />);
        });
        expect(container.querySelector('input[aria-label="Target headway"]')).toBeNull();
    });

    it('shows estimates and typed values, and reports a typed change', () => {
        const onChange = vi.fn();
        flushSync(() => {
            root.render(
                <RoundTripTableView
                    schedules={schedules}
                    onCellEdit={() => {}}
                    headwayTargets={{
                        '10-2-b-s': { value: 30, typed: false, estimate: 30 },
                    }}
                    onHeadwayTargetChange={onChange}
                    headwayFlags={{ '10-1-a-s': 'Block 10-1: only 3 min recovery (minimum 5).' }}
                />
            );
        });

        const input = container.querySelector('input[aria-label="Target headway"]') as HTMLInputElement;
        expect(input).toBeTruthy();
        expect(input.value).toBe('30');
        expect(input.className).toContain('italic');

        flushSync(() => {
            input.focus();
            setInputValue(input, '45');
        });
        flushSync(() => input.blur());
        expect(onChange).toHaveBeenCalledWith('10-2-b-s', 45);

        const flagged = container.querySelector('[data-headway-flag="true"]');
        expect(flagged?.getAttribute('title')).toContain('only 3 min recovery');
    });

    it('sends null when a typed value is set back to the estimate', () => {
        const onChange = vi.fn();
        flushSync(() => {
            root.render(
                <RoundTripTableView
                    schedules={schedules}
                    onCellEdit={() => {}}
                    headwayTargets={{ '10-2-b-s': { value: 45, typed: true, estimate: 30 } }}
                    onHeadwayTargetChange={onChange}
                />
            );
        });

        const reset = container.querySelector('button[aria-label="Use estimate"]') as HTMLButtonElement;
        flushSync(() => reset.click());
        expect(onChange).toHaveBeenCalledWith('10-2-b-s', null);
    });
});
