import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';
import type { MasterRouteTable } from '../utils/parsers/masterScheduleParser';

const {
  getConnectionLibraryMock,
  getRouteConnectionConfigMock,
  writeBufferMock,
  linkClickMock,
  createObjectUrlMock,
  workbookSheetsMock,
  workbookSheetRowsMock,
  undoMock,
  redoMock,
} = vi.hoisted(() => ({
  getConnectionLibraryMock: vi.fn().mockResolvedValue(null),
  getRouteConnectionConfigMock: vi.fn().mockResolvedValue(null),
  writeBufferMock: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
  linkClickMock: vi.fn(),
  createObjectUrlMock: vi.fn(() => 'blob:mock-export'),
  workbookSheetsMock: [] as string[][],
  workbookSheetRowsMock: [] as Array<Array<{ name: string; rows: unknown[][] }>>,
  undoMock: vi.fn(),
  redoMock: vi.fn(),
}));

const createCell = () => ({
  value: undefined as unknown,
  font: undefined as unknown,
  fill: undefined as unknown,
  alignment: undefined as unknown,
  border: undefined as unknown,
});

const createRow = (data: unknown[]) => {
  const cells = data.map(() => createCell());
  return {
    height: undefined as number | undefined,
    getCell(index: number) {
      while (cells.length < index) {
        cells.push(createCell());
      }
      return cells[index - 1];
    },
    eachCell(callback: (cell: ReturnType<typeof createCell>, col: number) => void) {
      cells.forEach((cell, idx) => callback(cell, idx + 1));
    },
  };
};

const createWorksheet = (name: string, rowStore: unknown[][]) => {
  const columnMap = new Map<number, { width?: number }>();
  return {
    addRow(data: unknown[]) {
      rowStore.push(data);
      return createRow(data);
    },
    mergeCells: vi.fn(),
    getCell: vi.fn(() => createCell()),
    getColumn(index: number) {
      if (!columnMap.has(index)) {
        columnMap.set(index, {});
      }
      return columnMap.get(index)!;
    },
  };
};

vi.mock('exceljs', () => {
  class MockWorkbook {
    creator = '';
    created: Date | null = null;
    private readonly sheetNames: string[];
    private readonly sheets: Array<{ name: string; rows: unknown[][] }>;
    constructor() {
      this.sheetNames = [];
      this.sheets = [];
      workbookSheetsMock.push(this.sheetNames);
      workbookSheetRowsMock.push(this.sheets);
    }
    addWorksheet = vi.fn((name: string) => {
      this.sheetNames.push(name);
      const sheet = { name, rows: [] as unknown[][] };
      this.sheets.push(sheet);
      return createWorksheet(name, sheet.rows);
    });
    xlsx = {
      writeBuffer: writeBufferMock,
    };
  }

  return {
    default: {
      Workbook: MockWorkbook,
    },
  };
});

vi.mock('xlsx', () => ({}));

vi.mock('../utils/parsers/masterScheduleParser', async () => {
  const actual = await vi.importActual<typeof import('../utils/parsers/masterScheduleParser')>(
    '../utils/parsers/masterScheduleParser',
  );

  return {
    ...actual,
    buildRoundTripView: vi.fn((
      north?: Pick<MasterRouteTable, 'stops' | 'stopIds' | 'trips'> | null,
      south?: Pick<MasterRouteTable, 'stops' | 'stopIds' | 'trips'> | null,
    ) => ({
      routeName: '10',
      northStops: north?.stops ?? [],
      southStops: south?.stops ?? [],
      northStopIds: north?.stopIds ?? {},
      southStopIds: south?.stopIds ?? {},
      rows: [
        {
          blockId: '10-1',
          trips: [...(north?.trips ?? []), ...(south?.trips ?? [])],
          totalTravelTime: 60,
          totalRecoveryTime: 0,
          totalCycleTime: 60,
          pairIndex: 0,
        },
      ],
    })),
    validateRouteTable: vi.fn(() => []),
  };
});

vi.mock('../utils/connections/connectionLibraryService', () => ({
  getConnectionLibrary: getConnectionLibraryMock,
  getRouteConnectionConfig: getRouteConnectionConfigMock,
}));

vi.mock('../hooks/useAddTrip', () => ({
  useAddTrip: () => ({
    modalContext: null as any,
    openModal: vi.fn(),
    closeModal: vi.fn(),
    handleConfirm: vi.fn(),
  }),
}));

