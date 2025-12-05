import type { VercelRequest, VercelResponse } from '@vercel/node';
import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai';

/**
 * Core Optimization Logic - Decoupled from Vercel Request/Response
 * This allows for local testing without the Vercel CLI.
 */
export async function optimizeImplementation(requirements: any[], apiKey: string) {
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
                driverName: { type: SchemaType.STRING, description: "Name like 'Driver 1'" },
                startSlot: { type: SchemaType.INTEGER, description: "Start time in 15-min slots (0-96)" },
                durationSlots: { type: SchemaType.INTEGER, description: "Total shift length in slots (20-44 slots / 5-11 hours)" },
                breakStartSlot: { type: SchemaType.INTEGER, description: "Break start time (must be within shift). Use 0 if no break." },
                zone: { type: SchemaType.STRING, enum: ["North", "South", "Floater"] }
            },
            required: ["driverName", "startSlot", "durationSlots", "breakStartSlot", "zone"]
        }
    };

    const systemInstruction = `You are a World-Class Transit Scheduler. 
    Your goal is to create a roster of Driver Shifts that INDEPENDENTLY satisfies the demand for three distinct zones: North, South, and Floater.
    
    Union Rules:
    - Shift Length: 5-10 hours (20-40 slots)
    - Breaks: 45min (3 slots) if shift > 6h
    
    STRICT ZONE LOGIC (DO NOT MIX):
    - You must treat this as THREE separate optimization problems running in parallel.
    - "North Demand" MUST be covered by "North" shifts.
    - "South Demand" MUST be covered by "South" shifts.
    - "Floater Demand" MUST be covered by "Floater" shifts.
    - DO NOT use Floater shifts to cover North or South demand. They have their own dedicated demand curve.
    
    CRITICAL COVERAGE RULES:
    1. ZERO GAPS TOLERATED per zone.
    2. CHECK EVERY SLOT [i]:
       - Count of North Shifts >= North Demand[i]
       - Count of South Shifts >= South Demand[i]
       - Count of Floater Shifts >= Floater Demand[i]
    3. SHIFT STARTS: Start shifts EXACTLY when demand spikes in their respective zone.
    `;

    const prompt = `
    North Zone Demand (Require "North" Shifts):
    ${JSON.stringify(northDemandCurve)}

    South Zone Demand (Require "South" Shifts):
    ${JSON.stringify(southDemandCurve)}
    
    Floater Zone Demand (Require "Floater" Shifts):
    ${JSON.stringify(new Array(96).fill(0).map((_, i) => Math.max(0, totalDemandCurve[i] - northDemandCurve[i] - southDemandCurve[i])))} 
    (Note: If specific Floater demand was provided, use that. Otherwise, calculate the remainder.)

    INSTRUCTIONS:
    1. Generate a roster that strictly satisfies the specific curve for each zone type.
    2. Do NOT cross-subsidize. A surplus in Floaters does NOT help South gaps.
    3. Return strictly JSON.
    `;

    console.log("🤖 Calling Gemini API (gemini-3-pro-preview)...");

    // Call Gemini API
    const model = genAI.getGenerativeModel({
        model: "gemini-3-pro-preview",
        systemInstruction: systemInstruction,
        generationConfig: {
            responseMimeType: "application/json",
            responseSchema: shiftSchema as any,
            temperature: 0.3, // User prefers 0.3 for better results
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
            id: `gemini-shift-${index}-${Date.now()}`,
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
        const { requirements } = req.body;

        if (!requirements || !Array.isArray(requirements)) {
            console.error("❌ Invalid requirements payload");
            return res.status(400).json({ error: 'Missing or invalid requirements data' });
        }

        console.log(`📦 Processing ${requirements.length} requirements...`);

        // DELEGATE TO CORE IMPLEMENTATION
        const processedShifts = await optimizeImplementation(requirements, apiKey);

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
