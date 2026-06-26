import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';

import { buildFeatureFlags } from '../utils/features';
import { buildWorkspaceAccessPreview } from '../utils/workspaceAccessPreview';
import { WorkspaceAccessAppPreview } from '../components/WorkspaceAccessAppPreview';

const flags = buildFeatureFlags({ VITE_DEMO_MODE: 'false' });

describe('WorkspaceAccessAppPreview', () => {
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

    function renderPreview(accessLevel: 'transit-app-only' | 'planner' | 'external-planner' | 'parking') {
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);

        const preview = buildWorkspaceAccessPreview({
            displayName: 'Lane reviewer',
            accessLevel,
            flags,
        });

        flushSync(() => {
            root?.render(<WorkspaceAccessAppPreview title="App preview" preview={preview} />);
        });
    }

    it('shows an app-like access preview for the selected profile', () => {
        renderPreview('transit-app-only');

        expect(container?.textContent).toContain('TransitScheduler');
        expect(container?.textContent).toContain('Previewing as Lane reviewer');
        expect(container?.textContent).toContain('Access preview');
        expect(container?.textContent).toContain('Planning Data');
        expect(container?.textContent).toContain('Transit App Data');
        expect(container?.textContent).not.toContain('Scheduled TransitPlan');
    });

    it('lets an admin navigate inside the preview without leaving the wizard', () => {
        renderPreview('planner');

        const fixedRouteButton = Array.from(container?.querySelectorAll('button') ?? []).find(
            button => button.textContent?.includes('Scheduled Transit')
        );

        expect(fixedRouteButton).toBeTruthy();

        flushSync(() => {
            fixedRouteButton?.click();
        });

        expect(container?.textContent).toContain('Scheduled Transit preview');
        expect(container?.textContent).toContain('New Schedule');
        expect(container?.textContent).toContain('Master Schedules');

        const backButton = Array.from(container?.querySelectorAll('button') ?? []).find(
            button => button.textContent?.includes('Back to preview home')
        );

        expect(backButton).toBeTruthy();

        flushSync(() => {
            backButton?.click();
        });

        expect(container?.textContent).toContain('Select Workspace');
    });

    it('matches external agency planner access to Transit App Data only', () => {
        renderPreview('external-planner');

        const planningButton = Array.from(container?.querySelectorAll('button') ?? []).find(
            button => button.textContent?.includes('Planning Data')
        );
        expect(planningButton).toBeTruthy();

        flushSync(() => {
            planningButton?.click();
        });

        expect(container?.textContent).toContain('Transit App Data');
        expect(container?.textContent).not.toContain('Scheduled Transit');
        expect(container?.textContent).not.toContain('Agency OD Analysis');
    });

    it('shows Parking Lot Data inside the Parking profile preview', () => {
        renderPreview('parking');

        const parkingButton = Array.from(container?.querySelectorAll('button') ?? []).find(
            button => button.textContent?.includes('Parking')
        );
        expect(parkingButton).toBeTruthy();

        flushSync(() => {
            parkingButton?.click();
        });

        expect(container?.textContent).toContain('Parking preview');
        expect(container?.textContent).toContain('Parking Lot Data');
        expect(container?.textContent).toContain('Plate Monitor');
    });
});
