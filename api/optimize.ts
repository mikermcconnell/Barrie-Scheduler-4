import type { VercelRequest, VercelResponse } from '@vercel/node';
import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai';
import {
    authenticateFirebaseRequest,
    checkRateLimit,
    getRequestIp,
} from '../lib/apiSecurity.js';

const isTruthy = (value?: string) => ['1', 'true', 'yes', 'on'].includes((value || '').toLowerCase());
const isExtendedPipelineEnabled = () => !process.env.VERCEL && isTruthy(process.env.OPTIMIZE_MULTI_PHASE);
const createServerRequestId = () => `srv-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const inferErrorCode = (message: string) => {
    const text = message.toLowerCase();
    if (
        text.includes('api key expired')
        || text.includes('api_key_invalid')
        || text.includes('missing api key')
        || text.includes('server configuration')
        || text.includes('server config')
    ) {
        return 'SERVER_CONFIG';
    }
    if (text.includes('invalid requirements') || text.includes('invalid request')) return 'INVALID_REQUEST';
    if (text.includes('timeout') || text.includes('timed out') || text.includes('deadline')) return 'TIMEOUT';
    if (text.includes('auth')) return 'AUTH_REQUIRED';
    return 'UPSTREAM';
};

/**
 * ==========================================
 * SCHEMAS
 * ==========================================
 */
const shiftItemSchema = {
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
};

// Phase 1: Generator Output (Just the list)
const generatorSchema = {
    type: SchemaType.ARRAY,
    items: shiftItemSchema
};

// Phase 2: Critic Output (Critique + Revised List)
const criticSchema = {
    type: SchemaType.OBJECT,
    properties: {
        critique: { type: SchemaType.STRING, description: "Critical analysis of the draft. Identify specific gaps, over-supply, or break conflicts." },
        shifts: {
            type: SchemaType.ARRAY,
            items: shiftItemSchema
        }
    },
    required: ["critique", "shifts"]
};

/**
 * ==========================================
 * CORE LOGIC
 * ==========================================
 */

async function callGemini(
    apiKey: string,
    prompt: string,
    systemInstruction: string,
    schema: any,
    modelName: string = "gemini-3.1-pro-preview",
    temperature: number = 0.3,
    traceLabel: string = 'gemini',
    requestId: string = 'unknown'
) {
    const startedAt = Date.now();
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
        model: modelName,
        systemInstruction: systemInstruction,
        generationConfig: {
            responseMimeType: "application/json",
            responseSchema: schema,
            temperature: temperature,
        }
    });

    const result = await model.generateContent(prompt);
    const text = result.response.text();
    const durationMs = Date.now() - startedAt;
    console.log(`[${requestId}] ${traceLabel} completed in ${durationMs}ms`);
    return JSON.parse(text || (schema.type === SchemaType.ARRAY ? "[]" : "{}"));
}

function normalizeShiftForPrompt(shift: any) {
    const startSlot = Number(shift.startSlot) || 0;
    const rawDuration = Number(shift.durationSlots);
    const derivedDuration = Number.isFinite(rawDuration) && rawDuration > 0
        ? rawDuration
        : Math.max(0, (Number(shift.endSlot) || startSlot) - startSlot);

    return {
        id: typeof shift.id === 'string' ? shift.id : undefined,
        driverName: shift.driverName,
        zone: shift.zone,
        startSlot,
        durationSlots: derivedDuration,
        breakStartSlot: Number(shift.breakStartSlot) || 0,
    };
}

export async function optimizeImplementation(
    requirements: any[],
    apiKey: string,
    mode: 'full' | 'refine' = 'full',
    currentShifts: any[] = [],
    focusInstruction?: string,
    requestId: string = 'unknown'
) {

    // 1. Prepare Data
    const totalDemandCurve = new Array(96).fill(0);
    const northDemandCurve = new Array(96).fill(0);
    const southDemandCurve = new Array(96).fill(0);

    // Support flexible body parsing if needed (though requirements arg usually comes from handler)
    // If we want to use the destructured args from handler, we just use them directly.
    // The handler passes `requirements` and `currentShifts`.
    // Passing `focusInstruction` as the 5th argument is valid.

    requirements.forEach((r: any) => {
        if (r.slotIndex >= 0 && r.slotIndex < 96) {
            totalDemandCurve[r.slotIndex] = r.total;
            northDemandCurve[r.slotIndex] = r.north;
            southDemandCurve[r.slotIndex] = r.south;
        }
    });

    const floaterDemandCurve = new Array(96).fill(0).map((_, i) => Math.max(0, totalDemandCurve[i] - northDemandCurve[i] - southDemandCurve[i]));

    const demandContext = `
    North Zone Demand: ${JSON.stringify(northDemandCurve)}
    South Zone Demand: ${JSON.stringify(southDemandCurve)}
    Floater Zone Demand: ${JSON.stringify(floaterDemandCurve)}
    `;

    const fleetConstraintRules = mode === 'full'
        ? `
    FLEET CONSTRAINTS:
    - Maximum vehicles on the road at any time: 6.
    - Drivers on break do NOT count as vehicles on the road.
    - Break periods must be covered by other active shifts if demand requires coverage.
    - Never return a schedule where more than 6 active, non-break shifts overlap in any 15-minute slot.
    `
        : '';

    const commonRules = `
    PRIMARY OBJECTIVE:
    Match the master schedule demand curve as closely as possible in every 15-minute slot.

    UNION RULES:
    - Shift length rules apply to actual drive time between drive start and drive end.
    - Shift Length: 5-11 hours (20-44 slots) of actual drive time.
    - Breaks: 45min (3 slots) if actual drive time > 7.5h.
    - Breaks must occur between hour 4 and 6 of the shift.
    - STRICT ZONE LOGIC: North covers North, South covers South, Floater covers Gaps/Breaks.
    ${fleetConstraintRules}

    SERVICE PRIORITIES (Follow these STRICTLY):
    1. Avoid coverage gaps.
    2. A single-bus gap for 1-2 consecutive 15-minute slots is tolerable but discouraged ONLY if it clearly improves the overall schedule.
    3. A gap of 2+ buses is NOT acceptable.
    4. A gap lasting more than 2 consecutive slots is NOT acceptable.
    5. Peak-period gaps are much worse than off-peak surplus.
    6. Do not create repeated short gaps across the day to save hours.
    7. Prefer a small surplus over recurring service gaps.

    OPTIMIZATION ORDER:
    1. Minimize peak gaps.
    2. Minimize total deficit slots.
    3. Minimize repeated short gaps.
    4. Minimize surplus slots.
    5. Minimize payable hours.
    6. Keep breaks compliant and staggered.
    `;

    const extendedPipeline = isExtendedPipelineEnabled();
    console.log(`[${requestId}] Pipeline mode: ${extendedPipeline ? 'multi-phase' : 'fast'}`);
    console.log(`[${requestId}] 🤖 [Phase 1] Generating Draft Schedule (${mode})...`);

    const draftSystemInstruction = `You are an expert Transit Scheduler. Generate a draft schedule.
    ${commonRules}
    STRATEGIES:
    1. Match the demand curve first. Cost reduction is secondary.
    2. Use shorter shifts where they reduce mismatch without creating repeated short gaps.
    3. Stagger breaks so the same zone does not lose multiple drivers at once.
    4. Preserve continuous coverage through the strongest peaks.
    `;

    let draftPrompt = `DEMAND CURVES:\n${demandContext}\n`;

    if (mode === 'refine' && currentShifts.length > 0) {
        draftPrompt += `\nREFINE EXISTING SHIFTS:\n${JSON.stringify(currentShifts.map(normalizeShiftForPrompt))}`;
    } else {
        draftPrompt += `\nGENERATE NEW SCHEDULE FROM SCRATCH based on demand.`;
    }
    if (focusInstruction) {
        draftPrompt += `\nUSER PRIORITY INSTRUCTION:\n"${focusInstruction}"\nApply this only if it does not violate the service priorities above.`;
    }
    draftPrompt += `\nOUTPUT REQUIREMENTS:
    - Return shifts that minimize slot-by-slot mismatch to the demand curves.
    - Preserve shift IDs when refining unless a shift must be removed or a new shift must be added.
    - Do not accept any 2+ bus gap or any 1-bus gap longer than 2 consecutive slots.
    ${mode === 'full' ? '- Never schedule more than 6 active drivers on the road in any slot; drivers on break do not count toward that 6.' : ''}
    `;

    // Call Phase 1
    let draftShifts = [];
    try {
        draftShifts = await callGemini(apiKey, draftPrompt, draftSystemInstruction, generatorSchema, "gemini-3.1-pro-preview", 0.4, 'phase1-generator', requestId);
        console.log(`[${requestId}] ✅ [Phase 1] Draft Generated: ${draftShifts.length} shifts.`);
    } catch (e) {
        console.error(`[${requestId}] ❌ [Phase 1] Failed:`, e);
        throw e;
    }

    if (!extendedPipeline) {
        console.log(`[${requestId}] Fast path enabled; skipping critic and polisher phases.`);
        return processShifts(draftShifts);
    }

    // ---------------------------------------------------------
    // PHASE 2: THE CRITIC (Refining)
    // ---------------------------------------------------------
    console.log(`[${requestId}] 🕵️ [Phase 2] Critic Reviewing Draft...`);

    const criticSystemInstruction = `You are a SENIOR AUDITOR for Transit Schedules.
    Your job is to CRITIQUE the provided draft schedule and produce a FINAL, PERFECTED version.
    
    ${commonRules}
    
    CRITIQUE RULES:
    1. **Gap Severity**: Reject any 2+ bus gap immediately.
    2. **Short-Gap Tolerance**: A 1-bus gap for 1-2 consecutive slots is allowed only if it clearly improves the full-day schedule and does not repeat across many periods.
    3. **Over-Supply**: Trim surplus only after gap control is acceptable.
    4. **Break Conflicts**: If two drivers from the same zone are on break at the same time, MOVE one break.
    5. **Floater Logic**: Ensure Floaters are actually working during gaps or break relief periods.
    
    OUTPUT FORMAT:
    - First, write a "critique": identifying 2-3 biggest issues in the draft.
    - Then, return the "shifts": the fully corrected list.
    `;

    const criticPrompt = `
    DEMAND:
    ${demandContext}

    DRAFT SCHEDULE (Audit this):
    ${JSON.stringify(draftShifts)}

    ${focusInstruction ? `
    USER PRIORITY INSTRUCTION (CRITICAL):
    "${focusInstruction}"
    (Prioritize this instruction above all generic efficiency rules.)
    ` : ''}

    TASK:
    1. Critique the draft. Focus first on gaps, repeated shortfalls, peak coverage, and break conflicts.
    2. Output a REVISED list of shifts that solves these problems.
    `;

    let finalShifts = [];
    try {
        const criticOutput = await callGemini(apiKey, criticPrompt, criticSystemInstruction, criticSchema, "gemini-3.1-pro-preview", 0.2, 'phase2-critic', requestId);

        console.log(`[${requestId}] 📝 [Phase 2] Critic's Analysis:\n${criticOutput.critique}`);
        finalShifts = criticOutput.shifts;
        console.log(`[${requestId}] ✅ [Phase 2] Final Schedule: ${finalShifts.length} shifts.`);

    } catch (e) {
        console.error(`[${requestId}] ❌ [Phase 2] Failed. Falling back to draft.`, e);
        finalShifts = draftShifts;
    }

    // ---------------------------------------------------------
    // PHASE 3: THE POLISHER (Final Compliance Check)
    // ---------------------------------------------------------
    console.log(`[${requestId}] ✨ [Phase 3] Polishing Schedule...`);

    const polisherSystemInstruction = `You are the FINAL COMPLIANCE OFFICER.
    Your job is to take the "Refined Schedule" and apply STRICT UNION RULES and MICRO-OPTIMIZATIONS.
    
    ${commonRules}
    
    POLISHING TASKS:
    1. **Strict Break Windows**: ENSURE every break is between the 4th and 6th hour (Slots: Start+16 to Start+24). MOVE them if they are off by even 1 slot.
    2. **Gap Guardrail**: Do not leave any 2+ bus gap or any 1-bus gap longer than 2 consecutive slots.
    3. **Trim Surpluses**: If a zone has sustained surplus and coverage remains acceptable, cut a shift earlier or start it later.
    4. **Floater Efficiency**: If a Floater is covering a time where no breaks or gaps exist, move them to a more valuable period.
    
    OUTPUT:
    - Return the FINAL list of shifts.
    `;

    const polisherPrompt = `
    DEMAND:
    ${demandContext}

    REFINED SCHEDULE (Phase 2 Output):
    ${JSON.stringify(finalShifts)}

    TASK:
    - Review every single shift for break compliance.
    - Check every 15-min slot for unacceptable gaps, repeated shortfalls, and inefficient surpluses.
    - Output the polished list.
    `;

    try {
        // Reuse generator schema since we just need the list
        const polishedOutput = await callGemini(apiKey, polisherPrompt, polisherSystemInstruction, generatorSchema, "gemini-3.1-pro-preview", 0.1, 'phase3-polisher', requestId); // Low temp for strictness
        console.log(`[${requestId}] ✅ [Phase 3] Polished Schedule: ${polishedOutput.length} shifts.`);
        finalShifts = polishedOutput;
    } catch (e) {
        console.error(`[${requestId}] ❌ [Phase 3] Failed. Keeping Phase 2 result.`, e);
        // Fallback to Phase 2 result (finalShifts)
    }

    // ---------------------------------------------------------
    // POST-PROCESSING
    // ---------------------------------------------------------
    const processedShifts = processShifts(finalShifts);
    return processedShifts;
}

