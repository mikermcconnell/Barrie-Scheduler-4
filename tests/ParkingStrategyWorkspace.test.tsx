import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parkingStrategyFixture } from './fixtures/parkingStrategyFixture';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

vi.mock('../components/contexts/AuthContext', () => ({ useAuth: () => ({ user: { uid: 'user' } }) }));
vi.mock('../components/contexts/TeamContext', () => ({ useTeam: () => ({ team: { id: 'team' } }) }));
vi.mock('../utils/firebase', () => ({ db: {}, storage: {} }));
vi.mock('../components/Parking/ParkingStrategyMap', () => ({ ParkingStrategyMap: ({ points, onSelect }: { points: Array<{ id: string; name: string }>; onSelect: (id: string) => void }) => <div data-testid="map">{points.map(point => <button key={point.id} onClick={() => onSelect(point.id)}>Map {point.name}</button>)}</div> }));
vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>, BarChart: () => <div>Chart</div>, Bar: (): null => null, CartesianGrid: (): null => null, Tooltip: (): null => null, XAxis: (): null => null, YAxis: (): null => null,
}));
import { ParkingStrategyWorkspaceContent, type ParkingStrategyServices } from '../components/Parking/ParkingStrategyWorkspace';

describe('Parking strategy connected workflow', () => {
  let container: HTMLDivElement;
  let root: Root;
  let services: ParkingStrategyServices;
  beforeEach(() => {
    window.location.hash = '#parking/strategy';
    container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
    const fixture = parkingStrategyFixture();
    services = { loadHistory: vi.fn().mockResolvedValue(fixture.history), loadSettings: vi.fn().mockResolvedValue(fixture.settings), loadLocations: vi.fn().mockResolvedValue(fixture.locations), saveHistory: vi.fn().mockResolvedValue(fixture.history), saveLocations: vi.fn().mockResolvedValue(fixture.locations), parseFiles: vi.fn().mockResolvedValue(fixture.parsed) };
  });
  afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
  async function render(canEdit = true) { await act(async () => root.render(<ParkingStrategyWorkspaceContent teamId="team" userId="user" canEdit={canEdit} services={services} />)); }
  async function click(text: string) {
    const button = [...container.querySelectorAll('button')].find(node => node.textContent?.trim() === text);
    expect(button, `button ${text}`).toBeTruthy();
    await act(async () => button!.click());
  }
  async function select(label: string, value: string) {
    const node = container.querySelector(`select[aria-label="${label}"]`) as HTMLSelectElement;
    await act(async () => { node.value = value; node.dispatchEvent(new Event('change', { bubbles: true })); });
  }
  it('allows no selected area and toggles a ranked lot off without losing the period', async () => {
    window.location.hash = '#parking/lot-data/history/map?from=2025-08&to=2025-08';
    await render();
    expect(container.querySelector('.ps-rank[aria-pressed="true"]')).toBeNull();
    const rank = container.querySelector<HTMLButtonElement>('.ps-rank')!;
    await act(async () => rank.click());
    expect(new URLSearchParams(window.location.hash.split('?')[1]).has('area')).toBe(true);
    await act(async () => rank.click());
    expect(new URLSearchParams(window.location.hash.split('?')[1]).has('area')).toBe(false);
    expect(window.location.hash).toContain('from=2025-08&to=2025-08');
    expect(container.querySelector('.ps-rank[aria-pressed="true"]')).toBeNull();
    expect(container.textContent).not.toContain('Included meters');
  });
  it('carries period/selection into the map and keeps missing links out of map points', async () => {
    await render();
    expect(container.textContent).toContain('$75');
    expect(container.querySelector('[data-testid="map"]')?.textContent).not.toContain('heritage');
    await click('Map Marina Parking Lot');
    await select('From month', '2025-08');
    expect(container.textContent).toContain('$40');
    expect(container.textContent).not.toContain('$75');
    await click('Explore on map');
    expect(window.location.hash).toContain('lot-data/history/map?from=2025-08');
    expect(container.textContent).toContain('2025-08 to 2025-08');
    expect(container.textContent).toContain('MARINA 1');
    expect(container.textContent).not.toContain('MARINA 2');
    const target = [...container.querySelectorAll('a')].find(a => a.textContent?.includes('Open this lot'));
    expect(target?.hash).toContain('location=marina-lot');
    expect(target?.hash).toContain('from=2025-08');
    await click('Return to Trends and Graphs');
    expect((container.querySelector('select[aria-label="From month"]') as HTMLSelectElement).value).toBe('2025-08');
  });
  it('surfaces a load error rather than presenting an empty archive', async () => {
    vi.mocked(services.loadHistory).mockRejectedValue(new Error('Permission denied'));
    await render();
    expect(container.textContent).toContain('Parking evidence could not be loaded');
    expect(container.textContent).not.toContain('No strategy history has been imported');
    expect([...container.querySelectorAll('button')].find(b => b.textContent?.includes('Import history'))?.disabled).toBe(true);
  });
  it('does not substitute another area or all dates for an unavailable linked selection', async () => {
    window.location.hash = '#parking/strategy/map?area=location%3Amissing';
    await render();
    expect(container.textContent).toContain('Select another area');
    expect(container.textContent).not.toContain('Included meters');
    const revenueLink = [...container.querySelectorAll('a')].find(a => a.textContent === 'Open HotSpot / QR workspace');
    expect(revenueLink?.hash).toContain('from=2024-07');
    expect(revenueLink?.hash).toContain('to=2025-08');
  });
  it('leaves import preview available when an optimistic save fails', async () => {
    vi.mocked(services.saveHistory).mockRejectedValue(new Error('History changed. Refresh and try again.'));
    await render();
    const input = container.querySelector('input[type=file]')!;
    Object.defineProperty(input, 'files', { configurable: true, value: [new File(['fixture'], 'history.xlsx')] });
    await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
    await click('Save history archive');
    expect(container.querySelector('[role="dialog"]')?.textContent).toContain('History changed');
    expect(container.textContent).not.toContain('saved and read back');
  });
  it('keeps read-only sessions from importing or changing links', async () => {
    await render(false);
    expect(container.textContent).not.toContain('Import history');
    await click('Location links');
    expect(container.textContent).not.toContain('Save reviewed links');
    expect([...container.querySelectorAll('[role="dialog"] select')].every(select => (select as HTMLSelectElement).disabled)).toBe(true);
  });
  it('requires a concrete import review and performs a read-back after saving', async () => {
    await render();
    const input = container.querySelector('input[type=file]')!;
    Object.defineProperty(input, 'files', { configurable: true, value: [new File(['fixture'], 'history.xlsx')] });
    await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
    expect(container.textContent).toContain('This replaces the entire strategy-history archive');
    expect(services.saveHistory).not.toHaveBeenCalled();
    await click('Save history archive');
    expect(services.saveHistory).toHaveBeenCalledWith('team', 'user', expect.any(Object), 1);
    expect(services.loadHistory).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain('saved and read back');
  });
  it('saves explicit reviewed links and excludes non-spatial choices', async () => {
    await render(); await click('Location links');
    expect([...container.querySelectorAll('[role="dialog"] option')].some(option => option.textContent === 'Special Events')).toBe(false);
    await select('Physical location for HERITAGE EAST', 'heritage-lot');
    await click('Save reviewed links');
    expect(services.saveLocations).toHaveBeenCalledWith('team', 'user', expect.arrayContaining([expect.objectContaining({ meterId: 'HERITAGE EAST', locationId: 'heritage-lot' })]), 1);
  });
  it('prefills a first pass without saving or placing unreviewed map pins', async () => {
    const empty: Awaited<ReturnType<ParkingStrategyServices['loadLocations']>> = { revision: 0, links: [], updatedAt: '', updatedBy: '' };
    vi.mocked(services.loadLocations).mockResolvedValue(empty);
    await render();
    await click('Location links');
    expect((container.querySelector('select[aria-label="Physical location for MARINA 1"]') as HTMLSelectElement).value).toBe('marina-lot');
    expect((container.querySelector('select[aria-label="Physical location for HERITAGE EAST"]') as HTMLSelectElement).value).toBe('');
    expect(container.textContent).toContain('First-pass draft:');
    expect(services.saveLocations).not.toHaveBeenCalled();
    await click('Close');
    expect(container.querySelector('[data-testid="map"]')?.textContent).toBe('');
  });
});
