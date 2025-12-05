import React from 'react';
import { Shift, Zone, SummaryMetrics } from '../types';
import { formatSlotToTime } from '../utils/dataGenerator';
import { Coffee, Trash2, Plus, Minus, User, Sparkles, MapPin } from 'lucide-react';
import { TIME_SLOTS_PER_DAY } from '../constants';
import { ZoneFilterType } from './OnDemandWorkspace';
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

  // Filter Shifts based on Active Zone Filter
  const filteredShifts = shifts.filter(s => {
    if (zoneFilter === 'All') return true;
    return s.zone === zoneFilter;
  });

  // Sort shifts by start time
  const sortedShifts = [...filteredShifts].sort((a, b) => a.startSlot - b.startSlot);

  const handleTimeChange = (e: React.MouseEvent, shift: Shift, field: 'startSlot' | 'endSlot' | 'breakStartSlot', delta: number) => {
    e.stopPropagation(); // Prevent opening modal
    const updated = { ...shift, [field]: shift[field] + delta };

    // Bounds Validation
    if (updated.startSlot < 0) updated.startSlot = 0;
    if (updated.endSlot > TIME_SLOTS_PER_DAY) updated.endSlot = TIME_SLOTS_PER_DAY;

    // Prevent shift from being inverted or too short (min 1 hour)
    if (field === 'startSlot' && updated.startSlot >= updated.endSlot - 4) return;
    if (field === 'endSlot' && updated.endSlot <= updated.startSlot + 4) return;

    // Ensure break is inside shift
    // If Start moves past Break, push Break
    if (field === 'startSlot' && updated.breakStartSlot <= updated.startSlot) {
      updated.breakStartSlot = updated.startSlot + 4; // Default break 1 hour in if pushed
    }
    // If Break moves outside bounds
    if (field === 'breakStartSlot') {
      if (updated.breakStartSlot < updated.startSlot) updated.breakStartSlot = updated.startSlot;
      if (updated.breakStartSlot > updated.endSlot - updated.breakDurationSlots) {
        updated.breakStartSlot = updated.endSlot - updated.breakDurationSlots;
      }
    }

    onUpdateShift(updated);
  };

  return (
    <div className="bg-white rounded-3xl border-2 border-gray-200 p-6 shadow-sm">
      <div className="mb-6">
        <SummaryCards metrics={metrics} />
      </div>

      <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-4">
        <div>
          <h2 className="text-2xl font-extrabold text-gray-700">Driver Roster</h2>
          <p className="text-gray-400 font-bold text-sm">Real-time Shift Adjustments</p>
        </div>

        <div className="flex items-center gap-2 bg-gray-100 p-1 rounded-xl">
          <button
            onClick={() => onZoneFilterChange('All')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${zoneFilter === 'All' ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
          >
            All
          </button>
          <button
            onClick={() => onZoneFilterChange('North')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${zoneFilter === 'North' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
          >
            North
          </button>
          <button
            onClick={() => onZoneFilterChange('South')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${zoneFilter === 'South' ? 'bg-white text-green-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
          >
            South
          </button>
          <button
            onClick={() => onZoneFilterChange('Floater')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${zoneFilter === 'Floater' ? 'bg-white text-purple-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
          >
            Floater
          </button>
        </div>

        <button
          onClick={onAddShift}
          className="btn-bouncy bg-brand-green text-white px-4 py-2 rounded-xl font-bold border-b-4 border-brand-greenDark hover:brightness-110 flex items-center gap-2"
        >
          <Plus size={20} /> Add Driver
        </button>
      </div>
      <div className="space-y-2">
        {sortedShifts.map((shift) => (
          <div
            key={shift.id}
            onClick={() => onEditShift?.(shift.id)}
            className="group bg-white border border-gray-100 p-3 rounded-2xl flex items-center gap-4 hover:shadow-md hover:border-blue-200 transition-all cursor-pointer"
          >
            {/* Zone Stripe */}
            <div className={`w-1 self-stretch rounded-full ${shift.zone === 'North' ? 'bg-blue-500' :
                shift.zone === 'South' ? 'bg-green-500' :
                  'bg-purple-500'
              }`} />

            {/* Info */}
            <div className="flex-1">
              <div className="flex items-center gap-3 mb-0.5">
                <h3 className="font-bold text-gray-800 text-sm">{shift.driverName}</h3>
                <span className={`text-[10px] uppercase font-bold px-1.5 py-0.5 rounded-md ${shift.zone === 'North' ? 'bg-blue-50 text-blue-700' :
                    shift.zone === 'South' ? 'bg-green-50 text-green-700' :
                      'bg-purple-50 text-purple-700'
                  }`}>
                  {shift.zone}
                </span>
              </div>
              <div className="flex items-center gap-3 text-xs font-medium text-gray-400">
                <span>{formatSlotToTime(shift.startSlot)} - {formatSlotToTime(shift.endSlot)}</span>
                <span className="text-gray-300">•</span>
                <span>{((shift.endSlot - shift.startSlot) / 4).toFixed(1)}h</span>
              </div>
            </div>

            {/* Delete Action */}
            <button
              onClick={(e) => { e.stopPropagation(); onDeleteShift(shift.id); }}
              className="p-2 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors opacity-0 group-hover:opacity-100"
            >
              <Trash2 size={16} />
            </button>
          </div>
        ))}

        {sortedShifts.length === 0 && (
          <div className="text-center py-8 text-gray-400">
            <p className="text-sm">No drivers in this zone.</p>
          </div>
        )}
      </div>
    </div>
  );
};