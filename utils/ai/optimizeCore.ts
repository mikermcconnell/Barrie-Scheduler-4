import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai';
import {
  MAX_HOURS_WITHOUT_BREAK,
  MAX_SHIFT_HOURS,
  MIN_SHIFT_HOURS,
  SLOT_MINUTES,
  TIME_SLOTS_PER_DAY,
  hoursToSlots,
} from '../demandConstants';
import { calculateSchedule } from '../dataGenerator';
import { validateOnDemandSchedule } from '../onDemandValidation';
import {
  buildShiftCountCapInstruction,
  breakDurationMinutesToSlots,
  DEFAULT_BREAK_DURATION_MINUTES,
  normalizeBreakDurationMinutes,
  type OptimizeRequestOptions,
} from '../onDemandOptimizationSettings';
import { sanitizeOptimizerShift } from '../onDemandShiftRules';

export type OptimizeMode = 'full' | 'refine';

export interface OptimizeImplementationArgs {
  requirements: any[];
  apiKey: string;
  mode?: OptimizeMode;
  currentShifts?: any[];
  focusInstruction?: string;
  optimizationOptions?: OptimizeRequestOptions;
  requestId?: string;
  extendedPipeline: boolean;
}

const MAX_ACTIVE_VEHICLES = 6;

const getShiftCountPenalty = (
  shifts: any[],
  optimizationOptions?: OptimizeRequestOptions,
) => {
  const maxShiftCount = optimizationOptions?.maxShiftCount;
  if (!maxShiftCount || maxShiftCount < 1) {
    return 0;
  }

  const excessShiftCount = Math.max(0, shifts.length - maxShiftCount);
  if (excessShiftCount === 0) {
    return 0;
  }

  if (optimizationOptions?.shiftCountCapMode === 'guide') {
    return excessShiftCount * 500;
  }

  return 250_000 + excessShiftCount * 25_000;
};

export const getSimultaneousChangeoffPenalty = (
  shifts: any[],
  requirements: any[],
  optimizationOptions?: OptimizeRequestOptions,
) => {
  const slots = calculateSchedule(shifts, requirements, optimizationOptions);

  return slots.reduce((sum, slot) => {
    const totalConcurrentPenalty = Math.max(0, slot.driversInChangeoff - 1) * 400;
    const northConcurrentPenalty = Math.max(0, slot.northChangeoffs - 1) * 700;
    const southConcurrentPenalty = Math.max(0, slot.southChangeoffs - 1) * 700;
    return sum + totalConcurrentPenalty + northConcurrentPenalty + southConcurrentPenalty;
  }, 0);
};

const scoreSchedule = (
  shifts: any[],
  requirements: any[],
  optimizationOptions?: OptimizeRequestOptions,
) => {
  const configuredBreakDurationSlots = breakDurationMinutesToSlots(
    optimizationOptions?.breakDurationMinutes ?? DEFAULT_BREAK_DURATION_MINUTES,
  );
  const validation = validateOnDemandSchedule(
    shifts,
    requirements,
    MAX_ACTIVE_VEHICLES,
    configuredBreakDurationSlots,
    optimizationOptions,
  );
  const coverageShortfall = validation.coverageViolations.reduce((sum, issue) => sum + issue.shortfall, 0);
  const fleetExcess = validation.fleetViolations.reduce(
    (sum, issue) => sum + Math.max(0, issue.activeCoverage - MAX_ACTIVE_VEHICLES),
    0,
  );
  const shiftCountPenalty = getShiftCountPenalty(shifts, optimizationOptions);
  const simultaneousChangeoffPenalty = getSimultaneousChangeoffPenalty(
    shifts,
    requirements,
    optimizationOptions,
  );

  return {
    validation,
    score:
      validation.shiftRuleViolations.length * 1_500_000
      + validation.breakCoverageViolations.length * 1_000_000
      + validation.fleetViolations.length * 100_000
      + shiftCountPenalty
      + simultaneousChangeoffPenalty
      + fleetExcess * 10_000
      + validation.coverageViolations.length * 1_000
      + coverageShortfall * 100
      + validation.maxOverlappingShifts,
  };
};

