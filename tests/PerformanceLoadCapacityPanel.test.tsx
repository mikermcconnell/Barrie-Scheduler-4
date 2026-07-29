import React from 'react';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';

const getEffectiveConfig = vi.fn();
const saveConfig = vi.fn();

vi.mock('../utils/performanceLoadConfigService', () => ({
    getEffectivePerformanceLoadCapacityConfig: (...args: unknown[]) => getEffectiveConfig(...args),
    savePerformanceLoadCapacityConfig: (...args: unknown[]) => saveConfig(...args),
    getPerformanceLoadConfigErrorMessage: () => 'Capacity settings failed.',
}));

import { PerformanceLoadCapacityPanel } from '../components/Performance/PerformanceLoadCapacityPanel';

const loadedConfig = {
    defaultCapacity: 72,
    vehicleCapacities: { '2301': 44 },
    version: 4,
    updatedAt: '2026-07-29T12:00:00.000Z',
    updatedBy: 'manager',
};

describe('PerformanceLoadCapacityPanel', () => {
    let container: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
        (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
        getEffectiveConfig.mockReset().mockResolvedValue(loadedConfig);
        saveConfig.mockReset().mockResolvedValue(5);
    });

    afterEach(() => {
        act(() => root.unmount());
        container.remove();
        delete (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
    });

    async function render(canManage: boolean) {
        await act(async () => {
            root.render(
                <PerformanceLoadCapacityPanel
                    teamId="team-1"
                    userId="user-1"
                    canManage={canManage}
                    onConfigChange={vi.fn()}
                />,
            );
            await Promise.resolve();
        });
    }

    it('shows the effective team policy read-only to members', async () => {
        await render(false);

        expect(container.textContent).toContain('72-passenger default · 1 vehicle override');
        expect(container.textContent).not.toContain('Edit capacities');
    });

    it('lets managers save version-checked settings and explains history rebuild impact', async () => {
        await render(true);
        const edit = [...container.querySelectorAll('button')].find(button => button.textContent?.includes('Edit capacities'))!;
        act(() => edit.click());

        expect(container.textContent).toContain('archived CSV history must be rebuilt');
        expect(container.textContent).toContain('workbook history must be re-uploaded');
        const defaultInput = container.querySelector<HTMLInputElement>('input[type="number"]')!;
        act(() => {
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(defaultInput, '80');
            defaultInput.dispatchEvent(new Event('input', { bubbles: true }));
        });
        const save = [...container.querySelectorAll('button')].find(button => button.textContent?.includes('Save capacities'))!;
        await act(async () => {
            save.click();
            await Promise.resolve();
        });

        expect(saveConfig).toHaveBeenCalledWith(
            'team-1',
            expect.objectContaining({ defaultCapacity: 80, vehicleCapacities: { '2301': 44 } }),
            'user-1',
            4,
        );
    });
});
