import React, { useEffect, useMemo, useState } from 'react';
import { WorkspaceHeader } from '../layout/WorkspaceHeader';
import { RoundTripTableView } from '../schedule/RoundTripTableView';
import { TimelineView } from '../NewSchedule/TimelineView';
import { TravelTimeGrid } from '../TravelTimeGrid';
import type { ConnectionLibrary } from '../../utils/connections/connectionTypes';
import {
  buildRoundTripView,
  type DayType,
  type MasterRouteTable
} from '../../utils/parsers/masterScheduleParser';
import { extractDirectionFromName, parseRouteInfo } from '../../utils/config/routeDirectionConfig';
import type { AddTripPlacement } from '../../utils/schedule/addTripPlanner';

type PreviewSubView = 'editor' | 'matrix' | 'timeline';

interface PreviewRouteGroup {
  name: string;
  days: Record<string, {
    north?: MasterRouteTable;
    south?: MasterRouteTable;
    combined?: ReturnType<typeof buildRoundTripView>;
  }>;
}

interface Props {
  schedules: MasterRouteTable[];
  initialRouteGroupName: string;
  initialDay: DayType;
  connectionLibrary?: ConnectionLibrary | null;
  highlightedTripId?: string | null;
  onChooseInsertion?: (tripId: string, placement: AddTripPlacement) => void;
  selectedInsertionTripId?: string | null;
  selectedInsertionPlacement?: AddTripPlacement;
}

const getTrueBaseRoute = (routeName: string): string => {
  const stripped = routeName
    .replace(/\s*\((North|South)\)/gi, '')
    .replace(/\s*\((Weekday|Saturday|Sunday)\)/gi, '')
    .trim();
  const parsed = parseRouteInfo(stripped);
  return parsed.suffixIsDirection ? parsed.baseRoute : stripped;
};

const buildPreviewRouteGroups = (schedules: MasterRouteTable[]): PreviewRouteGroup[] => {
  const routeGroups: Record<string, PreviewRouteGroup> = {};

  schedules.forEach(table => {
    let dayType = 'Weekday';
    if (table.routeName.includes('(Saturday)')) dayType = 'Saturday';
    else if (table.routeName.includes('(Sunday)')) dayType = 'Sunday';

    const baseName = getTrueBaseRoute(table.routeName);
    const stripped = table.routeName
      .replace(/\s*\((North|South)\)/gi, '')
      .replace(/\s*\((Weekday|Saturday|Sunday)\)/gi, '')
      .trim();
    const parsed = parseRouteInfo(stripped);

    if (!routeGroups[baseName]) routeGroups[baseName] = { name: baseName, days: {} };
    if (!routeGroups[baseName].days[dayType]) routeGroups[baseName].days[dayType] = {};

    const dayGroup = routeGroups[baseName].days[dayType];

    let tableDirection = extractDirectionFromName(table.routeName);
    if (!tableDirection && parsed.suffixIsDirection) {
      tableDirection = parsed.direction;
    }

    if (tableDirection === 'North') dayGroup.north = table;
    else if (tableDirection === 'South') dayGroup.south = table;
    else dayGroup.north = table;
  });

  return Object.values(routeGroups)
    .map(group => {
      Object.keys(group.days).forEach(day => {
        const dayGroup = group.days[day];
        if (dayGroup.north && dayGroup.south) {
          dayGroup.combined = buildRoundTripView(dayGroup.north, dayGroup.south);
        }
      });
      return group;
    })
    .sort((a, b) => {
      const numA = parseInt(a.name.replace(/\D/g, ''), 10) || 0;
      const numB = parseInt(b.name.replace(/\D/g, ''), 10) || 0;
      return numB - numA;
    });
};

