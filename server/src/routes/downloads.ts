/**
 * download routes — /v2/downloads/*
 */
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { v4 as uuidv4 } from 'uuid';
import { authenticateRequest } from '../auth/supabase.js';
import {
    createDownload, getDownload, updateDownload, deleteDownload as dbDeleteDownload,
    getDownloadsByEmail, countActiveJobsForUser, findActiveDownloadForUser,
    findReusableCompletedDownloadForUser, findPreviousDownloadForUser,
} from '../db/client.js';
import { deleteFolder, generatePresignedUrl, extractKeyFromUrl, objectExistsInR2 } from '../storage/r2.js';
import { getClientIP } from '../services/antibot.js';
import { getAlbumInfoFromQobuz } from '../services/qobuz-api.js';
import { config } from '../config.js';
import { isMaintenanceMode, getMaintenanceMessage } from './admin.js';

export async function downloadRoutes(fastify: FastifyInstance) {

    // POST /v2/downloads — Create new download job
    fastify.post('/v2/downloads', async (req: FastifyRequest, reply: FastifyReply) => {
        if (isMaintenanceMode()) {
            return reply.code(503).send({ error: getMaintenanceMessage(), code: 'MAINTENANCE' });
        }

        const body = req.body as any;
        const authHeader = req.headers.authorization || '';
        const user = await authenticateRequest(authHeader);
        const clientIp = getClientIP(req);

        const isGuest = !user;
        const userId = user?.uid || `guest_${clientIp}`;
        const userEmail = user?.email || `guest_${clientIp}`;

        // Guest users are locked to MP3 320kbps — server-side enforcement
        const effectiveFormat = isGuest ? 'MP3' : (body.format || 'FLAC');
        const effectiveQuality = isGuest ? 5 : (body.quality || 27);
        const requestedAlbumId = body.albumId || '';
        const requestedTrackId = body.trackId || null;
        const requestedBitrate = body.bitrate || null;
        const requestedSource = body.source || 'qobuz';

        if (isGuest && requestedAlbumId && !requestedTrackId) {
            const albumInfo = await getAlbumInfoFromQobuz(requestedAlbumId, body.country || null);
            const releaseTrackCount = albumInfo.tracks?.items?.length || 0;

            if (releaseTrackCount > config.guestReleaseTrackLimit) {
                return reply.code(403).send({
                    error: `Guest downloads are limited to releases with at most ${config.guestReleaseTrackLimit} tracks.`,
                    code: 'GUEST_RELEASE_TRACK_LIMIT_EXCEEDED',
                    maxTracks: config.guestReleaseTrackLimit,
                    trackCount: releaseTrackCount,
                });
            }
        }

        if (!isGuest && requestedAlbumId) {
            const existingDownload = findReusableCompletedDownloadForUser({
                userId,
                albumId: requestedAlbumId,
                trackId: requestedTrackId,
                format: effectiveFormat,
                quality: effectiveQuality,
                bitrate: requestedBitrate,
                source: requestedSource,
            });

            // Only reuse if the file is still available on R2
            if (existingDownload && existingDownload.downloadUrl) {
                const existingKey = extractKeyFromUrl(existingDownload.downloadUrl);
                if (await objectExistsInR2(existingKey)) {
                    return reply.send({
                        id: existingDownload.id,
                        accessToken: null,
                        status: 'completed',
                        reusedFromLibrary: true,
                        albumTitle: existingDownload.albumTitle,
                        artistName: existingDownload.artistName,
                        coverUrl: existingDownload.coverUrl,
                        fileName: existingDownload.fileName,
                    });
                }

                updateDownload(existingDownload.id, {
                    downloadUrl: null,
                    guestDeleteAfter: null,
                    description: 'File expired',
                });
            }
        }

        if (requestedAlbumId) {
            const existingActiveDownload = findActiveDownloadForUser({
                userId,
                albumId: requestedAlbumId,
                trackId: requestedTrackId,
                format: effectiveFormat,
                quality: effectiveQuality,
                bitrate: requestedBitrate,
                source: requestedSource,
            });

            if (existingActiveDownload) {
                return reply.send({
                    id: existingActiveDownload.id,
                    accessToken: existingActiveDownload.downloadAccessToken || null,
                    status: existingActiveDownload.status,
                    deduplicated: true,
                    albumTitle: existingActiveDownload.albumTitle,
                    artistName: existingActiveDownload.artistName,
                    coverUrl: existingActiveDownload.coverUrl,
                    progress: existingActiveDownload.progress,
                    description: existingActiveDownload.description,
                });
            }
        }

        // Recycle a previous failed/cancelled/expired job instead of creating a new one
        if (requestedAlbumId) {
            const previousDownload = findPreviousDownloadForUser({
                userId,
                albumId: requestedAlbumId,
                trackId: requestedTrackId,
                format: effectiveFormat,
                quality: effectiveQuality,
                bitrate: requestedBitrate,
                source: requestedSource,
            });

            if (previousDownload) {
                const now = new Date().toISOString();
                updateDownload(previousDownload.id, {
                    status: 'pending',
                    progress: 0,
                    description: 'Queued...',
                    error: null,
                    fileName: null,
                    fileSize: null,
                    downloadUrl: null,
                    guestDownloadIssuedAt: null,
                    guestDeleteAfter: null,
                    claimedBy: null,
                    claimedAt: null,
                    updatedAt: now,
                    // Update metadata in case user changed settings
                    embedLyrics: body.embedLyrics || false,
                    lyricsMode: body.lyricsMode || 'embed',
                    downloadBooklet: body.downloadBooklet || false,
                    attachCover: body.attachCover || false,
                    zipName: body.zipName || null,
                    trackName: body.trackName || null,
                });
                (req as any).createdDownloadId = previousDownload.id;
                return reply.code(201).send({
                    id: previousDownload.id,
                    accessToken: previousDownload.downloadAccessToken || null,
                    status: 'pending',
                    recycled: true,
                    albumTitle: previousDownload.albumTitle,
                    artistName: previousDownload.artistName,
                    coverUrl: previousDownload.coverUrl,
                });
            }
        }

        const activeJobs = countActiveJobsForUser(userId);
        if (activeJobs >= config.authUserConcurrentLimit) {
            return reply.code(429).send({
                error: `You already have ${activeJobs} job(s) queued or processing. Max allowed: ${config.authUserConcurrentLimit}.`,
                code: 'QUEUE_LIMIT_REACHED',
                limit: config.authUserConcurrentLimit,
                activeJobs,
            });
        }

        // Create job
        const id = uuidv4();
        const accessToken = uuidv4();
        const now = new Date().toISOString();

        const job = {
            id,
            userId,
            userEmail,
            status: 'pending',
            progress: 0,
            description: 'Queued...',
            albumId: requestedAlbumId,
            trackId: requestedTrackId,
            albumTitle: typeof body.albumTitle === 'object' ? (body.albumTitle?.display || body.albumTitle?.name || JSON.stringify(body.albumTitle)) : (body.albumTitle || ''),
            artistName: typeof body.artistName === 'object' ? (body.artistName?.display || body.artistName?.name || JSON.stringify(body.artistName)) : (body.artistName || ''),
            artistId: typeof body.artistId === 'object' ? String(body.artistId) : (body.artistId || ''),
            coverUrl: body.coverUrl || '',
            releaseDate: body.releaseDate || null,
            tracksCount: body.tracksCount || 0,
            quality: effectiveQuality,
            format: effectiveFormat,
            bitrate: requestedBitrate,
            embedLyrics: body.embedLyrics || false,
            lyricsMode: body.lyricsMode || 'embed',
            downloadBooklet: body.downloadBooklet || false,
            attachCover: body.attachCover || false,
            zipName: body.zipName || null,
            trackName: body.trackName || null,
            source: requestedSource,
            downloadAccessToken: isGuest ? accessToken : null,
            country: body.country || null,
            ip: clientIp,
            createdAt: now,
            updatedAt: now,
        };

        createDownload(job);
        (req as any).createdDownloadId = id;

        return reply.code(201).send({
            id,
            accessToken: isGuest ? accessToken : null,
            status: 'pending',
            albumTitle: body.albumTitle,
            artistName: body.artistName,
            coverUrl: body.coverUrl,
        });
    });

    // GET /v2/downloads/:id — Get download status
    fastify.get('/v2/downloads/:id', async (req: FastifyRequest, reply: FastifyReply) => {
        const { id } = req.params as { id: string };
        const authHeader = req.headers.authorization || '';
        const user = await authenticateRequest(authHeader);
        const accessToken = (req.headers['x-download-token'] as string) || (req.query as any).token;

        const job = getDownload(id);
        if (!job) return reply.code(404).send({ error: 'Job not found' });

        // Access control
        if (user?.uid !== job.userId && job.downloadAccessToken !== accessToken) {
            const isAdminUser = user && Array.isArray(user.groups) && user.groups.includes('Admins');
            if (!isAdminUser) return reply.code(403).send({ error: 'Access denied' });
        }

        return reply.send({
            id: job.id,
            status: job.status,
            progress: job.progress,
            description: job.description,
            error: job.error,
            fileName: job.fileName,
            fileSize: job.fileSize,
            downloadUrl: job.status === 'completed' && job.downloadUrl ? job.downloadUrl : undefined,
            albumTitle: job.albumTitle,
            artistName: job.artistName,
            coverUrl: job.coverUrl,
        });
    });

    // GET /v2/downloads — List user downloads (library)
    fastify.get('/v2/downloads', async (req: FastifyRequest, reply: FastifyReply) => {
        const authHeader = req.headers.authorization || '';
        const user = await authenticateRequest(authHeader);

        if (!user) return reply.code(401).send({ error: 'Authentication required' });

        const downloads = getDownloadsByEmail(user.email, 500);
        const completed = downloads
            .filter((d: any) => d.status === 'completed')
            .map((d: any) => ({
                id: d.id,
                albumId: d.albumId,
                trackId: d.trackId,
                artistId: d.artistId,
                type: d.trackId ? 'track' : 'album',
                albumTitle: d.albumTitle,
                artistName: d.artistName,
                coverUrl: d.coverUrl,
                fileName: d.fileName,
                fileSize: d.fileSize,
                format: d.format,
                quality: d.quality,
                hasFile: !!d.downloadUrl,
                createdAt: d.createdAt,
            }));

        return reply.send({ success: true, downloads: completed });
    });

    // POST /v2/downloads/:id/url — Generate signed download URL
    fastify.post('/v2/downloads/:id/url', async (req: FastifyRequest, reply: FastifyReply) => {
        const { id } = req.params as { id: string };
        const authHeader = req.headers.authorization || '';
        const user = await authenticateRequest(authHeader);
        const accessToken = (req.headers['x-download-token'] as string) || (req.body as any)?.accessToken || (req.query as any)?.token;

        const job = getDownload(id);
        if (!job) return reply.code(404).send({ error: 'Job not found' });
        if (job.status !== 'completed') {
            return reply.code(400).send({ error: 'Download not ready' });
        }

        // Access control
        const isOwner = user?.uid === job.userId;
        const isGuestOwner = !user && job.downloadAccessToken === accessToken;
        if (!isOwner && !isGuestOwner) return reply.code(403).send({ error: 'Access denied' });

        // File expired — client must create a new job to re-download
        if (!job.downloadUrl) {
            return reply.code(410).send({
                error: 'File expired',
                needsRedownload: true,
                albumId: job.albumId,
                trackId: job.trackId,
                albumTitle: job.albumTitle,
                artistName: job.artistName,
                coverUrl: job.coverUrl,
                quality: job.quality,
                format: job.format,
            });
        }

        // Generate presigned URL (5 min expiry)
        const key = extractKeyFromUrl(job.downloadUrl);
        if (!(await objectExistsInR2(key))) {
            updateDownload(id, {
                downloadUrl: null,
                guestDeleteAfter: null,
                description: 'File expired',
            });

            return reply.code(410).send({
                error: 'File expired',
                needsRedownload: true,
                albumId: job.albumId,
                trackId: job.trackId,
                albumTitle: job.albumTitle,
                artistName: job.artistName,
                coverUrl: job.coverUrl,
                quality: job.quality,
                format: job.format,
            });
        }

        const signedUrl = await generatePresignedUrl(key, 300);

        return reply.send({
            downloadUrl: signedUrl,
            fileName: job.fileName,
            expiresIn: 300,
        });
    });

    // DELETE /v2/downloads/:id — Delete a download
    fastify.delete('/v2/downloads/:id', async (req: FastifyRequest, reply: FastifyReply) => {
        const { id } = req.params as { id: string };
        const authHeader = req.headers.authorization || '';
        const user = await authenticateRequest(authHeader);

        if (!user) return reply.code(401).send({ error: 'Authentication required' });

        const job = getDownload(id);
        if (!job) return reply.code(404).send({ error: 'Job not found' });
        if (user.uid !== job.userId) {
            if (!(user.groups || []).includes('Admins')) {
                return reply.code(403).send({ error: 'Access denied' });
            }
        }

        // Delete files from R2
        try {
            if (job.downloadUrl) {
                const key = extractKeyFromUrl(job.downloadUrl);
                const prefix = key.substring(0, key.lastIndexOf('/') + 1);
                if (prefix) await deleteFolder(prefix);
            }
        } catch (err) {
            console.warn(`Failed to delete R2 files for ${id}:`, err);
        }

        dbDeleteDownload(id);
        return reply.send({ success: true });
    });

    // POST /v2/downloads/:id/cancel — Cancel a download
    fastify.post('/v2/downloads/:id/cancel', async (req: FastifyRequest, reply: FastifyReply) => {
        const { id } = req.params as { id: string };
        const authHeader = req.headers.authorization || '';
        const user = await authenticateRequest(authHeader);

        const job = getDownload(id);
        if (!job) return reply.code(404).send({ error: 'Job not found' });

        // Check access
        if (user?.uid !== job.userId) {
            const isAdmin = user && (user.groups || []).includes('Admins');
            if (!isAdmin) return reply.code(403).send({ error: 'Access denied' });
        }

        if (['completed', 'cancelled', 'failed'].includes(job.status)) {
            return reply.code(400).send({ error: 'Cannot cancel this job' });
        }

        updateDownload(id, { status: 'cancelled', description: 'Cancelled by user' });
        return reply.send({ success: true });
    });

    // GET /v2/storage — No storage limits (files are temporary)
    fastify.get('/v2/storage', async (req: FastifyRequest, reply: FastifyReply) => {
        return reply.send({
            success: true,
            storage: {
                unlimited: true,
            }
        });
    });

    // GET /v2/guest/rate-limit — Guest rate limit info (returns unlimited)
    fastify.get('/v2/guest/rate-limit', async (req: FastifyRequest, reply: FastifyReply) => {
        return reply.send({
            ip: getClientIP(req),
            downloadsThisHour: 0,
            limit: 999999,
            remaining: 999999,
            resetsAt: new Date(Date.now() + 3600000).toISOString(),
            isLimited: false,
        });
    });
}
