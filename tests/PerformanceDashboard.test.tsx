import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';

const useTeamMock = vi.fn();
const useAuthMock = vi.fn();
const usePerformanceMetadataQueryMock = vi.fn();
const usePerformanceOverviewQueryMock = vi.fn();
const usePerformanceDataQueryMock = vi.fn();
const buildPerformanceMetadataHealthMock = vi.fn();
const onCloseSpy = vi.fn();

vi.mock('../components/contexts/TeamContext', () => ({
  useTeam: () => useTeamMock(),
}));

vi.mock('../components/contexts/AuthContext', () => ({
  useAuth: () => useAuthMock(),
}));

vi.mock('../hooks/usePerformanceData', () => ({
  usePerformanceMetadataQuery: (...args: unknown[]) => usePerformanceMetadataQueryMock(...args),
  usePerformanceOverviewQuery: (...args: unknown[]) => usePerformanceOverviewQueryMock(...args),
  usePerformanceDataQuery: (...args: unknown[]) => usePerformanceDataQueryMock(...args),
}));

vi.mock('../utils/performanceImportHealth', () => ({
  buildPerformanceMetadataHealth: (...args: unknown[]) => buildPerformanceMetadataHealthMock(...args),
}));

vi.mock('../utils/lazyWithRetry', () => ({
  lazyWithRetry: (_loader: unknown, cacheKey: string) => {
    if (cacheKey === 'performance-dashboard-import') {
      return (props: { onCancel: () => void; onImportComplete: () => void }) =>
        React.createElement(
          'div',
          null,
          React.createElement('div', null, 'Mock Performance Import'),
          React.createElement('button', { type: 'button', onClick: props.onCancel }, 'Cancel Import'),
          React.createElement('button', { type: 'button', onClick: props.onImportComplete }, 'Complete Import'),
        );
    }

    if (cacheKey === 'performance-dashboard-workspace') {
      return (props: { onBack: () => void; onReimport: () => void; detailsReady?: boolean }) =>
        React.createElement(
          'div',
          null,
          React.createElement('div', null, 'Mock Performance Workspace'),
          React.createElement('div', null, props.detailsReady === false ? 'Overview Only' : 'Full Details Ready'),
          React.createElement('button', { type: 'button', onClick: props.onBack }, 'Back From Workspace'),
          React.createElement('button', { type: 'button', onClick: props.onReimport }, 'Re-import From Workspace'),
        );
    }

    return () => React.createElement('div', null, 'Mock Lazy Component');
  },
}));

import { PerformanceDashboard } from '../components/Performance/PerformanceDashboard';

