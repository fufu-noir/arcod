/**
 * Get Download V2 - returns job status
 */
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { getDownloadJob, updateDownloadJob } from './dynamodb-v2.js';
import type { DownloadStatusV2 } from './types-v2.js';

const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization'
};

// If a job stays in 'pending' longer than this, assume the DynamoDB Stream
// never triggered the Lambda (throttle, cold-start timeout, etc.) and auto-fail it.
const PENDING_TIMEOUT_MS = 3 * 60 * 1000; // 3 minutes

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
    try {
        const jobId = event.pathParameters?.jobId;

        if (!jobId) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ error: 'Missing jobId' })
            };
        }

        const job = await getDownloadJob(jobId);

        if (!job) {
            return {
                statusCode: 404,
                headers,
                body: JSON.stringify({ error: 'Job not found' })
            };
        }

        // Watchdog: auto-fail jobs that are stuck in 'pending' too long.
        // This happens when the DynamoDB Stream fails to trigger processDownloadV2
        // (Lambda throttling, stream shard issue, cold-start timeout, etc.).
        if (job.status === 'pending' && job.createdAt) {
            const age = Date.now() - new Date(job.createdAt).getTime();
            if (age > PENDING_TIMEOUT_MS) {
                console.warn(`[${jobId}] Job stuck in pending for ${Math.round(age / 1000)}s — auto-failing`);
                await updateDownloadJob(jobId, {
                    status: 'failed',
                    description: 'Job timed out (processing never started). Please try again.',
                    error: 'Processing Lambda was never triggered. This is usually a temporary AWS issue — please retry.'
                });
                job.status = 'failed';
                job.description = 'Job timed out (processing never started). Please try again.';
                job.error = 'Processing Lambda was never triggered. This is usually a temporary AWS issue — please retry.';
            }
        }

        // Build response
        const status: DownloadStatusV2 = {
            id: job.id,
            status: job.status,
            progress: job.progress,
            description: job.description,
            error: job.error,
            downloadUrl: job.downloadUrl,
            fileName: job.fileName,
            fileSize: job.fileSize,
            albumTitle: job.albumTitle,
            artistName: job.artistName,
            coverUrl: job.coverUrl
        };

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify(status)
        };

    } catch (error: any) {
        console.error('Error getting download:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ error: error.message || 'Internal server error' })
        };
    }
}
