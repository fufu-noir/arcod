/**
 * Cancel Job Lambda Function
 * Marks a job as cancelled
 */
import type { APIGatewayEvent, APIGatewayResponse } from './types.js';
import { CORS_HEADERS } from './types.js';
import { getJobById, updateJob } from './dynamodb.js';

export async function handler(event: APIGatewayEvent): Promise<APIGatewayResponse> {
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
        const jobId = event.pathParameters?.jobId;

        if (!jobId) {
            return {
                statusCode: 400,
                headers: CORS_HEADERS,
                body: JSON.stringify({ success: false, error: 'Missing job ID' })
            };
        }

        const job = await getJobById(jobId);

        if (!job) {
            return {
                statusCode: 404,
                headers: CORS_HEADERS,
                body: JSON.stringify({ success: false, error: 'Job not found' })
            };
        }

        if (['completed', 'failed', 'cancelled'].includes(job.status)) {
            return {
                statusCode: 400,
                headers: CORS_HEADERS,
                body: JSON.stringify({ success: false, error: 'Cannot cancel finished job' })
            };
        }

        await updateJob(jobId, {
            status: 'cancelled',
            description: 'Cancelled by user'
        });

        return {
            statusCode: 200,
            headers: CORS_HEADERS,
            body: JSON.stringify({ success: true })
        };

    } catch (error) {
        console.error('Cancel job error:', error);
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
