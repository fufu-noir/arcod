/**
 * sqlite database client
 */
import Database, { type Database as DatabaseType } from 'better-sqlite3';
import { config } from '../config.js';
import fs from 'fs';
import path from 'path';

// Ensure the data directory exists
const dbDir = path.dirname(config.dbPath);
if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
}

const db: DatabaseType = new Database(config.dbPath);

// Enable WAL mode for better concurrent performance
db.pragma('journal_mode = WAL');
db.pragma('busy_timeout = 5000');
db.pragma('foreign_keys = ON');

// Initialize schema
db.exec(`
  -- Downloads V2 (replaces qobuz-downloads-v2)
  CREATE TABLE IF NOT EXISTS downloads (
    id TEXT PRIMARY KEY,
    userId TEXT NOT NULL,
    userEmail TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    progress INTEGER DEFAULT 0,
    description TEXT DEFAULT '',
    error TEXT,

    albumId TEXT NOT NULL,
    trackId TEXT,
    albumTitle TEXT NOT NULL,
    artistName TEXT NOT NULL,
    artistId TEXT DEFAULT '',
    coverUrl TEXT DEFAULT '',
    releaseDate TEXT,
    tracksCount INTEGER DEFAULT 0,

    quality INTEGER DEFAULT 27,
    format TEXT DEFAULT 'FLAC',
    bitrate INTEGER,
    embedLyrics INTEGER DEFAULT 1,
    lyricsMode TEXT DEFAULT 'embed',
    downloadBooklet INTEGER DEFAULT 1,
    attachCover INTEGER DEFAULT 1,
    zipName TEXT,
    trackName TEXT,
    source TEXT DEFAULT 'qobuz',
    downloadAccessToken TEXT,

    fileName TEXT,
    fileSize INTEGER,
    downloadUrl TEXT,
    guestDownloadIssuedAt TEXT,
    guestDeleteAfter TEXT,

    country TEXT,
    ip TEXT,
    createdAt TEXT DEFAULT (datetime('now')),
    updatedAt TEXT DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_downloads_userId ON downloads(userId, createdAt);
  CREATE INDEX IF NOT EXISTS idx_downloads_userEmail ON downloads(userEmail, createdAt);
  CREATE INDEX IF NOT EXISTS idx_downloads_status ON downloads(status, createdAt);
  CREATE INDEX IF NOT EXISTS idx_downloads_status_updated ON downloads(status, updatedAt);

  -- Blocked IPs (replaces qobuz-blocked-ips)
  CREATE TABLE IF NOT EXISTS blocked_ips (
    ip TEXT PRIMARY KEY,
    originalIp TEXT,
    reason TEXT,
    blockedAt TEXT DEFAULT (datetime('now')),
    blockedBy TEXT DEFAULT 'system',
    expiresAt TEXT,
    permanent INTEGER DEFAULT 0,
    autoban INTEGER DEFAULT 0
  );

  -- Rate limited IPs (replaces qobuz-rate-limited-ips)
  CREATE TABLE IF NOT EXISTS rate_limited_ips (
    ip TEXT PRIMARY KEY,
    originalIp TEXT,
    maxDownloadsPerHour INTEGER DEFAULT 10,
    reason TEXT,
    createdAt TEXT DEFAULT (datetime('now')),
    createdBy TEXT DEFAULT 'system'
  );

  -- Routing config (admin-managed download routing)
  CREATE TABLE IF NOT EXISTS routing_config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  -- Guest rate limits (replaces qobuz-guest-downloads)
  CREATE TABLE IF NOT EXISTS guest_limits (
    id TEXT PRIMARY KEY,
    ip TEXT NOT NULL,
    hourKey TEXT NOT NULL,
    count INTEGER DEFAULT 0,
    createdAt TEXT DEFAULT (datetime('now')),
    updatedAt TEXT DEFAULT (datetime('now'))
  );

  -- URL rate limits (replaces qobuz-url-rate-limits)
  CREATE TABLE IF NOT EXISTS url_rate_limits (
    pk TEXT PRIMARY KEY,
    minuteCount INTEGER DEFAULT 0,
    minuteWindow TEXT,
    hourCount INTEGER DEFAULT 0,
    hourWindow TEXT,
    dayCount INTEGER DEFAULT 0,
    dayWindow TEXT,
    updatedAt TEXT DEFAULT (datetime('now'))
  );

  -- Artist image cache (Spotify)
  CREATE TABLE IF NOT EXISTS artist_images (
    lookupKey TEXT PRIMARY KEY,
    artistName TEXT NOT NULL,
    imageUrl TEXT,
    cachedAt INTEGER NOT NULL
  );

  -- Polls (replaces qobuz-polls)
  CREATE TABLE IF NOT EXISTS polls (
    pk TEXT NOT NULL,
    sk TEXT NOT NULL,
    data TEXT,
    pollId TEXT,
    userId TEXT,
    userEmail TEXT,
    optionId TEXT,
    totalVotes INTEGER DEFAULT 0,
    createdAt TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (pk, sk)
  );
`);

