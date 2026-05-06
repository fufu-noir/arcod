/**
 * admin routes — jobs, blocked ips, rate limits, routing config
 */
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { authenticateRequest, isAdmin } from '../auth/supabase.js';
import {
    getAllDownloadsForAdmin, getDownload, updateDownload, deleteDownload as dbDeleteDownload,
    getAllBlockedIPs, blockIP, unblockIP,
    getAllRateLimitedIPs, addRateLimitedIP, removeRateLimitedIP,
    getRoutingConfig, setRoutingConfig,
} from '../db/client.js';
import db from '../db/client.js';
import { deleteFolder, extractKeyFromUrl } from '../storage/r2.js';
import { config } from '../config.js';

let maintenanceMode = false;
let maintenanceMessage = 'We are performing a quick update. Please try again in a few minutes.';

export function isMaintenanceMode(): boolean { return maintenanceMode; }
export function getMaintenanceMessage(): string { return maintenanceMessage; }

export async function jobRoutes(fastify: FastifyInstance) {

    // GET /admin/maintenance — Get maintenance status
    fastify.get('/admin/maintenance', async (req: FastifyRequest, reply: FastifyReply) => {
        return reply.send({ enabled: maintenanceMode, message: maintenanceMessage });
    });

    // POST /admin/maintenance — Toggle maintenance mode (admin only)
    fastify.post('/admin/maintenance', async (req: FastifyRequest, reply: FastifyReply) => {
        const authHeader = req.headers.authorization || '';
        const user = await authenticateRequest(authHeader);
        if (!user || !isAdmin(user)) return reply.code(401).send({ error: 'Unauthorized' });

        const body = req.body as any;
        maintenanceMode = !!body.enabled;
        if (body.message) maintenanceMessage = body.message;
        console.log(`[Admin] Maintenance mode ${maintenanceMode ? 'ENABLED' : 'DISABLED'} by ${user.email}`);
        return reply.send({ success: true, enabled: maintenanceMode, message: maintenanceMessage });
    });

    // GET /jobs — List all jobs (admin)
    fastify.get('/jobs', async (req: FastifyRequest, reply: FastifyReply) => {
        const authHeader = req.headers.authorization || '';
        const user = await authenticateRequest(authHeader);

        if (!user) return reply.code(401).send({ error: 'Unauthorized' });

        // For admins return all jobs, for users return their own
        const isAdminUser = isAdmin(user);
        let jobs;

        if (isAdminUser) {
            jobs = getAllDownloadsForAdmin();
        } else {
            const { getDownloadsByEmail } = await import('../db/client.js');
            jobs = getDownloadsByEmail(user.email, 50);
        }

        return reply.send({ success: true, jobs });
    });

    // POST /jobs/:id/cancel — Cancel a job
    fastify.post('/jobs/:id/cancel', async (req: FastifyRequest, reply: FastifyReply) => {
        const { id } = req.params as { id: string };
        const authHeader = req.headers.authorization || '';
        const user = await authenticateRequest(authHeader);

        if (!user) return reply.code(401).send({ error: 'Unauthorized' });

        const job = getDownload(id);
        if (!job) return reply.code(404).send({ error: 'Job not found' });

        if (!isAdmin(user) && user.uid !== job.userId) {
            return reply.code(403).send({ error: 'Access denied' });
        }

        updateDownload(id, { status: 'cancelled', description: 'Cancelled by admin' });

        // Clean up R2 files
        if (job.downloadUrl) {
            try {
                const key = extractKeyFromUrl(job.downloadUrl);
                const prefix = key.substring(0, key.lastIndexOf('/') + 1);
                if (prefix) await deleteFolder(prefix);
            } catch (err) {
                console.warn('Failed to cleanup R2:', err);
            }
        }

        return reply.send({ success: true });
    });

    // POST /admin/jobs/cancel-bulk — Cancel jobs by status filter (admin only)
    fastify.post('/admin/jobs/cancel-bulk', async (req: FastifyRequest, reply: FastifyReply) => {
        const authHeader = req.headers.authorization || '';
        const user = await authenticateRequest(authHeader);
        if (!user || !isAdmin(user)) return reply.code(401).send({ error: 'Unauthorized' });

        const { statuses } = req.body as { statuses: string[] };
        if (!Array.isArray(statuses) || statuses.length === 0) {
            return reply.code(400).send({ error: 'Missing statuses array' });
        }

        const allowed = ['pending', 'processing', 'downloading', 'queued'];
        const filtered = statuses.filter(s => allowed.includes(s));
        if (filtered.length === 0) return reply.code(400).send({ error: 'No cancellable statuses provided' });

        const placeholders = filtered.map(() => '?').join(',');
        const result = db.prepare(
            `UPDATE downloads SET status='cancelled', description='Cancelled by admin', updatedAt=datetime('now') WHERE status IN (${placeholders})`
        ).run(...filtered);

        return reply.send({ success: true, cancelled: result.changes });
    });

    // GET /admin/blocked-ips
    fastify.get('/admin/blocked-ips', async (req: FastifyRequest, reply: FastifyReply) => {
        const authHeader = req.headers.authorization || '';
        const user = await authenticateRequest(authHeader);
        if (!user || !isAdmin(user)) return reply.code(401).send({ error: 'Unauthorized' });

        const blockedIPs = getAllBlockedIPs();
        return reply.send({ success: true, blockedIPs });
    });

    // POST /admin/blocked-ips — Block an IP
    fastify.post('/admin/blocked-ips', async (req: FastifyRequest, reply: FastifyReply) => {
        const authHeader = req.headers.authorization || '';
        const user = await authenticateRequest(authHeader);
        if (!user || !isAdmin(user)) return reply.code(401).send({ error: 'Unauthorized' });

        const body = req.body as any;
        if (!body.ip) return reply.code(400).send({ error: 'Missing IP' });

        const isPermanent = body.permanent !== false;
        const durationMs = isPermanent ? undefined : (body.durationMinutes || 15) * 60 * 1000;

        blockIP(body.ip, body.reason || 'Manually blocked', {
            permanent: isPermanent,
            durationMs,
            blockedBy: 'admin',
        });

        return reply.code(201).send({ success: true });
    });

    // DELETE /admin/blocked-ips/:ip — Unblock an IP
    fastify.delete('/admin/blocked-ips/:ip', async (req: FastifyRequest, reply: FastifyReply) => {
        const authHeader = req.headers.authorization || '';
        const user = await authenticateRequest(authHeader);
        if (!user || !isAdmin(user)) return reply.code(401).send({ error: 'Unauthorized' });

        const { ip } = req.params as { ip: string };
        unblockIP(ip);
        return reply.send({ success: true });
    });

    // GET /admin/rate-limits
    fastify.get('/admin/rate-limits', async (req: FastifyRequest, reply: FastifyReply) => {
        const authHeader = req.headers.authorization || '';
        const user = await authenticateRequest(authHeader);
        if (!user || !isAdmin(user)) return reply.code(401).send({ error: 'Unauthorized' });

        const rateLimitedIPs = getAllRateLimitedIPs();
        return reply.send({ success: true, rateLimitedIPs });
    });

    // POST /admin/rate-limits — Add rate limit
    fastify.post('/admin/rate-limits', async (req: FastifyRequest, reply: FastifyReply) => {
        const authHeader = req.headers.authorization || '';
        const user = await authenticateRequest(authHeader);
        if (!user || !isAdmin(user)) return reply.code(401).send({ error: 'Unauthorized' });

        const body = req.body as any;
        if (!body.ip) return reply.code(400).send({ error: 'Missing IP' });

        addRateLimitedIP(body.ip, body.maxDownloadsPerHour || 10, body.reason || 'Rate limit applied');
        return reply.code(201).send({ success: true });
    });

    // DELETE /admin/rate-limits/:ip — Remove rate limit
    fastify.delete('/admin/rate-limits/:ip', async (req: FastifyRequest, reply: FastifyReply) => {
        const authHeader = req.headers.authorization || '';
        const user = await authenticateRequest(authHeader);
        if (!user || !isAdmin(user)) return reply.code(401).send({ error: 'Unauthorized' });

        const { ip } = req.params as { ip: string };
        removeRateLimitedIP(ip);
        return reply.send({ success: true });
    });
    // GET /admin/routing — Get routing config
    fastify.get('/admin/routing', async (req: FastifyRequest, reply: FastifyReply) => {
        const authHeader = req.headers.authorization || '';
        const user = await authenticateRequest(authHeader);
        if (!user || !isAdmin(user)) return reply.code(401).send({ error: 'Unauthorized' });
        return reply.send({ success: true, routing: getRoutingConfig() });
    });

    // POST /admin/routing — Update routing config
    fastify.post('/admin/routing', async (req: FastifyRequest, reply: FastifyReply) => {
        const authHeader = req.headers.authorization || '';
        const user = await authenticateRequest(authHeader);
        if (!user || !isAdmin(user)) return reply.code(401).send({ error: 'Unauthorized' });
        const body = req.body as any;
        const updated = setRoutingConfig(body);
        console.log(`[Admin] Routing config updated by ${user.email}:`, updated);
        return reply.send({ success: true, routing: updated });
    });

    // GET /admin/security-stats — Full security dashboard data
    fastify.get('/admin/security-stats', async (req: FastifyRequest, reply: FastifyReply) => {
        const authHeader = req.headers.authorization || '';
        const user = await authenticateRequest(authHeader);
        if (!user || !isAdmin(user)) return reply.code(401).send({ error: 'Unauthorized' });

        const { default: db } = await import('../db/client.js');
        const now = new Date();
        const hourAgo = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
        const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

        // Stats
        const hourlyStats = db.prepare(`
            SELECT
                COUNT(*) as total,
                SUM(CASE WHEN userId LIKE 'guest_%' THEN 1 ELSE 0 END) as guests,
                SUM(CASE WHEN userId NOT LIKE 'guest_%' THEN 1 ELSE 0 END) as authenticated,
                COUNT(DISTINCT CASE WHEN userId NOT LIKE 'guest_%' THEN userEmail END) as uniqueUsers,
                COUNT(DISTINCT ip) as uniqueIPs
            FROM downloads WHERE createdAt >= ?
        `).get(hourAgo) as any;

        const dailyStats = db.prepare(`
            SELECT
                COUNT(*) as total,
                SUM(CASE WHEN userId LIKE 'guest_%' THEN 1 ELSE 0 END) as guests,
                SUM(CASE WHEN userId NOT LIKE 'guest_%' THEN 1 ELSE 0 END) as authenticated,
                COUNT(DISTINCT CASE WHEN userId NOT LIKE 'guest_%' THEN userEmail END) as uniqueUsers,
                COUNT(DISTINCT ip) as uniqueIPs
            FROM downloads WHERE createdAt >= ?
        `).get(dayAgo) as any;

        // Top users
        const topUsersHourly = db.prepare(`
            SELECT userEmail as email, COUNT(*) as count, COALESCE(SUM(fileSize), 0) as size,
                   CASE WHEN userId LIKE 'guest_%' THEN 1 ELSE 0 END as isGuest
            FROM downloads WHERE createdAt >= ?
            GROUP BY userEmail ORDER BY count DESC LIMIT 20
        `).all(hourAgo).map((r: any) => ({ ...r, isGuest: !!r.isGuest }));

        const topUsersDaily = db.prepare(`
            SELECT userEmail as email, COUNT(*) as count, COALESCE(SUM(fileSize), 0) as size,
                   CASE WHEN userId LIKE 'guest_%' THEN 1 ELSE 0 END as isGuest
            FROM downloads WHERE createdAt >= ?
            GROUP BY userEmail ORDER BY count DESC LIMIT 20
        `).all(dayAgo).map((r: any) => ({ ...r, isGuest: !!r.isGuest }));

        // Top IPs
        const topIPsHourly = db.prepare(`
            SELECT ip, COUNT(*) as count, COALESCE(SUM(fileSize), 0) as size
            FROM downloads WHERE createdAt >= ? AND ip IS NOT NULL
            GROUP BY ip ORDER BY count DESC LIMIT 20
        `).all(hourAgo);

        const topIPsDaily = db.prepare(`
            SELECT ip, COUNT(*) as count, COALESCE(SUM(fileSize), 0) as size
            FROM downloads WHERE createdAt >= ? AND ip IS NOT NULL
            GROUP BY ip ORDER BY count DESC LIMIT 20
        `).all(dayAgo);

        // Blocked IPs
        const blockedItems = getAllBlockedIPs();
        const autobanned = blockedItems.filter((b: any) => b.autoban).length;

        // Recent downloads
        const recentDownloads = db.prepare(`
            SELECT id, userEmail, albumTitle, artistName, createdAt, status, fileSize
            FROM downloads ORDER BY createdAt DESC LIMIT 25
        `).all();

        return reply.send({
            stats: {
                hourly: { total: hourlyStats.total || 0, guests: hourlyStats.guests || 0, authenticated: hourlyStats.authenticated || 0, uniqueUsers: hourlyStats.uniqueUsers || 0, uniqueIPs: hourlyStats.uniqueIPs || 0 },
                daily: { total: dailyStats.total || 0, guests: dailyStats.guests || 0, authenticated: dailyStats.authenticated || 0, uniqueUsers: dailyStats.uniqueUsers || 0, uniqueIPs: dailyStats.uniqueIPs || 0 },
            },
            topUsers: { hourly: topUsersHourly, daily: topUsersDaily },
            topIPs: { hourly: topIPsHourly, daily: topIPsDaily },
            blocked: { total: blockedItems.length, autobanned, items: blockedItems },
            recentDownloads,
            limits: {
                authHourly: config.authUserHourlyLimit,
                authDaily: config.authUserDailyLimit,
                ipHourly: config.ipHourlyLimit,
                guestHourly: config.guestHourlyLimit,
                concurrent: config.authUserConcurrentLimit,
                autoBanRapid: config.autobanRapidThreshold,
                autoBanHourly: config.autobanHourlyThreshold,
                autoBanDaily: config.autobanDailyThreshold,
            },
        });
    });
}
