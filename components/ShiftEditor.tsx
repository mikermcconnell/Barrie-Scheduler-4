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

      <div className="space-y-4 max-h-[600px] overflow-y-auto pr-2 custom-scrollbar">
        {sortedShifts.map(shift => {
          const isAI = shift.id.includes('gemini');
          return (
            <div
              key={shift.id}
              onClick={() => onEditShift && onEditShift(shift.id)}
              className={`group relative bg-gray-50 hover: bg-white rounded-2xl border-2 ${isAI ? 'border-purple-100' : 'border-gray-100'} hover: border-brand-blue transition-all p-4 flex flex-col md: flex-row gap-4 items-center justify-between cursor-pointer`}
            >

              {/* Driver Info */}
              <div className="flex items-center gap-3 w-full md:w-1/4">
                <div className={`p-3 rounded-xl ${shift.zone === Zone.FLOATER ? 'bg-purple-100 text-purple-600' : 'bg-gray-200 text-gray-500'}`}>
                  {isAI ? <Sparkles size={20} /> : <User size={20} />}
                </div>
                <div>
                  <input
                    type="text"
                    value={shift.driverName}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => onUpdateShift({ ...shift, driverName: e.target.value })}
                    className="font-extrabold text-gray-700 bg-transparent border-b border-transparent hover:border-gray-300 focus:border-brand-blue focus:outline-none w-full"
                  />
                  <div className="flex items-center gap-2">
                    <span className={`text-[10px]font-bold uppercase px-1.5 py-0.5 rounded-md ${shift.zone === Zone.NORTH ? 'bg-blue-100 text-blue-600' :
                      shift.zone === Zone.SOUTH ? 'bg-green-100 text-green-600' :
                        'bg-purple-100 text-purple-600'
                      }`}>
                      {shift.zone}
                    </span>
                    {isAI && <span className="text-[10px] font-bold text-white bg-purple-400 px-1.5 py-0.5 rounded-full">AI</span>}
                  </div>
                </div>
              </div>

              {/* Time Controls */}
              <div className="flex items-center gap-6 w-full md:w-2/4 justify-center bg-white p-2 rounded-xl border border-gray-100 shadow-sm">

                {/* Start Time */}
                <div className="flex flex-col items-center">
                  <span className="text-[10px] font-bold text-gray-400 uppercase mb-1">Start</span>
                  <div className="flex items-center gap-2">
                    <button onClick={(e) => handleTimeChange(e, shift, 'startSlot', -1)} className="w-6 h-6 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center text-gray-600">
                      <Minus size={12} strokeWidth={4} />
                    </button>
                    <span className="font-mono font-bold text-lg text-gray-800 w-12 text-center">
                      {formatSlotToTime(shift.startSlot)}
                    </span>
                    <button onClick={(e) => handleTimeChange(e, shift, 'startSlot', 1)} className="w-6 h-6 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center text-gray-600">
                      <Plus size={12} strokeWidth={4} />
                    </button>
                  </div>
                </div>

                <div className="h-8 w-px bg-gray-200"></div>

                {/* End Time */}
                <div className="flex flex-col items-center">
                  <span className="text-[10px] font-bold text-gray-400 uppercase mb-1">End</span>
                  <div className="flex items-center gap-2">
                    <button onClick={(e) => handleTimeChange(e, shift, 'endSlot', -1)} className="w-6 h-6 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center text-gray-600">
                      <Minus size={12} strokeWidth={4} />
                    </button>
                    <span className="font-mono font-bold text-lg text-gray-800 w-12 text-center">
                      {formatSlotToTime(shift.endSlot)}
                    </span>
                    <button onClick={(e) => handleTimeChange(e, shift, 'endSlot', 1)} className="w-6 h-6 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center text-gray-600">
                      <Plus size={12} strokeWidth={4} />
                    </button>
                  </div>
                </div>
              </div>

              {/* Break Control */}
              <div className="flex flex-col items-center justify-center w-full md:w-1/4">
                <div className="flex items-center gap-2 mb-1">
                  <Coffee size={14} className="text-orange-400" />
                  <span className="text-[10px] font-bold text-orange-400 uppercase">Break @</span>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={(e) => handleTimeChange(e, shift, 'breakStartSlot', -1)} className="w-6 h-6 rounded-full bg-orange-50 hover:bg-orange-100 flex items-center justify-center text-orange-500">
                    <Minus size={12} strokeWidth={4} />
                  </button>
                  <span className="font-mono font-bold text-md text-gray-600 w-12 text-center">
                    {formatSlotToTime(shift.breakStartSlot)}
                  </span>
                  <button onClick={(e) => handleTimeChange(e, shift, 'breakStartSlot', 1)} className="w-6 h-6 rounded-full bg-orange-50 hover:bg-orange-100 flex items-center justify-center text-orange-500">
                    <Plus size={12} strokeWidth={4} />
                  </button>
                </div>
              </div>

              {/* Actions */}
              <div className="flex flex-col gap-2 absolute -right-2 top-2">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeleteShift(shift.id);
                  }}
                  className="bg-white text-gray-400 hover:text-red-500 hover:bg-red-50 p-2 rounded-full border border-gray-200 shadow-sm transition-colors"
                  title="Delete Shift"
                >
                  <Trash2 size={16} />
                </button>
              </div>

            </div>
          )
        })}

        {sortedShifts.length === 0 && (
          <div className="text-center py-10 text-gray-400">
            <p>No {zoneFilter !== 'All' ? zoneFilter : ''} shifts found.</p>
          </div>
        )}
      </div>
    </div>
  );
};