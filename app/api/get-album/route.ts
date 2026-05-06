import { NextRequest, NextResponse } from 'next/server';
import z from 'zod';

const schema = z.object({
    album_id: z.string().min(1, 'ID is required'),
    title: z.string().optional(),
    artist: z.string().optional(),
});

const BACKEND_URL = process.env.NEXT_PUBLIC_AWS_API_URL;

export async function GET(request: NextRequest) {
    const country = request.headers.get('Token-Country');
    const params = Object.fromEntries(new URL(request.url).searchParams.entries());
    try {
        const { album_id, title, artist } = schema.parse(params);
        const url = new URL(`${BACKEND_URL}/v2/albums/${album_id}`);
        if (title) url.searchParams.set('title', title);
        if (artist) url.searchParams.set('artist', artist);
        const headers: Record<string, string> = {};
        if (country) headers['token-country'] = country;
        const res = await fetch(url.toString(), { headers });
        const data = await res.json();
        return new NextResponse(JSON.stringify(data), { status: res.status });
    } catch (error: any) {
        return new NextResponse(
            JSON.stringify({ success: false, error: error?.message || 'Error' }),
            { status: 400 }
        );
    }
}
