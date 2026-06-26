import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  FIXED_ROUTE_RESUME_UPDATED_EVENT,
  loadFixedRouteResumeState,
  saveFixedRouteResumeState,
} from '../utils/workspaces/fixedRouteResumeState';

describe('workspace resume state', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('saves latest resume state and notifies listeners immediately', () => {
    const listener = vi.fn();
    window.addEventListener(FIXED_ROUTE_RESUME_UPDATED_EVENT, listener);

    saveFixedRouteResumeState({
      hash: 'planning/route-planner-2',
      label: 'Planning Data · Route Planner · Test Project',
    }, 'user-1');

    expect(loadFixedRouteResumeState('user-1')).toMatchObject({
      hash: '#planning/route-planner-2',
      label: 'Planning Data · Route Planner · Test Project',
    });
    expect(listener).toHaveBeenCalledTimes(1);

    window.removeEventListener(FIXED_ROUTE_RESUME_UPDATED_EVENT, listener);
  });
});
