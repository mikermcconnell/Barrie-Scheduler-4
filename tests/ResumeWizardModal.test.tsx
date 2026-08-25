import React, { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { ResumeWizardModal } from '../components/NewSchedule/ResumeWizardModal';
import type { WizardProgress } from '../hooks/useWizardProgress';

const progress: WizardProgress = {
    step: 5,
    dayType: 'Weekday',
    fileNames: ['runtime.csv'],
    generatedSchedules: [],
    updatedAt: '2026-08-11T12:00:00.000Z',
};

describe('ResumeWizardModal', () => {
    let container: HTMLDivElement | null = null;
    let root: Root | null = null;

    afterEach(() => {
        if (root) {
            flushSync(() => root?.unmount());
        }
        container?.remove();
        container = null;
        root = null;
    });

    const renderModal = (props?: Partial<React.ComponentProps<typeof ResumeWizardModal>>) => {
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
        flushSync(() => {
            root?.render(
                <ResumeWizardModal
                    isOpen={true}
                    progress={progress}
                    onResume={() => {}}
                    onStartFresh={() => {}}
                    onClose={() => {}}
                    {...props}
                />
            );
        });
    };

    it('identifies resumable progress at the Connections step', () => {
        renderModal();

        expect(container?.textContent).toContain('Step 5: Connections');
        expect(container?.querySelector('[role="dialog"]')).toBeTruthy();
    });

    it('keeps the prompt open and explains when restoration fails', async () => {
        const onResume = vi.fn().mockResolvedValue(false);
        const onClose = vi.fn();
        renderModal({ onResume, onClose });

        const resumeButton = Array.from(container?.querySelectorAll('button') || []).find(
            button => button.textContent?.trim() === 'Resume'
        );
        await act(async () => {
            resumeButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            await Promise.resolve();
        });

        expect(onResume).toHaveBeenCalledTimes(1);
        expect(onClose).not.toHaveBeenCalled();
        expect(container?.querySelector('[role="alert"]')?.textContent).toContain('could not be restored');
        expect(container?.querySelector('[role="dialog"]')).toBeTruthy();
    });
});
