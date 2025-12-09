import React from 'react';
import { Shift, Zone, SummaryMetrics, ZoneFilterType } from '../types';
import { formatSlotToTime } from '../utils/dataGenerator';
import { Coffee, Trash2, Plus, Clock, ChevronRight } from 'lucide-react';
import { TIME_SLOTS_PER_DAY } from '../constants';
import { SummaryCards } from './SummaryCards';

interface Props {
  shifts: Shift[];
  onUpdateShift: (updatedShift: Shift) => void;
  onDeleteShift: (id: string) => void;
  onAddShift: () => void;
  onEditShift?: (id: string) => void;
  zoneFilter: ZoneFilterType;
  onZoneFilterChange: (filter: ZoneFilterType) => void;
  metrics: SummaryMetrics;
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
  onUpdateShift,
  onDeleteShift,
  onAddShift,
  onEditShift,
  zoneFilter,
  onZoneFilterChange,
  metrics
}) => {

  const filteredShifts = shifts.filter(s => {
    if (zoneFilter === 'All') return true;
    return s.zone === zoneFilter;
  });

  const sortedShifts = [...filteredShifts].sort((a, b) => a.startSlot - b.startSlot);

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
          <p className="text-gray-400 font-bold text-sm">Tap a driver to edit their shift</p>
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

      {/* Shift Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {sortedShifts.map((shift) => {
          const styles = getZoneStyles(shift.zone);
          const hours = ((shift.endSlot - shift.startSlot) / 4).toFixed(1);
          const hasBreak = shift.breakDurationSlots > 0;

          return (
            <div
              key={shift.id}
              onClick={() => onEditShift?.(shift.id)}
              className={`group relative bg-white rounded-2xl border-2 ${styles.border} p-4 hover:shadow-lg hover:-translate-y-1 transition-all cursor-pointer overflow-hidden`}
            >
              {/* Zone Background Accent */}
              <div className={`absolute top-0 left-0 w-full h-1 ${styles.bg}`} />

              <div className="flex items-start gap-3">
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
                    <span>{formatSlotToTime(shift.startSlot)} - {formatSlotToTime(shift.endSlot)}</span>
                    <span className="bg-gray-100 px-2 py-0.5 rounded-lg text-xs">{hours}h</span>
                  </div>

                  {/* Break Indicator */}
                  {hasBreak && (
                    <div className="flex items-center gap-1.5 mt-2 text-orange-500 text-xs font-bold">
                      <Coffee size={12} />
                      <span>Break at {formatSlotToTime(shift.breakStartSlot)}</span>
                    </div>
                  )}
                </div>

                {/* Edit Arrow */}
                <ChevronRight size={20} className="text-gray-300 group-hover:text-gray-500 group-hover:translate-x-1 transition-all" />
              </div>

              {/* Delete Button - appears on hover */}
              <button
                onClick={(e) => { e.stopPropagation(); onDeleteShift(shift.id); }}
                className="absolute top-2 left-2 p-2 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded-xl transition-all opacity-0 group-hover:opacity-100 z-20"
              >
                <Trash2 size={16} />
              </button>
            </div>
          );
        })}
      </div>

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