describe('PerformanceDashboard', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    onCloseSpy.mockClear();
    useTeamMock.mockReturnValue({ team: { id: 'team-1' }, canManageTeam: true });
    useAuthMock.mockReturnValue({ user: { uid: 'user-1' } });
    usePerformanceMetadataQueryMock.mockReturnValue({
      data: null,
      isLoading: false,
    });
    usePerformanceOverviewQueryMock.mockReturnValue({
      data: null,
      isLoading: false,
    });
    usePerformanceDataQueryMock.mockReturnValue({
      data: null,
      isLoading: false,
    });
    buildPerformanceMetadataHealthMock.mockReturnValue(null);

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    flushSync(() => {
      root.unmount();
    });
    container.remove();
  });

  it('keeps the landing card as the default entry point for existing callers', () => {
    flushSync(() => {
      root.render(<PerformanceDashboard onClose={onCloseSpy} />);
    });

    expect(container.textContent).toContain('STREETS AVL Data');
    expect(container.textContent).not.toContain('Mock Performance Workspace');
    expect(container.textContent).not.toContain('Mock Performance Import');
  });

  it('opens the workspace directly from the lightweight overview without eagerly loading full details', async () => {
    const metadata = {
      lastUpdated: '2026-03-31T12:00:00Z',
      storagePath: 'teams/team-1/performanceData/latest.json',
      overviewStoragePath: 'teams/team-1/performanceData/latest-overview.json',
    };
    usePerformanceMetadataQueryMock.mockReturnValue({
      data: metadata,
      isLoading: false,
    });
    usePerformanceOverviewQueryMock.mockReturnValue({
      data: { rows: ['overview'] },
      isLoading: false,
    });
    usePerformanceDataQueryMock.mockReturnValue({
      data: { rows: [] },
      isLoading: false,
    });
    buildPerformanceMetadataHealthMock.mockReturnValue({
      status: 'healthy',
      label: 'Healthy',
      summary: 'Ready',
    });

    flushSync(() => {
      root.render(<PerformanceDashboard onClose={onCloseSpy} autoOpen />);
    });

    await vi.waitFor(() => expect(container.textContent).toContain('Mock Performance Workspace'));

    expect(usePerformanceDataQueryMock).not.toHaveBeenCalled();
    expect(usePerformanceOverviewQueryMock).toHaveBeenCalledWith('team-1', true, metadata, 'team-1');
    expect(container.textContent).toContain('Mock Performance Workspace');
    expect(container.textContent).toContain('Full Details Ready');
    expect(container.textContent).not.toContain('STREETS AVL Data');
    expect(container.textContent).not.toContain('Mock Performance Import');
  });

  it('opens the workspace as soon as the lightweight overview is available', async () => {
    usePerformanceMetadataQueryMock.mockReturnValue({
      data: {
        importedAt: '2026-03-31T12:00:00Z',
        dateRange: { start: '2026-03-01', end: '2026-03-31' },
        dayCount: 31,
        overviewStoragePath: 'teams/team-1/performanceData/latest-overview.json',
      },
      isLoading: false,
    });
    usePerformanceOverviewQueryMock.mockReturnValue({
      data: { rows: ['overview'] },
      isLoading: false,
    });
    usePerformanceDataQueryMock.mockReturnValue({
      data: null,
      isLoading: true,
    });

    flushSync(() => {
      root.render(<PerformanceDashboard onClose={onCloseSpy} autoOpen />);
    });

    await vi.waitFor(() => expect(container.textContent).toContain('Mock Performance Workspace'));

    expect(container.textContent).toContain('Mock Performance Workspace');
    expect(container.textContent).toContain('Full Details Ready');
  });

  it('shows the loading shell while even the lightweight overview is still downloading', async () => {
    usePerformanceMetadataQueryMock.mockReturnValue({
      data: {
        importedAt: '2026-03-31T12:00:00Z',
        dateRange: { start: '2026-03-01', end: '2026-03-31' },
        dayCount: 31,
        overviewStoragePath: 'teams/team-1/performanceData/latest-overview.json',
      },
      isLoading: false,
    });
    usePerformanceOverviewQueryMock.mockReturnValue({
      data: null,
      isLoading: true,
    });
    usePerformanceDataQueryMock.mockReturnValue({
      data: null,
      isLoading: false,
    });

    flushSync(() => {
      root.render(<PerformanceDashboard onClose={onCloseSpy} autoOpen />);
    });

    await vi.waitFor(() => expect(container.textContent).toContain('Operations dashboard is opening'));

    expect(container.textContent).toContain('Operations dashboard is opening');
    expect(container.textContent).toContain('2026-03-01 → 2026-03-31');
    expect(container.textContent).not.toContain('Mock Performance Workspace');
  });

  it('goes straight to import when auto-open is enabled but no data exists', async () => {
    usePerformanceMetadataQueryMock.mockReturnValue({
      data: null,
      isLoading: false,
    });
    usePerformanceOverviewQueryMock.mockReturnValue({
      data: null,
      isLoading: false,
    });

    flushSync(() => {
      root.render(<PerformanceDashboard onClose={onCloseSpy} autoOpen />);
    });

    await vi.waitFor(() => expect(container.textContent).toContain('Mock Performance Import'));

    expect(container.textContent).toContain('Mock Performance Import');
    expect(container.textContent).not.toContain('STREETS AVL Data');
    expect(container.textContent).not.toContain('Mock Performance Workspace');
  });

  it('does not open performance import for a non-manager', async () => {
    useTeamMock.mockReturnValue({ team: { id: 'team-1' }, canManageTeam: false });

    flushSync(() => {
      root.render(<PerformanceDashboard onClose={onCloseSpy} autoOpen />);
    });

    await vi.waitFor(() => expect(container.textContent).toContain('STREETS AVL Data'));
    expect(container.textContent).not.toContain('Mock Performance Import');
  });

  it('returns to the outer workspace when backing out of an auto-opened dashboard', async () => {
    usePerformanceMetadataQueryMock.mockReturnValue({
      data: { lastUpdated: '2026-03-31T12:00:00Z' },
      isLoading: false,
    });
    usePerformanceOverviewQueryMock.mockReturnValue({
      data: { rows: ['overview'] },
      isLoading: false,
    });
    usePerformanceDataQueryMock.mockReturnValue({
      data: { rows: [] },
      isLoading: false,
    });

    flushSync(() => {
      root.render(<PerformanceDashboard onClose={onCloseSpy} autoOpen />);
    });

    await vi.waitFor(() => expect(container.textContent).toContain('Mock Performance Workspace'));

    const backButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Back From Workspace',
    );

    backButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(onCloseSpy).toHaveBeenCalledTimes(1);
  });

  it('returns to the outer workspace when cancelling an auto-opened import flow with no data', async () => {
    usePerformanceMetadataQueryMock.mockReturnValue({
      data: null,
      isLoading: false,
    });
    usePerformanceOverviewQueryMock.mockReturnValue({
      data: null,
      isLoading: false,
    });

    flushSync(() => {
      root.render(<PerformanceDashboard onClose={onCloseSpy} autoOpen />);
    });

    await vi.waitFor(() => expect(container.textContent).toContain('Mock Performance Import'));

    const cancelButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Cancel Import',
    );

    cancelButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(onCloseSpy).toHaveBeenCalledTimes(1);
  });

  it('returns from re-import to the workspace instead of closing the outer workspace', async () => {
    usePerformanceMetadataQueryMock.mockReturnValue({
      data: { lastUpdated: '2026-03-31T12:00:00Z' },
      isLoading: false,
    });
    usePerformanceOverviewQueryMock.mockReturnValue({
      data: { rows: ['overview'] },
      isLoading: false,
    });
    usePerformanceDataQueryMock.mockReturnValue({
      data: { rows: [] },
      isLoading: false,
    });

    flushSync(() => {
      root.render(<PerformanceDashboard onClose={onCloseSpy} autoOpen />);
    });

    await vi.waitFor(() => expect(container.textContent).toContain('Mock Performance Workspace'));

    const reimportButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Re-import From Workspace',
    );

    reimportButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await vi.waitFor(() => expect(container.textContent).toContain('Mock Performance Import'));

    expect(container.textContent).toContain('Mock Performance Import');

    const cancelButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Cancel Import',
    );

    cancelButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await vi.waitFor(() => expect(container.textContent).toContain('Mock Performance Workspace'));

    expect(container.textContent).toContain('Mock Performance Workspace');
    expect(onCloseSpy).not.toHaveBeenCalled();
  });
});
