import * as admin from 'firebase-admin';
import { onRequest } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai';

const GEMINI_API_KEY = defineSecret('GEMINI_API_KEY');
const isTruthy = (value?: string) => ['1', 'true', 'yes', 'on'].includes((value || '').toLowerCase());
const isExtendedPipelineEnabled = () => isTruthy(process.env.OPTIMIZE_MULTI_PHASE);
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

// ==========================================
// SCHEMAS
// ==========================================

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

const generatorSchema = {
    type: SchemaType.ARRAY,
    items: shiftItemSchema
};

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

// ==========================================
// CORE LOGIC
// ==========================================

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

function optimizeImplementation(
    requirements: any[],
    apiKey: string,
    mode: 'full' | 'refine' = 'full',
    currentShifts: any[] = [],
    focusInstruction?: string,
    requestId: string = 'unknown'
) {
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

    const floaterDemandCurve = new Array(96).fill(0).map((_, i) => Math.max(0, totalDemandCurve[i] - northDemandCurve[i] - southDemandCurve[i]));

    const demandContext = `
    North Zone Demand: ${JSON.stringify(northDemandCurve)}
    South Zone Demand: ${JSON.stringify(southDemandCurve)}
    Floater Zone Demand: ${JSON.stringify(floaterDemandCurve)}
    `;

    const commonRules = `
    Union Rules:
    - Shift Length: 5-11 hours (20-44 slots).
    - Breaks: 45min (3 slots) if shift > 7.5h.
    - Breaks must occur between hour 4 and 6 of the shift.
    - STRICT ZONE LOGIC: North covers North, South covers South, Floater covers Gaps/Breaks.

    EFFICIENCY RULES (Follow these STRICTLY):
    1. **KILL SURPLUS**: Over-supply is WORSE than a small gap.
       - A gap of -1 driver for 15-30 minutes (1-2 slots) is ACCEPTABLE if it prevents a long surplus.
    2. **HUG THE CURVE**: Do not schedule 8 hours of work for a 2-hour peak. Use split shifts or short 5h shifts.
    `;

    return runPipeline(apiKey, demandContext, commonRules, mode, currentShifts, focusInstruction, isExtendedPipelineEnabled(), requestId);
}

