import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_PARKING_SETTINGS, type ParkingSettings } from '../utils/parking/parkingTypes';

const serviceMock = vi.hoisted(() => ({
  loadParkingWorkspaceData: vi.fn(),
  saveParkingSettings: vi.fn(),
}));

vi.mock('../components/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { uid: 'user-1' }, isGlobalAdmin: true }),
}));
vi.mock('../components/contexts/TeamContext', () => ({
  useTeam: () => ({ team: { id: 'team-1' }, teamMember: null as null, canManageTeam: true, developerPreview: null as null }),
}));
vi.mock('../components/contexts/ToastContext', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }),
}));
vi.mock('../components/shared', () => ({ MapBase: (): null => null }));
vi.mock('react-map-gl/mapbox', () => ({ Layer: (): null => null, Marker: (): null => null, Source: (): null => null }));
vi.mock('../utils/services/teamService', () => ({ getTeamWithMembers: vi.fn().mockResolvedValue({ members: [] }) }));
vi.mock('../utils/parking/parkingService', async importOriginal => ({
  ...(await importOriginal<typeof import('../utils/parking/parkingService')>()),
  loadParkingWorkspaceData: serviceMock.loadParkingWorkspaceData,
  saveParkingSettings: serviceMock.saveParkingSettings,
}));

import { ParkingDataWorkspace } from '../components/workspaces/ParkingDataWorkspace';

const baseSettings: ParkingSettings = {
  ...DEFAULT_PARKING_SETTINGS,
  codeFamilies: [
    { familyKey: 'RS', codes: ['RS2026'], activeYears: [2026], yearCodeFormat: 'yyyy', department: 'Recreation Services' },
    { familyKey: 'IF', codes: ['IF2026'], activeYears: [2026], yearCodeFormat: 'yyyy', department: 'Infrastructure' },
  ],
};

const setInputValue = (input: HTMLInputElement, value: string) => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
};

const findButton = (container: HTMLElement, text: string) => (
  Array.from(container.querySelectorAll('button')).find(button => button.textContent?.includes(text))
);

describe('Parking Plate Monitor review fixes', () => {
  let container: HTMLDivElement;
  let root: Root;

  const renderMonitor = async () => {
    await act(async () => root.render(<ParkingDataWorkspace />));
    await act(async () => { await Promise.resolve(); });
  };
  const openManager = async () => {
    await act(async () => { findButton(container, 'Manage departments')?.click(); });
  };

  beforeEach(() => {
    window.location.hash = 'parking/plate-monitor';
    serviceMock.loadParkingWorkspaceData.mockReset().mockResolvedValue({ settings: baseSettings, summary: null, revenueSummary: null });
    serviceMock.saveParkingSettings.mockReset().mockImplementation(async (_team: string, _user: string, next: ParkingSettings) => next);
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  it('does not start a lot-data load when leaving via Back', async () => {
    await renderMonitor();
    expect(serviceMock.loadParkingWorkspaceData).toHaveBeenCalledTimes(1);
    expect(serviceMock.loadParkingWorkspaceData).toHaveBeenCalledWith('team-1', 'plate-monitor');

    await act(async () => { findButton(container, 'Back to Parking Workspaces')?.click(); });

    expect(serviceMock.loadParkingWorkspaceData).toHaveBeenCalledTimes(1);
  });

  it('keeps the Short code input mounted and focused while typing', async () => {
    await renderMonitor();
    await openManager();
    const input = container.querySelector<HTMLInputElement>('input[placeholder="AB"]')!;
    act(() => input.focus());

    await act(async () => setInputValue(input, 'ABC'));

    const after = container.querySelector<HTMLInputElement>('input[placeholder="AB"]')!;
    expect(after).toBe(input);
    expect(after.value).toBe('ABC');
    expect(document.activeElement).toBe(after);
  });

  it('saves only the baseline plus the ignore toggle, keeping other pending edits local', async () => {
    await renderMonitor();
    await openManager();
    const nameInput = container.querySelector<HTMLInputElement>('input[placeholder="Department name"]')!;
    await act(async () => setInputValue(nameInput, 'Renamed Rec'));

    const ignoreData = Array.from(container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'))
      .find(box => box.parentElement?.textContent?.includes('Ignore data'))!;
    await act(async () => { ignoreData.click(); });

    expect(serviceMock.saveParkingSettings).toHaveBeenCalledTimes(1);
    const saved = serviceMock.saveParkingSettings.mock.calls[0][2] as ParkingSettings;
    expect(saved.codeFamilies[0].department).toBe('Recreation Services');
    expect(saved.codeFamilies[0].ignoreData).toBe(true);
    expect(container.querySelector<HTMLInputElement>('input[placeholder="Department name"]')!.value).toBe('Renamed Rec');
    expect(container.textContent).toContain('Unsaved changes');
  });

  it('blocks saving while duplicate short codes exist', async () => {
    await renderMonitor();
    await openManager();
    const codeInputs = container.querySelectorAll<HTMLInputElement>('input[placeholder="AB"]');
    await act(async () => setInputValue(codeInputs[1], 'RS'));

    const save = Array.from(container.querySelectorAll('[role="dialog"] button')).find(button => button.textContent?.includes('Save settings')) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    await act(async () => { save.click(); });
    expect(serviceMock.saveParkingSettings).not.toHaveBeenCalled();
  });
});
