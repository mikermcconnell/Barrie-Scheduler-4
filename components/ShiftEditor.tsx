import React from 'react';
import { Shift, Zone } from '../types';
import { formatSlotToTime } from '../utils/dataGenerator';
import { Clock, Coffee, Trash2, Plus, Minus, User, Sparkles } from 'lucide-react';
import { TIME_SLOTS_PER_DAY } from '../constants';

interface Props {
  shifts: Shift[];
  onUpdateShift: (updatedShift: Shift) => void;
  onDeleteShift: (id: string) => void;
  onAddShift: () => void;
}

export const ShiftEditor: React.FC<Props> = ({ shifts, onUpdateShift, onDeleteShift, onAddShift }) => {
  
  // Sort shifts by start time
  const sortedShifts = [...shifts].sort((a, b) => a.startSlot - b.startSlot);

  const handleTimeChange = (shift: Shift, field: 'startSlot' | 'endSlot' | 'breakStartSlot', delta: number) => {
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
      <div className="flex justify-between items-center mb-6">
        <div>
          <h2 className="text-2xl font-extrabold text-gray-700">Driver Roster</h2>
          <p className="text-gray-400 font-bold text-sm">Real-time Shift Adjustments</p>
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
          <div key={shift.id} className={`group relative bg-gray-50 hover:bg-white rounded-2xl border-2 ${isAI ? 'border-purple-100' : 'border-gray-100'} hover:border-brand-blue transition-all p-4 flex flex-col md:flex-row gap-4 items-center justify-between`}>
            
            {/* Driver Info */}
            <div className="flex items-center gap-3 w-full md:w-1/4">
              <div className={`p-3 rounded-xl ${shift.zone === Zone.FLOATER ? 'bg-purple-100 text-purple-600' : 'bg-gray-200 text-gray-500'}`}>
                {isAI ? <Sparkles size={20} /> : <User size={20} />}
              </div>
              <div>
                <h4 className="font-extrabold text-gray-700">{shift.driverName}</h4>
                <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-gray-400 uppercase">{shift.zone}</span>
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
                        <button onClick={() => handleTimeChange(shift, 'startSlot', -1)} className="w-6 h-6 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center text-gray-600">
                            <Minus size={12} strokeWidth={4} />
                        </button>
                        <span className="font-mono font-bold text-lg text-gray-800 w-12 text-center">
                            {formatSlotToTime(shift.startSlot)}
                        </span>
                        <button onClick={() => handleTimeChange(shift, 'startSlot', 1)} className="w-6 h-6 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center text-gray-600">
                            <Plus size={12} strokeWidth={4} />
                        </button>
                    </div>
                </div>

                <div className="h-8 w-px bg-gray-200"></div>

                {/* End Time */}
                <div className="flex flex-col items-center">
                    <span className="text-[10px] font-bold text-gray-400 uppercase mb-1">End</span>
                    <div className="flex items-center gap-2">
                        <button onClick={() => handleTimeChange(shift, 'endSlot', -1)} className="w-6 h-6 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center text-gray-600">
                            <Minus size={12} strokeWidth={4} />
                        </button>
                        <span className="font-mono font-bold text-lg text-gray-800 w-12 text-center">
                            {formatSlotToTime(shift.endSlot)}
                        </span>
                        <button onClick={() => handleTimeChange(shift, 'endSlot', 1)} className="w-6 h-6 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center text-gray-600">
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
                        <button onClick={() => handleTimeChange(shift, 'breakStartSlot', -1)} className="w-6 h-6 rounded-full bg-orange-50 hover:bg-orange-100 flex items-center justify-center text-orange-500">
                            <Minus size={12} strokeWidth={4} />
                        </button>
                        <span className="font-mono font-bold text-md text-gray-600 w-12 text-center">
                            {formatSlotToTime(shift.breakStartSlot)}
                        </span>
                        <button onClick={() => handleTimeChange(shift, 'breakStartSlot', 1)} className="w-6 h-6 rounded-full bg-orange-50 hover:bg-orange-100 flex items-center justify-center text-orange-500">
                            <Plus size={12} strokeWidth={4} />
                        </button>
                    </div>
            </div>

            {/* Actions */}
            <button 
                onClick={() => onDeleteShift(shift.id)}
                className="absolute -top-2 -right-2 bg-white text-gray-300 hover:text-red-500 hover:bg-red-50 p-1 rounded-full border border-gray-200 shadow-sm opacity-0 group-hover:opacity-100 transition-opacity"
            >
                <Trash2 size={16} />
            </button>

          </div>
        )})}
        
        {shifts.length === 0 && (
            <div className="text-center py-10 text-gray-400">
                <p>No shifts scheduled. Add a driver to start.</p>
            </div>
        )}
      </div>
    </div>
  );
};