// Migrations for existing databases
try { db.exec('ALTER TABLE downloads ADD COLUMN downloadBooklet INTEGER DEFAULT 1'); } catch { /* column already exists */ }
try { db.exec('ALTER TABLE downloads ADD COLUMN attachCover INTEGER DEFAULT 1'); } catch { /* column already exists */ }
try { db.exec('ALTER TABLE downloads ADD COLUMN claimedBy TEXT DEFAULT NULL'); } catch { /* column already exists */ }
try { db.exec('ALTER TABLE downloads ADD COLUMN claimedAt TEXT DEFAULT NULL'); } catch { /* column already exists */ }
db.exec('CREATE INDEX IF NOT EXISTS idx_downloads_claimedBy ON downloads(claimedBy, status)');

export default db;

// ======================== Download Helpers ========================

export function createDownload(job: any): void {
    const stmt = db.prepare(`
    INSERT INTO downloads (id, userId, userEmail, status, progress, description,
      albumId, trackId, albumTitle, artistName, artistId, coverUrl, releaseDate, tracksCount,
      quality, format, bitrate, embedLyrics, lyricsMode, downloadBooklet, attachCover, zipName, trackName, source,
      downloadAccessToken, country, ip, createdAt, updatedAt)
    VALUES (@id, @userId, @userEmail, @status, @progress, @description,
      @albumId, @trackId, @albumTitle, @artistName, @artistId, @coverUrl, @releaseDate, @tracksCount,
      @quality, @format, @bitrate, @embedLyrics, @lyricsMode, @downloadBooklet, @attachCover, @zipName, @trackName, @source,
      @downloadAccessToken, @country, @ip, @createdAt, @updatedAt)
  `);
    stmt.run({
        ...job,
        embedLyrics: job.embedLyrics ? 1 : 0,
        downloadBooklet: job.downloadBooklet !== false ? 1 : 0,
        attachCover: job.attachCover !== false ? 1 : 0,
        trackId: job.trackId || null,
        bitrate: job.bitrate || null,
        zipName: job.zipName || null,
        trackName: job.trackName || null,
        releaseDate: job.releaseDate || null,
        country: job.country || null,
        ip: job.ip || null,
    });
}

export function getDownload(id: string): any | null {
    const row = db.prepare('SELECT * FROM downloads WHERE id = ?').get(id) as any;
    if (!row) return null;
    row.embedLyrics = !!row.embedLyrics;
    return row;
}

export function updateDownload(id: string, updates: Record<string, any>): void {
    updates.updatedAt = new Date().toISOString();
    const keys = Object.keys(updates).filter(k => updates[k] !== undefined);
    if (keys.length === 0) return;

    const sanitized: Record<string, any> = { id };
    for (const k of keys) {
        const v = updates[k];
        if (typeof v === 'boolean') sanitized[k] = v ? 1 : 0;
        else if (v === null || typeof v === 'string' || typeof v === 'number' || typeof v === 'bigint') sanitized[k] = v;
        else if (Buffer.isBuffer(v)) sanitized[k] = v;
        else sanitized[k] = String(v);
    }

    const setClauses = keys.map(k => `${k} = @${k}`).join(', ');
    const stmt = db.prepare(`UPDATE downloads SET ${setClauses} WHERE id = @id`);
    stmt.run(sanitized);
}

export function deleteDownload(id: string): void {
    db.prepare('DELETE FROM downloads WHERE id = ?').run(id);
}

export function getDownloadsByEmail(email: string, limit = 100): any[] {
    return db.prepare(
        'SELECT * FROM downloads WHERE userEmail = ? ORDER BY createdAt DESC LIMIT ?'
    ).all(email, limit).map((row: any) => ({ ...row, embedLyrics: !!row.embedLyrics }));
}

