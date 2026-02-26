/**
 * Create Job Lambda Function
 * Creates a new download job and stores it in DynamoDB
 */
import { v4 as uuidv4 } from 'uuid';
import type { APIGatewayEvent, APIGatewayResponse, DownloadJob, CORS_HEADERS } from './types.js';
import { CORS_HEADERS as corsHeaders } from './types.js';
import { authenticateRequest } from './cognito-auth.js';
import {
    createJob,
    isIPBlocked,
    getRateLimit,
    countDownloadsSince,
    logDownload,
    countActiveJobs
} from './dynamodb.js';

const REGION = 'eu-north-1';
const REGION_NAME = 'Stockholm';
const MAX_INSTANCES = 10;
// Force redeploy v4

export async function handler(event: APIGatewayEvent): Promise<APIGatewayResponse> {
    // Handle CORS preflight
    if (event.httpMethod === 'OPTIONS') {
        return {
            statusCode: 200,
            headers: corsHeaders,
            body: ''
        };
    }

    if (event.httpMethod !== 'POST') {
        return {
            statusCode: 405,
            headers: corsHeaders,
            body: JSON.stringify({ success: false, error: 'Method not allowed' })
        };
    }

    try {
        // Get client IP
        const clientIp = event.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
            event.requestContext?.identity?.sourceIp || '';
        const userAgent = event.headers['user-agent'] || '';

        // SECURITY: Check if IP is blocked
        if (await isIPBlocked(clientIp)) {
            console.warn('Banned IP', { ip: clientIp, userAgent });
            return {
                statusCode: 403,
                headers: corsHeaders,
                body: JSON.stringify({ success: false, error: 'Forbidden' })
            };
        }

        // SECURITY: Check rate limiting
        const rateLimit = await getRateLimit(clientIp);
        if (rateLimit && rateLimit.maxDownloadsPerHour > 0) {
            const now = new Date();
            const startOfHour = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours(), 0, 0, 0);
            const startOfHourISO = startOfHour.toISOString();

            const currentDownloads = await countDownloadsSince(clientIp, startOfHourISO);

            if (currentDownloads >= rateLimit.maxDownloadsPerHour) {
                const minutesUntilReset = 60 - now.getMinutes();
                console.warn('Rate limited IP exceeded quota', {
                    ip: clientIp,
                    currentDownloads,
                    maxDownloadsPerHour: rateLimit.maxDownloadsPerHour,
                    minutesUntilReset
                });

                return {
                    statusCode: 429,
                    headers: corsHeaders,
                    body: JSON.stringify({
                        success: false,
                        error: `Limite atteinte (${rateLimit.maxDownloadsPerHour}/heure). Réessayez dans ${minutesUntilReset} minute${minutesUntilReset > 1 ? 's' : ''}.`,
                        retryAfter: minutesUntilReset * 60
                    })
                };
            }
        }

        // SECURITY: Block bot user agents
        const blockedUserAgents = ['java', 'python', 'curl', 'wget', 'httpie', 'postman'];
        if (blockedUserAgents.some(ua => userAgent.toLowerCase().includes(ua))) {
            console.warn('Blocked bot user-agent:', { ip: clientIp, userAgent });
            return {
                statusCode: 403,
                headers: corsHeaders,
                body: JSON.stringify({ success: false, error: 'Forbidden' })
            };
        }

        // SECURITY: Verify Firebase Auth token
        const auth = await authenticateRequest(event.headers['authorization'] || event.headers['Authorization'] || '');
        if (!auth) {
            console.warn('Rejected request without valid auth token:', {
                ip: clientIp,
                userAgent: userAgent.substring(0, 50)
            });
            return {
                statusCode: 401,
                headers: corsHeaders,
                body: JSON.stringify({ success: false, error: 'Authentication required' })
            };
        }

        // Parse request body
        const body = JSON.parse(event.body || '{}');
        const { albumId, settings, country, metadata, type, trackId } = body;

        if (!albumId || !settings) {
            return {
                statusCode: 400,
                headers: corsHeaders,
                body: JSON.stringify({ success: false, error: 'Missing albumId or settings' })
            };
        }

        // Check capacity
        const activeJobs = await countActiveJobs();
        if (activeJobs >= MAX_INSTANCES) {
            return {
                statusCode: 503,
                headers: corsHeaders,
                body: JSON.stringify({
                    success: false,
                    error: 'Server is at capacity. Please try again in a few minutes.',
                    retryAfter: 60
                })
            };
        }

        // Create the job
        const now = new Date().toISOString();
        const logId = uuidv4();
        const job: DownloadJob = {
            id: uuidv4(),
            type: type || 'album',
            status: 'pending',
            progress: 0,
            description: 'Job created...',
            createdAt: now,
            updatedAt: now,
            settings,
            albumId,
            trackId: trackId ?? null,
            albumTitle: metadata?.title,
            artistName: metadata?.artistName,
            trackCount: metadata?.trackCount,
            userId: auth.uid,
            userEmail: auth.email || null,
            region: REGION,
            regionName: REGION_NAME,
            // Sanitize albumInfo immediately to match frontend expectations
            albumInfo: metadata?.albumInfo ? JSON.stringify({
                id: metadata.albumInfo.id,
                title: metadata.albumInfo.title,
                artist: metadata.albumInfo.artist?.name || 'Unknown Artist',
                coverUrl: metadata.albumInfo.image?.large || metadata.albumInfo.image?.small || '',
                quality: settings.quality === 27 ? 'Hi-Res' : (settings.quality >= 6 ? 'CD' : 'MP3')
            }) : undefined,
            country: country || undefined,
            logId: logId,
            // Set TTL to 1 hour from now (DynamoDB will auto-delete if job is abandoned)
            ttl: Math.floor(Date.now() / 1000) + (60 * 60)
        };

        await createJob(job);

        console.log('Job created', {
            jobId: job.id,
            type: job.type,
            albumId,
            region: REGION,
            activeJobs,
            ip: clientIp,
            user: auth.email || auth.uid,
            userAgent: userAgent.substring(0, 50)
        });

        // Log download for rate limiting and permanent history
        await logDownload({
            id: logId,
            ip: clientIp,
            jobId: job.id,
            userId: auth.uid,
            userEmail: auth.email || null,
            createdAt: now,
            albumTitle: job.albumTitle,
            artistName: job.artistName,
            type: job.type,
            albumInfo: job.albumInfo
        });

        return {
            statusCode: 201,
            headers: corsHeaders,
            body: JSON.stringify({
                success: true,
                job: {
                    ...job,
                    albumInfo: undefined // Don't send back the large albumInfo
                }
            })
        };

    } catch (error) {
        console.error('Create job error:', error);
        return {
            statusCode: 500,
            headers: corsHeaders,
            body: JSON.stringify({
                success: false,
                error: error instanceof Error ? error.message : 'Internal error'
            })
        };
    }
}
