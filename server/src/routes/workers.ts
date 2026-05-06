import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { config } from '../config.js';
import {
    claimJobsForWorker, updateDownload, getDownload,
    releaseWorkerJobs, refreshWorkerLease, getRoutingConfig,
} from '../db/client.js';

function authenticateWorker(req: FastifyRequest, reply: FastifyReply): boolean {
    if (!config.worker.apiKey) {
        reply.code(503).send({ error: 'Worker API not configured' });
        return false;
    }
    const auth = req.headers.authorization || '';
    if (auth !== `Bearer ${config.worker.apiKey}`) {
        reply.code(401).send({ error: 'Invalid worker API key' });
        return false;
    }
    return true;
}

export async function workerRoutes(fastify: FastifyInstance) {

    fastify.post('/v2/workers/claim', async (req: FastifyRequest, reply: FastifyReply) => {
        if (!authenticateWorker(req, reply)) return;
        const { workerId, count } = req.body as any;
        if (!workerId || !count) return reply.code(400).send({ error: 'workerId and count required' });
        const routing = getRoutingConfig();
        if (routing.mode === 'vps_only') return reply.send({ jobs: [] });
        const cap = routing.workerMaxClaim || 20;
        const jobs = claimJobsForWorker(workerId, Math.min(count, cap));
        return reply.send({ jobs });
    });

    fastify.post('/v2/workers/update', async (req: FastifyRequest, reply: FastifyReply) => {
        if (!authenticateWorker(req, reply)) return;
        const { downloadId, workerId, updates } = req.body as any;
        if (!downloadId || !workerId || !updates) return reply.code(400).send({ error: 'Missing fields' });

        const job = getDownload(downloadId);
        if (!job) return reply.code(404).send({ error: 'Job not found' });
        if (job.claimedBy !== workerId) return reply.code(403).send({ error: 'Not your job' });

        updateDownload(downloadId, updates);

        if (updates.status === 'failed') {
            updateDownload(downloadId, { claimedBy: null, claimedAt: null });
        }
        return reply.send({ success: true });
    });

    fastify.post('/v2/workers/heartbeat', async (req: FastifyRequest, reply: FastifyReply) => {
        if (!authenticateWorker(req, reply)) return;
        const { workerId, activeJobIds } = req.body as any;
        if (!workerId || !Array.isArray(activeJobIds)) return reply.code(400).send({ error: 'Missing fields' });
        const refreshed = refreshWorkerLease(workerId, activeJobIds);
        return reply.send({ refreshed });
    });

    fastify.post('/v2/workers/release', async (req: FastifyRequest, reply: FastifyReply) => {
        if (!authenticateWorker(req, reply)) return;
        const { workerId, jobIds } = req.body as any;
        if (!workerId) return reply.code(400).send({ error: 'workerId required' });
        const released = releaseWorkerJobs(workerId, jobIds);
        return reply.send({ released });
    });
}
