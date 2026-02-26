import { NextRequest, NextResponse } from 'next/server';
import { getDownloadURL } from '@/lib/qobuz-dl-server'; // Assuming this exports getDownloadURL
import z from 'zod';

const schema = z.object({
    track_id: z.string().or(z.number()).transform(val => Number(val))
});

export async function GET(request: NextRequest) {
    const params = Object.fromEntries(new URL(request.url).searchParams.entries());
    const country = request.headers.get('Token-Country');

    try {
        const { track_id } = schema.parse(params);
        // Use quality '5' (MP3 320) for preview to be fast and light
        const url = await getDownloadURL(track_id, '5', country ? { country } : {});
        return NextResponse.json({ success: true, url });
    } catch (error: any) {
        console.error('Error fetching track URL:', error);
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}
