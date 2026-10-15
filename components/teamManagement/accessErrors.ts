export function isPermissionDeniedError(error: unknown): boolean {
    if (!error || typeof error !== 'object') return false;
    const code = 'code' in error ? String((error as { code?: unknown }).code ?? '') : '';
    const message = 'message' in error ? String((error as { message?: unknown }).message ?? '') : '';
    return code.includes('permission-denied') || message.toLowerCase().includes('permission');
}

export function getAccessSaveErrorMessage(error: unknown): string {
    if (isPermissionDeniedError(error)) {
        return 'Permission denied while saving access. Try again after refreshing your admin session.';
    }
    return 'Failed to save access. Please try again.';
}

interface TokenRefreshable {
    getIdToken: (forceRefresh?: boolean) => Promise<string>;
}

/**
 * Admin claims can lag behind a fresh sign-in. On a permission error, refresh the
 * ID token once and retry the same write.
 */
export async function retryOnceAfterTokenRefresh<T>(
    user: TokenRefreshable | null,
    run: () => Promise<T>,
): Promise<T> {
    try {
        return await run();
    } catch (error) {
        if (!isPermissionDeniedError(error) || !user) throw error;
        await user.getIdToken(true);
        return run();
    }
}
