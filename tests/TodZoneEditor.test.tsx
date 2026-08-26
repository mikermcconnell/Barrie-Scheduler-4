import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { flushSync } from 'react-dom';
import { createTodZoneASeedDraft } from '../utils/todZones/todZoneSeed';

const mocks = vi.hoisted(() => ({
  draftState: { data: null as ReturnType<typeof createTodZoneASeedDraft> | null, isLoading: false, isError: false },
  stopsState: { data: [{ id: '202', name: 'Stop 202', lat: 44.414, lon: -79.705, status: 'ACTIVE' }], isError: false },
  refetch: vi.fn(async () => undefined),
  invalidateQueries: vi.fn(async () => undefined),
  saveDraft: vi.fn(async () => 2),
  publish: vi.fn(async () => ({ versionId: 'version-2', revision: 2 })),
}));

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: mocks.invalidateQueries }),
}));
vi.mock('../hooks/useTodZones', () => ({
  useTodZoneDraftQuery: () => ({ ...mocks.draftState, refetch: mocks.refetch }),
  useBarrieTransitStopsQuery: () => mocks.stopsState,
}));
vi.mock('../utils/todZones/todZoneService', () => ({
  getTodZoneErrorMessage: (error: unknown) => error instanceof Error ? error.message : 'Failed',
  saveTodZoneDraft: mocks.saveDraft,
  publishTodZoneVersion: mocks.publish,
}));
vi.mock('../components/shared', () => ({ MapBase: ({ children }: { children?: React.ReactNode }) => <div>{children}</div> }));
vi.mock('../components/Performance/TodZoneDrawControl', () => ({ TodZoneDrawControl: (): null => null }));
vi.mock('react-map-gl/mapbox', () => ({ Source: ({ children }: { children?: React.ReactNode }) => <>{children}</>, Layer: (): null => null }));

import { TodZoneEditor } from '../components/Performance/TodZoneEditor';

describe('TodZoneEditor', () => {
  let container: HTMLDivElement;
  let root: Root;
  const onClose = vi.fn();

  beforeEach(() => {
    mocks.draftState.data = createTodZoneASeedDraft();
    mocks.draftState.isLoading = false;
    mocks.draftState.isError = false;
    mocks.stopsState.isError = false;
    vi.clearAllMocks();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  async function renderEditor(): Promise<void> {
    await act(async () => {
      root.render(<TodZoneEditor open teamId="team-a" userId="owner-a" onClose={onClose} />);
    });
  }

  it('shows a recoverable error when the shared draft cannot load', async () => {
    mocks.draftState.data = null;
    mocks.draftState.isError = true;
    await renderEditor();

    expect(container.textContent).toContain('could not be loaded');
    const retry = [...container.querySelectorAll('button')].find(button => button.textContent === 'Retry');
    await act(async () => retry?.click());
    expect(mocks.refetch).toHaveBeenCalledOnce();
  });

  it('guards both unsaved close and immutable publication with confirmation', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    await renderEditor();
    const source = [...container.querySelectorAll('input')].find(input => input.parentElement?.textContent?.startsWith('Source'))!;
    flushSync(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(source, 'Adjusted planner source');
      source.dispatchEvent(new Event('input', { bubbles: true }));
      source.dispatchEvent(new Event('change', { bubbles: true }));
    });

    const close = container.querySelector<HTMLButtonElement>('button[aria-label="Close zone editor"]')!;
    await act(async () => close.click());
    expect(onClose).not.toHaveBeenCalled();
    expect(confirm).toHaveBeenCalledWith('Discard the unsaved TOD zone changes?');

    confirm.mockReturnValue(true);
    await act(async () => close.click());
    expect(onClose).toHaveBeenCalledOnce();

    confirm.mockClear().mockReturnValue(false);
    const publish = [...container.querySelectorAll('button')].find(button => button.textContent?.includes('Publish'))!;
    await act(async () => publish.click());
    expect(mocks.publish).not.toHaveBeenCalled();
    expect(confirm.mock.calls[0]?.[0]).toContain('Published versions are immutable');
  });

  it('publishes the validated draft and refreshes both shared queries', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    await renderEditor();
    const publish = [...container.querySelectorAll('button')].find(button => button.textContent?.includes('Publish'))!;
    await act(async () => publish.click());

    expect(mocks.publish).toHaveBeenCalledWith('team-a', expect.any(Object), mocks.stopsState.data, 'owner-a', 0);
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['todZoneDraft', 'team-a'] });
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['todZoneVersions', 'team-a'] });
    expect(container.textContent).toContain('Published a new effective-dated zone version.');
  });

  it('lists the complete Zone A connection-stop set', async () => {
    await renderEditor();
    expect(container.textContent).toContain('17 connection stops:');
    expect(container.textContent).toContain('58, 59, 60, 61, 76, 215, 216, 416, 440, 441, 447, 449, 453, 454, 628, 634, 913');
  });

  it('lists the complete Zone B connection-stop set', async () => {
    await renderEditor();
    const zoneB = [...container.querySelectorAll('button')].find(button => button.textContent === 'B');
    await act(async () => zoneB?.click());
    expect(container.textContent).toContain('13 connection stops:');
    expect(container.textContent).toContain('10, 67, 68, 129, 135, 136, 255, 333, 583, 586, 612, 938, 959');
    expect(container.textContent).toContain('0/10 ordinary stops labelled on the Zone B PDF are included.');
  });

  it.each([
    ['C', '20 connection stops:', '20, 117, 120, 704, 705, 715, 716, 717, 718, 722, 725, 741, 752, 764, 775, 777, 784, 968, 969, 9009', '0/20'],
    ['D', '18 connection stops:', '20, 116, 704, 705, 715, 716, 717, 718, 722, 725, 741, 751, 752, 777, 784, 968, 969, 9009', '0/47'],
    ['E', '4 connection stops:', '119, 596, 597, 725', '0/8'],
    ['F', '8 connection stops:', '512, 513, 725, 741, 752, 764, 775, 777', '0/21'],
    ['H', '8 connection stops:', '312, 487, 488, 494, 495, 538, 539, 847', '0/15'],
    ['T', '1 connection stop:', '725', '0/2'],
  ])('lists the complete Zone %s connection-stop set', async (zoneCode, countLabel, stopList, referenceCount) => {
    await renderEditor();
    const zoneButton = [...container.querySelectorAll('button')].find(button => button.textContent === zoneCode);
    await act(async () => zoneButton?.click());
    expect(container.textContent).toContain(countLabel);
    expect(container.textContent).toContain(stopList);
    expect(container.textContent).toContain(`${referenceCount} ordinary stops labelled on the Zone ${zoneCode} PDF are included.`);
  });
});
