const isTruthy = (value?: string) => ['1', 'true', 'yes', 'on'].includes((value || '').toLowerCase());

export type OptimizeMode = 'full' | 'refine';

export function shouldUseExtendedOptimizePipeline(
    mode: OptimizeMode,
    featureFlagValue?: string,
    runtimeAllowsExtendedPipeline: boolean = true
): boolean {
    if (!runtimeAllowsExtendedPipeline) {
        return false;
    }

    if (!isTruthy(featureFlagValue)) {
        return false;
    }

    return mode === 'refine';
}
