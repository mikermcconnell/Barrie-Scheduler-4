const devFlagEnabled = (value: string | undefined): boolean => value === '1' || value === 'true';

export interface DevAuthConfig {
    enabled: boolean;
    email: string | null;
    password: string | null;
    label: string;
    autoLogin: boolean;
    teamInviteCode: string | null;
}

export function getDevAuthConfig(): DevAuthConfig {
    const email = import.meta.env.VITE_DEV_AUTH_EMAIL?.trim() || null;
    const password = import.meta.env.VITE_DEV_AUTH_PASSWORD?.trim() || null;
    const teamInviteCode = import.meta.env.VITE_DEV_AUTH_TEAM_INVITE_CODE?.trim().toUpperCase() || null;

    return {
        enabled: import.meta.env.DEV && Boolean(email && password),
        email,
        password,
        label: import.meta.env.VITE_DEV_AUTH_LABEL?.trim() || 'Dev Test Access',
        autoLogin: import.meta.env.DEV && devFlagEnabled(import.meta.env.VITE_DEV_AUTH_AUTO_LOGIN),
        teamInviteCode,
    };
}

