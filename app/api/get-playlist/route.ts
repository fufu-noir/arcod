import z from 'zod';

const schema = z.object({ playlist_id: z.string().min(1) });
const BACKEND_URL = process.env.NEXT_PUBLIC_AWS_API_URL;

export async function GET(request: Request) {
    const country = request.headers.get('Token-Country');
    const params = Object.fromEntries(new URL(request.url).searchParams.entries());
    try {
        const { playlist_id } = schema.parse(params);
        const headers: Record<string, string> = {};
        if (country) headers['token-country'] = country;
        const res = await fetch(`${BACKEND_URL}/v2/playlists/${playlist_id}`, { headers });
        const data = await res.json();
        return new Response(JSON.stringify(data), { status: res.status });
    } catch (error: any) {
        return new Response(
            JSON.stringify({ success: false, error: error?.message || 'Playlist fetch error' }),
            { status: 400 }
        );
    }
}
