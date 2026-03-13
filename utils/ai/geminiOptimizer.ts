import { Requirement, Shift, Zone } from "../demandTypes";
import {
  SHIFT_DURATION_SLOTS,
  BREAK_DURATION_SLOTS,
  BREAK_THRESHOLD_HOURS
} from "../demandConstants";
import { auth } from "../firebase";
import {
  isRetryableOptimizeFailure,
  parseOptimizeMaxRetries,
  parseOptimizeTimeoutMs
} from "./optimizePolicy";
import type { OptimizeRequestOptions } from "../onDemandOptimizationSettings";

export type OptimizationSource = 'ai' | 'fallback';
export type OptimizationPipeline = 'fast' | 'multi-phase';
export interface OptimizationResult {
  shifts: Shift[];
  source: OptimizationSource;
  durationMs: number;
  warning?: string;
  requestId: string;
  failureCode?: string;
  pipeline?: OptimizationPipeline;
}

type OptimizeApiResponse = {
  shifts?: Shift[];
  error?: string;
  code?: string;
  message?: string;
  requestId?: string;
  durationMs?: number;
  pipeline?: OptimizationPipeline;
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
const REQUEST_TIMEOUT_MS = parseOptimizeTimeoutMs(import.meta.env.VITE_OPTIMIZE_TIMEOUT_MS);
const MAX_RETRIES_PER_ENDPOINT = parseOptimizeMaxRetries(import.meta.env.VITE_OPTIMIZE_MAX_RETRIES);
const ENDPOINT_OVERRIDE = (import.meta.env.VITE_OPTIMIZE_API_URL || '').trim();
const isTruthy = (value?: string) => ['1', 'true', 'yes', 'on'].includes((value || '').toLowerCase());

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const createRequestId = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `opt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
};

const isLocalOptimizeHost = (): boolean => {
  if (typeof window === 'undefined') return false;
  return ['localhost', '127.0.0.1'].includes(window.location.hostname);
};

const isProductionVercelFallbackEnabled = (): boolean =>
  isTruthy(import.meta.env.VITE_ENABLE_VERCEL_OPTIMIZE_FALLBACK);

const getEndpointCandidates = (): string[] => {
  const urls = ENDPOINT_OVERRIDE
    ? [ENDPOINT_OVERRIDE]
    : isLocalOptimizeHost()
      ? ['/api/optimize', CLOUD_RUN_OPTIMIZE_URL]
      : isProductionVercelFallbackEnabled()
        ? [CLOUD_RUN_OPTIMIZE_URL, '/api/optimize']
        : [CLOUD_RUN_OPTIMIZE_URL];

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

const parseSuccessPayload = async (response: Response, endpoint: string): Promise<OptimizeApiResponse> => {
  let data: OptimizeApiResponse;

  try {
    data = await response.json() as OptimizeApiResponse;
  } catch {
    const failure = new Error('Optimizer returned invalid JSON') as RequestFailure;
    failure.endpoint = endpoint;
    failure.code = 'INVALID_RESPONSE';
    failure.retryable = true;
    throw failure;
  }

  if (!Array.isArray(data.shifts)) {
    const failure = new Error('Optimizer returned an invalid response') as RequestFailure;
    failure.endpoint = endpoint;
    failure.code = 'INVALID_RESPONSE';
    failure.retryable = true;
    throw failure;
  }

  return data;
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
    optimizationOptions?: OptimizeRequestOptions;
    requestId: string;
  },
  externalSignal?: AbortSignal
): Promise<OptimizeApiResponse> => {
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
    failure.retryable = !isTimeout;
    throw failure;
  }

  if (!response.ok) {
    const parsed = await parseErrorPayload(response);
    const failure = new Error(parsed.message) as RequestFailure;
    failure.endpoint = endpoint;
    failure.status = response.status;
    failure.code = parsed.code;
    failure.retryable = isRetryableOptimizeFailure(response.status, parsed.code);
    throw failure;
  }

  return await parseSuccessPayload(response, endpoint);
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
  optimizationOptions?: OptimizeRequestOptions,
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
      optimizationOptions,
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
          const responseData = await requestOptimization(endpoint, idToken, payload, externalSignal);
          const durationMs = Date.now() - startedAt;
          const resolvedRequestId = responseData.requestId || requestId;
          console.log(`[${resolvedRequestId}] Optimization succeeded via ${endpoint} in ${durationMs}ms`);
          return {
            shifts: responseData.shifts || [],
            source: 'ai',
            durationMs,
            requestId: resolvedRequestId,
            pipeline: responseData.pipeline
          };
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
    const fallbackShifts = localOptimizationFallback(requirements, optimizationOptions);
    const failureCode = (error as RequestFailure | undefined)?.code || 'UNKNOWN';
    return {
      shifts: fallbackShifts,
      source: 'fallback',
      durationMs,
      warning: 'AI optimization did not finish. A heuristic fallback schedule was used.',
      requestId,
      failureCode
    };
  }
};

/**
 * Local fallback optimization (used when running on localhost)
 * This is a simple heuristic-based scheduler that doesn't need an API key
 */
function localOptimizationFallback(
  requirements: Requirement[],
  optimizationOptions?: OptimizeRequestOptions,
): Shift[] {
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
  const configuredCap = optimizationOptions?.maxShiftCount;
  const maxShifts = Math.min(
    configuredCap && configuredCap > 0 ? configuredCap : 15,
    Math.ceil(peakHours.length * 1.2),
  );

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