async function runPipeline(
    apiKey: string,
    demandContext: string,
    commonRules: string,
    mode: string,
    currentShifts: any[],
    focusInstruction: string | undefined,
    extendedPipeline: boolean,
    requestId: string
) {
    console.log(`[${requestId}] Pipeline mode: ${extendedPipeline ? 'multi-phase' : 'fast'}`);
    // Phase 1: Generator
    console.log(`[${requestId}] 🤖 [Phase 1] Generating Draft Schedule (${mode})...`);

    const draftSystemInstruction = `You are an expert Transit Scheduler. Generate a draft schedule.
    ${commonRules}
    STRATEGIES:
    1. Minimize total hours while covering demand.
    2. Use short shifts (5-6h) for peaks.
    3. Stagger breaks (don't overlap them in the same zone).
    `;

    let draftPrompt = `DEMAND CURVES:\n${demandContext}\n`;
    if (mode === 'refine' && currentShifts.length > 0) {
        draftPrompt += `\nREFINE EXISTING SHIFTS:\n${JSON.stringify(currentShifts.map(s => ({ ...s, uuid: undefined })))}`;
    } else {
        draftPrompt += `\nGENERATE NEW SCHEDULE FROM SCRATCH based on demand.`;
    }

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

    // Phase 2: Critic
    console.log(`[${requestId}] 🕵️ [Phase 2] Critic Reviewing Draft...`);

    const criticSystemInstruction = `You are a SENIOR AUDITOR for Transit Schedules.
    Your job is to CRITIQUE the provided draft schedule and produce a FINAL, PERFECTED version.

    ${commonRules}

    CRITIQUE RULES:
    1. **Over-Supply**: If there are more drivers than demand in a slot, CUT the shift duration or REMOVE the shift.
       - IMPORTANT: It is better to leave a small gap (-1 driver for < 30mins) than to have 4+ hours of surplus.
    2. **Under-Supply**: Only EXTEND shifts if the gap is > 30 mins or deep (-2 drivers). Small gaps are fine.
    3. **Break Conflicts**: If two "North" drivers are on break at the same time, MOVE one break.
    4. **Floater Logic**: Ensure Floaters are actually working during the times North/South drivers are on break.

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
    1. Critique the draft. Find surpluses, unnecessary shifts, or breaks at wrong times.
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

    // Phase 3: Polisher
    console.log(`[${requestId}] ✨ [Phase 3] Polishing Schedule...`);

    const polisherSystemInstruction = `You are the FINAL COMPLIANCE OFFICER.
    Your job is to take the "Refined Schedule" and apply STRICT UNION RULES and MICRO-OPTIMIZATIONS.

    ${commonRules}

    POLISHING TASKS:
    1. **Strict Break Windows**: ENSURE every break is between the 4th and 6th hour (Slots: Start+16 to Start+24). MOVE them if they are off by even 1 slot.
    3. **Trim Surpluses**: If a zone has +2 surplus for 30 mins, cut a shift earlier or start it later.
    4. **Floater Efficiency**: If a Floater is covering a time where NO breaks or gaps exist, move them to a gap.

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
    - Check every 15-min slot for inefficient surpluses.
    - Output the polished list.
    `;

    try {
        const polishedOutput = await callGemini(apiKey, polisherPrompt, polisherSystemInstruction, generatorSchema, "gemini-3.1-pro-preview", 0.1, 'phase3-polisher', requestId);
        console.log(`[${requestId}] ✅ [Phase 3] Polished Schedule: ${polishedOutput.length} shifts.`);
        finalShifts = polishedOutput;
    } catch (e) {
        console.error(`[${requestId}] ❌ [Phase 3] Failed. Keeping Phase 2 result.`, e);
    }

    return processShifts(finalShifts);
}

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

        let breakStart = Number(s.breakStartSlot);
        let breakDuration = 0;
        const hours = duration / 4;

        if (hours > 7.5) {
            breakDuration = 3;
            const minBreak = start + 16;
            const maxBreak = start + 24;
            if (breakStart < minBreak || breakStart > maxBreak) {
                breakStart = start + 20;
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

// ==========================================
// FIREBASE CLOUD FUNCTION
// ==========================================

export const optimizeSchedule = onRequest(
    {
        secrets: [GEMINI_API_KEY],
        memory: '1GiB',
        timeoutSeconds: 300,
        maxInstances: 5,
        region: 'us-central1',
        cors: [
            'https://transitscheduler.ca',
            'https://www.transitscheduler.ca',
            'http://localhost:3008',
        ],
    },
    async (req, res) => {
        const requestId = typeof req.body?.requestId === 'string' ? req.body.requestId : createServerRequestId();
        const requestStartedAt = Date.now();
        console.log(`[${requestId}] 🚀 Optimization Request Received`);

        if (req.method !== 'POST') {
            res.status(405).json({ error: 'Method not allowed. Use POST.', code: 'METHOD_NOT_ALLOWED', requestId });
            return;
        }

        // Verify Firebase ID token
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            res.status(401).json({ error: 'Authentication required', code: 'AUTH_REQUIRED', requestId });
            return;
        }

        const idToken = authHeader.slice('Bearer '.length).trim();
        try {
            await admin.auth().verifyIdToken(idToken);
        } catch {
            res.status(401).json({ error: 'Invalid authentication token', code: 'AUTH_REQUIRED', requestId });
            return;
        }

        try {
            const apiKey = GEMINI_API_KEY.value();
            if (!apiKey) {
                console.error('GEMINI_API_KEY secret is not set');
                res.status(500).json({ error: 'Server configuration error: Missing API Key', code: 'SERVER_CONFIG', requestId });
                return;
            }

            const { requirements, mode, currentShifts, focusInstruction } = req.body;

            if (!requirements || !Array.isArray(requirements)) {
                console.error(`[${requestId}] ❌ Invalid requirements payload`);
                res.status(400).json({ error: 'Missing or invalid requirements data', code: 'INVALID_REQUEST', requestId });
                return;
            }

            console.log(`[${requestId}] 📦 Processing ${requirements.length} requirements...`);

            const processedShifts = await optimizeImplementation(requirements, apiKey, mode || 'full', currentShifts || [], focusInstruction, requestId);
            const durationMs = Date.now() - requestStartedAt;
            const pipeline = isExtendedPipelineEnabled() ? 'multi-phase' : 'fast';
            console.log(`[${requestId}] ✅ Optimization complete in ${durationMs}ms (pipeline=${pipeline})`);

            res.status(200).json({ shifts: processedShifts, requestId, durationMs, pipeline });

        } catch (error: any) {
            const message = error?.message || 'Unknown server error';
            const code = inferErrorCode(message);
            const status = code === 'TIMEOUT' ? 504 : 500;
            console.error(`[${requestId}] ❌ CRITICAL SERVER ERROR:`, error);
            res.status(status).json({
                error: 'Internal Server Error',
                message,
                code,
                requestId,
            });
        }
    }
);
