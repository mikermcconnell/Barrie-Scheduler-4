import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { Step3Build } from '../components/NewSchedule/steps/Step3Build';
import { getMasterSchedule } from '../utils/services/masterScheduleService';

vi.mock('../utils/services/masterScheduleService', () => ({
    getMasterSchedule: vi.fn(),
}));

describe('Step3Build', () => {
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
        vi.clearAllMocks();
    });

    it('clears stale blocks when master autofill finds no schedule', async () => {
        vi.mocked(getMasterSchedule).mockResolvedValue(null);
        const setConfig = vi.fn();

        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);

        flushSync(() => {
            root?.render(
                <Step3Build
                    dayType="Weekday"
                    bands={[]}
                    config={{
                        routeNumber: '8',
                        cycleTime: 60,
                        blocks: [{ id: '7-1', startTime: '06:00', endTime: '22:00' }],
                    }}
                    setConfig={setConfig}
                    teamId="team-1"
                    stopSuggestions={[]}
                    autofillFromMaster={true}
                    onAutofillFromMasterChange={() => {}}
                />
            );
        });

        await Promise.resolve();
        await Promise.resolve();

        expect(getMasterSchedule).toHaveBeenCalledWith('team-1', '8-Weekday');
        expect(setConfig).toHaveBeenCalledWith({
            routeNumber: '8',
            cycleTime: 60,
            blocks: [],
            bandRecoveryDefaults: undefined,
        });
    });
});
