import type { VercelRequest } from '@vercel/node';

const DEFAULT_DOWNLOAD_HOSTS = [
    'firebasestorage.googleapis.com',
    'storage.googleapis.com',
];

const DEFAULT_GTFS_HOSTS = [
    'www.myridebarrie.ca',
    'myridebarrie.ca',
    'assets.metrolinx.com',
];

type UrlValidationResult =
    | { ok: true; parsedUrl: URL }
    | { ok: false; reason: string };

function parseHostAllowlist(rawValue: string | undefined, defaults: string[]): string[] {
    const source = rawValue && rawValue.trim().length > 0 ? rawValue : defaults.join(',');
    return source
        .split(',')
        .map(host => host.trim().toLowerCase())
        .filter(Boolean);
}

function hostMatchesRule(hostname: string, rule: string): boolean {
    if (rule.startsWith('*.')) {
        const suffix = rule.slice(1); // ".example.com"
        return hostname.endsWith(suffix) && hostname.length > suffix.length;
    }
    return hostname === rule;
}

function isAllowedHost(hostname: string, allowlist: string[]): boolean {
    const normalized = hostname.toLowerCase();
    return allowlist.some(rule => hostMatchesRule(normalized, rule));
}

function validateHttpsUrl(url: string): UrlValidationResult {
    let parsedUrl: URL;
    try {
        parsedUrl = new URL(url);
    } catch {
        return { ok: false, reason: 'Invalid URL format' };
    }

    if (parsedUrl.protocol !== 'https:') {
        return { ok: false, reason: 'Only HTTPS URLs are allowed' };
    }
    if (parsedUrl.username || parsedUrl.password) {
        return { ok: false, reason: 'Credentials in URL are not allowed' };
    }
    if (parsedUrl.port) {
        return { ok: false, reason: 'Custom URL ports are not allowed' };
    }

    return { ok: true, parsedUrl };
}

export function validateDownloadUrl(downloadUrl: string): UrlValidationResult {
    const basicValidation = validateHttpsUrl(downloadUrl);
    if (!basicValidation.ok) return basicValidation;

    const { parsedUrl } = basicValidation;
    const allowlist = parseHostAllowlist(process.env.DOWNLOAD_PROXY_ALLOWED_HOSTS, DEFAULT_DOWNLOAD_HOSTS);

    if (!isAllowedHost(parsedUrl.hostname, allowlist)) {
        return { ok: false, reason: `Host "${parsedUrl.hostname}" is not allowed` };
    }

    const pathname = parsedUrl.pathname.toLowerCase();
    if (parsedUrl.hostname === 'firebasestorage.googleapis.com' && !pathname.startsWith('/v0/b/')) {
        return { ok: false, reason: 'Invalid Firebase Storage URL format' };
    }
    if (parsedUrl.hostname === 'storage.googleapis.com' && pathname.length <= 1) {
        return { ok: false, reason: 'Invalid Google Cloud Storage URL format' };
    }

    return { ok: true, parsedUrl };
}

export function validateGtfsUrl(feedUrl: string): UrlValidationResult {
    const basicValidation = validateHttpsUrl(feedUrl);
    if (!basicValidation.ok) return basicValidation;

    const { parsedUrl } = basicValidation;
    const allowlist = parseHostAllowlist(process.env.GTFS_ALLOWED_HOSTS, DEFAULT_GTFS_HOSTS);

    if (!isAllowedHost(parsedUrl.hostname, allowlist)) {
        return { ok: false, reason: `Host "${parsedUrl.hostname}" is not allowed` };
    }

    if (!parsedUrl.pathname.toLowerCase().endsWith('.zip')) {
        return { ok: false, reason: 'GTFS URL must end with .zip' };
    }

    return { ok: true, parsedUrl };
}

export function getRequestIp(req: VercelRequest): string {
    const forwardedFor = req.headers['x-forwarded-for'];
    if (typeof forwardedFor === 'string' && forwardedFor.length > 0) {
        return forwardedFor.split(',')[0].trim();
    }
    return req.socket?.remoteAddress || 'unknown-ip';
}

type RateLimitState = {
    count: number;
    windowStartedAt: number;
};

const RATE_LIMIT_STATE = new Map<string, RateLimitState>();

export function checkRateLimit(key: string, limit: number, windowMs: number): boolean {
    const now = Date.now();

    // Opportunistic cleanup to avoid unbounded growth.
    if (RATE_LIMIT_STATE.size > 2000) {
        for (const [stateKey, state] of RATE_LIMIT_STATE.entries()) {
            if (now - state.windowStartedAt >= windowMs) {
                RATE_LIMIT_STATE.delete(stateKey);
            }
        }
    }

    const state = RATE_LIMIT_STATE.get(key);
    if (!state || now - state.windowStartedAt >= windowMs) {
        RATE_LIMIT_STATE.set(key, { count: 1, windowStartedAt: now });
        return true;
    }

    if (state.count >= limit) {
        return false;
    }

    state.count += 1;
    return true;
}

function getFirebaseWebApiKey(): string {
    return (
        process.env.FIREBASE_WEB_API_KEY ||
        process.env.VITE_FIREBASE_API_KEY ||
        ''
    );
}

export interface AuthenticatedUser {
    uid: string;
    email?: string;
}

export async function authenticateFirebaseRequest(req: VercelRequest): Promise<AuthenticatedUser | null> {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return null;
    }

    const idToken = authHeader.slice('Bearer '.length).trim();
    if (!idToken) {
        return null;
    }
    const firebaseApiKey = getFirebaseWebApiKey();
    if (!firebaseApiKey) {
        return null;
    }

    try {
        const response = await fetch(
            `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(firebaseApiKey)}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ idToken }),
            }
        );

        if (!response.ok) {
            return null;
        }

        const payload = await response.json() as { users?: Array<{ localId?: string; email?: string }> };
        const user = payload.users?.[0];
        if (!user?.localId) {
            return null;
        }

        return {
            uid: user.localId,
            email: user.email,
        };
    } catch {
        return null;
    }
}