export const AddTripSchedulePreview: React.FC<Props> = ({
  schedules,
  initialRouteGroupName,
  initialDay,
  connectionLibrary,
  highlightedTripId,
  onChooseInsertion,
  selectedInsertionTripId,
  selectedInsertionPlacement
}) => {
  const [subView, setSubView] = useState<PreviewSubView>('editor');
  const routeGroups = useMemo(() => buildPreviewRouteGroups(schedules), [schedules]);
  const [activeDay, setActiveDay] = useState<DayType>(initialDay);

  useEffect(() => {
    setActiveDay(initialDay);
  }, [initialDay]);

  const activeRouteGroup = useMemo(() => {
    const exact = routeGroups.find(group => group.name === initialRouteGroupName);
    return exact ?? routeGroups[0] ?? null;
  }, [initialRouteGroupName, routeGroups]);
  const availableDays = activeRouteGroup
    ? (['Weekday', 'Saturday', 'Sunday'] as DayType[]).filter(day => Object.keys(activeRouteGroup.days).includes(day))
    : [];

  useEffect(() => {
    if (!activeRouteGroup) return;
    if (!availableDays.includes(activeDay)) {
      setActiveDay((availableDays[0] ?? 'Weekday') as DayType);
    }
  }, [activeDay, activeRouteGroup, availableDays]);

  const activeRoute = activeRouteGroup?.days[activeDay] ?? null;
  const visibleSchedules = useMemo(
    () => [activeRoute?.north, activeRoute?.south].filter((table): table is MasterRouteTable => !!table),
    [activeRoute]
  );

  const summaryTable = useMemo<MasterRouteTable>(() => ({
    routeName: activeRouteGroup ? `${activeRouteGroup.name} (${activeDay})` : 'Preview Schedule',
    trips: visibleSchedules.flatMap(table => table.trips),
    stops: [],
    stopIds: {}
  }), [activeDay, activeRouteGroup, visibleSchedules]);

  const activeDayLabel = activeDay;
  const highlightInCurrentView = highlightedTripId && visibleSchedules.some(table => table.trips.some(trip => trip.id === highlightedTripId))
    ? highlightedTripId
    : null;
  const visibleTripsInOrder = useMemo(
    () => visibleSchedules.flatMap(table => table.trips)
      .sort((a, b) => a.startTime - b.startTime),
    [visibleSchedules]
  );
  const firstVisibleTripId = visibleTripsInOrder[0]?.id ?? null;
  const lastVisibleTripId = visibleTripsInOrder[visibleTripsInOrder.length - 1]?.id ?? null;
  const insertionLabel = selectedInsertionPlacement === 'before'
    ? 'Insert before the first visible trip'
    : selectedInsertionPlacement === 'after' && selectedInsertionTripId
      ? 'Insert after the selected row'
      : 'Insert after the last visible trip';

  return (
    <div className="h-full min-h-0 rounded-2xl border border-slate-200 bg-gray-50 overflow-hidden shadow-inner">
      {activeRouteGroup ? (
        <div className="h-full flex flex-col overflow-hidden">
          <WorkspaceHeader
            routeGroupName={activeRouteGroup.name}
            dayLabel={activeDayLabel}
            isRoundTrip={!!activeRoute?.combined}
            subView={subView}
            onViewChange={setSubView}
            onSaveVersion={() => {}}
            autoSaveStatus="idle"
            lastSaved={null}
            hasUnsavedChanges
            summaryTable={summaryTable}
            draftName="Preview Schedule"
            hideAutoSave
            hideRouteIdentity
          />

          <div className="flex-1 min-h-0 overflow-hidden">
            <div className="h-full min-w-0 overflow-auto p-3 md:p-4">
              {onChooseInsertion && visibleTripsInOrder.length > 0 && (
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Add new trip</span>
                  <button
                    type="button"
                    onClick={() => firstVisibleTripId && onChooseInsertion(firstVisibleTripId, 'before')}
                    className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
                      selectedInsertionTripId === firstVisibleTripId && selectedInsertionPlacement === 'before'
                        ? 'border-blue-300 bg-blue-50 text-blue-700'
                        : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    + Above first row
                  </button>
                  <button
                    type="button"
                    onClick={() => lastVisibleTripId && onChooseInsertion(lastVisibleTripId, 'after')}
                    className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
                      selectedInsertionTripId === lastVisibleTripId && selectedInsertionPlacement === 'after'
                        ? 'border-blue-300 bg-blue-50 text-blue-700'
                        : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    + Below last row
                  </button>
                  <span className="text-xs text-slate-500">
                    Use the row <span className="font-semibold">+</span> buttons in the table to insert between trips.
                  </span>
                </div>
              )}
              {visibleSchedules.length === 0 ? (
                <div className="h-full rounded-xl border border-dashed border-gray-300 bg-white grid place-items-center text-sm text-gray-500">
                  No preview is available for this route/day yet.
                </div>
              ) : subView === 'timeline' ? (
                <TimelineView schedules={visibleSchedules} selectedTripId={highlightInCurrentView} />
              ) : subView === 'matrix' ? (
                <TravelTimeGrid schedules={visibleSchedules} />
              ) : (
                <div className="space-y-2">
                  {onChooseInsertion && (
                    <div className="rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-xs text-blue-800">
                      <span className="font-semibold">Insertion point:</span> {insertionLabel}
                    </div>
                  )}
                  <RoundTripTableView
                    schedules={visibleSchedules}
                    readOnly
                    connectionLibrary={connectionLibrary}
                    dayType={activeDay}
                    highlightedTripId={highlightInCurrentView}
                    onAddTrip={onChooseInsertion ? (tripId) => onChooseInsertion(tripId, 'after') : undefined}
                  />
                </div>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="h-full grid place-items-center bg-white text-sm text-gray-500">
          No schedule preview available.
        </div>
      )}
    </div>
  );
};