const shiftItemSchema = {
  type: SchemaType.OBJECT,
  properties: {
    id: { type: SchemaType.STRING, description: 'Unique ID (Preserve if refining)' },
    driverName: { type: SchemaType.STRING, description: "Name like 'Driver 1'" },
    startSlot: { type: SchemaType.INTEGER, description: `Start time in ${SLOT_MINUTES}-minute slots (0-${TIME_SLOTS_PER_DAY})` },
    durationSlots: { type: SchemaType.INTEGER, description: `Total shift length in slots (${hoursToSlots(MIN_SHIFT_HOURS)}-${hoursToSlots(MAX_SHIFT_HOURS)} slots / ${MIN_SHIFT_HOURS}-${MAX_SHIFT_HOURS} hours)` },
    breakStartSlot: { type: SchemaType.INTEGER, description: 'Break start time (must be within shift). Use 0 if no break.' },
    handoffFromShiftId: { type: SchemaType.STRING, description: 'Optional incoming handoff shift ID to preserve when refining.' },
    handoffToShiftId: { type: SchemaType.STRING, description: 'Optional outgoing handoff shift ID to preserve when refining.' },
    zone: { type: SchemaType.STRING, enum: ['North', 'South', 'Floater'] },
  },
  required: ['driverName', 'startSlot', 'durationSlots', 'breakStartSlot', 'zone'],
};

const generatorSchema = {
  type: SchemaType.ARRAY,
  items: shiftItemSchema,
};

const criticSchema = {
  type: SchemaType.OBJECT,
  properties: {
    critique: { type: SchemaType.STRING, description: 'Critical analysis of the draft. Identify specific gaps, over-supply, or break conflicts.' },
    shifts: {
      type: SchemaType.ARRAY,
      items: shiftItemSchema,
    },
  },
  required: ['critique', 'shifts'],
};

async function callGemini(
  apiKey: string,
  prompt: string,
  systemInstruction: string,
  schema: any,
  modelName = 'gemini-3.1-pro-preview',
  temperature = 0.3,
  traceLabel = 'gemini',
  requestId = 'unknown',
) {
  const startedAt = Date.now();
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: modelName,
    systemInstruction,
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: schema,
      temperature,
    },
  });

  const result = await model.generateContent(prompt);
  const text = result.response.text();
  const durationMs = Date.now() - startedAt;
  console.log(`[${requestId}] ${traceLabel} completed in ${durationMs}ms`);
  return JSON.parse(text || (schema.type === SchemaType.ARRAY ? '[]' : '{}'));
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
    handoffFromShiftId: typeof shift.handoffFromShiftId === 'string' ? shift.handoffFromShiftId : undefined,
    handoffToShiftId: typeof shift.handoffToShiftId === 'string' ? shift.handoffToShiftId : undefined,
  };
}