vi.mock('../hooks/useTravelTimeGrid', () => ({
  useTravelTimeGrid: () => ({
    handleBulkAdjustTravelTime: vi.fn(),
    handleBulkAdjustRecoveryTime: vi.fn(),
    handleSingleTripTravelAdjust: vi.fn(),
    handleSingleRecoveryAdjust: vi.fn(),
  }),
}));

vi.mock('../components/layout/WorkspaceHeader', () => ({
  WorkspaceHeader: (props: {
    onUndo?: () => void;
    onRedo?: () => void;
    onToggleFullScreen?: () => void;
    onOpenConnections?: () => void;
    onExport?: () => void;
    hasUnsavedChanges?: boolean;
  }) => (
    <div data-testid="workspace-header" data-unsaved={String(props.hasUnsavedChanges ?? false)}>
      <button data-testid="undo" onClick={props.onUndo}>Undo</button>
      <button data-testid="redo" onClick={props.onRedo}>Redo</button>
      <button data-testid="toggle-fullscreen" onClick={props.onToggleFullScreen}>Fullscreen</button>
      <button data-testid="open-connections" onClick={props.onOpenConnections}>Connections</button>
      <button data-testid="export" onClick={props.onExport}>Export</button>
      <input data-testid="typing-input" />
    </div>
  ),
}));

vi.mock('../components/schedule/RoundTripTableView', () => ({
  RoundTripTableView: () => <div data-testid="round-trip-table" />,
}));

vi.mock('../components/TravelTimeGrid', () => ({
  TravelTimeGrid: () => <div data-testid="travel-time-grid" />,
}));

vi.mock('../components/NewSchedule/TimelineView', () => ({
  TimelineView: () => <div data-testid="timeline-view" />,
}));

vi.mock('../components/connections/ConnectionsPanel', () => ({
  ConnectionsPanel: (props: { onClose?: () => void }) => (
    <div data-testid="connections-panel">
      <button data-testid="close-connections" onClick={props.onClose}>Close</button>
    </div>
  ),
}));

vi.mock('../components/RouteSummary', () => ({
  RouteSummary: () => <div data-testid="route-summary" />,
}));

vi.mock('../components/AuditLogPanel', () => ({
  useAuditLog: () => ({ entries: [] as any[], logAction: vi.fn((): void => undefined) }),
  AuditLogPanel: (props: { hideClosedTrigger?: boolean; placement?: string }) => (
    <div
      data-testid="audit-log-panel"
      data-hide-closed-trigger={String(props.hideClosedTrigger ?? false)}
      data-placement={props.placement}
    />
  ),
}));

vi.mock('../components/modals/AddTripModal', () => ({
  AddTripModal: (): null => null,
}));

vi.mock('../components/NewSchedule/TripContextMenu', () => ({
  TripContextMenu: (): null => null,
}));

vi.mock('../components/ui/CascadeModeSelector', () => ({
  CascadeModeSelector: (): null => null,
}));

import { ScheduleEditor } from '../components/ScheduleEditor';

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
}

const schedules = [
  {
    routeName: '10 (Weekday) (North)',
    stops: ['North Stop 1', 'North Stop 2'],
    stopIds: {},
    trips: [
      {
        id: 'north-trip',
        blockId: '10-1',
        direction: 'North',
        tripNumber: 1,
        rowId: 1,
        startTime: 420,
        endTime: 450,
        recoveryTime: 0,
        travelTime: 30,
        cycleTime: 30,
        stops: { 'North Stop 1': '7:00 AM', 'North Stop 2': '7:30 AM' },
        arrivalTimes: { 'North Stop 1': '7:00 AM', 'North Stop 2': '7:30 AM' },
      },
    ],
  },
  {
    routeName: '10 (Weekday) (South)',
    stops: ['South Stop 1', 'South Stop 2'],
    stopIds: {},
    trips: [
      {
        id: 'south-trip',
        blockId: '10-1',
        direction: 'South',
        tripNumber: 2,
        rowId: 2,
        startTime: 455,
        endTime: 485,
        recoveryTime: 0,
        travelTime: 30,
        cycleTime: 30,
        stops: { 'South Stop 1': '7:35 AM', 'South Stop 2': '8:05 AM' },
        arrivalTimes: { 'South Stop 1': '7:35 AM', 'South Stop 2': '8:05 AM' },
      },
    ],
  },
  {
    routeName: '8 (Weekday) (North)',
    stops: ['8 North Stop A', '8 North Stop B'],
    stopIds: {},
    trips: [
      {
        id: 'route-8-north-trip',
        blockId: '8-1',
        direction: 'North',
        tripNumber: 1,
        rowId: 1,
        startTime: 500,
        endTime: 530,
        recoveryTime: 0,
        travelTime: 30,
        cycleTime: 30,
        stops: { '8 North Stop A': '8:20 AM', '8 North Stop B': '8:50 AM' },
        arrivalTimes: { '8 North Stop A': '8:20 AM', '8 North Stop B': '8:50 AM' },
      },
    ],
  },
  {
    routeName: '8 (Weekday) (South)',
    stops: ['8 South Stop A', '8 South Stop B'],
    stopIds: {},
    trips: [
      {
        id: 'route-8-south-trip',
        blockId: '8-1',
        direction: 'South',
        tripNumber: 2,
        rowId: 2,
        startTime: 535,
        endTime: 565,
        recoveryTime: 0,
        travelTime: 30,
        cycleTime: 30,
        stops: { '8 South Stop A': '8:55 AM', '8 South Stop B': '9:25 AM' },
        arrivalTimes: { '8 South Stop A': '8:55 AM', '8 South Stop B': '9:25 AM' },
      },
    ],
  },
] as any;

