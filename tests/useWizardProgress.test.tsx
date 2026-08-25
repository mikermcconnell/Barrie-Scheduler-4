import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { useWizardProgress } from '../hooks/useWizardProgress';

describe('useWizardProgress', () => {
    let container: HTMLDivElement | null = null;
    let root: Root | null = null;
    let hook: ReturnType<typeof useWizardProgress> | null = null;

    const renderHook = () => {
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);

        const Harness = (): React.ReactNode => {
            hook = useWizardProgress();
            return null;
        };
        flushSync(() => {
            root?.render(<Harness />);
        });
    };

    afterEach(() => {
        if (root) flushSync(() => root?.unmount());
        container?.remove();
        localStorage.clear();
        vi.restoreAllMocks();
        root = null;
        container = null;
        hook = null;
    });

    it('persists and restores five-step progress', () => {
        renderHook();
        const saved = hook?.save({
            step: 5,
            dayType: 'Sunday',
            fileNames: [],
            updatedAt: 'stale timestamp replaced during save',
        });

        expect(saved).toBe(true);
        expect(hook?.load()).toMatchObject({ step: 5, dayType: 'Sunday' });
        expect(hook?.hasProgress()).toBe(true);
    });

    it('reports local-storage write failures to the caller', () => {
        renderHook();
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
            throw new Error('quota exceeded');
        });
        vi.spyOn(console, 'error').mockImplementation(() => {});

        expect(hook?.save({
            step: 2,
            dayType: 'Weekday',
            fileNames: [],
            updatedAt: '2026-08-11T12:00:00.000Z',
        })).toBe(false);
    });

    it('ignores malformed local progress', () => {
        renderHook();
        localStorage.setItem('newScheduleWizard_progress', JSON.stringify({ step: 99 }));
        vi.spyOn(console, 'warn').mockImplementation(() => {});

        expect(hook?.load()).toBeNull();
        expect(hook?.hasProgress()).toBe(false);
    });
});
