import { TimeSlot, SummaryMetrics, Shift, Requirement, Zone } from '../types';
import { TIME_SLOTS_PER_DAY, SHIFT_DURATION_SLOTS, BREAK_DURATION_SLOTS } from '../constants';

// Helper to format minutes from midnight to HH:mm
export const formatTime = (totalMinutes: number): string => {
  const h = Math.floor(totalMinutes / 60) % 24;
  const m = totalMinutes % 60;
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
};

export const formatSlotToTime = (slot: number): string => {
  return formatTime(slot * 15);
};

// 1. Generate Requirement Curve (Demand)
export const generateRequirements = (): Requirement[] => {
  const reqs: Requirement[] = [];
  
  for (let i = 0; i < TIME_SLOTS_PER_DAY; i++) {
    const minutesFromMidnight = i * 15;
    const hour = minutesFromMidnight / 60;

    // Sinusoidal Requirement Logic
    let baseReq = 4;
    
    // AM Peak (7-9)
    if (hour >= 6.5 && hour <= 9.5) {
      baseReq += 4 * Math.sin(((hour - 6.5) / 3) * Math.PI);
    }
    // PM Peak (15-18)
    if (hour >= 14.5 && hour <= 18.5) {
      baseReq += 5 * Math.sin(((hour - 14.5) / 4) * Math.PI);
    }
    // Late night drop off
    if (hour < 5 || hour > 23) baseReq = 1;

    const total = Math.round(Math.max(1, baseReq));
    const north = Math.ceil(total / 2);
    const south = total - north;

    reqs.push({ slotIndex: i, total, north, south });
  }
  return reqs;
};

// 2. Generate Shifts based on Requirements (Supply)
export const generateShifts = (requirements: Requirement[], optimized: boolean = false): Shift[] => {
  if (!requirements || requirements.length === 0) return [];

  const shifts: Shift[] = [];
  let driverCount = 1;

  if (!optimized) {
    // --- LEGACY / UNOPTIMIZED LOGIC (Naive Gap Filling) ---
    // This creates "clumping" and ignores global efficiency, good for showing "Before" state.
    const rosterCounts = new Array(TIME_SLOTS_PER_DAY).fill(0);

    for (let i = 0; i < TIME_SLOTS_PER_DAY - 16; i++) { 
      const req = requirements[i].total;
      const currentStaff = rosterCounts[i];

      if (currentStaff < req) {
        const deficit = req - currentStaff;
        // Naively add shifts starting exactly when the gap starts
        for (let s = 0; s < deficit; s++) {
          const startSlot = i;
          const endSlot = Math.min(startSlot + SHIFT_DURATION_SLOTS, TIME_SLOTS_PER_DAY);
          
          // Update local roster count for this loop
          for (let k = startSlot; k < endSlot; k++) {
            rosterCounts[k]++;
          }

          // Randomize break slightly, but mostly fixed relative to start
          const breakStartOffset = 16 + (Math.random() > 0.8 ? 1 : 0); // ~4 hours in
          const breakStartSlot = startSlot + breakStartOffset;

          shifts.push({
            id: `shift-${Math.random().toString(36).substr(2, 9)}`,
            driverName: `Driver ${driverCount++}`,
            zone: Math.random() > 0.6 ? Zone.FLOATER : (Math.random() > 0.5 ? Zone.NORTH : Zone.SOUTH),
            startSlot,
            endSlot,
            breakStartSlot,
            breakDurationSlots: BREAK_DURATION_SLOTS
          });
        }
      }
    }
  } else {
    // --- OPTIMIZED LOGIC (Heuristic Best-Fit) ---
    // Repeatedly finds the "Best Shift" that covers the most deficit slots
    // and places breaks in the "least painful" spot (valleys).
    
    // Track current coverage across the day
    const currentCoverage = new Array(TIME_SLOTS_PER_DAY).fill(0);
    
    // Calculate initial deficit
    const getDeficit = (slot: number) => Math.max(0, requirements[slot].total - currentCoverage[slot]);
    
    // Loop until we cover most needs or hit a safety limit
    let iterations = 0;
    while (iterations < 50) {
      iterations++;
      
      // Calculate total remaining deficit to see if we should stop
      const totalDeficit = requirements.reduce((sum, r, idx) => sum + getDeficit(idx), 0);
      if (totalDeficit <= 5) break; // Good enough coverage (ignore small edge gaps)

      // Find the BEST start time and BEST break time
      let bestShift = null;
      let maxScore = -Infinity;

      // Scan all possible start times
      for (let start = 0; start <= TIME_SLOTS_PER_DAY - SHIFT_DURATION_SLOTS; start++) {
        
        // Define Valid Break Window (e.g., 3 to 5 hours into shift)
        const minBreakOffset = 12; // 3 hours
        const maxBreakOffset = 20; // 5 hours
        const end = start + SHIFT_DURATION_SLOTS;

        // Find best break time for this specific start time
        for (let bOffset = minBreakOffset; bOffset <= maxBreakOffset; bOffset++) {
          const breakStart = start + bOffset;
          const breakEnd = breakStart + BREAK_DURATION_SLOTS;

          let score = 0;
          
          // Calculate Score for this Shift Configuration
          for (let t = start; t < end; t++) {
            // Skip break time
            if (t >= breakStart && t < breakEnd) {
                // If we take a break here, are we leaving a gap?
                // If Deficit > 0, taking a break hurts. Score penalty.
                // If Deficit <= 0, taking a break is fine.
                if (getDeficit(t) > 0) score -= 2; 
                continue; 
            }

            const def = getDeficit(t);
            if (def > 0) {
              score += 10; // High reward for covering a gap
            } else {
              score -= 2; // Penalty for Over-provisioning (Surplus)
            }
          }

          if (score > maxScore) {
            maxScore = score;
            bestShift = { startSlot: start, breakStartSlot: breakStart };
          }
        }
      }

      // If the best shift doesn't add much value, stop adding drivers
      if (maxScore < 10) break;

      if (bestShift) {
        // Add the best shift to the roster
        const endSlot = bestShift.startSlot + SHIFT_DURATION_SLOTS;
        
        // Update coverage
        for (let t = bestShift.startSlot; t < endSlot; t++) {
           if (t >= bestShift.breakStartSlot && t < bestShift.breakStartSlot + BREAK_DURATION_SLOTS) continue;
           currentCoverage[t]++;
        }

        shifts.push({
          id: `shift-opt-${Math.random().toString(36).substr(2, 9)}`,
          driverName: `Driver ${driverCount++}`,
          zone: Zone.FLOATER, // Optimized shifts default to Floater for max flexibility
          startSlot: bestShift.startSlot,
          endSlot: endSlot,
          breakStartSlot: bestShift.breakStartSlot,
          breakDurationSlots: BREAK_DURATION_SLOTS
        });
      }
    }
    
    // Post-process: Assign fixed zones to balance North/South roughly
    // We kept them as Floater during generation for simplicity
    shifts.forEach((shift, index) => {
        if (index % 3 === 0) shift.zone = Zone.NORTH;
        else if (index % 3 === 1) shift.zone = Zone.SOUTH;
    });
  }

  return shifts;
};

