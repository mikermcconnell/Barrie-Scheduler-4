const devFlagEnabled = (value: string | undefined): boolean => value === '1' || value === 'true';

const readDevEnv = (key: string): string | undefined => {
    if (!isLocalDevHost()) return undefined;
    return (import.meta.env as Record<string, string | undefined>)[key];
};

const isLocalDevHost = (): boolean => {
    if (typeof window === 'undefined') return false;
    return ['localhost', '127.0.0.1', '::1'].includes(window.location.hostname);
};

export interface DevAuthConfig {
    enabled: boolean;
    email: string | null;
    password: string | null;
    label: string;
    autoLogin: boolean;
    teamInviteCode: string | null;
}

export function getDevAuthConfig(): DevAuthConfig {
    const email = readDevEnv('VITE_DEV_AUTH_EMAIL')?.trim() || null;
    const password = readDevEnv('VITE_DEV_AUTH_PASSWORD')?.trim() || null;
    const teamInviteCode = readDevEnv('VITE_DEV_AUTH_TEAM_INVITE_CODE')?.trim().toUpperCase() || null;
    const enabled = isLocalDevHost() && Boolean(email && password);

    return {
        enabled,
        email,
        password,
        label: readDevEnv('VITE_DEV_AUTH_LABEL')?.trim() || 'Dev Test Access',
        autoLogin: enabled && devFlagEnabled(readDevEnv('VITE_DEV_AUTH_AUTO_LOGIN')),
        teamInviteCode,
    };
}