export function getDownloadsByUserId(userId: string, limit = 100): any[] {
    return db.prepare(
        'SELECT * FROM downloads WHERE userId = ? ORDER BY createdAt DESC LIMIT ?'
    ).all(userId, limit).map((row: any) => ({ ...row, embedLyrics: !!row.embedLyrics }));
}

export function countUserDownloadsSince(userId: string, since: string): number {
    const result = db.prepare(
        'SELECT COUNT(*) as count FROM downloads WHERE userId = ? AND createdAt >= ?'
    ).get(userId, since) as any;
    return result?.count || 0;
}

export function countActiveJobsForUser(userId: string): number {
    const now = Date.now();
    const lookbackSince = new Date(now - 60 * 60 * 1000).toISOString();

    const rows = db.prepare(`
    SELECT id, status, createdAt, updatedAt FROM downloads
    WHERE userId = ? AND createdAt >= ? AND status IN ('pending', 'processing', 'downloading')
  `).all(userId, lookbackSince) as any[];

    let count = 0;
    for (const row of rows) {
        const updatedMs = new Date(row.updatedAt || row.createdAt).getTime();

        // Auto-fail active jobs with no progress for 30+ min (covers both VPS and worker jobs)
        if ((row.status === 'processing' || row.status === 'downloading') && now - updatedMs > 30 * 60 * 1000) {
            updateDownload(row.id, { status: 'failed', description: 'Job timed out', error: 'Stale active job' });
            continue;
        }
        count++;
    }
    return count;
}

export function findActiveDownloadForUser(params: {
    userId: string; albumId: string; trackId?: string | null;
    format: string; quality: number; bitrate?: number | null; source?: string;
}): any | null {
    const rows = db.prepare(`
    SELECT * FROM downloads
    WHERE userId = ? AND albumId = ? AND status IN ('pending', 'processing', 'downloading')
    ORDER BY createdAt DESC LIMIT 10
  `).all(params.userId, params.albumId) as any[];

    for (const row of rows) {
        if ((params.trackId || null) !== (row.trackId || null)) continue;
        if (params.format !== row.format) continue;
        if (params.quality !== row.quality) continue;
        if ((params.bitrate || null) !== (row.bitrate || null)) continue;
        if ((params.source || 'qobuz') !== (row.source || 'qobuz')) continue;
        row.embedLyrics = !!row.embedLyrics;
        return row;
    }
    return null;
}

export function findPreviousDownloadForUser(params: {
    userId: string; albumId: string; trackId?: string | null;
    format: string; quality: number; bitrate?: number | null; source?: string;
}): any | null {
    const rows = db.prepare(`
    SELECT * FROM downloads
    WHERE userId = ? AND albumId = ? AND status IN ('failed', 'cancelled')
    ORDER BY createdAt DESC LIMIT 10
  `).all(params.userId, params.albumId) as any[];

    for (const row of rows) {
        if ((params.trackId || null) !== (row.trackId || null)) continue;
        if (params.format !== row.format) continue;
        if (params.quality !== row.quality) continue;
        if ((params.bitrate || null) !== (row.bitrate || null)) continue;
        if ((params.source || 'qobuz') !== (row.source || 'qobuz')) continue;
        row.embedLyrics = !!row.embedLyrics;
        return row;
    }
    return null;
}

export function findReusableCompletedDownloadForUser(params: {
    userId: string; albumId: string; trackId?: string | null;
    format: string; quality: number; bitrate?: number | null; source?: string;
}): any | null {
    const rows = db.prepare(`
    SELECT * FROM downloads
    WHERE userId = ? AND albumId = ? AND status = 'completed'
    ORDER BY createdAt DESC LIMIT 10
  `).all(params.userId, params.albumId) as any[];

    for (const row of rows) {
        if ((params.trackId || null) !== (row.trackId || null)) continue;
        if (params.format !== row.format) continue;
        if (params.quality !== row.quality) continue;
        if ((params.bitrate || null) !== (row.bitrate || null)) continue;
        if ((params.source || 'qobuz') !== (row.source || 'qobuz')) continue;
        row.embedLyrics = !!row.embedLyrics;
        return row;
    }
    return null;
}

