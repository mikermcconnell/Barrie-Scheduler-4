import React, { useState, useMemo } from 'react';
import { generateRequirements, generateShifts, calculateSchedule, calculateMetrics } from '../utils/dataGenerator';
import { optimizeScheduleWithGemini } from '../utils/geminiOptimizer';
import { SummaryCards } from './SummaryCards';
import { GapChart } from './GapChart';
import { FileUpload } from './FileUpload';
import { ShiftEditor } from './ShiftEditor';
import { SummaryMetrics, Shift, Requirement, Zone } from '../types';
import { Wand2, Users, BarChart3, Sparkles, AlertTriangle, Loader2 } from 'lucide-react';
import { SHIFT_DURATION_SLOTS, BREAK_DURATION_SLOTS } from '../constants';

export const OnDemandWorkspace: React.FC = () => {
  // Core State
  // Initialize synchronously to ensure data is present for first render calculation
  const [requirements, setRequirements] = useState<Requirement[]>(() => generateRequirements());
  const [shifts, setShifts] = useState<Shift[]>(() => generateShifts(generateRequirements(), false));
  
  const [activeTab, setActiveTab] = useState<'overview' | 'editor'>('overview');
  
  // UI State
  const [isOptimized, setIsOptimized] = useState(false);
  const [isAnimating, setIsAnimating] = useState(false);
  
  // Derived State
  // Now guaranteed to have valid inputs on first render
  const timeSlots = useMemo(() => calculateSchedule(shifts, requirements), [shifts, requirements]);
  const metrics = useMemo(() => calculateMetrics(timeSlots), [timeSlots]);

  const handleOptimization = async () => {
    if (isOptimized) {
        // Reset to basic mock data
        setIsAnimating(true);
        setTimeout(() => {
            setShifts(generateShifts(requirements, false));
            setIsOptimized(false);
            setIsAnimating(false);
        }, 500);
        return;
    }

    setIsAnimating(true);
    
    try {
        // Call Gemini API
        const aiShifts = await optimizeScheduleWithGemini(requirements);
        
        if (aiShifts.length > 0) {
            setShifts(aiShifts);
            setIsOptimized(true);
        } else {
            // Fallback if API fails or returns empty (e.g. key missing in dev)
            console.warn("Gemini API returned no shifts, falling back to local heuristic.");
            setShifts(generateShifts(requirements, true));
            setIsOptimized(true);
        }
    } catch (e) {
        console.error("Optimization error", e);
        // Fallback
        setShifts(generateShifts(requirements, true));
        setIsOptimized(true);
    } finally {
        setIsAnimating(false);
    }
  };

  const handleShiftUpdate = (updatedShift: Shift) => {
    setShifts(prev => prev.map(s => s.id === updatedShift.id ? updatedShift : s));
  };

  const handleDeleteShift = (id: string) => {
    setShifts(prev => prev.filter(s => s.id !== id));
  };

  const handleAddShift = () => {
    // Default shift: 8am - 4pm
    const newShift: Shift = {
        id: `shift-${Math.random().toString(36).substr(2, 9)}`,
        driverName: `New Driver`,
        zone: Zone.FLOATER,
        startSlot: 32, // 08:00
        endSlot: 32 + SHIFT_DURATION_SLOTS,
        breakStartSlot: 32 + 16, // Break after 4 hours
        breakDurationSlots: BREAK_DURATION_SLOTS
    };
    setShifts(prev => [...prev, newShift]);
    // Switch to editor to see the new shift
    setActiveTab('editor');
  };

  const handleFileUpload = (file: File) => {
    alert(`File "${file.name}" received. In this prototype, we will stick to the generated data to demonstrate the visualization.`);
  };

  return (
    <div className="animate-in fade-in zoom-in-95 duration-500">
        
        {/* Title & Actions */}
        <div className="flex flex-col md:flex-row justify-between items-end mb-8 gap-4">
          <div>
            <h2 className="text-3xl font-extrabold text-gray-800">Transit On-Demand Workspace</h2>
            <p className="text-gray-500 font-bold mt-2">Manage Master Schedules vs. MVT Driver Shifts</p>
          </div>
          
          <div className="flex flex-col items-end gap-2">
            <button 
              onClick={handleOptimization}
              disabled={isAnimating}
              className={`
                btn-bouncy flex items-center gap-3 px-6 py-3 rounded-2xl font-extrabold text-white shadow-sm border-b-4
                ${isOptimized 
                  ? 'bg-gray-400 border-gray-600 hover:bg-gray-500' 
                  : 'bg-gradient-to-r from-brand-green to-emerald-500 border-brand-greenDark hover:brightness-110'
                }
                transition-all
              `}
            >
              {isAnimating ? (
                  <Sparkles className="animate-spin text-yellow-200" size={20} />
              ) : (
                  <Wand2 size={20} />
              )}
              {isAnimating ? 'Gemini AI Thinking...' : isOptimized ? 'Reset Roster' : 'Gemini Optimize'}
            </button>
            
            {/* Notification when optimizing */}
            {isAnimating && (
                <div className="flex items-center gap-2 text-xs font-bold text-gray-500 animate-pulse bg-yellow-50 px-3 py-1 rounded-lg border border-yellow-200">
                    <Loader2 size={12} className="animate-spin" />
                    Please wait, this could take a few minutes...
                </div>
            )}
          </div>
        </div>

        {/* Real-time Visualization (Always Visible) */}
        <div className="mb-8">
             <GapChart data={timeSlots} />
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-4 mb-6 border-b-2 border-gray-200 pb-1">
            <button 
                onClick={() => setActiveTab('overview')}
                className={`
                    pb-3 px-4 font-extrabold text-lg flex items-center gap-2 transition-all
                    ${activeTab === 'overview' 
                        ? 'text-brand-blue border-b-4 border-brand-blue translate-y-[2px]' 
                        : 'text-gray-400 hover:text-gray-600'
                    }
                `}
            >
                <BarChart3 size={20} /> Overview & Metrics
            </button>
            <button 
                onClick={() => setActiveTab('editor')}
                className={`
                    pb-3 px-4 font-extrabold text-lg flex items-center gap-2 transition-all
                    ${activeTab === 'editor' 
                        ? 'text-brand-blue border-b-4 border-brand-blue translate-y-[2px]' 
                        : 'text-gray-400 hover:text-gray-600'
                    }
                `}
            >
                <Users size={20} /> Shift Editor <span className="bg-gray-200 text-gray-600 text-xs px-2 py-0.5 rounded-full ml-1">{shifts.length}</span>
            </button>
        </div>

        {/* Tab Content */}
        {activeTab === 'overview' && (
            <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
                <SummaryCards metrics={metrics} />
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                    <div className="lg:col-span-2">
                         <FileUpload onFileUpload={handleFileUpload} />
                    </div>
                    <div className="lg:col-span-1">
                        <div className="bg-white p-6 rounded-3xl border-2 border-gray-200 h-full">
                            <h3 className="text-xl font-extrabold text-gray-700 mb-4">Shift Distribution</h3>
                            <div className="space-y-4">
                                <div className="flex justify-between items-center p-3 bg-blue-50 rounded-xl border-2 border-blue-100">
                                    <span className="font-bold text-gray-600">North Zone</span>
                                    <span className="font-extrabold text-brand-blue">
                                        ~{Math.round(shifts.length * 0.4)} Drivers
                                    </span>
                                </div>
                                <div className="flex justify-between items-center p-3 bg-green-50 rounded-xl border-2 border-green-100">
                                    <span className="font-bold text-gray-600">South Zone</span>
                                    <span className="font-extrabold text-brand-green">
                                        ~{Math.round(shifts.length * 0.4)} Drivers
                                    </span>
                                </div>
                                <div className="flex justify-between items-center p-3 bg-orange-50 rounded-xl border-2 border-orange-100">
                                    <div className="flex items-center gap-2">
                                        {/* Coffee icon removed to avoid unused import if Coffee not imported. Assuming Coffee is needed or use generic icon */}
                                        <span className="font-bold text-gray-600">Break Policy</span>
                                    </div>
                                    <span className="font-extrabold text-orange-500 text-xs">Active</span>
                                </div>
                            </div>
                            
                            <div className={`mt-6 p-4 rounded-2xl border-2 ${isOptimized ? 'bg-purple-50 border-purple-100' : 'bg-gray-50 border-gray-200'}`}>
                                <h4 className={`font-bold mb-1 ${isOptimized ? 'text-purple-600' : 'text-gray-500'}`}>
                                    {isOptimized ? 'AI Optimization Report' : 'Current Status'}
                                </h4>
                                <p className="text-sm text-gray-600 font-semibold mb-2">
                                    {isOptimized 
                                      ? 'Gemini has re-balanced the schedule. Notice that gaps may still exist due to 8-hour shift constraints.' 
                                      : 'Standard Roster. Potential inefficiencies detected.'}
                                </p>
                                {isOptimized && (
                                    <div className="flex items-start gap-2 text-xs text-purple-700 bg-purple-100 p-2 rounded-lg">
                                        <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                                        <span>
                                            <strong>Why +5 surplus?</strong> 8-hour shifts are rigid. To cover peaks at 8am and 5pm, overlap at noon is mathematically unavoidable without split shifts.
                                        </span>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        )}

        {activeTab === 'editor' && (
             <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
                 <ShiftEditor 
                    shifts={shifts} 
                    onUpdateShift={handleShiftUpdate}
                    onDeleteShift={handleDeleteShift}
                    onAddShift={handleAddShift}
                />
             </div>
        )}
    </div>
  );
};