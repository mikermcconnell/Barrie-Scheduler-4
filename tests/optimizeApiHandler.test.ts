import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  authenticateFirebaseRequestMock,
  checkRateLimitMock,
  getRequestIpMock,
  generateContentMock,
  getGenerativeModelMock,
  calculateScheduleMock,
  validateOnDemandScheduleMock,
  sanitizeOptimizerShiftMock,
} = vi.hoisted(() => {
  const authenticateFirebaseRequestMock = vi.fn();
  const checkRateLimitMock = vi.fn();
  const getRequestIpMock = vi.fn();
  const generateContentMock = vi.fn();
  const getGenerativeModelMock = vi.fn(() => ({
    generateContent: generateContentMock,
  }));
  const calculateScheduleMock = vi.fn(() => []);
  const validateOnDemandScheduleMock = vi.fn(() => ({
    coverageViolations: [],
    fleetViolations: [],
    shiftRuleViolations: [],
    breakCoverageViolations: [],
    maxOverlappingShifts: 0,
    maxActiveVehicles: 0,
  }));
  const sanitizeOptimizerShiftMock = vi.fn((shift: any) => ({
    zone: shift.zone ?? 'North',
    startSlot: Number(shift.startSlot) || 0,
    endSlot: (Number(shift.startSlot) || 0) + (Number(shift.durationSlots) || 0),
    breakStartSlot: Number(shift.breakStartSlot) || 0,
    breakDurationSlots: 3,
  }));

  return {
    authenticateFirebaseRequestMock,
    checkRateLimitMock,
    getRequestIpMock,
    generateContentMock,
    getGenerativeModelMock,
    calculateScheduleMock,
    validateOnDemandScheduleMock,
    sanitizeOptimizerShiftMock,
  };
});

vi.mock('../lib/apiSecurity.js', () => ({
  authenticateFirebaseRequest: authenticateFirebaseRequestMock,
  checkRateLimit: checkRateLimitMock,
  getRequestIp: getRequestIpMock,
}));

vi.mock('@google/generative-ai', () => ({
  SchemaType: {
    OBJECT: 'OBJECT',
    ARRAY: 'ARRAY',
    STRING: 'STRING',
    INTEGER: 'INTEGER',
  },
  GoogleGenerativeAI: vi.fn(function GoogleGenerativeAI() {
    return {
      getGenerativeModel: getGenerativeModelMock,
    };
  }),
}));

vi.mock('../utils/dataGenerator', () => ({
  calculateSchedule: calculateScheduleMock,
}));

vi.mock('../utils/onDemandValidation', () => ({
  validateOnDemandSchedule: validateOnDemandScheduleMock,
}));

vi.mock('../utils/onDemandShiftRules', () => ({
  sanitizeOptimizerShift: sanitizeOptimizerShiftMock,
}));

import handler from '../api/optimize';

function createMockResponse() {
  let payload: unknown;
  const response = {
    statusCode: 200,
    body: () => payload,
    status: vi.fn((statusCode: number) => {
      response.statusCode = statusCode;
      return response;
    }),
    json: vi.fn((value: unknown) => {
      payload = value;
      return response;
    }),
  };

  return response;
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.GEMINI_API_KEY = 'test-api-key';
  delete process.env.OPTIMIZE_MULTI_PHASE;
  authenticateFirebaseRequestMock.mockResolvedValue({ uid: 'user-123' });
  checkRateLimitMock.mockReturnValue(true);
  getRequestIpMock.mockReturnValue('127.0.0.1');
  generateContentMock.mockResolvedValue({
    response: {
      text: () => '[]',
    },
  });
});

afterEach(() => {
  delete process.env.GEMINI_API_KEY;
  delete process.env.OPTIMIZE_MULTI_PHASE;
});

describe('optimize API handler', () => {
  it('rejects non-POST requests', async () => {
    const res = createMockResponse();

    await handler({ method: 'GET', body: {} } as any, res as any);

    expect(res.statusCode).toBe(405);
    expect(res.body()).toEqual({
      error: 'Method not allowed. Use POST.',
      code: 'METHOD_NOT_ALLOWED',
      requestId: expect.any(String),
    });
    expect(authenticateFirebaseRequestMock).not.toHaveBeenCalled();
  });

  it('rejects unauthenticated requests', async () => {
    authenticateFirebaseRequestMock.mockResolvedValue(null);
    const res = createMockResponse();

    await handler({ method: 'POST', body: {} } as any, res as any);

    expect(res.statusCode).toBe(401);
    expect(res.body()).toEqual({
      error: 'Authentication required',
      code: 'AUTH_REQUIRED',
      requestId: expect.any(String),
    });
  });

  it('rejects invalid JSON request bodies', async () => {
    const res = createMockResponse();

    await handler({ method: 'POST', body: 'not-json' } as any, res as any);

    expect(res.statusCode).toBe(400);
    expect(res.body()).toEqual({
      error: 'Missing or invalid requirements data',
      code: 'INVALID_REQUEST',
      requestId: expect.any(String),
    });
  });

  it('uses string request bodies and preserves the client requestId', async () => {
    const res = createMockResponse();

    await handler({
      method: 'POST',
      body: JSON.stringify({
        requestId: 'client-req-42',
        requirements: [],
        mode: 'full',
      }),
      headers: {
        authorization: 'Bearer token',
      },
    } as any, res as any);

    expect(getGenerativeModelMock).toHaveBeenCalled();
    expect(generateContentMock).toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
    expect(res.body()).toEqual({
      shifts: [],
      requestId: 'client-req-42',
      durationMs: expect.any(Number),
      pipeline: 'fast',
    });
  });
});