export function buildOptimizeCommonRules(
  mode: OptimizeMode,
  optimizationOptions?: OptimizeRequestOptions,
) {
  const configuredBreakDurationMinutes = normalizeBreakDurationMinutes(
    optimizationOptions?.breakDurationMinutes,
    DEFAULT_BREAK_DURATION_MINUTES,
  );
  const configuredBreakDurationSlots = breakDurationMinutesToSlots(configuredBreakDurationMinutes);
  const fleetConstraintRules = mode === 'full'
    ? `
    FLEET CONSTRAINTS:
    - Maximum vehicles on the road at any time: 6.
    - Drivers on break or in changeoff do NOT count as vehicles on the road.
    - Break periods must be covered by other active shifts if demand requires coverage.
    - Never return a schedule where more than 6 active, in-zone shifts are on the road in any ${SLOT_MINUTES}-minute slot.
    `
    : '';
  const shiftCountConstraintRules = buildShiftCountCapInstruction(
    optimizationOptions?.maxShiftCount,
    optimizationOptions?.shiftCountCapMode,
    optimizationOptions?.dayType,
  );

  return `
    PRIMARY OBJECTIVE:
    Match the master schedule demand curve as closely as possible in every ${SLOT_MINUTES}-minute slot.

    UNION RULES:
    - Shift length rules apply to actual drive time between drive start and drive end.
    - Shift Length: ${MIN_SHIFT_HOURS}-${MAX_SHIFT_HOURS} hours (${hoursToSlots(MIN_SHIFT_HOURS)}-${hoursToSlots(MAX_SHIFT_HOURS)} slots) of actual drive time.
    - Lunch breaks: non-straight shifts cannot exceed ${MAX_HOURS_WITHOUT_BREAK} consecutive driving hours without lunch.
    - Use ${configuredBreakDurationMinutes}min (${configuredBreakDurationSlots} slots) as the default lunch length, unless an existing edited shift has a different valid duration.
    - STRICT ZONE LOGIC: North covers North, South covers South, Floater covers Gaps/Breaks.
    - CHANGEOFFS ONLY APPLY AT TRUE MID-SERVICE HANDOFFS where one revenue shift ends and another begins.
    - MORNING PULL-OUTS AND FINAL PULL-INS DO NOT LOSE REVENUE TIME TO CHANGEOFF TRAVEL.
    - NORTH CHANGEOFF: when a North handoff occurs, remove ${optimizationOptions?.northChangeoffMinutes ?? 0} minutes leaving the zone and ${optimizationOptions?.northChangeoffMinutes ?? 0} minutes returning from the garage.
    - SOUTH CHANGEOFF: when a South handoff occurs, remove ${optimizationOptions?.southChangeoffMinutes ?? 0} minutes leaving the zone and ${optimizationOptions?.southChangeoffMinutes ?? 0} minutes returning from the garage.
    ${fleetConstraintRules}
    ${shiftCountConstraintRules ? `- SHIFT COUNT CAP: ${shiftCountConstraintRules}` : ''}

    SERVICE PRIORITIES (Follow these STRICTLY):
    1. Avoid coverage gaps.
    2. A single-bus gap for 1-2 consecutive ${SLOT_MINUTES}-minute slots is tolerable but discouraged ONLY if it clearly improves the overall schedule.
    3. A gap of 2+ buses is NOT acceptable.
    4. A gap lasting more than 2 consecutive slots is NOT acceptable.
    5. Peak-period gaps are much worse than off-peak surplus.
    6. Minimize simultaneous driver changeoffs. Avoid stacking multiple changeoffs in the same ${SLOT_MINUTES}-minute slot when another arrangement is feasible.
    7. Do not create repeated short gaps across the day to save hours.
    8. Prefer a small surplus over recurring service gaps.

    OPTIMIZATION ORDER:
    1. Minimize peak gaps.
    2. Minimize total deficit slots.
    3. Minimize simultaneous changeoffs and stagger handoffs.
    4. Minimize repeated short gaps.
    5. Minimize surplus slots.
    6. Minimize payable hours.
    7. Keep breaks compliant and staggered.
    `;
}

function processShifts(shifts: any[], optimizationOptions?: OptimizeRequestOptions) {
  const seenIds = new Set<string>();
  const configuredBreakDurationSlots = breakDurationMinutesToSlots(
    optimizationOptions?.breakDurationMinutes ?? DEFAULT_BREAK_DURATION_MINUTES,
  );

  return shifts.map((s: any, index: number) => {
    const baseId = typeof s.id === 'string' && s.id.trim()
      ? s.id.trim()
      : `ai-shift-${index}-${Date.now()}`;
    let uniqueId = baseId;
    let duplicateIndex = 1;

    while (seenIds.has(uniqueId)) {
      uniqueId = `${baseId}-${duplicateIndex++}`;
    }

    seenIds.add(uniqueId);
    const sanitizedShift = sanitizeOptimizerShift(
      s,
      configuredBreakDurationSlots,
    );

    return {
      id: uniqueId,
      driverName: s.driverName || `Driver ${index + 1}`,
      zone: sanitizedShift.zone,
      startSlot: sanitizedShift.startSlot,
      endSlot: sanitizedShift.endSlot,
      breakStartSlot: sanitizedShift.breakStartSlot,
      breakDurationSlots: sanitizedShift.breakDurationSlots,
      handoffFromShiftId: typeof s.handoffFromShiftId === 'string' ? s.handoffFromShiftId : undefined,
      handoffToShiftId: typeof s.handoffToShiftId === 'string' ? s.handoffToShiftId : undefined,
    };
  });
}

function chooseBestScheduleCandidate(
  candidates: Array<{ label: string; shifts: any[] }>,
  requirements: any[],
  optimizationOptions: OptimizeRequestOptions | undefined,
  requestId: string,
) {
  const ranked = candidates
    .filter((candidate) => candidate.shifts.length > 0)
    .map((candidate, index) => {
      const evaluation = scoreSchedule(candidate.shifts, requirements, optimizationOptions);
      return {
        ...candidate,
        ...evaluation,
        index,
      };
    })
    .sort((a, b) => {
      if (a.score !== b.score) return a.score - b.score;
      return b.index - a.index;
    });

  const best = ranked[0];
  if (!best) {
    return { label: 'empty', shifts: [] as any[] };
  }

  console.log(`[${requestId}] Selected ${best.label} candidate`, {
    score: best.score,
    breakCoverageViolations: best.validation.breakCoverageViolations.length,
    coverageViolations: best.validation.coverageViolations.length,
    fleetViolations: best.validation.fleetViolations.length,
    maxActiveVehicles: best.validation.maxActiveVehicles,
    maxOverlappingShifts: best.validation.maxOverlappingShifts,
  });

  return best;
}