export function getUserStorageUsed(email: string): number {
    const result = db.prepare(`
    SELECT COALESCE(SUM(fileSize), 0) as total FROM downloads
    WHERE userEmail = ? AND status = 'completed' AND downloadUrl IS NOT NULL AND fileSize > 0
  `).get(email) as any;
    return result?.total || 0;
}

export function getPendingDownloads(): any[] {
    return db.prepare(
        "SELECT * FROM downloads WHERE status = 'pending' AND claimedBy IS NULL AND createdAt > datetime('now', '-24 hours') ORDER BY createdAt ASC"
    ).all().map((row: any) => ({ ...row, embedLyrics: !!row.embedLyrics }));
}

export function claimJobsForWorker(workerId: string, count: number): any[] {
    const now = new Date().toISOString();
    db.prepare(`
        UPDATE downloads SET claimedBy = ?, claimedAt = ?, status = 'processing',
        description = 'Claimed by worker', updatedAt = ?
        WHERE id IN (
            SELECT id FROM downloads WHERE status = 'pending' AND claimedBy IS NULL
            ORDER BY createdAt ASC LIMIT ?
        )
    `).run(workerId, now, now, count);
    return db.prepare(
        "SELECT * FROM downloads WHERE claimedBy = ? AND claimedAt = ?"
    ).all(workerId, now).map((row: any) => ({ ...row, embedLyrics: !!row.embedLyrics }));
}

export function releaseWorkerJobs(workerId: string, jobIds?: string[]): number {
    if (jobIds && jobIds.length > 0) {
        const placeholders = jobIds.map(() => '?').join(',');
        return db.prepare(
            `UPDATE downloads SET claimedBy = NULL, claimedAt = NULL, status = 'pending',
             description = 'Queued...', progress = 0, updatedAt = datetime('now')
             WHERE claimedBy = ? AND id IN (${placeholders})`
        ).run(workerId, ...jobIds).changes;
    }
    return db.prepare(
        "UPDATE downloads SET claimedBy = NULL, claimedAt = NULL, status = 'pending', description = 'Queued...', progress = 0, updatedAt = datetime('now') WHERE claimedBy = ? AND status IN ('processing', 'downloading')"
    ).run(workerId).changes;
}

export function refreshWorkerLease(workerId: string, jobIds: string[]): number {
    if (jobIds.length === 0) return 0;
    const placeholders = jobIds.map(() => '?').join(',');
    return db.prepare(
        `UPDATE downloads SET claimedAt = datetime('now'), updatedAt = datetime('now')
         WHERE claimedBy = ? AND id IN (${placeholders})`
    ).run(workerId, ...jobIds).changes;
}

export function releaseExpiredWorkerJobs(leaseTimeoutMs: number): number {
    return db.prepare(
        `UPDATE downloads SET claimedBy = NULL, claimedAt = NULL, status = 'pending',
         description = 'Queued...', progress = 0, updatedAt = datetime('now')
         WHERE claimedBy IS NOT NULL AND status IN ('processing', 'downloading')
         AND (strftime('%s','now') - strftime('%s', updatedAt)) * 1000 > ?`
    ).run(leaseTimeoutMs).changes;
}

export function resetOrphanedActiveJobs(): number {
    // Fail jobs that have been active for more than 2 hours — they're unrecoverable
    db.prepare(
        "UPDATE downloads SET status='failed', description='Job timed out', error='Orphaned: active for 2+ hours at restart', updatedAt=datetime('now') WHERE status IN ('processing', 'downloading') AND (strftime('%s','now') - strftime('%s', createdAt)) > 7200"
    ).run();
    // Reset only recent jobs (< 2h old) back to pending
    const result = db.prepare(
        "UPDATE downloads SET status='pending', description='Queued...', progress=0, updatedAt=datetime('now') WHERE status IN ('processing', 'downloading')"
    ).run();
    // Release claimedBy on any pending jobs that are still marked as claimed (orphaned from crash)
    db.prepare(
        "UPDATE downloads SET claimedBy=NULL, claimedAt=NULL WHERE status='pending' AND claimedBy IS NOT NULL"
    ).run();
    return result.changes;
}

export function failStaleActiveJobs(thresholdMs: number = 10 * 60 * 1000): number {
    const result = db.prepare(
        "UPDATE downloads SET status='failed', description='Job timed out', error='No progress for 10+ minutes', updatedAt=datetime('now') WHERE status IN ('processing', 'downloading') AND (strftime('%s','now') - strftime('%s', updatedAt)) * 1000 > ?"
    ).run(thresholdMs);
    return result.changes;
}

