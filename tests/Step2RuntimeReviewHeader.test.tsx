import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { Step2RuntimeReviewHeader } from '../components/NewSchedule/step2/Step2RuntimeReviewHeader';

describe('Step2RuntimeReviewHeader', () => {
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

    it('shows grouped-chain guidance and lets the planner switch metrics', () => {
        const onViewMetricChange = vi.fn();

        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);

        flushSync(() => {
            root?.render(
                <Step2RuntimeReviewHeader
                    hasGroupedSegmentColumns={true}
                    viewMetric="p50"
                    onViewMetricChange={onViewMetricChange}
                />
            );
        });

        expect(container.textContent).toContain('Runtime Analysis');
        expect(container.textContent).toContain('Segment columns run left to right in bus travel order.');

        const buttons = Array.from(container.querySelectorAll('button'));
        const p80Button = buttons.find(button => button.textContent?.includes('80th Percentile'));
        expect(p80Button).toBeTruthy();

        flushSync(() => {
            p80Button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        });

        expect(onViewMetricChange).toHaveBeenCalledWith('p80');
    });

    it('hides grouped-chain guidance when segment columns are not grouped', () => {
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);

        flushSync(() => {
            root?.render(
                <Step2RuntimeReviewHeader
                    hasGroupedSegmentColumns={false}
                    viewMetric="p80"
                    onViewMetricChange={() => {}}
                />
            );
        });

        expect(container.textContent).not.toContain('full out-and-back chain');
    });
});
