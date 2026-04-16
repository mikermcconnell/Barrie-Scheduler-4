import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';

vi.mock('../components/contexts/AuthContext', () => ({
  AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useAuth: (): { user: null; loading: boolean } => ({ user: null, loading: false }),
}));

vi.mock('../components/contexts/TeamContext', () => ({
  TeamProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
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

import App from '../App';

describe('App resume entry', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
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
    localStorage.setItem('scheduler4:fixed-route-resume', JSON.stringify({
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
});
