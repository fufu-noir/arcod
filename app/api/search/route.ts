import z from 'zod';

const searchParamsSchema = z.object({
    q: z.string().min(1, 'Query is required'),
    limit: z.coerce.number().int().min(1).max(20).default(5)
});

const BACKEND_URL = process.env.NEXT_PUBLIC_AWS_API_URL;

export async function GET(request: Request) {
    const country = request.headers.get('Token-Country');
    const params = Object.fromEntries(new URL(request.url).searchParams.entries());

    try {
        const { q, limit } = searchParamsSchema.parse(params);

        const url = new URL(`${BACKEND_URL}/v2/search`);
        url.searchParams.set('q', q);
        url.searchParams.set('limit', String(limit));

        const headers: Record<string, string> = {};
        if (country) headers['token-country'] = country;

        const res = await fetch(url.toString(), { headers });
        const data = await res.json();
        return new Response(JSON.stringify(data), { status: res.status });
    } catch (error: any) {
        return new Response(
            JSON.stringify({ success: false, error: error?.message || 'Search error' }),
            { status: 400 }
        );
    }
}
