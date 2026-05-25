export const INVITE_CODE_PATTERN = /^[A-Z0-9]{6}$/;

export function normalizeInviteCode(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const normalized = value.trim().toUpperCase();
    return INVITE_CODE_PATTERN.test(normalized) ? normalized : null;
}

export function extractInviteCodeFromUrlParts(search: string, hash: string): string | null {
    const searchParams = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
    const searchCode = normalizeInviteCode(searchParams.get('invite') ?? searchParams.get('team'));
    if (searchCode) return searchCode;

    const cleanHash = hash.startsWith('#') ? hash.slice(1) : hash;
    const joinMatch = cleanHash.match(/^\/?join\/([A-Za-z0-9]{6})$/);
    if (joinMatch) return normalizeInviteCode(joinMatch[1]);

    const hashQueryIndex = cleanHash.indexOf('?');
    if (hashQueryIndex >= 0) {
        const hashParams = new URLSearchParams(cleanHash.slice(hashQueryIndex + 1));
        return normalizeInviteCode(hashParams.get('invite') ?? hashParams.get('team'));
    }

    return null;
}

export function getPendingInviteCode(): string | null {
    if (typeof window === 'undefined') return null;
    return extractInviteCodeFromUrlParts(window.location.search, window.location.hash);
}

export function buildInviteLink(baseUrl: string, inviteCode: string): string {
    const code = normalizeInviteCode(inviteCode);
    if (!code) {
        throw new Error('Invalid invite code');
    }

    const url = new URL(baseUrl);
    url.searchParams.set('invite', code);
    return url.toString();
}

export function buildInviteLinkForCurrentLocation(inviteCode: string): string {
    if (typeof window === 'undefined') return buildInviteLink('https://scheduler.local/', inviteCode);
    return buildInviteLink(`${window.location.origin}${window.location.pathname}`, inviteCode);
}

export function clearInviteCodeFromUrlParts(pathname: string, search: string, hash: string): {
    pathname: string;
    search: string;
    hash: string;
} {
    const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
    params.delete('invite');
    params.delete('team');
    const nextSearch = params.toString();

    const cleanHash = hash.startsWith('#') ? hash.slice(1) : hash;
    const shouldClearHash = /^\/?join\/[A-Za-z0-9]{6}$/.test(cleanHash) || /^\/?join\?/.test(cleanHash);

    return {
        pathname,
        search: nextSearch ? `?${nextSearch}` : '',
        hash: shouldClearHash ? '' : hash,
    };
}

export function clearPendingInviteCodeFromUrl(): void {
    if (typeof window === 'undefined') return;
    const next = clearInviteCodeFromUrlParts(
        window.location.pathname,
        window.location.search,
        window.location.hash,
    );
    window.history.replaceState(null, '', `${next.pathname}${next.search}${next.hash}`);
}
