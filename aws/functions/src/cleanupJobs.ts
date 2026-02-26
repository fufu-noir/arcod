/**
 * Cleanup stuck/old jobs on a schedule (EventBridge)
 * Also exposes an HTTP endpoint for manual cleanup
 */
import type { APIGatewayEvent, APIGatewayResponse } from './types.js';
import { CORS_HEADERS } from './types.js';
import {
    queryStuckJobs,
    queryCompletedJobsForDeletion,
    updateJob,
    deleteJob
} from './dynamodb.js';
import { deleteFolder } from './s3.js';

interface ScheduledEvent {
    source: string;
    'detail-type': string;
}

/**
 * Scheduled cleanup handler (EventBridge)
 */
export async function handler(event: ScheduledEvent | APIGatewayEvent): Promise<void | APIGatewayResponse> {
    // Check if this is an HTTP request (manual cleanup)
    if ('httpMethod' in event) {
        return manualHandler(event);
    }

    // Scheduled cleanup
    await performCleanup();
}

/**
 * Manual cleanup via HTTP endpoint
 */
export async function manualHandler(event: APIGatewayEvent): Promise<APIGatewayResponse> {
    // Handle CORS preflight
    if (event.httpMethod === 'OPTIONS') {
        return {
            statusCode: 200,
            headers: CORS_HEADERS,
            body: ''
        };
    }

    if (event.httpMethod !== 'POST') {
        return {
            statusCode: 405,
            headers: CORS_HEADERS,
            body: JSON.stringify({ success: false, error: 'Method not allowed' })
        };
    }

    try {
        const result = await performCleanup();

        return {
            statusCode: 200,
            headers: CORS_HEADERS,
            body: JSON.stringify({
                success: true,
                ...result
            })
        };

    } catch (error) {
        console.error('Manual cleanup error:', error);
        return {
            statusCode: 500,
            headers: CORS_HEADERS,
            body: JSON.stringify({
                success: false,
                error: error instanceof Error ? error.message : 'Internal error'
            })
        };
    }
}

/**
 * Run the cleanup logic.
 * Only cleans up failed/cancelled job records and their temp S3 files.
 * Completed downloads are never touched.
 */
async function performCleanup(): Promise<{ markedFailed: number; deleted: number; filesDeleted: number }> {
    const stuckCutoffTime = new Date(Date.now() - 10 * 60 * 1000).toISOString(); // 10 minutes ago
    // For deleting old JOB RECORDS (not files!), use 24 hours
    const jobRecordsCutoffTime = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(); // 24 hours ago

    let markedFailed = 0;
    let deleted = 0;
    let filesDeleted = 0;

    try {
        // STEP 1: Mark stuck jobs as failed
        const stuckJobs = await queryStuckJobs(stuckCutoffTime);

        for (const job of stuckJobs) {
            console.warn(`Marking stuck job as failed: ${job.id} (status: ${job.status}, last update: ${job.updatedAt})`);

            await updateJob(job.id, {
                status: 'failed',
                description: 'Job timed out - no activity for 10+ minutes',
                error: 'Timeout: Job was stuck without progress'
            });

            markedFailed++;
        }

        // STEP 2: Delete old FAILED/CANCELLED job RECORDS only (NOT completed ones with files!)
        // We only delete DynamoDB records for failed/cancelled jobs that have no S3 files anyway
        const jobsToDelete = await queryCompletedJobsForDeletion(jobRecordsCutoffTime);

        for (const job of jobsToDelete) {
            // ONLY delete S3 files for FAILED or CANCELLED jobs (which don't have valid files)
            // NEVER delete files for COMPLETED jobs!
            if (job.status === 'failed' || job.status === 'cancelled') {
                const filesCount = await deleteFolder(`downloads/${job.id}/`);
                filesDeleted += filesCount;

                // Delete the job record from DynamoDB
                await deleteJob(job.id);
                deleted++;

                console.log(`Deleted failed/cancelled job ${job.id} and ${filesCount} temp files`);
            }
            // For COMPLETED jobs, we DO NOT delete anything - those are permanent!
        }

        if (markedFailed > 0) {
            console.log(`Cleanup: Marked ${markedFailed} stuck jobs as failed`);
        }
        if (deleted > 0) {
            console.log(`Cleanup: Deleted ${deleted} old failed/cancelled job records and ${filesDeleted} temp files`);
        }

    } catch (error) {
        console.error('Cleanup error:', error);
    }

    return { markedFailed, deleted, filesDeleted };
}
