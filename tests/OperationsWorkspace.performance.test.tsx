import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';

const performanceDashboardRenderSpy = vi.fn();
const reportsWorkspaceRenderSpy = vi.fn();

vi.mock('../components/Performance/PerformanceDashboard', () => ({
  PerformanceDashboard: (props: { onClose: () => void }) => {
    performanceDashboardRenderSpy();
    return React.createElement(
      'div',
      null,
      React.createElement('div', null, 'Mock Performance Dashboard'),
      React.createElement('button', { type: 'button', onClick: props.onClose }, 'Back from Performance'),
    );
  },
}));

vi.mock('../components/workspaces/ReportsWorkspace', () => ({
  ReportsWorkspace: (props: { onClose: () => void }) => {
    reportsWorkspaceRenderSpy();
    return React.createElement(
      'div',
      null,
      React.createElement('div', null, 'Mock STREETS Reports'),
      React.createElement('button', { type: 'button', onClick: props.onClose }, 'Back from Reports'),
    );
  },
}));

import { OperationsWorkspace } from '../components/workspaces/OperationsWorkspace';

describe('OperationsWorkspace performance shell', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    performanceDashboardRenderSpy.mockClear();
    reportsWorkspaceRenderSpy.mockClear();
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

  it('shows the landing dashboard without mounting the heavy workspaces up front', () => {
    flushSync(() => {
      root.render(<OperationsWorkspace />);
    });

    expect(container.textContent).toContain('Dashboard & Reporting');
    expect(container.textContent).toContain('Operations Dashboard');
    expect(container.textContent).toContain('STREETS Reports');
    expect(performanceDashboardRenderSpy).not.toHaveBeenCalled();
    expect(reportsWorkspaceRenderSpy).not.toHaveBeenCalled();
  });
});
