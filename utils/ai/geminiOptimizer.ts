import { Requirement, Shift, Zone } from "../demandTypes";
import {
  SHIFT_DURATION_SLOTS,
  BREAK_DURATION_SLOTS,
  BREAK_THRESHOLD_HOURS
} from "../demandConstants";
import { auth } from "../firebase";

/**
 * Calls our secure serverless API to optimize the schedule.
 * 
 * WHY THIS IS BETTER:
 * - Before: We had the Gemini API key in browser code (anyone could steal it!)
 * - Now: The API key is only on the Vercel server, safe and hidden
 * 
 * HOW IT WORKS:
 * 1. Browser sends requirements to /api/optimize
 * 2. Serverless function calls Gemini with YOUR secret key
 * 3. Serverless function returns the results to the browser
 * 4. Your API key never touches the browser!
 */
export const optimizeScheduleWithGemini = async (
  requirements: Requirement[],
  mode: 'full' | 'refine' = 'full',
  currentShifts: any[] = [],
  focusInstruction?: string
): Promise<Shift[]> => {
  try {
    console.log(`Calling Gemini Optimization API (Model: gemini-3.1-pro-preview)... Mode: ${mode}`);
    const currentUser = auth.currentUser;
    if (!currentUser) {
      throw new Error('Authentication required');
    }

    const idToken = await currentUser.getIdToken();

    const response = await fetch('/api/optimize', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${idToken}`,
      },
      body: JSON.stringify({
        requirements,
        mode,
        currentShifts,
        focusInstruction
      }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || 'API request failed');
    }

    const data = await response.json();
    return data.shifts || [];

  } catch (error) {
    console.error("Optimization failed:", error);
    // Fallback to local optimization if API fails
    return localOptimizationFallback(requirements);
  }
};

/**
 * Local fallback optimization (used when running on localhost)
 * This is a simple heuristic-based scheduler that doesn't need an API key
 */
function localOptimizationFallback(requirements: Requirement[]): Shift[] {
  const shifts: Shift[] = [];

  // Find peak hours (when demand is highest)
  const hourlyDemand: { hour: number; demand: number }[] = [];
  for (let hour = 0; hour < 24; hour++) {
    const slot = hour * 4;
    const demand = requirements[slot]?.total || 0;
    hourlyDemand.push({ hour, demand });
  }

  // Sort by demand to find peaks
  const peakHours = hourlyDemand
    .filter(h => h.demand > 0)
    .sort((a, b) => b.demand - a.demand);

  // Create shifts to cover demand
  let shiftCount = 0;
  const maxShifts = Math.min(15, Math.ceil(peakHours.length * 1.2));

  // Start shifts at high-demand hours
  const usedStartHours = new Set<number>();

  for (const peak of peakHours) {
    if (shiftCount >= maxShifts) break;

    // Stagger starts around peak hours
    const startHour = Math.max(5, peak.hour - 1);
    if (usedStartHours.has(startHour)) continue;
    usedStartHours.add(startHour);

    const startSlot = startHour * 4;
    const duration = SHIFT_DURATION_SLOTS; // 8 hours default
    const endSlot = Math.min(96, startSlot + duration);

    const zones: Zone[] = [Zone.NORTH, Zone.SOUTH, Zone.FLOATER];
    const zone = zones[shiftCount % 3];

    // Calculate break (6 hours into shift, if shift is long enough)
    const hours = duration / 4;
    let breakStart = 0;
    let breakDuration = 0;

    if (hours > BREAK_THRESHOLD_HOURS) {
      breakStart = startSlot + 24; // Break at hour 6
      breakDuration = BREAK_DURATION_SLOTS;
    }

    shifts.push({
      id: `local-shift-${shiftCount}-${Date.now()}`,
      driverName: `Driver ${shiftCount + 1}`,
      zone,
      startSlot,
      endSlot,
      breakStartSlot: breakStart,
      breakDurationSlots: breakDuration
    });

    shiftCount++;
  }

  return shifts;
}
