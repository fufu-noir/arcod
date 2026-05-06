/**
 * main fastify server
 */
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { config } from './config.js';
import { downloadRoutes } from './routes/downloads.js';
import { jobRoutes } from './routes/admin.js';
import { albumRoutes } from './routes/albums.js';
import { pollRoutes } from './routes/polls.js';
import { lyricsRoutes } from './routes/lyrics.js';
import { authRoutes } from './routes/auth.js';
import { streamRoutes } from './routes/stream.js';
import { catalogRoutes } from './routes/catalog.js';
import { workerRoutes } from './routes/workers.js';
import { artistImageRoutes } from './routes/artist-image.js';
import { sonosRoutes } from './routes/sonos.js';
import { enqueueDownload, processPendingJobs } from './services/processor.js';
import { startScheduledTasks } from './services/scheduler.js';
import { getPendingDownloads } from './db/client.js';
import { getClientIP } from './services/antibot.js';
import { isIPBlocked } from './db/client.js';

const fastify = Fastify({
    logger: {
        level: config.nodeEnv === 'production' ? 'info' : 'debug',
    },
    trustProxy: true, // Behind Nginx
});

async function main() {
    // ======================== Plugins ========================

    // CORS
    await fastify.register(cors, {
        origin: true,
        methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization', 'Token-Country'],
        credentials: true,
    });



    // ======================== Global IP Block ========================

    fastify.addHook('onRequest', async (request, reply) => {
        if (request.url === '/health' || request.url.startsWith('/v2/workers/')) return;

        const clientIp = getClientIP(request);
        const blockStatus = isIPBlocked(clientIp);
        if (blockStatus.blocked) {
            const msg = blockStatus.permanent
                ? 'Your IP has been permanently blocked.'
                : blockStatus.expiresAt
                    ? `Too many requests. Blocked until ${new Date(blockStatus.expiresAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}.`
                    : 'Access denied.';
            reply.code(403).send({ error: 'Access denied', message: msg });
        }
    });

    // ======================== Routes ========================

    // Health check
    fastify.get('/health', async () => ({
        status: 'ok',
        service: 'ARCOD Server',
        version: '1.0.0',
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
    }));

    // Register route modules
    await fastify.register(downloadRoutes);
    await fastify.register(jobRoutes);
    await fastify.register(albumRoutes);
    await fastify.register(pollRoutes);
    await fastify.register(lyricsRoutes);
    await fastify.register(authRoutes);
    await fastify.register(streamRoutes);
    await fastify.register(catalogRoutes);
    await fastify.register(workerRoutes);
    await fastify.register(artistImageRoutes);
    await fastify.register(sonosRoutes);

    // ======================== Download Trigger ========================

    // Hook: after creating a download, enqueue it for processing
    fastify.addHook('onResponse', (request, reply) => {
        if (request.method === 'POST' && request.url === '/v2/downloads' && reply.statusCode === 201) {
            // Re-read pending downloads and enqueue
            const pending = getPendingDownloads();
            for (const job of pending) {
                enqueueDownload(job.id);
            }
        }
    });

    // ======================== Start ========================

    try {
        await fastify.listen({ port: config.port, host: '0.0.0.0' });
        console.log(`
╔═══════════════════════════════════════════════╗
║           ARCOD Server v1.0.0                 ║
║  Fastify + SQLite + Cloudflare R2             ║
╠═══════════════════════════════════════════════╣
║  Port:    ${String(config.port).padEnd(35)}║
║  Env:     ${config.nodeEnv.padEnd(35)}║
║  R2:      ${config.r2.bucket.padEnd(35)}║
║  DB:      ${config.dbPath.padEnd(35)}║
╚═══════════════════════════════════════════════╝
    `);

        // Process any pending downloads from previous session
        processPendingJobs();

        // Start scheduled tasks
        startScheduledTasks();

    } catch (err) {
        fastify.log.error(err);
        process.exit(1);
    }
}

// Graceful shutdown
process.on('SIGINT', async () => {
    console.log('\n[Server] Shutting down gracefully...');
    await fastify.close();
    process.exit(0);
});

process.on('SIGTERM', async () => {
    console.log('[Server] SIGTERM received, shutting down...');
    await fastify.close();
    process.exit(0);
});

main();
