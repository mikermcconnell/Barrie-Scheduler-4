import { isDirectionVariant } from '../../../utils/config/routeDirectionConfig';

const getNumericBase = (routeNumber: string): string | undefined => {
    return routeNumber.match(/^(\d+)/)?.[1];
};

/**
 * Resolve the auto-detected route number from uploaded runtime files.
 *
 * Rules:
 * - Single file: use that file's detected route number
 * - Two files with same route: keep as-is
 * - Two files with different A/B variants:
 *   - Merge only when A/B indicates direction (e.g., 12A + 12B => 12)
 *   - Do NOT merge separate variants (e.g., 8A + 8B stay separate)
 */
export const resolveAutoRouteNumber = (
    detectedRouteNumbers: Array<string | undefined>
): string | undefined => {
    const normalized = detectedRouteNumbers
        .map(value => value?.trim().toUpperCase())
        .filter((value): value is string => !!value);

    if (normalized.length === 0) return undefined;
    if (normalized.length === 1) return normalized[0];

    const [first, second] = normalized;
    if (!second || first === second) return first;

    const firstBase = getNumericBase(first);
    const secondBase = getNumericBase(second);
    if (!firstBase || firstBase !== secondBase) {
        return first;
    }

    const shouldMergeToBase = isDirectionVariant(first) && isDirectionVariant(second);
    return shouldMergeToBase ? firstBase : first;
};
