import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';

const performanceDashboardRenderSpy = vi.fn();
const performanceDashboardPropsSpy = vi.fn();
const reportsWorkspaceRenderSpy = vi.fn();

vi.mock('../utils/lazyWithRetry', () => ({
  lazyWithRetry: (_loader: unknown, cacheKey: string) => {
    if (cacheKey === 'operations-performance-dashboard') {
      return (props: { onClose: () => void; autoOpen?: boolean }) => {
        performanceDashboardRenderSpy();
        performanceDashboardPropsSpy(props);
        return React.createElement(
          'div',
          null,
          React.createElement('div', null, 'Mock Performance Dashboard'),
          React.createElement('button', { type: 'button', onClick: props.onClose }, 'Back from Performance'),
        );
      };
    }

    if (cacheKey === 'operations-reports-workspace') {
      return (props: { onClose: () => void }) => {
        reportsWorkspaceRenderSpy();
        return React.createElement(
          'div',
          null,
          React.createElement('div', null, 'Mock STREETS Reports'),
          React.createElement('button', { type: 'button', onClick: props.onClose }, 'Back from Reports'),
        );
      };
    }

    return () => React.createElement('div', null, 'Mock Lazy Component');
  },
}));

import { OperationsWorkspace } from '../components/workspaces/OperationsWorkspace';

describe('OperationsWorkspace performance shell', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    window.location.hash = '';
    performanceDashboardRenderSpy.mockClear();
    performanceDashboardPropsSpy.mockClear();
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

  it('opens the operations dashboard directly from the operations workspace', () => {
    flushSync(() => {
      root.render(<OperationsWorkspace />);
    });

    expect(container.textContent).toContain('Mock Performance Dashboard');
    expect(performanceDashboardRenderSpy).toHaveBeenCalled();
    expect(performanceDashboardPropsSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        autoOpen: true,
      }),
    );
    expect(reportsWorkspaceRenderSpy).not.toHaveBeenCalled();
  });

  it('opens STREETS reports from a direct reports hash and returns to the dashboard', async () => {
    window.location.hash = 'operations/perf-reports';

    flushSync(() => {
      root.render(<OperationsWorkspace />);
    });

    expect(container.textContent).toContain('Mock STREETS Reports');
    expect(reportsWorkspaceRenderSpy).toHaveBeenCalled();

    const backButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.includes('Back from Reports'),
    ) as HTMLButtonElement | undefined;

    backButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(container.textContent).toContain('Mock Performance Dashboard');
    expect(performanceDashboardRenderSpy).toHaveBeenCalled();
  });
});
