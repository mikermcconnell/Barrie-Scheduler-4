import type {
    ApprovedRuntimeContract,
    Step2ApprovedBy,
    Step2ReviewResult,
    Step2SourceSnapshot,
} from './step2ReviewTypes';

export interface Step2ApprovalCreationInput {
    reviewResult: Step2ReviewResult;
    sourceSnapshot: Step2SourceSnapshot;
    approvedAt: string;
    approvedBy?: Step2ApprovedBy;
    acknowledgedWarnings?: string[];
}

const normalizeWarningList = (warnings?: string[]): string[] | undefined => {
    if (!warnings || warnings.length === 0) return undefined;

    const normalized = Array.from(new Set(
        warnings.map(warning => warning.trim()).filter(Boolean)
    ));

    return normalized.length > 0 ? normalized : undefined;
};

const cloneSnapshotValue = <T>(value: T): T => {
    if (typeof structuredClone === 'function') {
        return structuredClone(value);
    }

    return JSON.parse(JSON.stringify(value)) as T;
};

export const canCreateStep2Approval = (input: Step2ApprovalCreationInput): boolean => {
    const { reviewResult } = input;

    if (reviewResult.lifecycle !== 'reviewable') return false;
    if (!reviewResult.approvalEligible) return false;
    if (reviewResult.health.status === 'blocked') return false;
    if (!reviewResult.inputFingerprint.trim()) return false;

    return true;
};

export const createStep2ApprovedRuntimeContract = (
    input: Step2ApprovalCreationInput
): ApprovedRuntimeContract | null => {
    if (!canCreateStep2Approval(input)) return null;

    const { reviewResult, sourceSnapshot, approvedAt, approvedBy, acknowledgedWarnings } = input;
    const normalizedAcknowledgedWarnings = normalizeWarningList(
        acknowledgedWarnings ?? (reviewResult.health.status === 'warning' ? reviewResult.health.warnings : undefined)
    );
    const normalizedSourceSnapshot = {
        performanceRouteId: sourceSnapshot.performanceRouteId?.trim(),
        performanceDateRange: sourceSnapshot.performanceDateRange
            ? {
                start: sourceSnapshot.performanceDateRange.start.trim(),
                end: sourceSnapshot.performanceDateRange.end.trim(),
            }
            : null,
        runtimeLogicVersion: sourceSnapshot.runtimeLogicVersion,
        importedAt: sourceSnapshot.importedAt?.trim(),
        stopOrderDecision: sourceSnapshot.stopOrderDecision,
        stopOrderConfidence: sourceSnapshot.stopOrderConfidence,
        stopOrderSource: sourceSnapshot.stopOrderSource,
    };

    return {
        schemaVersion: 1,
        routeIdentity: reviewResult.routeIdentity,
        routeNumber: reviewResult.routeNumber,
        dayType: reviewResult.dayType,
        importMode: reviewResult.importMode,
        inputFingerprint: reviewResult.inputFingerprint,
        approvalState: 'approved',
        readinessStatus: reviewResult.health.status === 'warning' ? 'warning' : 'ready',
        approvedAt,
        ...(approvedBy ? { approvedBy } : {}),
        ...(normalizedAcknowledgedWarnings ? { acknowledgedWarnings: normalizedAcknowledgedWarnings } : {}),
        sourceSnapshot: cloneSnapshotValue(normalizedSourceSnapshot),
        planning: cloneSnapshotValue(reviewResult.planning),
        healthSnapshot: cloneSnapshotValue(reviewResult.health),
    };
};