// 3. Compile Schedule (Combine Supply + Demand)
export const calculateSchedule = (shifts: Shift[], requirements: Requirement[]): TimeSlot[] => {
  const slots: TimeSlot[] = [];

  // SAFETY GUARD: Prevent crash during initial render or empty state
  if (!requirements || requirements.length === 0) {
    return [];
  }

  for (let i = 0; i < TIME_SLOTS_PER_DAY; i++) {
    const minutesFromMidnight = i * 15;
    const req = requirements[i];

    if (!req) continue;

    let activeCount = 0;
    let breakCount = 0;

    shifts.forEach(shift => {
      if (i >= shift.startSlot && i < shift.endSlot) {
        // Driver is clocked in
        if (i >= shift.breakStartSlot && i < shift.breakStartSlot + shift.breakDurationSlots) {
          breakCount++;
        } else {
          activeCount++;
        }
      }
    });

    // Distribute Active Coverage
    const floaterCoverage = Math.floor(activeCount * 0.2);
    const fixedCoverage = activeCount - floaterCoverage;
    const northCoverage = Math.ceil(fixedCoverage / 2);
    const southCoverage = fixedCoverage - northCoverage;

    slots.push({
      timeLabel: formatTime(minutesFromMidnight),
      timestamp: minutesFromMidnight,
      northRequirement: req.north,
      southRequirement: req.south,
      totalRequirement: req.total,
      northCoverage,
      southCoverage,
      floaterCoverage,
      driversOnBreak: breakCount,
      totalActiveCoverage: activeCount,
      netDifference: activeCount - req.total
    });
  }

  return slots;
};

// For backward compatibility or initial load
export const generateMockData = (optimized: boolean = false): TimeSlot[] => {
  const reqs = generateRequirements();
  const shifts = generateShifts(reqs, optimized);
  return calculateSchedule(shifts, reqs);
};

export const calculateMetrics = (data: TimeSlot[]): SummaryMetrics => {
  let totalReq = 0;
  let totalCov = 0;
  let netDiff = 0;

  data.forEach(slot => {
    // 15 min interval = 0.25 hours
    totalReq += slot.totalRequirement * 0.25;
    totalCov += slot.totalActiveCoverage * 0.25;
    netDiff += slot.netDifference * 0.25;
  });

  return {
    totalMasterHours: parseFloat(totalReq.toFixed(1)),
    totalShiftHours: parseFloat(totalCov.toFixed(1)),
    netDiffHours: parseFloat(netDiff.toFixed(1)),
    coveragePercent: totalReq > 0 ? Math.round((totalCov / totalReq) * 100) : 100
  };
};