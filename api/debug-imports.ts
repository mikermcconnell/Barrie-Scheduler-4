import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(_req: VercelRequest, res: VercelResponse) {
    const results: Record<string, string> = {};

    // Test with .js extension (ESM requires it)
    try {
        await import('../lib/apiSecurity.js');
        results.withJsExt = 'OK';
    } catch (e: any) {
        results.withJsExt = e.message;
    }

    // Test without extension
    try {
        await import('../lib/apiSecurity');
        results.withoutExt = 'OK';
    } catch (e: any) {
        results.withoutExt = e.message;
    }

    // List what files exist in /var/task
    try {
        const { readdirSync } = await import('fs');
        try { results.apiFiles = readdirSync('/var/task/api').join(', '); } catch { results.apiFiles = 'N/A'; }
        try { results.libFiles = readdirSync('/var/task/lib').join(', '); } catch { results.libFiles = 'dir not found'; }
        try { results.rootFiles = readdirSync('/var/task').filter((f: string) => !f.startsWith('node_modules')).join(', '); } catch { results.rootFiles = 'N/A'; }
    } catch (e: any) {
        results.fsError = e.message;
    }

    res.status(200).json(results);
}
