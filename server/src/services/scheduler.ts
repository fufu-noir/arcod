/**
 * scheduled tasks — periodic cleanup jobs
 */
import cron from 'node-cron';
import db, {
    cleanupExpiredBans,
    cleanupOldGuestLimits,
    cleanupOldUrlRateLimits,
    getExpiredDownloadsWithFiles,
    updateDownload,
    deleteDownload,
} from '../db/client.js';
import { deleteFolder, extractKeyFromUrl } from '../storage/r2.js';

export function startScheduledTasks(): void {
    console.log('[Cron] Starting scheduled tasks');

    // Every 5 minutes: cleanup expired bans + guest limits
    cron.schedule('*/5 * * * *', () => {
        try {
            const bans = cleanupExpiredBans();
            const guests = cleanupOldGuestLimits();
            const urls = cleanupOldUrlRateLimits();
            if (bans + guests + urls > 0) {
                console.log(`[Cron] Cleaned up: ${bans} expired bans, ${guests} guest limits, ${urls} URL limits`);
            }
        } catch (err) {
            console.error('[Cron] Cleanup error:', err);
        }
    });

    // Every 5 minutes: delete expired R2 files (keep metadata in DB for library)
    cron.schedule('*/5 * * * *', async () => {
        try {
            const expired = getExpiredDownloadsWithFiles();
            for (const download of expired) {
                try {
                    if (download.downloadUrl) {
                        const key = extractKeyFromUrl(download.downloadUrl);
                        const prefix = key.substring(0, key.lastIndexOf('/') + 1);
                        if (prefix) await deleteFolder(prefix);
                    }
                    const isGuest = download.userId?.startsWith('guest_');
                    if (isGuest) {
                        deleteDownload(download.id);
                    } else {
                        updateDownload(download.id, { downloadUrl: null, guestDeleteAfter: null });
                    }
                    console.log(`[Cron] Cleaned up expired files: ${download.id} (${isGuest ? 'guest deleted' : 'metadata kept'})`);
                } catch (err) {
                    console.warn(`[Cron] Failed to cleanup download ${download.id}:`, err);
                }
            }
            if (expired.length > 0) console.log(`[Cron] Cleaned up ${expired.length} expired downloads`);
        } catch (err) {
            console.error('[Cron] Cleanup error:', err);
        }
    });

    // Every hour: fail stuck jobs
    cron.schedule('0 * * * *', () => {
        try {
            const cutoffMs = Date.now() - 60 * 60 * 1000;
            const cutoff = new Date(cutoffMs).toISOString();

            // Find stuck processing/downloading jobs
            const stuck = db.prepare(`
        SELECT id FROM downloads WHERE status IN ('processing', 'downloading') AND updatedAt < ?
      `).all(cutoff) as any[];

            for (const job of stuck) {
                updateDownload(job.id, {
                    status: 'failed',
                    description: 'Job timed out',
                    error: 'Processing took too long',
                });
                console.log(`[Cron] Auto-failed stuck job: ${job.id}`);
            }
        } catch (err) {
            console.error('[Cron] Stuck jobs cleanup error:', err);
        }
    });
}
