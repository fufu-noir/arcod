/**
 * Catalog Routes — /v2/search + /v2/tracks/:trackId/url
 */
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getTrackFileUrl, searchQobuz, getArtistFromQobuz, getArtistReleasesFromQobuz, getTrackInfoFromQobuz, getPlaylistFromQobuz } from '../services/qobuz-api.js';

export async function catalogRoutes(fastify: FastifyInstance) {

    // GET /v2/search?q=...
    fastify.get('/v2/search', async (req: FastifyRequest, reply: FastifyReply) => {
        const query = (req.query as any)?.q?.toString?.().trim?.() || '';
        const offsetRaw = (req.query as any)?.offset;
        const limitRaw = (req.query as any)?.limit;
        const country = req.headers['token-country'] as string || undefined;

        if (!query) {
            return reply.code(400).send({ success: false, error: 'Missing query parameter q.' });
        }

        const offset = Number.isFinite(Number(offsetRaw)) ? Math.max(0, Number(offsetRaw)) : 0;
        const limit = Number.isFinite(Number(limitRaw)) ? Math.min(50, Math.max(1, Number(limitRaw))) : 12;

        try {
            const data = await searchQobuz(query, limit, offset, country);
            return reply.send({ success: true, data });
        } catch (error) {
            console.error('Search catalog error:', error);
            return reply.code(500).send({
                success: false,
                error: error instanceof Error ? error.message : 'Internal search error',
            });
        }
    });

    // GET /v2/artists/:artistId
    fastify.get('/v2/artists/:artistId', async (req: FastifyRequest, reply: FastifyReply) => {
        const { artistId } = req.params as { artistId: string };
        const country = req.headers['token-country'] as string || undefined;
        if (!artistId) return reply.code(400).send({ success: false, error: 'Missing artist ID.' });
        try {
            const data = await getArtistFromQobuz(artistId, country);
            return reply.send({ success: true, data: { artist: data } });
        } catch (error) {
            return reply.code(500).send({ success: false, error: error instanceof Error ? error.message : 'Artist fetch error' });
        }
    });

    // GET /v2/artists/:artistId/releases
    fastify.get('/v2/artists/:artistId/releases', async (req: FastifyRequest, reply: FastifyReply) => {
        const { artistId } = req.params as { artistId: string };
        const country = req.headers['token-country'] as string || undefined;
        const q = req.query as any;
        if (!artistId) return reply.code(400).send({ success: false, error: 'Missing artist ID.' });
        const releaseType = q.release_type || 'album';
        const limit = Math.min(500, Math.max(1, Number(q.limit) || 10));
        const offset = Math.max(0, Number(q.offset) || 0);
        try {
            const data = await getArtistReleasesFromQobuz(artistId, releaseType, limit, offset, country);
            return reply.send({ success: true, data });
        } catch (error) {
            return reply.code(500).send({ success: false, error: error instanceof Error ? error.message : 'Releases fetch error' });
        }
    });

    // GET /v2/playlists/:playlistId
    fastify.get('/v2/playlists/:playlistId', async (req: FastifyRequest, reply: FastifyReply) => {
        const { playlistId } = req.params as { playlistId: string };
        const country = req.headers['token-country'] as string || undefined;
        const q = req.query as any;
        if (!playlistId) return reply.code(400).send({ success: false, error: 'Missing playlist ID.' });
        const limit = Math.min(500, Math.max(1, Number(q.limit) || 500));
        const offset = Math.max(0, Number(q.offset) || 0);
        try {
            const data = await getPlaylistFromQobuz(playlistId, limit, offset, country);
            return reply.send({ success: true, data });
        } catch (error) {
            return reply.code(500).send({ success: false, error: error instanceof Error ? error.message : 'Playlist fetch error' });
        }
    });

    // GET /v2/tracks/:trackId — fetch track metadata
    fastify.get('/v2/tracks/:trackId', async (req: FastifyRequest, reply: FastifyReply) => {
        const { trackId } = req.params as { trackId: string };
        const country = req.headers['token-country'] as string || undefined;
        if (!trackId) return reply.code(400).send({ success: false, error: 'Missing track ID.' });
        try {
            const data = await getTrackInfoFromQobuz(trackId, country);
            return reply.send({ success: true, data });
        } catch (error) {
            return reply.code(500).send({ success: false, error: error instanceof Error ? error.message : 'Track fetch error' });
        }
    });

    // GET /v2/tracks/:trackId/url
    fastify.get('/v2/tracks/:trackId/url', async (req: FastifyRequest, reply: FastifyReply) => {
        const { trackId } = req.params as { trackId: string };
        const qualityRaw = (req.query as any)?.quality;
        const country = req.headers['token-country'] as string || undefined;

        if (!trackId) {
            return reply.code(400).send({ success: false, error: 'Missing track ID.' });
        }

        const quality = Number.isFinite(Number(qualityRaw)) ? Number(qualityRaw) : 5;

        try {
            const data = await getTrackFileUrl(trackId, quality, country);
            return reply.send({
                success: true,
                url: data.url,
                mimeType: data.mimeType,
                quality,
            });
        } catch (error) {
            console.error('Get track stream URL error:', error);
            return reply.code(500).send({
                success: false,
                error: error instanceof Error ? error.message : 'Internal track URL error',
            });
        }
    });
}
