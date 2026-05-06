/**
 * Album Info Routes — /v2/albums/:albumId
 */
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getAlbumInfoFromQobuz } from '../services/qobuz-api.js';

export async function albumRoutes(fastify: FastifyInstance) {

    // GET /v2/albums/:albumId
    fastify.get('/v2/albums/:albumId', async (req: FastifyRequest, reply: FastifyReply) => {
        const { albumId } = req.params as { albumId: string };
        const country = req.headers['token-country'] as string || undefined;
        const q = req.query as any;

        if (!albumId) return reply.code(400).send({ error: 'Missing album ID' });

        try {
            const albumInfo = await getAlbumInfoFromQobuz(
                albumId, country,
                { albumTitle: q.title, artistName: q.artist }
            );
            return reply.send({ success: true, data: albumInfo });
        } catch (error) {
            console.error('Get album info error:', error);
            return reply.code(500).send({
                success: false,
                error: error instanceof Error ? error.message : 'Internal error',
            });
        }
    });
}
