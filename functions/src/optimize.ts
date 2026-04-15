import * as admin from 'firebase-admin';
import { onRequest } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import { shouldUseExtendedOptimizePipeline } from './optimizePipelinePolicy';
import type { OptimizeRequestOptions } from '../../utils/onDemandOptimizationSettings';
import { optimizeImplementation } from '../../utils/ai/optimizeCore';

const GEMINI_API_KEY = defineSecret('GEMINI_API_KEY');
const createServerRequestId = () => `srv-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

type OptimizeRequestBody = {
  requestId?: unknown;
  requirements?: unknown;
  mode?: unknown;
  currentShifts?: unknown;
  focusInstruction?: unknown;
  optimizationOptions?: unknown;
};

function readOptimizeRequestBody(body: unknown): OptimizeRequestBody | null {
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
    const parsedBody = readOptimizeRequestBody(req.body);
    const requestId = typeof parsedBody?.requestId === 'string' ? parsedBody.requestId : createServerRequestId();
    const requestStartedAt = Date.now();
    console.log(`[${requestId}] 🚀 Optimization Request Received`);

    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Method not allowed. Use POST.', code: 'METHOD_NOT_ALLOWED', requestId });
      return;
    }

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
        res.status(400).json({ error: 'Missing or invalid requirements data', code: 'INVALID_REQUEST', requestId });
        return;
      }

      console.log(`[${requestId}] 📦 Processing ${requirements.length} requirements...`);

      const extendedPipeline = shouldUseExtendedOptimizePipeline(mode, process.env.OPTIMIZE_MULTI_PHASE);
      const processedShifts = await optimizeImplementation({
        requirements,
        apiKey,
        mode,
        currentShifts,
        focusInstruction,
        optimizationOptions,
        requestId,
        extendedPipeline,
      });
      const durationMs = Date.now() - requestStartedAt;
      const pipeline = extendedPipeline ? 'multi-phase' : 'fast';
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
  },
);