describe('ScheduleEditor shell behavior', () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;
  let originalCreateObjectURL: typeof URL.createObjectURL;

  beforeEach(() => {
    getConnectionLibraryMock.mockClear();
    writeBufferMock.mockClear();
    linkClickMock.mockClear();
    createObjectUrlMock.mockClear();
    workbookSheetsMock.length = 0;
    workbookSheetRowsMock.length = 0;
    undoMock.mockClear();
    redoMock.mockClear();
    originalCreateObjectURL = URL.createObjectURL;
    URL.createObjectURL = createObjectUrlMock;
  });

  afterEach(() => {
    URL.createObjectURL = originalCreateObjectURL;

    if (root) {
      flushSync(() => {
        root?.unmount();
      });
    }

    container?.remove();
    root = null;
    container = null;
    vi.restoreAllMocks();
  });

  const renderEditor = (options?: {
    draftName?: string;
    schedules?: typeof schedules;
    exportScopeSchedules?: typeof schedules;
    compactStep4?: boolean;
  }) => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    flushSync(() => {
      root?.render(
        <ScheduleEditor
          schedules={options?.schedules ?? schedules}
          exportScopeSchedules={options?.exportScopeSchedules}
          teamId="team-1"
          userId="user-1"
          draftName={options?.draftName}
          compactStep4={options?.compactStep4}
          onSchedulesChange={vi.fn()}
          canUndo
          canRedo
          undo={undoMock}
          redo={redoMock}
        />,
      );
    });
  };

  const clickButtonByText = (label: string) => {
    const button = Array.from(container?.querySelectorAll('button') || []).find(
      element => element.textContent?.includes(label),
    ) as HTMLButtonElement | undefined;
    expect(button).toBeDefined();
    flushSync(() => {
      button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
  };

  it('fires undo and redo shortcuts unless the user is typing into an input', async () => {
    renderEditor();
    await flushPromises();

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'y', ctrlKey: true, bubbles: true }));

    expect(undoMock).toHaveBeenCalledTimes(1);
    expect(redoMock).toHaveBeenCalledTimes(1);

    const typingInput = container?.querySelector('[data-testid="typing-input"]') as HTMLInputElement | null;
    typingInput?.focus();

    flushSync(() => {
      typingInput?.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
      typingInput?.dispatchEvent(new KeyboardEvent('keydown', { key: 'y', ctrlKey: true, bubbles: true }));
    });

    expect(undoMock).toHaveBeenCalledTimes(1);
    expect(redoMock).toHaveBeenCalledTimes(1);
  });

  it('enters fullscreen from the header and exits it on Escape', async () => {
    renderEditor();
    await flushPromises();

    const fullscreenButton = container?.querySelector('[data-testid="toggle-fullscreen"]');

    flushSync(() => {
      fullscreenButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(container?.querySelector('.fixed.inset-0')).not.toBeNull();

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await flushPromises();

    expect(container?.querySelector('.fixed.inset-0')).toBeNull();
  });

  it('opens and closes the connections panel from header wiring', async () => {
    renderEditor();
    await flushPromises();

    const openButton = container?.querySelector('[data-testid="open-connections"]');

    flushSync(() => {
      openButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(container?.querySelector('[data-testid="connections-panel"]')).not.toBeNull();

    const closeButton = container?.querySelector('[data-testid="close-connections"]');
    flushSync(() => {
      closeButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(container?.querySelector('[data-testid="connections-panel"]')).toBeNull();
  });

  it('passes explicit unsaved state to the workspace header', async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    flushSync(() => {
      root?.render(
        <ScheduleEditor
          schedules={schedules}
          hasUnsavedChanges={false}
        />,
      );
    });

    await flushPromises();

    const header = container?.querySelector('[data-testid="workspace-header"]');
    expect(header?.getAttribute('data-unsaved')).toBe('false');
  });

  it('keeps the compact Step 4 editor shell from becoming a second scroll owner', async () => {
    renderEditor({ compactStep4: true });
    await flushPromises();

    const content = container?.querySelector('[data-testid="schedule-editor-content"]');
    const auditLog = container?.querySelector('[data-testid="audit-log-panel"]');

    expect(content?.className).toContain('overflow-hidden');
    expect(content?.className).not.toContain('overflow-auto');
    expect(content?.className).toContain('p-0');
    expect(content?.className).not.toContain('md:px-4');
    expect(auditLog?.getAttribute('data-hide-closed-trigger')).toBe('true');
    expect(auditLog?.getAttribute('data-placement')).toBe('top-right');
  });

  it('exports the current route only when selected from the export dialog', async () => {
    renderEditor({
      draftName: 'Route 10 Weekday Draft',
      schedules: schedules.slice(0, 2) as any,
      exportScopeSchedules: schedules as any,
    });
    await flushPromises();

    const originalCreateElement = document.createElement.bind(document);
    let downloadFileName = '';
    const createElementSpy = vi.spyOn(document, 'createElement').mockImplementation((tagName: string) => {
      const element = originalCreateElement(tagName);
      if (tagName.toLowerCase() === 'a') {
        Object.defineProperty(element, 'download', {
          configurable: true,
          get() {
            return downloadFileName;
          },
          set(value: string) {
            downloadFileName = value;
          },
        });
        Object.defineProperty(element, 'click', {
          configurable: true,
          value: linkClickMock,
        });
      }
      return element;
    });

    const exportButton = container?.querySelector('[data-testid="export"]');

    flushSync(() => {
      exportButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(writeBufferMock).not.toHaveBeenCalled();
    expect(container?.querySelector('[role="dialog"]')?.textContent).toContain('Choose whether to export just the current route or the entire draft');
    expect(container?.querySelector('[role="dialog"]')?.textContent).toContain('Export 2 routes across the full loaded system draft');

    clickButtonByText('Current route');
    await flushPromises();
    await flushPromises();

    expect(writeBufferMock).toHaveBeenCalledTimes(1);
    expect(createObjectUrlMock).toHaveBeenCalledTimes(1);
    expect(linkClickMock).toHaveBeenCalledTimes(1);
    expect(downloadFileName).toBe('Route 10 Weekday Draft - Route 10 - Weekday.xlsx');
    expect(workbookSheetsMock[0]).toEqual([
      'Service Hours Summary',
      '10 (Weekday)',
    ]);
    expect(workbookSheetRowsMock[0][1]?.rows[2]).toEqual(expect.arrayContaining([
      'Block',
      'North Stop 1',
      'North Stop 2',
      'South Stop 1',
      'South Stop 2',
      'Travel',
      'Recovery',
      'Cycle',
      'Ratio',
    ]));
    createElementSpy.mockRestore();
  });

  it('exports all loaded routes when that option is selected', async () => {
    renderEditor({
      draftName: 'Boxing Day',
      schedules: schedules.slice(0, 2) as any,
      exportScopeSchedules: schedules as any,
    });
    await flushPromises();

    const originalCreateElement = document.createElement.bind(document);
    let downloadFileName = '';
    const createElementSpy = vi.spyOn(document, 'createElement').mockImplementation((tagName: string) => {
      const element = originalCreateElement(tagName);
      if (tagName.toLowerCase() === 'a') {
        Object.defineProperty(element, 'download', {
          configurable: true,
          get() {
            return downloadFileName;
          },
          set(value: string) {
            downloadFileName = value;
          },
        });
        Object.defineProperty(element, 'click', {
          configurable: true,
          value: linkClickMock,
        });
      }
      return element;
    });

    const exportButton = container?.querySelector('[data-testid="export"]');

    flushSync(() => {
      exportButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    clickButtonByText('All routes in system draft');
    await flushPromises();
    await flushPromises();

    expect(writeBufferMock).toHaveBeenCalledTimes(1);
    expect(downloadFileName).toBe('Boxing Day.xlsx');
    expect(workbookSheetsMock[0]).toEqual([
      'Service Hours Summary',
      '10 (Weekday)',
      '8 (Weekday)',
    ]);
    createElementSpy.mockRestore();
  });
});
