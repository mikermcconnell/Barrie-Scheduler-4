import React, { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';

const { switchTeamMock } = vi.hoisted(() => ({
  switchTeamMock: vi.fn(),
}));

vi.mock('../components/contexts/AuthContext', () => ({
  useAuth: () => ({
    user: {
      uid: 'user-1',
      displayName: 'Mike McConnell',
      email: 'mike.mcconnell@barrie.ca',
      photoURL: null,
    },
    signOut: vi.fn(),
    isGlobalAdmin: false,
  }),
}));

vi.mock('../components/contexts/TeamContext', () => ({
  useTeam: () => ({
    team: { id: 'barrie', name: 'Barrie Transit' },
    actualTeam: { id: 'barrie', name: 'Barrie Transit' },
    availableTeams: [
      { id: 'barrie', name: 'Barrie Transit' },
      { id: 'developer', name: 'Developer' },
    ],
    switchTeam: switchTeamMock,
    accessLevel: 'planner',
    isDeveloperPreview: false,
    developerPreview: null,
    stopDeveloperPreview: vi.fn(),
  }),
}));

import { Header } from '../components/layout/Header';

describe('Header team switcher', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    switchTeamMock.mockReset();
    switchTeamMock.mockResolvedValue(undefined);
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
});
