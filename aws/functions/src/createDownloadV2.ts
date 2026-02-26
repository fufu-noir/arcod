/**
 * Create Download V2 - creates a new download job
 */
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { createDownloadJob } from './dynamodb-v2.js';
import type { DownloadJobV2, CreateDownloadRequestV2 } from './types-v2.js';
import { authenticateRequest } from './cognito-auth.js';
import { incrementGuestDownload, getGuestRateLimitStatus } from './guest-rate-limit.js';
import { v4 as uuidv4 } from 'uuid';

// CORS headers
const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Forwarded-For'
};

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
    try {
        // Parse request
        const body: CreateDownloadRequestV2 = JSON.parse(event.body || '{}');

        // Get client IP for guest rate limiting
        const clientIp = event.headers['X-Forwarded-For']?.split(',')[0]?.trim()
            || event.requestContext.identity?.sourceIp
            || 'unknown';

        // Get user from Authorization header using Cognito verification
        const authHeader = event.headers.Authorization || event.headers.authorization;
        let userId = 'anonymous';
        let userEmail = 'unknown@example.com';
        let isGuest = true;

        if (authHeader) {
            const authUser = await authenticateRequest(authHeader);
            if (authUser) {
                userId = authUser.uid;
                userEmail = authUser.email || 'unknown@example.com';
                isGuest = false;
            }
        }

        // For guest users, check and apply rate limit
        if (isGuest) {
            // First check current status
            const status = await getGuestRateLimitStatus(clientIp);

            if (status.isLimited) {
                console.log(`[Guest Rate Limit] IP ${clientIp} has exceeded limit: ${status.downloadsThisHour}/${status.limit}`);
                return {
                    statusCode: 429,
                    headers: {
                        ...headers,
                        'X-RateLimit-Limit': String(status.limit),
                        'X-RateLimit-Remaining': '0',
                        'X-RateLimit-Reset': status.resetsAt
                    },
                    body: JSON.stringify({
                        error: 'Rate limit exceeded',
                        message: `You have reached the limit of ${status.limit} downloads per hour. Create a free account for unlimited access!`,
                        limit: status.limit,
                        remaining: 0,
                        resetsAt: status.resetsAt
                    })
                };
            }

            // Increment the download count
            const result = await incrementGuestDownload(clientIp);
            console.log(`[Guest Download] IP ${clientIp}: ${result.count}/${status.limit}`);

            // Update userId/email for guest tracking
            userId = `guest_${clientIp}`;
            userEmail = `guest_${clientIp}@guest.arcod.app`;
        }

        // Validate required fields
        if (!body.albumId || !body.albumTitle || !body.artistName) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ error: 'Missing required fields: albumId, albumTitle, artistName' })
            };
        }

        // Build the job
        const jobId = uuidv4();
        const now = new Date().toISOString();

        const job: DownloadJobV2 = {
            id: jobId,
            userId,
            userEmail,
            status: 'pending',
            progress: 0,
            description: 'Queued...',

            // Album info
            albumId: body.albumId,
            trackId: body.trackId,
            albumTitle: body.albumTitle,
            artistName: body.artistName,
            artistId: body.artistId || '',
            coverUrl: body.coverUrl || '',
            releaseDate: body.releaseDate,
            tracksCount: body.tracksCount || 0,

            // Settings
            quality: body.quality || 27,
            format: body.format || 'FLAC',
            bitrate: body.bitrate,
            embedLyrics: body.embedLyrics !== false,
            lyricsMode: body.lyricsMode || 'embed',
            zipName: body.zipName,
            trackName: body.trackName,
            source: body.source || 'qobuz',

            // Metadata
            country: body.country,
            createdAt: now,
            updatedAt: now
            // No TTL - permanent storage
        };

        await createDownloadJob(job);

        console.log(`[${jobId}] Created download job for user ${userId}: ${body.artistName} - ${body.albumTitle}`);

        return {
            statusCode: 201,
            headers,
            body: JSON.stringify({
                id: jobId,
                status: 'pending',
                albumTitle: job.albumTitle,
                artistName: job.artistName,
                coverUrl: job.coverUrl
            })
        };

    } catch (error: any) {
        console.error('Error creating download:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ error: error.message || 'Internal server error' })
        };
    }
}
