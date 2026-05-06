import { NextRequest, NextResponse } from 'next/server';
import z from 'zod';

const searchParamsSchema = z.object({
    q: z.string().min(1, 'Query is required'),
    offset: z.preprocess((a) => parseInt(a as string), z.number().max(1000).min(0).default(0))
});

const BACKEND_URL = process.env.NEXT_PUBLIC_AWS_API_URL;

export async function GET(request: NextRequest) {
    const country = request.headers.get('Token-Country');
    const params = Object.fromEntries(new URL(request.url).searchParams.entries());

    try {
        const { q, offset } = searchParamsSchema.parse(params);

        const url = new URL(`${BACKEND_URL}/v2/search`);
        url.searchParams.set('q', q);
        url.searchParams.set('limit', '10');
        url.searchParams.set('offset', String(offset));

        const headers: Record<string, string> = {};
        if (country) headers['token-country'] = country;

        const res = await fetch(url.toString(), { headers });
        const data = await res.json();
        return new NextResponse(JSON.stringify(data), { status: res.status });
    } catch (error: any) {
        return new NextResponse(
            JSON.stringify({ success: false, error: error?.message || 'Search error' }),
            { status: 400 }
        );
    }
}
