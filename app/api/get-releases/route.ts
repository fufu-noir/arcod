import { NextRequest, NextResponse } from 'next/server';
import z from 'zod';

const schema = z.object({
    artist_id: z.string().min(1),
    release_type: z.enum(['album', 'live', 'compilation', 'epSingle', 'download']).default('album'),
    track_size: z.preprocess((a) => { const n = parseInt(a as string); return isNaN(n) ? 1000 : n; }, z.number().default(1000)),
    offset: z.preprocess((a) => { const n = parseInt(a as string); return isNaN(n) ? 0 : n; }, z.number().min(0).default(0)),
    limit: z.preprocess((a) => { const n = parseInt(a as string); return isNaN(n) ? 10 : n; }, z.number().min(1).default(10))
});

const BACKEND_URL = process.env.NEXT_PUBLIC_AWS_API_URL;

export async function GET(request: NextRequest) {
    const country = request.headers.get('Token-Country');
    const params = Object.fromEntries(new URL(request.url).searchParams.entries());
    try {
        const { artist_id, release_type, offset, limit } = schema.parse(params);
        const url = new URL(`${BACKEND_URL}/v2/artists/${artist_id}/releases`);
        url.searchParams.set('release_type', release_type);
        url.searchParams.set('limit', String(limit));
        url.searchParams.set('offset', String(offset));
        const headers: Record<string, string> = {};
        if (country) headers['token-country'] = country;
        const res = await fetch(url.toString(), { headers });
        const data = await res.json();
        return new NextResponse(JSON.stringify(data), { status: res.status });
    } catch (error: any) {
        return new NextResponse(JSON.stringify({ success: false, error: error?.message || 'Error' }), { status: 400 });
    }
}
