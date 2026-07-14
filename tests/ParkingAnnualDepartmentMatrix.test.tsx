import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AnnualDepartmentMatrixTable,
  type AnnualSummaryRow,
} from '../components/workspaces/ParkingWorkspace';

describe('AnnualDepartmentMatrixTable observation links', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('opens raw observations for cells and every total level', () => {
    const onOpenObservations = vi.fn();
    const rows: AnnualSummaryRow[] = [
      {
        codeLabel: 'TP2026',
        department: 'Transit',
        codeFamilyKey: 'TP',
        monthlyValues: [10, 20, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
        monthlyUseCounts: [2, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
        total: 30,
        totalUseCount: 3,
        percent: 0.5,
      },
      {
        codeLabel: 'BFES2026',
        department: 'Fire',
        codeFamilyKey: 'BFES',
        monthlyValues: [30, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
        monthlyUseCounts: [4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
        total: 30,
        totalUseCount: 4,
        percent: 0.5,
      },
    ];

    act(() => {
      root.render(
        <AnnualDepartmentMatrixTable
          rows={rows}
          codeFamilies={[]}
          year="2026"
          onOpenObservations={onOpenObservations}
        />,
      );
    });

    const click = (label: string) => {
      const button = container.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`);
      expect(button).not.toBeNull();
      act(() => button?.click());
    };

    click('View raw observations for Transit, January 2026, $10.00, 2 uses');
    expect(onOpenObservations).toHaveBeenLastCalledWith(expect.objectContaining({
      year: '2026', month: '2026-01', codeFamilyKey: 'TP', department: 'Transit',
    }));

    click('View all raw observations for January 2026, $40.00, 6 uses');
    expect(onOpenObservations).toHaveBeenLastCalledWith({
      year: '2026', month: '2026-01', label: 'All Departments · January 2026',
    });

    click('View annual raw observations for Transit, $30.00, 3 uses');
    expect(onOpenObservations).toHaveBeenLastCalledWith({
      year: '2026', codeFamilyKey: 'TP', department: 'Transit', label: 'Transit · 2026 Annual Total',
    });

    click('View all raw observations for 2026, $60.00, 7 uses');
    expect(onOpenObservations).toHaveBeenLastCalledWith({
      year: '2026', label: 'All Observed Values · 2026',
    });
  });

  it('uses the singular label for exactly one raw observation', () => {
    const rows: AnnualSummaryRow[] = [{
      codeLabel: 'TP2026',
      department: 'Transit',
      codeFamilyKey: 'TP',
      monthlyValues: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      monthlyUseCounts: [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      total: 0,
      totalUseCount: 1,
      percent: 1,
    }];

    act(() => {
      root.render(
        <AnnualDepartmentMatrixTable
          rows={rows}
          codeFamilies={[]}
          year="2026"
          onOpenObservations={vi.fn()}
        />,
      );
    });

    const button = container.querySelector<HTMLButtonElement>(
      '[aria-label="View raw observations for Transit, January 2026, $0.00, 1 uses"]',
    );
    expect(button).not.toBeNull();
    expect(button?.textContent).toContain('1 use');
  });
});
