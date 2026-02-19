import type { VercelRequest, VercelResponse } from '@vercel/node';
import { checkRateLimit, getRequestIp, validateDownloadUrl } from './security';

/**
 * Serverless proxy for downloading files from Firebase Storage
 * This bypasses CORS issues when running on localhost
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
    // Only allow POST requests
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    let body: Record<string, unknown>;
    try {
        body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    } catch {
        return res.status(400).json({ error: 'Invalid JSON request body' });
    }
    const { downloadUrl, format = 'text' } = body;

    if (!downloadUrl || typeof downloadUrl !== 'string') {
        return res.status(400).json({ error: 'Missing downloadUrl' });
    }
    if (format !== 'text' && format !== 'base64') {
        return res.status(400).json({ error: 'Invalid format. Use "text" or "base64".' });
    }

    const urlValidation = validateDownloadUrl(downloadUrl);
    if (!urlValidation.ok) {
        const errorReason = 'reason' in urlValidation ? urlValidation.reason : 'Invalid download URL';
        return res.status(400).json({ error: errorReason });
    }

    const requestIp = getRequestIp(req);
    const rateKey = `download-proxy:${requestIp}`;
    const allowed = checkRateLimit(rateKey, 120, 60 * 60 * 1000);
    if (!allowed) {
        return res.status(429).json({ error: 'Rate limit exceeded. Please try again later.' });
    }

    try {
        console.log('Proxying file download:', downloadUrl, 'Format:', format);

        const abortController = new AbortController();
        const timeout = setTimeout(() => abortController.abort(), 30_000);

        // Fetch the file content server-side with strict URL allowlisting.
        const response = await fetch(urlValidation.parsedUrl.toString(), {
            signal: abortController.signal,
        }).finally(() => clearTimeout(timeout));

        if (!response.ok) {
            throw new Error(`Failed to fetch: ${response.status} ${response.statusText}`);
        }

        const declaredLength = Number(response.headers.get('content-length') || 0);
        const maxBytes = 25 * 1024 * 1024;
        if (declaredLength > maxBytes) {
            return res.status(413).json({ error: 'File too large for proxy download' });
        }

        const arrayBuffer = await response.arrayBuffer();
        if (arrayBuffer.byteLength > maxBytes) {
            return res.status(413).json({ error: 'File too large for proxy download' });
        }

        const buffer = Buffer.from(arrayBuffer);
        let content;
        if (format === 'base64') {
            content = buffer.toString('base64');
        } else {
            content = buffer.toString('utf8');
        }

        console.log('Downloaded content length:', content.length);

        return res.status(200).json({
            success: true,
            content,
            format
        });
    } catch (error: any) {
        console.error('File download proxy error:', error);
        return res.status(500).json({
            error: 'Failed to download file',
            details: error?.message || 'Unknown error',
        });
    }
}
