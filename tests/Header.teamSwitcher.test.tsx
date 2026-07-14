import React, { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';

const { switchTeamMock, authState, teamState } = vi.hoisted(() => ({
  switchTeamMock: vi.fn(),
  authState: {
    user: {
      uid: 'user-1',
      displayName: 'Mike McConnell',
      email: 'mike.mcconnell@barrie.ca',
      photoURL: null as string | null,
    },
    signOut: vi.fn(),
    isGlobalAdmin: false,
  },
  teamState: {
    team: { id: 'barrie', name: 'Barrie Transit' },
    actualTeam: { id: 'barrie', name: 'Barrie Transit' },
    availableTeams: [
      { id: 'barrie', name: 'Barrie Transit' },
      { id: 'developer', name: 'Developer' },
    ],
    accessLevel: 'planner',
    isDeveloperPreview: false,
    developerPreview: null as any,
    stopDeveloperPreview: vi.fn(),
  },
}));

vi.mock('../components/contexts/AuthContext', () => ({
  useAuth: () => authState,
}));

vi.mock('../components/contexts/TeamContext', () => ({
  useTeam: () => ({
    ...teamState,
    switchTeam: switchTeamMock,
  }),
}));

import { Header } from '../components/layout/Header';

describe('Header team switcher', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    switchTeamMock.mockReset();
    switchTeamMock.mockResolvedValue(undefined);
    authState.isGlobalAdmin = false;
    Object.assign(teamState, {
      team: { id: 'barrie', name: 'Barrie Transit' },
      actualTeam: { id: 'barrie', name: 'Barrie Transit' },
      isDeveloperPreview: false,
      developerPreview: null,
    });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    flushSync(() => root.unmount());
    container.remove();
  });

  it('shows the active team in the header and switches from the accessible menu', async () => {
    await act(async () => {
      root.render(
        <Header
          currentView="home"
          onNavigate={vi.fn()}
          onShowFileManager={vi.fn()}
          onShowTeamManagement={vi.fn()}
          onShowAuthModal={vi.fn()}
        />,
      );
    });

    const switcher = container.querySelector<HTMLButtonElement>('[aria-label="Active team: Barrie Transit"]');
    expect(switcher).not.toBeNull();
    expect(switcher?.textContent).toContain('Barrie Transit');

    await act(async () => {
      switcher?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const teamOptions = Array.from(container.querySelectorAll<HTMLButtonElement>('[data-team-option]'));
    expect(teamOptions.map(option => option.textContent)).toEqual(
      expect.arrayContaining([expect.stringContaining('Barrie Transit'), expect.stringContaining('Developer')]),
    );

    const developerOption = teamOptions.find(option => option.textContent?.includes('Developer'));
    await act(async () => {
      developerOption?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    expect(switchTeamMock).toHaveBeenCalledWith('developer');
  });

  it('keeps switch errors visible and closes the popover with Escape', async () => {
    switchTeamMock.mockRejectedValueOnce(new Error('You are not a member of that team.'));
    await act(async () => {
      root.render(
        <Header
          currentView="home"
          onNavigate={vi.fn()}
          onShowFileManager={vi.fn()}
          onShowTeamManagement={vi.fn()}
          onShowAuthModal={vi.fn()}
        />,
      );
    });

    const switcher = container.querySelector<HTMLButtonElement>('[aria-label="Active team: Barrie Transit"]');
    await act(async () => {
      switcher?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    const developerOption = Array.from(container.querySelectorAll<HTMLButtonElement>('[data-team-option]'))
      .find(option => option.textContent?.includes('Developer'));
    await act(async () => {
      developerOption?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    expect(container.querySelector('[role="alert"]')?.textContent).toContain('not a member');
    expect(switcher?.getAttribute('aria-expanded')).toBe('true');

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(switcher?.getAttribute('aria-expanded')).toBe('false');
  });

  it('labels the global list and permits replacing a team inspection', async () => {
    authState.isGlobalAdmin = true;
    Object.assign(teamState, {
      team: { id: 'developer', name: 'Developer' },
      actualTeam: { id: 'barrie', name: 'Barrie Transit' },
      isDeveloperPreview: true,
      developerPreview: {
        mode: 'inspect',
        readOnly: true,
        sourceLabel: 'developer support inspection',
        reason: 'Selected from the active team menu',
        expiresAt: '2026-07-14T14:30:00Z',
      },
    });

    await act(async () => {
      root.render(
        <Header
          currentView="home"
          onNavigate={vi.fn()}
          onShowFileManager={vi.fn()}
          onShowTeamManagement={vi.fn()}
          onShowAuthModal={vi.fn()}
        />,
      );
    });

    const switcher = container.querySelector<HTMLButtonElement>('[aria-label="Active team: Developer"]');
    await act(async () => {
      switcher?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(container.textContent).toContain('All teams');
    expect(container.textContent).toContain('return to your actual team');
    const barrieOption = Array.from(container.querySelectorAll<HTMLButtonElement>('[data-team-option]'))
      .find(option => option.textContent?.includes('Barrie Transit'));
    expect(barrieOption?.disabled).toBe(false);

    await act(async () => {
      barrieOption?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });
    expect(switchTeamMock).toHaveBeenCalledWith('barrie');
  });
});
