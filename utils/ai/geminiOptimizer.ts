import { Requirement, Shift, Zone } from "../demandTypes";
import {
  SHIFT_DURATION_SLOTS,
  BREAK_DURATION_SLOTS,
  BREAK_THRESHOLD_HOURS
} from "../demandConstants";
import { auth } from "../firebase";

export type OptimizationSource = 'ai' | 'fallback';
export interface OptimizationResult {
  shifts: Shift[];
  source: OptimizationSource;
  durationMs: number;
  warning?: string;
  requestId: string;
}

type OptimizeApiResponse = {
  shifts?: Shift[];
  error?: string;
  code?: string;
  message?: string;
  requestId?: string;
};

type ParsedApiError = {
  message: string;
  code?: string;
};

type RequestFailure = Error & {
  endpoint: string;
  status?: number;
  code?: string;
  retryable: boolean;
};

const CLOUD_RUN_OPTIMIZE_URL = 'https://optimizeschedule-ieeja7khcq-uc.a.run.app';
const REQUEST_TIMEOUT_MS = Number(import.meta.env.VITE_OPTIMIZE_TIMEOUT_MS || 300000);
const MAX_RETRIES_PER_ENDPOINT = Math.max(0, Number(import.meta.env.VITE_OPTIMIZE_MAX_RETRIES || 1));
const ENDPOINT_OVERRIDE = (import.meta.env.VITE_OPTIMIZE_API_URL || '').trim();

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const createRequestId = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `opt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
};

const getEndpointCandidates = (): string[] => {
  const urls = [
    ENDPOINT_OVERRIDE,
    '/api/optimize',
    CLOUD_RUN_OPTIMIZE_URL
  ].filter(Boolean);

  return Array.from(new Set(urls));
};

const parseErrorPayload = async (response: Response): Promise<ParsedApiError> => {
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    const data = await response.json() as OptimizeApiResponse;
    return {
      message: data.error || data.message || `HTTP ${response.status}`,
      code: data.code
    };
  }

  const text = await response.text();
  return {
    message: text || `HTTP ${response.status}`
  };
};

const isRetryableFailure = (status?: number, code?: string): boolean => {
  if (!status) return true;
  if (status === 404 || status === 408 || status === 429) return true;
  if (status >= 500) return true;
  if (code === 'TIMEOUT' || code === 'UPSTREAM') return true;
  return false;
};

const fetchWithTimeout = async (url: string, options: RequestInit, timeoutMs: number, externalSignal?: AbortSignal): Promise<Response> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  // Link external signal so caller can cancel the request
  const onExternalAbort = () => controller.abort();
  externalSignal?.addEventListener('abort', onExternalAbort);

  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
    externalSignal?.removeEventListener('abort', onExternalAbort);
  }
};

const requestOptimization = async (
  endpoint: string,
  idToken: string,
  payload: {
    requirements: Requirement[];
    mode: 'full' | 'refine';
    currentShifts: any[];
    focusInstruction?: string;
    requestId: string;
  },
  externalSignal?: AbortSignal
): Promise<Shift[]> => {
  let response: Response;
  try {
    response = await fetchWithTimeout(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${idToken}`,
      },
      body: JSON.stringify(payload),
    }, REQUEST_TIMEOUT_MS, externalSignal);
  } catch (error) {
    const isTimeout = error instanceof DOMException && error.name === 'AbortError';
    const failure = new Error(isTimeout ? `Request timed out after ${REQUEST_TIMEOUT_MS}ms` : 'Network error') as RequestFailure;
    failure.endpoint = endpoint;
    failure.code = isTimeout ? 'CLIENT_TIMEOUT' : 'NETWORK';
    failure.retryable = true;
    throw failure;
  }

  if (!response.ok) {
    const parsed = await parseErrorPayload(response);
    const failure = new Error(parsed.message) as RequestFailure;
    failure.endpoint = endpoint;
    failure.status = response.status;
    failure.code = parsed.code;
    failure.retryable = isRetryableFailure(response.status, parsed.code);
    throw failure;
  }

  const data = await response.json() as OptimizeApiResponse;
  return data.shifts || [];
};

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
  focusInstruction?: string,
  externalSignal?: AbortSignal
): Promise<OptimizationResult> => {
  const requestId = createRequestId();
  const endpoints = getEndpointCandidates();
  const startedAt = Date.now();

  try {
    // Check if already cancelled before starting
    if (externalSignal?.aborted) {
      return { shifts: [], source: 'fallback', durationMs: 0, warning: 'Cancelled', requestId };
    }

    console.log(`[${requestId}] Calling Gemini Optimization API (Model: gemini-3.1-pro-preview)... Mode: ${mode}`);
    const currentUser = auth.currentUser;
    if (!currentUser) {
      throw new Error('Authentication required');
    }

    const idToken = await currentUser.getIdToken();
    const payload = {
      requirements,
      mode,
      currentShifts,
      focusInstruction,
      requestId
    };

    let lastError: RequestFailure | null = null;
    for (const endpoint of endpoints) {
      for (let attempt = 0; attempt <= MAX_RETRIES_PER_ENDPOINT; attempt++) {
        // Check cancellation between attempts
        if (externalSignal?.aborted) {
          return { shifts: [], source: 'fallback', durationMs: Date.now() - startedAt, warning: 'Cancelled', requestId };
        }

        try {
          console.log(`[${requestId}] Optimize request attempt ${attempt + 1} to ${endpoint}`);
          const shifts = await requestOptimization(endpoint, idToken, payload, externalSignal);
          const durationMs = Date.now() - startedAt;
          console.log(`[${requestId}] Optimization succeeded via ${endpoint} in ${durationMs}ms`);
          return { shifts, source: 'ai', durationMs, requestId };
        } catch (error) {
          // If externally aborted, return cancelled immediately
          if (externalSignal?.aborted) {
            return { shifts: [], source: 'fallback', durationMs: Date.now() - startedAt, warning: 'Cancelled', requestId };
          }

          const failure = error as RequestFailure;
          lastError = failure;
          console.warn(
            `[${requestId}] Optimization attempt failed via ${endpoint} (attempt ${attempt + 1}):`,
            {
              status: failure.status,
              code: failure.code,
              message: failure.message,
              retryable: failure.retryable
            }
          );

          if (!failure.retryable) break;
          if (attempt < MAX_RETRIES_PER_ENDPOINT) {
            await sleep((attempt + 1) * 600);
            continue;
          }
          break;
        }
      }
    }

    if (lastError) {
      const code = lastError.code || 'UNKNOWN';
      throw new Error(`Optimization failed (${code}): ${lastError.message}`);
    }
    throw new Error('Optimization failed: No endpoint available');

  } catch (error) {
    const durationMs = Date.now() - startedAt;
    console.error(`[${requestId}] Optimization failed after ${durationMs}ms:`, error);
    const fallbackShifts = localOptimizationFallback(requirements);
    return {
      shifts: fallbackShifts,
      source: 'fallback',
      durationMs,
      warning: `AI optimization failed — used heuristic fallback. ${error instanceof Error ? error.message : ''}`,
      requestId
    };
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
