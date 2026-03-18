import React from 'react';
import { Shift, Zone, SummaryMetrics, ZoneFilterType, type OnDemandChangeoffSettings } from '../utils/demandTypes';
import { formatSlotToTime } from '../utils/dataGenerator';
import { Coffee, Trash2, Plus, Clock, ChevronRight, LayoutGrid, List, ArrowRightLeft } from 'lucide-react';
import { SummaryCards } from './SummaryCards';
import { buildShiftHandoffMap, buildShiftServiceWindowMap, type ShiftHandoffLinks } from '../utils/onDemandHandoffs';

interface Props {
  shifts: Shift[];
  onUpdateShift: (updatedShift: Shift) => void;
  onDeleteShift: (id: string) => void;
  onAddShift: () => void;
  onEditShift?: (id: string) => void;
  zoneFilter: ZoneFilterType;
  onZoneFilterChange: (filter: ZoneFilterType) => void;
  metrics: SummaryMetrics;
  changeoffSettings?: Partial<OnDemandChangeoffSettings>;
}

// Helper to get zone colors
const getZoneStyles = (zone: Zone) => {
  switch (zone) {
    case Zone.NORTH:
      return { bg: 'bg-blue-500', light: 'bg-blue-50', text: 'text-blue-600', border: 'border-blue-200' };
    case Zone.SOUTH:
      return { bg: 'bg-green-500', light: 'bg-green-50', text: 'text-green-600', border: 'border-green-200' };
    case Zone.FLOATER:
      return { bg: 'bg-purple-500', light: 'bg-purple-50', text: 'text-purple-600', border: 'border-purple-200' };
  }
};

