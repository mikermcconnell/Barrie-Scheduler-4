import { describe, expect, it } from 'vitest';
import { shouldUseExtendedOptimizePipeline } from '../functions/src/optimizePipelinePolicy';

describe('optimizePipelinePolicy', () => {
    it('keeps full regenerate on the fast path even when the feature flag is enabled', () => {
        expect(shouldUseExtendedOptimizePipeline('full', '1', true)).toBe(false);
    });

    it('allows multi-phase refine runs when the runtime and feature flag allow it', () => {
        expect(shouldUseExtendedOptimizePipeline('refine', '1', true)).toBe(true);
    });

    it('disables the extended pipeline when the runtime blocks it', () => {
        expect(shouldUseExtendedOptimizePipeline('refine', '1', false)).toBe(false);
    });

    it('disables the extended pipeline when the feature flag is off', () => {
        expect(shouldUseExtendedOptimizePipeline('refine', '0', true)).toBe(false);
    });
});
