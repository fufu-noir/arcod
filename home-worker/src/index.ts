import fs from 'fs';
import path from 'path';
import { config } from './config.js';
import { claimJobs, sendHeartbeat, releaseJobs } from './api-client.js';
import { processJob } from './processor.js';

const WORK_DIR = '/tmp/arcod-processing';

const activeJobIds = new Set<string>();
let shuttingDown = false;

async function pollLoop(): Promise<void> {
    while (!shuttingDown) {
        try {
            const available = config.claimCount - activeJobIds.size;
            if (available > 0) {
                const jobs = await claimJobs(available);
                if (jobs.length > 0) {
                    console.log(`[Poll] Claimed ${jobs.length} job(s): ${jobs.map(j => j.id.slice(0, 8)).join(', ')}`);
                    for (const job of jobs) {
                        activeJobIds.add(job.id);
                        processJob(job)
                            .catch(err => console.error(`[Worker] Unhandled error on ${job.id}:`, err.message))
                            .finally(() => activeJobIds.delete(job.id));
                    }
                }
            }
        } catch (err: any) {
            console.error(`[Poll] Error:`, err.message);
        }

        await sleep(config.pollIntervalMs);
    }
}

async function heartbeatLoop(): Promise<void> {
    while (!shuttingDown) {
        await sleep(config.heartbeatIntervalMs);
        if (activeJobIds.size > 0) {
            try {
                await sendHeartbeat([...activeJobIds]);
            } catch (err: any) {
                console.error(`[Heartbeat] Error:`, err.message);
            }
        }
    }
}

function sleep(ms: number): Promise<void> {
    return new Promise(r => setTimeout(r, ms));
}

async function shutdown(): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log('\n[Worker] Shutting down...');

    if (activeJobIds.size > 0) {
        try {
            await releaseJobs([...activeJobIds]);
            console.log(`[Worker] Released ${activeJobIds.size} job(s) back to pending`);
        } catch {}
    }

    process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

async function main(): Promise<void> {
    console.log(`
╔══════════════════════════════════════════════╗
║       ARCOD Home Worker v1.0.0              ║
╠══════════════════════════════════════════════╣
║  Worker:  ${config.workerId.padEnd(33)}║
║  Server:  ${config.server.url.padEnd(33)}║
║  Claim:   ${String(config.claimCount).padEnd(33)}║
║  Tracks:  ${String(config.trackConcurrency).padEnd(33)}║
╚══════════════════════════════════════════════╝
    `);

    if (!config.server.apiKey) throw new Error('WORKER_API_KEY is required');
    if (!config.qobuz.appId) throw new Error('QOBUZ_APP_ID is required');
    if (!config.qobuz.secret) throw new Error('QOBUZ_SECRET is required');

    console.log('[Worker] Qobuz API routed through proxy');

    // Clean leftover files from previous runs
    if (fs.existsSync(WORK_DIR)) {
        const dirs = fs.readdirSync(WORK_DIR);
        if (dirs.length > 0) {
            for (const d of dirs) fs.rmSync(path.join(WORK_DIR, d), { recursive: true, force: true });
            console.log(`[Startup] Cleaned ${dirs.length} leftover dir(s) from previous run`);
        }
    }

    pollLoop();
    heartbeatLoop();

    // Sweep orphaned dirs every 5 minutes
    setInterval(() => {
        try {
            if (!fs.existsSync(WORK_DIR)) return;
            for (const d of fs.readdirSync(WORK_DIR)) {
                if (!activeJobIds.has(d)) {
                    fs.rmSync(path.join(WORK_DIR, d), { recursive: true, force: true });
                    console.log(`[Sweep] Cleaned orphaned dir: ${d}`);
                }
            }
        } catch {}
    }, 5 * 60 * 1000);

    console.log('[Worker] Polling for jobs...');
}

main().catch(err => {
    console.error('[Worker] Fatal:', err);
    process.exit(1);
});
