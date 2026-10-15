// Storage generations are `{epochMs}` (browser saves, bootstrap scripts) or
// `{epochMs}-{uuid}` (server imports, see buildPerformanceGenerationId).
// Path validators must accept both or the next import after a server save fails.
export const PERFORMANCE_GENERATION_PATTERN = '\\d+(?:-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})?';

export function performanceGenerationFilePattern(suffix = ''): RegExp {
    return new RegExp(`^${PERFORMANCE_GENERATION_PATTERN}${suffix}[.]json$`);
}
