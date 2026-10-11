import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const parkingDataWorkspaceRenderSpy = vi.fn();

vi.mock('../components/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { uid: 'user-1' } }),
}));

vi.mock('../components/contexts/TeamContext', () => ({
  useTeam: () => ({ team: { id: 'team-1' } }),
}));

vi.mock('../utils/lazyWithRetry', () => ({
  lazyWithRetry: (_loader: unknown, cacheKey: string) => {
    if (cacheKey === 'parking-data-workspace') {
      return () => {
        parkingDataWorkspaceRenderSpy();
        return React.createElement('div', null, 'Mock Parking Data Workspace');
      };
    }
    return () => React.createElement('div', null, 'Mock Lazy Component');
  },
}));

import { ParkingWorkspace } from '../components/workspaces/ParkingWorkspace';

describe('ParkingWorkspace lightweight shell', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    window.location.hash = 'parking';
    parkingDataWorkspaceRenderSpy.mockClear();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    flushSync(() => root.unmount());
    container.remove();
  });

  it('renders the card dashboard without mounting the heavy data workspace', () => {
    flushSync(() => root.render(<ParkingWorkspace />));

    expect(container.textContent).toContain('Parking Workspace');
    expect(container.textContent).toContain('Plate Monitor');
    expect(container.textContent).toContain('Parking Lot Data');
    expect(container.textContent).not.toContain('Parking Strategy Evidence');
    expect(parkingDataWorkspaceRenderSpy).not.toHaveBeenCalled();
  });

  it('mounts the data workspace only after a sub-workspace is selected', async () => {
    flushSync(() => root.render(<ParkingWorkspace />));
    const plateMonitorButton = Array.from(container.querySelectorAll('button')).find(
      button => button.textContent?.includes('Plate Monitor'),
    );

    await act(async () => {
      plateMonitorButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(window.location.hash).toBe('#parking/plate-monitor');
    expect(container.textContent).toContain('Mock Parking Data Workspace');
    expect(parkingDataWorkspaceRenderSpy).toHaveBeenCalledTimes(1);
  });

  it('routes strategy map links independently of text inside area query values', () => {
    window.location.hash = 'parking/strategy/map?area=plate-data&from=2025-01';
    flushSync(() => root.render(<ParkingWorkspace />));
    expect(container.textContent).toContain('Mock Lazy Component');
    expect(parkingDataWorkspaceRenderSpy).not.toHaveBeenCalled();
    expect(container.querySelector('[aria-label="Parking data source"] a[aria-current="page"]')?.textContent).toBe('LocoMobi History');
  });

  it('opens canonical history deep links without mounting HotSpot data', () => {
    window.location.hash = 'parking/lot-data/history/map?from=2025-08&area=location%3Amarina-lot';
    flushSync(() => root.render(<ParkingWorkspace />));
    expect(container.textContent).toContain('Parking Lot Data');
    expect(container.querySelector('[aria-current="page"]')?.textContent).toBe('LocoMobi History');
    expect(parkingDataWorkspaceRenderSpy).not.toHaveBeenCalled();
  });

  it('remembers history map context when switching sources and follows hash navigation', async () => {
    const historyHash = '#parking/lot-data/history/map?from=2025-08&area=location%3Amarina';
    window.location.hash = historyHash;
    await act(async () => root.render(<ParkingWorkspace />));
    const navigateHash = async (hash: string) => {
      await act(async () => {
        window.location.hash = hash;
        window.dispatchEvent(new HashChangeEvent('hashchange'));
      });
    };
    const revenueLink = container.querySelector<HTMLAnchorElement>('nav a')!;
    await navigateHash(revenueLink.hash);
    expect(container.querySelector('[aria-current="page"]')?.textContent).toBe('HotSpot & QR');
    expect(container.textContent).toContain('Mock Parking Data Workspace');
    const historyLink = container.querySelectorAll<HTMLAnchorElement>('nav a')[1];
    expect(historyLink.hash).toBe(historyHash);
    await navigateHash(historyLink.hash);
    expect(container.querySelector('[aria-current="page"]')?.textContent).toBe('LocoMobi History');
    expect(container.textContent).not.toContain('Mock Parking Data Workspace');
    await navigateHash('#parking');
    expect(container.querySelector('[aria-label="Parking data source"]')).toBeNull();
    expect(container.textContent).toContain('Plate Monitor');
  });
});
