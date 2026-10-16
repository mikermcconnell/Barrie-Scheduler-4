import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { GuidedApprovalBar, type GuidedApprovalBarProps } from '../components/GuidedSchedule/GuidedApprovalBar';

describe('GuidedApprovalBar', () => {
    let container: HTMLDivElement | null = null;
    let root: Root | null = null;

    afterEach(() => {
        if (root) flushSync(() => root?.unmount());
        container?.remove();
        root = null;
        container = null;
    });

    const renderBar = (overrides: Partial<GuidedApprovalBarProps> = {}) => {
        const props: GuidedApprovalBarProps = {
            readinessStatus: 'warning',
            approvalState: 'unapproved',
            warnings: ['Only 3 days of evidence at 08:00'],
            blockers: [],
            warningsAcknowledged: false,
            onWarningsAcknowledgedChange: vi.fn(),
            approvalBlocker: 'needs-acknowledgement',
            onApprove: vi.fn(),
            ...overrides,
        };
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
        flushSync(() => root?.render(<GuidedApprovalBar {...props} />));
        return props;
    };

    const approveButton = () => Array.from(container?.querySelectorAll('button') ?? [])
        .find(button => /approve runtimes/i.test(button.textContent ?? '')) as HTMLButtonElement | undefined;

    it('lists warnings and keeps Approve disabled until they are acknowledged', () => {
        const props = renderBar();
        expect(container?.textContent).toContain('Only 3 days of evidence at 08:00');
        expect(approveButton()?.disabled).toBe(true);
        const checkbox = container?.querySelector('input[type="checkbox"]') as HTMLInputElement;
        flushSync(() => checkbox.click());
        expect(props.onWarningsAcknowledgedChange).toHaveBeenCalledWith(true);
    });

    it('approves only through the explicit button', () => {
        const props = renderBar({ warningsAcknowledged: true, approvalBlocker: null });
        expect(approveButton()?.disabled).toBe(false);
        flushSync(() => approveButton()?.click());
        expect(props.onApprove).toHaveBeenCalledTimes(1);
    });

    it('shows blockers and no approve action for a blocked review', () => {
        renderBar({ readinessStatus: 'blocked', blockers: ['No approved buckets'], warnings: [], approvalBlocker: 'blocked' });
        expect(container?.textContent).toContain('No approved buckets');
        expect(approveButton()).toBeUndefined();
    });

    it('asks for re-approval when the earlier approval is stale', () => {
        renderBar({ approvalState: 'stale', warnings: [], readinessStatus: 'ready', approvalBlocker: null });
        expect(container?.textContent).toMatch(/earlier approval is out of date/i);
    });

    it('confirms an approved review', () => {
        renderBar({ approvalState: 'approved', approvalBlocker: 'already-approved' });
        expect(container?.textContent).toMatch(/runtimes approved/i);
        expect(approveButton()).toBeUndefined();
    });
});
