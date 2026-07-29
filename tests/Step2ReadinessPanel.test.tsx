import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { Step2ReadinessPanel } from '../components/NewSchedule/step2/Step2ReadinessPanel';
import type { Step2DataHealthReport } from '../components/NewSchedule/utils/wizardState';

describe('Step2ReadinessPanel', () => {
    let container: HTMLDivElement | null = null;
    let root: Root | null = null;

    const renderPanel = (healthReport: Step2DataHealthReport, showDataHealth: boolean = true) => {
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);

        flushSync(() => {
            root?.render(
                <Step2ReadinessPanel
                    healthReport={healthReport}
                    showDataHealth={showDataHealth}
                    onToggleShowDataHealth={() => {}}
                />
            );
        });

        return container;
    };

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

    it('shows the warning-state readiness details, including source metadata, stop-order summary, blockers, warnings, and incomplete-bucket diagnosis', () => {
        renderPanel({
            status: 'warning',
            blockers: ['No complete cycle buckets are currently available for scheduling.'],
            warnings: ['Legacy runtime logic detected.'],
            stopOrder: {
                decision: 'review',
                confidence: 'low',
                sourceUsed: 'master-fallback',
                usedForPlanning: false,
                summary: 'Dynamic stop order returned review, so Step 2 kept the master stop chain for planning.',
                warnings: ['Dynamic stop order is review (low confidence).'],
                directionStats: {
                    North: { tripCountUsed: 4, dayCountUsed: 1, middayTripCount: 2 },
                    South: { tripCountUsed: 4, dayCountUsed: 1, middayTripCount: 2 },
                },
            },
            expectedDirections: 2,
            matchedDirections: ['North', 'South'],
            expectedSegmentCount: 4,
            matchedSegmentCount: 3,
            missingSegments: ['Downtown to Park Place'],
            availableBucketCount: 6,
            completeBucketCount: 3,
            incompleteBucketCount: 3,
            lowConfidenceBucketCount: 2,
            repairedBucketCount: 1,
            boundaryBucketCount: 1,
            singleGapBucketCount: 1,
            internalGapBucketCount: 1,
            fragmentedGapBucketCount: 1,
            runtimeSourceSummary: 'stop-level + trip-leg',
            sampleCountMode: 'days',
            confidenceThreshold: 5,
            importedAt: '2026-03-27T12:00:00.000Z',
            runtimeLogicVersion: 7,
            usesLegacyRuntimeLogic: true,
            cleanHistoryStartDate: '2026-03-01',
            excludedLegacyDayCount: 2,
            usesCleanHistoryCutoff: true,
        });

        expect(container?.textContent).toContain('Data Health');
        expect(container?.textContent).toContain('warning');
        expect(container?.textContent).toContain('Runtime source');
        expect(container?.textContent).toContain('stop-level + trip-leg');
        expect(container?.textContent).toContain('Imported');
        expect(container?.textContent).toContain('Logic v7');
        expect(container?.textContent).toContain('Clean history');
        expect(container?.textContent).toContain('Stop order');
        expect(container?.textContent).toContain('Fallback in use');
        expect(container?.textContent).toContain('Stop-order decision');
        expect(container?.textContent).toContain('Dynamic stop order returned review, so Step 2 kept the master stop chain for planning.');
        expect(container?.textContent).toContain('North: 4 trips, 1 day');
        expect(container?.textContent).toContain('South: 4 trips, 1 day');
        expect(container?.textContent).toContain('Blocking issues');
        expect(container?.textContent).toContain('No complete cycle buckets are currently available for scheduling.');
        expect(container?.textContent).toContain('Warnings');
        expect(container?.textContent).toContain('Legacy runtime logic detected.');
        expect(container?.textContent).toContain('Unmatched segments');
        expect(container?.textContent).toContain('Downtown to Park Place');
        expect(container?.textContent).toContain('Incomplete bucket diagnosis');
        expect(container?.textContent).toContain('1 repaired from adjacent buckets');
        expect(container?.textContent).toContain('1 boundary / short-turn buckets');
        expect(container?.textContent).toContain('1 single-gap buckets still missing one segment');
        expect(container?.textContent).toContain('1 internal-gap buckets');
        expect(container?.textContent).toContain('1 fragmented buckets');
    });

    it('shows a blocked readiness state with the blocked summary collapsed', () => {
        renderPanel({
            status: 'blocked',
            blockers: ['Missing one direction for bidirectional planning.'],
            warnings: [],
            expectedDirections: 2,
            matchedDirections: ['North'],
            expectedSegmentCount: 4,
            matchedSegmentCount: 2,
            missingSegments: ['Downtown to Park Place', 'Park Place to Downtown'],
            availableBucketCount: 1,
            completeBucketCount: 0,
            incompleteBucketCount: 1,
            lowConfidenceBucketCount: 1,
            runtimeSourceSummary: 'No matched runtime source',
            sampleCountMode: 'days',
            confidenceThreshold: 5,
            usesLegacyRuntimeLogic: false,
        }, false);

        expect(container?.textContent).toContain('blocked');
        expect(container?.textContent).toContain('Show route readiness details');
        expect(container?.textContent).toContain('Missing one direction for bidirectional planning.');
    });

    it('shows a ready readiness state with the expected matching summary', () => {
        renderPanel({
            status: 'ready',
            blockers: [],
            warnings: [],
            expectedDirections: 2,
            matchedDirections: ['North', 'South'],
            expectedSegmentCount: 4,
            matchedSegmentCount: 4,
            missingSegments: [],
            availableBucketCount: 4,
            completeBucketCount: 4,
            coverageCompleteBucketCount: 4,
            trustedReadyBucketCount: 4,
            incompleteBucketCount: 0,
            lowConfidenceBucketCount: 0,
            runtimeSourceSummary: 'stop-level',
            sampleCountMode: 'days',
            confidenceThreshold: 5,
            usesLegacyRuntimeLogic: false,
        });

        expect(container?.textContent).toContain('ready');
        expect(container?.textContent).toContain('4/4 route-chain segments matched. 4/4 buckets have full coverage; 4 are trusted and ready for scheduling.');
        expect(container?.textContent).toContain('Hide route readiness details');
        expect(container?.textContent).toContain('4/4');
    });
});
