import { TimeSlot, SummaryMetrics, Shift, Requirement, Zone } from './demandTypes';
import { TIME_SLOTS_PER_DAY, SHIFT_DURATION_SLOTS, BREAK_DURATION_SLOTS } from './demandConstants';

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

    // Reserve some demand specifically for Floaters (e.g. 20%) to allow flexibility
    const total = Math.round(Math.max(1, baseReq));
    const floater = Math.floor(total * 0.2);
    const remainder = total - floater;
    const north = Math.ceil(remainder / 2);
    const south = remainder - north;

    reqs.push({ slotIndex: i, total, north, south, floater });
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

          const breakStartOffset = 16 + (Math.random() > 0.8 ? 1 : 0);
          const breakStartSlot = startSlot + breakStartOffset;

          shifts.push({
            id: `shift-${Math.random().toString(36).substring(2, 11)}`,
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
    const currentCoverage = new Array(TIME_SLOTS_PER_DAY).fill(0);
    const getDeficit = (slot: number) => Math.max(0, requirements[slot].total - currentCoverage[slot]);

    let iterations = 0;
    while (iterations < 50) {
      iterations++;
      const totalDeficit = requirements.reduce((sum, r, idx) => sum + getDeficit(idx), 0);
      if (totalDeficit <= 5) break;

      let bestShift = null;
      let maxScore = -Infinity;

      for (let start = 0; start <= TIME_SLOTS_PER_DAY - SHIFT_DURATION_SLOTS; start++) {
        const minBreakOffset = 16;
        const maxBreakOffset = 24;
        const end = start + SHIFT_DURATION_SLOTS;

        for (let bOffset = minBreakOffset; bOffset <= maxBreakOffset; bOffset++) {
          const breakStart = start + bOffset;
          const breakEnd = breakStart + BREAK_DURATION_SLOTS;

          let score = 0;
          for (let t = start; t < end; t++) {
            if (t >= breakStart && t < breakEnd) {
              if (getDeficit(t) > 0) score -= 2;
              continue;
            }

            const def = getDeficit(t);
            if (def > 0) {
              score += 10;
            } else {
              score -= 2;
            }
          }

          if (score > maxScore) {
            maxScore = score;
            bestShift = { startSlot: start, breakStartSlot: breakStart };
          }
        }
      }

      if (maxScore < 10) break;

      if (bestShift) {
        const endSlot = bestShift.startSlot + SHIFT_DURATION_SLOTS;
        for (let t = bestShift.startSlot; t < endSlot; t++) {
          if (t >= bestShift.breakStartSlot && t < bestShift.breakStartSlot + BREAK_DURATION_SLOTS) continue;
          currentCoverage[t]++;
        }

        shifts.push({
          id: `shift-opt-${Math.random().toString(36).substring(2, 11)}`,
          driverName: `Driver ${driverCount++}`,
          zone: Zone.FLOATER,
          startSlot: bestShift.startSlot,
          endSlot: endSlot,
          breakStartSlot: bestShift.breakStartSlot,
          breakDurationSlots: BREAK_DURATION_SLOTS
        });
      }
    }

    // Post-process: Assign zones including Floater explicitly
    shifts.forEach((shift, index) => {
      if (index % 5 === 0) shift.zone = Zone.FLOATER; // 20% Floater
      else if (index % 2 === 0) shift.zone = Zone.NORTH;
      else shift.zone = Zone.SOUTH;
    });
  }

  return shifts;
};

