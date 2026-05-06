import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import db from '../db/client.js';

const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function normalizeLookupKey(name: string): string {
    return name
        .normalize('NFKD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}

async function searchDeezerArtistImage(name: string): Promise<string | null> {
    const query = encodeURIComponent(name.trim());
    const response = await fetch(`https://api.deezer.com/search/artist?q=${query}&limit=5`);
    if (!response.ok) return null;

    const data = await response.json() as {
        data?: Array<{ name: string; picture_medium?: string; picture_big?: string; picture?: string }>;
    };
    const items = data.data || [];
    if (items.length === 0) return null;

    const target = normalizeLookupKey(name);
    const matched = items.find((item) => normalizeLookupKey(item.name || '') === target) || items[0];
    return matched.picture_medium || matched.picture_big || matched.picture || null;
}

export async function artistImageRoutes(fastify: FastifyInstance) {
    fastify.get('/artist-image', async (req: FastifyRequest<{ Querystring: { name?: string } }>, reply: FastifyReply) => {
        const name = (req.query.name || '').trim();
        if (!name || name.length < 1) {
            return reply.code(400).send({ error: 'name query param is required' });
        }

        const lookupKey = normalizeLookupKey(name);
        if (!lookupKey) {
            return reply.code(400).send({ error: 'invalid name' });
        }

        try {
            const row = db.prepare('SELECT imageUrl, cachedAt FROM artist_images WHERE lookupKey = ?').get(lookupKey) as { imageUrl: string | null; cachedAt: number } | undefined;
            if (row && Date.now() - row.cachedAt < CACHE_TTL_MS) {
                reply.header('Cache-Control', 'public, max-age=86400, s-maxage=604800');
                return reply.send({ imageUrl: row.imageUrl, cached: true });
            }

            const imageUrl = await searchDeezerArtistImage(name);
            db.prepare(`
                INSERT INTO artist_images (lookupKey, artistName, imageUrl, cachedAt)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(lookupKey) DO UPDATE SET artistName = excluded.artistName, imageUrl = excluded.imageUrl, cachedAt = excluded.cachedAt
            `).run(lookupKey, name, imageUrl, Date.now());

            reply.header('Cache-Control', 'public, max-age=86400, s-maxage=604800');
            return reply.send({ imageUrl, cached: false });
        } catch (error: any) {
            fastify.log.error(error, '[Artist Image] failed to fetch');
            return reply.code(500).send({ error: 'Failed to fetch artist image', imageUrl: null });
        }
    });
}
