import React, { useLayoutEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';

const {
  saveDraftMock,
  saveDraftVersionMock,
  getDraftMock,
  withRetryMock,
} = vi.hoisted(() => ({
  saveDraftMock: vi.fn(),
  saveDraftVersionMock: vi.fn(),
  getDraftMock: vi.fn(),
  withRetryMock: vi.fn(async (fn: () => Promise<unknown>) => fn()),
}));

vi.mock('../utils/services/dataService', () => ({
  saveDraft: saveDraftMock,
  saveDraftVersion: saveDraftVersionMock,
  getDraft: getDraftMock,
  withRetry: withRetryMock,
}));

import { useAutoSave, type UseAutoSaveOptions } from '../hooks/useAutoSave';

type AutoSaveApi = ReturnType<typeof useAutoSave>;

function Harness({
  options,
  onReady,
}: {
  options?: UseAutoSaveOptions;
  onReady: (api: AutoSaveApi) => void;
}): null {
  const api = useAutoSave(options);

  useLayoutEffect(() => {
    onReady(api);
  }, [api, onReady]);

  return null;
}

const schedules = [
  {
    routeName: '10 (Weekday) (North)',
    stops: ['Stop 1', 'Stop 2'],
    stopIds: {},
    trips: [],
  },
] as any;

const originalSchedules = [
  {
    routeName: '10 (Weekday) (North)',
    stops: ['Stop 1'],
    stopIds: {},
    trips: [],
  },
] as any;

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
}

async function waitForRerender() {
  await flushPromises();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await flushPromises();
}

describe('useAutoSave', () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;
  let api: AutoSaveApi | null = null;

  beforeEach(() => {
    vi.useRealTimers();
    localStorage.clear();
    saveDraftMock.mockReset();
    saveDraftVersionMock.mockReset();
    getDraftMock.mockReset();
    withRetryMock.mockClear();
    api = null;
  });

  afterEach(() => {
    vi.useRealTimers();

    if (root) {
      flushSync(() => {
        root?.unmount();
      });
    }

    container?.remove();
    root = null;
    container = null;
    api = null;
  });

  const renderHarness = (options?: UseAutoSaveOptions) => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    flushSync(() => {
      root?.render(
        <Harness
          options={options}
          onReady={(value) => {
            api = value;
          }}
        />,
      );
    });
  };

  it('debounces guest saves to localStorage and marks the draft as saved', async () => {
    vi.useFakeTimers();
    renderHarness({ debounceMs: 100 });

    flushSync(() => {
      api?.setData(schedules, originalSchedules, 'Guest Draft');
    });

    expect(localStorage.getItem('scheduleDraft_current')).toBeNull();
    expect(api?.status).toBe('idle');

    flushSync(() => {
      vi.advanceTimersByTime(100);
    });
    await flushPromises();

    const savedDraft = JSON.parse(localStorage.getItem('scheduleDraft_current') || '{}');
    expect(savedDraft).toMatchObject({
      name: 'Guest Draft',
      schedules,
      originalSchedules,
    });
    expect(api?.status).toBe('saved');
    expect(api?.error).toBeNull();
    expect(api?.currentDraftId).toBeNull();
    expect(api?.lastSaved).toBeInstanceOf(Date);
  });

  it('creates a draft first when saving an authenticated version without an existing draft id', async () => {
    saveDraftMock.mockResolvedValue('draft-123');
    saveDraftVersionMock.mockResolvedValue('version-1');
    renderHarness({ userId: 'user-1' });

    flushSync(() => {
      api?.setData(schedules, originalSchedules, 'Auth Draft');
    });

    await api?.saveVersion('Checkpoint A');
    await waitForRerender();

    expect(saveDraftMock).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({
        name: 'Auth Draft',
        schedules,
        originalSchedules,
      }),
    );
    expect(saveDraftVersionMock).toHaveBeenCalledWith(
      'user-1',
      'draft-123',
      schedules,
      originalSchedules,
      'Checkpoint A',
    );
    expect(api?.currentDraftId).toBe('draft-123');
    expect(api?.status).toBe('saved');
  });

  it('loads and clears a guest draft from localStorage', async () => {
    localStorage.setItem('scheduleDraft_current', JSON.stringify({
      name: 'Recovered Draft',
      schedules,
      originalSchedules,
      updatedAt: '2026-04-10T12:00:00.000Z',
    }));

    renderHarness({ enabled: true });
    await waitForRerender();

    const loaded = await api?.loadDraft('ignored');

    expect(loaded).toEqual(expect.objectContaining({
      id: 'local',
      name: 'Recovered Draft',
      schedules,
      originalSchedules,
    }));
    expect(api?.status).toBe('saved');
    expect(api?.lastSaved).toBeInstanceOf(Date);

    flushSync(() => {
      api?.clearDraft();
    });

    expect(localStorage.getItem('scheduleDraft_current')).toBeNull();
    expect(api?.status).toBe('idle');
    expect(api?.lastSaved).toBeNull();
    expect(api?.error).toBeNull();
    expect(api?.currentDraftId).toBeNull();
  });

  it('does not schedule or perform saves when autosave is disabled', async () => {
    vi.useFakeTimers();
    renderHarness({ enabled: false, debounceMs: 100, userId: 'user-1' });

    flushSync(() => {
      api?.setData(schedules, originalSchedules, 'Disabled Draft');
    });

    flushSync(() => {
      vi.advanceTimersByTime(200);
    });
    await flushPromises();

    expect(saveDraftMock).not.toHaveBeenCalled();
    expect(localStorage.getItem('scheduleDraft_current')).toBeNull();
    expect(api?.status).toBe('idle');
  });

  it('surfaces firebase save failures as an error state', async () => {
    const error = new Error('network down');
    withRetryMock.mockRejectedValueOnce(error);
    renderHarness({ userId: 'user-1' });

    flushSync(() => {
      api?.setData(schedules, originalSchedules, 'Broken Draft');
    });

    await api?.triggerSave();
    await waitForRerender();

    expect(api?.status).toBe('error');
    expect(api?.error).toBe('network down');
  });

  it('does not mark a stale in-flight save as saved when newer data arrives before it resolves', async () => {
    vi.useFakeTimers();

    let resolveFirstSave: ((value: string) => void) | null = null;
    saveDraftMock
      .mockImplementationOnce(() => new Promise<string>((resolve) => {
        resolveFirstSave = resolve;
      }))
      .mockResolvedValueOnce('draft-race');

    renderHarness({ userId: 'user-1', debounceMs: 100 });

    flushSync(() => {
      api?.setData(schedules, originalSchedules, 'Draft v1');
    });

    await vi.advanceTimersByTimeAsync(100);
    await flushPromises();

    const newerSchedules = [
      {
        ...schedules[0],
        stops: ['Stop 1', 'Stop 2', 'Stop 3'],
      },
    ] as any;

    flushSync(() => {
      api?.setData(newerSchedules, originalSchedules, 'Draft v2');
    });

    resolveFirstSave?.('draft-race');
    await flushPromises();
    await flushPromises();

    expect(api?.status).not.toBe('saved');

    await vi.advanceTimersByTimeAsync(100);
    await flushPromises();

    expect(saveDraftMock).toHaveBeenCalledTimes(2);
    expect(saveDraftMock.mock.calls[1]?.[1]).toEqual(expect.objectContaining({
      name: 'Draft v2',
      schedules: newerSchedules,
    }));
    expect(api?.status).toBe('saved');
    expect(api?.currentDraftId).toBe('draft-race');
  });
});
