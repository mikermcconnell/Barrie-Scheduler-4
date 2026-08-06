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
});