// 3. Compile Schedule (Combine Supply + Demand)
export const calculateSchedule = (shifts: Shift[], requirements: Requirement[]): TimeSlot[] => {
  const slots: TimeSlot[] = [];

  if (!requirements || requirements.length === 0) {
    return [];
  }

  for (let i = 0; i < TIME_SLOTS_PER_DAY; i++) {
    const minutesFromMidnight = i * 15;
    const req = requirements[i];

    if (!req) continue;

    let activeCount = 0;
    // Break Counts
    let breakCount = 0;
    let northBreaks = 0;
    let southBreaks = 0;
    let floaterBreaks = 0;

    let northCount = 0;
    let southCount = 0;
    let floaterCount = 0;

    shifts.forEach(shift => {
      if (i >= shift.startSlot && i < shift.endSlot) {
        const isOnBreak = (i >= shift.breakStartSlot && i < shift.breakStartSlot + shift.breakDurationSlots);

        if (isOnBreak) {
          breakCount++;
          // Track zone specific breaks
          switch (shift.zone) {
            case Zone.NORTH:
              northBreaks++;
              break;
            case Zone.SOUTH:
              southBreaks++;
              break;
            case Zone.FLOATER:
              floaterBreaks++;
              break;
          }
        } else {
          activeCount++;

          switch (shift.zone) {
            case Zone.NORTH:
              northCount++;
              break;
            case Zone.SOUTH:
              southCount++;
              break;
            case Zone.FLOATER:
              floaterCount++;
              break;
          }
        }
      }
    });

    // Calculate Floater Relief Logic
    const floaterDemand = req.floater || 0;
    const northDemand = req.north;
    const southDemand = req.south;
    const northDeficit = Math.max(0, northDemand - northCount);
    const southDeficit = Math.max(0, southDemand - southCount);
    const floaterEffectiveRequirement = floaterDemand + northDeficit + southDeficit;
    const floaterSurplus = Math.max(0, floaterCount - floaterDemand);

    // North Relief
    const northRelief = Math.min(northDeficit, floaterSurplus);

    // Remaining available for South
    const remainingFloaterSurplus = floaterSurplus - northRelief;

    // South Relief
    const southRelief = Math.min(southDeficit, remainingFloaterSurplus);

    const northEffectiveCoverage = Math.min(northDemand, northCount + northRelief);
    const southEffectiveCoverage = Math.min(southDemand, southCount + southRelief);
    const floaterEffectiveCoverage = Math.min(floaterDemand, floaterCount);
    const totalEffectiveCoverage = northEffectiveCoverage + southEffectiveCoverage + floaterEffectiveCoverage;
    const totalOverlappingShifts = activeCount + breakCount;

    slots.push({
      timeLabel: formatTime(minutesFromMidnight),
      timestamp: minutesFromMidnight,
      northRequirement: req.north,
      southRequirement: req.south,
      floaterRequirement: req.floater || 0,
      floaterEffectiveRequirement,
      totalRequirement: req.total,
      northCoverage: northCount,
      southCoverage: southCount,
      floaterCoverage: floaterCount,
      // Break Data
      driversOnBreak: breakCount,
      northBreaks,
      southBreaks,
      floaterBreaks,

      // Relief Data
      northRelief,
      southRelief,

      totalActiveCoverage: activeCount,
      totalEffectiveCoverage,
      totalOverlappingShifts,
      netDifference: totalEffectiveCoverage - req.total
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

export const calculateMetrics = (data: TimeSlot[], shifts?: Shift[]): SummaryMetrics => {
  let totalReq = 0;
  let totalCov = 0;
  let netDiff = 0;

  // 1. Calculate Demand (Master Hours)
  data.forEach(slot => {
    // 15 min interval = 0.25 hours
    totalReq += slot.totalRequirement * 0.25;
    totalCov += slot.totalEffectiveCoverage * 0.25;
    netDiff += slot.netDifference * 0.25;
  });

  // 2. Calculate Supply (Payable Hours) - PREFERRED METHOD
  // If shifts are provided, calculate exact payable time (end - start)
  let payableHours = totalCov;
  if (shifts) {
    payableHours = shifts.reduce((sum, s) => sum + ((s.endSlot - s.startSlot) * 0.25), 0);
  }

  return {
    totalMasterHours: parseFloat(totalReq.toFixed(1)),
    totalShiftHours: parseFloat(payableHours.toFixed(1)),
    netDiffHours: parseFloat(netDiff.toFixed(1)),
    // Coverage uses totalCov (active hours excluding breaks) vs requirements
    // This is intentional - payableHours includes break time which shouldn't count toward coverage
    coveragePercent: totalReq > 0 ? Math.round((totalCov / totalReq) * 100) : 100
  };
};
