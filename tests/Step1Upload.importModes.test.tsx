import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';

vi.mock('../components/GTFSImport', () => ({ GTFSImport: (): null => null }));

import { Step1Upload, type ImportMode } from '../components/NewSchedule/steps/Step1Upload';

describe('Step1Upload import modes', () => {
    let container: HTMLDivElement | null = null;
    let root: Root | null = null;

    afterEach(() => {
        if (root) flushSync(() => root?.unmount());
        container?.remove();
        root = null;
        container = null;
    });

    const renderStep1 = (availableImportModes?: ImportMode[]) => {
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
        flushSync(() => root?.render(
            <Step1Upload
                files={[]}
                setFiles={() => undefined}
                dayType="Weekday"
                setDayType={() => undefined}
                importMode="performance"
                setImportMode={() => undefined}
                availableRoutes={[]}
                performanceConfig={{ routeId: '', dateRange: null }}
                availableImportModes={availableImportModes}
            />
        ));
        return container.textContent ?? '';
    };

    it('offers all three sources by default (legacy wizard behaviour)', () => {
        const text = renderStep1();
        expect(text).toContain("Let's Get Started");
        expect(text).toContain('Runtime CSV');
        expect(text).toContain('Performance Data');
        expect(text).toContain('GTFS Import');
    });

    it('hides the source selector when only STREETS data is allowed', () => {
        const text = renderStep1(['performance']);
        expect(text).not.toContain("Let's Get Started");
        expect(text).not.toContain('Runtime CSV');
        expect(text).not.toContain('GTFS Import');
    });
});
