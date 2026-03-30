import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { Step2ApprovalFooter } from '../components/NewSchedule/step2/Step2ApprovalFooter';

describe('Step2ApprovalFooter', () => {
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

    it('shows a blocked approval state and keeps the approve action disabled', () => {
        const onApprove = vi.fn();

        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);

        flushSync(() => {
            root?.render(
                <Step2ApprovalFooter
                    approvalState="unapproved"
                    readinessStatus="blocked"
                    primaryActionVariant="approve"
                    blockedMessage="Resolve the missing direction before approving."
                    onApproveRuntimeContract={onApprove}
                />
            );
        });

        const status = container.querySelector('[data-testid="step2-approval-footer-status"]');
        expect(status?.textContent).toContain('blocked');

        const message = container.querySelector('[data-testid="step2-approval-footer-message"]');
        expect(message?.textContent).toContain('Resolve the missing direction');

        const primary = container.querySelector('[data-testid="step2-approval-footer-primary"]') as HTMLButtonElement | null;
        expect(primary).toBeTruthy();
        expect(primary?.textContent).toContain('Approve runtime model');
        expect(primary?.disabled).toBe(true);

        flushSync(() => {
            primary?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        });

        expect(onApprove).not.toHaveBeenCalled();
    });

    it('requires acknowledgement before approving a warning state', () => {
        const onApprove = vi.fn();

        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);

        flushSync(() => {
            root?.render(
                <Step2ApprovalFooter
                    approvalState="unapproved"
                    readinessStatus="warning"
                    primaryActionVariant="approve"
                    approvalRequiresAcknowledgement={true}
                    warningAcknowledged={false}
                    warningMessage="Legacy runtime logic detected."
                    onApproveRuntimeContract={onApprove}
                />
            );
        });

        const status = container.querySelector('[data-testid="step2-approval-footer-status"]');
        expect(status?.textContent).toContain('warning');

        const primary = container.querySelector('[data-testid="step2-approval-footer-primary"]') as HTMLButtonElement | null;
        expect(primary?.textContent).toContain('Acknowledge warnings and approve');
        expect(primary?.disabled).toBe(true);
    });

    it('enables continue when the runtime model is approved', () => {
        const onContinue = vi.fn();

        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);

        flushSync(() => {
            root?.render(
                <Step2ApprovalFooter
                    approvalState="approved"
                    readinessStatus="ready"
                    primaryActionVariant="continue"
                    approvedAtLabel="Mar 27, 2026"
                    approvedMessage="Approved for schedule building."
                    onContinueToStep3={onContinue}
                />
            );
        });

        const status = container.querySelector('[data-testid="step2-approval-footer-status"]');
        expect(status?.textContent).toContain('Approved');

        const message = container.querySelector('[data-testid="step2-approval-footer-message"]');
        expect(message?.textContent).toContain('Approved for schedule building');

        const primary = container.querySelector('[data-testid="step2-approval-footer-primary"]') as HTMLButtonElement | null;
        expect(primary?.textContent).toContain('Continue to Step 3');
        expect(primary?.disabled).toBe(false);

        flushSync(() => {
            primary?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        });

        expect(onContinue).toHaveBeenCalledTimes(1);
    });

    it('switches to a re-approve action when the approval is stale', () => {
        const onApprove = vi.fn();

        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);

        flushSync(() => {
            root?.render(
                <Step2ApprovalFooter
                    approvalState="stale"
                    readinessStatus="ready"
                    primaryActionVariant="approve"
                    staleMessage="The approval has expired."
                    onApproveRuntimeContract={onApprove}
                />
            );
        });

        const status = container.querySelector('[data-testid="step2-approval-footer-status"]');
        expect(status?.textContent).toContain('Stale');

        const primary = container.querySelector('[data-testid="step2-approval-footer-primary"]') as HTMLButtonElement | null;
        expect(primary?.textContent).toContain('Re-approve runtime model');
        expect(primary?.disabled).toBe(false);

        flushSync(() => {
            primary?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        });

        expect(onApprove).toHaveBeenCalledTimes(1);
    });
});

