import type { VercelRequest, VercelResponse } from '@vercel/node';
import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai';

/**
 * Vercel Serverless Function - Gemini Optimizer Proxy
 * 
 * WHY THIS EXISTS:
 * - Your Gemini API key must stay SECRET
 * - If we put the key in the browser code, anyone can steal it
 * - This function runs on Vercel's servers, NOT in the browser
 * - The browser calls THIS function, which then calls Gemini
 * - Your API key never leaves the server!
 * 
 * HOW TO SET UP:
 * 1. In Vercel Dashboard, go to your project → Settings → Environment Variables
 * 2. Add: GEMINI_API_KEY = your_key_here
 * 3. Deploy!
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

        // Initialize Gemini
        const genAI = new GoogleGenerativeAI(apiKey);

        // Build the demand array for the AI (96 slots)
        const demandCurve = new Array(96).fill(0);
        requirements.forEach((r: any) => {
            if (r.slotIndex >= 0 && r.slotIndex < 96) {
                demandCurve[r.slotIndex] = r.total;
            }
        });

        // Define the schema for structured output
        // Note: Using 'any' for the schema type to avoid TypeScript string enum issues with the SDK types
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
    Your goal is to create a roster of Driver Shifts that satisfies specific 15-minute demand slots efficiently.
    
    Union Rules:
    - Shift Length: 5-10 hours (20-40 slots)
    - Breaks: 45min (3 slots) if shift > 6h

    CRITICAL RULES:
    1. ZERO GAPS TOLERATED. If demand > 0, you MUST have a driver.
    2. SHIFT STARTS: You can start shifts at ANY slot (e.g., 5:15 AM = slot 21). Do NOT wait for the hour mark.
    3. If demand starts at slot 21, your shift MUST start at slot 21 (or earlier). Starting at slot 24 (6:00 AM) is a FAILURE.
    `;

        const prompt = `
    Demand Curve (96 slots, from 00:00 to 23:45): 
    ${JSON.stringify(demandCurve)}

    INSTRUCTIONS:
    1. The array above shows the number of drivers needed for each 15-minute slot.
    2. CHECK EVERY SLOT. If demand[i] > 0, ensure you have enough active drivers at slot i.
    3. PRIORITIZE COVERAGE. It is better to have an extra driver than a missing one.
    4. Generate the MOST EFFICIENT roster possible. Return strictly JSON.
    `;

        console.log("🤖 Calling Gemini API (gemini-3-pro-preview)...");

        // Call Gemini API
        const model = genAI.getGenerativeModel({
            model: "gemini-3-pro-preview",
            systemInstruction: systemInstruction,
            generationConfig: {
                responseMimeType: "application/json",
                responseSchema: shiftSchema as any,
                temperature: 0.1, // Lower temperature for stricter logic adherence
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
            return res.status(500).json({ error: 'Failed to parse AI response', raw: text });
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
