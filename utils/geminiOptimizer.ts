import { GoogleGenAI, Type } from "@google/genai";
import { Requirement, Shift, Zone } from "../types";
import { SHIFT_DURATION_SLOTS, BREAK_DURATION_SLOTS } from "../constants";

// Initialize the API client
// Note: process.env.API_KEY is assumed to be available in the execution environment
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

export const optimizeScheduleWithGemini = async (requirements: Requirement[]): Promise<Shift[]> => {
  try {
    // 1. Prepare Data for Prompt
    // Calculate total hours needed to give the AI a budget
    let totalDemandHours = 0;
    requirements.forEach(r => totalDemandHours += (r.total * 0.25));
    
    // Ideal pure shifts needed (Total Hours / 8). 
    // We add 15% buffer for inefficiencies inherent in straight shifts.
    const idealShiftCount = Math.ceil((totalDemandHours / 8) * 1.15);

    // Identify Peaks and Valleys for the prompt
    // This helps the AI understand the "shape" better than just raw numbers
    const peaks = requirements
        .filter(r => r.total >= 7)
        .map(r => Math.floor(r.slotIndex / 4)) // Get Hour
        .filter((v, i, a) => a.indexOf(v) === i); // Unique hours

    const valleys = requirements
        .filter(r => r.total <= 4 && r.slotIndex > 32 && r.slotIndex < 80) // Mid-day valleys only
        .map(r => Math.floor(r.slotIndex / 4))
        .filter((v, i, a) => a.indexOf(v) === i);

    const demandSummary = requirements
      .filter((_, i) => i % 4 === 0)
      .map(r => `Hour ${r.slotIndex / 4}: Need ${r.total}`)
      .join(", ");

    // 2. Define the Output Schema (JSON)
    const shiftSchema = {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          driverName: { type: Type.STRING, description: "Name like 'Driver 1'" },
          startSlot: { type: Type.INTEGER, description: "Start time in 15-min slots (0-96)" },
          breakStartSlot: { type: Type.INTEGER, description: "Break start time (must be within shift)" },
          zone: { type: Type.STRING, enum: ["North", "South", "Floater"] }
        },
        required: ["driverName", "startSlot", "breakStartSlot", "zone"]
      }
    };

    // 3. Construct System Instructions & Prompt
    const systemInstruction = `You are a World-Class Transit Scheduler. 
    Your goal is to create a roster of Driver Shifts that satisfies demand while MINIMIZING WASTE (Surplus).
    
    CRITICAL CONSTRAINTS:
    1. Shift Duration: EXACTLY ${SHIFT_DURATION_SLOTS} slots (8 hours). No split shifts.
    2. Break Duration: EXACTLY ${BREAK_DURATION_SLOTS} slots (30 mins).
    3. Break Window: Breaks MUST start between 12 and 24 slots (3-6 hours) into the shift.
    
    OPTIMIZATION STRATEGY (IMPORTANT):
    - You have a strict budget of roughly ${idealShiftCount} drivers. Do not exceed this unless impossible.
    - Avoid "Peak Chasing": Do not add a full 8-hour shift just to cover a 15-minute spike if it leaves 7 hours of surplus.
    - Better to be UNDER by 1 driver for a short time than OVER by 5 drivers for a long time.
    - Use breaks strategically! Schedule breaks during "Valleys" (times of low demand) to reduce the surplus.
    - Stagger start times (e.g., 07:15, 07:30) to smooth out the curve.
    
    Current Demand Peaks (Hours): ${peaks.join(', ')}
    Current Demand Valleys (Hours): ${valleys.join(', ')}
    `;

    const prompt = `
    Here is the demand curve (Drivers needed per hour):
    [${demandSummary}]

    Generate the MOST EFFICIENT roster possible. Return strictly JSON.
    `;

    // 4. Call the API
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
      config: {
        systemInstruction: systemInstruction,
        responseMimeType: "application/json",
        responseSchema: shiftSchema,
        temperature: 0.1, // Very low temperature for strict adherence to constraints
      }
    });

    // 5. Parse and Format Response
    const generatedShifts = JSON.parse(response.text || "[]");
    
    // Post-process to ensure valid Shift objects with IDs
    return generatedShifts.map((s: any, index: number) => ({
      id: `gemini-shift-${index}-${Date.now()}`,
      driverName: s.driverName || `AI Driver ${index + 1}`,
      zone: s.zone as Zone,
      startSlot: Number(s.startSlot),
      endSlot: Number(s.startSlot) + SHIFT_DURATION_SLOTS,
      breakStartSlot: Number(s.breakStartSlot),
      breakDurationSlots: BREAK_DURATION_SLOTS
    }));

  } catch (error) {
    console.error("Gemini Optimization Failed:", error);
    return [];
  }
};