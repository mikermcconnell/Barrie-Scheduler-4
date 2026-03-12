import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { NewScheduleHeader } from '../components/NewSchedule/NewScheduleHeader';

describe('NewScheduleHeader', () => {
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

    it('waits for save completion before closing from the exit modal', async () => {
        const onClose = vi.fn();
        let resolveSave: (() => void) | null = null;
        const onSaveVersion = vi.fn(
            () =>
                new Promise<void>((resolve) => {
                    resolveSave = resolve;
                })
        );

        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);

        flushSync(() => {
            root?.render(
                <NewScheduleHeader
                    currentStep={2}
                    stepLabel="Analysis"
                    projectName="Project 1"
                    onClose={onClose}
                    onSaveVersion={onSaveVersion}
                    isDirty={true}
                />
            );
        });

        const exitButton = Array.from(container.querySelectorAll('button')).find(
            (button) => button.textContent?.includes('Exit')
        );
        expect(exitButton).toBeTruthy();

        flushSync(() => {
            exitButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        });

        const saveAndExitButton = Array.from(container.querySelectorAll('button')).find(
            (button) => button.textContent?.includes('Save & Exit')
        );
        expect(saveAndExitButton).toBeTruthy();

        flushSync(() => {
            saveAndExitButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        });

        expect(onSaveVersion).toHaveBeenCalledWith('Save before exit');
        expect(onClose).not.toHaveBeenCalled();

        resolveSave?.();
        await Promise.resolve();
        await Promise.resolve();

        expect(onClose).toHaveBeenCalledTimes(1);
    });
});
