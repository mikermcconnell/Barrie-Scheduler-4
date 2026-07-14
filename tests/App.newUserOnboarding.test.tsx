import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';

const { authState, teamState } = vi.hoisted(() => ({
  authState: {
    user: { uid: 'new-user', email: 'new@example.com', displayName: 'New User' },
    loading: false,
    signOut: vi.fn(),
    isGlobalAdmin: false,
  },
  teamState: {
    team: null as any,
    teamMember: null as any,
    teamRole: null as any,
    accessLevel: 'none' as const,
    canManageTeam: false,
    loading: false,
    refreshTeam: vi.fn(),
    hasTeam: false,
    actualTeam: null as any,
    availableTeams: [] as any[],
  },
}));

vi.mock('../components/contexts/AuthContext', () => ({
  AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useAuth: () => authState,
}));

vi.mock('../components/contexts/TeamContext', () => ({
  TeamProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useTeam: () => teamState,
}));

vi.mock('../components/contexts/ToastContext', () => ({
  ToastProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('../components/modals/AuthModal', () => ({
  AuthModal: (): null => null,
}));

vi.mock('../components/TeamManagement', () => ({
  TeamManagement: (): React.ReactElement => React.createElement('div', null, 'Mock Team Setup'),
}));

vi.mock('../components/FileManager', () => ({
  FileManager: (): null => null,
}));

vi.mock('../components/ErrorBoundary', () => ({
  ErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('../utils/lazyWithRetry', () => ({
  lazyWithRetry: (loader: () => Promise<{ default: React.ComponentType }>) => React.lazy(loader),
}));

vi.mock('../components/workspaces/OnDemandWorkspace', () => ({
  OnDemandWorkspace: (): React.ReactElement => React.createElement('div', null, 'Mock OnDemand Workspace'),
}));

vi.mock('../components/workspaces/FixedRouteWorkspace', () => ({
  FixedRouteWorkspace: (): React.ReactElement => React.createElement('div', null, 'Mock Fixed Route Workspace'),
}));

vi.mock('../components/workspaces/OperationsWorkspace', () => ({
  OperationsWorkspace: (): React.ReactElement => React.createElement('div', null, 'Mock Operations Workspace'),
}));

vi.mock('../components/Analytics/AnalyticsDashboard', () => ({
  AnalyticsDashboard: (): React.ReactElement => React.createElement('div', null, 'Mock Planning Data Workspace'),
}));

import App from '../App';

describe('new user onboarding access gate', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    window.location.hash = '';
    authState.user = { uid: 'new-user', email: 'new@example.com', displayName: 'New User' };
    authState.loading = false;
    authState.isGlobalAdmin = false;
    authState.signOut.mockReset();
    Object.assign(teamState, {
      team: null,
      teamMember: null,
      teamRole: null,
      accessLevel: 'none',
      canManageTeam: false,
      loading: false,
      hasTeam: false,
      actualTeam: null,
      availableTeams: [],
    });

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    flushSync(() => {
      root.unmount();
    });
    container.remove();
    window.location.hash = '';
  });

  it('blocks a signed-in user with no team from seeing workspace cards', () => {
    flushSync(() => {
      root.render(<App />);
    });

    expect(container.textContent).toContain('Get Started');
    expect(container.textContent).toContain('Mock Team Setup');
    expect(container.textContent).toContain('Complete team setup to continue');
    expect(container.textContent).not.toContain('Enter Workspace');
    expect(container.textContent).not.toContain('Files');
  });

  it('keeps users with no workspace access in the blocking setup flow', () => {
    Object.assign(teamState, {
      team: { id: 'team-1', name: 'New Team', inviteCode: 'ABC123' },
      teamMember: {
        id: 'new-user',
        userId: 'new-user',
        role: 'owner',
        accessLevel: 'none',
        joinedAt: new Date(),
        displayName: 'New User',
        email: 'new@example.com',
      },
      teamRole: 'owner',
      accessLevel: 'none',
      canManageTeam: true,
      hasTeam: true,
      actualTeam: { id: 'team-1', name: 'New Team', inviteCode: 'ABC123' },
      availableTeams: [{ id: 'team-1', name: 'New Team', inviteCode: 'ABC123' }],
    });

    flushSync(() => {
      root.render(<App />);
    });

    expect(container.textContent).toContain('Get Started');
    expect(container.textContent).toContain('No workspace access');
    expect(container.textContent).not.toContain('Enter Workspace');
  });

  it('keeps the header team switcher available when another membership can recover access', () => {
    const currentTeam = { id: 'team-1', name: 'No Access Team', inviteCode: 'NOACC1' };
    Object.assign(teamState, {
      team: currentTeam,
      actualTeam: currentTeam,
      teamMember: {
        id: 'new-user',
        userId: 'new-user',
        role: 'member',
        accessLevel: 'none',
        joinedAt: new Date(),
        displayName: 'New User',
        email: 'new@example.com',
      },
      teamRole: 'member',
      accessLevel: 'none',
      canManageTeam: false,
      hasTeam: true,
      availableTeams: [
        currentTeam,
        { id: 'team-2', name: 'Barrie Transit', inviteCode: 'BARRIE' },
      ],
    });

    flushSync(() => {
      root.render(<App />);
    });

    expect(container.textContent).not.toContain('Get Started');
    expect(container.textContent).toContain('Active team');
    expect(container.textContent).toContain('No workspaces are available for No Access Team');
    expect(container.textContent).toContain('switch to another team');
  });

  it('lets a global developer reach team management without joining a home team', () => {
    authState.isGlobalAdmin = true;

    flushSync(() => {
      root.render(<App />);
    });

    expect(container.textContent).not.toContain('Get Started');
    expect(container.textContent).not.toContain('Complete team setup to continue');
    expect(container.textContent).toContain('Files');
  });
});
