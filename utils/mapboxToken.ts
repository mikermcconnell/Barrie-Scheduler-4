export function normalizeMapboxToken(token: string | null | undefined): string | null {
    const normalized = token
        ?.replace(/\\r|\\n|\r|\n/g, '')
        .trim() ?? '';

    return normalized.length > 0 ? normalized : null;
}

export function getClientMapboxToken(): string | null {
    return normalizeMapboxToken(import.meta.env?.VITE_MAPBOX_TOKEN);
}
