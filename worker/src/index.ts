/**
 * Cloudflare Worker — CDN Download Proxy
 * 
 * Streams audio files from Akamai CDN through Cloudflare's network
 * to bypass IP-based blocking on datacenter IPs.
 * 
 * Usage: POST with JSON body { "url": "https://...", "secret": "..." }
 * Returns: streamed audio file with original headers
 */

export interface Env {
    PROXY_SECRET: string;
}

export default {
    async fetch(request: Request, env: Env): Promise<Response> {
        // Only accept POST
        if (request.method !== 'POST') {
            return new Response('Method not allowed', { status: 405 });
        }

        // Parse request
        let body: { url?: string; secret?: string };
        try {
            body = await request.json();
        } catch {
            return new Response('Invalid JSON', { status: 400 });
        }

        // Validate secret
        if (body.secret !== env.PROXY_SECRET) {
            return new Response('Unauthorized', { status: 401 });
        }

        // Validate URL
        if (!body.url || !body.url.startsWith('https://')) {
            return new Response('Invalid URL', { status: 400 });
        }

        // Only allow Qobuz CDN domains
        const allowed = ['akamaized.net', 'qobuz.com'];
        const urlObj = new URL(body.url);
        if (!allowed.some(d => urlObj.hostname.endsWith(d))) {
            return new Response('Domain not allowed', { status: 403 });
        }

        // Fetch from CDN and stream through
        try {
            const cdnResponse = await fetch(body.url, {
                headers: {
                    'User-Agent': 'Mozilla/5.0',
                },
            });

            if (!cdnResponse.ok) {
                return new Response(`CDN returned ${cdnResponse.status}`, {
                    status: cdnResponse.status
                });
            }

            // Stream the response through with original content headers
            return new Response(cdnResponse.body, {
                status: 200,
                headers: {
                    'Content-Type': cdnResponse.headers.get('Content-Type') || 'application/octet-stream',
                    'Content-Length': cdnResponse.headers.get('Content-Length') || '',
                },
            });
        } catch (err: any) {
            return new Response(`Proxy error: ${err.message}`, { status: 502 });
        }
    },
};