export async function optimizeImplementation({
  requirements,
  apiKey,
  mode = 'full',
  currentShifts = [],
  focusInstruction,
  optimizationOptions,
  requestId = 'unknown',
  extendedPipeline,
}: OptimizeImplementationArgs) {
  const totalDemandCurve = new Array(TIME_SLOTS_PER_DAY).fill(0);
  const northDemandCurve = new Array(TIME_SLOTS_PER_DAY).fill(0);
  const southDemandCurve = new Array(TIME_SLOTS_PER_DAY).fill(0);

  requirements.forEach((r: any) => {
    if (r.slotIndex >= 0 && r.slotIndex < TIME_SLOTS_PER_DAY) {
      totalDemandCurve[r.slotIndex] = r.total;
      northDemandCurve[r.slotIndex] = r.north;
      southDemandCurve[r.slotIndex] = r.south;
    }
  });

  const floaterDemandCurve = new Array(TIME_SLOTS_PER_DAY).fill(0).map(
    (_, i) => Math.max(0, totalDemandCurve[i] - northDemandCurve[i] - southDemandCurve[i]),
  );

  const demandContext = `
    North Zone Demand: ${JSON.stringify(northDemandCurve)}
    South Zone Demand: ${JSON.stringify(southDemandCurve)}
    Floater Zone Demand: ${JSON.stringify(floaterDemandCurve)}
    `;

  const commonRules = buildOptimizeCommonRules(mode, optimizationOptions);

  console.log(`[${requestId}] Pipeline mode: ${extendedPipeline ? 'multi-phase' : 'fast'}`);
  console.log(`[${requestId}] 🤖 [Phase 1] Generating Draft Schedule (${mode})...`);

  const draftSystemInstruction = `You are an expert Transit Scheduler. Generate a draft schedule.
    ${commonRules}
    STRATEGIES:
    1. Match the demand curve first. Cost reduction is secondary.
    2. Use shorter shifts where they reduce mismatch without creating repeated short gaps.
    3. Stagger breaks so the same zone does not lose multiple drivers at once.
    4. Stagger changeoffs so multiple drivers are not leaving service at the same time unless no better option exists.
    5. Preserve continuous coverage through the strongest peaks.
    `;

  let draftPrompt = `DEMAND CURVES:\n${demandContext}\n`;
  if (mode === 'refine' && currentShifts.length > 0) {
    draftPrompt += `\nREFINE EXISTING SHIFTS:\n${JSON.stringify(currentShifts.map(normalizeShiftForPrompt))}`;
  } else {
    draftPrompt += '\nGENERATE NEW SCHEDULE FROM SCRATCH based on demand.';
  }
  if (focusInstruction) {
    draftPrompt += `\nUSER PRIORITY INSTRUCTION:\n"${focusInstruction}"\nApply this only if it does not violate the service priorities above.`;
  }
  draftPrompt += `\nOUTPUT REQUIREMENTS:
    - Return shifts that minimize slot-by-slot mismatch to the demand curves.
    - Preserve shift IDs when refining unless a shift must be removed or a new shift must be added.
    - When refining, keep valid handoffFromShiftId and handoffToShiftId links for surviving shifts whenever the optimized timing still supports them.
    - Do not accept any 2+ bus gap or any 1-bus gap longer than 2 consecutive slots.
    ${mode === 'full' ? '- Never schedule more than 6 active drivers on the road in any slot; drivers on break or in changeoff do not count toward that 6.' : ''}
    `;

  let draftShifts = [];
  try {
    draftShifts = await callGemini(apiKey, draftPrompt, draftSystemInstruction, generatorSchema, 'gemini-3.1-pro-preview', 0.4, 'phase1-generator', requestId);
    console.log(`[${requestId}] ✅ [Phase 1] Draft Generated: ${draftShifts.length} shifts.`);
  } catch (e) {
    console.error(`[${requestId}] ❌ [Phase 1] Failed:`, e);
    throw e;
  }

  if (!extendedPipeline) {
    console.log(`[${requestId}] Fast path enabled; skipping critic and polisher phases.`);
    const processedDraft = processShifts(draftShifts, optimizationOptions);
    return chooseBestScheduleCandidate(
      [{ label: 'phase1-generator', shifts: processedDraft }],
      requirements,
      optimizationOptions,
      requestId,
    ).shifts;
  }

  console.log(`[${requestId}] 🕵️ [Phase 2] Critic Reviewing Draft...`);

  const criticSystemInstruction = `You are a SENIOR AUDITOR for Transit Schedules.
    Your job is to CRITIQUE the provided draft schedule and produce a FINAL, PERFECTED version.
    
    ${commonRules}
    
    CRITIQUE RULES:
    1. **Gap Severity**: Reject any 2+ bus gap immediately.
    2. **Short-Gap Tolerance**: A 1-bus gap for 1-2 consecutive slots is allowed only if it clearly improves the full-day schedule and does not repeat across many periods.
    3. **Over-Supply**: Trim surplus only after gap control is acceptable.
    4. **Break Conflicts**: If two drivers from the same zone are on break at the same time, MOVE one break.
    5. **Changeoff Clustering**: If multiple drivers are in changeoff at the same time, stagger those handoffs where possible.
    6. **Floater Logic**: Ensure Floaters are actually working during gaps or break relief periods.
    
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

  let criticShifts = [];
  try {
    const criticOutput = await callGemini(apiKey, criticPrompt, criticSystemInstruction, criticSchema, 'gemini-3.1-pro-preview', 0.2, 'phase2-critic', requestId);

    console.log(`[${requestId}] 📝 [Phase 2] Critic's Analysis:\n${criticOutput.critique}`);
    criticShifts = criticOutput.shifts;
    console.log(`[${requestId}] ✅ [Phase 2] Final Schedule: ${criticShifts.length} shifts.`);
  } catch (e) {
    console.error(`[${requestId}] ❌ [Phase 2] Failed. Falling back to draft.`, e);
    criticShifts = draftShifts;
  }

  console.log(`[${requestId}] ✨ [Phase 3] Polishing Schedule...`);

  const polisherSystemInstruction = `You are the FINAL COMPLIANCE OFFICER.
    Your job is to take the "Refined Schedule" and apply STRICT UNION RULES and MICRO-OPTIMIZATIONS.
    
    ${commonRules}
    
    POLISHING TASKS:
    1. **Lunch Compliance**: ENSURE non-straight shifts never exceed ${MAX_HOURS_WITHOUT_BREAK} consecutive driving hours before or after lunch. The old 4th-to-6th-hour window does not apply.
    2. **Gap Guardrail**: Do not leave any 2+ bus gap or any 1-bus gap longer than 2 consecutive slots.
    3. **Stagger Changeoffs**: If multiple changeoffs land in the same slot, spread them apart when coverage remains acceptable.
    4. **Trim Surpluses**: If a zone has sustained surplus and coverage remains acceptable, cut a shift earlier or start it later.
    5. **Floater Efficiency**: If a Floater is covering a time where no breaks or gaps exist, move them to a more valuable period.
    
    OUTPUT:
    - Return the FINAL list of shifts.
    `;

  const polisherPrompt = `
    DEMAND:
    ${demandContext}

    REFINED SCHEDULE (Phase 2 Output):
    ${JSON.stringify(criticShifts)}

    TASK:
    - Review every single shift for break compliance.
    - Check every ${SLOT_MINUTES}-minute slot for unacceptable gaps, repeated shortfalls, and inefficient surpluses.
    - Output the polished list.
    `;

  let polishedShifts = criticShifts;
  try {
    const polishedOutput = await callGemini(apiKey, polisherPrompt, polisherSystemInstruction, generatorSchema, 'gemini-3.1-pro-preview', 0.1, 'phase3-polisher', requestId);
    console.log(`[${requestId}] ✅ [Phase 3] Polished Schedule: ${polishedOutput.length} shifts.`);
    polishedShifts = polishedOutput;
  } catch (e) {
    console.error(`[${requestId}] ❌ [Phase 3] Failed. Keeping Phase 2 result.`, e);
  }

  const processedDraft = processShifts(draftShifts, optimizationOptions);
  const processedCritic = processShifts(criticShifts, optimizationOptions);
  const processedPolished = processShifts(polishedShifts, optimizationOptions);
  return chooseBestScheduleCandidate(
    [
      { label: 'phase1-generator', shifts: processedDraft },
      { label: 'phase2-critic', shifts: processedCritic },
      { label: 'phase3-polisher', shifts: processedPolished },
    ],
    requirements,
    optimizationOptions,
    requestId,
  ).shifts;
}
