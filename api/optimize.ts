import type { VercelRequest, VercelResponse } from '@vercel/node';
import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai';

/**
 * Core Optimization Logic - Decoupled from Vercel Request/Response
 * This allows for local testing without the Vercel CLI.
 */
export async function optimizeImplementation(requirements: any[], apiKey: string, mode: 'full' | 'refine' = 'full', currentShifts: any[] = []) {
    // Initialize Gemini
    const genAI = new GoogleGenerativeAI(apiKey);

    // Build the demand arrays for the AI (96 slots)
    const totalDemandCurve = new Array(96).fill(0);
    const northDemandCurve = new Array(96).fill(0);
    const southDemandCurve = new Array(96).fill(0);

    requirements.forEach((r: any) => {
        if (r.slotIndex >= 0 && r.slotIndex < 96) {
            totalDemandCurve[r.slotIndex] = r.total;
            northDemandCurve[r.slotIndex] = r.north;
            southDemandCurve[r.slotIndex] = r.south;
        }
    });

    // Define the schema for structured output
    const shiftSchema = {
        type: SchemaType.ARRAY,
        items: {
            type: SchemaType.OBJECT,
            properties: {
                id: { type: SchemaType.STRING, description: "Unique ID (Preserve if refining)" },
                driverName: { type: SchemaType.STRING, description: "Name like 'Driver 1'" },
                startSlot: { type: SchemaType.INTEGER, description: "Start time in 15-min slots (0-96)" },
                durationSlots: { type: SchemaType.INTEGER, description: "Total shift length in slots (20-44 slots / 5-11 hours)" },
                breakStartSlot: { type: SchemaType.INTEGER, description: "Break start time (must be within shift). Use 0 if no break." },
                zone: { type: SchemaType.STRING, enum: ["North", "South", "Floater"] }
            },
            required: ["driverName", "startSlot", "durationSlots", "breakStartSlot", "zone"]
        }
    };

    let systemInstruction = `You are an expert Transit Scheduler AI. 
    Your goal is to OPTIMIZE a driver schedule for a simplified On-Demand Transit system.`;

    if (mode === 'refine' && currentShifts.length > 0) {
        systemInstruction += `
    
    MODE: REFINE & POLISH
    - You are provided with an EXISTING roster of shifts.
    - Your goal is to IMPROVE efficiency (reduce surplus, fix gaps) with MINIMAL changes.
    - DO NOT regenerate the schedule from scratch.
    - KEEP existing shift IDs where possible.
    - Only modify start/end times or breaks if it significantly improves efficiency.
    - If a shift is close to perfect, keep it exactly as is.
    - Return the FULL list of shifts (including unmodified ones).`;
    } else {
        systemInstruction += `
    
    MODE: FULL OPTIMIZATION
    - You are generating a schedule FROM SCRATCH based on demand.
    - Ignore any previous shifts (start fresh).`;
    }

    systemInstruction += `
    
    Union Rules:
    - Shift Length: 5-10 hours (20-40 slots)
    - Breaks: 45min (3 slots) if shift > 6h
    
    STRICT ZONE LOGIC (DO NOT MIX):
    - You must treat this as THREE separate optimization problems running in parallel.
    - "North Demand" MUST be covered by "North" shifts.
    - "South Demand" MUST be covered by "South" shifts.
    - "Floater Demand" MUST be covered by "Floater" shifts.
    
    EFFICIENCY & OPTIMIZATION STRATEGIES:
    1. **MINIMIZE TOTAL HOURS**: Over-supply is a failure. You must hug the demand curve as tightly as possible.
       - A perfect roster has ZERO gaps and the LOWEST possible total hours.
    
    2. **USE SHORTER SHIFTS FOR PEAKS**:
       - The shift length range is 5-10 hours.
       - Use 5-hour or 6-hour shifts to cover short demand peaks (e.g., morning/afternoon rush).
       - Only use 8-10 hour shifts for base load (all-day demand).
    
    3. **BREAK STRATEGY & RELIEF (CRITICAL)**:
       - **STAGGER BREAKS**: Do NOT schedule breaks for multiple drivers at the same time.
         - Bad: 3 drivers on break at 12:00.
         - Good: Driver A at 11:30, Driver B at 12:30, Driver C at 13:30.
       - **FLOATER RELIEF**: Use Floater shifts to "bridge" the gaps created by North/South breaks.
         - Logic: Floater covers North (while North Driver is on break) -> then moves to South (while South Driver is on break).
    
    CRITICAL COVERAGE RULES:
    1. EFFICIENCY FIRST: You are allowed to have MINOR GAPS (-1 driver) for short periods (max 30 mins) if it prevents adding a huge wasteful shift.
    2. MINIMIZE SURPLUS: It is better to have a random 15-min gap than to have 8 hours of unused drivers.
    3. MINIMIZE CONCURRENT BREAKS: Target max 1 driver on break at a time per zone.
    4. CHECK EVERY SLOT [i]:
       - Ideally: Count >= Demand[i]
       - Acceptable: Count = Demand[i] - 1 (for < 3 consecutive slots)
       - Unacceptable: Count < Demand[i] - 1 OR Count < Demand[i] for > 45 mins.
    5. SHIFT STARTS: Start shifts EXACTLY when demand spikes in their respective zone.
    `;

    let prompt = `
    North Zone Demand (Require "North" Shifts):
    ${JSON.stringify(northDemandCurve)}

    South Zone Demand (Require "South" Shifts):
    ${JSON.stringify(southDemandCurve)}
    
    Floater Zone Demand (Require "Floater" Shifts):
    ${JSON.stringify(new Array(96).fill(0).map((_, i) => Math.max(0, totalDemandCurve[i] - northDemandCurve[i] - southDemandCurve[i])))} 
    (Note: If specific Floater demand was provided, use that. Otherwise, calculate the remainder.)
    `;

    if (mode === 'refine' && currentShifts.length > 0) {
        prompt += `
        
        EXISTING SCHEDULE TO REFINE:
        ${JSON.stringify(currentShifts.map(s => ({
            id: s.id,
            driverName: s.driverName,
            zone: s.zone,
            startSlot: s.startSlot,
            durationSlots: s.endSlot - s.startSlot,
            breakStartSlot: s.breakStartSlot
        })))}
        
        INSTRUCTIONS for REFINE:
        - Analyze the existing schedule against the demand curves.
        - Fix any gaps by slightly adjusting start times.
        - Reduce surplus by shortening shifts or removing truly redundant ones.
        - Adjust break times to ensure staggered coverage.
        - RETURN THE FULL REFINED LIST.
        `;
    } else {
        prompt += `
        INSTRUCTIONS:
        1. Generate a roster that strictly satisfies the specific curve for each zone type.
        2. Do NOT cross-subsidize. A surplus in Floaters does NOT help South gaps.
        3. Return strictly JSON.
        `;
    }

    console.log(`🤖 Calling Gemini API (gemini-3-pro-preview) in ${mode.toUpperCase()} mode...`);

    // Call Gemini API
    const model = genAI.getGenerativeModel({
        model: "gemini-3-pro-preview",
        systemInstruction: systemInstruction,
        generationConfig: {
            responseMimeType: "application/json",
            responseSchema: shiftSchema as any,
            temperature: mode === 'refine' ? 0.2 : 0.3, // Lower temp for refinement to stay closer to original
        }
    });

    const result = await model.generateContent(prompt);
    const response = result.response;
    const text = response.text();

    console.log("✅ Gemini Response Received:", text.substring(0, 100) + "...");

    // Parse the response
    let generatedShifts = [];
    try {
        generatedShifts = JSON.parse(text || "[]");
    } catch (e) {
        console.error("❌ JSON Parse Failed:", e);
        console.error("Raw Text:", text);
        throw new Error('Failed to parse AI response: ' + text);
    }

    // Post-process to ensure valid Shift objects
    const BREAK_DURATION_SLOTS = 3;
    const BREAK_THRESHOLD_HOURS = 6;

    const processedShifts = generatedShifts.map((s: any, index: number) => {
        const duration = Number(s.durationSlots) || 32;
        const start = Number(s.startSlot);
        const end = start + duration;

        let breakStart = Number(s.breakStartSlot);
        let breakDuration = 0;

        const hours = duration / 4;
        if (hours > BREAK_THRESHOLD_HOURS) {
            breakDuration = BREAK_DURATION_SLOTS;
            if (breakStart < start + 20 || breakStart > start + 32) {
                breakStart = start + 24;
            }
        } else {
            breakStart = 0;
        }

        return {
            id: s.id || `gemini-shift-${index}-${Date.now()}`, // Preserve ID if returned (refine mode), else new
            driverName: s.driverName || `AI Driver ${index + 1}`,
            zone: s.zone,
            startSlot: start,
            endSlot: end,
            breakStartSlot: breakStart,
            breakDurationSlots: breakDuration
        };
    });

    console.log(`🎉 Successfully processed ${processedShifts.length} shifts`);
    return processedShifts;
}

/**
 * Vercel Serverless Function Proxy
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
    console.log("🚀 Optimization Request Received");

    // Only allow POST requests (sending data to the API)
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed. Use POST.' });
    }

    try {
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
            console.error('GEMINI_API_KEY is not set in environment variables');
            return res.status(500).json({ error: 'Server configuration error: Missing API Key' });
        }

        // Get the requirements data sent from the browser
        const { requirements, mode, currentShifts } = req.body; // Expanded destructuring

        if (!requirements || !Array.isArray(requirements)) {
            console.error("❌ Invalid requirements payload");
            return res.status(400).json({ error: 'Missing or invalid requirements data' });
        }

        console.log(`📦 Processing ${requirements.length} requirements...`);

        // DELEGATE TO CORE IMPLEMENTATION
        const processedShifts = await optimizeImplementation(requirements, apiKey, mode || 'full', currentShifts || []);

        // Send back the optimized shifts
        return res.status(200).json({ shifts: processedShifts });

    } catch (error: any) {
        console.error('❌ CRITICAL SERVER ERROR:', error);
        // Ensure we send a JSON response even for crashes
        return res.status(500).json({
            error: 'Internal Server Error',
            message: error.message,
            stack: error.stack
        });
    }
}
