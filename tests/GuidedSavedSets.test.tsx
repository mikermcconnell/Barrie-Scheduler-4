import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { GuidedSavedSets } from '../components/GuidedSchedule/persistence/GuidedSavedSets';
import type { GuidedSetSummary } from '../components/GuidedSchedule/persistence/guidedSetPersistence';

const set: GuidedSetSummary = {
    scheduleSetId: 'guided-set-1',
    routeNumber: '8A',
    dayTypes: ['Weekday', 'Saturday'],
    dateRange: { start: '2026-09-01', end: '2026-09-30' },
    step: 4,
    updatedAt: new Date('2026-10-18T14:05:00'),
    projectIds: ['guided-set-1_Weekday', 'guided-set-1_Saturday'],
};

describe('GuidedSavedSets', () => {
    let container: HTMLDivElement | null = null;
    let root: Root | null = null;

    afterEach(() => {
        if (root) flushSync(() => root?.unmount());
        container?.remove();
        root = null;
        container = null;
    });

    const renderList = (props: Partial<React.ComponentProps<typeof GuidedSavedSets>> = {}) => {
        const onOpen = vi.fn();
        const onDelete = vi.fn();
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
        flushSync(() => root?.render(
            <GuidedSavedSets sets={[set]} loading={false} openSetId={null} busySetId={null} onOpen={onOpen} onDelete={onDelete} {...props} />
        ));
        return { onOpen, onDelete };
    };

    const button = (label: RegExp | string) => Array.from(container?.querySelectorAll('button') ?? []).find(element => (
        typeof label === 'string' ? element.getAttribute('aria-label') === label : label.test(element.textContent ?? '')
    ));

    it('renders nothing when there are no saved sets', () => {
        renderList({ sets: [] });
        expect(container?.innerHTML).toBe('');
    });

    it('lists route, day types, step reached, and the data window', () => {
        renderList();
        const text = container?.textContent ?? '';
        expect(text).toContain('Saved schedule sets');
        expect(text).toContain('8A');
        expect(text).toContain('Weekday, Saturday');
        expect(text).toMatch(/Step 4 · .* · 2026-09-01 to 2026-09-30/);
    });

    it('opens and deletes a set', () => {
        const { onOpen, onDelete } = renderList();
        flushSync(() => button(/Open/)?.click());
        flushSync(() => button('Delete saved set for route 8A')?.click());
        expect(onOpen).toHaveBeenCalledWith(set);
        expect(onDelete).toHaveBeenCalledWith(set);
    });

    it('marks the open set and disables buttons while it loads', () => {
        renderList({ openSetId: 'guided-set-1', busySetId: 'guided-set-1' });
        expect(container?.textContent).toContain('open');
        expect(button(/Open/)?.disabled).toBe(true);
    });
});
