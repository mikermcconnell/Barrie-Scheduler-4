import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  generateContentMock,
  getGenerativeModelMock,
  calculateScheduleMock,
  validateOnDemandScheduleMock,
  sanitizeOptimizerShiftMock,
} = vi.hoisted(() => {
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
  const sanitizeOptimizerShiftMock = vi.fn((shift: any, breakDurationSlots: number) => ({
    zone: shift.zone ?? 'North',
    startSlot: Number(shift.startSlot) || 0,
    endSlot: (Number(shift.startSlot) || 0) + (Number(shift.durationSlots) || 0),
    breakStartSlot: Number(shift.breakStartSlot) || 0,
    breakDurationSlots,
  }));

  return {
    generateContentMock,
    getGenerativeModelMock,
    calculateScheduleMock,
    validateOnDemandScheduleMock,
    sanitizeOptimizerShiftMock,
  };
});

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

import { optimizeImplementation } from '../utils/ai/optimizeCore';

beforeEach(() => {
  vi.clearAllMocks();
  generateContentMock.mockResolvedValue({
    response: {
      text: () => JSON.stringify([
        {
          driverName: 'Driver 1',
          zone: 'North',
          startSlot: 0,
          durationSlots: 20,
          breakStartSlot: 16,
        },
      ]),
    },
  });
});

describe('shared optimize core', () => {
  it('uses configured break settings in the generated rules', async () => {
    await optimizeImplementation({
      requirements: [{ slotIndex: 0, total: 1, north: 1, south: 0 }],
      apiKey: 'api-key',
      mode: 'full',
      currentShifts: [],
      optimizationOptions: { breakDurationMinutes: 60 },
      requestId: 'req-1',
      extendedPipeline: false,
    });

    const firstCall = (getGenerativeModelMock.mock.calls as unknown as Array<[any]>)[0];
    expect(firstCall).toBeDefined();
    const [config] = firstCall!;
    expect(config.systemInstruction).toContain('Use 60min (12 slots) as the default lunch length');
  });
});
