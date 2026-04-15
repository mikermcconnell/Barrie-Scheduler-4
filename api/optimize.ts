import type { VercelRequest, VercelResponse } from '@vercel/node';
import {
  authenticateFirebaseRequest,
  checkRateLimit,
  getRequestIp,
} from '../lib/apiSecurity.js';
import { shouldUseExtendedOptimizePipeline } from '../functions/src/optimizePipelinePolicy';
import type { OptimizeRequestOptions } from '../utils/onDemandOptimizationSettings';
import {
  getSimultaneousChangeoffPenalty,
  optimizeImplementation as runOptimizeImplementation,
} from '../utils/ai/optimizeCore';

const createServerRequestId = () => `srv-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

type OptimizeRequestBody = {
  requestId?: unknown;
  requirements?: unknown;
  mode?: unknown;
  currentShifts?: unknown;
  focusInstruction?: unknown;
  optimizationOptions?: unknown;
};

function readOptimizeRequestBody(body: VercelRequest['body']): OptimizeRequestBody | null {
  if (typeof body === 'string') {
    try {
      const parsed = JSON.parse(body);
      return parsed && typeof parsed === 'object' ? (parsed as OptimizeRequestBody) : null;
    } catch {
      return null;
    }
  }

  if (body && typeof body === 'object') {
    return body as OptimizeRequestBody;
  }

  return null;
}

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

export { getSimultaneousChangeoffPenalty };

export async function optimizeImplementation(
  requirements: any[],
  apiKey: string,
  mode: 'full' | 'refine' = 'full',
  currentShifts: any[] = [],
  focusInstruction?: string,
  optimizationOptions?: OptimizeRequestOptions,
  requestId = 'unknown',
) {
  const extendedPipeline = shouldUseExtendedOptimizePipeline(
    mode,
    process.env.OPTIMIZE_MULTI_PHASE,
    !process.env.VERCEL,
  );

  return runOptimizeImplementation({
    requirements,
    apiKey,
    mode,
    currentShifts,
    focusInstruction,
    optimizationOptions,
    requestId,
    extendedPipeline,
  });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const parsedBody = readOptimizeRequestBody(req.body);
  const requestId = typeof parsedBody?.requestId === 'string' ? parsedBody.requestId : createServerRequestId();
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

    const requirements = Array.isArray(parsedBody?.requirements) ? parsedBody.requirements : null;
    const mode = parsedBody?.mode === 'refine' ? 'refine' : 'full';
    const currentShifts = Array.isArray(parsedBody?.currentShifts) ? parsedBody.currentShifts : [];
    const focusInstruction = typeof parsedBody?.focusInstruction === 'string'
      ? parsedBody.focusInstruction
      : undefined;
    const optimizationOptions = (
      parsedBody?.optimizationOptions && typeof parsedBody.optimizationOptions === 'object'
        ? parsedBody.optimizationOptions
        : undefined
    ) as OptimizeRequestOptions | undefined;

    if (!requirements) {
      console.error(`[${requestId}] ❌ Invalid requirements payload`);
      return res.status(400).json({ error: 'Missing or invalid requirements data', code: 'INVALID_REQUEST', requestId });
    }

    console.log(`[${requestId}] 📦 Processing ${requirements.length} requirements...`);

    const processedShifts = await optimizeImplementation(
      requirements,
      apiKey,
      mode,
      currentShifts,
      focusInstruction,
      optimizationOptions,
      requestId,
    );
    const durationMs = Date.now() - requestStartedAt;
    const pipeline = shouldUseExtendedOptimizePipeline(mode, process.env.OPTIMIZE_MULTI_PHASE, !process.env.VERCEL)
      ? 'multi-phase'
      : 'fast';
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
