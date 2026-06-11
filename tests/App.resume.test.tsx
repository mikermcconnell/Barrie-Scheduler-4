import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';

const authState = vi.hoisted(() => ({
  user: { uid: 'user-1', email: 'planner@example.com' } as { uid: string; email: string } | null,
}));

vi.mock('../components/contexts/AuthContext', () => ({
  AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useAuth: () => ({
    user: authState.user,
    loading: false,
    signOut: async (): Promise<void> => undefined,
  }),
}));

vi.mock('../components/contexts/TeamContext', () => ({
  TeamProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useTeam: () => ({
    team: { id: 'team-1', name: 'Team 1', inviteCode: 'ABC123' },
    teamMember: {
      id: 'user-1',
      userId: 'user-1',
      role: 'member',
      accessLevel: 'planner',
      joinedAt: new Date(),
      displayName: 'Planner',
      email: 'planner@example.com',
    },
    teamRole: 'member',
    accessLevel: 'planner',
    canManageTeam: false,
    loading: false,
    refreshTeam: async (): Promise<void> => undefined,
    hasTeam: true,
  }),
}));

vi.mock('../components/contexts/ToastContext', () => ({
  ToastProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('../components/modals/AuthModal', () => ({
  AuthModal: (): null => null,
}));

vi.mock('../components/FileManager', () => ({
  FileManager: (): null => null,
}));

vi.mock('../components/ErrorBoundary', () => ({
  ErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('../components/ui/Modal', () => ({
  Modal: Object.assign(
    ({ children }: { children: React.ReactNode }) => <>{children}</>,
    {
      Header: ({ children }: { children: React.ReactNode }) => <>{children}</>,
      Body: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    },
  ),
}));

vi.mock('../components/TeamManagement', () => ({
  TeamManagement: (): null => null,
}));

vi.mock('../components/layout/Header', () => ({
  Header: (): React.ReactElement => React.createElement('div', null, 'Mock Header'),
}));

vi.mock('../utils/lazyWithRetry', () => ({
  lazyWithRetry: (_loader: () => Promise<{ default: React.ComponentType }>, label: string) => {
    if (label === 'planning-data-workspace') {
      return ({ initialView }: { initialView?: string }): React.ReactElement =>
        React.createElement('div', null, `Mock Planning Data Workspace: ${initialView ?? 'none'}`);
    }
    if (label === 'fixed-workspace') {
      return (): React.ReactElement => React.createElement('div', null, 'Mock Fixed Route Workspace');
    }
    if (label === 'ondemand-workspace') {
      return (): React.ReactElement => React.createElement('div', null, 'Mock OnDemand Workspace');
    }
    if (label === 'operations-workspace') {
      return (): React.ReactElement => React.createElement('div', null, 'Mock Operations Workspace');
    }
    return (): null => null;
  },
}));

import App from '../App';

describe('App resume entry', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    authState.user = { uid: 'user-1', email: 'planner@example.com' };
    localStorage.clear();
    window.location.hash = '';
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    flushSync(() => {
      root.unmount();
    });
    container.remove();
    localStorage.clear();
    window.location.hash = '';
  });

  it('shows a resume button on the home dashboard and reopens the last fixed-route location', () => {
    localStorage.setItem('scheduler4:fixed-route-resume:user-1', JSON.stringify({
      hash: '#fixed/drafts',
      label: 'Scheduled Transit · My Drafts',
      updatedAt: '2026-04-10T12:00:00.000Z',
    }));

    flushSync(() => {
      root.render(<App />);
    });

    expect(container.textContent).toContain('Where you left off');
    expect(container.textContent).toContain('Scheduled Transit · My Drafts');

    const resumeButton = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Resume'),
    ) as HTMLButtonElement | undefined;

    flushSync(() => {
      resumeButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });

    expect(window.location.hash).toBe('#fixed/drafts');
  });

  it('reopens Route Planner directly from a planning resume hash', () => {
    localStorage.setItem('scheduler4:fixed-route-resume:user-1', JSON.stringify({
      hash: '#planning/route-planner-2',
      label: 'Planning Data · Route Planner',
      updatedAt: '2026-04-10T12:00:00.000Z',
    }));

    flushSync(() => {
      root.render(<App />);
    });

    const resumeButton = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Resume'),
    ) as HTMLButtonElement | undefined;

    flushSync(() => {
      resumeButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });

    expect(window.location.hash).toBe('#planning/route-planner-2');
    expect(container.textContent).toContain('Mock Planning Data Workspace: route-planner-2');
  });

  it('does not show another user resume card when signed out', () => {
    authState.user = null;
    localStorage.setItem('scheduler4:fixed-route-resume', JSON.stringify({
      hash: '#fixed/drafts',
      label: 'Scheduled Transit · My Drafts',
      updatedAt: '2026-04-10T12:00:00.000Z',
    }));
    localStorage.setItem('scheduler4:fixed-route-resume:user-1', JSON.stringify({
      hash: '#fixed/drafts',
      label: 'Scheduled Transit · My Drafts',
      updatedAt: '2026-04-10T12:00:00.000Z',
    }));

    flushSync(() => {
      root.render(<App />);
    });

    expect(container.textContent).not.toContain('Where you left off');
    expect(container.textContent).not.toContain('Scheduled Transit · My Drafts');
    expect(localStorage.getItem('scheduler4:fixed-route-resume')).toBeNull();
  });
});