/**
 * Helper to normalize shift data (ensure types, add proper IDs)
 */
function processShifts(shifts: any[]) {
    const seenIds = new Set<string>();

    return shifts.map((s: any, index: number) => {
        const duration = Number(s.durationSlots) || 32;
        const start = Number(s.startSlot);
        const baseId = typeof s.id === 'string' && s.id.trim()
            ? s.id.trim()
            : `ai-shift-${index}-${Date.now()}`;
        let uniqueId = baseId;
        let duplicateIndex = 1;

        while (seenIds.has(uniqueId)) {
            uniqueId = `${baseId}-${duplicateIndex++}`;
        }

        seenIds.add(uniqueId);

        // Auto-fix breaks if missing/invalid but shift is long
        let breakStart = Number(s.breakStartSlot);
        let breakDuration = 0;
        const hours = duration / 4;

        if (hours > 7.5) {
            breakDuration = 3; // 45 mins
            // Enforce window (4th-6th hour)
            const minBreak = start + 16;
            const maxBreak = start + 24;
            if (breakStart < minBreak || breakStart > maxBreak) {
                breakStart = start + 20; // Default to 5th hour (middle of 4-6 window)
            }
        } else {
            breakStart = 0;
            breakDuration = 0;
        }

        return {
            id: uniqueId,
            driverName: s.driverName || `Driver ${index + 1}`,
            zone: s.zone,
            startSlot: start,
            endSlot: start + duration,
            breakStartSlot: breakStart,
            breakDurationSlots: breakDuration
        };
    });
}

