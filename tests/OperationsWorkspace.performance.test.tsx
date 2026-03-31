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

  it('opens the operations dashboard directly when the card is clicked', async () => {
    flushSync(() => {
      root.render(<OperationsWorkspace />);
    });

    const operationsCard = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.includes('Operations Dashboard') && button.textContent?.includes('OTP, ridership, and load profiles'),
    ) as HTMLButtonElement | undefined;

    expect(operationsCard).toBeTruthy();

    operationsCard?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(performanceDashboardRenderSpy).toHaveBeenCalled();
    expect(performanceDashboardPropsSpy).toHaveBeenCalled();
    expect(performanceDashboardPropsSpy.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        autoOpen: true,
      }),
    );
  });
});