export function getAllDownloadsForAdmin(): any[] {
    return db.prepare(
        'SELECT * FROM downloads ORDER BY createdAt DESC LIMIT 200'
    ).all().map((row: any) => ({ ...row, embedLyrics: !!row.embedLyrics }));
}

// ======================== Blocked IPs ========================

export function isIPBlocked(ip: string): { blocked: boolean; reason?: string; expiresAt?: string; permanent?: boolean } {
    const normalizedIP = ip.replace(/\./g, '_');
    let row = db.prepare('SELECT * FROM blocked_ips WHERE ip = ?').get(normalizedIP) as any;
    if (!row) row = db.prepare('SELECT * FROM blocked_ips WHERE ip = ?').get(ip) as any;
    if (!row) return { blocked: false };

    // Check expiry
    if (row.expiresAt && new Date(row.expiresAt).getTime() < Date.now()) {
        db.prepare('DELETE FROM blocked_ips WHERE ip = ?').run(row.ip);
        return { blocked: false };
    }

    return { blocked: true, reason: row.reason, expiresAt: row.expiresAt, permanent: !!row.permanent };
}

export function blockIP(ip: string, reason: string, opts?: { permanent?: boolean; durationMs?: number; blockedBy?: string }): void {
    const normalizedIP = ip.replace(/\./g, '_');
    const now = new Date();
    const expiresAt = opts?.permanent ? null : new Date(now.getTime() + (opts?.durationMs || config.tempBanDurationMs)).toISOString();

    db.prepare(`
    INSERT OR REPLACE INTO blocked_ips (ip, originalIp, reason, blockedAt, blockedBy, expiresAt, permanent, autoban)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(normalizedIP, ip, reason, now.toISOString(), opts?.blockedBy || 'system', expiresAt, opts?.permanent ? 1 : 0, opts?.blockedBy === 'antibot-system' ? 1 : 0);
}

export function unblockIP(ip: string): void {
    const normalizedIP = ip.replace(/\./g, '_');
    db.prepare('DELETE FROM blocked_ips WHERE ip = ?').run(normalizedIP);
}

export function getAllBlockedIPs(): any[] {
    return db.prepare('SELECT * FROM blocked_ips').all();
}

// ======================== Rate Limited IPs ========================

export function getAllRateLimitedIPs(): any[] {
    return db.prepare('SELECT * FROM rate_limited_ips').all();
}

export function addRateLimitedIP(ip: string, maxPerHour: number, reason: string): void {
    const normalizedIP = ip.replace(/\./g, '_');
    db.prepare(`
    INSERT OR REPLACE INTO rate_limited_ips (ip, originalIp, maxDownloadsPerHour, reason, createdAt, createdBy)
    VALUES (?, ?, ?, ?, datetime('now'), 'admin')
  `).run(normalizedIP, ip, maxPerHour, reason);
}

export function removeRateLimitedIP(ip: string): void {
    const normalizedIP = ip.replace(/\./g, '_');
    db.prepare('DELETE FROM rate_limited_ips WHERE ip = ?').run(normalizedIP);
}

// ======================== Guest Limits ========================

export function getGuestCount(ip: string, hourKey: string): number {
    const compositeKey = `${ip}#${hourKey}`;
    const row = db.prepare('SELECT count FROM guest_limits WHERE id = ?').get(compositeKey) as any;
    return row?.count || 0;
}

export function incrementGuestCount(ip: string, hourKey: string): number {
    const compositeKey = `${ip}#${hourKey}`;
    db.prepare(`
    INSERT INTO guest_limits (id, ip, hourKey, count, updatedAt)
    VALUES (?, ?, ?, 1, datetime('now'))
    ON CONFLICT(id) DO UPDATE SET count = count + 1, updatedAt = datetime('now')
  `).run(compositeKey, ip, hourKey);

    const row = db.prepare('SELECT count FROM guest_limits WHERE id = ?').get(compositeKey) as any;
    return row?.count || 1;
}

export function getIPTotalCount(ip: string, hourKey: string): number {
    const key = `ip_total_${ip}#${hourKey}`;
    const row = db.prepare('SELECT count FROM guest_limits WHERE id = ?').get(key) as any;
    return row?.count || 0;
}

export function incrementIPTotalCount(ip: string, hourKey: string): void {
    const key = `ip_total_${ip}#${hourKey}`;
    db.prepare(`
    INSERT INTO guest_limits (id, ip, hourKey, count, updatedAt)
    VALUES (?, ?, ?, 1, datetime('now'))
    ON CONFLICT(id) DO UPDATE SET count = count + 1, updatedAt = datetime('now')
  `).run(key, ip, hourKey);
}

// ======================== URL Rate Limits ========================

export function checkUrlRateLimit(userId: string, jobId: string): { allowed: boolean; reason?: string } {
    const pk = `${userId}#${jobId}`;
    const now = new Date();
    const minuteKey = `${now.getUTCFullYear()}-${now.getUTCMonth()}-${now.getUTCDate()}-${now.getUTCHours()}-${now.getUTCMinutes()}`;
    const hourKey = `${now.getUTCFullYear()}-${now.getUTCMonth()}-${now.getUTCDate()}-${now.getUTCHours()}`;
    const dayKey = `${now.getUTCFullYear()}-${now.getUTCMonth()}-${now.getUTCDate()}`;

    const row = db.prepare('SELECT * FROM url_rate_limits WHERE pk = ?').get(pk) as any;

    if (row) {
        const minCount = row.minuteWindow === minuteKey ? row.minuteCount : 0;
        if (minCount >= 2) return { allowed: false, reason: 'Max 2 downloads per minute for this file.' };

        const hrCount = row.hourWindow === hourKey ? row.hourCount : 0;
        if (hrCount >= 8) return { allowed: false, reason: 'Max 8 downloads per hour for this file.' };

        const dCount = row.dayWindow === dayKey ? row.dayCount : 0;
        if (dCount >= 20) return { allowed: false, reason: 'Max 20 downloads per day for this file.' };
    }

    // Increment
    db.prepare(`
    INSERT INTO url_rate_limits (pk, minuteCount, minuteWindow, hourCount, hourWindow, dayCount, dayWindow, updatedAt)
    VALUES (?, 1, ?, 1, ?, 1, ?, datetime('now'))
    ON CONFLICT(pk) DO UPDATE SET
      minuteCount = CASE WHEN minuteWindow = ? THEN minuteCount + 1 ELSE 1 END,
      minuteWindow = ?,
      hourCount = CASE WHEN hourWindow = ? THEN hourCount + 1 ELSE 1 END,
      hourWindow = ?,
      dayCount = CASE WHEN dayWindow = ? THEN dayCount + 1 ELSE 1 END,
      dayWindow = ?,
      updatedAt = datetime('now')
  `).run(pk, minuteKey, hourKey, dayKey, minuteKey, minuteKey, hourKey, hourKey, dayKey, dayKey);

    return { allowed: true };
}

// ======================== Polls ========================

export function getPollResults(pollId: string): any {
    return db.prepare('SELECT * FROM polls WHERE pk = ? AND sk = ?').get(pollId, 'results');
}

export function getUserVote(pollId: string, userId: string): string | null {
    const row = db.prepare('SELECT optionId FROM polls WHERE pk = ? AND sk = ?').get(`${pollId}#${userId}`, 'vote') as any;
    return row?.optionId || null;
}

export function castVote(pollId: string, userId: string, userEmail: string, optionId: string): boolean {
    const voteKey = `${pollId}#${userId}`;

    // Check if already voted
    const existing = db.prepare('SELECT pk FROM polls WHERE pk = ? AND sk = ?').get(voteKey, 'vote');
    if (existing) return false;

    const txn = db.transaction(() => {
        // Insert vote
        db.prepare(`
      INSERT INTO polls (pk, sk, pollId, userId, userEmail, optionId, createdAt)
      VALUES (?, 'vote', ?, ?, ?, ?, datetime('now'))
    `).run(voteKey, pollId, userId, userEmail, optionId);

        // Upsert results — increment vote count
        const colName = `votes_${optionId}`;
        // Check if results row exists
        const resultsRow = db.prepare('SELECT pk FROM polls WHERE pk = ? AND sk = ?').get(pollId, 'results');

        if (!resultsRow) {
            // Create results row with this vote
            db.prepare(`
        INSERT INTO polls (pk, sk, pollId, totalVotes, data, createdAt)
        VALUES (?, 'results', ?, 1, ?, datetime('now'))
      `).run(pollId, pollId, JSON.stringify({ [colName]: 1 }));
        } else {
            // Update existing results
            const current = db.prepare('SELECT data, totalVotes FROM polls WHERE pk = ? AND sk = ?').get(pollId, 'results') as any;
            const data = JSON.parse(current?.data || '{}');
            data[colName] = (data[colName] || 0) + 1;
            const totalVotes = (current?.totalVotes || 0) + 1;
            db.prepare('UPDATE polls SET data = ?, totalVotes = ? WHERE pk = ? AND sk = ?')
                .run(JSON.stringify(data), totalVotes, pollId, 'results');
        }
    });

    txn();
    return true;
}

// ======================== Cleanup ========================

export function cleanupExpiredBans(): number {
    const result = db.prepare("DELETE FROM blocked_ips WHERE expiresAt IS NOT NULL AND expiresAt < datetime('now')").run();
    return result.changes;
}

export function cleanupOldGuestLimits(): number {
    // Delete guest limits older than 3 hours
    const cutoff = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
    const result = db.prepare('DELETE FROM guest_limits WHERE updatedAt < ?').run(cutoff);
    return result.changes;
}

export function cleanupOldUrlRateLimits(): number {
    const cutoff = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    const result = db.prepare('DELETE FROM url_rate_limits WHERE updatedAt < ?').run(cutoff);
    return result.changes;
}

export function getExpiredGuestDownloads(): any[] {
    const now = new Date().toISOString();
    return db.prepare(`
    SELECT * FROM downloads
    WHERE status = 'completed'
      AND userId LIKE 'guest_%'
      AND guestDeleteAfter IS NOT NULL
      AND guestDeleteAfter <= ?
  `).all(now).map((row: any) => ({ ...row, embedLyrics: !!row.embedLyrics }));
}

export function getExpiredDownloadsWithFiles(): any[] {
    const now = new Date().toISOString();
    return db.prepare(`
    SELECT * FROM downloads
    WHERE status = 'completed'
      AND downloadUrl IS NOT NULL
      AND guestDeleteAfter IS NOT NULL
      AND guestDeleteAfter <= ?
  `).all(now).map((row: any) => ({ ...row, embedLyrics: !!row.embedLyrics }));
}

// ======================== Routing Config ========================

export interface RoutingConfig {
    mode: 'vps_only' | 'worker_only' | 'hybrid';
    vpsMaxConcurrent: number;
    vpsMaxTracks: number;
    workerMaxClaim: number;
}

const ROUTING_DEFAULTS: RoutingConfig = {
    mode: 'hybrid',
    vpsMaxConcurrent: 3,
    vpsMaxTracks: 3,
    workerMaxClaim: 20,
};

export function getRoutingConfig(): RoutingConfig {
    const rows = db.prepare("SELECT key, value FROM routing_config WHERE key IN ('mode','vpsMaxConcurrent','vpsMaxTracks','workerMaxClaim')").all() as { key: string; value: string }[];
    const map = Object.fromEntries(rows.map(r => [r.key, r.value]));
    return {
        mode: (map.mode as RoutingConfig['mode']) || ROUTING_DEFAULTS.mode,
        vpsMaxConcurrent: parseInt(map.vpsMaxConcurrent) || ROUTING_DEFAULTS.vpsMaxConcurrent,
        vpsMaxTracks: parseInt(map.vpsMaxTracks) || ROUTING_DEFAULTS.vpsMaxTracks,
        workerMaxClaim: parseInt(map.workerMaxClaim) || ROUTING_DEFAULTS.workerMaxClaim,
    };
}

export function setRoutingConfig(cfg: Partial<RoutingConfig>): RoutingConfig {
    const upsert = db.prepare("INSERT INTO routing_config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value");
    const tx = db.transaction(() => {
        if (cfg.mode) upsert.run('mode', cfg.mode);
        if (cfg.vpsMaxConcurrent != null) upsert.run('vpsMaxConcurrent', String(cfg.vpsMaxConcurrent));
        if (cfg.vpsMaxTracks != null) upsert.run('vpsMaxTracks', String(cfg.vpsMaxTracks));
        if (cfg.workerMaxClaim != null) upsert.run('workerMaxClaim', String(cfg.workerMaxClaim));
    });
    tx();
    return getRoutingConfig();
}
