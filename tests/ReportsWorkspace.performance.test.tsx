import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';

const reportsModuleRenderSpy = vi.fn();
const usePerformanceDataQuerySpy = vi.fn();

vi.mock('../components/contexts/TeamContext', () => ({
  useTeam: () => ({
    team: { id: 'team-1' },
  }),
}));

vi.mock('../components/contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { uid: 'user-1' },
  }),
}));

vi.mock('../hooks/usePerformanceData', () => ({
  usePerformanceMetadataQuery: () => ({
    data: null,
    isLoading: false,
  }),
  usePerformanceDataQuery: (...args: unknown[]) => {
    usePerformanceDataQuerySpy(...args);
    return {
      data: null,
      isLoading: false,
    };
  },
}));

vi.mock('../components/Performance/ReportsModule', () => ({
  ReportsModule: (props: unknown) => {
    reportsModuleRenderSpy(props);
    return React.createElement('div', null, 'Mock Reports Module');
  },
}));

vi.mock('../components/Performance/PerformanceImport', () => ({
  PerformanceImport: () => React.createElement('div', null, 'Mock Performance Import'),
}));

vi.mock('../components/TeamManagement', () => ({
  TeamManagement: () => React.createElement('div', null, 'Mock Team Management'),
}));

import { ReportsWorkspace } from '../components/workspaces/ReportsWorkspace';

describe('ReportsWorkspace performance landing', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    reportsModuleRenderSpy.mockClear();
    usePerformanceDataQuerySpy.mockClear();
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

  it('keeps the landing page light and does not enable the full data query until a workspace is entered', () => {
    flushSync(() => {
      root.render(<ReportsWorkspace onClose={() => {}} />);
    });

    expect(container.textContent).toContain('STREETS Reports');
    expect(container.textContent).toContain('Import STREETS Data');
    expect(reportsModuleRenderSpy).not.toHaveBeenCalled();
    expect(usePerformanceDataQuerySpy).toHaveBeenCalledTimes(1);
    expect(usePerformanceDataQuerySpy.mock.calls[0]?.[1]).toBe(false);
  });
});
