/**
 * Stream Routes — /v2/stream
 * Provides streaming URLs for the ARCOD Player desktop app
 */
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getTrackFileUrl } from '../services/qobuz-api.js';
import { authenticateRequest } from '../auth/supabase.js';

export async function streamRoutes(fastify: FastifyInstance) {

    // GET /v2/stream/:trackId — Get a streaming URL for a track
    fastify.get('/v2/stream/:trackId', async (req: FastifyRequest, reply: FastifyReply) => {
        const { trackId } = req.params as { trackId: string };
        const { quality } = req.query as { quality?: string };

        if (!trackId) {
            return reply.code(400).send({ error: 'Track ID is required' });
        }

        // Optional auth — authenticated users can stream higher quality
        const authHeader = req.headers.authorization;
        let user = null;
        if (authHeader) {
            user = await authenticateRequest(authHeader);
        }

        // Default quality: 27 (Hi-Res) for authenticated, 5 (MP3 320) for guest
        const qualityId = quality ? parseInt(quality, 10) : (user ? 27 : 5);

        // Guest users limited to MP3 quality
        if (!user && qualityId > 5) {
            return reply.code(403).send({ error: 'Authentication required for Hi-Res streaming' });
        }

        try {
            const result = await getTrackFileUrl(trackId, qualityId);
            return reply.send({
                url: result.url,
                mimeType: result.mimeType,
                quality: qualityId,
                trackId
            });
        } catch (err: any) {
            console.error(`[Stream] Failed to get URL for track ${trackId}:`, err.message);
            return reply.code(500).send({ error: 'Failed to get streaming URL' });
        }
    });
}
