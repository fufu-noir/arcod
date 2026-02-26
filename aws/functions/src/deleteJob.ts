
import type { APIGatewayEvent, APIGatewayResponse } from './types.js';
import { CORS_HEADERS as corsHeaders } from './types.js';
import { authenticateRequest } from './cognito-auth.js';
import { getJobById, deleteJob, getDownloadLogById, deleteDownloadLog } from './dynamodb.js';
import { deleteFolder } from './s3.js';

export async function handler(event: APIGatewayEvent): Promise<APIGatewayResponse> {
    // Handle CORS preflight
    if (event.httpMethod === 'OPTIONS') {
        return {
            statusCode: 200,
            headers: corsHeaders,
            body: ''
        };
    }

    if (event.httpMethod !== 'DELETE') {
        return {
            statusCode: 405,
            headers: corsHeaders,
            body: JSON.stringify({ success: false, error: 'Method not allowed' })
        };
    }

    try {
        const jobId = event.pathParameters?.jobId;
        if (!jobId) {
            return {
                statusCode: 400,
                headers: corsHeaders,
                body: JSON.stringify({ success: false, error: 'Missing jobId' })
            };
        }

        // Check ownership (allow matching by UID or Email)
        const auth = await authenticateRequest(event.headers['authorization'] || event.headers['Authorization'] || '');
        if (!auth) {
            return {
                statusCode: 401,
                headers: corsHeaders,
                body: JSON.stringify({ success: false, error: 'Authentication required' })
            };
        }

        // Try to find in Download Logs first (most likely for history deletion)
        let logItem = await getDownloadLogById(jobId);
        let jobItem = await getJobById(jobId);

        // Determine which one is the "primary" record we found
        const item = logItem || jobItem;

        if (!item) {
            return {
                statusCode: 404,
                headers: corsHeaders,
                body: JSON.stringify({ success: false, error: 'Job not found' })
            };
        }

        // Check ownership
        const isOwner = item.userId === auth.uid || (auth.email && item.userEmail === auth.email);

        if (!isOwner) {
            return {
                statusCode: 403,
                headers: corsHeaders,
                body: JSON.stringify({ success: false, error: 'Forbidden' })
            };
        }

        // Determine actual Job ID for S3 (if we found a log, it has the jobRef)
        const actualJobId = logItem?.jobId || jobItem?.id || jobId;

        // Delete from S3
        await deleteFolder(`downloads/${actualJobId}/`);

        // Delete from DynamoDB (try both to be clean)
        const deletions = [];
        if (logItem) deletions.push(deleteDownloadLog(logItem.id)); // Delete log
        if (jobItem) deletions.push(deleteJob(jobItem.id));         // Delete job if matched by ID directly
        if (logItem && logItem.jobId) deletions.push(deleteJob(logItem.jobId)); // Delete associated job if we found a log

        await Promise.allSettled(deletions);

        return {
            statusCode: 200,
            headers: corsHeaders,
            body: JSON.stringify({ success: true, jobId })
        };

    } catch (error) {
        console.error('Delete job error:', error);
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
