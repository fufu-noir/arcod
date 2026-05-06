/**
 * Poll Routes — /v2/poll/*
 */
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { authenticateRequest } from '../auth/supabase.js';
import { getPollResults, getUserVote, castVote } from '../db/client.js';

export async function pollRoutes(fastify: FastifyInstance) {

    // GET /v2/poll/results
    fastify.get('/v2/poll/results', async (req: FastifyRequest, reply: FastifyReply) => {
        const pollId = (req.query as any).pollId;
        if (!pollId) return reply.code(400).send({ error: 'pollId query parameter is required.' });

        const results = getPollResults(pollId);
        const votes: Record<string, number> = {};
        let totalVotes = 0;

        if (results?.data) {
            const data = typeof results.data === 'string' ? JSON.parse(results.data) : results.data;
            for (const [key, value] of Object.entries(data)) {
                if (key.startsWith('votes_')) {
                    const optionId = key.replace('votes_', '');
                    votes[optionId] = value as number;
                }
            }
            totalVotes = results.totalVotes || 0;
        }

        // Check if authenticated user already voted
        let userVote: string | null = null;
        const authHeader = req.headers.authorization || '';
        if (authHeader) {
            const user = await authenticateRequest(authHeader);
            if (user) {
                userVote = getUserVote(pollId, user.uid);
            }
        }

        return reply.send({ pollId, votes, totalVotes, userVote });
    });

    // POST /v2/poll/vote
    fastify.post('/v2/poll/vote', async (req: FastifyRequest, reply: FastifyReply) => {
        const authHeader = req.headers.authorization || '';
        const user = await authenticateRequest(authHeader);

        if (!user) {
            return reply.code(401).send({ error: 'Authentication required. Please log in to vote.' });
        }

        const body = req.body as any;
        const { pollId, optionId } = body;

        if (!pollId || !optionId) {
            return reply.code(400).send({ error: 'pollId and optionId are required.' });
        }

        const success = castVote(pollId, user.uid, user.email, optionId);

        if (!success) {
            return reply.code(409).send({ error: 'You have already voted on this poll.' });
        }

        return reply.send({ success: true, message: 'Vote recorded!' });
    });
}
