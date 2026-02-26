import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(_req: VercelRequest, res: VercelResponse) {
    const results: Record<string, string> = {};

    // Test each import that optimize.ts uses
    try {
        await import('./_security');
        results._security = 'OK';
    } catch (e: any) {
        results._security = e.message;
    }

    try {
        await import('@google/generative-ai');
        results.googleGenAi = 'OK';
    } catch (e: any) {
        results.googleGenAi = e.message;
    }

    // Check what files exist at runtime
    const fs = await import('fs');
    const path = await import('path');
    try {
        const apiDir = path.dirname(__filename);
        results.dirname = apiDir;
        results.files = fs.readdirSync(apiDir).join(', ');
    } catch (e: any) {
        results.fsError = e.message;
    }

    // Also try the direct optimize import
    try {
        const mod = await import('./optimize');
        results.optimize = typeof mod.default === 'function' ? 'OK (has default)' : 'OK (no default)';
    } catch (e: any) {
        results.optimize = e.message;
    }

    res.status(200).json(results);
}