export const ShiftEditor: React.FC<Props> = ({
  shifts,
  onUpdateShift: _onUpdateShift,
  onDeleteShift,
  onAddShift,
  onEditShift,
  zoneFilter,
  onZoneFilterChange,
  metrics,
  changeoffSettings,
}) => {
  const [viewMode, setViewMode] = React.useState<'grid' | 'list'>('grid');
  const handoffMap = React.useMemo(() => buildShiftHandoffMap(shifts), [shifts]);
  const shiftNameMap = React.useMemo(
    () => new Map(shifts.map((shift) => [shift.id, shift.driverName])),
    [shifts],
  );
  const serviceWindowMap = React.useMemo(
    () => buildShiftServiceWindowMap(shifts, changeoffSettings),
    [changeoffSettings, shifts],
  );

  const filteredShifts = shifts.filter(s => {
    if (zoneFilter === 'All') return true;
    return s.zone === zoneFilter;
  });

  const sortedShifts = [...filteredShifts].sort((a, b) => {
    const aServiceWindow = serviceWindowMap.get(a.id);
    const bServiceWindow = serviceWindowMap.get(b.id);
    const aStartSlot = aServiceWindow?.serviceStartSlot ?? a.startSlot;
    const bStartSlot = bServiceWindow?.serviceStartSlot ?? b.startSlot;

    if (aStartSlot !== bStartSlot) {
      return aStartSlot - bStartSlot;
    }

    return a.driverName.localeCompare(b.driverName, undefined, { numeric: true, sensitivity: 'base' });
  });

  const getShiftHandoffSummaries = React.useCallback((shift: Shift, handoffLinks?: ShiftHandoffLinks) => {
    const summaries: string[] = [];
    const handoffFromName = shift.handoffFromShiftId ? shiftNameMap.get(shift.handoffFromShiftId) : undefined;
    const handoffToName = shift.handoffToShiftId ? shiftNameMap.get(shift.handoffToShiftId) : undefined;
    const inferredInboundNames = (handoffLinks?.inbound ?? []).map((candidate) => candidate.driverName).join(', ');
    const inferredOutboundNames = (handoffLinks?.outbound ?? []).map((candidate) => candidate.driverName).join(', ');

    if (handoffFromName) {
      summaries.push(`From ${handoffFromName} at ${formatSlotToTime(shift.startSlot)}`);
    } else if (inferredInboundNames) {
      summaries.push(`From ${inferredInboundNames} at ${formatSlotToTime(shift.startSlot)}`);
    }

    if (handoffToName) {
      summaries.push(`To ${handoffToName} at ${formatSlotToTime(shift.endSlot)}`);
    } else if (inferredOutboundNames) {
      summaries.push(`To ${inferredOutboundNames} at ${formatSlotToTime(shift.endSlot)}`);
    }

    return summaries;
  }, [shiftNameMap]);

  return (
    <div className="bg-white rounded-3xl border-2 border-gray-200 p-6 shadow-sm">
      <div className="mb-6">
        <SummaryCards metrics={metrics} />
      </div>

      <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-4">
        <div>
          <h2 className="text-2xl font-extrabold text-gray-700 flex items-center gap-2">
            👥 Driver Roster
          </h2>
          <p className="text-gray-400 font-bold text-sm">Manage your team assignments</p>
        </div>

        <div className="flex items-center gap-4">
          {/* View Toggle */}
          <div className="flex bg-gray-100 p-1 rounded-xl">
            <button
              onClick={() => setViewMode('grid')}
              className={`p-2 rounded-lg transition-all ${viewMode === 'grid' ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}
              title="Grid View"
            >
              <LayoutGrid size={18} />
            </button>
            <button
              onClick={() => setViewMode('list')}
              className={`p-2 rounded-lg transition-all ${viewMode === 'list' ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}
              title="List View"
            >
              <List size={18} />
            </button>
          </div>

          {/* Zone Filter Pills */}
          <div className="flex items-center gap-1 bg-gray-100 p-1 rounded-2xl">
            {(['All', 'North', 'South', 'Floater'] as ZoneFilterType[]).map((zone) => (
              <button
                key={zone}
                onClick={() => onZoneFilterChange(zone)}
                className={`px-4 py-2 rounded-xl text-sm font-bold transition-all ${zoneFilter === zone
                  ? 'bg-white text-gray-800 shadow-md border-b-2 border-gray-300'
                  : 'text-gray-500 hover:text-gray-700'
                  }`}
              >
                {zone === 'North' && '🔵 '}
                {zone === 'South' && '🟢 '}
                {zone === 'Floater' && '🟣 '}
                {zone}
              </button>
            ))}
          </div>

          <button
            onClick={onAddShift}
            className="bg-brand-green text-white px-5 py-3 rounded-2xl font-bold border-b-4 border-green-700 hover:brightness-110 active:translate-y-1 active:border-b-2 flex items-center gap-2 transition-all shadow-lg"
          >
            <Plus size={20} strokeWidth={3} />
            Add Driver
          </button>
        </div>
      </div>

      {viewMode === 'grid' ? (
        /* Shift Cards Grid */
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {sortedShifts.map((shift) => {
            const styles = getZoneStyles(shift.zone);
            const hasBreak = shift.breakDurationSlots > 0;
            const handoffLinks = handoffMap.get(shift.id);
            const serviceWindow = serviceWindowMap.get(shift.id);
            const displayStartSlot = serviceWindow?.serviceStartSlot ?? shift.startSlot;
            const displayEndSlot = serviceWindow?.serviceEndSlot ?? shift.endSlot;
            const drivingHours = ((displayEndSlot - displayStartSlot) / 4).toFixed(1);
            const handoffSummaries = getShiftHandoffSummaries(shift, handoffLinks);

            return (
              <div
                key={shift.id}
                onClick={() => onEditShift?.(shift.id)}
                className={`group relative bg-white rounded-2xl border-2 ${styles.border} p-4 hover:shadow-lg hover:-translate-y-1 transition-all cursor-pointer overflow-hidden`}
              >
                {/* Zone Background Accent */}
                <div className={`absolute top-0 left-0 w-full h-1 ${styles.bg}`} />

                <button
                  type="button"
                  aria-label={`Delete ${shift.driverName} shift`}
                  title={`Delete ${shift.driverName} shift`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeleteShift(shift.id);
                  }}
                  className="absolute top-3 right-3 inline-flex items-center gap-1 rounded-xl border border-red-200 bg-white/95 px-2.5 py-1.5 text-xs font-bold text-red-600 shadow-sm transition-colors hover:bg-red-50"
                >
                  <Trash2 size={14} />
                  <span>Delete</span>
                </button>

                <div className="flex items-start gap-3 pr-20">
                  {/* Driver Avatar */}
                  <div className={`w-12 h-12 rounded-xl ${styles.bg} flex items-center justify-center text-white font-extrabold text-lg shadow-md`}>
                    {shift.driverName.charAt(0)}
                  </div>

                  <div className="flex-1 min-w-0">
                    {/* Name & Zone */}
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="font-extrabold text-gray-800 truncate">{shift.driverName}</h3>
                      <span className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded-lg ${styles.light} ${styles.text}`}>
                        {shift.zone}
                      </span>
                    </div>

                    {/* Time & Duration */}
                    <div className="flex items-center gap-2 text-sm text-gray-500 font-bold">
                      <Clock size={14} />
                      <span>{formatSlotToTime(displayStartSlot)} - {formatSlotToTime(displayEndSlot)}</span>
                      <span className="bg-gray-100 px-2 py-0.5 rounded-lg text-xs">{drivingHours}h</span>
                    </div>

                    {/* Break Indicator */}
                    {hasBreak && (
                      <div className="flex items-center gap-1.5 mt-2 text-orange-500 text-xs font-bold">
                        <Coffee size={12} />
                        <span>Break at {formatSlotToTime(shift.breakStartSlot)}</span>
                      </div>
                    )}

                    {handoffSummaries.length > 0 && (
                      <div className="mt-3 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-[11px] font-semibold text-gray-600">
                        <div className="mb-1 flex items-center gap-1.5 text-gray-500">
                          <ArrowRightLeft size={12} />
                          <span>Shift Handoff</span>
                        </div>
                        {handoffSummaries.map((summary) => (
                          <div key={summary}>{summary}</div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Edit Arrow */}
                  <ChevronRight size={20} className="text-gray-300 group-hover:text-gray-500 group-hover:translate-x-1 transition-all" />
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        /* List View */
        <div className="overflow-hidden rounded-xl border-2 border-gray-100">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th scope="col" className="px-6 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">Driver</th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">Zone</th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">Shift Time</th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">Break</th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">Shift Handoff</th>
                <th scope="col" className="px-6 py-3 text-right text-xs font-bold text-gray-500 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {sortedShifts.map((shift) => {
                const styles = getZoneStyles(shift.zone);
                const hasBreak = shift.breakDurationSlots > 0;
                const handoffLinks = handoffMap.get(shift.id);
                const serviceWindow = serviceWindowMap.get(shift.id);
                const displayStartSlot = serviceWindow?.serviceStartSlot ?? shift.startSlot;
                const displayEndSlot = serviceWindow?.serviceEndSlot ?? shift.endSlot;
                const drivingHours = ((displayEndSlot - displayStartSlot) / 4).toFixed(1);
                const handoffSummaries = getShiftHandoffSummaries(shift, handoffLinks);
                const handoffText = handoffSummaries.join(' | ');

                return (
                  <tr key={shift.id} className="hover:bg-gray-50 transition-colors cursor-pointer" onClick={() => onEditShift?.(shift.id)}>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center">
                        <div className={`flex-shrink-0 h-8 w-8 rounded-full ${styles.bg} flex items-center justify-center text-white font-bold text-xs`}>
                          {shift.driverName.charAt(0)}
                        </div>
                        <div className="ml-4">
                          <div className="text-sm font-bold text-gray-900">{shift.driverName}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`px-2 py-1 inline-flex text-xs leading-5 font-bold rounded-full ${styles.light} ${styles.text}`}>
                        {shift.zone}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm text-gray-900 font-medium">
                        {formatSlotToTime(displayStartSlot)} - {formatSlotToTime(displayEndSlot)}
                      </div>
                      <div className="text-xs text-gray-400">
                        {drivingHours} driving hours
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      {hasBreak ? (
                        <div className="flex items-center text-sm text-orange-500 font-medium">
                          <Coffee size={14} className="mr-1.5" />
                          {formatSlotToTime(shift.breakStartSlot)}
                        </div>
                      ) : (
                        <span className="text-gray-400 text-xs">-</span>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      {handoffText ? (
                        <div className="max-w-md text-xs font-semibold text-gray-600">
                          {handoffText}
                        </div>
                      ) : (
                        <span className="text-gray-300 text-xs">No handoff</span>
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                      <button
                        onClick={(e) => { e.stopPropagation(); onDeleteShift(shift.id); }}
                        className="text-gray-400 hover:text-red-600 transition-colors p-2 hover:bg-red-50 rounded-lg"
                      >
                        <Trash2 size={18} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Empty State */}
      {sortedShifts.length === 0 && (
        <div className="text-center py-16 bg-gray-50 rounded-2xl border-2 border-dashed border-gray-200">
          <div className="text-5xl mb-4">🚌</div>
          <h3 className="text-xl font-extrabold text-gray-600 mb-2">No drivers yet!</h3>
          <p className="text-gray-400 font-medium mb-4">
            {zoneFilter === 'All'
              ? "Add your first driver to get started"
              : `No drivers in ${zoneFilter} zone`}
          </p>
          <button
            onClick={onAddShift}
            className="bg-brand-green text-white px-6 py-3 rounded-2xl font-bold border-b-4 border-green-700 hover:brightness-110 inline-flex items-center gap-2 transition-all"
          >
            <Plus size={18} strokeWidth={3} />
            Add First Driver
          </button>
        </div>
      )}
    </div>
  );
};