/**
 * Vercel Serverless Function Proxy
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
    const requestId = typeof req.body?.requestId === 'string' ? req.body.requestId : createServerRequestId();
    const requestStartedAt = Date.now();
    console.log(`[${requestId}] 🚀 Optimization Request Received`);

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed. Use POST.', code: 'METHOD_NOT_ALLOWED', requestId });
    }

    const authedUser = await authenticateFirebaseRequest(req);
    if (!authedUser) {
        return res.status(401).json({ error: 'Authentication required', code: 'AUTH_REQUIRED', requestId });
    }

    const requestIp = getRequestIp(req);
    const maxRequestsPerHour = Number(process.env.OPTIMIZE_RATE_LIMIT_PER_HOUR || 20);
    const rateLimitKey = `optimize:${authedUser.uid}:${requestIp}`;
    const allowed = checkRateLimit(rateLimitKey, maxRequestsPerHour, 60 * 60 * 1000);
    if (!allowed) {
        return res.status(429).json({ error: 'Rate limit exceeded. Please try again later.', code: 'RATE_LIMIT', requestId });
    }

    try {
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
            console.error('GEMINI_API_KEY is not set in environment variables');
            return res.status(500).json({ error: 'Server configuration error: Missing API Key', code: 'SERVER_CONFIG', requestId });
        }

        const { requirements, mode, currentShifts, focusInstruction } = req.body;

        if (!requirements || !Array.isArray(requirements)) {
            console.error(`[${requestId}] ❌ Invalid requirements payload`);
            return res.status(400).json({ error: 'Missing or invalid requirements data', code: 'INVALID_REQUEST', requestId });
        }

        console.log(`[${requestId}] 📦 Processing ${requirements.length} requirements...`);

        const processedShifts = await optimizeImplementation(requirements, apiKey, mode || 'full', currentShifts || [], focusInstruction, requestId);
        const durationMs = Date.now() - requestStartedAt;
        const pipeline = isExtendedPipelineEnabled() ? 'multi-phase' : 'fast';
        console.log(`[${requestId}] ✅ Optimization complete in ${durationMs}ms (pipeline=${pipeline})`);

        return res.status(200).json({ shifts: processedShifts, requestId, durationMs, pipeline });

    } catch (error: any) {
        const message = error?.message || 'Unknown server error';
        const code = inferErrorCode(message);
        const status = code === 'TIMEOUT' ? 504 : 500;
        console.error(`[${requestId}] ❌ CRITICAL SERVER ERROR:`, error);
        return res.status(status).json({
            error: 'Internal Server Error',
            message,
            code,
            requestId,
        });
    }
}
